import { useEffect, useRef, useState } from 'react';
import { generateCafe, generateCafeReview, generateLongform } from '../../api/cafeWriter';
import { checkPopularBridge, nusu2Health } from '../../api/nusu2Bridge';
import { createCustomerPublishJob, listMyCafeJobs, listCafeJobsByCompanies, listMyPublishedPairs } from '../../api/cafePublishQueue';
import { listTokens, balanceOf, consumeToken } from '../../api/cafeTokens';
import { getCafeAccounts } from '../../api/cafeAccounts';
import { getStudioSettings, saveStudioSettings, clearStudioSettings, uploadStudioImage, signedStudioUrls } from '../../api/cafeStudioSettings';
import { enqueueGenRequests, publishTargetFor } from '../../api/cafeGenRequests';
import { CafeCustomerRequest } from './CafeCustomerRequest';
import { CafeKeywordFinder } from './CafeKeywordFinder';
import { REGION_GROUPS, type RegionSet } from './regions';

type MyJob = { id: string; title: string; status: string; posted_url: string | null; reason: string | null; created_at: string };
const STATUS_KO: Record<string, string> = { pending: '대기', processing: '작성 중', posted: '게시됨(확인중)', done: '완료', fail: '실패' };

// 업종 → longform 종류. 더반클린(입주청소)=clean · 누수탐지=leak. 그 외는 null(기존 후기 경로로 폴백).
function bizKind(business: string): 'leak' | 'clean' | null {
    const s = business.replace(/\s/g, '');
    if (/청소/.test(s)) return 'clean';
    if (/누수|탐지/.test(s)) return 'leak';
    return null;
}
// kw 에서 업종어를 떼어 지역만 남긴다(키워드형에서 지역칸이 비었을 때). 예: "종로 입주청소" → "종로".
function deriveRegion(kw: string, business: string): string {
    let s = kw;
    if (business.trim()) s = s.split(business.trim()).join(' ');
    return s.replace(/입주청소|누수탐지|이사청소|화장실청소|누수|청소|탐지/g, ' ').replace(/\s+/g, ' ').trim();
}
// 하단 태그칩(에디터 태그칸) — nusu2/ddclean _tags 그대로. 지역+업종 정확일치 2 + 변형/의도.
function longformTags(kind: 'leak' | 'clean', region: string, dong?: string): string[] {
    const rj = region.replace(/\s/g, '');
    const d = (dong || '').replace(/\s/g, '');
    if (kind === 'clean') {
        return d
            ? [`${rj}입주청소`, `${d}입주청소`, '준공청소', '새집증후군', '이사청소', '입주청소업체']
            : [`${rj}입주청소`, `${rj}이사청소`, '준공청소', '새집증후군', '이사청소', '입주청소업체'];
    }
    return d
        ? [`${rj}누수탐지`, `${d}누수탐지`, `${d}누수`, '누수원인', '배관누수', '누수탐지업체']
        : [`${rj}누수탐지`, `${rj}누수`, '누수원인', '화장실누수', '배관누수', '누수탐지업체'];
}

// 파일 → dataURL(긴 변 1600px 축소).
function fileToDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload = () => {
            URL.revokeObjectURL(url);
            const max = 1600; const scale = Math.min(1, max / Math.max(img.width, img.height));
            const w = Math.round(img.width * scale); const h = Math.round(img.height * scale);
            const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
            const ctx = canvas.getContext('2d'); if (!ctx) { reject(new Error('canvas')); return; }
            ctx.drawImage(img, 0, 0, w, h); resolve(canvas.toDataURL('image/jpeg', 0.9));
        };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('이미지를 읽지 못했습니다.')); };
        img.src = url;
    });
}

// 실사 2장을 좌우로 붙여 1장으로(더반 _pair_photos 방식) — 높이 맞춰 나란히, 가운데 흰 여백.
function composePair(a: string, b: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const ia = new Image(); const ib = new Image();
        let loaded = 0; const gap = 8;
        const done = () => {
            if ((loaded += 1) < 2) return;
            const h = Math.min(ia.height || 800, ib.height || 800) || 800;
            const wa = Math.round((ia.width || h) * h / (ia.height || h));
            const wb = Math.round((ib.width || h) * h / (ib.height || h));
            const canvas = document.createElement('canvas');
            canvas.width = wa + gap + wb; canvas.height = h;
            const ctx = canvas.getContext('2d'); if (!ctx) { reject(new Error('canvas')); return; }
            ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(ia, 0, 0, wa, h);
            ctx.drawImage(ib, wa + gap, 0, wb, h);
            resolve(canvas.toDataURL('image/jpeg', 0.9));
        };
        ia.onload = done; ib.onload = done;
        ia.onerror = () => reject(new Error('이미지 합성 실패')); ib.onerror = () => reject(new Error('이미지 합성 실패'));
        ia.src = a; ib.src = b;
    });
}

