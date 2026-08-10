import { useEffect, useRef, useState } from 'react';
import {
    submitCafeDeployRequest,
    listCafeDeployRequests,
    listDeployCredentials,
    getClientPublishedKeywords,
    uploadDeployPhoto,
    signedDeployUrls,
    PAYMENT_INFO,
    deployAmountKRW,
    cafeUnitPriceForClient,
    type CafeDeployRequest,
    type CafeDeployInput,
    type DeployPhotos,
    type DeployCredential,
} from '../../api/cafeDeployRequests';
import { enqueuePlaceScan, pollPlaceScan, enqueueRegionScan, enqueueListScan, enqueueMenuScan, enqueueRelatedScan, expandRelated, extractMenuKeywords, fetchSiteText, relatedStems, searchCachedPopular, getRegionGuTokens, getPopularFromCache, FIRST_TARGET, MORE_STEP, type ExtractedProduct, type KwResult, type RelatedCand } from '../../api/cafeKwScan';
import { requestCharge } from '../../api/cafeTokens';
import { useAuth } from '../../hooks/useAuth';

const REGION_KEYS = ['서울', '경기', '인천', '대전', '세종', '충북', '충남', '강원', '전북', '전남', '광주', '대구', '경북', '경남', '부산', '울산', '제주'] as const; // 지역형 지역셋(전국)

// 카페 배포 '접수' — 고객이 로그인 후 접수 폼 작성 + 사진(메인배너/실사사진/배너) 업로드 → 제출.
//   사진은 업로드 시 1600px 로 압축(용량·대역폭↓), deploy-intake 버킷의 본인 client_id 폴더에 저장.
//   금액/정산·미션종료일은 접수에 없음(계약관리/건수계약).
type Grp = 'main' | 'real' | 'banner';
const GROUPS: { key: Grp; label: string }[] = [
    { key: 'main', label: '메인배너' },
    { key: 'real', label: '실사사진' },
    { key: 'banner', label: '배너' },
];
const PRODUCT_FIXED = '카페';
const STATUS_STYLE: Record<string, string> = {
    접수: 'bg-[#dbeafe] text-[#1e40af]',
    결제대기: 'bg-[#ffedd5] text-[#9a3412]',
    세팅중: 'bg-[#fef9c3] text-[#854d0e]',
    완료: 'bg-[#dcfce7] text-[#166534]',
};

const empty: CafeDeployInput = {
    company_name: '', url: '', keyword: '', mission_start: '',
    daily_count: null, total_count: null, photo_provided: '', product_type: PRODUCT_FIXED, note: '',
    cafe_name: '', board_name: '', two_factor: false, naver_id: '', naver_pw: '',
    deploy_type: '지역형', region_sets: [], product_keywords: [],
};

// 업로드 전 압축 — 최대 1600px, JPEG 0.85. (실패 시 원본 반환)
async function compressImage(file: File, maxDim = 1600, quality = 0.85): Promise<Blob> {
    try {
        const img = await new Promise<HTMLImageElement>((res, rej) => {
            const im = new Image();
            im.onload = () => res(im);
            im.onerror = rej;
            im.src = URL.createObjectURL(file);
        });
        let w = img.naturalWidth || img.width;
        let h = img.naturalHeight || img.height;
        if (w > maxDim || h > maxDim) {
            const r = Math.min(maxDim / w, maxDim / h);
            w = Math.round(w * r); h = Math.round(h * r);
        }
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const ctx = c.getContext('2d');
        URL.revokeObjectURL(img.src);
        if (!ctx) return file;
        ctx.drawImage(img, 0, 0, w, h);
        return await new Promise<Blob>((res) => c.toBlob((b) => res(b || file), 'image/jpeg', quality));
    } catch {
        return file;
    }
}

