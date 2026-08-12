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
import { enqueuePlaceScan, pollPlaceScan, enqueueRegionScan, enqueueListScan, enqueueMenuScan, expandRelated, extractMenuKeywords, fetchSiteText, relatedStems, searchCachedPopular, getRegionGuTokens, getPopularFromCache, FIRST_TARGET, MORE_STEP, savePendingScan, savePendingProgress, clearPendingScan, loadPendingScan, peekScans, cancelScans, enqueueRecheckScan, getClientBrands, hasClientBrand, subCategories, loadPickedKw, savePickedKw, getProvenProducts, discoverSeeds, enqueueChainScan, SEED_OVERLAP_MIN, type ProvenProduct, type SeedCand, type PendingScan, type ExtractedProduct, type KwResult, type RelatedCand } from '../../api/cafeKwScan';
import { addToPool, loadPoolKw } from '../../api/cafeKwScan';
import { CafeKwPool } from './CafeKwPool';
import { requestCharge } from '../../api/cafeTokens';
import { downloadCsv, todayTag } from '../../lib/exportCsv';
import { useAuth } from '../../hooks/useAuth';
import { supabase } from '../../lib/supabase';

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
    // 업체명 — 보고 있는 '그 업체'의 이름이어야 한다.
    //   ★ 예전엔 profile.name(로그인한 사람 이름)만 썼다. 고객이 직접 로그인하면 그게 곧 업체명이라
    //     맞았지만, 담당자가 미리보기(?as=<client_id>)로 남의 화면을 볼 때는
    //     '장규진' 처럼 담당자 본인 이름이 업체명 칸에 박혔다(사장님 신고 2026-08-12).
    //     화면 데이터 자체는 clientId 스코프라 옳았고, 이 칸만 어긋난 것이다.
    //   그래서 clientId 로 clients.company 를 읽어 그 값을 우선한다. 못 읽으면 옛 동작으로 폴백.
    const [clientName, setClientName] = useState('');
    useEffect(() => {
        if (!clientId) { setClientName(''); return; }
        let alive = true;
        void (async () => {
            const { data } = await supabase.from('clients').select('company,advertiser_name').eq('id', clientId).maybeSingle();
            if (!alive) return;
            const c = data as { company?: string | null; advertiser_name?: string | null } | null;
            setClientName((c?.company || c?.advertiser_name || '').trim());
        })();
        return () => { alive = false; };
    }, [clientId]);
    const bizName = clientName || profile?.name || '';
    const [form, setForm] = useState<CafeDeployInput>({ ...empty, company_name: '' });
    // 업체명 자동기입 — 업체가 정해지면 그 업체명으로 채운다.
    //   ★ 이미 다른 업체 이름이 들어 있으면 덮어쓴다 — 업체를 바꿔 보는데 앞 업체명이 남아 있으면
    //     그대로 접수돼 남의 이름으로 발행된다. 사장님이 직접 고쳐 적은 값은 건드리지 않는다.
    const autoNameRef = useRef('');
    useEffect(() => {
        if (!bizName) return;
        setForm((f) => (!f.company_name || f.company_name === autoNameRef.current
            ? { ...f, company_name: bizName } : f));
        autoNameRef.current = bizName;
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
    // 지역이 없는 업체(보홀 다이빙투어·유학원 등) — 국내 지역축을 붙이지 않고 전국으로 판정한다.
    const [noRegion, setNoRegion] = useState(false);
    // 스캔 중단 — 사용자가 멈추면 다음 키워드로 안 넘어가고, 아직 대기 중인 요청은 취소한다.
    //   ★ 지역형은 제품키워드마다 요청을 따로 만든다(제품 25개 = 요청 25건). 그래서 '지금 도는 1건'만
    //     끝나고 나머지는 안 돈다. 진행 중(claimed)인 1건은 워커 루프라 중간에 못 끊는다.
    const stopRef = useRef(false);
    const liveIdsRef = useRef<number[]>([]);
    const [stopping, setStopping] = useState(false);
    const stopScan = async () => {
        stopRef.current = true;
        setStopping(true);
        const n = await cancelScans(liveIdsRef.current);
        setScanNote(`중단 중… 대기 ${n}건 취소`);
    };

    // 새로고침·이탈 후 복귀 — 저장해 둔 결과를 먼저 되살리고, 아직 도는 요청에 다시 붙는다.
    //   ★ 결과부터 복원한다: 예전엔 요청 id 만 남겨서 화면에 쌓여 있던 결과가 새로고침에 그대로 사라졌다.
    //     지역형은 요청이 키워드마다 따로라 마지막 1건만 남는 문제도 같이 있었다(이제 ids 전부).
    const [pending, setPending] = useState<PendingScan | null>(null);
    const [pendNote, setPendNote] = useState('');
    // ★ 폴링이 시간초과로 빠져도 여기에 다시 붙는다(2026-08-11).
    //   예전엔 이 효과가 '화면을 처음 열 때' 한 번만 돌아서, 25분 폴링이 끝나면
    //   워커는 계속 도는데 화면은 더 이상 안 채워졌다. 사장님이 새로고침을 해야 이어졌다.
    //   이제 시간초과 시 resumeTick 을 올려 같은 루프를 다시 태운다 — 켜두면 끝까지 자동이다.
    const [resumeTick, setResumeTick] = useState(0);
    useEffect(() => {
        const p = loadPendingScan();
        if (!p) return;
        const sortDedup = (arr: KwResult[]) => {
            const seen = new Set<string>(); const out: KwResult[] = [];
            for (const r of arr) { const nk = (r.keyword || '').replace(/\s/g, ''); if (seen.has(nk)) continue; seen.add(nk); out.push(r); }
            return out.sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0));
        };
        let acc = sortDedup(p.result);
        if (acc.length) { setKwResult(acc); setKwErr(`직전 스캔 결과 ${acc.length}건을 되살렸습니다${p.label ? ` — ${p.label}` : ''}.`); }
        if (!p.ids.length) return;   // 도는 건 없음 — 결과만 복원하고 끝
        setPending(p);
        let alive = true;
        void (async () => {
            let ids = p.ids;
            for (let i = 0; alive && i < 240; i++) {
                const s = await peekScans(ids);
                if (!alive) return;
                setPendNote(s.note);
                if (s.result.length) { acc = sortDedup([...acc, ...s.result]); setKwResult(acc); }
                ids = s.live;
                savePendingProgress(ids, acc);
                if (!ids.length) {
                    setKwErr(`이전 스캔 결과 ${acc.length}건을 불러왔습니다${p.label ? ` — ${p.label}` : ''}.`);
                    setPending(null); return;
                }
                setPending((cur) => (cur ? { ...cur, id: ids[0], ids } : cur));
                await new Promise((r) => setTimeout(r, 20000));
            }
        })();
        return () => { alive = false; };
    }, [resumeTick]);
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
                ? await Promise.all(lots.map((s) => extractMenuKeywords(s.text, hint, noRegion).catch(() => ({ biz: '', products: [] as ExtractedProduct[] }))))
                : [await extractMenuKeywords(raw, hint, noRegion)];
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
    // ★ 기본을 seed(씨앗어 포함)로 — near 기본이면 '창업'에 취업박람회·블로그·코인노래방 같은
    //   무관어가 섞인다(사장님 2026-08-11). 실측 993개 중 씨앗 미포함이 592개였다. 넓히려면 버튼으로.
    const [relTier, setRelTier] = useState<'seed' | 'near' | 'far'>('seed');
    // 씨앗 계열 필터 — 씨앗을 여러 개 넣으면 첫 씨앗이 목록을 뒤덮는다.
    //   실측 2026-08-11(창업+가맹+사업+프렌차이즈): 보이는 338개 중 창업이 263개(78%)라
    //   사장님이 '프렌차이즈·사업은 안 나온다'고 하셨다. 실제로는 있는데 파묻힌 것이었다.
    const [seedFilter, setSeedFilter] = useState('');   // '' = 전체
    const [subFilter, setSubFilter] = useState('');    // 2단 세부 분야('' = 전체)

    // '씨앗으로 끝나는 것만'(소자본창업·카페창업). 기본값은 씨앗별로 데이터가 정한다 —
    //   끝나는 게 더 많으면 켠다('창업' 끝230/앞67 → 켬, '보홀'은 보홀여행류가 많아 → 끔).
    const [endsOnly, setEndsOnly] = useState(false);
    const [relRegional, setRelRegional] = useState<(KwResult & { sample?: string[] })[]>([]);
    // 캐시 우선 — 이미 판정된 인기탭. 스캔 0회로 즉시 나온다.
    const [cachedHits, setCachedHits] = useState<KwResult[] | null>(null);
    const [cachedVia, setCachedVia] = useState<string[]>([]);   // 이 결과를 찾아낸 어간(씨앗어와 다를 수 있다)
    // ── 씨앗 발굴기 ──────────────────────────────────────────────────────────
    //   씨앗 하나로는 못 닿는다. 실측 2026-08-11: '창업' 993개 → 씨앗 8개 3,680개(3.7배).
    //   '무인창업' 하나가 767개를 새로 물어왔다. 감이 아니라 실측으로 고른다.
    //   ★ 연관어 조회는 검색광고 API 라 인기탭 차단 예산(CF)과 무관하다 — 넓혀도 위험이 없다.
    const [seedCands, setSeedCands] = useState<SeedCand[] | null>(null);
    const [seedPick, setSeedPick] = useState<Set<string>>(new Set());
    const [seedBusy, setSeedBusy] = useState('');
    const runDiscover = async () => {
        const s = seed.trim();
        if (!s) { setKwErr('먼저 대표 단어를 하나 넣으세요(예: 창업).'); return; }
        setKwErr(''); setSeedCands(null); setSeedPick(new Set()); setSeedBusy('시작…');
        try {
            const list = await discoverSeeds(s, (n) => setSeedBusy(n));
            setSeedCands(list);
            // 같은 시장(겹침 기준 통과)이면서 새로 물어오는 게 있는 것만 기본 체크.
            //   겹침이 낮은 건 남의 시장이라(블로그·코인노래방) 스캔만 늘린다.
            setSeedPick(new Set(list.filter((c) => c.overlap >= SEED_OVERLAP_MIN && c.fresh >= 50).map((c) => c.seed)));
        } catch (e) {
            setKwErr(e instanceof Error ? e.message : '씨앗 발굴 실패');
        } finally { setSeedBusy(''); }
    };
    // 목표 채우기 — 후보를 순서대로 끝까지 파서 목표 건수를 채운다(워커 process_chain).
    //   ★ 사장님 설계: 첫 키워드에서 다 채우면 오히려 좋다 — 제품 우선으로 깊게 판다.
    //     각 키워드의 '단독(지역 없음)' 판정도 맨 앞에서 같이 본다.
    //   regionsOverride: 적재함 패널이 자기 지역 칩으로 돌릴 때 쓴다(접수 폼의 지역과 별개).
    const runChain = async (products: string[], target = FIRST_TARGET, regionsOverride?: string[]) => {
        if (!products.length) { setKwErr('먼저 키워드가 있어야 합니다.'); return; }
        const sidos = regionsOverride?.length ? regionsOverride : (form.region_sets || []);
        if (!sidos.length) { setKwErr('지역을 하나 이상 고르세요.'); return; }
        setKwErr(''); setKwLoading(true); setScanNote('목표 채우기 시작…'); setScanTarget(target);
        lastScanRef.current = { kind: 'chain', products };
        // 누적이므로 직전 저장분을 지우지 않는다 — 지우면 이 시점에 새로고침한 사장님이 앞선 결과를 잃는다.
        //   savePendingScan 은 기존 기록 위에 이어 붙인다.
        try {
            const { id, error } = await enqueueChainScan(products, sidos.join(','), target);
            if (error || !id) throw new Error(error?.message || '등록 실패');
            savePendingScan(id, 'chain', `목표 ${target}건 · ${products.slice(0, 3).join(', ')}${products.length > 3 ? ` 외 ${products.length - 3}` : ''}`);
            const { result } = await pollPlaceScan(id, { timeoutSec: 1500, onPartial: pushLive, onProgress: (n) => setScanNote(n) });
            // ⚠️ 여기서 result 로 덮으면 안 된다 — pushLive 가 스캔 내내 쌓아 둔 앞선 조회분이
            //   끝나는 순간 사라진다(실측 2026-08-12: 화면 33개 → 이번 요청 6개로 줄어듦).
            //   '창업으로 뽑고 정보형으로 또 뽑아 쌓는' 것이 정상 사용법이라 누적이 맞다.
            //   pushLive 와 같은 규칙(공백 무시 중복 제거 · 검색량 내림차순)으로 합친다.
            pushLive(result);
            if (!kwResultRef.current.length) { setKwErr('인기탭이 확인된 키워드가 없습니다.'); return; }
        } catch (e) {
            const m = e instanceof Error ? e.message : '';
            if (/아직 분석 중/.test(m)) setResumeTick((t) => t + 1);
            setKwErr(m || '조회 실패');
        } finally { setKwLoading(false); setScanNote(''); }
    };

    const applySeeds = () => {
        const cur = seed.split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
        const next = [...new Set([...cur, ...seedPick])];
        setSeed(next.join(', '));
        setSeedCands(null);
        setKwErr(`대표 단어 ${next.length}개로 넓혔습니다 — ‘① 연관어 펼치기’를 눌러 주세요.`);
    };

    // ── 이미 검증된 제품 ─────────────────────────────────────────────────────
    //   판정이 끝난 것만 세므로 스캔 0콜. 고르면 그 제품의 지역 조합을 캐시에서 바로 꺼낸다.
    const [proven, setProven] = useState<ProvenProduct[] | null>(null);
    const [provenOpen, setProvenOpen] = useState(false);
    const [provenQ, setProvenQ] = useState('');
    const [provenBusy, setProvenBusy] = useState('');
    const openProven = async () => {
        setProvenOpen((o) => !o);
        if (proven) return;
        setProvenBusy('불러오는 중…');
        try { setProven(await getProvenProducts()); } catch { setProven([]); }
        setProvenBusy('');
    };
    const pullProven = async (prod: string) => {
        setProvenBusy(`${prod} 불러오는 중…`);
        try {
            const hits = await searchCachedPopular([prod.replace(/\s/g, '')], 500);
            const rows = hits
                .filter((h) => h.keyword.replace(/\s/g, '').endsWith(prod.replace(/\s/g, '')))
                .map((h) => ({ cafes: h.cafes, keyword: h.keyword, theme: h.theme ?? undefined, volume: h.volume ?? undefined }));
            if (!rows.length) { setKwErr(`${prod} — 이미 확인된 지역 조합이 없습니다.`); return; }
            pushLive(rows);
            setKwErr(`${prod} — 이미 확인된 ${rows.length}건을 기다림 없이 불러왔습니다. 담고 싶은 것을 골라 주세요.`);
        } catch (e) {
            setKwErr(e instanceof Error ? e.message : '불러오기 실패');
        } finally { setProvenBusy(''); }
    };

    const runExpandSeed = async () => {
        const s = seed.trim();
        if (!s) { setKwErr('씨앗 키워드를 입력하세요(예: 보홀 · 장기요양).'); return; }
        setKwErr(''); setExtracting(true); setRelCands(null); setKwResult(null); setRelRegional([]);
        try {
            const list = await expandRelated(s);
            if (!list.length) { setKwErr(`"${s}" 의 연관 키워드를 찾지 못했습니다.`); return; }
            setRelCands(list);
            // ★ 기본 체크 = 씨앗어를 포함한 것(tier==='seed'). 옛 '의도어' 규칙은 재현율 7%였다
            //   (독립검증 2026-08-10: 의도어 96개·재현율 7% vs tier==seed 1509개·재현율 77%).
            //   의도어는 여행 어휘 목록이라 창업·누수탐지·입주청소에서 양성을 0건 골랐다.
            //   여기에 더해 씨앗이 '뒤에' 붙는 형태가 더 많으면 그것만 고른다(소자본창업·카페창업).
            const inSeed = list.filter((x) => x.tier === 'seed');
            const ends = inSeed.filter((x) => x.endsSeed);
            const endsWins = ends.length > inSeed.length - ends.length;
            setEndsOnly(endsWins);
            setRelPicked(new Set((endsWins ? ends : inSeed).slice(0, 200).map((x) => x.kw)));
            // ★ 스캔 전에 캐시부터 — 이미 판정된 게 1,000건 넘어 상당수는 긁지 않고 바로 준다.
            const hits = await searchCachedPopular(relatedStems(s, list), 200, false);   // 이 패널은 cafes 를 안 쓴다
            setCachedVia([...new Set(hits.map((h) => h.via))]);
            setCachedHits(hits.map((h) => ({ cafes: h.cafes, keyword: h.keyword, theme: h.theme ?? undefined, volume: h.volume ?? undefined })));
        } catch (e) {
            // 시간초과면 워커는 계속 돈다 — 이어보기 루프를 다시 태워 자동으로 채운다(새로고침 불필요).
            const m = e instanceof Error ? e.message : '';
            if (/아직 분석 중/.test(m)) setResumeTick((t) => t + 1);
            setKwErr(m || '연관어 조회 실패');
        } finally { setExtracting(false); }
    };
    // 연관형 ② — 전국 판정 + 지역형 찔러보기를 한 번에(process_related)
    const checkPopManual = async () => {
        const list = popManualKws.length ? popManualKws : [(form.keyword || '').trim()].filter(Boolean);
        if (!list.length) { setKwErr('확인할 키워드를 입력하세요(입력 후 엔터/추가).'); return; }
        setKwErr(''); setKwLoading(true); setScanNote('인기탭 확인 준비 중…');
        setKwResult(null); setKwHidden([]);
        try {
            const { id, error } = await enqueueListScan(list, 50);
            if (error || !id) throw new Error(error?.message || '분석 등록 실패');
            const { result } = await pollPlaceScan(id, { timeoutSec: 1500, onPartial: pushLive, onProgress: (n) => setScanNote(n) });
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
    // ── 실시간 누적 ────────────────────────────────────────────────────────────
    //   워커가 인기탭을 하나 찾을 때마다 화면에 바로 쌓는다(2026-08-10 사장님 요청).
    //   예전엔 회차(최대 5분)가 끝나야 한 번에 나타나서, 그 사이 게이지 숫자만 오르고 결과는 안 보였다.
    //   ref 를 같이 두는 이유: 부분결과가 3초마다 들어오는데 state 는 다음 렌더에야 반영돼
    //   두 번째 부분결과가 첫 번째를 덮어쓴다.
    const kwResultRef = useRef<KwResult[]>([]);
    useEffect(() => { kwResultRef.current = kwResult || []; }, [kwResult]);
    const pushLive = (rows: KwResult[]) => {
        const seen = new Set<string>(); const out: KwResult[] = [];
        for (const r of [...kwResultRef.current, ...rows]) {
            const nk = (r.keyword || '').replace(/\s/g, '');
            if (seen.has(nk)) continue;
            seen.add(nk); out.push(r);
        }
        out.sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0));
        kwResultRef.current = out;
        setKwResult(out);
        savePendingProgress(null, out);   // 도는 요청 목록은 그대로, 결과만 갱신(새로고침 대비)
        // 적재함에도 더한다 — 모드를 바꿔 조회해도 지금까지 찾은 게 상단에 계속 남게.
        if (clientId) setPool(addToPool(clientId, rows));
    };

    const [kwErr, setKwErr] = useState('');
    const [kwHidden, setKwHidden] = useState<string[]>([]); // X로 제외한 키워드(화면에서만 숨김)
    // 담아둔 키워드(보관함) — 고객이 고른 발행 대상. 접수 시 함께 전달된다.
    //   ★ 조회를 새로 해도 비우지 않고, 새로고침해도 남는다(2026-08-11 사장님 요청).
    //     '창업'으로 뽑고 '프랜차이즈'로 또 뽑고 정보형으로도 뽑아 쌓는 게 정상 사용법이다.
    const [kwPicked, setKwPicked] = useState<KwResult[]>([]);
    const pickedLoadedRef = useRef(false);
    useEffect(() => {                    // 업체가 정해지면 그 업체 보관함을 불러온다
        if (!clientId) return;
        pickedLoadedRef.current = false;
        setKwPicked(loadPickedKw(clientId));
        pickedLoadedRef.current = true;
    }, [clientId]);
    useEffect(() => {                    // 담은 게 바뀌면 바로 보관(불러오기 직후의 덮어쓰기는 막는다)
        if (!clientId || !pickedLoadedRef.current) return;
        savePickedKw(clientId, kwPicked);
    }, [kwPicked, clientId]);
    // 발굴 적재함 — 모드를 오가며 찾아낸 인기탭 전부(보관함과 별개). 상단 패널이 이걸 보여준다.
    const [pool, setPool] = useState<KwResult[]>([]);
    useEffect(() => {
        // 적재함이 생기기 전에 찾아 둔 결과(진행중 저장분)도 한 번 흡수한다 — 안 그러면 처음엔 빈 패널만 뜬다.
        if (!clientId) return;
        const prev = loadPendingScan()?.result ?? [];
        setPool(prev.length ? addToPool(clientId, prev) : loadPoolKw(clientId));
    }, [clientId]);
    const [pickedOpen, setPickedOpen] = useState(false); // 선택 키워드 드롭다운 펼침(기본 접힘 · 우측 N개)
    const [payBusy, setPayBusy] = useState(false); // 결제완료 알림 전송 중
    const [payMsg, setPayMsg] = useState(''); // 결제완료 알림 결과
    const [placeDetail, setPlaceDetail] = useState(''); // 키워드형 '상세 정보 입력' — 플레이스에 메뉴/정보 없을 때 붙여넣기(비고 [상세정보]로 저장)
    const togglePick = (k: KwResult) =>
        setKwPicked((prev) => (prev.some((p) => p.keyword === k.keyword) ? prev.filter((p) => p.keyword !== k.keyword) : [...prev, k]));
    // 여러 건을 한 번에 담는다 — 확인된 조합이 수십 개라 하나씩 누를 수 없다(사장님 지시 2026-08-11).
    //   이미 담긴 건 건너뛴다(토글이 아니라 '추가'여야 전부 담기가 생각대로 동작한다).
    const addPicks = (rows: KwResult[]) =>
        setKwPicked((prev) => {
            const have = new Set(prev.map((p) => p.keyword));
            return [...prev, ...rows.filter((r) => !have.has(r.keyword))];
        });
    // 발행 전 재확인 — 담아둔 키워드를 팔기 직전에 라이브로 다시 판정한다.
    //   SUB4 실측 2026-08-11: 5~6일 지난 양성 30건 중 3건(10%)이 죽어 있었다.
    //   전부 '섹션없음' — 네이버가 그 키워드에 인기글 섹션을 더 이상 안 주는 경우다.
    const [recheckBusy, setRecheckBusy] = useState('');
    const [recheckDead, setRecheckDead] = useState<string[]>([]);
    const runRecheck = async () => {
        if (!kwPicked.length) return;
        setRecheckBusy('재확인 준비…'); setRecheckDead([]);
        try {
            const kws = kwPicked.map((p) => p.keyword);
            const { id, error } = await enqueueRecheckScan(kws);
            if (error || !id) throw new Error(error?.message || '등록 실패');
            const { result } = await pollPlaceScan(id, {
                timeoutSec: 1500, onProgress: (n) => setRecheckBusy(n),
            });
            const alive = new Set(result.map((r) => r.keyword.replace(/\s/g, '')));
            const dead = kws.filter((k) => !alive.has(k.replace(/\s/g, '')));
            setRecheckDead(dead);
            setKwErr(dead.length
                ? `재확인 완료 — ${kws.length}건 중 ${dead.length}건은 지금 인기탭이 없습니다. 아래에서 빨간 것을 빼주세요.`
                : `재확인 완료 — ${kws.length}건 전부 살아있습니다.`);
        } catch (e) {
            setKwErr(e instanceof Error ? e.message : '재확인 실패');
        } finally { setRecheckBusy(''); }
    };

    // 고객사 상호가 들어간 키워드는 결과에서 미리 거른다(SUB4 발견 2026-08-11:
    //   캐시에 '경기 더반클린'·'안양더반클린' 이 양성으로 있었다). 팔 대상이 아니다 —
    //   그 업체는 이미 자기 이름을 갖고 있고, 다른 업체게는 남의 브랜드다.
    const [brands, setBrands] = useState<string[]>([]);
    useEffect(() => { void getClientBrands().then(setBrands); }, []);

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
    // ★ '＋더 찾기'가 어느 경로로 나온 결과인지 알아야 이어서 돌릴 수 있다.
    //   실측 2026-08-11: 연관형·목표채우기로 나온 결과에서 ＋더 찾기를 누르면
    //   지역형 경로로 가서 '제품 키워드를 추가하세요'로 막혔다(칩이 비어 있으니까).
    const lastScanRef = useRef<{ kind: 'place' | 'region' | 'chain'; products: string[] } | null>(null);
    const runPlaceScan = async (target = FIRST_TARGET) => {
        const u = (form.url || '').trim();
        if (!u) { setKwErr('플레이스 주소를 입력하세요.'); return; }
        setKwErr(''); setKwLoading(true); setScanNote('인기탭 분석 준비 중…'); setScanTarget(target);
        lastScanRef.current = { kind: 'place', products: [] };
        // 첫 회차만 초기화 — '＋더 찾기'는 기존 결과에 이어붙인다(이미 판정된 건 캐시라 즉시 통과).
        const prev = target > FIRST_TARGET ? (kwResult ?? []) : [];
        if (target <= FIRST_TARGET) { setKwResult(null); setKwHidden([]); }
        try {
            const { id, error } = await enqueuePlaceScan(u, target, (form.region_sets?.length ? form.region_sets.join(',') : '서울,경기,인천'));
            if (error || !id) throw new Error(error?.message || '요청 실패');
            const { result } = await pollPlaceScan(id, { timeoutSec: target > FIRST_TARGET ? 1500 : 600, onPartial: pushLive, onProgress: (note) => setScanNote(note) });
            // 회차를 이어붙인다 — 워커가 target 만큼만 채우고 끝내므로 이전 회차 결과를 잃으면 안 된다.
            const seenPl = new Set<string>();
            const mergedPl: KwResult[] = [];
            for (const r of [...prev, ...result]) {
                const n = r.keyword.replace(/\s/g, '');
                if (!seenPl.has(n)) { seenPl.add(n); mergedPl.push(r); }
            }
            setKwResult(mergedPl);
        } catch (e) {
            // 시간초과면 워커는 계속 돈다 — 이어보기 루프를 다시 태워 자동으로 채운다(새로고침 불필요).
            const m = e instanceof Error ? e.message : '';
            if (/아직 분석 중/.test(m)) setResumeTick((t) => t + 1);
            setKwErr(m || '분석 실패');
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
        // ★ 지역이 없는 업체(보홀 다이빙투어 등)는 지역을 곱하지 않고 키워드 그대로 전국 판정한다.
        if (noRegion) {
            setKwErr(''); setKwLoading(true); setScanNote('전국 인기탭 조회 중…'); setScanTarget(target);
            if (target <= FIRST_TARGET) clearPendingScan();   // 새 스캔 — 직전 저장분 버림
            try {
                const { id, error } = await enqueueListScan(kws, Math.max(target, kws.length));
                if (error || !id) throw new Error(error?.message || '분석 등록 실패');
                savePendingScan(id, 'list', `전국(지역없음) × ${kws.join(', ')}`);
                const { result } = await pollPlaceScan(id, { timeoutSec: 600, onPartial: pushLive, onProgress: (note) => setScanNote(note) });
                savePendingProgress([], result);
                if (!result.length) { setKwErr(`인기탭 확인된 키워드가 없습니다 — 전국 기준 [${kws.join(', ')}]`); return; }
                setKwResult([...result].sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0)));
            } catch (e) {
                setKwErr(e instanceof Error ? e.message : '조회 실패');
            } finally { setKwLoading(false); setScanNote(''); }
            return;
        }
        if (!sidos.length && !ownAddr.trim()) { setKwErr('지역을 선택하거나 위치를 직접 입력하세요. 지역이 없는 업체면 아래 ‘지역 없음’을 체크하세요.'); return; }
        setKwErr(''); setKwLoading(true); setScanNote('지역 인기탭 조회 준비 중…'); setScanTarget(target);
        lastScanRef.current = { kind: 'region', products: kws };
        // 첫 회차만 초기화 — '＋더 찾기'는 기존 결과 위에 이어붙인다.
        //   저장해 둔 직전 결과도 같이 버린다(안 그러면 옛 결과가 새 조건에 섞인다).
        const prev = target > FIRST_TARGET ? (kwResult ?? []) : [];
        if (target <= FIRST_TARGET) { clearPendingScan(); setKwResult(null); setKwHidden([]); }
        try {
            // 위치를 직접 적었으면 그 주소에서 지역 축을 뽑아 '가까운 곳부터' 본다(플레이스 없는 업체).
            //   시도까지 골랐으면 자기 지역을 채운 뒤 그 시도 전체로 확장한다.
            if (ownAddr.trim()) {
                const { id, error } = await enqueueMenuScan(ownAddr, kws, { name: form.company_name, regions: sidos.join(','), target });
                if (error || !id) throw new Error(error?.message || '분석 등록 실패');
                // 새로고침·이탈해도 다시 붙을 수 있게 남긴다(폴링이 끊겨도 워커는 계속 돈다).
                savePendingScan(id, 'menu', `${ownAddr.trim()} × ${kws.join(', ')}`);
                const { result } = await pollPlaceScan(id, { timeoutSec: 1500, onPartial: pushLive, onProgress: (note) => setScanNote(note) });
                const seenOwn = new Set<string>();
                const mergedOwn: KwResult[] = [];
                for (const r of [...prev, ...result]) {
                    const n = r.keyword.replace(/\s/g, '');
                    if (!seenOwn.has(n)) { seenOwn.add(n); mergedOwn.push(r); }
                }
                savePendingProgress([], mergedOwn);   // 결과 보관 — 새로고침해도 되살아난다
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
            if (merged.length) {
                setKwResult([...merged].sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0)));   // 캐시분 먼저
                savePendingProgress([], merged);   // 캐시분도 남긴다 — 새로고침에 안 날아가게
            }
            // ② 항상 라이브 지역 스캔 — 캐시 양성만 믿고 멈추면 prescan 음성·미스캔분 누락(워커 내부 배치캐시로 판정된 건 즉시).
            // 남은 키워드를 미리 등록해 둔다 — 중단 시 '아직 안 돈 것'을 한 번에 끌 수 있어야 한다.
            // 키워드 하나 스캔. ★ 실패해도 예외를 밖으로 던지지 않는다 —
            //   예전엔 여기서 예외가 튀어 남은 키워드가 통째로 안 돌았다(실측 #198 2026-08-10:
            //   칩 7개 중 6번째 '무철거창업'이 죽으면서 뒤의 '동태탕 가맹'·'창업 상담'이 아예 실행 안 됨).
            const scanOne = async (pk: string, tag: string): Promise<boolean> => {
                const { id, error } = await enqueueRegionScan(pk, sidos.join(','), target);
                if (error || !id) return false;
                liveIdsRef.current = [...liveIdsRef.current, id];
                savePendingScan(id, 'region', `${sidos.join('·')} × ${pk}`);
                try {
                    const { result } = await pollPlaceScan(id, { timeoutSec: 1500, onPartial: pushLive, onProgress: (note) => setScanNote(`${pk} · ${note}${tag}`) });
                    for (const r of result) { const n = r.keyword.replace(/\s/g, ''); if (!seen.has(n)) { seen.add(n); merged.push(r); } }
                    // 키워드 하나 끝날 때마다 저장 — 25개 중 3개째에서 새로고침해도 앞 2개 결과가 남는다.
                    setKwResult([...merged].sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0)));
                    savePendingProgress([], merged);
                    return true;
                } catch {
                    return false;   // 이 키워드만 실패 — 나머지는 계속 간다
                }
            };
            const failed: string[] = [];
            for (let i = 0; i < kws.length; i++) {
                const pk = kws[i];
                if (stopRef.current) break;                       // 중단 눌림
                // ★ 화면에서 X 로 뺀 제품키워드는 건너뛴다 — 스캔이 실제로 줄어든다.
                const stillWanted = (productKws.length ? productKws : kws).includes(pk);
                if (!stillWanted) { setScanNote(`${pk} 건너뜀(제외됨)`); continue; }
                if (!await scanOne(pk, kws.length > 1 ? ` (${i + 1}/${kws.length})` : '')) {
                    failed.push(pk);
                    setScanNote(`${pk} 실패 — 나머지 계속 진행합니다`);
                }
            }
            // 실패분만 한 번 더 — 일시 오류였다면 여기서 붙는다(이미 판정한 조합은 캐시라 금방 지나간다).
            const stillFailed: string[] = [];
            for (let i = 0; i < failed.length; i++) {
                if (stopRef.current) break;
                const pk = failed[i];
                if (!await scanOne(pk, ` 재시도 (${i + 1}/${failed.length})`)) stillFailed.push(pk);
            }
            const failNote = stillFailed.length
                ? ` ⚠ ${stillFailed.join(', ')} 은(는) 두 번 다 실패했습니다 — 그 키워드만 나중에 다시 돌려주세요.` : '';
            if (!merged.length) {
                setKwErr(`인기탭 확인된 키워드가 없습니다 — ${sidos.join('·')} × [${kws.join(', ')}] (인기탭 없음)${failNote}`);
                return;
            }
            setKwResult(merged.sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0)));
            if (failNote) setKwErr(`${merged.length}건 찾았습니다.${failNote}`);
        } catch (e) {
            // 시간초과면 워커는 계속 돈다 — 이어보기 루프를 다시 태워 자동으로 채운다(새로고침 불필요).
            const m = e instanceof Error ? e.message : '';
            if (/아직 분석 중/.test(m)) setResumeTick((t) => t + 1);
            setKwErr(m || '조회 실패');
        } finally {
            setKwLoading(false); setScanNote(''); setStopping(false);
            stopRef.current = false; liveIdsRef.current = [];
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
            {/* 발굴 적재함 — 정보형·연관형 등 모드를 오가며 찾은 것을 한곳에 쌓아 맨 위에 보여준다.
                여기서 '지역 없이 잡힌 것'만 골라, 이 패널의 지역 칩으로 지역까지 더 찾는다(사장님 요청 2026-08-12). */}
            <CafeKwPool who={clientId || ''} rows={pool} onChange={setPool} busy={kwLoading}
                onPick={(rows) => addPicks(rows)}
                onRunChain={(kws, regions) => void runChain(kws, scanTarget + MORE_STEP, regions)} />
            {/* 이어보기 배너 — 새로고침·이탈 후 돌아오면 진행 중인 스캔에 다시 붙는다.
                화면을 막지 않는다: 이 배너가 도는 동안 다른 작업을 계속할 수 있다. */}
            {pending ? (
                <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-[#93c5fd] bg-[#eff6ff] px-3 py-2 text-[12px] text-[#1e40af]">
                    <span className="animate-pulse">⏳</span>
                    <b>이전 스캔이 계속 돌고 있습니다</b>
                    <span className="text-[#3b82f6]">#{pending.id} · {pending.label}</span>
                    {pendNote ? <span className="font-semibold">{pendNote}</span> : null}
                    <span className="text-[11px] text-[#60a5fa]">끝나면 결과가 자동으로 채워집니다 — 그동안 다른 작업 하셔도 됩니다.</span>
                    <button type="button" onClick={() => { clearPendingScan(); setPending(null); }}
                        className="ml-auto rounded border border-[#bfdbfe] bg-white px-2 py-0.5 text-[11px] font-semibold text-[#3b82f6]">그만 보기</button>
                </div>
            ) : null}
            {/* 인기탭 스캔 진행 게이지 — 스캔 중 표시(우리ERP finder와 동일). "x/total" 형태면 %, 아니면 pulse. */}
            {kwLoading || scanNote ? (() => {
                const m = scanNote.match(/(\d+)\/(\d+)/);
                const pct = m ? Math.min(100, Math.round((Number(m[1]) / Math.max(1, Number(m[2]))) * 100)) : null;
                return (
                    <div className="mt-2 rounded-lg border border-[#c4b5fd] bg-[#f5f3ff] p-3">
                        <div className="mb-1.5 flex items-center justify-between gap-2 text-[12px] font-bold text-[#6d28d9]">
                            <span>🔍 인기탭 스캔 중… <span className="font-normal text-[#64748b]">{scanNote || '준비 중…'}</span></span>
                            <span className="flex shrink-0 items-center gap-2">
                                {pct !== null ? <span>{pct}%</span> : null}
                                {/* 중단 — 지금 도는 1건은 끝나지만(워커 루프라 중간에 못 끊는다) 대기분은 즉시 취소된다. */}
                                <button type="button" onClick={() => void stopScan()} disabled={stopping}
                                    className="rounded border border-[#fca5a5] bg-white px-2 py-0.5 text-[11px] font-bold text-[#dc2626] hover:bg-[#fef2f2] disabled:opacity-50"
                                    title="대기 중인 키워드를 취소합니다. 지금 처리 중인 1건은 끝까지 갑니다.">
                                    {stopping ? '중단 중…' : '⏹ 중단'}
                                </button>
                            </span>
                        </div>
                        <div className="h-2.5 w-full overflow-hidden rounded-full bg-[#e9d5ff]">
                            <div className={`h-full rounded-full bg-[#7c3aed] ${pct === null ? 'animate-pulse' : 'transition-all duration-500'}`} style={{ width: `${pct ?? 25}%` }} />
                        </div>
                        {/* 찾는 즉시 아래 목록에 쌓인다 — 끝날 때까지 기다리지 않아도 된다. */}
                        <div className="mt-1.5 text-[11px] text-[#7c3aed]">
                            {kwResult?.length
                                ? <>✔ 지금까지 <b>{kwResult.length}개</b> 찾았습니다 — 아래에 실시간으로 쌓입니다. 스캔 중에도 골라 두셔도 됩니다.</>
                                : '찾는 즉시 아래에 하나씩 쌓입니다.'}
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
                            담아둔 키워드 — 다시 조회해도 지워지지 않습니다 (접수 시 함께 전달)
                        </span>
                        <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-[11px] font-bold text-[#4338ca] ring-1 ring-[#c7d2fe]">{kwPicked.length}개</span>
                    </button>
                    {pickedOpen ? (
                        <div className="border-t border-[#c7d2fe] p-2">
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                            <button type="button"
                                onClick={() => downloadCsv(`담은키워드_${todayTag()}`, ['키워드', '검색량', '테마'],
                                    kwPicked.map((p) => [p.keyword, p.volume ?? '', p.theme ?? '']))}
                                className="rounded border border-[#c7d2fe] bg-white px-2 py-0.5 text-[11px] font-bold text-[#4338ca]">
                                ⬇ 엑셀로 받기
                            </button>
                            {/* 발행 전 재확인 — 5~6일 지난 것의 10%가 이미 안 된다(실측). 접수 직전에 한 번. */}
                            <button type="button" onClick={() => void runRecheck()} disabled={!!recheckBusy}
                                className="rounded border border-[#16a34a] bg-white px-2 py-0.5 text-[11px] font-bold text-[#16a34a] disabled:opacity-50"
                                title="지금도 인기탭이 있는지 다시 봅니다. 접수 직전에 한 번 눌러 주세요.">
                                {recheckBusy ? '확인 중…' : '✅ 접수 전 재확인'}
                            </button>
                            <button type="button"
                                onClick={() => { if (confirm(`담아둔 ${kwPicked.length}개를 모두 비웁니다. 계속할까요?`)) setKwPicked([]); }}
                                className="rounded border border-[#fca5a5] bg-white px-2 py-0.5 text-[11px] font-bold text-[#dc2626]">
                                전부 비우기
                            </button>
                            {recheckDead.length ? (
                                <button type="button"
                                    onClick={() => { setKwPicked((prev) => prev.filter((p) => !recheckDead.includes(p.keyword))); setRecheckDead([]); }}
                                    className="rounded bg-[#dc2626] px-2 py-0.5 text-[11px] font-bold text-white">
                                    안 되는 {recheckDead.length}건 빼기
                                </button>
                            ) : null}
                            <span className="text-[11px] text-[#818cf8]">
                                {recheckBusy ? `🔎 ${recheckBusy}` : '다른 조건으로 계속 조회해 쌓으세요 — 30일 보관됩니다.'}
                            </span>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                            {kwPicked.map((p) => (
                                <span key={p.keyword} className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[12px] font-semibold ring-1 ${recheckDead.includes(p.keyword) ? 'bg-[#fef2f2] text-[#dc2626] ring-[#fca5a5] line-through' : 'bg-white text-[#3730a3] ring-[#c7d2fe]'}`}>
                                    {p.keyword}
                                    {p.volume != null ? <span className="text-[10px] font-normal text-[#94a3b8]">{p.volume.toLocaleString()}</span> : null}
                                    <button type="button" onClick={() => togglePick(p)} className="text-[#818cf8] hover:text-[#4338ca]" title="선택 해제">×</button>
                                </span>
                            ))}
                        </div>
                        </div>
                    ) : null}
                </div>
            ) : null}
            {kwResult && (() => {
                // 고객사 상호가 들어간 키워드는 보이지 않게 한다 — 팔 대상이 아니다.
                const visible = kwResult.filter((k) => !kwHidden.includes(k.keyword) && !hasClientBrand(k.keyword, brands));
                const fresh = visible.filter((k) => !usedKw.has(normKw(k.keyword)));
                const used = visible.filter((k) => usedKw.has(normKw(k.keyword)));
                return (
                <div className="mt-2 rounded-lg border border-[#ddd6fe] bg-[#faf5ff] p-2">
                    <div className="mb-1 text-[11px] font-semibold text-[#6d28d9]">
                        {isKw ? '정확 인기탭 결과 — 진입한 키워드 중 발행할 것을 고르세요(복수 선택). 필요없는 건 × 로 제외.'
                              : `지역 키워드 ${kwResult.length}개 — 발행할 동을 고르세요(복수 선택). 필요없는 건 × 로 제외.`}
                    </div>
                    {/* 찾은 것에 지역 붙이기 — "단독으로 되는 걸 찾았으면 지역까지 파 달라"(사장님 2026-08-12).
                        ⚠️ 지역이 이미 붙은 결과(수원 ○○)는 대상이 아니다 — 워커가 지역을 또 곱하지 않고
                          (_product_place_head 로 '수원 안양 ○○' 방지) 단독만 보는데 그건 이미 캐시라 아무 일도 안 난다.
                          그래서 '지역 없는 단독 히트'만 골라 되먹인다. 없으면 버튼 자체를 띄우지 않는다. */}
                    {(() => {
                        const soloHits = visible.filter((k) => !k.keyword.includes(' '));
                        if (!soloHits.length || !regionSel.length) return null;
                        return (
                            <div className="mb-1.5 flex flex-wrap items-center gap-2 rounded-md border border-[#16a34a] bg-[#f0fdf4] px-2 py-1.5">
                                <span className="text-[12px] font-bold text-[#15803d]">📍 지역 없이 잡힌 {soloHits.length}개에 지역 붙여 더 찾기</span>
                                <span className="text-[11px] text-[#4d7c0f]">{soloHits.slice(0, 3).map((k) => k.keyword).join(' · ')}{soloHits.length > 3 ? ` 외 ${soloHits.length - 3}` : ''} × {regionSel.join('·')} 전 지역</span>
                                <button type="button" disabled={kwLoading}
                                    onClick={() => void runChain(soloHits.map((k) => k.keyword), scanTarget + MORE_STEP)}
                                    className="ml-auto shrink-0 rounded bg-[#16a34a] px-3 py-1 text-[11px] font-bold text-white disabled:opacity-50">
                                    {kwLoading ? '찾는 중…' : '지역까지 찾기 →'}
                                </button>
                            </div>
                        );
                    })()}
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
                    <button type="button" onClick={() => {
                        const t = scanTarget + MORE_STEP;
                        const ls = lastScanRef.current;
                        if (ls?.kind === 'chain') { void runChain(ls.products, t); return; }
                        if (ls?.kind === 'place' || isKw) { void runPlaceScan(t); return; }
                        void genRegionKeywords(t);
                    }}
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
                        {/* 금액은 표시하지 않는다 — 단가가 계약마다 달라 자동 계산값(건당 15,000)이 오해를 만든다. 담당자 안내. */}
                        {pendingPay.map((r) => {
                            return (
                                <div key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-[#fed7aa] bg-white px-3 py-2 text-[13px]">
                                    <span className="font-bold text-[#334155]">{r.company_name}</span>
                                    <span className="text-[#64748b]">발행 {r.total_count ?? r.selected_keywords?.length ?? '-'}건</span>
                                    <span className="ml-auto text-[12px] text-[#9a3412]">결제금액은 담당자가 안내드립니다</span>
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
                <div className="mb-1 flex items-center gap-2">
                    <div className="text-[15px] font-bold text-[#0f172a]">카페 배포 접수</div>
                    {/* 사용 가이드 다시 보기 — CustomerGuide(Layout)가 이벤트를 받아 투어를 다시 띄운다. */}
                    <button type="button" onClick={() => window.dispatchEvent(new Event('cafe-guide:open'))}
                        className="ml-auto inline-flex items-center gap-1 rounded-md border border-[#c7d2fe] bg-[#eef2ff] px-2.5 py-1 text-[12px] font-bold text-[#4338ca] hover:bg-[#e0e7ff]"
                        title="카페 배포 사용 가이드를 다시 봅니다">
                        📖 가이드 보기
                    </button>
                </div>
                <p className="mb-4 mt-0 text-[13px] text-[#64748b]">배포를 원하시는 내용과 사진을 접수해 주세요. 담당자 확인 후 세팅해 드립니다. (금액·정산은 별도 안내)</p>

                {/* ① 배포 종류 → ② (인기탭일 때만) 키워드 잡는 방식.
                    한 줄에 3개를 늘어놓으면 '인기탭을 따지는지'가 안 보여 고객이 헷갈린다.
                    일반 배포는 그 자리에서 키워드 입력으로 끝난다(고를 게 없음). */}
                <div data-tour="cafe-deploy-type" className="mb-4">
                    <label className={labelCls}>배포 종류</label>
                    {/* 선택은 설명 카드로만 한다(위 토글 제거 — 같은 걸 두 번 고르게 만들 필요가 없다). */}
                    <div className="mt-1 grid gap-1.5 sm:grid-cols-2">
                        {([
                            ['일반 배포', '직접형', '인기탭을 따지지 않고, 적어 주신 키워드 그대로 발행합니다.'],
                            ['인기탭 배포', '지역형', '실제 인기글 섹션에 들어갈 수 있는 키워드만 골라 발행합니다.'],
                        ] as const).map(([name, dt, desc]) => {
                            const on = name === '일반 배포' ? isManual : !isManual;
                            return (
                                <button key={name} type="button" onClick={() => set('deploy_type', dt)}
                                    className={`rounded-lg border px-3 py-2 text-left ${on ? 'border-[#4338ca] bg-[#eef2ff]' : 'border-[#e2e8f0] bg-white hover:bg-[#f8fafc]'}`}>
                                    <div className={`text-[12px] font-bold ${on ? 'text-[#4338ca]' : 'text-[#334155]'}`}>{on ? '● ' : ''}{name}</div>
                                    <div className="mt-0.5 text-[11px] leading-snug text-[#64748b]">{desc}</div>
                                </button>
                            );
                        })}
                    </div>

                    {!isManual ? (
                        <div className="mt-3">
                            <label className={labelCls}>키워드 잡는 방식</label>
                            {/* 5가지 방식 = 설명 카드로만 선택(위 토글 제거). */}
                            <div className="mt-1 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                                {([
                                    ['지역형', '지역형', '원하는 지역을 골라서 노출되고 싶을 때', '지역 선택 + 제품키워드(예: 입주청소·상가청소)'],
                                    ['키워드형', '키워드형', '특정 지역 위주로 노출이 되고 싶을 때', '플레이스 주소 기반으로 업체 키워드를 잡습니다'],
                                    ['직접 입력형', '인기직접형', '일반 배포는 아니지만, 내가 원하는 키워드를 인기탭에서 확인 후 배포하고 싶을 때', '적어 주신 키워드 중 인기탭이 확인된 것만 골라 드립니다'],
                                    ['연관형', '연관형', '연관 키워드를 찾아서 배포하고 싶을 때', '대표 단어 하나면 됩니다(예: 보홀·장기요양) · 플레이스 불필요'],
                                    ['🌐 정보형', '정보형', '본인 업체 정보가 많지 않을 때 — 정보를 입력해 키워드를 뽑고, 인기탭 확인 후 배포하고 싶을 때', '홈페이지·네이버 블로그 주소로 자동 추출 · 플레이스 불필요'],
                                ] as const).map(([name, dt, desc, hint]) => {
                                    const on = form.deploy_type === dt;
                                    return (
                                        <button key={dt} type="button" onClick={() => set('deploy_type', dt)}
                                            className={`rounded-lg border px-3 py-2 text-left ${on ? 'border-[#4338ca] bg-[#eef2ff]' : 'border-[#e2e8f0] bg-white hover:bg-[#f8fafc]'}`}>
                                            <div className={`text-[12px] font-bold ${on ? 'text-[#4338ca]' : 'text-[#334155]'}`}>{on ? '● ' : ''}{name}</div>
                                            <div className="mt-0.5 text-[11px] leading-snug text-[#64748b]">{desc}</div>
                                            <div className="mt-0.5 text-[10px] leading-snug text-[#94a3b8]">{hint}</div>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    ) : null}

                    {/* 인기탭 배포 · 직접입력형 — 키워드 칩으로 모아 두고 한 번에 인기탭 판정 */}
                    {/* 연관형 — 씨앗어 하나로 전국형·지역형 인기탭을 한 번에 훑는다.
                        실측(2026-08-07): 보홀 35건(154,370) · 창업 20건(311,780) · 장기요양은
                        전국형 간병인업체 + 지역형 간병인(지역 붙이면 46건). 업종에 따라 정답이 갈려
                        둘 다 시도한다. */}
                    {isRelated ? (
                        <div data-tour="cafe-deploy-kw" className="mt-3 rounded-md border border-dashed border-[#c4b5fd] bg-[#faf5ff] px-3 py-2">
                            <div className="flex gap-2">
                                <input className={inputCls} value={seed} onChange={(e) => setSeed(e.target.value)}
                                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void runExpandSeed(); } }}
                                    placeholder="대표 단어 — 쉼표로 여러 개 (예: 창업, 프랜차이즈, 가맹)" />
                                {/* 대표 단어 하나로는 못 닿는다. 실측: '창업' 993 → 8개 3,680(3.7배). */}
                                <button type="button" onClick={() => void runDiscover()} disabled={!!seedBusy || extracting || kwLoading}
                                    className="h-10 shrink-0 rounded-md border border-[#6d28d9] bg-white px-3 text-sm font-bold text-[#6d28d9] disabled:opacity-50"
                                    title="이 단어에서 출발해 '같이 넣으면 좋은 다른 단어'를 찾아 줍니다. 인기탭 확인은 안 합니다.">
                                    {seedBusy ? '발굴 중…' : '🔎 단어 발굴'}
                                </button>
                                <button type="button" onClick={() => void runExpandSeed()} disabled={extracting || kwLoading}
                                    className="h-10 shrink-0 rounded-md bg-[#6d28d9] px-4 text-sm font-bold text-white disabled:opacity-50">
                                    {extracting ? '조회 중…' : '① 연관어 펼치기'}
                                </button>
                            </div>
                            {seedBusy ? <p className="m-0 mt-1 text-[11px] font-semibold text-[#6d28d9]">🔎 {seedBusy}</p> : null}
                            {/* ★ 지역을 여기서 고른다 — '③ 인기탭 찾기'가 곧바로 이 지역 전수를 돌기 때문이다.
                                예전엔 지역 선택 UI 가 지역형·정보형에만 있어서, 연관형에선 고를 방법이 없는데
                                버튼만 비활성이었다(사장님 신고 2026-08-11). */}
                            <div className="mt-2 flex flex-wrap items-center gap-1 rounded-md border border-[#c4b5fd] bg-white px-2 py-1.5">
                                <span className="mr-1 text-[11px] font-bold text-[#6d28d9]">발행할 지역</span>
                                {REGION_KEYS.map((r) => (
                                    <button key={r} type="button" onClick={() => toggleRegion(r)}
                                        className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${regionSel.includes(r) ? 'border-[#6d28d9] bg-[#6d28d9] text-white' : 'border-[#ddd6fe] bg-white text-[#6d28d9]'}`}>{r}</button>
                                ))}
                                <span className="ml-1 text-[11px] text-[#94a3b8]">
                                    {regionSel.length ? '이 지역의 전 지역을 봅니다' : '하나 이상 골라야 ③ 인기탭 찾기가 됩니다'}
                                </span>
                            </div>
                            {/* 발굴 결과 — '신규'는 실제로 조회해서 잰 값이다(추측 아님). */}
                            {seedCands?.length ? (
                                <div className="mt-2 rounded-md border border-[#c4b5fd] bg-white p-2">
                                    <div className="mb-1.5 flex flex-wrap items-center gap-2 text-[12px] font-bold text-[#6d28d9]">
                                        <span>추천 단어 {seedCands.length}개 — 선택 {seedPick.size}개</span>
                                        <span className="font-normal text-[#94a3b8]">신규 = 이 단어를 더하면 새로 들어오는 키워드 수</span>
                                        <button type="button" onClick={applySeeds} disabled={!seedPick.size}
                                            className="ml-auto rounded bg-[#6d28d9] px-3 py-1 text-[11px] font-bold text-white disabled:opacity-50">
                                            선택한 {seedPick.size}개 넣기 →
                                        </button>
                                    </div>
                                    <div className="flex flex-wrap gap-1.5">
                                        {seedCands.map((c) => {
                                            const on = seedPick.has(c.seed);
                                            return (
                                                <button key={c.seed} type="button"
                                                    onClick={() => { const n = new Set(seedPick); if (on) n.delete(c.seed); else n.add(c.seed); setSeedPick(n); }}
                                                    className={`rounded-full border px-2.5 py-1 text-[12px] font-semibold ${on ? 'border-[#6d28d9] bg-[#6d28d9] text-white' : 'border-[#ddd6fe] bg-white text-[#5b21b6]'}`}>
                                                    {c.kind === 'other' ? '' : '↳ '}{on ? '✓ ' : '+ '}{c.seed}
                                                    <span className={`ml-1 text-[10px] font-bold ${on ? 'text-[#ddd6fe]' : 'text-[#16a34a]'}`}>신규 {c.fresh.toLocaleString()}</span>
                                                    {c.proven ? <span className={`ml-1 text-[10px] ${on ? 'text-[#ddd6fe]' : 'text-[#b45309]'}`}>✔확인 {c.proven}지역</span> : null}
                                                    {c.overlap < SEED_OVERLAP_MIN ? <span className={`ml-1 text-[10px] ${on ? 'text-[#fecaca]' : 'text-[#dc2626]'}`}>⚠다른 분야</span> : null}
                                                </button>
                                            );
                                        })}
                                    </div>
                                    <p className="m-0 mt-1 text-[11px] text-[#a78bfa]">
                                        맨 위는 <b>‘창업 → 프랜차이즈’ 처럼 결이 다른 단어</b>입니다. ↳ 는 대표 단어가 들어간 변형이고요.
                                        ✔확인 = 이미 인기탭이 쌓여 있는 단어(더 잘 나옵니다) · ⚠다른 분야 = 관련이 멀어 권하지 않습니다.
                                    </p>
                                </div>
                            ) : null}
                            {/* 이미 확인된 제품 — 판정이 끝난 것만이라 기다림 없이 바로 나온다. */}
                            <div className="mt-2 rounded-md border border-[#bbf7d0] bg-[#f0fdf4] p-2">
                                <button type="button" onClick={() => void openProven()}
                                    className="flex w-full items-center gap-2 text-[12px] font-bold text-[#15803d]">
                                    <span className={`text-[9px] transition-transform ${provenOpen ? 'rotate-90' : ''}`}>▶</span>
                                    ✔ 이미 확인된 키워드{proven ? ` ${proven.length}종` : ''} — 기다림 없이 바로
                                    <span className="font-normal text-[#86efac]">{provenBusy || '이미 인기탭이 확인돼 있는 것들입니다'}</span>
                                </button>
                                {provenOpen ? (
                                    <div className="mt-2">
                                        <input className={`${inputCls} mb-1.5 h-8 text-[12px]`} value={provenQ}
                                            onChange={(e) => setProvenQ(e.target.value)} placeholder="검색 (예: 창업 · 청소 · 누수)" />
                                        <div className="flex max-h-44 flex-wrap gap-1.5 overflow-y-auto">
                                            {(proven ?? [])
                                                .filter((p) => !provenQ.trim() || p.product.includes(provenQ.trim()))
                                                .slice(0, 120)
                                                .map((p) => (
                                                    <button key={p.product} type="button" onClick={() => void pullProven(p.product)}
                                                        disabled={!!provenBusy}
                                                        className="rounded-full border border-[#bbf7d0] bg-white px-2.5 py-1 text-[12px] font-semibold text-[#15803d] disabled:opacity-50">
                                                        {p.product}
                                                        <span className="ml-1 text-[10px] font-bold text-[#16a34a]">{p.regions}지역</span>
                                                    </button>
                                                ))}
                                            {proven && !proven.length ? <span className="text-[11px] text-[#86efac]">아직 없습니다.</span> : null}
                                        </div>
                                    </div>
                                ) : null}
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
                                        {/* 분야 · 세부 드롭다운 — 계열만으로는 454개라 너무 광범위하다(사장님 요청 2026-08-11).
                                            세부는 사전이 아니라 실제 후보에서 뽑는다 — 업종마다 다르고, 미리 짜면 그 순간 추측이다. */}
                                        {(() => {
                                            const base = relCands.filter((x) => (relTier === 'seed' ? x.tier === 'seed' : relTier === 'near' ? x.tier !== 'far' : true))
                                                .filter((x) => !endsOnly || x.endsSeed);
                                            const fam = new Map<string, number>();
                                            for (const x of base) { const k = x.seedOf || '기타'; fam.set(k, (fam.get(k) ?? 0) + 1); }
                                            const inFam = base.filter((x) => !seedFilter || (x.seedOf || '기타') === seedFilter).filter((x) => !subFilter || x.kw.replace(/\s/g, '').includes(subFilter));
                                            const pool = new Set(relCands.map((x) => x.kw.replace(/\s/g, '')));
                                            const subs = seedFilter ? subCategories(inFam.map((x) => x.kw), seedFilter, pool) : [];
                                            const sel = 'h-7 rounded border border-[#c4b5fd] bg-white px-1.5 text-[11px] font-bold text-[#6d28d9]';
                                            return (
                                                <span className="inline-flex flex-wrap items-center gap-1">
                                                    <select className={sel} value={seedFilter} onChange={(e) => { setSeedFilter(e.target.value); setSubFilter(''); }}>
                                                        <option value="">분야 전체 ({base.length})</option>
                                                        {[...fam.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => (
                                                            <option key={k} value={k}>{k} ({n})</option>
                                                        ))}
                                                    </select>
                                                    <select className={sel} value={subFilter} disabled={!subs.length}
                                                        onChange={(e) => setSubFilter(e.target.value)}>
                                                        <option value="">{subs.length ? `세부 전체 (${inFam.length})` : '세부 — 분야 먼저'}</option>
                                                        {subs.map((sc) => <option key={sc.label} value={sc.label}>{sc.label} ({sc.count})</option>)}
                                                    </select>
                                                </span>
                                            );
                                        })()}
                                        {/* '~~씨앗' 형태만 — 소자본창업·카페창업 같은 '업종+행위'만 남긴다.
                                            씨앗이 앞에 오는 형태(창업박람회·창업대출)는 정보성이라 결이 다르다. */}
                                        <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-[#c4b5fd] px-2 py-0.5 text-[11px] font-bold text-[#6d28d9]">
                                            <input type="checkbox" className="h-3 w-3 accent-[#6d28d9]" checked={endsOnly}
                                                onChange={(e) => setEndsOnly(e.target.checked)} />
                                            “{seed.trim().split(',')[0].trim()}”으로 끝나는 것만
                                        </label>
                                        {/* 보이는 층(relTier) 안에서 전체 선택/해제 — 237개를 하나씩 누를 수 없다. */}
                                        {(() => {
                                            const shown = relCands.filter((x) => (relTier === 'seed' ? x.tier === 'seed' : relTier === 'near' ? x.tier !== 'far' : true))
                                                .filter((x) => !endsOnly || x.endsSeed)
                                                .filter((x) => !seedFilter || (x.seedOf || '기타') === seedFilter).filter((x) => !subFilter || x.kw.replace(/\s/g, '').includes(subFilter)).slice(0, 200);
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
                                            .filter((x) => !endsOnly || x.endsSeed)
                                            .filter((x) => !seedFilter || (x.seedOf || '기타') === seedFilter).filter((x) => !subFilter || x.kw.replace(/\s/g, '').includes(subFilter))
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
                                        {/* ★ 체크한 순서대로 하나씩 끝까지 파고 30건 채우면 멈춘다(process_chain).
                                            각 키워드마다 단독 판정 → 위에서 고른 지역 전수. 사장님 설계 2026-08-11. */}
                                        <button type="button" disabled={kwLoading || !relPicked.size || !(form.region_sets || []).length}
                                            onClick={() => void runChain((relCands || []).filter((c) => relPicked.has(c.kw)).map((c) => c.kw))}
                                            className="h-9 shrink-0 rounded-md bg-[#7c3aed] px-4 text-sm font-bold text-white disabled:opacity-50"
                                            title="체크한 키워드를 순서대로 하나씩 팍니다 — 단독 + 고른 지역 전수. 30건 채우면 멈춥니다.">
                                            {kwLoading ? '찾는 중…'
                                                : !(form.region_sets || []).length ? '↑ 먼저 지역을 고르세요'
                                                    : !relPicked.size ? '↑ 키워드를 체크하세요'
                                                        : `③ 인기탭 찾기 (${FIRST_TARGET}건 채우면 멈춤)`}
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
                                    <div className="mb-1 flex flex-wrap items-center gap-2 text-[12px] font-bold text-[#b45309]">
                                        <span>📍 지역을 붙여야 나오는 키워드 {relRegional.length}건</span>
                                        {/* 확인된 조합이 수십 개라 하나씩 누를 수 없다 — 한 번에 담는다. */}
                                        {(() => {
                                            const all = relRegional.flatMap((r) => (r.sample ?? []).map((s) => ({
                                                cafes: [] as KwResult['cafes'], keyword: s, theme: r.theme, volume: r.volume,
                                            })));
                                            const left = all.filter((r) => !kwPicked.some((p) => p.keyword === r.keyword));
                                            if (!all.length) return null;
                                            return (
                                                <button type="button" onClick={() => addPicks(all)} disabled={!left.length}
                                                    className="ml-auto rounded bg-[#16a34a] px-3 py-1 text-[11px] font-bold text-white disabled:opacity-40">
                                                    {left.length ? `확인된 ${left.length}건 전부 담기` : `전부 담김 (${all.length}건)`}
                                                </button>
                                            );
                                        })()}
                                    </div>
                                    {relRegional.map((r) => (
                                        <div key={r.keyword} className="rounded border border-[#fde68a] bg-white px-2 py-1.5 text-[12px]">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <b className="text-[#b45309]">{r.keyword}</b>
                                                <span className="text-[#94a3b8]">{r.theme}</span>
                                            </div>
                                            {/* ★ 찔러보기에서 '이미 인기탭으로 확인된' 조합이다 — 예시가 아니라 바로 쓸 수 있는 키워드다.
                                                눌러서 담으면 전수 스캔을 안 돌려도 그만큼은 확보된다(사장님 지시 2026-08-11). */}
                                            {r.sample?.length ? (
                                                <div className="mt-1 flex flex-wrap items-center gap-1">
                                                    <button type="button"
                                                        onClick={() => addPicks((r.sample ?? []).map((s) => ({ cafes: [], keyword: s, theme: r.theme, volume: r.volume })))}
                                                        className="rounded bg-[#16a34a] px-2 py-0.5 text-[11px] font-bold text-white">
                                                        확인됨 {r.sample.length}건 전부 담기
                                                    </button>
                                                    {r.sample.map((s) => {
                                                        const on = kwPicked.some((p) => p.keyword === s);
                                                        return (
                                                            <button key={s} type="button"
                                                                onClick={() => togglePick({ cafes: [], keyword: s, theme: r.theme, volume: r.volume })}
                                                                className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${on ? 'border-[#16a34a] bg-[#16a34a] text-white' : 'border-[#bbf7d0] bg-[#f0fdf4] text-[#15803d]'}`}>
                                                                {on ? '✓ ' : '+ '}{s}
                                                            </button>
                                                        );
                                                    })}
                                                </div>
                                            ) : null}
                                        </div>
                                    ))}
                                    <p className="mb-0 mt-1 text-[11px] text-[#a16207]">
                                        초록 칩은 <b>이미 인기탭이 확인된 키워드</b>입니다 — 눌러서 바로 담으세요.
                                    </p>
                                    {/* 목표 채우기 — 후보를 순서대로 끝까지 파서 목표 건수를 채우면 멈춘다.
                                        하나씩 지역형으로 다시 접수할 필요가 없다(사장님 설계 2026-08-11). */}
                                    <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-[#16a34a] bg-[#f0fdf4] px-2 py-1.5">
                                        <span className="text-[12px] font-bold text-[#15803d]">🎯 {FIRST_TARGET}건 채울 때까지 알아서 찾기</span>
                                        <span className="text-[11px] text-[#4d7c0f]">
                                            위 {relRegional.length}개를 순서대로 끝까지 팝니다 — 키워드 단독 + 전 지역
                                            ({(form.region_sets || []).join('·') || '위에서 지역을 골라 주세요'}).
                                        </span>
                                        <button type="button" disabled={kwLoading || !(form.region_sets || []).length}
                                            onClick={() => void runChain(relRegional.map((r) => r.keyword))}
                                            className="ml-auto shrink-0 rounded bg-[#16a34a] px-3 py-1 text-[11px] font-bold text-white disabled:opacity-50">
                                            {kwLoading ? '찾는 중…' : '시작 →'}
                                        </button>
                                    </div>
                                </div>
                            ) : null}
                        </div>
                    ) : null}

                    {isPopManual ? (
                        <div data-tour="cafe-deploy-kw" className="mt-3 rounded-md border border-dashed border-[#a5b4fc] bg-[#eef2ff] px-3 py-2">
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

                {/* data-deploy-type — 사용 가이드(CustomerGuide)가 읽어 방식별 안내로 바꾼다. */}
                <div data-tour="cafe-deploy-basic" data-deploy-type={form.deploy_type} className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <div className="md:col-span-2">
                        <label className={labelCls}>
                        업체명 *
                        {/* 담당자가 미리보기로 남의 화면을 볼 때 어느 업체인지 분명히 보이게 한다. */}
                        {clientName ? <span className="ml-1 font-normal text-[#4338ca]">— 지금 <b>{clientName}</b> 화면입니다</span> : null}
                    </label>
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
                                <label className="mt-2 flex w-fit cursor-pointer items-center gap-2 rounded-md border border-[#fbbf24] bg-[#fffbeb] px-3 py-1.5 text-[12px] font-semibold text-[#b45309]">
                                    <input type="checkbox" className="h-3.5 w-3.5 accent-[#b45309]" checked={noRegion}
                                        onChange={(e) => setNoRegion(e.target.checked)} />
                                    🌏 지역 없음 — 전국/해외로 판정 (보홀 다이빙투어처럼 국내 지역이 없는 업체)
                                </label>
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
                                    {/* 목표 채우기 — 연관형에만 있던 흐름을 정보형·지역형에도 붙인다(사장님 2026-08-12).
                                        ① 뽑은 키워드를 지역 없이 그대로 판정(공장청소) → ② 그 다음 지역을 붙여 전수(○○ 공장청소)
                                        → ③ 30건 채우면 멈추고 ＋10 으로 이어서. 워커는 같은 process_chain 을 탄다.
                                        기존 '지역 키워드 생성'(region: 경로)은 단독 판정이 없어 전국형을 통째로 놓쳤다. */}
                                    {!noRegion ? (
                                        <button type="button" onClick={() => void runChain(productKws.length ? productKws : [(form.keyword || '').trim()].filter(Boolean))}
                                            disabled={kwLoading || (!productKws.length && !(form.keyword || '').trim())}
                                            className="h-10 shrink-0 rounded-md bg-[#16a34a] px-4 text-sm font-bold text-white hover:bg-[#15803d] disabled:opacity-50"
                                            title="키워드마다 ① 지역 없이 먼저 보고 ② 그 뒤 선택 지역 전수로 봅니다. 30건 채우면 멈추고 ＋10으로 이어서 찾습니다.">
                                            {kwLoading ? '찾는 중…' : `🎯 인기탭 찾기 (${FIRST_TARGET}건)`}
                                        </button>
                                    ) : null}
                                    <button type="button" onClick={() => void genRegionKeywords()} disabled={kwLoading} className="h-10 shrink-0 rounded-md border border-[#c4b5fd] bg-white px-4 text-sm font-bold text-[#6d28d9] disabled:opacity-50" title="지역 × 제품키워드 조합만 만듭니다(단독 판정 없음). 예전 방식.">
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
                        {isRegionLike ? <p className="mb-0 mt-1 text-[11px] text-[#94a3b8]"><b className="text-[#15803d]">🎯 인기탭 찾기</b> = 키워드마다 ① 지역 없이 먼저(예 <b>공장청소</b>) → ② 그 뒤 선택 지역 전수(<b>수원 공장청소</b>…) → 30건 채우면 멈춤, 부족하면 ＋10으로 이어서. 지역 없이도 되는 전국형을 놓치지 않습니다.</p> : null}
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