// 실사 배치 랜덤 — 순서대로 훑으며 확률로 2장 좌우페어(1장) 또는 낱개. 홀수 끝은 단독. 결과 = 삽입할 실사 목록.
async function pairPhotosRandom(list: string[]): Promise<string[]> {
    const out: string[] = [];
    let i = 0;
    while (i < list.length) {
        if (i + 1 < list.length && Math.random() < 0.5) { out.push(await composePair(list[i], list[i + 1])); i += 2; }
        else { out.push(list[i]); i += 1; }
    }
    return out;
}

export function CafeCustomerStudio({ clientId, onGoCharge }: { clientId: string | null; onGoCharge?: () => void }) {
    const [approved, setApproved] = useState<boolean | null>(null);
    const [board, setBoard] = useState<string | null>(null);
    const [company, setCompany] = useState<string | null>(null);
    const [brandDefault, setBrandDefault] = useState('');

    // 공통 업체정보
    const [brand, setBrand] = useState('');
    const [business, setBusiness] = useState('');

    // 모드
    const [mode, setMode] = useState<'keyword' | 'region'>('region');

    // 발행 요청(cafe_gen_requests) — finder 선택 키워드 → 발행PC(SUB1/SUB2) 대기열로.
    const [productKw, setProductKw] = useState(''); // finder 제품키워드(입주청소/사설경호/누수탐지…)
    const [reqBusy, setReqBusy] = useState(false);
    const [reqMsg, setReqMsg] = useState('');

    // SEO 키워드 찾기

    const [linkUrl, setLinkUrl] = useState('');   // 본문 끝 링크카드(홈페이지 등) — 저장 설정에 포함.
    // 발행 재사용 정보 — 네이버 로그인 + 발행 게시판(이름·주소). 저장 설정에 포함.
    const [naverId, setNaverId] = useState('');
    const [naverPw, setNaverPw] = useState('');
    const [showPw, setShowPw] = useState(false);
    const [boardName, setBoardName] = useState('');
    const [boardUrl, setBoardUrl] = useState('');
    // 업체가 넣는 이미지 — 메인배너(맨 위 1장) + 배너(카드) + 실사(현장사진). 두 모드 발행에 함께 사용.
    const [mainBanner, setMainBanner] = useState<string[]>([]);
    const [banners, setBanners] = useState<string[]>([]);
    const [photos, setPhotos] = useState<string[]>([]);

    // 값 저장하기 — 업체명·업종·홈페이지·유형·실사·마지막배너 저장/복원. 저장돼 있으면 '초기화'.
    const [settingsSaved, setSettingsSaved] = useState(false);
    const [savingSettings, setSavingSettings] = useState(false);
    const [settingsMsg, setSettingsMsg] = useState('');
    const saveSettings = async () => {
        if (!clientId) return;
        setSavingSettings(true); setSettingsMsg('');
        try {
            const photoPaths: string[] = [];
            for (let i = 0; i < photos.length; i += 1) { const p = await uploadStudioImage(clientId, 'photos', i, photos[i]); if (p) photoPaths.push(p); }
            const bannerPaths: string[] = [];
            for (let i = 0; i < banners.length; i += 1) { const p = await uploadStudioImage(clientId, 'banners', i, banners[i]); if (p) bannerPaths.push(p); }
            const { error } = await saveStudioSettings({
                client_id: clientId, brand: brand || null, business: business || null, homepage: linkUrl || null,
                deploy_type: mode === 'region' ? '지역형' : '키워드형', photos: photoPaths, banners: bannerPaths,
                naver_id: naverId || null, naver_pw: naverPw || null, board_name: boardName || null, board_url: boardUrl || null,
            });
            if (error) throw new Error(error.message);
            setSettingsSaved(true); setSettingsMsg('저장됨 · 다음부터 이 값으로 열립니다');
        } catch (e) { setSettingsMsg('저장 실패: ' + (e instanceof Error ? e.message : '')); }
        finally { setSavingSettings(false); }
    };
    const resetSettings = async () => {
        if (!clientId) return;
        await clearStudioSettings(clientId);
        setBrand(brandDefault); setBusiness(''); setLinkUrl(''); setPhotos([]); setBanners([]);
        setNaverId(''); setNaverPw(''); setBoardName(''); setBoardUrl('');
        setSettingsSaved(false); setSettingsMsg('초기화됨');
    };
    // 발행용 이미지 조립 — 실사를 랜덤으로 좌우페어/낱개 섞고, [상단배너 + 실사 + 끝배너] 순서·layout 반환.
    async function buildImages(): Promise<{ images: string[]; layout: { top: number; mid: number; tail: number } }> {
        const mids = photos.length ? await pairPhotosRandom(photos) : [];
        return { images: [...mainBanner, ...mids, ...banners], layout: { top: mainBanner.length, mid: mids.length, tail: banners.length } };
    }

    // 지역형 — 다중 지역셋 + 다중 SEO 키워드
    const [regionSets, setRegionSets] = useState<Set<RegionSet>>(() => new Set<RegionSet>(['서울']));
    const [selectedKw, setSelectedKw] = useState<Set<string>>(() => new Set());
    const [regionKw, setRegionKw] = useState('');
    const [count, setCount] = useState(3);
    const [rphase, setRphase] = useState<'idle' | 'scanning' | 'scanned' | 'publishing' | 'done'>('idle');
    const [scanRows, setScanRows] = useState<Array<{ label: string; status: string }>>([]);
    const [passed, setPassed] = useState<Array<{ region: string; keyword: string }>>([]);
    const [genRows, setGenRows] = useState<Array<{ label: string; status: string }>>([]);
    const [rmsg, setRmsg] = useState('');
    const toggleKw = (kw: string) => setSelectedKw((prev) => { const n = new Set(prev); if (n.has(kw)) n.delete(kw); else n.add(kw); return n; });
    const toggleSet = (s: RegionSet) => setRegionSets((prev) => { const n = new Set(prev); if (n.has(s)) n.delete(s); else n.add(s); return n; });

    // 발행 현황 — 관리자가 고객사 선택 발행 시엔 그 업체(들) 히스토리만. 고객 셀프뷰는 RLS로 본인만.
    const [jobs, setJobs] = useState<MyJob[]>([]);
    const companiesRef = useRef<string[]>([]); // 이 client 의 업체키들(theman/theman2 등) — 히스토리 필터
    async function loadJobs() {
        const cos = companiesRef.current;
        const { data } = (clientId && cos.length)
            ? await listCafeJobsByCompanies(cos, 10)
            : await listMyCafeJobs(10);
        setJobs(data as MyJob[]);
    }

    // 발행 토큰 잔액 — 발행 1건 = 1토큰. 0이면 발행 차단.
    const [tokenBal, setTokenBal] = useState(0);
    async function loadTokens() { if (clientId) { const { data } = await listTokens(clientId); setTokenBal(balanceOf(data)); } }

    // 기발행 지역(중복 제외) — 지역형이 이미 발행한 지역을 다시 안 쓰게. region 컬럼 + 옛 잡은 제목으로도 대조.
    const [usedRegions, setUsedRegions] = useState<Set<string>>(() => new Set());
    const [excludeUsed, setExcludeUsed] = useState(true);
    async function loadUsed() {
        const { rows } = await listMyPublishedPairs();
        const norm = (x: string) => x.replace(/\s/g, '');
        const stored = new Set(rows.map((r) => r.region).filter(Boolean).map((x) => norm(String(x))));
        const titles = rows.map((r) => norm(String(r.title || '')));
        const used = new Set<string>();
        Object.values(REGION_GROUPS).forEach((g) => g.forEach((r) => {
            const n = norm(r.label);
            if (stored.has(n) || titles.some((t) => t.includes(n))) used.add(r.label);
        }));
        setUsedRegions(used);
    }

    useEffect(() => {
        let alive = true;
        void getCafeAccounts().then(({ data }) => {
            if (!alive) return;
            // clientId 로 스코프(관리자가 고객사별 발행 시 그 업체 계정만). 고객 컨텍스트는 RLS로 이미 본인만.
            const scoped = clientId ? data.filter((x) => x.client_id === clientId) : data;
            companiesRef.current = scoped.map((x) => x.company_key).filter(Boolean); // 히스토리 필터용 업체키
            const enabled = scoped.find((x) => x.active && (x as { publish_enabled?: boolean }).publish_enabled !== false);
            setBoard(enabled?.board_name ?? null);
            setCompany(enabled?.company_key ?? null);
            setBrandDefault(enabled?.display_name ?? '');
            if (!brand && enabled?.display_name) setBrand(enabled.display_name);
            setApproved(!!enabled);
            void loadJobs(); // 업체키 세팅 후 로드(그 업체 히스토리만)
        });
        void loadUsed();
        void loadTokens();
        const t = setInterval(() => { void loadJobs(); }, 15000);
        return () => { alive = false; clearInterval(t); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [clientId]);

    // 저장된 발행 설정 불러오기 — 있으면 업체명·업종·홈페이지·유형·실사·배너 자동 채움('초기화' 표시).
    useEffect(() => {
        if (!clientId) { setSettingsSaved(false); return; }
        let alive = true;
        void getStudioSettings(clientId).then(async ({ data }) => {
            if (!alive || !data) return;
            if (data.brand) setBrand(data.brand);
            if (data.business) setBusiness(data.business);
            if (data.homepage) setLinkUrl(data.homepage);
            if (data.naver_id) setNaverId(data.naver_id);
            if (data.naver_pw) setNaverPw(data.naver_pw);
            if (data.board_name) setBoardName(data.board_name);
            if (data.board_url) setBoardUrl(data.board_url);
            if (data.deploy_type === '지역형') setMode('region');
            else if (data.deploy_type === '키워드형') setMode('keyword');
            const [ph, bn] = await Promise.all([signedStudioUrls(data.photos || []), signedStudioUrls(data.banners || [])]);
            if (!alive) return;
            if (ph.length) setPhotos(ph);
            if (bn.length) setBanners(bn);
            setSettingsSaved(true);
        });
        return () => { alive = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [clientId]);

    // 지역형 직접발행용 원고 1건 — 누수/청소 업종이면 더반·누수 longform 양식, 그 외는 후기 경로.
    async function genOne(kw: string, reg: string): Promise<{ title: string; body: string; tags: string[] }> {
        const kind = bizKind(business);
        const region2 = (reg || '').trim() || (kind ? deriveRegion(kw, business) : '');
        if (kind && region2) {
            const r = await generateLongform({ region: region2, businessKind: kind, brand: brand.trim() || brandDefault || undefined, phone: '' });
            return { title: r.title, body: r.body, tags: longformTags(kind, region2) };
        }
        const g = await generateCafe({ keyword: kw, region: reg || undefined, brand: brand.trim() || brandDefault || undefined, business: business.trim() || undefined });
        const rv = await generateCafeReview({ keyword: kw, region: reg || undefined, brand: brand.trim() || brandDefault || undefined, business: business.trim() || undefined, content: g.content, tone: 'review', count: 6, layout: 'bottom' });
        return { title: rv.title || '', body: rv.reviewBody || '', tags: [] };
    }

    async function addFiles(setter: (u: (prev: string[]) => string[]) => void, files: FileList | null, max: number) {
        if (!files || !files.length) return;
        try {
            const urls = await Promise.all(Array.from(files).slice(0, max).map(fileToDataUrl));
            setter((prev) => [...prev, ...urls].slice(0, max));
        } catch { /* 사진 변환 실패 무시 */ }
    }

    // 지역형: 선택 지역셋 × 선택 SEO 키워드 인기글 스캔 → 발행건수(N) 채우면 중단.
    async function runScan() {
        const kws = selectedKw.size ? [...selectedKw] : (regionKw.trim() ? [regionKw.trim()] : []);
        if (!kws.length) { setRmsg('SEO 키워드를 선택하거나 키워드를 입력하세요.'); return; }
        // ⚠️ 인기글 스캔은 내 PC(발행 프로그램)에서 한다 — CF/서버 IP 는 네이버가 차단한다.
        if (!(await nusu2Health())) {
            setRmsg('지역 스캔은 내 PC의 발행 프로그램(DDMKT-Agent)이 켜져 있어야 합니다. 프로그램을 켜고 다시 시도하세요.');
            return;
        }
        const sets = regionSets.size ? [...regionSets] : (['서울'] as RegionSet[]);
        // 후보 = 각 지역셋의 시·구 × 각 키워드 (지역 우선 훑기). 기발행 지역은 제외(중복 방지).
        const cands: Array<{ region: string; scans: string[]; keyword: string }> = [];
        for (const set of sets) for (const r of REGION_GROUPS[set]) for (const kw of kws) {
            if (excludeUsed && usedRegions.has(r.label)) continue;   // 이미 발행한 지역 건너뜀
            cands.push({ region: r.label, scans: r.scans, keyword: kw });
        }
        if (!cands.length) { setRmsg('발행할 새 지역이 없습니다(선택 지역이 모두 기발행). "기발행 지역 제외"를 끄거나 다른 지역을 선택하세요.'); return; }
        setRmsg(''); setRphase('scanning'); setGenRows([]); setPassed([]);
        const rows = cands.map((c) => ({ label: `${c.region} ${c.keyword}`, status: '대기' }));
        setScanRows([...rows]);
        const hit: Array<{ region: string; keyword: string }> = [];
        for (let i = 0; i < cands.length; i += 1) {
            rows[i] = { ...rows[i], status: '검사중' }; setScanRows([...rows]);
            try {
                let ok = false;
                for (const s of cands[i].scans) {
                    const { hasPopular } = await checkPopularBridge(`${s} ${cands[i].keyword}`);
                    if (hasPopular) { ok = true; break; }
                }
                rows[i] = { ...rows[i], status: ok ? '통과' : '없음' };
                if (ok) hit.push({ region: cands[i].region, keyword: cands[i].keyword });
            } catch { rows[i] = { ...rows[i], status: '오류' }; }
            setScanRows([...rows]); setPassed([...hit]);
            if (hit.length >= count) break;   // 발행건수 채우면 중단
        }
        setPassed(hit); setRphase('scanned');
        setRmsg(hit.length >= count ? `${count}건 확보(인기글 지역)` : `${hit.length}건 가능(후보 소진)`);
    }

    // 지역형: 스캔 생략하고 선택 지역 × 키워드 앞 N개를 바로 발행(테스트/지정발행용 — 인기글 검사 없음).
    async function runDirectPublish() {
        const kws = selectedKw.size ? [...selectedKw] : (regionKw.trim() ? [regionKw.trim()] : []);
        if (!kws.length) { setRmsg('SEO 키워드를 선택하거나 키워드를 입력하세요.'); return; }
        const sets = regionSets.size ? [...regionSets] : (['서울'] as RegionSet[]);
        const cands: Array<{ region: string; keyword: string }> = [];
        for (const set of sets) { for (const r of REGION_GROUPS[set]) { for (const kw of kws) {
            if (excludeUsed && usedRegions.has(r.label)) continue;   // 이미 발행한 지역 건너뜀
            cands.push({ region: r.label, keyword: kw });
        } } }
        if (!cands.length) { setRmsg('발행할 새 지역이 없습니다(선택 지역이 모두 기발행). "기발행 지역 제외"를 끄거나 다른 지역을 선택하세요.'); return; }
        const targets = cands.slice(0, count);
        setPassed(targets); setScanRows([]); setRphase('scanned');
        setRmsg(`스캔 없이 ${targets.length}건 발행(인기글 검사 생략)`);
        await runPublishRegion(targets);
    }

    // 지역형: 통과분(최대 N) 생성·발행.
    async function runPublishRegion(targetsArg?: Array<{ region: string; keyword: string }>) {
        const src = targetsArg ?? passed;
        if (!src.length) return;
        if (tokenBal <= 0) { setRmsg('발행 토큰이 없습니다. 충전 후 이용해 주세요. (충전내역 탭)'); return; }
        setRphase('publishing');
        const targets = src.slice(0, Math.min(count, tokenBal));   // 잔여 토큰만큼만 발행
        if (targets.length < src.slice(0, count).length) setRmsg(`토큰 ${tokenBal}건만큼만 발행합니다(잔여 부족).`);
        let remaining = tokenBal;
        const rows = targets.map((p) => ({ label: `${p.region} ${p.keyword}`, status: '대기' }));
        setGenRows([...rows]);
        for (let i = 0; i < targets.length; i += 1) {
            if (remaining <= 0) { rows[i] = { ...rows[i], status: '토큰 부족' }; setGenRows([...rows]); continue; }
            rows[i] = { ...rows[i], status: '원고 생성중…' }; setGenRows([...rows]);
            try {
                const p = targets[i];
                const r = await genOne(`${p.region} ${p.keyword}`, p.region);
                rows[i] = { ...rows[i], status: '발행 등록중…' }; setGenRows([...rows]);
                const links = linkUrl.trim() ? [linkUrl.trim()] : [];
                const { images, layout } = await buildImages();   // 실사 랜덤 좌우페어/낱개(발행마다 다르게)
                const { error } = await createCustomerPublishJob({ title: r.title, body: r.body, images, layout, tags: r.tags, links, region: p.region, keyword: p.keyword });
                if (!error && clientId) { await consumeToken(clientId, `발행: ${p.region} ${p.keyword}`); remaining -= 1; setTokenBal(remaining); }
                rows[i] = { ...rows[i], status: error ? '실패' : '큐 등록 완료' };
            } catch (e) { rows[i] = { ...rows[i], status: `실패: ${(e as Error).message?.slice(0, 30)}` }; }
            setGenRows([...rows]);
        }
        setRphase('done'); void loadJobs(); void loadUsed();
    }

    const imageZone = (label: string, hint: string, list: string[], setter: (u: (prev: string[]) => string[]) => void, max: number) => (
        <div className="grid gap-1 text-xs font-semibold text-[#475569]">
            {label} <span className="font-normal text-[#94a3b8]">{hint}</span>
            <label className="inline-flex h-9 w-fit cursor-pointer items-center rounded-lg border border-[#cbd5e1] bg-white px-3 text-sm font-normal text-[#334155] hover:bg-[#f8fafc]">
                이미지 추가
                <input accept="image/*" className="hidden" multiple onChange={(e) => { void addFiles(setter, e.target.files, max); e.target.value = ''; }} type="file" />
            </label>
            {list.length ? (
                <div className="mt-1 flex flex-wrap gap-2">
                    {list.map((src, i) => (
                        <div className="relative" key={i}>
                            <img alt={`${label} ${i + 1}`} className="h-16 w-16 rounded-md border border-[#e2e8f0] object-cover" src={src} />
                            <button className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-[#dc2626] text-[11px] font-bold text-white" onClick={() => setter((p) => p.filter((_, j) => j !== i))} type="button">×</button>
                        </div>
                    ))}
                </div>
            ) : <span className="text-[11px] font-normal text-[#cbd5e1]">아직 없음</span>}
        </div>
    );

    if (approved === false) return <CafeCustomerRequest clientId={clientId} />;

    // 토큰 소진(잔여 0) — 발행 사용 불가 + 연장(충전) 안내. (approved 상태는 유지되어 탭은 그대로 노출)
    if (approved && tokenBal <= 0) {
        return (
            <div className="rounded-2xl border-2 border-[#fb923c] bg-[#fff7ed] p-10 text-center">
                <div className="text-2xl">🎫</div>
                <div className="mt-2 text-lg font-bold text-[#9a3412]">발행 토큰이 모두 소진되었습니다</div>
                <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[#7c2d12]">
                    자동화 발행을 계속하시려면 토큰을 연장(충전)해 주세요. 충전이 완료되면 바로 다시 발행하실 수 있습니다.
                </p>
                <button type="button" onClick={() => onGoCharge?.()}
                    className="mt-5 rounded-lg bg-[#c2410c] px-6 py-2.5 text-sm font-bold text-white hover:bg-[#9a3412]">
                    연장(충전)하기 →
                </button>
            </div>
        );
    }

    const inputCls = 'h-10 rounded-lg border border-[#cbd5e1] bg-white px-3 text-sm';

    return (
        <div className="grid gap-4">
            <div className="rounded-lg bg-[#eff6ff] px-4 py-3 text-sm text-[#1e40af]">
                발행 대상 게시판: <b>{board ?? '(확인 중)'}</b>
                <span className="ml-2 text-[#64748b]">— 발행하면 본인 카페의 이 게시판에 자동 게시됩니다.</span>
            </div>

            {/* 발행 유형 먼저 선택 — 지역형 / 키워드형 · 우측: 값 저장/초기화 */}
            <div className="flex items-center gap-1 border-b border-[#e2e8f0]">
                {([['region', '지역형'], ['keyword', '키워드형']] as const).map(([k, name]) => (
                    <button className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold ${mode === k ? 'border-[#1e40af] text-[#1e40af]' : 'border-transparent text-[#94a3b8]'}`} key={k} onClick={() => setMode(k)} type="button">{name}</button>
                ))}
                {settingsMsg ? <span className="ml-auto mr-2 text-[11px] font-semibold text-[#059669]">{settingsMsg}</span> : null}
                <button
                    type="button"
                    onClick={() => void (settingsSaved ? resetSettings() : saveSettings())}
                    disabled={savingSettings}
                    className={`${settingsMsg ? '' : 'ml-auto'} mb-1 shrink-0 rounded-md px-3 py-1.5 text-xs font-bold disabled:opacity-50 ${settingsSaved ? 'border border-[#cbd5e1] bg-white text-[#64748b] hover:bg-[#f1f5f9]' : 'bg-[#4338ca] text-white hover:bg-[#3730a3]'}`}
                    title="업체명·업종·홈페이지·유형·실사·마지막배너를 저장 — 다음 선택 시 자동 복원"
                >
                    {savingSettings ? '저장 중…' : settingsSaved ? '초기화' : '값 저장하기'}
                </button>
            </div>

            {/* 공통 업체정보 */}
            <div className="rounded-xl border border-[#e2e8f0] bg-white p-4">
                <div className="grid gap-3 sm:grid-cols-2">
                    <label className="grid gap-1 text-xs font-semibold text-[#475569]">업체명
                        <input className={inputCls} onChange={(e) => setBrand(e.target.value)} placeholder={brandDefault || '업체명'} value={brand} />
                    </label>
                    <label className="grid gap-1 text-xs font-semibold text-[#475569]">업종
                        <input className={inputCls} onChange={(e) => setBusiness(e.target.value)} placeholder="예) 입주청소" value={business} />
                    </label>
                </div>
                <label className="mt-3 grid gap-1 text-xs font-semibold text-[#475569]">홈페이지·링크 (선택) — 본문 맨 끝에 링크카드로 삽입
                    <input className={inputCls} onChange={(e) => setLinkUrl(e.target.value)} placeholder="예) https://내홈페이지.com (더반·누수처럼 글 마지막에 카드로 배치)" value={linkUrl} />
                </label>
            </div>

            {/* 발행 계정·게시판 — 네이버 로그인 + 발행 게시판(이름·주소). '값 저장하기'에 함께 저장돼 재사용 */}
            <div className="rounded-xl border border-[#e2e8f0] bg-white p-4">
                <div className="mb-3 text-[13px] font-bold text-[#334155]">발행 계정·게시판 <span className="font-normal text-[#94a3b8]">— 값 저장하기 시 함께 저장되어 다음 발행에 재사용됩니다</span></div>
                <div className="grid gap-3 sm:grid-cols-2">
                    <label className="grid gap-1 text-xs font-semibold text-[#475569]">네이버 아이디
                        <input className={inputCls} autoComplete="off" onChange={(e) => setNaverId(e.target.value)} placeholder="발행에 사용할 네이버 아이디" value={naverId} />
                    </label>
                    <label className="grid gap-1 text-xs font-semibold text-[#475569]">네이버 비밀번호
                        <span className="relative flex">
                            <input className={`${inputCls} w-full pr-14`} autoComplete="new-password" type={showPw ? 'text' : 'password'} onChange={(e) => setNaverPw(e.target.value)} placeholder="비밀번호" value={naverPw} />
                            <button type="button" onClick={() => setShowPw((v) => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] font-semibold text-[#64748b]">{showPw ? '숨김' : '표시'}</button>
                        </span>
                    </label>
                    <label className="grid gap-1 text-xs font-semibold text-[#475569]">발행 게시판 이름
                        <input className={inputCls} onChange={(e) => setBoardName(e.target.value)} placeholder="예) 시설경호업체" value={boardName} />
                    </label>
                    <label className="grid gap-1 text-xs font-semibold text-[#475569]">발행 게시판 주소
                        <input className={inputCls} onChange={(e) => setBoardUrl(e.target.value)} placeholder="예) https://cafe.naver.com/…/menuid" value={boardUrl} />
                    </label>
                </div>
            </div>

            {/* 발행 이미지 — 업체가 넣는 메인배너·배너·실사(모든 발행에 함께 게시) */}
            <div className="rounded-xl border border-[#e2e8f0] bg-white p-4">
                <div className="mb-3 text-[13px] font-bold text-[#334155]">발행 이미지 (업체 배너·실사) <span className="font-normal text-[#94a3b8]">— 모든 발행에 함께 들어갑니다</span></div>
                <div className="grid gap-4 sm:grid-cols-3">
                    {imageZone('상단 배너', '(맨 위 · 1장)', mainBanner, setMainBanner, 1)}
                    {imageZone('실사 사진', '(문단 사이 · 8~20장 · 2장 좌우/낱개 랜덤)', photos, setPhotos, 20)}
                    {imageZone('끝 배너', '(맨 끝 · 1장 · 예: 예약 전 주의사항)', banners, setBanners, 2)}
                </div>
                <p className="m-0 mt-2 text-[11px] text-[#94a3b8]">배치: <b>상단 배너 1장</b> → <b>실사(문단 사이 · 발행마다 2장 좌우/낱개 랜덤)</b> → <b>끝 배너 1장</b> (더반·누수 스타일). 배너 남발 금지, 실사 위주. 넣지 않으면 텍스트만 발행됩니다.</p>
            </div>

            {/* SEO 키워드 찾기 — 접수(고객ERP)와 동일: 검색량 + SUB4 정확 인기탭 분석(최대 50) + 선택. */}
            <CafeKeywordFinder
                clientId={clientId}
                mode={mode}
                onPick={(kws, pk) => {
                    setSelectedKw(new Set(kws));
                    setProductKw(pk);
                    if (kws[0] && mode === 'region') setRegionKw(kws[0]);
                }}
            />
            {/* 발행 요청 보내기 — 고른 키워드를 발행PC 대기열(cafe_gen_requests)로. 원고·이미지는 그 PC가 자기 양식으로 생성·게시. */}
            {(() => {
                const target = publishTargetFor(company);
                const n = selectedKw.size;
                if (!target) return null;
                const send = async () => {
                    if (!n) { setReqMsg('finder에서 발행할 키워드를 고르세요.'); return; }
                    setReqBusy(true); setReqMsg('');
                    const { error, count } = await enqueueGenRequests(company!, [...selectedKw], productKw);
                    setReqBusy(false);
                    if (error) { setReqMsg(`요청 실패: ${error.message}`); return; }
                    setReqMsg(`${count}건 발행 요청 전송 완료 — ${target.pc} 발행 대기열에 담겼습니다(그 PC가 순차 게시).`);
                    setSelectedKw(new Set());
                };
                return (
                    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[#c4b5fd] bg-[#f5f3ff] p-3">
                        <div className="text-[13px] font-bold text-[#6d28d9]">발행 요청 → {target.pc} <span className="font-normal text-[#94a3b8]">(게시판: {target.board})</span></div>
                        <button type="button" onClick={() => void send()} disabled={reqBusy || !n}
                            className="ml-auto h-10 rounded-lg bg-[#7c3aed] px-5 text-sm font-bold text-white hover:bg-[#6d28d9] disabled:opacity-50">
                            {reqBusy ? '전송 중…' : `${target.pc} 발행 요청 (${n}건)`}
                        </button>
                        {reqMsg ? <span className="w-full text-[12px] font-semibold text-[#166534]">{reqMsg}</span> : null}
                    </div>
                );
            })()}

            {mode === 'region' ? (
                <div className="rounded-xl border border-[#e2e8f0] bg-white p-4">
                    <div className="mb-1 text-[13px] font-bold text-[#334155]">지역형 — 지역 × SEO키워드 인기글 스캔 후 통과분만 발행</div>
                    <div className="mb-3 text-[11px] text-[#94a3b8]">선택한 지역들의 시·구 × 선택한 키워드 조합을 인기글 검사 → 발행 건수만큼 채우면 멈춥니다.</div>

                    {/* 지역 다중 선택 */}
                    <div className="mb-3 grid gap-1 text-xs font-semibold text-[#475569]">지역 (여러 개 선택 가능)
                        <div className="flex flex-wrap gap-2">
                            {(['서울', '경기', '인천'] as RegionSet[]).map((g) => {
                                const on = regionSets.has(g);
                                return (
                                    <button className={`rounded-full px-3 py-1 text-[12px] font-semibold ${on ? 'bg-[#1e40af] text-white' : 'bg-[#f1f5f9] text-[#64748b]'}`} key={g} onClick={() => toggleSet(g)} type="button">
                                        {on ? '✓ ' : ''}{g} ({REGION_GROUPS[g].length})
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* 키워드 = SEO 선택분 (없으면 직접 입력) */}
                    <div className="mb-3 grid gap-1 text-xs font-semibold text-[#475569]">키워드
                        {selectedKw.size ? (
                            <div className="flex flex-wrap gap-1.5">
                                {[...selectedKw].map((kw) => (
                                    <span className="inline-flex items-center gap-1 rounded-full bg-[#e0e7ff] px-2 py-0.5 text-[11px] font-semibold text-[#3730a3]" key={kw}>
                                        {kw}<button className="text-[#6366f1]" onClick={() => toggleKw(kw)} type="button">×</button>
                                    </span>
                                ))}
                                <span className="self-center text-[11px] font-normal text-[#94a3b8]">↑ 위 SEO 결과에서 클릭해 선택</span>
                            </div>
                        ) : (
                            <input className={inputCls} onChange={(e) => setRegionKw(e.target.value)} placeholder="SEO에서 선택하거나 직접 입력 (예: 입주청소)" value={regionKw} />
                        )}
                    </div>

                    <label className="grid max-w-[160px] gap-1 text-xs font-semibold text-[#475569]">발행 건수
                        <input className={inputCls} max={10} min={1} onChange={(e) => setCount(Math.max(1, Math.min(10, Number(e.target.value) || 1)))} type="number" value={count} />
                    </label>

                    <label className="mt-3 flex items-center gap-2 text-xs font-semibold text-[#475569]">
                        <input checked={excludeUsed} onChange={(e) => setExcludeUsed(e.target.checked)} type="checkbox" />
                        이미 발행한 지역 제외 {usedRegions.size ? <span className="font-normal text-[#94a3b8]">(기발행 {usedRegions.size}곳: {[...usedRegions].slice(0, 8).join(', ')}{usedRegions.size > 8 ? '…' : ''})</span> : <span className="font-normal text-[#94a3b8]">(아직 없음)</span>}
                    </label>

                    <div className="mt-3 flex flex-wrap items-center gap-2">
                        <button className="h-10 rounded-lg bg-[#4338ca] px-5 text-sm font-bold text-white disabled:opacity-50" disabled={rphase === 'scanning' || rphase === 'publishing'} onClick={() => void runScan()} type="button">{rphase === 'scanning' ? '스캔 중…' : '인기글 스캔'}</button>
                        {rphase === 'scanned' && passed.length ? (
                            <button className="h-10 rounded-lg bg-[#0f766e] px-5 text-sm font-bold text-white disabled:opacity-50" onClick={() => void runPublishRegion()} type="button">{Math.min(passed.length, count)}건 생성·발행</button>
                        ) : null}
                        <button className="h-10 rounded-lg border border-[#94a3b8] px-4 text-sm font-semibold text-[#475569] disabled:opacity-50" disabled={rphase === 'scanning' || rphase === 'publishing'} onClick={() => void runDirectPublish()} type="button" title="인기글 검사 없이 선택 지역 그대로 발행(테스트/지정발행)">스캔 없이 바로 발행</button>
                        {rmsg ? <span className="text-[13px] text-[#4338ca]">{rmsg}</span> : null}
                    </div>
                    {scanRows.length ? (
                        <div className="mt-3 flex flex-wrap gap-1.5">
                            {scanRows.filter((r) => r.status !== '대기').slice(0, 120).map((r) => (
                                <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${r.status === '통과' ? 'bg-[#1e5bd8] text-white' : r.status === '검사중' ? 'bg-[#fef9c3] text-[#854d0e]' : r.status === '오류' ? 'bg-[#fee2e2] text-[#991b1b]' : 'bg-[#f1f5f9] text-[#94a3b8]'}`} key={r.label}>
                                    {r.status === '통과' ? '✓ ' : ''}{r.label}
                                </span>
                            ))}
                        </div>
                    ) : null}
                    {genRows.length ? (
                        <div className="mt-3 rounded-lg border border-[#e2e8f0] bg-[#f8fafc] p-3">
                            {genRows.map((r) => (
                                <div className="flex items-center justify-between border-b border-[#f1f5f9] py-1 text-[12px] last:border-0" key={r.label}>
                                    <span className="font-semibold text-[#334155]">{r.label}</span>
                                    <span className={r.status.includes('완료') ? 'text-[#166534]' : r.status.includes('실패') ? 'text-[#991b1b]' : 'text-[#64748b]'}>{r.status}</span>
                                </div>
                            ))}
                        </div>
                    ) : null}
                    <div className="mt-2 text-[11px] text-[#94a3b8]">※ 지역형은 발행 건수만큼 한 번에 생성·발행합니다(원고 자동생성 = 비용 발생). 발행은 내 PC 프로그램이 간격 두고 순차 게시.</div>
                </div>
            ) : null}

            {/* 히스토리(발행 현황) */}
            <div className="rounded-xl border border-[#e2e8f0] bg-white p-4">
                <div className="mb-2 flex items-center justify-between">
                    <div className="text-[13px] font-bold text-[#334155]">발행 히스토리</div>
                    <button className="text-xs font-semibold text-[#4338ca] hover:underline" onClick={() => void loadJobs()} type="button">새로고침</button>
                </div>
                {jobs.length ? (
                    <div className="divide-y divide-[#f1f5f9]">
                        {jobs.map((j) => {
                            const st = STATUS_KO[j.status] ?? j.status;
                            const color = j.status === 'done' ? 'text-[#166534]' : j.status === 'fail' ? 'text-[#991b1b]' : 'text-[#64748b]';
                            return (
                                <div className="flex items-center justify-between gap-3 py-1.5 text-[12px]" key={j.id}>
                                    <span className="min-w-0 flex-1 truncate text-[#334155]">{j.title}</span>
                                    {j.posted_url ? <a className="shrink-0 text-[#2563eb] hover:underline" href={j.posted_url} rel="noreferrer" target="_blank">게시글 보기</a> : null}
                                    <span className={`shrink-0 font-semibold ${color}`}>{st}</span>
                                </div>
                            );
                        })}
                    </div>
                ) : <div className="py-4 text-center text-[12px] text-[#94a3b8]">아직 발행 내역이 없습니다.</div>}
            </div>
        </div>
    );
}
