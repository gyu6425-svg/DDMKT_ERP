import { useEffect, useState } from 'react';
import { listSavableBlogs, createSaveJob, listSaveJobs } from '../../api/blogSaveQueue';
import { generateBlog, type GenerateBlogInput } from '../../api/aiBlog';
import { parseBlogTitle } from '../../api/blogOutputs';
import {
    getBlogStudioSettings, saveBlogStudioSettings, uploadBlogStudioImage,
    signedBlogStudioUrls, blogStudioSavedPath,
} from '../../api/blogStudioSettings';
import { blogLogin, blogLoginPing } from '../../api/blogLoginBridge';
import { CafeKeywordFinder } from '../cafe/CafeKeywordFinder';

// 블로그 발행 스튜디오 — 카페 CafeCustomerStudio 미러(계정·키워드·원고·이미지 프리셋 → 임시저장 큐).
//   ⚠️ 발행(공개)은 하지 않는다. blog_save_queue 에 넣으면 SUB1 리스너가 '임시저장'까지만 처리하고,
//      사람이 임시저장함에서 검수 후 직접 발행한다. 카페 파일은 import 만(수정 없음).

type BlogRow = { id: string; name: string; blog_id: string; blog_url: string };
type QueueJob = { id: string; title: string | null; status: string; keyword?: string | null; created_at: string; draft_seq?: number | null };

const TONES: Array<[NonNullable<GenerateBlogInput['tone']>, string]> = [
    ['info', '정보형'], ['review', '후기형'], ['promo', '홍보형'], ['story', '스토리텔링'],
];
const LENGTHS: Array<[NonNullable<GenerateBlogInput['length']>, string]> = [
    ['short', '짧게'], ['medium', '보통'], ['long', '길게'],
];

// 파일 → dataURL(긴 변 1600px 축소). 카페와 동일 방식(복사·자립).
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

