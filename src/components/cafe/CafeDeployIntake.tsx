import { useEffect, useState } from 'react';
import {
    submitCafeDeployRequest,
    listCafeDeployRequests,
    listDeployCredentials,
    getClientPublishedKeywords,
    uploadDeployPhoto,
    signedDeployUrls,
    PAYMENT_INFO,
    deployAmountKRW,
    type CafeDeployRequest,
    type CafeDeployInput,
    type DeployPhotos,
    type DeployCredential,
} from '../../api/cafeDeployRequests';
import { enqueuePlaceScan, pollPlaceScan, type KwResult } from '../../api/cafeKwScan';

const REGION_KEYS = ['서울', '경기', '인천'] as const; // 지역형 지역셋

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
    deploy_type: '지역형', region_sets: [],
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
    const [form, setForm] = useState<CafeDeployInput>(empty);
    const [files, setFiles] = useState<Record<Grp, File[]>>({ main: [], real: [], banner: [] });
    const [rows, setRows] = useState<CafeDeployRequest[]>([]);
    const [urls, setUrls] = useState<Record<string, string>>({});
    const [creds, setCreds] = useState<Record<string, DeployCredential>>({}); // deploy_request_id → 계정
    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState('');

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
    // 접수 유형 — 지역형(지역+제품키워드) / 키워드형(플레이스 주소 기반)
    const isKw = form.deploy_type === '키워드형';
    const regionSel = form.region_sets || [];
    const toggleRegion = (r: string) => {
        const cur = new Set(regionSel);
        if (cur.has(r)) cur.delete(r); else cur.add(r);
        set('region_sets', Array.from(cur));
    };
    const addFiles = (g: Grp, list: FileList | null) => {
        if (!list?.length) return;
        const arr = Array.from(list); // 동기적으로 캡처(input.value='' 초기화 전에) — 안 하면 목록이 비어 등록 안 됨
        setFiles((f) => ({ ...f, [g]: [...f[g], ...arr] }));
    };
    const removeFile = (g: Grp, i: number) => setFiles((f) => ({ ...f, [g]: f[g].filter((_, j) => j !== i) }));
    const totalFiles = files.main.length + files.real.length + files.banner.length;

    // 인기글 조회 — 지역형=키워드→검색량 / 키워드형=플레이스주소→업체명 추출→검색량. 차단 0·즉시(순수 웹).
    const [volLoading, setVolLoading] = useState(false);
    const [vol, setVol] = useState<{ keyword: string; pc: number; mobile: number; total: number }[] | null>(null);
    const [volErr, setVolErr] = useState('');
    const [volName, setVolName] = useState(''); // 키워드형: 추출된 업체명

    // 정확 인기탭 분석(키워드형) — cafe_kw_requests 큐 → 워커(우리 IP: 사무실 유선/main, 크롤 겹치면 CF) → 진짜 인기탭 결과.
    const [kwLoading, setKwLoading] = useState(false);
    const [kwResult, setKwResult] = useState<KwResult[] | null>(null);
    const [kwErr, setKwErr] = useState('');
    const [kwExpanded, setKwExpanded] = useState(false); // '더 보기'로 전체(target 상향) 스캔 완료 여부
    const [kwHidden, setKwHidden] = useState<string[]>([]); // X로 제외한 키워드(화면에서만 숨김)
    const [kwPicked, setKwPicked] = useState<KwResult[]>([]); // 고객이 고른 키워드(발행 대상 → 접수에 전달)
    const [pickedOpen, setPickedOpen] = useState(false); // 선택 키워드 드롭다운 펼침(기본 접힘 · 우측 N개)
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
    // target=10 기본(빠름). '더 보기'로 50까지 올려 후보 풀 전체를 훑는다(수 분 소요).
    //   실제 개수는 그 플레이스의 인기글 진입 키워드 수가 상한(지역형=많음, 맛집 니치=적음).
    const runPlaceScan = async (target = 10) => {
        const u = (form.url || '').trim();
        if (!u) { setKwErr('플레이스 주소를 입력하세요.'); return; }
        setKwErr(''); setKwLoading(true);
        if (target <= 10) { setKwResult(null); setKwExpanded(false); setKwHidden([]); setKwPicked([]); }
        try {
            const { id, error } = await enqueuePlaceScan(u, target, (form.region_sets?.length ? form.region_sets.join(',') : '서울,경기,인천'));
            if (error || !id) throw new Error(error?.message || '요청 실패');
            // 대량(50개) 스캔은 수 분 걸릴 수 있어 폴링 타임아웃을 넉넉히(10분).
            const { result } = await pollPlaceScan(id, { timeoutSec: target > 10 ? 600 : 180 });
            setKwResult(result);
            if (target > 10) setKwExpanded(true);
        } catch (e) {
            setKwErr(e instanceof Error ? e.message : '분석 실패');
        } finally {
            setKwLoading(false);
        }
    };
    const lookupVolume = async () => {
        let apiUrl: string;
        if (form.deploy_type === '키워드형') {
            const u = (form.url || '').trim();
            if (!u) { setVolErr('플레이스 주소를 입력하세요.'); setVol(null); return; }
            apiUrl = `https://ddmkt-erp.pages.dev/api/place-keywords?url=${encodeURIComponent(u)}`;
        } else {
            const q = (form.keyword || '').trim();
            if (!q) { setVolErr('제품 키워드를 입력하세요. 예: 입주청소'); setVol(null); return; }
            apiUrl = `https://ddmkt-erp.pages.dev/api/naver-keywords?q=${encodeURIComponent(q)}`;
        }
        setVolErr(''); setVolName(''); setVolLoading(true); setVol(null);
        try {
            const res = await fetch(apiUrl);
            const d = await res.json();
            if (!res.ok) throw new Error(d.error || '조회 실패');
            if (d.name) setVolName(d.name);
            setVol((d.keywords || []).slice(0, 20));
        } catch (e) {
            setVolErr(e instanceof Error ? e.message : '조회 실패');
        } finally {
            setVolLoading(false);
        }
    };

    const submit = async () => {
        if (!clientId) return setMsg('고객 계정이 연결되어 있지 않습니다. 담당자에게 문의하세요.');
        if (!form.company_name.trim()) return setMsg('업체명을 입력하세요.');
        if (form.daily_count != null && form.daily_count > 5) return setMsg('일 발행건수는 최대 5건입니다.');
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
                    if (error || !path) throw new Error(error || '업로드 실패');
                    photos[g].push(path);
                }
            }
        } catch (e) {
            setBusy(false);
            return setMsg('사진 업로드 실패: ' + (e instanceof Error ? e.message : ''));
        }
        const summary = GROUPS.map((g) => (photos[g.key].length ? `${g.label} ${photos[g.key].length}` : '')).filter(Boolean).join(' · ');
        const picks = kwPicked.map((p) => ({ keyword: p.keyword, volume: p.volume ?? null, theme: p.theme ?? null }));
        const { error } = await submitCafeDeployRequest(clientId, { ...form, photos, photo_provided: summary, selected_keywords: picks });
        setBusy(false);
        if (error) return setMsg(`접수 실패: ${error.message}`);
        setMsg('접수되었습니다. 담당자 확인 후 세팅해 드립니다.');
        setForm(empty); setFiles({ main: [], real: [], banner: [] });
        setKwResult(null); setKwPicked([]); setKwHidden([]); setKwExpanded(false); setPickedOpen(false);
        reload();
    };

    const inputCls = 'h-10 w-full rounded-md border border-[#cbd5e1] px-3 text-sm outline-none focus:border-[#4338ca]';
    const labelCls = 'mb-1 block text-[13px] font-semibold text-[#334155]';

    const pendingPay = rows.filter((r) => r.status === '결제대기');

    return (
        <div className="grid gap-5">
            {/* 결제 안내 알림 — 접수가 '승인(결제대기)'되면 노출 */}
            {pendingPay.length ? (
                <div className="rounded-xl border-2 border-[#fb923c] bg-[#fff7ed] p-5">
                    <div className="mb-1 flex items-center gap-2">
                        <span className="text-lg">🔔</span>
                        <span className="text-[15px] font-bold text-[#9a3412]">결제 안내 — 접수가 승인되었습니다</span>
                    </div>
                    <p className="mb-3 mt-0 text-[13px] text-[#7c2d12]">아래 계좌로 입금해 주시면 확인 후 발행이 시작됩니다. <b>발행 1건 = {PAYMENT_INFO.unitPrice.toLocaleString('ko-KR')}원</b></p>
                    <div className="grid gap-2">
                        {pendingPay.map((r) => {
                            const amt = deployAmountKRW(r);
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
                        <div className="mt-0.5 text-[12px] text-[#64748b]">{PAYMENT_INFO.note}</div>
                        {PAYMENT_INFO.cardAvailable ? (
                            <div className="mt-1.5 flex items-center gap-1.5 border-t border-[#fed7aa] pt-1.5">
                                <span className="rounded bg-[#e2e8f0] px-1.5 py-0.5 text-[10px] font-bold text-[#475569]">카드결제</span>
                                <span className="text-[12px] text-[#64748b]">{PAYMENT_INFO.cardNote}</span>
                            </div>
                        ) : null}
                        <div className="mt-1.5 text-[12px] text-[#9a3412]">입금(또는 카드결제) 후 <b>‘충전 내역’ 탭</b>에서 충전 요청을 눌러주시면 담당자가 확인하고 발행 토큰을 지급합니다.</div>
                    </div>
                </div>
            ) : null}

            {/* 접수 폼 */}
            <div className="rounded-xl border border-[#e2e8f0] bg-white p-5">
                <div className="mb-1 text-[15px] font-bold text-[#0f172a]">카페 배포 접수</div>
                <p className="mb-4 mt-0 text-[13px] text-[#64748b]">배포를 원하시는 내용과 사진을 접수해 주세요. 담당자 확인 후 세팅해 드립니다. (금액·정산은 별도 안내)</p>

                {/* 접수 유형 토글 */}
                <div className="mb-4">
                    <label className={labelCls}>접수 유형</label>
                    <div className="inline-flex rounded-lg border border-[#cbd5e1] p-0.5">
                        {(['지역형', '키워드형'] as const).map((t) => (
                            <button key={t} type="button" onClick={() => set('deploy_type', t)}
                                className={`rounded-md px-4 py-1.5 text-sm font-bold ${form.deploy_type === t ? 'bg-[#4338ca] text-white' : 'text-[#64748b] hover:text-[#334155]'}`}>
                                {t}
                            </button>
                        ))}
                    </div>
                    <p className="mb-0 mt-1 text-[11px] text-[#94a3b8]">
                        {isKw ? '키워드형 — 플레이스 주소 기반으로 키워드를 잡습니다(맛집 등).' : '지역형 — 서울/경기/인천 지역 선택 + 제품키워드(예: 입주청소·상가청소)로 지역+키워드를 잡습니다.'}
                    </p>
                </div>

                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <div className="md:col-span-2">
                        <label className={labelCls}>업체명 *</label>
                        <input className={inputCls} value={form.company_name} onChange={(e) => set('company_name', e.target.value)} placeholder="test" />
                    </div>
                    <div className="md:col-span-2">
                        <label className={labelCls}>{isKw ? '플레이스 주소 (URL) *' : '홈페이지 (선택)'}</label>
                        <div className="flex gap-2">
                            <input className={inputCls} value={form.url} onChange={(e) => set('url', e.target.value)} placeholder={isKw ? 'https://naver.me/... 또는 place.naver.com/...' : 'www.homepage.com'} />
                            {isKw ? (
                                <>
                                    <button type="button" onClick={() => void lookupVolume()} disabled={volLoading} className="h-10 shrink-0 rounded-md bg-[#0369a1] px-4 text-sm font-bold text-white hover:bg-[#075985] disabled:opacity-50">
                                        {volLoading ? '조회 중…' : '인기글 조회'}
                                    </button>
                                    <button type="button" onClick={() => void runPlaceScan()} disabled={kwLoading} className="h-10 shrink-0 rounded-md bg-[#7c3aed] px-4 text-sm font-bold text-white hover:bg-[#6d28d9] disabled:opacity-50" title="워커가 실제 인기글 섹션을 확인(수초~수십초)">
                                        {kwLoading ? '분석 중…' : '정확 인기탭 분석'}
                                    </button>
                                </>
                            ) : null}
                        </div>
                        {isKw ? <p className="mb-0 mt-1 text-[11px] text-[#94a3b8]">인기글 조회=업체명 기반 검색량(즉시). 정확 인기탭 분석=실제 인기글 섹션 확인(큐 처리, 수초~수십초).</p> : null}
                        {kwErr && <p className="mb-0 mt-1 text-[12px] text-[#dc2626]">{kwErr}</p>}
                        {kwPicked.length ? (
                            <div className="mt-2 rounded-lg border border-[#c7d2fe] bg-[#eef2ff]">
                                {/* 접힘 기본 — 헤더 좌: 라벨 / 우: 선택 개수. 클릭 시 드롭다운 펼침 */}
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
                                <div className="mb-1 text-[11px] font-semibold text-[#6d28d9]">정확 인기탭 결과 — 진입한 키워드 중 발행할 것을 고르세요(복수 선택). 필요없는 건 × 로 제외.</div>
                                {fresh.length === 0 ? (
                                    <div className="py-2 text-center text-[12px] text-[#94a3b8]">{used.length ? '새로운 키워드가 없습니다(모두 이미 사용·발행함).' : '인기탭 잡힌 키워드가 없습니다.'}</div>
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
                                {kwResult.length >= 10 && !kwExpanded ? (
                                    <button
                                        type="button"
                                        onClick={() => void runPlaceScan(50)}
                                        disabled={kwLoading}
                                        className="mt-1.5 w-full rounded-md border border-[#c4b5fd] bg-white py-1.5 text-[12px] font-bold text-[#6d28d9] hover:bg-[#f5f3ff] disabled:opacity-50"
                                        title="후보 키워드를 더 깊이 스캔합니다(최대 50개, 수 분 소요)"
                                    >
                                        {kwLoading ? '전체 스캔 중… (수 분 소요)' : '더 보기 — 인기탭 진입 키워드 최대 50개 스캔'}
                                    </button>
                                ) : null}
                                {kwExpanded ? <div className="mt-1 text-center text-[11px] text-[#94a3b8]">전체 {kwResult.length}개 · 후보 풀 상한까지 스캔됨</div> : null}
                            </div>
                            );
                        })()}
                    </div>
                    {!isKw ? (
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
                        </div>
                    ) : null}
                    <div className="md:col-span-2">
                        <label className={labelCls}>{isKw ? '키워드' : '제품 키워드 (업종)'}</label>
                        <div className="flex gap-2">
                            <input className={inputCls} value={form.keyword} onChange={(e) => set('keyword', e.target.value)} placeholder={isKw ? '예: 광교 횟집' : '예: 입주청소 · 상가청소'} />
                            {!isKw ? (
                                <button type="button" onClick={() => void lookupVolume()} disabled={volLoading} className="h-10 shrink-0 rounded-md bg-[#0369a1] px-4 text-sm font-bold text-white hover:bg-[#075985] disabled:opacity-50">
                                    {volLoading ? '조회 중…' : '인기글 조회'}
                                </button>
                            ) : null}
                        </div>
                        {volErr && <p className="mb-0 mt-1 text-[12px] text-[#dc2626]">{volErr}</p>}
                        {vol && (
                            <div className="mt-2 rounded-lg border border-[#e2e8f0] bg-[#f8fafc] p-2">
                                <div className="mb-1 text-[11px] font-semibold text-[#64748b]">{volName ? `업체: ${volName} · ` : ''}연관 키워드 · 월 검색량 (많은 순) — 검색량이 큰 키워드가 노출 가치가 높습니다</div>
                                {vol.length === 0 ? (
                                    <div className="py-2 text-center text-[12px] text-[#94a3b8]">결과 없음</div>
                                ) : (
                                    <div className="max-h-56 overflow-y-auto">
                                        <table className="w-full text-[12px]">
                                            <thead>
                                                <tr className="text-left text-[#94a3b8]">
                                                    <th className="py-1">키워드</th><th className="py-1 text-right">PC</th><th className="py-1 text-right">모바일</th><th className="py-1 text-right">합계</th><th className="py-1" />
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {vol.map((k) => (
                                                    <tr key={k.keyword} className="border-t border-[#eef0f2]">
                                                        <td className="py-1 pr-2">{k.keyword}</td>
                                                        <td className="py-1 text-right text-[#64748b]">{k.pc.toLocaleString()}</td>
                                                        <td className="py-1 text-right text-[#64748b]">{k.mobile.toLocaleString()}</td>
                                                        <td className="py-1 text-right font-bold text-[#0369a1]">{k.total.toLocaleString()}</td>
                                                        <td className="py-1 pl-2"><button type="button" onClick={() => set('keyword', k.keyword)} className="text-[11px] text-[#4338ca] hover:underline">선택</button></td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
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
                <div className="mt-4 rounded-lg border border-[#e2e8f0] bg-[#fafaff] p-4">
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
                <div className="mt-4">
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

                <div className="mt-4 flex items-center gap-3">
                    <button className="h-10 rounded-md bg-[#4338ca] px-6 text-sm font-bold text-white hover:bg-[#3730a3] disabled:opacity-50" disabled={busy || !clientId} onClick={() => void submit()} type="button">
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
                                                <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${r.deploy_type === '키워드형' ? 'bg-[#fef3c7] text-[#92400e]' : 'bg-[#e0e7ff] text-[#4338ca]'}`}>{r.deploy_type ?? '지역형'}</span>
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
