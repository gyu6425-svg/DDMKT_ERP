import { useEffect, useState } from 'react';
import { generateCafe, generateCafeReview } from '../../api/cafeWriter';
import { checkPopularBridge, nusu2Health } from '../../api/nusu2Bridge';
import { createCustomerPublishJob, listMyCafeJobs } from '../../api/cafePublishQueue';
import { getCafeAccounts } from '../../api/cafeAccounts';
import { CafeCustomerRequest } from './CafeCustomerRequest';
import { CafeAgentSetup } from './CafeAgentSetup';
import { REGION_GROUPS, type RegionSet } from './regions';

type MyJob = { id: string; title: string; status: string; posted_url: string | null; reason: string | null; created_at: string };
type Tone = 'review' | 'info' | 'story' | 'talk';
const TONES: { key: Tone; name: string }[] = [
    { key: 'review', name: '후기형' }, { key: 'info', name: '정보형' }, { key: 'story', name: '스토리형' }, { key: 'talk', name: '대화형' },
];
const STATUS_KO: Record<string, string> = { pending: '대기', processing: '작성 중', posted: '게시됨(확인중)', done: '완료', fail: '실패' };
const NAVER_KW_API = 'https://ddmkt-erp.pages.dev/api/naver-keywords';

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

export function CafeCustomerStudio({ clientId }: { clientId: string | null }) {
    const [approved, setApproved] = useState<boolean | null>(null);
    const [board, setBoard] = useState<string | null>(null);
    const [company, setCompany] = useState<string | null>(null);
    const [brandDefault, setBrandDefault] = useState('');

    // 공통 업체정보
    const [brand, setBrand] = useState('');
    const [business, setBusiness] = useState('');

    // 모드
    const [mode, setMode] = useState<'keyword' | 'region'>('keyword');

    // SEO 키워드 찾기
    const [seoQ, setSeoQ] = useState('');
    const [seoBusy, setSeoBusy] = useState(false);
    const [seoErr, setSeoErr] = useState('');
    const [seo, setSeo] = useState<Array<{ keyword: string; total: number; comp: string }> | null>(null);

    // 키워드형
    const [keyword, setKeyword] = useState('');
    const [region, setRegion] = useState('');
    const [tone, setTone] = useState<Tone>('review');
    const [tags, setTags] = useState('');
    const [title, setTitle] = useState('');
    const [body, setBody] = useState('');
    // 업체가 넣는 이미지 — 메인배너(맨 위 1장) + 배너(카드) + 실사(현장사진). 두 모드 발행에 함께 사용.
    const [mainBanner, setMainBanner] = useState<string[]>([]);
    const [banners, setBanners] = useState<string[]>([]);
    const [photos, setPhotos] = useState<string[]>([]);
    const allImages = () => [...mainBanner, ...photos, ...banners];   // 게시 순서: 메인배너→실사→배너
    const [genBusy, setGenBusy] = useState(false);
    const [pubBusy, setPubBusy] = useState(false);
    const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

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

    // 발행 현황
    const [jobs, setJobs] = useState<MyJob[]>([]);
    async function loadJobs() { const { data } = await listMyCafeJobs(10); setJobs(data as MyJob[]); }

    useEffect(() => {
        let alive = true;
        void getCafeAccounts().then(({ data }) => {
            if (!alive) return;
            const enabled = data.find((x) => x.active && (x as { publish_enabled?: boolean }).publish_enabled !== false);
            setBoard(enabled?.board_name ?? null);
            setCompany(enabled?.company_key ?? null);
            setBrandDefault(enabled?.display_name ?? '');
            if (!brand && enabled?.display_name) setBrand(enabled.display_name);
            setApproved(!!enabled);
        });
        void loadJobs();
        const t = setInterval(() => { void loadJobs(); }, 15000);
        return () => { alive = false; clearInterval(t); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [clientId]);

    async function findSeo() {
        const q = (seoQ || business || '').trim();
        if (!q) { setSeoErr('업종/키워드를 입력하세요.'); return; }
        setSeoBusy(true); setSeoErr(''); setSeo(null);
        try {
            const res = await fetch(`${NAVER_KW_API}?q=${encodeURIComponent(q)}`);
            const data = await res.json();
            if (!res.ok) throw new Error((data && data.error) || `오류 ${res.status}`);
            const rows = ((data && data.keywords) || []) as Array<{ keyword: string; total: number; comp: string }>;
            // 관련 키워드만 — ①서비스 접미(입주청소→'청소', 누수탐지→'탐지') 포함 ②지역명 붙은 것 제거
            //   (예: '의정부 입주청소'·'강서구 입주청소'·'초파리'는 뺀다 → 입주청소·화장실청소·이사청소만).
            const core = q.replace(/\s/g, '').slice(-2);
            const regionNames = new Set<string>();
            Object.values(REGION_GROUPS).forEach((g) => g.forEach((r) => { if (r.label.length >= 2) regionNames.add(r.label.replace(/\s/g, '')); }));
            const hasRegion = (kw: string) => [...regionNames].some((n) => kw.replace(/\s/g, '').includes(n));
            const related = rows.filter((r) => r.keyword.includes(core) && !hasRegion(r.keyword));
            const top = (related.length ? related : rows).sort((a, b) => b.total - a.total).slice(0, 30);
            setSeo(top);
            setSelectedKw(new Set(top.map((r) => r.keyword)));   // 나온 키워드 전부 자동 선택 → 지역형이 다 씀(빼려면 클릭)
        } catch (e) { setSeoErr(String((e as Error).message || e)); } finally { setSeoBusy(false); }
    }

    async function genOne(kw: string, reg: string) {
        const g = await generateCafe({ keyword: kw, region: reg || undefined, brand: brand.trim() || brandDefault || undefined, business: business.trim() || undefined });
        const rv = await generateCafeReview({ keyword: kw, region: reg || undefined, brand: brand.trim() || brandDefault || undefined, business: business.trim() || undefined, content: g.content, tone, count: 6, layout: 'bottom' });
        return { title: rv.title || '', body: rv.reviewBody || '' };
    }

    async function generate() {
        if (!keyword.trim()) { setMsg({ ok: false, text: '주제(키워드)를 입력해 주세요.' }); return; }
        setGenBusy(true); setMsg(null);
        try {
            const r = await genOne(keyword.trim(), region.trim());
            setTitle(r.title); setBody(r.body);
            setMsg({ ok: true, text: '원고를 생성했습니다. 확인·수정 후 발행하세요.' });
        } catch (e) { setMsg({ ok: false, text: (e as Error).message || '원고 생성 실패' }); } finally { setGenBusy(false); }
    }

    async function addFiles(setter: (u: (prev: string[]) => string[]) => void, files: FileList | null, max: number) {
        if (!files || !files.length) return;
        try {
            const urls = await Promise.all(Array.from(files).slice(0, max).map(fileToDataUrl));
            setter((prev) => [...prev, ...urls].slice(0, max));
        } catch (e) { setMsg({ ok: false, text: (e as Error).message || '사진 오류' }); }
    }

    async function publish() {
        if (!title.trim() || !body.trim()) { setMsg({ ok: false, text: '제목과 본문이 필요합니다.' }); return; }
        setPubBusy(true); setMsg(null);
        const tagList = tags.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 10);
        const { error, jobId } = await createCustomerPublishJob({ title: title.trim(), body, images: allImages(), tags: tagList });
        setPubBusy(false);
        if (error) { setMsg({ ok: false, text: (error as { message?: string }).message || '발행 등록 실패' }); return; }
        setMsg({ ok: true, text: `발행 등록 완료 — 대기열에 담겼습니다. (#${(jobId || '').slice(0, 8)})` });
        setTitle(''); setBody(''); setTags(''); setMainBanner([]); setBanners([]); setPhotos([]); void loadJobs();
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
        // 후보 = 각 지역셋의 시·구 × 각 키워드 (지역 우선 훑기).
        const cands: Array<{ region: string; scans: string[]; keyword: string }> = [];
        for (const set of sets) for (const r of REGION_GROUPS[set]) for (const kw of kws) cands.push({ region: r.label, scans: r.scans, keyword: kw });
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
        for (const set of sets) { for (const r of REGION_GROUPS[set]) { for (const kw of kws) { cands.push({ region: r.label, keyword: kw }); } } }
        const targets = cands.slice(0, count);
        setPassed(targets); setScanRows([]); setRphase('scanned');
        setRmsg(`스캔 없이 ${targets.length}건 발행(인기글 검사 생략)`);
        await runPublishRegion(targets);
    }

    // 지역형: 통과분(최대 N) 생성·발행.
    async function runPublishRegion(targetsArg?: Array<{ region: string; keyword: string }>) {
        const src = targetsArg ?? passed;
        if (!src.length) return;
        setRphase('publishing');
        const targets = src.slice(0, count);
        const rows = targets.map((p) => ({ label: `${p.region} ${p.keyword}`, status: '대기' }));
        setGenRows([...rows]);
        for (let i = 0; i < targets.length; i += 1) {
            rows[i] = { ...rows[i], status: '원고 생성중…' }; setGenRows([...rows]);
            try {
                const p = targets[i];
                const r = await genOne(`${p.region} ${p.keyword}`, p.region);
                rows[i] = { ...rows[i], status: '발행 등록중…' }; setGenRows([...rows]);
                const { error } = await createCustomerPublishJob({ title: r.title, body: r.body, images: allImages(), tags: [] });
                rows[i] = { ...rows[i], status: error ? '실패' : '큐 등록 완료' };
            } catch (e) { rows[i] = { ...rows[i], status: `실패: ${(e as Error).message?.slice(0, 30)}` }; }
            setGenRows([...rows]);
        }
        setRphase('done'); void loadJobs();
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

    const inputCls = 'h-10 rounded-lg border border-[#cbd5e1] bg-white px-3 text-sm';
    const now = Date.now();
    const stuck = jobs.some((j) => j.status === 'pending' && now - new Date(j.created_at).getTime() > 3 * 60 * 1000);

    return (
        <div className="grid gap-4">
            <div className="rounded-lg bg-[#eff6ff] px-4 py-3 text-sm text-[#1e40af]">
                발행 대상 게시판: <b>{board ?? '(확인 중)'}</b>
                <span className="ml-2 text-[#64748b]">— 발행하면 본인 카페의 이 게시판에 자동 게시됩니다.</span>
            </div>

            <CafeAgentSetup board={board} companyKey={company} />

            {stuck ? (
                <div className="rounded-lg border border-[#fca5a5] bg-[#fef2f2] px-4 py-3 text-sm text-[#b91c1c]">
                    ⚠️ 대기 중인 글이 게시되지 않고 있습니다. 내 PC의 <b>발행 프로그램(DDMKT-Agent)</b>이 실행 중인지 확인해 주세요.
                </div>
            ) : null}

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
            </div>

            {/* 발행 이미지 — 업체가 넣는 메인배너·배너·실사(모든 발행에 함께 게시) */}
            <div className="rounded-xl border border-[#e2e8f0] bg-white p-4">
                <div className="mb-3 text-[13px] font-bold text-[#334155]">발행 이미지 (업체 배너·실사) <span className="font-normal text-[#94a3b8]">— 모든 발행에 함께 들어갑니다</span></div>
                <div className="grid gap-4 sm:grid-cols-3">
                    {imageZone('메인 배너', '(맨 위 · 1장)', mainBanner, setMainBanner, 1)}
                    {imageZone('배너', '(카드형 · 최대 8장)', banners, setBanners, 8)}
                    {imageZone('실사 사진', '(현장 · 최대 10장)', photos, setPhotos, 10)}
                </div>
                <p className="m-0 mt-2 text-[11px] text-[#94a3b8]">게시 순서: 메인배너 → 실사 → 배너 → 본문 (누수탐지 스타일). 넣지 않으면 텍스트만 발행됩니다.</p>
            </div>

            {/* SEO 연관키워드 찾기 (최상단) */}
            <div className="rounded-xl border-2 border-[#0369a1] bg-[#f0f9ff] p-4">
                <div className="mb-2 text-[13px] font-bold text-[#075985]">🔍 SEO 연관키워드 찾기</div>
                <div className="flex flex-wrap items-center gap-2">
                    <input className={`${inputCls} flex-1 min-w-[160px]`} onChange={(e) => setSeoQ(e.target.value)} placeholder={business ? `예) ${business}` : '업종/키워드 (예: 입주청소)'} value={seoQ} />
                    <button className="h-10 rounded-lg bg-[#0369a1] px-4 text-sm font-bold text-white disabled:opacity-50" disabled={seoBusy} onClick={() => void findSeo()} type="button">{seoBusy ? '검색 중…' : '키워드 찾기'}</button>
                    {seoErr ? <span className="text-xs text-[#dc2626]">{seoErr}</span> : null}
                </div>
                {seo ? (
                    <div className="mt-2 max-h-44 overflow-y-auto rounded-lg border border-[#bae6fd] bg-white p-1">
                        {seo.length ? seo.map((r) => {
                            const sel = selectedKw.has(r.keyword);
                            return (
                                <button className={`flex w-full items-center justify-between rounded px-2 py-1 text-left text-[13px] ${sel ? 'bg-[#dbeafe]' : 'hover:bg-[#f0f9ff]'}`} key={r.keyword}
                                    onClick={() => { toggleKw(r.keyword); if (mode === 'region') setRegionKw(r.keyword); else setKeyword(r.keyword); }} type="button">
                                    <span className="font-medium text-[#0f172a]">{sel ? '✓ ' : ''}{r.keyword}</span>
                                    <span className="text-[12px] text-[#64748b]">월 {r.total.toLocaleString()} · 경쟁 {r.comp}</span>
                                </button>
                            );
                        }) : <div className="px-2 py-1 text-[13px] text-[#94a3b8]">추천 키워드 없음</div>}
                        <div className="px-2 py-1 text-[11px] text-[#94a3b8]">나온 키워드는 <b>전부 지역형에 자동 사용</b>됩니다(빼려면 클릭). {selectedKw.size ? `· 사용 ${selectedKw.size}개` : ''} · "지역형" 탭에서 지역·발행건수 정하고 스캔하세요.</div>
                    </div>
                ) : null}
            </div>

            {/* 모드 탭 */}
            <div className="flex gap-1 border-b border-[#e2e8f0]">
                {([['keyword', '키워드형'], ['region', '지역형']] as const).map(([k, name]) => (
                    <button className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold ${mode === k ? 'border-[#1e40af] text-[#1e40af]' : 'border-transparent text-[#94a3b8]'}`} key={k} onClick={() => setMode(k)} type="button">{name}</button>
                ))}
            </div>

            {mode === 'keyword' ? (
                <>
                    <div className="rounded-xl border border-[#e2e8f0] bg-white p-4">
                        <div className="mb-3 text-[13px] font-bold text-[#334155]">1. 주제 입력 후 원고 자동생성</div>
                        <div className="grid gap-3 sm:grid-cols-2">
                            <label className="grid gap-1 text-xs font-semibold text-[#475569]">주제 · 키워드 (필수)
                                <input className={inputCls} onChange={(e) => setKeyword(e.target.value)} placeholder="예) 광교동 입주청소" value={keyword} />
                            </label>
                            <label className="grid gap-1 text-xs font-semibold text-[#475569]">지역 (선택)
                                <input className={inputCls} onChange={(e) => setRegion(e.target.value)} placeholder="예) 수원 광교동" value={region} />
                            </label>
                            <label className="grid gap-1 text-xs font-semibold text-[#475569]">말투
                                <select className={inputCls} onChange={(e) => setTone(e.target.value as Tone)} value={tone}>
                                    {TONES.map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}
                                </select>
                            </label>
                        </div>
                        <button className="mt-3 h-10 rounded-lg bg-[#4338ca] px-5 text-sm font-bold text-white disabled:opacity-50" disabled={genBusy} onClick={generate} type="button">{genBusy ? '원고 생성 중…' : '원고 자동생성'}</button>
                    </div>

                    <div className="rounded-xl border border-[#e2e8f0] bg-white p-4">
                        <div className="mb-3 text-[13px] font-bold text-[#334155]">2. 확인·수정 후 발행</div>
                        <label className="grid gap-1 text-xs font-semibold text-[#475569]">제목
                            <input className={inputCls} maxLength={100} onChange={(e) => setTitle(e.target.value)} placeholder="원고 생성 시 자동 입력" value={title} />
                        </label>
                        <label className="mt-3 grid gap-1 text-xs font-semibold text-[#475569]">본문
                            <textarea className="min-h-[240px] rounded-lg border border-[#cbd5e1] px-3 py-2 text-sm font-normal leading-relaxed" onChange={(e) => setBody(e.target.value)} placeholder="원고 생성 시 자동 입력. 직접 수정 가능." value={body} />
                        </label>
                        <label className="mt-3 grid gap-1 text-xs font-semibold text-[#475569]">태그 (선택, 쉼표 · 최대 10개)
                            <input className={inputCls} onChange={(e) => setTags(e.target.value)} placeholder="예) 광교동청소, 입주청소" value={tags} />
                        </label>
                        <p className="mt-2 text-[11px] text-[#94a3b8]">※ 이미지(메인배너·배너·실사)는 위 "발행 이미지" 칸에서 넣습니다 — 모든 발행에 함께 들어갑니다.</p>
                        {msg ? <div className={`mt-3 rounded-lg px-4 py-3 text-sm ${msg.ok ? 'bg-[#ecfdf5] text-[#047857]' : 'bg-[#fef2f2] text-[#b91c1c]'}`}>{msg.text}</div> : null}
                        <div className="mt-3 flex items-center gap-3">
                            <button className="h-10 rounded-lg bg-[#0f766e] px-5 text-sm font-bold text-white disabled:opacity-50" disabled={pubBusy || genBusy} onClick={publish} type="button">{pubBusy ? '등록 중…' : '발행하기'}</button>
                            <span className="text-xs text-[#94a3b8]">등록 후 내 PC 발행 프로그램이 순서대로 게시(즉시 아님).</span>
                        </div>
                    </div>
                </>
            ) : (
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
            )}

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