export function CafeDeployIntake({ clientId }: { clientId: string | null }) {
    const { profile } = useAuth();
    const bizName = profile?.name || ''; // 로그인한 고객의 업체명(회원가입/발급 시 지정)
    const [form, setForm] = useState<CafeDeployInput>({ ...empty, company_name: bizName });
    // 업체명 자동기입 — 프로필(업체명) 로드되면 비어있는 업체명 칸을 채운다.
    useEffect(() => {
        if (bizName) setForm((f) => (f.company_name ? f : { ...f, company_name: bizName }));
    }, [bizName]);
    const [files, setFiles] = useState<Record<Grp, File[]>>({ main: [], real: [], banner: [] });
    const [rows, setRows] = useState<CafeDeployRequest[]>([]);
    const [urls, setUrls] = useState<Record<string, string>>({});
    const [creds, setCreds] = useState<Record<string, DeployCredential>>({}); // deploy_request_id → 계정
    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState('');
    const [unitPrice, setUnitPrice] = useState(PAYMENT_INFO.unitPrice); // 대행사=35,000 / 일반=15,000
    useEffect(() => { if (clientId) void cafeUnitPriceForClient(clientId).then(setUnitPrice); }, [clientId]);

    const reload = () => {
        void listCafeDeployRequests(clientId ?? undefined).then(async ({ data }) => {
            setRows(data);
            const paths = data.flatMap((r) => (r.photos ? [...r.photos.main, ...r.photos.real, ...r.photos.banner] : []));
            if (paths.length) setUrls(await signedDeployUrls(paths));
        });
        void listDeployCredentials(clientId ?? undefined).then(({ data }) => {
            const m: Record<string, DeployCredential> = {};
            data.forEach((c) => { if (c.deploy_request_id) m[c.deploy_request_id] = c; });
            setCreds(m);
        });
    };
    useEffect(reload, [clientId]);

    // '이미 사용' 키워드 집합 갱신 — 과거 접수의 selected_keywords(체크) + 발행 posts(cafe_rank_posts).
    useEffect(() => {
        let alive = true;
        const checked = rows.flatMap((r) => (r.selected_keywords ?? []).map((p) => p.keyword));
        void (async () => {
            const published = clientId ? await getClientPublishedKeywords(clientId) : [];
            if (!alive) return;
            setUsedKw(new Set([...checked, ...published].map(normKw).filter(Boolean)));
        })();
        return () => { alive = false; };
    }, [rows, clientId]);

    const set = <K extends keyof CafeDeployInput>(k: K, v: CafeDeployInput[K]) =>
        setForm((f) => ({ ...f, [k]: v }));
    // 접수 유형 — 지역형(지역+제품키워드) / 키워드형(플레이스 주소 기반) / 직접형(키워드 직접 입력)
    const isKw = form.deploy_type === '키워드형';
    const isManual = form.deploy_type === '직접형';          // 일반 배포 — 인기탭 안 따짐
    // 인기탭 배포 · 직접입력형 — 고객이 키워드를 직접 적되, 인기탭이 확인된 것만 채택한다.
    //   일반 배포의 직접입력과 화면은 비슷하지만 판정을 거치므로 실적 집계가 인기탭 기준으로 잡힌다
    //   (cafe_contract_sync 의 일반배포 판별은 deploy_type='직접형' 만 보므로 자동으로 갈린다).
    const isPopManual = form.deploy_type === '인기직접형';
    // 연관형 — 씨앗어 하나(보홀·장기요양 등)에서 연관 키워드를 펼쳐 인기탭을 찾는다.
    //   지역·플레이스가 없어도 되고, 전국형/지역형 중 어느 쪽인지도 알려 준다.
    const isRelated = form.deploy_type === '연관형';
    // 정보형 — 플레이스가 없는 업체. 홈페이지·블로그 주소(또는 붙여넣기)에서 제품키워드를 만든다.
    //   지역축·발행 흐름은 지역형과 같아서 UI 대부분을 공유하되(isRegionLike),
    //   주소/정보 입력 블록만 이쪽 전용이다. deploy_type 은 순수 text 라 값 추가에 DB 변경이 없고,
    //   cafe_contract_sync 는 '직접형'만 일반배포로 보므로 정보형은 인기탭 배포로 잡힌다.
    const isInfo = form.deploy_type === '정보형';
    const isRegion = !isKw && !isManual && !isPopManual && !isRelated && !isInfo;
    const isRegionLike = isRegion || isInfo;
    const regionSel = form.region_sets || [];
    const toggleRegion = (r: string) => {
        const cur = new Set(regionSel);
        if (cur.has(r)) cur.delete(r); else cur.add(r);
        set('region_sets', Array.from(cur));
    };
    // 지역형 제품키워드 칩 — 입력 후 엔터/추가 → 아래 칩으로 쌓임. 중복·공백 제거.
    const productKws = form.product_keywords || [];
    const addProductKw = () => {
        const v = (form.keyword || '').trim().replace(/\s+/g, ' ');
        if (!v) return;
        if (!productKws.includes(v)) set('product_keywords', [...productKws, v]);
        set('keyword', '');
    };
    const removeProductKw = (kw: string) => set('product_keywords', productKws.filter((k) => k !== kw));
    // 플레이스가 없는 고객용 — 위치 직접입력 + 소개/메뉴 붙여넣기 → GPT 추출 → 체크박스로 확정 → 제품키워드 칩.
    //   ★ 자동 채우기 금지: 추출엔 늘 군더더기가 섞여, 자동 확정하면 그게 조용히 스캔 비용·오탐이 된다.
    const [ownAddr, setOwnAddr] = useState('');
    const [extracted, setExtracted] = useState<ExtractedProduct[] | null>(null);
    const [picked, setPicked] = useState<Set<string>>(new Set());
    const [extracting, setExtracting] = useState(false);
    const [siteUrl, setSiteUrl] = useState('');   // 홈페이지·네이버 블로그 주소(여러 개 가능)
    // 주소 → 원문을 붙여넣기 칸에 채운다. 줄바꿈/쉼표로 여러 개를 한 번에.
    //   ★ 사이트+블로그를 같이 넣는 게 가장 낫다(실측 2026-08-07 경기간호): 각각 28개인데 합치면 39개.
    //   ★ 덮어쓰지 않는다 — 직전 자동수집분만 걷어내고 다시 붙인다(안 그러면 두 번째 주소가 첫 번째를 지운다).
    const autoTextRef = useRef('');
    const [srcParts, setSrcParts] = useState<{ label: string; text: string }[]>([]);  // 원천별 원문(따로 추출해 합치려고 보관)
    const pullSite = async () => {
        const urls = [...new Set(siteUrl.split(/[\n,]/).map((s) => s.trim()).filter(Boolean))];
        if (!urls.length) { setKwErr('홈페이지 또는 네이버 블로그 주소를 입력하세요.'); return; }
        setKwErr(''); setExtracting(true);
        const parts: string[] = [];
        const srcs: { label: string; text: string }[] = [];
        const notes: string[] = [];
        const fails: string[] = [];
        for (const u of urls) {
            try {
                const b = await fetchSiteText(u);
                const what = b.source === 'naver_blog' ? `블로그 글 ${b.posts ?? 0}개` : `페이지 ${b.pages.length}장`;
                parts.push(`[출처: ${u}]\n${b.text}`);
                srcs.push({ label: b.source === 'naver_blog' ? '블로그' : '홈페이지', text: b.text });
                notes.push(`${b.title || u}(${what}·${b.chars.toLocaleString()}자)`);
            } catch (e) {
                fails.push(`${u} — ${e instanceof Error ? e.message : '읽기 실패'}`);
            }
        }
        setExtracting(false);
        if (!parts.length) { setKwErr(fails.join(' / ') || '주소를 읽지 못했습니다'); return; }
        setSrcParts(srcs);
        const auto = parts.join('\n\n');
        const manual = (autoTextRef.current ? placeDetail.split(autoTextRef.current).join('') : placeDetail).trim();
        autoTextRef.current = auto;
        setPlaceDetail(manual ? `${manual}\n\n${auto}` : auto);
        setKwErr(`${notes.join(' + ')} 를 가져왔습니다 — ‘① 키워드 뽑기’를 눌러 주세요.`
            + (fails.length ? ` ⚠️ 실패: ${fails.join(' / ')}` : ''));
    };
    // ★ 원천마다 따로 추출해서 합친다(실측 2026-08-07 경기간호).
    //   통째로 한 번에 넣으면 51개, 블로그·홈페이지를 각각 뽑아 합치면 68개.
    //   원문이 길어질수록 GPT 가 조각당 상한 안에서 굵은 것 위주로 고르기 때문에,
    //   합쳐 넣으면 '고관절골절재활→고관절골절'처럼 뭉뚱그려지며 세부가 떨어져 나간다.
    //   비용은 호출 수만큼 는다(3원 남짓) — 키워드를 놓치는 쪽이 훨씬 비싸다.
    const runExtract = async () => {
        const raw = placeDetail.trim();
        if (!raw) { setKwErr('업체 소개·메뉴를 붙여넣으세요.'); return; }
        setKwErr(''); setExtracting(true); setExtracted(null);
        try {
            const manual = (autoTextRef.current ? placeDetail.split(autoTextRef.current).join('') : placeDetail).trim();
            const lots = [
                ...(manual ? [{ label: '직접입력', text: manual }] : []),
                ...srcParts,
            ];
            const hint = (form.keyword || '').trim();
            const runs = lots.length
                ? await Promise.all(lots.map((s) => extractMenuKeywords(s.text, hint).catch(() => ({ biz: '', products: [] as ExtractedProduct[] }))))
                : [await extractMenuKeywords(raw, hint)];
            const seen = new Set<string>();
            const products: ExtractedProduct[] = [];
            for (const r of runs) {
                for (const p of r.products) {
                    const n = p.kw.replace(/\s/g, '');
                    if (seen.has(n)) continue;
                    seen.add(n); products.push(p);
                }
            }
            if (!products.length) { setKwErr('검색 가능한 제품·서비스 키워드를 찾지 못했습니다.'); return; }
            setExtracted(products);
            // ★ 세부(niche)까지 전부 기본 체크 — 쓸 만한지는 인기탭 스캔이 판정한다.
            //   미리 빼면 걸러질 일 없는 키워드까지 같이 사라진다(실측: 경기간호에서
            //   파킨슨병 47,080 · 뇌졸중 33,650 이 niche 로 분류돼 있었다).
            setPicked(new Set(products.map((x) => x.kw)));
            if (lots.length > 1) setKwErr(`원천 ${lots.length}곳(${lots.map((s) => s.label).join(' · ')})에서 ${products.length}개를 뽑았습니다.`);
        } catch (e) {
            setKwErr(e instanceof Error ? e.message : '키워드 추출 실패');
        } finally { setExtracting(false); }
    };
    const confirmExtracted = () => {
        const add = (extracted || []).map((x) => x.kw).filter((k) => picked.has(k) && !productKws.includes(k));
        if (!add.length) { setKwErr('추가할 키워드를 체크하세요(이미 추가된 것은 제외됩니다).'); return; }
        set('product_keywords', [...productKws, ...add]);
        setExtracted(null); setPicked(new Set()); setKwErr('');
    };
    // 직접형 — 입력한 키워드를 인기탭 확인 없이 바로 선택 키워드(kwPicked)로. 최대 50개·중복 제거.
    const addManualKw = () => {
        const v = (form.keyword || '').trim().replace(/\s+/g, ' ');
        if (!v) return;
        if (kwPicked.length >= 50) { setKwErr('직접 입력은 최대 50개입니다.'); return; }
        setKwErr('');
        setKwPicked((prev) => (prev.some((p) => p.keyword === v) ? prev : [...prev, { keyword: v } as KwResult]));
        set('keyword', '');
    };
    // 인기탭 배포 · 직접입력형 — 적어 둔 키워드 목록(칩)을 워커가 전부 인기탭 판정하고, 통과분만 남긴다.
    const [popManualKws, setPopManualKws] = useState<string[]>([]);
    const addPopManualKw = () => {
        const v = (form.keyword || '').trim().replace(/\s+/g, ' ');
        if (!v) return;
        if (popManualKws.length >= 50) { setKwErr('직접 입력은 최대 50개입니다.'); return; }
        setKwErr('');
        setPopManualKws((prev) => (prev.includes(v) ? prev : [...prev, v]));
        set('keyword', '');
    };
    // 연관형 ① — 씨앗어에서 연관 키워드 펼치기(검색광고, 스캔 아님)
    //   REL_MAX = 한 번에 판정할 수 있는 최대 개수. 워커(process_related)의 MAX_A 와 같아야 한다 —
    //   더 보내면 워커가 조용히 자른다. 2.5초 간격이라 200개면 약 8.5분(웹 폴링 900초 안쪽).
    const REL_MAX = 200;
    const [seed, setSeed] = useState('');
    const [relCands, setRelCands] = useState<RelatedCand[] | null>(null);
    const [relPicked, setRelPicked] = useState<Set<string>>(new Set());
    const [relTier, setRelTier] = useState<'seed' | 'near' | 'far'>('near');
    const [relRegional, setRelRegional] = useState<(KwResult & { sample?: string[] })[]>([]);
    // 캐시 우선 — 이미 판정된 인기탭. 스캔 0회로 즉시 나온다.
    const [cachedHits, setCachedHits] = useState<KwResult[] | null>(null);
    const [cachedVia, setCachedVia] = useState<string[]>([]);   // 이 결과를 찾아낸 어간(씨앗어와 다를 수 있다)
    const runExpandSeed = async () => {
        const s = seed.trim();
        if (!s) { setKwErr('씨앗 키워드를 입력하세요(예: 보홀 · 장기요양).'); return; }
        setKwErr(''); setExtracting(true); setRelCands(null); setKwResult(null); setRelRegional([]);
        try {
            const list = await expandRelated(s);
            if (!list.length) { setKwErr(`"${s}" 의 연관 키워드를 찾지 못했습니다.`); return; }
            setRelCands(list);
            // 기본 체크 = 의도어(여행·숙소·패키지…)가 붙은 것. 실측상 여기서 인기글이 나온다(정확도 76%).
            // ★ 기본 체크 = 씨앗어를 포함한 것(tier==='seed'). 옛 '의도어' 규칙은 재현율 7%였다
            //   (독립검증 2026-08-10: 의도어 96개·재현율 7% vs tier==seed 1509개·재현율 77%).
            //   의도어는 여행 어휘 목록이라 창업·누수탐지·입주청소에서 양성을 0건 골랐다.
            setRelPicked(new Set(list.filter((x) => x.tier === 'seed').slice(0, 200).map((x) => x.kw)));
            // ★ 스캔 전에 캐시부터 — 이미 판정된 게 1,000건 넘어 상당수는 긁지 않고 바로 준다.
            const hits = await searchCachedPopular(relatedStems(s, list));
            setCachedVia([...new Set(hits.map((h) => h.via))]);
            setCachedHits(hits.map((h) => ({ cafes: h.cafes, keyword: h.keyword, theme: h.theme ?? undefined, volume: h.volume ?? undefined })));
        } catch (e) {
            setKwErr(e instanceof Error ? e.message : '연관어 조회 실패');
        } finally { setExtracting(false); }
    };
    // 연관형 ② — 전국 판정 + 지역형 찔러보기를 한 번에(process_related)
    const runRelatedScan = async () => {
        const list = [...relPicked];
        if (!list.length) { setKwErr('스캔할 키워드를 1개 이상 체크하세요.'); return; }
        setKwErr(''); setKwLoading(true); setScanNote(''); setKwResult(null); setKwHidden([]); setKwPicked([]);
        try {
            const { id, error } = await enqueueRelatedScan(seed, list.slice(0, REL_MAX));
            if (error || !id) throw new Error(error?.message || '분석 등록 실패');
            const { result } = await pollPlaceScan(id, { timeoutSec: 1500, onProgress: (n) => setScanNote(n) });
            const reg = result.filter((r) => (r as KwResult & { kind?: string }).kind === 'regional');
            const nat = result.filter((r) => (r as KwResult & { kind?: string }).kind !== 'regional');
            setRelRegional(reg as (KwResult & { sample?: string[] })[]);
            if (!nat.length && !reg.length) {
                setKwErr(`체크한 ${list.length}개 중 인기탭이 확인된 키워드가 없습니다. `
                    + `일반 배포로 접수하시면 인기탭 확인 없이 그대로 발행됩니다.`);
                return;
            }
            setKwResult([...nat].sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0)));
            if (!form.keyword) set('keyword', seed.trim());
        } catch (e) {
            setKwErr(e instanceof Error ? e.message : '조회 실패');
        } finally { setKwLoading(false); setScanNote(''); }
    };

    const checkPopManual = async () => {
        const list = popManualKws.length ? popManualKws : [(form.keyword || '').trim()].filter(Boolean);
        if (!list.length) { setKwErr('확인할 키워드를 입력하세요(입력 후 엔터/추가).'); return; }
        setKwErr(''); setKwLoading(true); setScanNote('인기탭 확인 준비 중…');
        setKwResult(null); setKwHidden([]); setKwPicked([]);
        try {
            const { id, error } = await enqueueListScan(list, 50);
            if (error || !id) throw new Error(error?.message || '분석 등록 실패');
            const { result } = await pollPlaceScan(id, { timeoutSec: 1500, onProgress: (n) => setScanNote(n) });
            if (!result.length) {
                setKwErr(`입력한 ${list.length}개 중 인기탭이 확인된 키워드가 없습니다. `
                    + `일반 배포로 접수하시면 인기탭 확인 없이 그대로 발행됩니다.`);
                return;
            }
            setKwResult([...result].sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0)));
        } catch (e) {
            setKwErr(e instanceof Error ? e.message : '확인 실패');
        } finally { setKwLoading(false); setScanNote(''); }
    };
    const addFiles = (g: Grp, list: FileList | null) => {
        if (!list?.length) return;
        const arr = Array.from(list); // 동기적으로 캡처(input.value='' 초기화 전에) — 안 하면 목록이 비어 등록 안 됨
        setFiles((f) => ({ ...f, [g]: [...f[g], ...arr] }));
    };
    const removeFile = (g: Grp, i: number) => setFiles((f) => ({ ...f, [g]: f[g].filter((_, j) => j !== i) }));
    const totalFiles = files.main.length + files.real.length + files.banner.length;

    // 정확 인기탭 분석(키워드형) — cafe_kw_requests 큐 → 워커(우리 IP: 사무실 유선/main, 크롤 겹치면 CF) → 진짜 인기탭 결과.
    const [kwLoading, setKwLoading] = useState(false);
    const [scanNote, setScanNote] = useState('');   // 인기탭 스캔 진행상태(게이지바) — "진행 x/total" 형태면 % 표시
    const [kwResult, setKwResult] = useState<KwResult[] | null>(null);
    const [kwErr, setKwErr] = useState('');
    const [kwHidden, setKwHidden] = useState<string[]>([]); // X로 제외한 키워드(화면에서만 숨김)
    const [kwPicked, setKwPicked] = useState<KwResult[]>([]); // 고객이 고른 키워드(발행 대상 → 접수에 전달)
    const [pickedOpen, setPickedOpen] = useState(false); // 선택 키워드 드롭다운 펼침(기본 접힘 · 우측 N개)
    const [payBusy, setPayBusy] = useState(false); // 결제완료 알림 전송 중
    const [payMsg, setPayMsg] = useState(''); // 결제완료 알림 결과
    const [placeDetail, setPlaceDetail] = useState(''); // 키워드형 '상세 정보 입력' — 플레이스에 메뉴/정보 없을 때 붙여넣기(비고 [상세정보]로 저장)
    const togglePick = (k: KwResult) =>
        setKwPicked((prev) => (prev.some((p) => p.keyword === k.keyword) ? prev.filter((p) => p.keyword !== k.keyword) : [...prev, k]));
    const hideKw = (kw: string) => {
        setKwHidden((prev) => (prev.includes(kw) ? prev : [...prev, kw]));
        setKwPicked((prev) => prev.filter((p) => p.keyword !== kw)); // 숨기면 선택도 해제
    };
    // 이 업체가 이미 체크(과거 접수 selected_keywords)했거나 카페에 발행(cafe_rank_posts)한 키워드 집합.
    //   재스캔 시 중복 제외. 공백만 정규화(다른 키워드는 구분 유지).
    const [usedKw, setUsedKw] = useState<Set<string>>(new Set());
    const normKw = (s: string) => (s || '').trim().replace(/\s+/g, ' ');
    // 회차 정책 — 30건 찾고 멈추고, 부족하면 ＋10 씩 이어서 본다(사무실 화면과 같은 숫자·같은 동작).
    //   숫자는 cafeKwScan 에서만 정한다. 예전엔 이 화면이 플레이스형 10→50, 지역형 300 이라
    //   같은 기능인데 화면마다 결과 개수가 달랐다.
    const [scanTarget, setScanTarget] = useState(FIRST_TARGET);
    const runPlaceScan = async (target = FIRST_TARGET) => {
        const u = (form.url || '').trim();
        if (!u) { setKwErr('플레이스 주소를 입력하세요.'); return; }
        setKwErr(''); setKwLoading(true); setScanNote('인기탭 분석 준비 중…'); setScanTarget(target);
        // 첫 회차만 초기화 — '＋더 찾기'는 기존 결과에 이어붙인다(이미 판정된 건 캐시라 즉시 통과).
        const prev = target > FIRST_TARGET ? (kwResult ?? []) : [];
        if (target <= FIRST_TARGET) { setKwResult(null); setKwHidden([]); setKwPicked([]); }
        try {
            const { id, error } = await enqueuePlaceScan(u, target, (form.region_sets?.length ? form.region_sets.join(',') : '서울,경기,인천'));
            if (error || !id) throw new Error(error?.message || '요청 실패');
            const { result } = await pollPlaceScan(id, { timeoutSec: target > FIRST_TARGET ? 1500 : 600, onProgress: (note) => setScanNote(note) });
            // 회차를 이어붙인다 — 워커가 target 만큼만 채우고 끝내므로 이전 회차 결과를 잃으면 안 된다.
            const seenPl = new Set<string>();
            const mergedPl: KwResult[] = [];
            for (const r of [...prev, ...result]) {
                const n = r.keyword.replace(/\s/g, '');
                if (!seenPl.has(n)) { seenPl.add(n); mergedPl.push(r); }
            }
            setKwResult(mergedPl);
        } catch (e) {
            setKwErr(e instanceof Error ? e.message : '분석 실패');
        } finally {
            setKwLoading(false); setScanNote('');
        }
    };
    // 지역형 — 고정 동 마스터(cafe_region_dong)에서 선택 시도의 동 전부 × 제품키워드로 후보 생성.
    //   결과를 kwResult 에 넣어 키워드형과 같은 선택 UI(복수선택·×제외·중복제외)로 다룬다. 스캔 없음(동×키워드가 발행 대상).
    // 지역형 키워드 생성 — 고객 제품키워드 칩 × 선택 지역의 '행정구/시'. (동 아님 — 실측상 동 인기탭 0)
    //   예: 칩[누수탐지,누수] × 서울·경기 → '강남 누수탐지','강남 누수','수원 누수탐지'…
    const genRegionKeywords = async (target = FIRST_TARGET) => {
        const kws = (productKws.length ? productKws : [(form.keyword || '').trim()]).filter(Boolean);
        if (!kws.length) { setKwErr('제품 키워드를 추가하세요(입력 후 엔터/추가). 예: 누수탐지'); return; }
        const sidos = form.region_sets || [];
        if (!sidos.length && !ownAddr.trim()) { setKwErr('지역을 선택하거나 위치를 직접 입력하세요.'); return; }
        setKwErr(''); setKwLoading(true); setScanNote('지역 인기탭 조회 준비 중…'); setScanTarget(target);
        // 첫 회차만 초기화 — '＋더 찾기'는 기존 결과 위에 이어붙인다.
        const prev = target > FIRST_TARGET ? (kwResult ?? []) : [];
        if (target <= FIRST_TARGET) { setKwResult(null); setKwHidden([]); setKwPicked([]); }
        try {
            // 위치를 직접 적었으면 그 주소에서 지역 축을 뽑아 '가까운 곳부터' 본다(플레이스 없는 업체).
            //   시도까지 골랐으면 자기 지역을 채운 뒤 그 시도 전체로 확장한다.
            if (ownAddr.trim()) {
                const { id, error } = await enqueueMenuScan(ownAddr, kws, { name: form.company_name, regions: sidos.join(','), target });
                if (error || !id) throw new Error(error?.message || '분석 등록 실패');
                const { result } = await pollPlaceScan(id, { timeoutSec: 1500, onProgress: (note) => setScanNote(note) });
                const seenOwn = new Set<string>();
                const mergedOwn: KwResult[] = [];
                for (const r of [...prev, ...result]) {
                    const n = r.keyword.replace(/\s/g, '');
                    if (!seenOwn.has(n)) { seenOwn.add(n); mergedOwn.push(r); }
                }
                if (!mergedOwn.length) { setKwErr(`인기탭 확인된 키워드가 없습니다 — ${ownAddr.trim()} × [${kws.join(', ')}]`); return; }
                setKwResult(mergedOwn.sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0)));
                return;
            }
            // ① 캐시 양성 즉시 표시(UX) — 하지만 여기서 멈추지 않고 ②에서 전수 재검증한다.
            const gus = await getRegionGuTokens(sidos);
            const combos = new Set<string>();
            for (const g of gus) for (const kw of kws) combos.add(`${g.token} ${kw}`);
            const cached = await getPopularFromCache([...combos]);
            const seen = new Set<string>();
            const merged: KwResult[] = [];
            for (const r of [...prev, ...cached]) { const n = r.keyword.replace(/\s/g, ''); if (!seen.has(n)) { seen.add(n); merged.push(r); } }
            if (merged.length) setKwResult([...merged].sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0)));   // 캐시분 먼저
            // ② 항상 라이브 지역 스캔 — 캐시 양성만 믿고 멈추면 prescan 음성·미스캔분 누락(워커 내부 배치캐시로 판정된 건 즉시).
            for (let i = 0; i < kws.length; i++) {
                const pk = kws[i];
                const { id, error } = await enqueueRegionScan(pk, sidos.join(','), target);
                if (error || !id) continue;
                const tag = kws.length > 1 ? ` (${i + 1}/${kws.length})` : '';
                const { result } = await pollPlaceScan(id, { timeoutSec: 1500, onProgress: (note) => setScanNote(`${pk} · ${note}${tag}`) });
                for (const r of result) { const n = r.keyword.replace(/\s/g, ''); if (!seen.has(n)) { seen.add(n); merged.push(r); } }
            }
            if (!merged.length) {
                setKwErr(`인기탭 확인된 키워드가 없습니다 — ${sidos.join('·')} × [${kws.join(', ')}] (인기탭 없음)`);
                return;
            }
            setKwResult(merged.sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0)));
        } catch (e) {
            setKwErr(e instanceof Error ? e.message : '조회 실패');
        } finally {
            setKwLoading(false); setScanNote('');
        }
    };

    // 접수 시: 총 발행건수보다 선택 키워드가 적으면 '미입력 N건' 확인(직접 고르기 / 담당자에게 맡기기).
    const [remainAsk, setRemainAsk] = useState<number | null>(null);
    const submit = () => {
        if (!clientId) return setMsg('고객 계정이 연결되어 있지 않습니다. 담당자에게 문의하세요.');
        if (!form.company_name.trim()) return setMsg('업체명을 입력하세요.');
        if (form.daily_count != null && form.daily_count > 5) return setMsg('일 발행건수는 최대 5건입니다.');
        const target = form.total_count ?? 0;
        const shortfall = target - kwPicked.length;
        if (target > 0 && shortfall > 0) { setRemainAsk(shortfall); return; } // 미입력 → 확인 창
        void doSubmit(false);
    };
    const doSubmit = async (delegate: boolean) => {
        if (!clientId) return;
        setRemainAsk(null);
        setBusy(true); setMsg('');
        // 사진 업로드(압축)
        const batch = String(Date.now());
        const photos: DeployPhotos = { main: [], real: [], banner: [] };
        try {
            for (const g of ['main', 'real', 'banner'] as Grp[]) {
                for (let i = 0; i < files[g].length; i += 1) {
                    setMsg(`사진 업로드 중… (${g} ${i + 1}/${files[g].length})`);
                    const blob = await compressImage(files[g][i]);
                    const { path, error } = await uploadDeployPhoto(clientId, batch, g, i, blob);
                    if (error || !path) throw new Error(`${g} ${i + 1}번째 — ${error || '업로드 실패'}`);
                    photos[g].push(path);
                }
            }
        } catch (e) {
            setBusy(false);
            return setMsg('사진 업로드 실패: ' + (e instanceof Error ? e.message : ''));
        }
        const summary = GROUPS.map((g) => (photos[g.key].length ? `${g.label} ${photos[g.key].length}` : '')).filter(Boolean).join(' · ');
        const picks = kwPicked.map((p) => ({ keyword: p.keyword, volume: p.volume ?? null, theme: p.theme ?? null }));
        // 나머지 키워드를 담당자에게 맡긴 경우 — 비고에 위임 표시(담당자가 스튜디오에서 목표까지 채움).
        const shortfall = (form.total_count ?? 0) - kwPicked.length;
        const delegateNote = delegate && shortfall > 0 ? `[키워드 ${shortfall}건 선정 위임 — 담당자가 나머지 키워드 선정]` : '';
        const detailNote = placeDetail.trim() ? `[상세정보]\n${placeDetail.trim()}` : '';   // 상세 정보 입력 → 비고에 저장
        const addrNote = ownAddr.trim() ? `[위치] ${ownAddr.trim()}` : '';                  // 플레이스 없는 업체가 직접 적은 위치
        const note = [form.note?.trim(), delegateNote, addrNote, detailNote].filter(Boolean).join('\n');
        const { error } = await submitCafeDeployRequest(clientId, { ...form, note, photos, photo_provided: summary, selected_keywords: picks });
        setBusy(false);
        if (error) return setMsg(`접수 실패: ${error.message}`);
        setMsg('접수되었습니다. 담당자 확인 후 세팅해 드립니다.');
        setForm({ ...empty, company_name: bizName }); setFiles({ main: [], real: [], banner: [] }); setPlaceDetail('');
        setOwnAddr(''); setExtracted(null); setPicked(new Set()); setPopManualKws([]);
        setSeed(''); setRelCands(null); setRelPicked(new Set()); setRelRegional([]); setCachedHits(null);
        setKwResult(null); setKwPicked([]); setKwHidden([]); setPickedOpen(false);
        reload();
    };

    const inputCls = 'h-10 w-full rounded-md border border-[#cbd5e1] px-3 text-sm outline-none focus:border-[#4338ca]';
    const labelCls = 'mb-1 block text-[13px] font-semibold text-[#334155]';

    // 선택 UI(선택칩 + 결과 리스트) — 키워드형(인기탭 결과)·지역형(동 키워드) 공용. kwResult 에 따라 렌더.
    const kwPanel = (
        <>
            {/* 인기탭 스캔 진행 게이지 — 스캔 중 표시(우리ERP finder와 동일). "x/total" 형태면 %, 아니면 pulse. */}
            {kwLoading || scanNote ? (() => {
                const m = scanNote.match(/(\d+)\/(\d+)/);
                const pct = m ? Math.min(100, Math.round((Number(m[1]) / Math.max(1, Number(m[2]))) * 100)) : null;
                return (
                    <div className="mt-2 rounded-lg border border-[#c4b5fd] bg-[#f5f3ff] p-3">
                        <div className="mb-1.5 flex items-center justify-between text-[12px] font-bold text-[#6d28d9]">
                            <span>🔍 인기탭 스캔 중… <span className="font-normal text-[#64748b]">{scanNote || '준비 중…'}</span></span>
                            {pct !== null ? <span>{pct}%</span> : null}
                        </div>
                        <div className="h-2.5 w-full overflow-hidden rounded-full bg-[#e9d5ff]">
                            <div className={`h-full rounded-full bg-[#7c3aed] ${pct === null ? 'animate-pulse' : 'transition-all duration-500'}`} style={{ width: `${pct ?? 25}%` }} />
                        </div>
                    </div>
                );
            })() : null}
            {kwErr && <p className="mb-0 mt-1 text-[12px] text-[#dc2626]">{kwErr}</p>}
            {kwPicked.length ? (
                <div className="mt-2 rounded-lg border border-[#c7d2fe] bg-[#eef2ff]">
                    <button type="button" onClick={() => setPickedOpen((o) => !o)} className="flex w-full items-center justify-between gap-2 px-2.5 py-2 text-[11px] font-semibold text-[#4338ca]">
                        <span className="flex items-center gap-1.5">
                            <span className={`text-[9px] transition-transform ${pickedOpen ? 'rotate-90' : ''}`}>▶</span>
                            선택한 발행 키워드 — 접수 시 함께 전달됩니다
                        </span>
                        <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-[11px] font-bold text-[#4338ca] ring-1 ring-[#c7d2fe]">{kwPicked.length}개</span>
                    </button>
                    {pickedOpen ? (
                        <div className="flex flex-wrap gap-1.5 border-t border-[#c7d2fe] p-2">
                            {kwPicked.map((p) => (
                                <span key={p.keyword} className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-1 text-[12px] font-semibold text-[#3730a3] ring-1 ring-[#c7d2fe]">
                                    {p.keyword}
                                    {p.volume != null ? <span className="text-[10px] font-normal text-[#94a3b8]">{p.volume.toLocaleString()}</span> : null}
                                    <button type="button" onClick={() => togglePick(p)} className="text-[#818cf8] hover:text-[#4338ca]" title="선택 해제">×</button>
                                </span>
                            ))}
                        </div>
                    ) : null}
                </div>
            ) : null}
            {kwResult && (() => {
                const visible = kwResult.filter((k) => !kwHidden.includes(k.keyword));
                const fresh = visible.filter((k) => !usedKw.has(normKw(k.keyword)));
                const used = visible.filter((k) => usedKw.has(normKw(k.keyword)));
                return (
                <div className="mt-2 rounded-lg border border-[#ddd6fe] bg-[#faf5ff] p-2">
                    <div className="mb-1 text-[11px] font-semibold text-[#6d28d9]">
                        {isKw ? '정확 인기탭 결과 — 진입한 키워드 중 발행할 것을 고르세요(복수 선택). 필요없는 건 × 로 제외.'
                              : `지역 키워드 ${kwResult.length}개 — 발행할 동을 고르세요(복수 선택). 필요없는 건 × 로 제외.`}
                    </div>
                    {fresh.length ? (() => {
                        const allOn = fresh.every((k) => kwPicked.some((p) => p.keyword === k.keyword));
                        const toggleAll = () => setKwPicked((prev) => allOn
                            ? prev.filter((p) => !fresh.some((k) => k.keyword === p.keyword))            // 전체 해제(현재 목록분만)
                            : [...prev, ...fresh.filter((k) => !prev.some((p) => p.keyword === k.keyword))]); // 전체 선택(중복 제외 추가)
                        return (
                            <label className="mb-1.5 flex w-fit cursor-pointer items-center gap-1.5 rounded-md bg-white px-2 py-1 text-[11px] font-bold text-[#4338ca] ring-1 ring-[#c7d2fe]">
                                <input type="checkbox" checked={allOn} onChange={toggleAll} className="h-3.5 w-3.5 accent-[#4338ca]" />
                                전체 선택 <span className="font-normal text-[#94a3b8]">({fresh.filter((k) => kwPicked.some((p) => p.keyword === k.keyword)).length}/{fresh.length})</span>
                            </label>
                        );
                    })() : null}
                    {fresh.length === 0 ? (
                        <div className="py-2 text-center text-[12px] text-[#94a3b8]">{used.length ? '새로운 키워드가 없습니다(모두 이미 사용·발행함).' : '키워드가 없습니다.'}</div>
                    ) : (
                        <div className="grid max-h-72 gap-1.5 overflow-y-auto">
                            {fresh.map((k) => {
                                const picked = kwPicked.some((p) => p.keyword === k.keyword);
                                return (
                                <div key={k.keyword} className={`rounded border p-2 ${picked ? 'border-[#4338ca] bg-[#eef2ff] ring-1 ring-[#4338ca]' : 'border-[#eef0f2] bg-white'}`}>
                                    <div className="flex items-center gap-2 text-[12px]">
                                        <label className="flex cursor-pointer items-center gap-1.5 font-bold text-[#4338ca]">
                                            <input type="checkbox" checked={picked} onChange={() => togglePick(k)} className="h-3.5 w-3.5 accent-[#4338ca]" />
                                            {k.keyword}
                                        </label>
                                        {k.volume != null ? <span className="text-[#64748b]">검색량 {k.volume.toLocaleString()}</span> : null}
                                        {k.theme ? <span className="rounded-full bg-[#ede9fe] px-2 py-0.5 text-[10px] text-[#6d28d9]">{k.theme}</span> : null}
                                        <button type="button" onClick={() => hideKw(k.keyword)} className="ml-auto flex h-5 w-5 items-center justify-center rounded-full text-[13px] text-[#cbd5e1] hover:bg-[#fee2e2] hover:text-[#dc2626]" title="이 키워드 제외">×</button>
                                    </div>
                                    {k.cafes?.length ? (
                                        <div className="mt-1 flex flex-wrap gap-1 text-[11px] text-[#64748b]">
                                            {k.cafes.slice(0, 5).map((c, j) => (
                                                <span key={j} className="rounded bg-[#f1f5f9] px-1.5 py-0.5">{c.rank}위 {c.who}</span>
                                            ))}
                                        </div>
                                    ) : null}
                                </div>
                                );
                            })}
                        </div>
                    )}
                    {used.length ? (
                        <div className="mt-1.5 rounded border border-dashed border-[#e2e8f0] bg-white/60 p-1.5">
                            <div className="mb-1 text-[10px] font-semibold text-[#94a3b8]">이미 사용·발행한 키워드 {used.length}개 — 중복 방지로 제외됨</div>
                            <div className="flex flex-wrap gap-1">
                                {used.map((k) => (
                                    <span key={k.keyword} className="rounded bg-[#f1f5f9] px-1.5 py-0.5 text-[10px] text-[#94a3b8] line-through">{k.keyword}</span>
                                ))}
                            </div>
                        </div>
                    ) : null}
                    {/* ＋더 찾기 — 회차당 30건에서 멈추므로 부족하면 ＋10 씩 이어서 본다(사무실 화면과 동일).
                        결과가 적을수록 더 필요하다 — 3건만 나왔을 때 더 찾고 싶지, 30건 나왔을 때만이 아니다.
                        이미 판정된 조합은 캐시 히트라 즉시 통과하므로 이어찾기는 처음보다 빠르다. */}
                    <button type="button" onClick={() => void (isKw ? runPlaceScan(scanTarget + MORE_STEP) : genRegionKeywords(scanTarget + MORE_STEP))}
                        disabled={kwLoading}
                        className="mt-1.5 w-full rounded-md border border-[#c4b5fd] bg-white py-1.5 text-[12px] font-bold text-[#6d28d9] hover:bg-[#f5f3ff] disabled:opacity-50"
                        title="이번 회차는 30건에서 멈춥니다. 부족하면 10건씩 이어서 찾습니다(이미 본 조합은 건너뜁니다).">
                        {kwLoading ? '이어서 찾는 중…' : `＋${MORE_STEP} 더 찾기 (지금 ${kwResult.length}개 · 목표 ${scanTarget + MORE_STEP}개)`}
                    </button>
                </div>
                );
            })()}
        </>
    );

    const pendingPay = rows.filter((r) => r.status === '결제대기');
    // 결제 완료 알림 — 고객이 계좌이체/카드결제 후 누르면 우리쪽에 충전요청(pending) 접수. 담당자가 실제 내역 확인 후 토큰 지급.
    const notifyPaid = async (method: string) => {
        if (!clientId || !pendingPay.length) return;
        const totalCount = pendingPay.reduce((s, r) => s + (r.total_count ?? r.selected_keywords?.length ?? 0), 0);
        const totalAmt = pendingPay.reduce((s, r) => s + deployAmountKRW(r, unitPrice), 0);
        const names = pendingPay.map((r) => r.company_name).join(', ');
        setPayBusy(true); setPayMsg('');
        const note = `[${method}] 카페 배포 결제완료 · ${names}${totalAmt ? ` · ₩${totalAmt.toLocaleString('ko-KR')}` : ''} — 입금/결제 내역 확인 요청`;
        const { error } = await requestCharge(clientId, totalCount || null, note);
        setPayBusy(false);
        setPayMsg(error ? `요청 실패: ${error.message}` : '결제 완료 알림이 접수되었습니다. 담당자가 내역 확인 후 발행 토큰을 지급합니다.');
    };

    return (
        <div className="grid gap-5">
            {/* 결제 안내 알림 — 접수가 '승인(결제대기)'되면 노출 */}
            {pendingPay.length ? (
                <div className="rounded-xl border-2 border-[#fb923c] bg-[#fff7ed] p-5">
                    <div className="mb-1 flex items-center gap-2">
                        <span className="text-lg">🔔</span>
                        <span className="text-[15px] font-bold text-[#9a3412]">결제 안내 — 접수가 승인되었습니다</span>
                    </div>
                    <p className="mb-3 mt-0 text-[13px] text-[#7c2d12]">아래 계좌로 입금해 주시면 확인 후 발행이 시작됩니다.</p>
                    <div className="grid gap-2">
                        {pendingPay.map((r) => {
                            const amt = deployAmountKRW(r, unitPrice);
                            return (
                                <div key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-[#fed7aa] bg-white px-3 py-2 text-[13px]">
                                    <span className="font-bold text-[#334155]">{r.company_name}</span>
                                    <span className="text-[#64748b]">발행 {r.total_count ?? r.selected_keywords?.length ?? '-'}건</span>
                                    <span className="ml-auto font-bold text-[#c2410c]">{amt > 0 ? `결제금액 ₩${amt.toLocaleString('ko-KR')}` : '결제금액 담당자 안내'}</span>
                                </div>
                            );
                        })}
                    </div>
                    <div className="mt-3 rounded-lg bg-white/70 p-3 text-[13px]">
                        <div className="flex items-center gap-1.5">
                            <span className="rounded bg-[#c2410c] px-1.5 py-0.5 text-[10px] font-bold text-white">계좌이체</span>
                            <span className="font-semibold text-[#9a3412]">입금 계좌</span>
                        </div>
                        <div className="mt-1 text-[#334155]">
                            <b>{PAYMENT_INFO.bank} {PAYMENT_INFO.account}</b> <span className="text-[#64748b]">(예금주 {PAYMENT_INFO.holder})</span>
                        </div>
                        {PAYMENT_INFO.cardAvailable ? (
                            <div className="mt-1.5 flex items-center gap-1.5 border-t border-[#fed7aa] pt-1.5">
                                <span className="rounded bg-[#e2e8f0] px-1.5 py-0.5 text-[10px] font-bold text-[#475569]">카드결제</span>
                                <span className="text-[12px] text-[#64748b]">{PAYMENT_INFO.cardNote}</span>
                            </div>
                        ) : null}
                        {/* 결제 완료 알림 — 누르면 우리쪽에 접수(담당자가 실제 입금/카드 내역 확인 후 토큰 지급) */}
                        <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-[#fed7aa] pt-2">
                            <span className="text-[12px] font-semibold text-[#9a3412]">결제하셨나요?</span>
                            <button type="button" disabled={payBusy || !!payMsg} onClick={() => void notifyPaid('계좌이체')}
                                className="rounded-md bg-[#c2410c] px-3 py-1.5 text-[12px] font-bold text-white hover:bg-[#9a3412] disabled:opacity-50">
                                계좌이체 완료
                            </button>
                            {PAYMENT_INFO.cardAvailable ? (
                                <button type="button" disabled={payBusy || !!payMsg} onClick={() => void notifyPaid('카드결제')}
                                    className="rounded-md border border-[#c2410c] bg-white px-3 py-1.5 text-[12px] font-bold text-[#c2410c] hover:bg-[#fff7ed] disabled:opacity-50">
                                    카드결제 완료
                                </button>
                            ) : null}
                            {payMsg ? <span className="text-[12px] font-semibold text-[#166534]">{payMsg}</span> : null}
                        </div>
                        <div className="mt-1 text-[11px] text-[#94a3b8]">‘완료’를 누르면 담당자에게 결제 확인 요청이 접수되고, 실제 입금/카드 내역 확인 후 발행 토큰이 지급됩니다.</div>
                    </div>
                </div>
            ) : null}

            {/* 접수 폼 */}
            <div className="rounded-xl border border-[#e2e8f0] bg-white p-5">
                <div className="mb-1 text-[15px] font-bold text-[#0f172a]">카페 배포 접수</div>
                <p className="mb-4 mt-0 text-[13px] text-[#64748b]">배포를 원하시는 내용과 사진을 접수해 주세요. 담당자 확인 후 세팅해 드립니다. (금액·정산은 별도 안내)</p>

                {/* ① 배포 종류 → ② (인기탭일 때만) 키워드 잡는 방식.
                    한 줄에 3개를 늘어놓으면 '인기탭을 따지는지'가 안 보여 고객이 헷갈린다.
                    일반 배포는 그 자리에서 키워드 입력으로 끝난다(고를 게 없음). */}
                <div data-tour="cafe-deploy-type" className="mb-4">
                    <label className={labelCls}>배포 종류</label>
                    <div className="inline-flex rounded-lg border border-[#cbd5e1] p-0.5">
                        {([['일반 배포', '직접형'], ['인기탭 배포', '지역형']] as const).map(([name, dt]) => {
                            const on = name === '일반 배포' ? isManual : !isManual;
                            return (
                                <button key={name} type="button" onClick={() => set('deploy_type', dt)}
                                    className={`rounded-md px-4 py-1.5 text-sm font-bold ${on ? 'bg-[#4338ca] text-white' : 'text-[#64748b] hover:text-[#334155]'}`}>
                                    {name}
                                </button>
                            );
                        })}
                    </div>
                    <p className="mb-0 mt-1 text-[11px] text-[#94a3b8]">
                        {isManual
                            ? '일반 배포 — 인기탭을 따지지 않고, 적어 주신 키워드 그대로 발행합니다.'
                            : '인기탭 배포 — 실제 인기글 섹션에 들어갈 수 있는 키워드만 골라 발행합니다.'}
                    </p>

                    {!isManual ? (
                        <div className="mt-3">
                            <label className={labelCls}>키워드 잡는 방식</label>
                            <div className="inline-flex rounded-lg border border-[#cbd5e1] p-0.5">
                                {([['지역형', '지역형'], ['키워드형', '키워드형'], ['직접입력형', '인기직접형'], ['연관형', '연관형'], ['🌐 정보형', '정보형']] as const).map(([name, dt]) => (
                                    <button key={dt} type="button" onClick={() => set('deploy_type', dt)}
                                        className={`rounded-md px-4 py-1.5 text-sm font-bold ${form.deploy_type === dt ? 'bg-[#4338ca] text-white' : 'text-[#64748b] hover:text-[#334155]'}`}>
                                        {name}
                                    </button>
                                ))}
                            </div>
                            <p className="mb-0 mt-1 text-[11px] text-[#94a3b8]">
                                {isInfo ? '정보형 — 홈페이지·네이버 블로그 주소만 넣으면 글에서 제품키워드를 뽑아 인기탭을 찾습니다. 플레이스가 없어도 됩니다.'
                                    : isKw ? '키워드형 — 플레이스 주소 기반으로 키워드를 잡습니다(맛집 등).'
                                    : isRelated ? '연관형 — 대표 단어 하나(예: 보홀 · 장기요양)만 넣으면 연관 키워드를 펼쳐 인기탭을 찾습니다. 플레이스·지역 없이도 됩니다.'
                                    : isPopManual ? '직접입력형 — 원하시는 키워드를 직접 적으면, 인기탭이 확인된 것만 골라 드립니다.'
                                    : '지역형 — 지역 선택 + 제품키워드(예: 입주청소·상가청소)로 지역+키워드를 잡습니다.'}
                            </p>
                        </div>
                    ) : null}

                    {/* 인기탭 배포 · 직접입력형 — 키워드 칩으로 모아 두고 한 번에 인기탭 판정 */}
                    {/* 연관형 — 씨앗어 하나로 전국형·지역형 인기탭을 한 번에 훑는다.
                        실측(2026-08-07): 보홀 35건(154,370) · 창업 20건(311,780) · 장기요양은
                        전국형 간병인업체 + 지역형 간병인(지역 붙이면 46건). 업종에 따라 정답이 갈려
                        둘 다 시도한다. */}
                    {isRelated ? (
                        <div className="mt-3 rounded-md border border-dashed border-[#c4b5fd] bg-[#faf5ff] px-3 py-2">
                            <div className="flex gap-2">
                                <input className={inputCls} value={seed} onChange={(e) => setSeed(e.target.value)}
                                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void runExpandSeed(); } }}
                                    placeholder="대표 단어 하나 (예: 보홀 · 장기요양 · 골프 · 창업)" />
                                <button type="button" onClick={() => void runExpandSeed()} disabled={extracting || kwLoading}
                                    className="h-10 shrink-0 rounded-md bg-[#6d28d9] px-4 text-sm font-bold text-white disabled:opacity-50">
                                    {extracting ? '조회 중…' : '① 연관어 펼치기'}
                                </button>
                            </div>
                            {/* 캐시 우선 — 스캔 없이 이미 확인된 것. 여기서 충분하면 스캔이 필요 없다. */}
                            {cachedHits && cachedHits.length ? (
                                <div className="mt-2 rounded-md border border-[#16a34a] bg-[#f0fdf4] p-2">
                                    <div className="mb-1 flex flex-wrap items-center gap-2 text-[12px] font-bold text-[#15803d]">
                                        <span>✅ 이미 확인된 인기탭 {cachedHits.length}건 <span className="font-normal">— <b>{cachedVia.join(' · ')}</b> 로 찾은 것입니다</span></span>
                                        <button type="button" onClick={() => { setKwResult(cachedHits); setKwErr(''); }}
                                            className="rounded bg-[#16a34a] px-2.5 py-0.5 text-[11px] font-bold text-white">아래 목록으로 가져오기</button>
                                    </div>
                                    <div className="flex max-h-24 flex-wrap gap-1.5 overflow-y-auto">
                                        {cachedHits.slice(0, 40).map((h) => (
                                            <span key={h.keyword} className="rounded-full border border-[#86efac] bg-white px-2 py-0.5 text-[11px] font-semibold text-[#15803d]">
                                                {h.keyword}<span className="ml-1 font-normal opacity-60">{(h.volume ?? 0).toLocaleString()}</span>
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            ) : null}
                            {relCands ? (
                                <div className="mt-2 rounded-md border border-[#ddd6fe] bg-white p-2">
                                    <div className="mb-1.5 flex flex-wrap items-center gap-2 text-[12px] font-bold text-[#6d28d9]">
                                        <span>② 확인할 키워드 ({relPicked.size}/{relCands.length})</span>
                                        <div className="inline-flex rounded-md border border-[#c4b5fd] p-0.5">
                                            {([['seed', `"${seed.trim()}" 포함 · 확실`], ['near', '연관어 · 확인 필요'], ['far', '전체 · 무관 섞임']] as const).map(([t, lbl]) => (
                                                <button key={t} type="button" onClick={() => setRelTier(t)}
                                                    className={`rounded px-2 py-0.5 text-[11px] font-bold ${relTier === t ? 'bg-[#6d28d9] text-white' : 'text-[#6d28d9]'}`}>{lbl}</button>
                                            ))}
                                        </div>
                                        {/* 보이는 층(relTier) 안에서 전체 선택/해제 — 237개를 하나씩 누를 수 없다. */}
                                        {(() => {
                                            const shown = relCands.filter((x) => (relTier === 'seed' ? x.tier === 'seed' : relTier === 'near' ? x.tier !== 'far' : true)).slice(0, 200);
                                            const allOn = shown.length > 0 && shown.every((x) => relPicked.has(x.kw));
                                            return (
                                                <button type="button"
                                                    onClick={() => {
                                                        const n = new Set(relPicked);
                                                        shown.forEach((x) => (allOn ? n.delete(x.kw) : n.add(x.kw)));
                                                        setRelPicked(n);
                                                    }}
                                                    className="rounded border border-[#c4b5fd] px-2 py-0.5 text-[11px] font-bold text-[#6d28d9]">
                                                    {allOn ? `보이는 ${shown.length}개 해제` : `보이는 ${shown.length}개 전체 선택`}
                                                </button>
                                            );
                                        })()}
                                        <span className="font-normal text-[#94a3b8]">◆ = 인기글 가능성 높음(자동 체크)</span>
                                    </div>
                                    <div className="flex max-h-56 flex-wrap gap-1.5 overflow-y-auto">
                                        {relCands
                                            .filter((x) => (relTier === 'seed' ? x.tier === 'seed' : relTier === 'near' ? x.tier !== 'far' : true))
                                            .slice(0, 200)
                                            .map((x) => (
                                                <label key={x.kw} className={`flex cursor-pointer items-center gap-1 rounded-full border px-2.5 py-1 text-[12px] font-semibold ${relPicked.has(x.kw) ? 'border-[#6d28d9] bg-[#f5f3ff] text-[#5b21b6]' : 'border-[#cbd5e1] bg-white text-[#64748b]'}`}>
                                                    <input type="checkbox" className="h-3 w-3 accent-[#6d28d9]" checked={relPicked.has(x.kw)}
                                                        onChange={() => { const n = new Set(relPicked); if (n.has(x.kw)) n.delete(x.kw); else n.add(x.kw); setRelPicked(n); }} />
                                                    {x.kw}
                                                    <span className="text-[10px] font-normal opacity-60">{x.total.toLocaleString()}</span>
                                                    {x.intent ? <span className="text-[10px] text-[#16a34a]">◆</span> : null}
                                                </label>
                                            ))}
                                    </div>
                                    <div className="mt-2 flex items-center gap-2">
                                        <button type="button" onClick={() => void runRelatedScan()} disabled={kwLoading || !relPicked.size}
                                            className="h-9 shrink-0 rounded-md bg-[#7c3aed] px-4 text-sm font-bold text-white disabled:opacity-50">
                                            {kwLoading ? '찾는 중…' : '③ 인기탭 찾기'}
                                        </button>
                                        <span className="text-[11px] text-[#64748b]">
                                            {relPicked.size > REL_MAX
                                                ? `⚠ 한 번에 ${REL_MAX}개까지 확인됩니다 — ${relPicked.size - REL_MAX}개는 이번에 안 재집니다.`
                                                : `${relPicked.size}개 확인 · 약 ${Math.max(1, Math.ceil(relPicked.size * 2.5 / 60))}분 소요. 지역을 붙여야 나오는 업종이면 그것도 알려 드립니다.`}
                                        </span>
                                    </div>
                                </div>
                            ) : null}
                            {relRegional.length ? (
                                <div className="mt-2 rounded-md border border-[#f59e0b] bg-[#fffbeb] p-2">
                                    <div className="mb-1 text-[12px] font-bold text-[#b45309]">
                                        📍 지역을 붙여야 나오는 키워드 {relRegional.length}건
                                    </div>
                                    {relRegional.map((r) => (
                                        <div key={r.keyword} className="flex flex-wrap items-center gap-2 rounded border border-[#fde68a] bg-white px-2 py-1 text-[12px]">
                                            <b className="text-[#b45309]">{r.keyword}</b>
                                            <span className="text-[#94a3b8]">{r.theme}</span>
                                            {r.sample?.length ? <span className="text-[11px] text-[#64748b]">예: {r.sample.join(' · ')}</span> : null}
                                        </div>
                                    ))}
                                    <p className="mb-0 mt-1 text-[11px] text-[#a16207]">
                                        이 키워드는 <b>지역형</b>으로 접수하시면 지역별 전수로 찾아 드립니다(위에서 ‘지역형’ 선택 후 제품키워드로 입력).
                                    </p>
                                </div>
                            ) : null}
                        </div>
                    ) : null}

                    {isPopManual ? (
                        <div className="mt-3 rounded-md border border-dashed border-[#a5b4fc] bg-[#eef2ff] px-3 py-2">
                            <div className="flex gap-2">
                                <input className={inputCls} value={form.keyword}
                                    onChange={(e) => set('keyword', e.target.value)}
                                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addPopManualKw(); } }}
                                    placeholder="발행하고 싶은 키워드 (예: 강남 누수탐지 — 입력 후 엔터/추가 · 최대 50개)" />
                                <button type="button" onClick={addPopManualKw}
                                    className="h-10 shrink-0 rounded-md bg-[#4338ca] px-4 text-sm font-bold text-white hover:bg-[#3730a3]">추가</button>
                                <button type="button" onClick={() => void checkPopManual()} disabled={kwLoading}
                                    className="h-10 shrink-0 rounded-md bg-[#7c3aed] px-4 text-sm font-bold text-white hover:bg-[#6d28d9] disabled:opacity-50">
                                    {kwLoading ? '확인 중…' : '인기탭 확인'}
                                </button>
                            </div>
                            {popManualKws.length ? (
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                    {popManualKws.map((k) => (
                                        <span key={k} className="inline-flex items-center gap-1 rounded-full border border-[#c7d2fe] bg-white px-2.5 py-1 text-[12px] font-semibold text-[#3730a3]">
                                            {k}
                                            <button type="button" onClick={() => setPopManualKws((prev) => prev.filter((x) => x !== k))}
                                                className="text-[#94a3b8] hover:text-[#ef4444]" title="제외">×</button>
                                        </span>
                                    ))}
                                </div>
                            ) : null}
                            <p className="mb-0 mt-1.5 text-[11px] text-[#6366f1]">
                                {popManualKws.length
                                    ? `${popManualKws.length}개 입력됨 — '인기탭 확인'을 누르면 실제 인기글 섹션이 있는 것만 아래에 남습니다.`
                                    : '인기탭이 없는 키워드는 결과에서 빠집니다. 인기탭 상관없이 그대로 발행하시려면 위에서 ‘일반 배포’를 고르세요.'}
                            </p>
                        </div>
                    ) : null}
                </div>

                <div data-tour="cafe-deploy-basic" className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <div className="md:col-span-2">
                        <label className={labelCls}>업체명 *</label>
                        <input className={inputCls} value={form.company_name} onChange={(e) => set('company_name', e.target.value)} placeholder="test" />
                    </div>
                    {!isManual ? (
                        <div className="md:col-span-2">
                            <label className={labelCls}>{isKw ? '플레이스 주소 (URL) *' : '홈페이지 (선택)'}</label>
                            <div className="flex gap-2">
                                <input className={inputCls} value={form.url} onChange={(e) => set('url', e.target.value)} placeholder={isKw ? 'https://naver.me/... 또는 place.naver.com/...' : 'www.homepage.com'} />
                                {isKw ? (
                                    <button type="button" onClick={() => void runPlaceScan()} disabled={kwLoading} className="h-10 shrink-0 rounded-md bg-[#7c3aed] px-4 text-sm font-bold text-white hover:bg-[#6d28d9] disabled:opacity-50" title="워커가 실제 인기글 섹션을 확인(수초~수십초)">
                                        {kwLoading ? '분석 중…' : '정확 인기탭 분석'}
                                    </button>
                                ) : null}
                            </div>
                            {isKw ? <p className="mb-0 mt-1 text-[11px] text-[#94a3b8]">정확 인기탭 분석=실제 인기글 섹션 확인(큐 처리, 수초~수십초).</p> : null}
                            {isKw ? (
                                <details open className="mt-2 rounded-md border border-dashed border-[#c4b5fd] bg-[#faf5ff] px-3 py-2">
                                    <summary className="cursor-pointer text-[12px] font-bold text-[#6d28d9]">📋 상세 정보 입력 — 플레이스에 메뉴·정보가 없을 때 (여기에 붙여넣으면 접수에 저장)</summary>
                                    <textarea className="mt-2 w-full rounded-md border border-[#cbd5e1] px-3 py-2 text-sm outline-none focus:border-[#7c3aed]" rows={4}
                                        value={placeDetail} onChange={(e) => setPlaceDetail(e.target.value)}
                                        placeholder={'플레이스 정보·메뉴·홈 소개글, 취급 서비스/상품을 그대로 붙여넣으세요. 담당자가 키워드 선정에 활용합니다.\n예)\n입주청소\n이사청소\n준공청소'} />
                                    <p className="mb-0 mt-1 text-[11px] text-[#94a3b8]">접수 시 비고에 [상세정보]로 함께 저장됩니다.</p>
                                </details>
                            ) : null}
                            {isKw ? kwPanel : null}
                        </div>
                    ) : null}
                    {isRegionLike ? (
                        <div className="md:col-span-2">
                            <label className={labelCls}>지역 선택 (복수)</label>
                            <div className="flex flex-wrap gap-2">
                                {REGION_KEYS.map((r) => (
                                    <button key={r} type="button" onClick={() => toggleRegion(r)}
                                        className={`rounded-full border px-3 py-1 text-sm font-semibold ${regionSel.includes(r) ? 'border-[#4338ca] bg-[#4338ca] text-white' : 'border-[#cbd5e1] bg-white text-[#475569]'}`}>
                                        {r}
                                    </button>
                                ))}
                            </div>
                            {/* 플레이스가 없는 업체용 — 위치를 직접 적고 소개/메뉴를 붙여넣으면 제품키워드를 만들어 준다. */}
                            {/* 기본 펼침 — 접어 두면 고객이 찾지를 못한다(주소 입력이 이제 주된 접수 경로다). */}
                            {isInfo ? (
                            <div className="mt-2 rounded-md border border-dashed border-[#c4b5fd] bg-[#faf5ff] px-3 py-2">
                                <div className="text-[12px] font-bold text-[#6d28d9]">🌐 홈페이지·블로그 주소 → 키워드 → 인기탭</div>
                                <div className="mt-2 grid gap-2">
                                    <input className={inputCls} value={ownAddr} onChange={(e) => setOwnAddr(e.target.value)}
                                        placeholder="위치 (예: 전북 군산시 옥도면 선유남길 19-9 — 읍·면·도로명까지 적으면 더 정확)" />
                                    {/* 주소 한 줄로 원문을 걷는 경로 — 고객에게 붙여넣기를 시키면 대부분 인사말만 넣는다. */}
                                    <div className="flex flex-wrap items-center gap-2">
                                        <textarea className="min-h-[38px] w-full min-w-[220px] flex-1 rounded-md border border-[#cbd5e1] px-3 py-2 text-sm outline-none focus:border-[#7c3aed]" rows={2}
                                            value={siteUrl} onChange={(e) => setSiteUrl(e.target.value)}
                                            placeholder={'홈페이지·네이버 블로그 주소 — 여러 개면 줄바꿈으로\nblog.naver.com/내블로그\n우리회사.co.kr'} />
                                        <button type="button" onClick={() => void pullSite()} disabled={extracting || kwLoading}
                                            className="h-9 shrink-0 rounded-md border border-[#6d28d9] bg-white px-3 text-sm font-bold text-[#6d28d9] disabled:opacity-50"
                                            title="블로그면 글 제목 전량을, 홈페이지면 하위 페이지까지 가져와 아래 칸에 합쳐 넣습니다">
                                            ⬇ 주소로 가져오기
                                        </button>
                                    </div>
                                    <p className="mb-0 -mt-1 text-[11px] text-[#7c3aed]">
                                        💡 <b>블로그와 홈페이지를 같이 넣으세요</b> — 각각 넣을 때보다 키워드가 훨씬 많이 나옵니다.
                                        하나만 있다면 블로그 쪽이 더 정확합니다.
                                    </p>
                                    <textarea className="w-full rounded-md border border-[#cbd5e1] px-3 py-2 text-sm outline-none focus:border-[#7c3aed]" rows={4}
                                        value={placeDetail} onChange={(e) => setPlaceDetail(e.target.value)}
                                        placeholder={'업체 소개글·메뉴·서비스 설명을 그대로 붙여넣으세요(홈페이지 통째로 넣어도 됩니다).\n예)\n저희는 20년 경력의 누수탐지 전문업체로 아파트 배관 누수, 바닥 난방배관 누수를 정밀 장비로 찾아드립니다.'} />
                                    <div className="flex items-center gap-2">
                                        <button type="button" onClick={() => void runExtract()} disabled={extracting || kwLoading}
                                            className="h-9 shrink-0 rounded-md bg-[#6d28d9] px-4 text-sm font-bold text-white disabled:opacity-50">{extracting ? '추출 중…' : '① 키워드 뽑기'}</button>
                                        <span className="text-[11px] text-[#6d28d9]">뽑힌 키워드를 확인·수정해 제품키워드로 추가한 뒤 ‘지역 키워드 생성’을 누르세요.</span>
                                    </div>
                                    {extracted ? (
                                        <div className="rounded-md border border-[#ddd6fe] bg-white p-2">
                                            <div className="mb-1 flex items-center gap-2 text-[12px] font-bold text-[#6d28d9]">
                                                <span>② 쓸 키워드만 체크 ({picked.size}/{extracted.length})</span>
                                                <button type="button" className="rounded border border-[#c4b5fd] px-2 py-0.5 text-[11px] font-semibold text-[#6d28d9]"
                                                    onClick={() => setPicked(picked.size === extracted.length ? new Set() : new Set(extracted.map((x) => x.kw)))}>
                                                    {picked.size === extracted.length ? '전체 해제' : '전체 선택'}
                                                </button>
                                            </div>
                                            <div className="flex flex-wrap gap-1.5">
                                                {extracted.map((x) => (
                                                    <label key={x.kw} className={`flex cursor-pointer items-center gap-1 rounded-full border px-2.5 py-1 text-[12px] font-semibold ${picked.has(x.kw) ? 'border-[#6d28d9] bg-[#f5f3ff] text-[#5b21b6]' : 'border-[#cbd5e1] bg-white text-[#64748b]'}`}>
                                                        <input type="checkbox" className="h-3 w-3 accent-[#6d28d9]" checked={picked.has(x.kw)}
                                                            onChange={() => { const n = new Set(picked); if (n.has(x.kw)) n.delete(x.kw); else n.add(x.kw); setPicked(n); }} />
                                                        {x.kw}
                                                        <span className="text-[10px] font-normal opacity-60">{x.kind === 'core' ? '대표' : x.kind === 'niche' ? '세부' : '메뉴'}</span>
                                                    </label>
                                                ))}
                                            </div>
                                            <button type="button" onClick={confirmExtracted} disabled={!picked.size}
                                                className="mt-2 h-9 rounded-md bg-[#4338ca] px-4 text-sm font-bold text-white disabled:opacity-50">③ 제품키워드로 추가</button>
                                        </div>
                                    ) : null}
                                </div>
                            </div>
                            ) : null}
                        </div>
                    ) : null}
                    {/* 인기탭·직접입력형은 위 전용 블록에서 키워드를 이미 받는다 — 같은 입력칸을 두 번 보이지 않게 숨긴다. */}
                    <div className={`md:col-span-2 ${isPopManual || isRelated ? 'hidden' : ''}`}>
                        <label className={labelCls}>{isKw ? '키워드' : isManual ? '발행 키워드 (직접 입력)' : '제품 키워드 (업종)'}</label>
                        <div className="flex gap-2">
                            <input className={inputCls} value={form.keyword}
                                onChange={(e) => set('keyword', e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter' && (isRegionLike || isManual)) { e.preventDefault(); if (isManual) addManualKw(); else addProductKw(); } }}
                                placeholder={isKw ? '예: 광교 횟집' : isManual ? '예: 강남 누수탐지 (입력 후 엔터/추가 · 최대 50개)' : '예: 입주청소 (입력 후 엔터/추가)'} />
                            {isManual ? (
                                <button type="button" onClick={addManualKw} className="h-10 shrink-0 rounded-md bg-[#4338ca] px-4 text-sm font-bold text-white hover:bg-[#3730a3]">추가</button>
                            ) : isRegionLike ? (
                                <>
                                    <button type="button" onClick={addProductKw} className="h-10 shrink-0 rounded-md bg-[#4338ca] px-4 text-sm font-bold text-white hover:bg-[#3730a3]">추가</button>
                                    <button type="button" onClick={() => void genRegionKeywords()} disabled={kwLoading} className="h-10 shrink-0 rounded-md bg-[#7c3aed] px-4 text-sm font-bold text-white hover:bg-[#6d28d9] disabled:opacity-50" title="선택 지역(서울/경기/인천)의 행정구 × 제품키워드 칩으로 발행 대상 키워드 생성">
                                        {kwLoading ? '생성 중…' : '지역 키워드 생성'}
                                    </button>
                                </>
                            ) : null}
                        </div>
                        {isRegionLike && productKws.length ? (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                                {productKws.map((kw) => (
                                    <span key={kw} className="inline-flex items-center gap-1 rounded-full bg-[#eef2ff] px-2.5 py-1 text-[12px] font-semibold text-[#3730a3] ring-1 ring-[#c7d2fe]">
                                        {kw}
                                        <button type="button" onClick={() => removeProductKw(kw)} className="text-[#818cf8] hover:text-[#4338ca]">×</button>
                                    </span>
                                ))}
                            </div>
                        ) : null}
                        {isRegionLike ? <p className="mb-0 mt-1 text-[11px] text-[#94a3b8]">제품키워드를 여러 개 추가하면, 아래 선택한 지역의 행정구마다 각 키워드로 인기탭을 찾습니다. 예: [누수탐지·누수] × 서울·경기 → 강남 누수탐지, 수원 누수 …</p> : null}
                        {isManual ? <p className="mb-0 mt-1 text-[11px] text-[#94a3b8]">입력한 키워드가 아래 '선택한 발행 키워드'에 그대로 담깁니다 — 인기탭 확인 없이 접수됩니다(최대 50개).</p> : null}
                        {/* ⚠️ 이 블록은 직접입력형·연관형일 때 hidden 이다(입력칸 중복 방지).
                            결과 패널까지 같이 숨으면 '인기탭 확인'을 눌러도 아무 반응이 없어 보인다
                            (실제 증상 2026-08-07). 그 두 모드의 결과는 아래 별도 위치에서 그린다. */}
                        {!isKw && !isPopManual && !isRelated ? kwPanel : null}
                    </div>
                    {/* 직접입력형·연관형 결과 — 위 블록이 숨겨져 있으므로 여기서 따로 보여준다. */}
                    {isPopManual || isRelated ? <div className="md:col-span-2">{kwPanel}</div> : null}
                    <div>
                        <label className={labelCls}>미션 시작일</label>
                        <input className={inputCls} type="date" value={form.mission_start} onChange={(e) => set('mission_start', e.target.value)} />
                    </div>
                    <div>
                        <label className={labelCls}>일 발행건수 <span className="font-normal text-[#94a3b8]">(최대 5)</span></label>
                        <input className={inputCls} type="number" min={0} max={5} value={form.daily_count ?? ''}
                            onChange={(e) => set('daily_count', e.target.value === '' ? null : Math.min(5, Math.max(0, Number(e.target.value))))}
                            placeholder="최대 5건" />
                    </div>
                    <div>
                        <label className={labelCls}>총 발행건수 <span className="font-normal text-[#94a3b8]">(제한 없음)</span></label>
                        <input className={inputCls} type="number" min={0} value={form.total_count ?? ''} onChange={(e) => set('total_count', e.target.value === '' ? null : Math.max(0, Number(e.target.value)))} placeholder="0건" />
                    </div>
                    <div>
                        <label className={labelCls}>상품종류</label>
                        <input className={`${inputCls} bg-[#f8fafc] text-[#64748b]`} value={PRODUCT_FIXED} readOnly disabled />
                    </div>
                    <div className="md:col-span-2">
                        <label className={labelCls}>비고</label>
                        <textarea className="min-h-[72px] w-full rounded-md border border-[#cbd5e1] px-3 py-2 text-sm outline-none focus:border-[#4338ca]" value={form.note} onChange={(e) => set('note', e.target.value)} placeholder="test" />
                    </div>
                </div>

                {/* 카페 발행 정보 (대신 발행용) */}
                <div data-tour="cafe-deploy-account" className="mt-4 rounded-lg border border-[#e2e8f0] bg-[#fafaff] p-4">
                    <div className="mb-0.5 text-[13px] font-bold text-[#334155]">카페 발행 정보 <span className="text-[#94a3b8]">(대신 발행용)</span></div>
                    <p className="mb-3 mt-0 text-[12px] text-[#94a3b8]">저희가 대신 발행하기 위해 필요합니다. 네이버 비밀번호는 안전하게 보관되며 화면엔 표시되지 않습니다.</p>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                        <div>
                            <label className={labelCls}>네이버 아이디</label>
                            <input className={inputCls} value={form.naver_id ?? ''} onChange={(e) => set('naver_id', e.target.value)} autoComplete="off" placeholder="test" />
                        </div>
                        <div>
                            <label className={labelCls}>네이버 비밀번호 🔒</label>
                            <input className={inputCls} type="password" value={form.naver_pw ?? ''} onChange={(e) => set('naver_pw', e.target.value)} autoComplete="new-password" placeholder="••••••" />
                        </div>
                        <div>
                            <label className={labelCls}>발행 카페명</label>
                            <input className={inputCls} value={form.cafe_name ?? ''} onChange={(e) => set('cafe_name', e.target.value)} placeholder="test" />
                        </div>
                        <div>
                            <label className={labelCls}>발행 게시판</label>
                            <input className={inputCls} value={form.board_name ?? ''} onChange={(e) => set('board_name', e.target.value)} placeholder="test" />
                        </div>
                        <div className="md:col-span-2">
                            <label className="flex cursor-pointer items-center gap-2 text-sm text-[#334155]">
                                <input type="checkbox" checked={!!form.two_factor} onChange={(e) => set('two_factor', e.target.checked)} className="h-4 w-4 accent-[#4338ca]" />
                                네이버 2단계(2차) 인증을 사용 중입니다
                                <span className="text-[11px] text-[#94a3b8]">(사용 중이면 자동 로그인에 추가 확인이 필요합니다)</span>
                            </label>
                        </div>
                    </div>
                </div>

                {/* 사진 전달 — 3종 업로드 */}
                <div data-tour="cafe-deploy-photos" className="mt-4">
                    <label className={labelCls}>사진 전달 (업로드 시 자동 압축)</label>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                        {GROUPS.map((g) => (
                            <div key={g.key} className="rounded-lg border border-dashed border-[#cbd5e1] bg-[#f8fafc] p-3">
                                <div className="mb-2 flex items-center justify-between">
                                    <span className="text-[13px] font-semibold text-[#334155]">{g.label}</span>
                                    <label className="cursor-pointer rounded-md bg-[#eef2ff] px-2 py-1 text-xs font-bold text-[#4338ca] hover:bg-[#e0e7ff]">
                                        + 추가
                                        <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => { addFiles(g.key, e.target.files); e.target.value = ''; }} />
                                    </label>
                                </div>
                                {files[g.key].length === 0 ? (
                                    <div className="py-4 text-center text-xs text-[#94a3b8]">사진 없음</div>
                                ) : (
                                    <div className="flex flex-wrap gap-2">
                                        {files[g.key].map((f, i) => (
                                            <div key={i} className="relative">
                                                <img src={URL.createObjectURL(f)} alt="" className="h-14 w-14 rounded object-cover" />
                                                <button type="button" onClick={() => removeFile(g.key, i)} className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-[#dc2626] text-[11px] font-bold text-white">×</button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>

                {/* 키워드 미입력 확인 — 총 발행건수보다 적게 고른 경우: 직접 고르기 / 담당자에게 맡기기 */}
                {remainAsk !== null ? (
                    <div className="mt-4 rounded-xl border-2 border-[#fb923c] bg-[#fff7ed] p-4">
                        <div className="flex items-center gap-2 text-[14px] font-bold text-[#9a3412]">
                            <span>⚠️</span> 키워드 {remainAsk}건이 아직 선택되지 않았습니다
                        </div>
                        <p className="mb-3 mt-1 text-[13px] leading-relaxed text-[#7c2d12]">
                            총 발행 {form.total_count}건 중 <b>{kwPicked.length}건</b>만 키워드를 고르셨습니다. 나머지 <b>{remainAsk}건</b>의 키워드를 어떻게 할까요?
                        </p>
                        <div className="flex flex-wrap gap-2">
                            <button type="button" onClick={() => setRemainAsk(null)}
                                className="h-10 rounded-md border border-[#4338ca] bg-white px-5 text-sm font-bold text-[#4338ca] hover:bg-[#eef2ff]">
                                직접 고를게요 (돌아가서 선택)
                            </button>
                            <button type="button" disabled={busy} onClick={() => void doSubmit(true)}
                                className="h-10 rounded-md bg-[#c2410c] px-5 text-sm font-bold text-white hover:bg-[#9a3412] disabled:opacity-50">
                                {busy ? '접수 중…' : `나머지 ${remainAsk}건은 맡길게요 (담당자가 선정)`}
                            </button>
                        </div>
                    </div>
                ) : null}

                <div className="mt-4 flex items-center gap-3">
                    <button data-tour="cafe-deploy-submit" className="h-10 rounded-md bg-[#4338ca] px-6 text-sm font-bold text-white hover:bg-[#3730a3] disabled:opacity-50" disabled={busy || !clientId} onClick={() => void submit()} type="button">
                        {busy ? '접수 중…' : `접수하기${totalFiles ? ` (사진 ${totalFiles})` : ''}`}
                    </button>
                    {msg && <span className="text-[13px] text-[#475569]">{msg}</span>}
                </div>
            </div>

            {/* 내 접수 목록 */}
            <div className="rounded-xl border border-[#e2e8f0] bg-white p-5">
                <div className="mb-3 text-[15px] font-bold text-[#0f172a]">내 접수 목록</div>
                {rows.length === 0 ? (
                    <div className="py-10 text-center text-sm text-[#94a3b8]">접수 내역이 없습니다.</div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[980px] border-collapse text-[13px]">
                            <thead>
                                <tr className="border-b border-[#e2e8f0] text-left text-[#64748b]">
                                    {['작성일', '업체명', '유형', 'URL', '키워드(업종)', '미션 시작일', '일 발행', '총 발행', '사진', '발행정보', '비고', '상태'].map((h) => (
                                        <th key={h} className="whitespace-nowrap px-2 py-2 font-semibold">{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map((r) => {
                                    const paths = r.photos ? [...r.photos.main, ...r.photos.real, ...r.photos.banner] : [];
                                    return (
                                        <tr key={r.id} className="border-b border-[#f1f5f9] align-top text-[#334155]">
                                            <td className="whitespace-nowrap px-2 py-2">{r.created_at.slice(0, 10)}</td>
                                            <td className="whitespace-nowrap px-2 py-2 font-semibold">{r.company_name}</td>
                                            <td className="max-w-[160px] truncate px-2 py-2" title={r.url ?? ''}>{r.url ? <a className="text-[#2563eb] underline" href={r.url} target="_blank" rel="noreferrer">{r.url}</a> : '-'}</td>
                                            <td className="whitespace-nowrap px-2 py-2">
                                                {/* 배포 종류가 먼저 보여야 한다 — 실적 집계 방식이 다르다(일반=발행 즉시 / 인기탭=5위 24h). */}
                                                <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${r.deploy_type === '직접형' ? 'bg-[#f1f5f9] text-[#475569]' : 'bg-[#dcfce7] text-[#15803d]'}`}>
                                                    {r.deploy_type === '직접형' ? '일반' : '인기탭'}
                                                </span>
                                                {r.deploy_type !== '직접형' ? (
                                                    <span className="ml-1 rounded-full bg-[#e0e7ff] px-2 py-0.5 text-[11px] font-bold text-[#4338ca]">
                                                        {r.deploy_type === '인기직접형' ? '직접입력형' : r.deploy_type === '연관형' ? '연관형' : (r.deploy_type ?? '지역형')}
                                                    </span>
                                                ) : null}
                                                {!r.deploy_type || r.deploy_type === '지역형' ? (r.region_sets?.length ? <div className="mt-0.5 text-[11px] text-[#64748b]">{r.region_sets.join('·')}</div> : null) : null}
                                            </td>
                                            <td className="px-2 py-2">
                                                <div className="whitespace-nowrap">{r.keyword ?? '-'}</div>
                                                {r.selected_keywords?.length ? (
                                                    <div className="mt-1 flex max-w-[200px] flex-wrap gap-1">
                                                        {r.selected_keywords.map((p) => (
                                                            <span key={p.keyword} className="rounded bg-[#eef2ff] px-1.5 py-0.5 text-[10px] font-semibold text-[#4338ca]" title={p.volume != null ? `검색량 ${p.volume.toLocaleString()}` : ''}>{p.keyword}</span>
                                                        ))}
                                                    </div>
                                                ) : null}
                                            </td>
                                            <td className="whitespace-nowrap px-2 py-2">{r.mission_start ?? '-'}</td>
                                            <td className="px-2 py-2 text-center">{r.daily_count ?? '-'}</td>
                                            <td className="px-2 py-2 text-center">{r.total_count ?? '-'}</td>
                                            <td className="px-2 py-2">
                                                {paths.length === 0 ? <span className="text-[#94a3b8]">-</span> : (
                                                    <div className="flex flex-wrap gap-1">
                                                        {paths.map((p) => (
                                                            <a key={p} href={urls[p] || '#'} target="_blank" rel="noreferrer" title={p.split('/').pop() ?? ''} download>
                                                                {urls[p]
                                                                    ? <img src={urls[p]} alt="" className="h-10 w-10 rounded border border-[#e2e8f0] object-cover hover:opacity-80" />
                                                                    : <span className="flex h-10 w-10 items-center justify-center rounded border border-[#e2e8f0] text-[10px] text-[#94a3b8]">…</span>}
                                                            </a>
                                                        ))}
                                                    </div>
                                                )}
                                            </td>
                                            <td className="px-2 py-2 text-[12px]">
                                                {(() => {
                                                    const cd = creds[r.id];
                                                    const hasCafe = r.cafe_name || r.board_name;
                                                    if (!hasCafe && !cd) return <span className="text-[#94a3b8]">-</span>;
                                                    return (
                                                        <div className="grid gap-0.5">
                                                            {r.cafe_name || r.board_name ? <div>{r.cafe_name ?? ''}{r.board_name ? ` · ${r.board_name}` : ''}</div> : null}
                                                            {cd ? <div className="text-[#64748b]">네이버 {cd.naver_id ?? '-'} · <span className="font-mono tracking-tight">••••</span></div> : null}
                                                            {r.two_factor ? <div className="text-[#b45309]">2단계 인증 사용</div> : null}
                                                        </div>
                                                    );
                                                })()}
                                            </td>
                                            <td className="max-w-[140px] truncate px-2 py-2" title={r.note ?? ''}>{r.note ?? '-'}</td>
                                            <td className="whitespace-nowrap px-2 py-2">
                                                <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${STATUS_STYLE[r.status] ?? 'bg-[#f1f5f9] text-[#64748b]'}`}>{r.status}</span>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}
