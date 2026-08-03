import { useEffect, useRef, useState } from 'react';
import { listMyCafeJobs, listCafeJobsByCompanies } from '../../api/cafePublishQueue';
import { listTokens, balanceOf } from '../../api/cafeTokens';
import { getCafeAccounts } from '../../api/cafeAccounts';
import { getStudioSettings, saveStudioSettings, clearStudioSettings, uploadStudioImage, signedStudioUrls } from '../../api/cafeStudioSettings';
import { getLatestDeployForStudio, getCafeDeployGoal } from '../../api/cafeDeployRequests';
import { getCafeRankPostsForClient, latestCafeMeasure, cafeTodayKST, type CafeRankPost } from '../../api/cafeRank';
import { downloadCsv, todayTag } from '../../lib/exportCsv';
import { enqueueGenRequests, enqueueGenRequestsSelf, getGenRequestStatus, publishTargetFor } from '../../api/cafeGenRequests';
import { CafeCustomerRequest } from './CafeCustomerRequest';
import { CafeKeywordFinder } from './CafeKeywordFinder';
import { customerLogin } from '../../api/nusu2Bridge';

type MyJob = { id: string; title: string; status: string; posted_url: string | null; reason: string | null; created_at: string };
const STATUS_KO: Record<string, string> = { pending: '대기', processing: '작성 중', posted: '게시됨(확인중)', done: '완료', fail: '실패' };

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