export default function BlogStudio() {
    const [blogs, setBlogs] = useState<BlogRow[]>([]);
    const [accountId, setAccountId] = useState<string>('');       // blog_accounts.id
    const [preview, setPreview] = useState<string | null>(null);  // 라이트박스

    // 공통 업체정보
    const [brand, setBrand] = useState('');
    const [business, setBusiness] = useState('');
    const [linkUrl, setLinkUrl] = useState('');   // 홈페이지(끝 링크카드)
    const [kakaoUrl, setKakaoUrl] = useState(''); // 카카오 상담(끝 CTA)

    // 발행 계정·블로그
    const [naverId, setNaverId] = useState('');
    const [blogName, setBlogName] = useState('');
    const [writeUrl, setWriteUrl] = useState('');
    const [dailyCap, setDailyCap] = useState(5);
    const [gapMin, setGapMin] = useState(30);
    const [chromePort, setChromePort] = useState(9235); // 이 블로그 전용 로그인/발행 크롬 포트(업체마다 다른 크롬)
    const [loginBusy, setLoginBusy] = useState(false);
    const [loginAlive, setLoginAlive] = useState(false); // 그 포트에 로그인 크롬이 떠 있나

    // 이미지 프리셋
    const [mainBanner, setMainBanner] = useState<string[]>([]);
    const [photos, setPhotos] = useState<string[]>([]);
    const [banners, setBanners] = useState<string[]>([]);

    // 키워드 · 원고
    const [finderMode, setFinderMode] = useState<'keyword' | 'region' | 'related' | 'info' | 'manual'>('region');
    const [manualInput, setManualInput] = useState('');
    const [topic, setTopic] = useState('');
    const [keywords, setKeywords] = useState('');
    const [audience, setAudience] = useState('');
    const [tone, setTone] = useState<NonNullable<GenerateBlogInput['tone']>>('info');
    const [length, setLength] = useState<NonNullable<GenerateBlogInput['length']>>('medium');
    const [includeHashtags, setIncludeHashtags] = useState(true);
    const [result, setResult] = useState('');
    const [genBusy, setGenBusy] = useState(false);

    // 큐
    const [jobs, setJobs] = useState<QueueJob[]>([]);
    const [savingSettings, setSavingSettings] = useState(false);
    const [hasSaved, setHasSaved] = useState(false); // 한 번 저장(또는 저장분 복원)되면 버튼이 '재저장'
    const [msg, setMsg] = useState('');
    const [enqueuing, setEnqueuing] = useState(false);

    const selected = blogs.find((b) => b.id === accountId) || null;

    // 담당 블로그 목록
    useEffect(() => {
        let alive = true;
        void listSavableBlogs().then(({ data }) => {
            if (!alive) return;
            setBlogs(data);
            if (data.length === 1) setAccountId(data[0].id);
        });
        return () => { alive = false; };
    }, []);

    // 선택 블로그의 저장 설정 복원
    useEffect(() => {
        if (!accountId) return;
        let alive = true;
        void getBlogStudioSettings(accountId).then(async ({ data }) => {
            if (!alive) return;
            const row = blogs.find((b) => b.id === accountId);
            setBrand(data?.brand ?? '');
            setBusiness(data?.business ?? '');
            setLinkUrl(data?.homepage ?? '');
            setKakaoUrl(data?.kakao_url ?? '');
            setNaverId(data?.naver_id ?? row?.blog_id ?? '');
            setBlogName(data?.blog_name ?? row?.name ?? '');
            setWriteUrl(data?.write_url ?? (row ? `https://blog.naver.com/${row.blog_id}/postwrite` : ''));
            setDailyCap(data?.daily_cap ?? 5);
            setGapMin(data?.publish_gap_min ?? 30);
            setChromePort(data?.chrome_port ?? 9235);
            setMainBanner(signedBlogStudioUrls(data?.main_banner ?? []));
            setPhotos(signedBlogStudioUrls(data?.photos ?? []));
            setBanners(signedBlogStudioUrls(data?.banners ?? []));
            setHasSaved(!!data); // 저장된 설정이 있으면 '재저장' 상태로 시작
        });
        return () => { alive = false; };
    }, [accountId, blogs]);

    // 큐 현황 폴링
    const refreshJobs = () => void listSaveJobs(12).then(({ data }) => setJobs((data ?? []) as QueueJob[]));
    useEffect(() => {
        refreshJobs();
        const t = window.setInterval(refreshJobs, 8000);
        return () => window.clearInterval(t);
    }, []);

    // 이 블로그 전용 포트에 로그인 크롬이 떠 있는지 확인(브릿지 ping).
    useEffect(() => {
        let alive = true;
        const check = () => void blogLoginPing(chromePort).then((a) => { if (alive) setLoginAlive(a); });
        check();
        const t = window.setInterval(check, 10000);
        return () => { alive = false; window.clearInterval(t); };
    }, [chromePort]);

    // '네이버 로그인' — 브릿지가 이 블로그 전용 크롬(포트·프로필)을 띄운다. 담당자가 그 창에서 직접 로그인.
    async function doLogin() {
        if (!selected) { setMsg('담당 블로그를 먼저 선택하세요.'); return; }
        setLoginBusy(true); setMsg('발행 PC에서 로그인 크롬 실행 중…');
        const r = await blogLogin(selected.blog_id, chromePort);
        setLoginBusy(false);
        if (!r.reached) {
            setMsg('로그인 브릿지에 연결 실패 — 발행 PC(SUB1)에서 run_blog_login_bridge.bat 을 먼저 켜세요.');
        } else if (!r.ok) {
            setMsg(`크롬 실행 실패: ${r.error || '알 수 없음'}`);
        } else {
            setMsg(r.already
                ? `이미 로그인 크롬이 떠 있습니다(포트 ${chromePort}). 그 창에서 로그인하세요.`
                : `전용 크롬을 띄웠습니다(포트 ${chromePort}). 뜬 창에서 이 블로그로 직접 로그인하세요(자동입력 없음).`);
            void blogLoginPing(chromePort).then(setLoginAlive);
        }
    }

    async function addFiles(setter: (u: (prev: string[]) => string[]) => void, files: FileList | null, max: number) {
        if (!files || !files.length) return;
        try {
            const urls = await Promise.all(Array.from(files).slice(0, max).map(fileToDataUrl));
            setter((prev) => [...prev, ...urls].slice(-max));
        } catch { /* 변환 실패 무시 */ }
    }

    const inputCls = 'h-10 rounded-lg border border-[#cbd5e1] bg-white px-3 text-sm';

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
                            <img alt={`${label} ${i + 1}`} className="h-16 w-16 cursor-zoom-in rounded-md border border-[#e2e8f0] object-cover transition hover:brightness-95" src={src} onClick={() => setPreview(src)} title="클릭하면 크게 보기" />
                            <button className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-[#dc2626] text-[11px] font-bold text-white" onClick={() => setter((p) => p.filter((_, j) => j !== i))} type="button">×</button>
                        </div>
                    ))}
                </div>
            ) : <span className="text-[11px] font-normal text-[#cbd5e1]">아직 없음</span>}
        </div>
    );

    // 이미지 소스 목록 → 저장 경로(이미 저장된 URL 은 그대로, 새 dataURL 은 업로드).
    async function persistImages(kind: 'main_banner' | 'photos' | 'banners', list: string[]): Promise<string[]> {
        const out: string[] = [];
        for (let i = 0; i < list.length; i += 1) {
            const already = blogStudioSavedPath(list[i]);
            if (already) { out.push(already); continue; }
            const r = await uploadBlogStudioImage(accountId, kind, i, list[i]);
            if (r.error || !r.path) throw new Error(`이미지 업로드 실패(${kind}): ${r.error ?? '알 수 없음'}`);
            out.push(r.path);
        }
        return out;
    }

    async function saveSettings() {
        if (!accountId) { setMsg('먼저 담당 블로그를 선택하세요.'); return; }
        setSavingSettings(true); setMsg('저장 중…');
        try {
            const [mb, ph, bn] = await Promise.all([
                persistImages('main_banner', mainBanner),
                persistImages('photos', photos),
                persistImages('banners', banners),
            ]);
            const { error } = await saveBlogStudioSettings({
                blog_account_id: accountId, brand, business, homepage: linkUrl, kakao_url: kakaoUrl,
                naver_id: naverId, blog_name: blogName, write_url: writeUrl,
                main_banner: mb, photos: ph, banners: bn,
                daily_cap: dailyCap, publish_gap_min: gapMin, chrome_port: chromePort,
            });
            if (error) { setMsg(`저장 실패: ${error.message}`); } else { setMsg('저장했습니다.'); setHasSaved(true); }
        } catch (e) {
            setMsg(e instanceof Error ? e.message : '저장 실패');
        } finally {
            setSavingSettings(false);
        }
    }

    async function generate() {
        if (!topic.trim()) { setMsg('주제/키워드를 입력하세요.'); return; }
        setGenBusy(true); setMsg('원고 생성 중…');
        try {
            const r = await generateBlog({ topic, industry: business, audience, tone, length, keywords, includeHashtags });
            setResult(r.text);
            setMsg('원고를 생성했습니다. 오른쪽에서 확인·편집하세요.');
        } catch (e) {
            setMsg(e instanceof Error ? e.message : '원고 생성 실패');
        } finally {
            setGenBusy(false);
        }
    }

    async function enqueue() {
        if (!selected) { setMsg('담당 블로그를 선택하세요.'); return; }
        const title = parseBlogTitle(result) || topic;
        if (!title.trim()) { setMsg('제목이 비어 있습니다 — 주제를 넣거나 원고를 생성하세요.'); return; }
        if (!result.trim()) { setMsg('본문이 비어 있습니다 — 먼저 원고를 생성하세요.'); return; }
        setEnqueuing(true); setMsg('임시저장 큐에 넣는 중…');
        try {
            // 조립 순서: 메인배너 → (본문 + 실사) → 끝배너. createSaveJob 이 업로드·매니페스트를 만든다.
            const images = [...mainBanner, ...photos, ...banners];
            const { error } = await createSaveJob({
                blogAccountId: selected.id, blogId: selected.blog_id, title, body: result,
                images, keyword: topic || undefined,
            });
            setMsg(error ? `큐 적재 실패: ${error.message}` : '임시저장 큐에 넣었습니다. SUB1 리스너가 임시저장까지 처리합니다(발행 아님).');
            if (!error) refreshJobs();
        } finally {
            setEnqueuing(false);
        }
    }

    const stStyle: Record<string, string> = {
        saved: 'bg-[#dcfce7] text-[#166534]', processing: 'bg-[#e0e7ff] text-[#3730a3]',
        pending: 'bg-[#fef3c7] text-[#92400e]', fail: 'bg-[#fee2e2] text-[#991b1b]',
    };

    return (
        <div className="grid gap-4">
            {/* 라이트박스 */}
            {preview ? (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-6" onClick={() => setPreview(null)}>
                    <img alt="확대 보기" className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain shadow-2xl" src={preview} onClick={(e) => e.stopPropagation()} />
                    <button className="absolute right-5 top-5 flex h-10 w-10 items-center justify-center rounded-full bg-white/90 text-xl font-bold text-[#334155] hover:bg-white" onClick={() => setPreview(null)} type="button" aria-label="닫기">×</button>
                </div>
            ) : null}

            {/* 헤더 — 담당 블로그 선택 + 저장 */}
            <div className="flex flex-wrap items-center gap-3">
                <label className="grid gap-1 text-xs font-semibold text-[#475569]">담당 블로그
                    <select className={`${inputCls} min-w-[240px]`} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                        <option value="">블로그 선택…</option>
                        {blogs.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.blog_id})</option>)}
                    </select>
                </label>
                {selected ? (
                    <a className="mt-4 text-xs font-semibold text-[#2563eb] hover:underline" href={`https://blog.naver.com/${selected.blog_id}/postwrite`} target="_blank" rel="noreferrer">글쓰기 열기 ↗</a>
                ) : null}
                <button type="button" onClick={() => void saveSettings()} disabled={savingSettings || !accountId}
                    title={hasSaved ? '변경 내용을 다시 저장합니다' : '현재 입력한 내용을 저장합니다'}
                    className={`mb-1 ml-auto shrink-0 self-end rounded-lg px-4 py-2 text-sm font-bold text-white disabled:opacity-50 ${hasSaved ? 'bg-[#15803d] hover:bg-[#166534]' : 'bg-[#4338ca] hover:bg-[#3730a3]'}`}>
                    {savingSettings ? '저장 중…' : hasSaved ? '↻ 재저장' : '저장'}
                </button>
            </div>

            {msg ? <div className="rounded-lg bg-[#eff6ff] px-4 py-2.5 text-sm font-semibold text-[#1e40af]">{msg}</div> : null}
            {blogs.length === 0 ? (
                <div className="rounded-lg border border-[#fbbf24] bg-[#fffbeb] px-4 py-3 text-sm text-[#92400e]">
                    담당 블로그가 없습니다 — <b>blog_accounts</b> 에 is_active 블로그가 등록돼야 목록에 뜹니다.
                </div>
            ) : null}

            <div className="rounded-lg bg-[#f0fdf4] px-4 py-3 text-sm text-[#166534]">
                📝 이 스튜디오는 <b>임시저장(비공개)까지만</b> 자동으로 넣어둡니다. 발행(공개)은 사람이 임시저장함에서 검수 후 직접 합니다.
            </div>

            {/* 공통 업체정보 */}
            <div className="rounded-xl border border-[#e2e8f0] bg-white p-4">
                <div className="grid gap-3 sm:grid-cols-2">
                    <label className="grid gap-1 text-xs font-semibold text-[#475569]">업체명
                        <input className={inputCls} onChange={(e) => setBrand(e.target.value)} placeholder="업체명" value={brand} />
                    </label>
                    <label className="grid gap-1 text-xs font-semibold text-[#475569]">업종
                        <input className={inputCls} onChange={(e) => setBusiness(e.target.value)} placeholder="예) 소방시설관리" value={business} />
                    </label>
                </div>
                <label className="mt-3 grid gap-1 text-xs font-semibold text-[#475569]">홈페이지·링크 (선택) — 본문 맨 끝에 링크카드로 삽입
                    <input className={inputCls} onChange={(e) => setLinkUrl(e.target.value)} placeholder="예) https://내홈페이지.com" value={linkUrl} />
                </label>
                <label className="mt-3 grid gap-1 text-xs font-semibold text-[#475569]">카카오톡 상담 링크 (선택) — 본문 끝 상담 CTA
                    <input className={inputCls} onChange={(e) => setKakaoUrl(e.target.value)} placeholder="예) https://pf.kakao.com/_xxx/chat" value={kakaoUrl} />
                </label>
            </div>

            {/* 발행 계정·블로그 */}
            <div className="rounded-xl border border-[#e2e8f0] bg-white p-4">
                <div className="mb-3 text-[13px] font-bold text-[#334155]">발행 계정·블로그 <span className="font-normal text-[#94a3b8]">— 값 저장하기 시 함께 저장되어 다음 발행에 재사용됩니다</span></div>
                <div className="grid gap-3 sm:grid-cols-2">
                    <label className="grid gap-1 text-xs font-semibold text-[#475569]">네이버 아이디
                        <input className={inputCls} autoComplete="off" onChange={(e) => setNaverId(e.target.value)} placeholder="발행에 사용할 네이버 아이디" value={naverId} />
                    </label>
                    {/* 네이버 비밀번호 입력칸을 두지 않는다 —
                        저장도 전송도 하지 않는 칸이라(테이블에 컬럼 자체가 없음) 효용은 0인데,
                        사용자는 실제 비밀번호를 입력하게 되고 브라우저 비밀번호 관리자에 남는다.
                        블로그 로그인은 설계상 발행PC에서 사람이 1회 수동으로 한다(캡차/2FA/계정잠금 회피).
                        아래 '네이버 로그인 (발행PC 수동)' 버튼과 안내 문구가 그 절차를 대신한다. */}
                    <label className="grid gap-1 text-xs font-semibold text-[#475569]">블로그 표시명
                        <input className={inputCls} onChange={(e) => setBlogName(e.target.value)} placeholder="예) 설고점 소방 블로그" value={blogName} />
                    </label>
                    <label className="grid gap-1 text-xs font-semibold text-[#475569]">글쓰기 주소 (postwrite)
                        <input className={inputCls} onChange={(e) => setWriteUrl(e.target.value)} placeholder="blog.naver.com/<아이디>/postwrite" value={writeUrl} />
                    </label>
                    <label className="grid gap-1 text-xs font-semibold text-[#475569]">하루 최대 임시저장 수
                        <input className={inputCls} type="number" min={1} max={10} value={dailyCap}
                            onChange={(e) => setDailyCap(Math.min(10, Math.max(1, Number(e.target.value) || 1)))} placeholder="1~10" />
                    </label>
                    <label className="grid gap-1 text-xs font-semibold text-[#475569]">저장 간격 <span className="font-normal text-[#94a3b8]">(텀)</span>
                        <select className={inputCls} value={gapMin} onChange={(e) => setGapMin(Number(e.target.value))}>
                            {[0, 30, 60, 90, 120, 150, 180].map((v) => <option key={v} value={v}>{v === 0 ? '제한 없음' : `${v}분에 1건`}</option>)}
                        </select>
                    </label>
                    <label className="grid gap-1 text-xs font-semibold text-[#475569]">전용 크롬 포트 <span className="font-normal text-[#94a3b8]">(업체마다 다른 크롬)</span>
                        <input className={inputCls} type="number" min={9200} max={9399} value={chromePort}
                            onChange={(e) => setChromePort(Math.min(9399, Math.max(9200, Number(e.target.value) || 9235)))} placeholder="예) 9235" />
                        <span className="text-[11px] font-normal text-[#94a3b8]">이 블로그 로그인·발행이 쓰는 크롬 포트. 업체마다 다른 값(예: 9235·9241·9242…). 댓글 9224~9229·카카오 9222는 피하세요.</span>
                    </label>
                </div>
            </div>

            {/* 발행 이미지 프리셋 */}
            <div className="rounded-xl border border-[#e2e8f0] bg-white p-4">
                <div className="mb-3 text-[13px] font-bold text-[#334155]">발행 이미지 (업체 배너·실사) <span className="font-normal text-[#94a3b8]">— 모든 발행에 함께 들어갑니다</span></div>
                <div className="grid gap-4 sm:grid-cols-3">
                    {imageZone('상단 배너', '(맨 위 · 1장)', mainBanner, setMainBanner, 1)}
                    {imageZone('실사 사진', '(문단 사이 · 개수 제한 없음 · 2장 좌우/낱개 랜덤)', photos, setPhotos, 9999)}
                    {imageZone('끝 배너', '(맨 끝 · 최대 2장)', banners, setBanners, 2)}
                </div>
                <p className="m-0 mt-2 text-[11px] text-[#94a3b8]">배치: <b>상단 배너</b> → <b>실사(문단 사이)</b> → <b>끝 배너</b> → <b>끝 CTA(홈페이지 링크카드·카카오 상담)</b>. 넣지 않으면 텍스트만 저장됩니다.</p>
            </div>

            {/* 키워드 찾기 유형 */}
            <div className="flex flex-wrap items-center gap-2">
                <span className="text-[12px] font-semibold text-[#64748b]">키워드 찾기 유형</span>
                {([['region', '지역형 (지역 × 키워드)'], ['keyword', '키워드형 (플레이스 주소)'], ['info', '🌐 정보형 (①연관어 ②주소)'], ['manual', '✍️ 직접 키워드']] as const).map(([m, label]) => (
                    <button key={m} type="button" onClick={() => setFinderMode(m)}
                        className={`rounded-full px-4 py-1.5 text-[13px] font-bold ${finderMode === m ? 'bg-[#0369a1] text-white' : 'bg-white text-[#475569] ring-1 ring-[#cbd5e1]'}`}>{label}</button>
                ))}
            </div>
            {finderMode === 'manual' ? (
                <div className="rounded-xl border-2 border-[#f59e0b] bg-[#fffbeb] p-4">
                    <div className="mb-2 text-[13px] font-bold text-[#b45309]">✍️ 직접 키워드 <span className="font-normal text-[#a16207]">(주제로 바로 사용)</span></div>
                    <div className="flex flex-wrap items-center gap-2">
                        <input className={`${inputCls} flex-1 min-w-[200px]`} value={manualInput} onChange={(e) => setManualInput(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (manualInput.trim()) { setTopic(manualInput.trim()); setKeywords(manualInput.trim()); setMsg('주제로 담았습니다.'); } } }}
                            placeholder="키워드 입력 후 Enter (예: 강남 소방점검)" />
                        <button type="button" onClick={() => { if (manualInput.trim()) { setTopic(manualInput.trim()); setKeywords(manualInput.trim()); setMsg('주제로 담았습니다.'); } }} disabled={!manualInput.trim()} className="h-10 shrink-0 rounded-md bg-[#b45309] px-5 text-sm font-bold text-white hover:bg-[#92400e] disabled:opacity-50">주제로 담기 ↓</button>
                    </div>
                </div>
            ) : (
                <CafeKeywordFinder
                    clientId={accountId || null}
                    mode={finderMode}
                    onPick={(kws) => { if (kws.length) { setTopic(kws[0]); setKeywords(kws.join(', ')); } }}
                />
            )}

            {/* AI 원고 생성 */}
            <div className="rounded-xl border border-[#e2e8f0] bg-white p-4">
                <div className="mb-3 text-[13px] font-bold text-[#334155]">AI 원고 생성 <span className="font-normal text-[#94a3b8]">— 톤·분량·타깃</span></div>
                <div className="grid gap-3 sm:grid-cols-2">
                    <label className="grid gap-1 text-xs font-semibold text-[#475569]">주제 / 키워드
                        <input className={inputCls} onChange={(e) => setTopic(e.target.value)} placeholder="예) 강남 소방점검" value={topic} />
                    </label>
                    <label className="grid gap-1 text-xs font-semibold text-[#475569]">타깃 독자 (선택)
                        <input className={inputCls} onChange={(e) => setAudience(e.target.value)} placeholder="예) 건물 관리자" value={audience} />
                    </label>
                </div>
                <label className="mt-3 grid gap-1 text-xs font-semibold text-[#475569]">포함 키워드 (쉼표)
                    <input className={inputCls} onChange={(e) => setKeywords(e.target.value)} placeholder="예) 소방점검, 정기점검, 비용" value={keywords} />
                </label>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                    <span className="text-[11px] font-semibold text-[#475569]">톤</span>
                    {TONES.map(([v, l]) => (
                        <button key={v} type="button" onClick={() => setTone(v)} className={`rounded-full px-3 py-1 text-[12.5px] font-bold ${tone === v ? 'bg-[#ea580c] text-white' : 'bg-white text-[#475569] ring-1 ring-[#cbd5e1]'}`}>{l}</button>
                    ))}
                    <span className="ml-2 text-[11px] font-semibold text-[#475569]">분량</span>
                    {LENGTHS.map(([v, l]) => (
                        <button key={v} type="button" onClick={() => setLength(v)} className={`rounded-full px-3 py-1 text-[12.5px] font-bold ${length === v ? 'bg-[#ea580c] text-white' : 'bg-white text-[#475569] ring-1 ring-[#cbd5e1]'}`}>{l}</button>
                    ))}
                    <label className="ml-auto flex items-center gap-1.5 text-[12.5px] font-semibold text-[#475569]">
                        <input type="checkbox" checked={includeHashtags} onChange={(e) => setIncludeHashtags(e.target.checked)} /> 해시태그 포함
                    </label>
                </div>
                <button type="button" onClick={() => void generate()} disabled={genBusy}
                    className="mt-3 h-11 w-full rounded-lg bg-[#ea580c] text-sm font-bold text-white hover:bg-[#c2410c] disabled:opacity-50">
                    {genBusy ? '생성 중…' : '✨ 글 생성'}
                </button>
                <textarea className="mt-3 min-h-[220px] w-full resize-y whitespace-pre-wrap rounded-md border border-[#e2e8f0] bg-[#f8fafc] px-3 py-2 text-sm leading-relaxed text-[#1f2937]"
                    placeholder="생성된 원고가 여기에 표시됩니다. 편집 가능 · 「사진 N」 마커 위치대로 이미지가 삽입됩니다." value={result} onChange={(e) => setResult(e.target.value)} />
            </div>

            {/* 네이버 로그인 (발행 PC) — 브릿지가 이 블로그 전용 크롬(포트·프로필)을 띄운다 */}
            <div className="rounded-xl border border-[#e2e8f0] bg-white p-4">
                <div className="mb-3 text-[13px] font-bold text-[#334155]">네이버 로그인 (발행 PC) <span className="font-normal text-[#94a3b8]">— 업체마다 전용 크롬(포트 {chromePort})으로 로그인</span></div>
                <div className="flex flex-wrap items-center gap-2">
                    <button type="button" onClick={() => void doLogin()} disabled={loginBusy || !selected}
                        className="h-11 rounded-lg bg-[#03c75a] px-6 text-sm font-bold text-white hover:bg-[#02b350] disabled:opacity-50">
                        {loginBusy ? '실행 중…' : '네이버 로그인'}
                    </button>
                    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-bold ${loginAlive ? 'bg-[#dcfce7] text-[#166534]' : 'bg-[#f1f5f9] text-[#64748b]'}`}>
                        <span className={`h-2 w-2 rounded-full ${loginAlive ? 'bg-[#16a34a]' : 'bg-[#94a3b8]'}`} />{loginAlive ? `로그인 크롬 켜짐 (포트 ${chromePort})` : '로그인 크롬 꺼짐'}
                    </span>
                </div>
                <p className="m-0 mt-2 text-[11px] text-[#94a3b8]">누르면 발행 PC에서 <b>이 블로그 전용 크롬</b>이 뜹니다 — 그 창에서 <b>직접 로그인</b>하세요(자동입력 없음 · 봇 차단 방지). 발행 PC에서 <b>run_blog_login_bridge.bat</b> 이 켜져 있어야 합니다.</p>
            </div>

            {/* 발행(임시저장) 큐 넣기 + 현황 */}
            <div className="rounded-xl border border-[#e2e8f0] bg-white p-4">
                <div className="mb-3 text-[13px] font-bold text-[#334155]">발행(임시저장) 큐 <span className="font-normal text-[#94a3b8]">— 넣으면 SUB1 리스너가 임시저장까지 처리(발행 아님)</span></div>
                <button type="button" onClick={() => void enqueue()} disabled={enqueuing || !selected || !result.trim()}
                    className="h-11 w-full rounded-lg bg-[#16a34a] text-sm font-bold text-white hover:bg-[#15803d] disabled:opacity-50">
                    {enqueuing ? '넣는 중…' : '🗂 임시저장 큐에 넣기'}
                </button>
                <p className="m-0 mt-2 text-[11px] text-[#b45309]">⚠ 발행(공개) 아님 — 임시저장함에 쌓입니다. 사람이 검수 후 직접 발행하세요.</p>

                <div className="mt-4 grid gap-2">
                    <div className="text-[12px] font-bold text-[#64748b]">최근 큐</div>
                    {jobs.length === 0 ? <div className="text-[12px] text-[#94a3b8]">아직 없음</div> : jobs.map((j) => (
                        <div key={j.id} className="flex items-center gap-2 rounded-lg border border-[#e2e8f0] px-3 py-2 text-[12.5px]">
                            <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-bold ${stStyle[j.status] || 'bg-[#f1f5f9] text-[#475569]'}`}>{j.status.toUpperCase()}</span>
                            <span className="font-semibold text-[#334155]">{j.title || '(제목 없음)'}</span>
                            <span className="ml-auto text-[11px] text-[#94a3b8]">{j.keyword || ''}{j.draft_seq ? ` · seq ${j.draft_seq}` : ''}</span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