export function CafeCustomerStudio({ clientId, onGoCharge }: { clientId: string | null; onGoCharge?: () => void }) {
    const [approved, setApproved] = useState<boolean | null>(null);
    const [board, setBoard] = useState<string | null>(null);
    const [company, setCompany] = useState<string | null>(null);
    const [brandDefault, setBrandDefault] = useState('');

    // 공통 업체정보
    const [brand, setBrand] = useState('');
    const [business, setBusiness] = useState('');

    // 발행 요청(cafe_gen_requests) — finder 선택 키워드 → 발행PC(SUB1/SUB2) 대기열로.
    const [productKw, setProductKw] = useState(''); // finder 제품키워드(입주청소/사설경호/누수탐지…)
    // 모델B 일별 발행 — 계약 키워드 풀 + 발행상태(칩 색상·미사용 판별) + 매일 건수.
    const [poolKw, setPoolKw] = useState<string[]>([]);
    const [genStatus, setGenStatus] = useState<Record<string, string>>({});
    const [dailyCount, setDailyCount] = useState(1);
    async function loadGenStatus() { if (clientId) setGenStatus(await getGenRequestStatus(clientId)); }
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
    const [loginMsg, setLoginMsg] = useState('');   // '네이버 로그인' 버튼 결과 안내 — SUB2 브릿지 호출 성공/실패.
    const [loginBusy, setLoginBusy] = useState(false);
    const [kakaoUrl, setKakaoUrl] = useState('');   // 카카오톡 상담 링크 — 본문 끝 CTA. 저장 설정에 포함.
    // 접수 때 고른 SEO 키워드(10~50) — 파인더에 시딩 + 재조회 제외. 계약 목표 건수.
    const [intakePicked, setIntakePicked] = useState<{ keyword: string; volume?: number | null; theme?: string | null }[]>([]);
    const [goalCount, setGoalCount] = useState(0);
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
            const mainPaths: string[] = [];
            for (let i = 0; i < mainBanner.length; i += 1) { const p = await uploadStudioImage(clientId, 'main_banner', i, mainBanner[i]); if (p) mainPaths.push(p); }
            const photoPaths: string[] = [];
            for (let i = 0; i < photos.length; i += 1) { const p = await uploadStudioImage(clientId, 'photos', i, photos[i]); if (p) photoPaths.push(p); }
            const bannerPaths: string[] = [];
            for (let i = 0; i < banners.length; i += 1) { const p = await uploadStudioImage(clientId, 'banners', i, banners[i]); if (p) bannerPaths.push(p); }
            const { error } = await saveStudioSettings({
                client_id: clientId, brand: brand || null, business: business || null, homepage: linkUrl || null,
                deploy_type: '키워드형', main_banner: mainPaths, photos: photoPaths, banners: bannerPaths,
                naver_id: naverId || null, naver_pw: naverPw || null, board_name: boardName || null, board_url: boardUrl || null,
                kakao_url: kakaoUrl || null,
                keyword_pool: poolKw.length ? poolKw : null, product_kw: productKw || null,
            });
            if (error) throw new Error(error.message);
            setSettingsSaved(true); setSettingsMsg('저장됨 · 다음부터 이 값으로 열립니다');
        } catch (e) { setSettingsMsg('저장 실패: ' + (e instanceof Error ? e.message : '')); }
        finally { setSavingSettings(false); }
    };
    const resetSettings = async () => {
        if (!clientId) return;
        await clearStudioSettings(clientId);
        setBrand(brandDefault); setBusiness(''); setLinkUrl(''); setPhotos([]); setBanners([]); setMainBanner([]);
        setNaverId(''); setNaverPw(''); setBoardName(''); setBoardUrl(''); setKakaoUrl('');
        setSettingsSaved(false); setSettingsMsg('초기화됨');
    };
    const [selectedKw, setSelectedKw] = useState<Set<string>>(() => new Set());

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

    // 발행 히스토리(순위 트래커 기준) — 이 업체의 실제 발행·측정된 글. 더맨/설고/더반처럼 SUB PC 발행분도 여기 잡힘.
    const [rankPosts, setRankPosts] = useState<CafeRankPost[]>([]);
    const [rankLoading, setRankLoading] = useState(false);
    async function loadRankPosts() {
        if (!clientId) { setRankPosts([]); return; }
        setRankLoading(true);
        try { setRankPosts(await getCafeRankPostsForClient(clientId)); }
        finally { setRankLoading(false); }
    }
    // 발행 히스토리 → 엑셀(CSV) 내보내기.
    const exportRankHistory = () => {
        const headers = ['발행일', '키워드', '게시판', '현재 순위', '실적', '링크'];
        const rows = rankPosts.map((p) => {
            const m = latestCafeMeasure(p.measurements);
            const rankText = !m ? '-' : m.ti_status === 'ok' ? `${m.ti}위` : m.ti_status === 'out' ? '권외' : m.ti_status === 'no_section' ? '측정불가' : '실패';
            const perf = p.top5_achieved_at && !p.top5_seeded ? '실적' : p.top5_seeded ? '기준' : p.top5_since ? '5위 진입' : '-';
            const url = p.post_url || (p.cafe_name && p.article_id ? `https://cafe.naver.com/${p.cafe_name}/${p.article_id}` : '');
            return [p.published_date ?? '', p.keyword_manual || p.keyword || '', p.board ?? p.cafe_accounts?.board_short ?? '', rankText, perf, url];
        });
        downloadCsv(`발행히스토리_${brand || brandDefault || '업체'}_${todayTag()}`, headers, rows);
    };

    // 발행 토큰 잔액 — 발행 1건 = 1토큰. 0이면 발행 차단.
    const [tokenBal, setTokenBal] = useState(0);
    async function loadTokens() { if (clientId) { const { data } = await listTokens(clientId); setTokenBal(balanceOf(data)); } }

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
        void loadTokens();
        void loadRankPosts();
        const t = setInterval(() => { void loadJobs(); }, 15000);
        return () => { alive = false; clearInterval(t); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [clientId]);

    // 발행값 자동 채움 — ①저장설정('값 저장하기') ②접수(고객이 접수 때 넣은 값)를 병합.
    //   우선순위: 저장설정 > 접수. 저장설정이 없는 항목(메인배너·지역셋·선택키워드)은 접수에서 가져온다.
    useEffect(() => {
        if (!clientId) { setSettingsSaved(false); return; }
        let alive = true;
        void (async () => {
            const [{ data: s }, prefill, goal] = await Promise.all([
                getStudioSettings(clientId),
                getLatestDeployForStudio(clientId),
                getCafeDeployGoal(clientId),
            ]);
            if (!alive) return;
            setGoalCount(goal);
            const req = prefill.req; const cred = prefill.cred;
            // 텍스트 값 — 저장설정 우선, 없으면 접수값.
            const brandV = s?.brand ?? req?.company_name; if (brandV) setBrand(brandV);
            const bizV = s?.business ?? req?.keyword; if (bizV) setBusiness(bizV);
            const homeV = s?.homepage ?? req?.url; if (homeV) setLinkUrl(homeV);
            const nid = s?.naver_id ?? cred?.naver_id; if (nid) setNaverId(nid);
            const npw = s?.naver_pw ?? cred?.naver_pw; if (npw) setNaverPw(npw);
            const bname = s?.board_name ?? req?.board_name; if (bname) setBoardName(bname);
            if (s?.board_url) setBoardUrl(s.board_url);
            if (s?.kakao_url) setKakaoUrl(s.kakao_url);
            // 모델B 일별 발행 — 저장된 키워드 풀 + 제품키워드 + 현재 발행상태.
            if (s?.keyword_pool?.length) setPoolKw(s.keyword_pool);
            if (s?.product_kw) setProductKw(s.product_kw);
            void loadGenStatus();
            // 접수 선택 키워드 — 파인더 시딩 + 재조회 제외.
            const picks = (req?.selected_keywords ?? []).map((p) => ({ keyword: p.keyword, volume: p.volume ?? null, theme: p.theme ?? null }));
            if (picks.length) setIntakePicked(picks);
            // 이미지 — 저장설정(메인배너/실사/끝배너) 우선, 없으면 접수.
            const [mb, ph, bn] = await Promise.all([
                signedStudioUrls(s?.main_banner || []), signedStudioUrls(s?.photos || []), signedStudioUrls(s?.banners || []),
            ]);
            if (!alive) return;
            if (mb.length) setMainBanner(mb); else if (prefill.photoUrls.main.length) setMainBanner(prefill.photoUrls.main);
            if (ph.length) setPhotos(ph); else if (prefill.photoUrls.real.length) setPhotos(prefill.photoUrls.real);
            if (bn.length) setBanners(bn); else if (prefill.photoUrls.banner.length) setBanners(prefill.photoUrls.banner);
            setSettingsSaved(!!s);
        })();
        return () => { alive = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [clientId]);

    async function addFiles(setter: (u: (prev: string[]) => string[]) => void, files: FileList | null, max: number) {
        if (!files || !files.length) return;
        try {
            const urls = await Promise.all(Array.from(files).slice(0, max).map(fileToDataUrl));
            setter((prev) => [...prev, ...urls].slice(0, max));
        } catch { /* 사진 변환 실패 무시 */ }
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

            {/* 우측: 값 저장/초기화 */}
            <div className="flex items-center gap-1 border-b border-[#e2e8f0]">
                {settingsMsg ? <span className="ml-auto mr-2 text-[11px] font-semibold text-[#059669]">{settingsMsg}</span> : null}
                {settingsSaved ? (
                    <span className={`${settingsMsg ? '' : 'ml-auto'} mb-1 flex shrink-0 items-center gap-1.5`}>
                        <button type="button" onClick={() => void saveSettings()} disabled={savingSettings}
                            className="rounded-md bg-[#4338ca] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#3730a3] disabled:opacity-50"
                            title="내용을 수정한 뒤 눌러 다시 저장(덮어쓰기)">
                            {savingSettings ? '저장 중…' : '재설정'}
                        </button>
                        <button type="button" onClick={() => void resetSettings()} disabled={savingSettings}
                            className="rounded-md border border-[#cbd5e1] bg-white px-3 py-1.5 text-xs font-bold text-[#64748b] hover:bg-[#f1f5f9] disabled:opacity-50"
                            title="저장된 값을 지우고 처음 상태로">
                            초기화
                        </button>
                    </span>
                ) : (
                    <button type="button" onClick={() => void saveSettings()} disabled={savingSettings}
                        className={`${settingsMsg ? '' : 'ml-auto'} mb-1 shrink-0 rounded-md bg-[#4338ca] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#3730a3] disabled:opacity-50`}
                        title="업체명·업종·홈페이지·유형·메인배너·실사·끝배너를 저장 — 다음 선택 시 자동 복원">
                        {savingSettings ? '저장 중…' : '값 저장하기'}
                    </button>
                )}
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
                <label className="mt-3 grid gap-1 text-xs font-semibold text-[#475569]">카카오톡 상담 링크 (선택) — 본문 끝 상담 CTA
                    <input className={inputCls} onChange={(e) => setKakaoUrl(e.target.value)} placeholder="예) https://pf.kakao.com/_xxx/chat" value={kakaoUrl} />
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
                {/* 네이버 로그인 — SUB2가 이 고객 전용 크롬을 띄우고 담당자가 직접 로그인(자동입력 안 함=봇 방지) */}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button type="button" disabled={!clientId || loginBusy}
                        className="h-10 rounded-lg bg-[#03c75a] px-5 text-sm font-bold text-white hover:bg-[#02b350] disabled:opacity-50"
                        onClick={async () => {
                            if (!clientId) return;
                            setLoginBusy(true); setLoginMsg('전용 크롬 실행 중…');
                            const r = await customerLogin(clientId);
                            setLoginBusy(false);
                            setLoginMsg(r.ok
                                ? '전용 크롬을 띄웠습니다 — 뜬 창에서 직접 로그인하세요.'
                                : `브릿지 연결 실패 — 발행 프로그램(SUB2)이 켜져 있는지 확인하세요. 로컬에서 접속해야 합니다. (${r.error || '연결 불가'})`);
                        }}>
                        {loginBusy ? '실행 중…' : '네이버 로그인 (담당자 수동)'}
                    </button>
                    <span className="text-[11px] text-[#94a3b8]">누르면 이 고객 전용 크롬 창이 뜹니다. 자동입력 없이 담당자가 그 창에서 직접 로그인하세요(봇 차단 방지).</span>
                    {loginMsg ? <span className={`w-full text-[12px] font-semibold ${loginMsg.includes('실패') ? 'text-[#dc2626]' : 'text-[#166534]'}`}>{loginMsg}</span> : null}
                </div>
            </div>

            {/* 발행 이미지 — 업체가 넣는 메인배너·배너·실사(모든 발행에 함께 게시) */}
            <div className="rounded-xl border border-[#e2e8f0] bg-white p-4">
                <div className="mb-3 text-[13px] font-bold text-[#334155]">발행 이미지 (업체 배너·실사) <span className="font-normal text-[#94a3b8]">— 모든 발행에 함께 들어갑니다</span></div>
                <div className="grid gap-4 sm:grid-cols-3">
                    {imageZone('상단 배너', '(맨 위 · 1장)', mainBanner, setMainBanner, 1)}
                    {imageZone('실사 사진', '(문단 사이 · 개수 제한 없음 · 2장 좌우/낱개 랜덤)', photos, setPhotos, 9999)}
                    {imageZone('끝 배너', '(맨 끝 · 1장 · 예: 예약 전 주의사항)', banners, setBanners, 2)}
                </div>
                <p className="m-0 mt-2 text-[11px] text-[#94a3b8]">배치: <b>상단 배너 1장</b> → <b>실사(문단 사이 · 발행마다 2장 좌우/낱개 랜덤)</b> → <b>끝 배너 1장</b> (더반·누수 스타일). 배너 남발 금지, 실사 위주. 넣지 않으면 텍스트만 발행됩니다.</p>
            </div>

            {/* SEO 키워드 찾기 — 접수(고객ERP)와 동일: 검색량 + SUB4 정확 인기탭 분석(최대 50) + 선택. */}
            <CafeKeywordFinder
                clientId={clientId}
                mode="keyword"
                initialPicked={intakePicked}
                extraUsed={intakePicked.map((p) => p.keyword)}
                goalCount={goalCount}
                onPick={(kws, pk) => {
                    setSelectedKw(new Set(kws));
                    setProductKw(pk);
                    // 모델B: 고른 키워드를 계약 키워드 풀에 누적(중복 제외).
                    setPoolKw((prev) => Array.from(new Set([...prev, ...kws.filter(Boolean)])));
                }}
            />
            {/* 발행 요청 보내기 — 고른 키워드를 발행PC 대기열(cafe_gen_requests)로. 원고·이미지는 그 PC가 자기 양식으로 생성·게시. */}
            {(() => {
                const target = publishTargetFor(company);
                // 고정업체(더반/누수 등)=우리 카페. 그 외(신규 업체, 모델B: 고객 자기 카페·자기 계정 → SUB2).
                const isSelf = !target && !!clientId;   // client_id 만 있으면 신규 발행 가능(cafe_account 없어도)
                if (!target && !isSelf) return null;
                // ── 고정업체: 기존 단일 발행요청 ──
                if (target) {
                    const n = selectedKw.size;
                    const sendFixed = async () => {
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
                            <button type="button" onClick={() => void sendFixed()} disabled={reqBusy || !n}
                                className="ml-auto h-10 rounded-lg bg-[#7c3aed] px-5 text-sm font-bold text-white hover:bg-[#6d28d9] disabled:opacity-50">
                                {reqBusy ? '전송 중…' : `${target.pc} 발행 요청 (${n}건)`}
                            </button>
                            {reqMsg ? <span className="w-full text-[12px] font-semibold text-[#166534]">{reqMsg}</span> : null}
                        </div>
                    );
                }
                // ── 신규 업체(모델B): 일별 발행 — 키워드 풀에서 미사용 N개 골라 dep_{style}_ 로 요청 ──
                const norm = (s: string) => s.replace(/\s/g, '');
                const USED = new Set(['done', 'pending', 'processing', 'claimed']);
                const st = (kw: string) => genStatus[norm(kw)];
                const unused = poolKw.filter((kw) => !USED.has(st(kw)));
                const doneN = poolKw.filter((k) => st(k) === 'done').length;
                const pendN = poolKw.filter((k) => ['pending', 'processing', 'claimed'].includes(st(k))).length;
                const pick = Math.min(dailyCount, unused.length);
                const sendSelf = async (style: 'info' | 'review') => {
                    const picks = unused.slice(0, dailyCount);
                    if (!picks.length) { setReqMsg('미사용 키워드가 없습니다 — finder로 키워드를 더 추가하세요.'); return; }
                    setReqBusy(true); setReqMsg('');
                    const { error, count } = await enqueueGenRequestsSelf(clientId!, picks, productKw, style);
                    setReqBusy(false);
                    if (error) { setReqMsg(`요청 실패: ${error.message}`); return; }
                    setReqMsg(`${count}건 발행 요청 완료(${style === 'info' ? '정보성' : '후기성'}) — SUB2가 순차 게시. 미사용 ${Math.max(0, unused.length - count)}개 남음.`);
                    await loadGenStatus();
                };
                return (
                    <div className="grid gap-2 rounded-xl border border-[#c4b5fd] bg-[#f5f3ff] p-3">
                        <div className="flex flex-wrap items-center gap-2">
                            <div className="text-[13px] font-bold text-[#6d28d9]">SUB2 일별 발행 <span className="font-normal text-[#94a3b8]">— 자기 카페 · 스타일+건수</span></div>
                            <span className="text-[11px] text-[#64748b]">풀 {poolKw.length} · <span className="text-[#16a34a]">발행됨 {doneN}</span> · <span className="text-[#b45309]">진행중 {pendN}</span> · <b>미사용 {unused.length}</b></span>
                            <button type="button" onClick={() => void loadGenStatus()} className="ml-auto text-[11px] font-semibold text-[#4338ca] hover:underline">상태 새로고침</button>
                        </div>
                        {poolKw.length ? (
                            <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
                                {poolKw.map((kw) => {
                                    const s = st(kw);
                                    const cls = s === 'done' ? 'bg-[#dcfce7] text-[#166534] line-through'
                                        : USED.has(s) ? 'bg-[#fef9c3] text-[#854d0e]'
                                            : 'bg-white text-[#475569] ring-1 ring-[#cbd5e1]';
                                    return <span key={kw} className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${cls}`}>{kw}{s === 'done' ? ' ✓' : USED.has(s) ? ' …' : ''}</span>;
                                })}
                            </div>
                        ) : (
                            <div className="text-[12px] text-[#94a3b8]">아래 finder로 키워드를 찾아 고르면 여기 풀에 쌓입니다. <b>'값 저장하기'로 풀을 저장</b>하세요(1회 세팅).</div>
                        )}
                        <div className="flex flex-wrap items-center gap-2">
                            <span className="text-[12px] font-semibold text-[#475569]">건수</span>
                            {[1, 2, 3, 4, 5].map((c) => (
                                <button key={c} type="button" onClick={() => setDailyCount(c)}
                                    className={`h-8 w-8 rounded-md text-[13px] font-bold ${dailyCount === c ? 'bg-[#4338ca] text-white' : 'bg-white text-[#475569] ring-1 ring-[#cbd5e1]'}`}>{c}</button>
                            ))}
                            <div className="ml-auto flex gap-2">
                                <button type="button" onClick={() => void sendSelf('info')} disabled={reqBusy || !unused.length}
                                    className="h-10 rounded-lg bg-[#2563eb] px-5 text-sm font-bold text-white hover:bg-[#1d4ed8] disabled:opacity-50">
                                    {reqBusy ? '전송 중…' : `정보성 ${pick}건`}
                                </button>
                                <button type="button" onClick={() => void sendSelf('review')} disabled={reqBusy || !unused.length}
                                    className="h-10 rounded-lg bg-[#7c3aed] px-5 text-sm font-bold text-white hover:bg-[#6d28d9] disabled:opacity-50">
                                    {reqBusy ? '전송 중…' : `후기성 ${pick}건`}
                                </button>
                            </div>
                        </div>
                        {reqMsg ? <span className="text-[12px] font-semibold text-[#166534]">{reqMsg}</span> : null}
                    </div>
                );
            })()}

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

            {/* 발행 히스토리 — 순위 트래커 기준(실제 발행·측정된 글). 더맨/설고/더반 등 SUB PC 발행분 포함. */}
            <div className="rounded-xl border border-[#e2e8f0] bg-white p-4">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <div className="text-[13px] font-bold text-[#334155]">발행 히스토리 <span className="font-normal text-[#94a3b8]">— 순위 트래커 기준</span></div>
                    <div className="flex items-center gap-2 text-[11px]">
                        <span className="text-[#64748b]">
                            오늘 <b className="text-[#4338ca]">{rankPosts.filter((p) => p.published_date === cafeTodayKST()).length}</b>건 · 누적 <b className="text-[#334155]">{rankPosts.length}</b>/{goalCount || '—'}건{goalCount ? ` (${Math.round((rankPosts.length / goalCount) * 100)}%)` : ''}
                        </span>
                        <button className="rounded-md border border-[#16a34a] px-2 py-0.5 text-[11px] font-bold text-[#15803d] hover:bg-[#f0fdf4] disabled:opacity-40" onClick={exportRankHistory} disabled={!rankPosts.length} type="button">엑셀</button>
                        <button className="font-semibold text-[#4338ca] hover:underline" onClick={() => void loadRankPosts()} type="button">새로고침</button>
                    </div>
                </div>
                {/* 진행률 바 — 누적/목표 */}
                {goalCount ? (
                    <div className="mb-2 h-1.5 w-full overflow-hidden rounded-full bg-[#f1f5f9]">
                        <div className="h-full rounded-full bg-[#4338ca]" style={{ width: `${Math.min(100, Math.round((rankPosts.length / goalCount) * 100))}%` }} />
                    </div>
                ) : null}
                {rankLoading ? (
                    <div className="py-4 text-center text-[12px] text-[#94a3b8]">불러오는 중…</div>
                ) : rankPosts.length ? (
                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[640px] border-collapse text-[12px]">
                            <thead>
                                <tr className="border-b border-[#e2e8f0] text-left text-[#64748b]">
                                    {['발행일', '키워드', '게시판', '현재 순위', '실적', '글'].map((h) => <th key={h} className="whitespace-nowrap px-2 py-1.5 font-semibold">{h}</th>)}
                                </tr>
                            </thead>
                            <tbody>
                                {rankPosts.map((p) => {
                                    const m = latestCafeMeasure(p.measurements);
                                    const rankText = !m ? '-' : m.ti_status === 'ok' ? `${m.ti}위` : m.ti_status === 'out' ? '권외' : m.ti_status === 'no_section' ? '측정불가' : '실패';
                                    const rankCls = m?.ti_status === 'ok' ? (m.ti <= 5 ? 'font-bold text-[#166534]' : 'text-[#334155]') : 'text-[#94a3b8]';
                                    const achieved = p.top5_achieved_at && !p.top5_seeded;
                                    const url = p.post_url || (p.cafe_name && p.article_id ? `https://cafe.naver.com/${p.cafe_name}/${p.article_id}` : null);
                                    return (
                                        <tr className="border-b border-[#f1f5f9] align-top text-[#334155]" key={p.id}>
                                            <td className="whitespace-nowrap px-2 py-1.5">{p.published_date ?? '-'}</td>
                                            <td className="px-2 py-1.5">{p.keyword_manual || p.keyword || '-'}</td>
                                            <td className="whitespace-nowrap px-2 py-1.5 text-[#64748b]">{p.board ?? p.cafe_accounts?.board_short ?? '-'}</td>
                                            <td className={`whitespace-nowrap px-2 py-1.5 ${rankCls}`}>{rankText}</td>
                                            <td className="whitespace-nowrap px-2 py-1.5">
                                                {achieved ? <span className="rounded-full bg-[#dcfce7] px-2 py-0.5 text-[11px] font-bold text-[#166534]">✓ 실적</span>
                                                    : p.top5_seeded ? <span className="rounded-full bg-[#f1f5f9] px-2 py-0.5 text-[11px] font-semibold text-[#94a3b8]">기준</span>
                                                    : p.top5_since ? <span className="text-[11px] text-[#b45309]">5위 진입</span>
                                                    : <span className="text-[11px] text-[#cbd5e1]">-</span>}
                                            </td>
                                            <td className="whitespace-nowrap px-2 py-1.5">{url ? <a className="text-[#2563eb] hover:underline" href={url} rel="noreferrer" target="_blank">보기</a> : '-'}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                ) : <div className="py-4 text-center text-[12px] text-[#94a3b8]">순위 트래커에 등록된 발행 글이 없습니다.</div>}
            </div>
        </div>
    );
}
