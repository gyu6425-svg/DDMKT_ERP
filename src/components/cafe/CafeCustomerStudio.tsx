import { useEffect, useRef, useState } from 'react';
import { listTokens, balanceOf } from '../../api/cafeTokens';
import { getCafeAccounts } from '../../api/cafeAccounts';
import { getStudioSettings, saveStudioSettings, clearStudioSettings, uploadStudioImage, signedStudioUrls, studioSavedPath, updateKeywordPool, markNaverLogin } from '../../api/cafeStudioSettings';
import { getLatestDeployForStudio, getCafeDeployGoal } from '../../api/cafeDeployRequests';
import { getCafeRankPostsForClient, latestCafeMeasure, cafeTodayKST, type CafeRankPost } from '../../api/cafeRank';
import { downloadCsv, todayTag } from '../../lib/exportCsv';
import { enqueueGenRequests, enqueueGenRequestsSelf, getGenRequestStatus, getGenQueueSummary, holdGenRequests, resumeGenRequests, countHeldGenRequests, deleteGenRequest, publishTargetFor, kstYmd, kstNowNaive, fmtScheduled, type GenQueueSummary } from '../../api/cafeGenRequests';
import { CafeCustomerRequest } from './CafeCustomerRequest';
import { CafeKeywordFinder } from './CafeKeywordFinder';
import { customerLogin } from '../../api/nusu2Bridge';
import { grantTokens } from '../../api/cafeTokens';
import { useAuth } from '../../hooks/useAuth';

// 자체발행 전환 업체(더맨·설고·더반·누수상담소) — 고정 라우팅 대신 든든한마케팅과 동일 dep_ 자기카페 UI/발행을 쓴다.
//   전제(SUB2): 해당 계정 기존 발행(SUB1/자율) 중단 · board_url에 clubid · 전용포트 로그인. dep_ 폴러가 client_id로 자동 처리.
const SELF_PUBLISH_KEYS = new Set(['theman', 'theman2', 'seolgo', 'seolgo2', 'theban', 'nusu']);

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
    const [preview, setPreview] = useState<string | null>(null); // 이미지 확대 보기(라이트박스)

    // 공통 업체정보
    const [brand, setBrand] = useState('');
    const [business, setBusiness] = useState('');

    // 발행 요청(cafe_gen_requests) — finder 선택 키워드 → 발행PC(SUB1/SUB2) 대기열로.
    const [productKw, setProductKw] = useState(''); // finder 제품키워드(입주청소/사설경호/누수탐지…)
    const [finderMode, setFinderMode] = useState<'keyword' | 'region' | 'related' | 'info' | 'manual'>('keyword'); // 키워드 찾기 유형(정보형·직접 키워드 포함)
    // 모델B 일별 발행 — 계약 키워드 풀 + 발행상태(칩 색상·미사용 판별) + 매일 건수.
    const [poolKw, setPoolKw] = useState<string[]>([]);
    const [selfPicked, setSelfPicked] = useState<Set<string>>(new Set());   // 칩 클릭 선택발행 대상(비어있으면 앞에서 dailyCount건)
    // 삭제한 풀 키워드 기억(finder가 매 렌더 onPick으로 seed를 재주입 → 삭제가 되살아나는 것 차단). 새로고침에도 유지(localStorage).
    const [removedKw, setRemovedKw] = useState<Set<string>>(new Set());
    const RK_KEY = (cid: string) => `cafe_removed_pool_${cid}`;
    // 풀에서 키워드 삭제(칩 ×) — 상태 갱신 + 즉시 저장 + 삭제목록에 등록(재주입 차단).
    // 칩 삭제 — DB 저장 실패를 삼키면 화면만 지워지고 새로고침 때 되살아난다(실제 증상). 실패 시 되돌리고 알린다.
    const removePoolKw = async (kw: string) => {
        if (!clientId) return;
        const prev = poolKw;
        const next = poolKw.filter((k) => k !== kw);
        setPoolKw(next);
        setRemovedKw((r) => {
            const n = new Set(r); n.add(kw);
            try { localStorage.setItem(RK_KEY(clientId), JSON.stringify([...n])); } catch { /* 무시 */ }
            return n;
        });
        const { error } = await updateKeywordPool(clientId, next);
        if (error) {
            setPoolKw(prev);                       // 낙관적 반영 취소 — DB와 화면을 일치시킨다
            setReqMsg(`키워드 삭제 실패: ${error}`);
        }
    };
    const [genStatus, setGenStatus] = useState<Record<string, string>>({});
    const [queue, setQueue] = useState<GenQueueSummary | null>(null);   // 하단 상태바(발행중/대기/오늘완료/실패)
    const [heldN, setHeldN] = useState(0);        // 중단 보관분(재개 버튼용) — 메인 목록엔 안 넣는다
    const [holdBusy, setHoldBusy] = useState(false);
    const [dailyCount, setDailyCount] = useState(1);
    // 예약 발행 — 발행 시점 선택(지금/내일10시/직접/여러 날 분산). scheduled_at(KST 벽시계 naive)로 sub2에 넘긴다.
    const [scheduleMode, setScheduleMode] = useState<'now' | 'tomorrow' | 'custom' | 'spread'>('now');
    const [scheduleAt, setScheduleAt] = useState('');   // datetime-local "YYYY-MM-DDTHH:mm"
    const [spreadTotal, setSpreadTotal] = useState(''); // 여러 날 분산 총 건수(빈값=미사용 전체)
    const [spreadStartAt, setSpreadStartAt] = useState(''); // 시작 datetime-local(빈값=지금부터 즉시)
    const [spreadEnd, setSpreadEnd] = useState('');         // 끝 날짜 "YYYY-MM-DD"(빈값=자동=필요한 만큼)
    const [spreadPerDay, setSpreadPerDay] = useState<number | ''>(''); // 하루 발행건수(빈값=daily_cap). 설고처럼 하루 1건도 선택 가능
    // 두 날짜(YYYY-MM-DD) 사이 일수(b-a).
    const daysBetweenYmd = (a: string, b: string) => {
        const [ay, am, ad] = a.split('-').map(Number); const [by, bm, bd] = b.split('-').map(Number);
        return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
    };
    // 단일 시각 예약값(지금=NULL / 내일10시 / 직접). 분산 모드는 여기 안 쓰고 chunk별로 따로 계산.
    const computeScheduledAt = (): string | null => {
        if (scheduleMode === 'now' || scheduleMode === 'spread') return null;
        if (scheduleMode === 'tomorrow') return `${kstYmd(1)}T10:00:00`;
        if (!scheduleAt) return null;
        return scheduleAt.length === 16 ? `${scheduleAt}:00` : scheduleAt.slice(0, 19);
    };
    // 임의 날짜(YYYY-MM-DD)에 n일 더하기.
    const addDaysYmd = (ymd: string, n: number) => {
        const [y, m, d] = ymd.split('-').map(Number);
        return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
    };
    async function loadGenStatus() {
        if (!clientId) return;
        const [m, q, h] = await Promise.all([getGenRequestStatus(clientId), getGenQueueSummary(clientId), countHeldGenRequests(clientId)]);
        setGenStatus(m); setQueue(q); setHeldN(h);
    }
    // 발행 중단 / 재개 — 대기(pending)만 held 로 보류. 진행 중(claimed) 1건은 끝까지 진행된다.
    const toggleHold = async (resume: boolean) => {
        if (!clientId) return;
        setHoldBusy(true);
        const r = resume ? await resumeGenRequests(clientId) : await holdGenRequests(clientId);
        setHoldBusy(false);
        setReqMsg(r.error ? `실패: ${r.error}`
            : resume ? `중단분 ${r.count}건을 다시 대기열에 넣었습니다.`
                : `대기 ${r.count}건 발행을 중단했습니다.${queue?.publishing.length ? ' (진행 중 1건은 끝까지 게시됩니다)' : ''}`);
        await loadGenStatus();
    };
    // 개별 발행 취소 — 예약/대기/실패 1건을 큐에서 삭제(그 건만). 발행 중(claimed)은 대상 아님.
    const cancelQueueItem = async (id: string) => {
        const { error } = await deleteGenRequest(id);
        if (error) { setReqMsg(`취소 실패: ${error}`); return; }
        await loadGenStatus();
    };
    // 진행중(발행 중)인 요청이 있으면 20초마다 상태 자동 갱신 → 현재 발행건 게이지 실시간 반영.
    useEffect(() => {
        const active = Object.values(genStatus).some((s) => ['pending', 'claimed', 'processing', 'posted'].includes(s));
        if (!active || !clientId) return;
        // 발행 중엔 5초 폴링(SUB2 권장) — 상태 전이가 빨라 20초면 '발행중'을 놓친다.
        const t = setInterval(() => { void loadGenStatus(); }, 5000);
        return () => clearInterval(t);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [genStatus, clientId]);
    // 칩 선택 개수 → '건수' 버튼 자동 동기화(2개 선택 = 건수 2). 선택 있으면 그 수로, 최대 5.
    useEffect(() => {
        if (selfPicked.size > 0) setDailyCount(Math.min(5, selfPicked.size));
    }, [selfPicked]);
    const [reqBusy, setReqBusy] = useState(false);
    const [reqMsg, setReqMsg] = useState('');
    const [manualInput, setManualInput] = useState('');   // 직접 키워드 입력(인기탭 미검증)
    // '추가' → 로컬 칩이 아니라 아래 'SUB2 일별 발행' 풀(poolKw)에 바로 쌓는다. 발행은 그 섹션의 정보성/후기성으로.
    const addManualToPool = async () => {
        const parts = manualInput.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
        if (!parts.length) return;
        const next = Array.from(new Set([...poolKw, ...parts]));
        setPoolKw(next);
        setManualInput('');
        // 다시 추가하는 것이므로 삭제목록에서 해제(재주입 차단 대상에서 제외).
        setRemovedKw((r) => {
            const n = new Set(r); parts.forEach((p) => n.delete(p));
            if (clientId) { try { localStorage.setItem(RK_KEY(clientId), JSON.stringify([...n])); } catch { /* 무시 */ } }
            return n;
        });
        if (clientId) { const { error } = await updateKeywordPool(clientId, next); if (error) setReqMsg(`저장 실패: ${error}`); }
    };

    // SEO 키워드 찾기

    const [linkUrl, setLinkUrl] = useState('');   // 본문 끝 링크카드(홈페이지 등) — 저장 설정에 포함.
    // 발행 재사용 정보 — 네이버 로그인 + 발행 게시판(이름·주소). 저장 설정에 포함.
    const [naverId, setNaverId] = useState('');
    const [naverPw, setNaverPw] = useState('');
    const [showPw, setShowPw] = useState(false);
    const [boardName, setBoardName] = useState('');
    const [boardUrl, setBoardUrl] = useState('');
    const [dailyCap, setDailyCap] = useState(5);   // 하루 최대 발행 수(1~10) — SUB2 dep_ poller 소비
    const [gapMin, setGapMin] = useState(0);        // 발행 최소 간격(분). 0=제한 없음
    const [loginMsg, setLoginMsg] = useState('');   // '네이버 로그인' 버튼 결과 안내 — SUB2 브릿지 호출 성공/실패.
    const [loginBusy, setLoginBusy] = useState(false);
    const [naverLoggedIn, setNaverLoggedIn] = useState(false);   // 네이버 로그인 이력 있으면 버튼 색 변경
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
            // 이미지 저장 — 이미 저장된 건(R2 URL) 재사용, 새 이미지(dataURL)만 R2 업로드.
            //   ⚠️ 업로드 실패는 삼키지 않고 즉시 throw — 어느 사진이 왜 실패했는지 노출하고 저장 자체를 중단한다.
            //   (실패를 무시하고 저장하면 DB엔 경로만 남고 R2엔 파일이 없어 근본 혼란이 된다.)
            const persist = async (list: string[], kind: 'main_banner' | 'photos' | 'banners') => {
                const out: string[] = [];
                for (let i = 0; i < list.length; i += 1) {
                    const saved = studioSavedPath(list[i]);
                    if (saved) { out.push(saved); continue; }
                    const res = await uploadStudioImage(clientId, kind, i, list[i]);
                    if (res.error || !res.path) throw new Error(`사진 업로드 실패 (${kind} ${i + 1}번째): ${res.error ?? '알 수 없는 오류'}`);
                    out.push(res.path);
                }
                return out;
            };
            const totalImgs = mainBanner.length + photos.length + banners.length;
            if (totalImgs) setSettingsMsg(`사진 ${totalImgs}장 업로드 중…`);
            const [mainPaths, photoPaths, bannerPaths] = await Promise.all([
                persist(mainBanner, 'main_banner'),
                persist(photos, 'photos'),
                persist(banners, 'banners'),
            ]);
            const { error } = await saveStudioSettings({
                client_id: clientId, brand: brand || null, business: business || null, homepage: linkUrl || null,
                deploy_type: '키워드형', main_banner: mainPaths, photos: photoPaths, banners: bannerPaths,
                naver_id: naverId || null, naver_pw: naverPw || null, board_name: boardName || null, board_url: boardUrl || null,
                kakao_url: kakaoUrl || null,
                daily_cap: dailyCap, publish_gap_min: gapMin,
                keyword_pool: poolKw.length ? poolKw : null, product_kw: productKw || null,
            });
            if (error) throw new Error(error.message);
            setSettingsSaved(true); setSettingsMsg(`저장됨 · 사진 ${mainPaths.length + photoPaths.length + bannerPaths.length}장 포함 · 다음부터 이 값으로 열립니다`);
        } catch (e) { setSettingsMsg('저장 실패: ' + (e instanceof Error ? e.message : '')); }
        finally { setSavingSettings(false); }
    };
    const resetSettings = async () => {
        if (!clientId) return;
        await clearStudioSettings(clientId);
        setBrand(brandDefault); setBusiness(''); setLinkUrl(''); setPhotos([]); setBanners([]); setMainBanner([]);
        setNaverId(''); setNaverPw(''); setBoardName(''); setBoardUrl(''); setKakaoUrl(''); setDailyCap(5); setGapMin(0);
        setSettingsSaved(false); setSettingsMsg('초기화됨');
    };
    const [selectedKw, setSelectedKw] = useState<Set<string>>(() => new Set());

    // 발행 현황 — 이 client 의 업체키(히스토리 필터용). '오늘 발행'/'순위 트래커' 히스토리는 rankPosts 기준.
    const companiesRef = useRef<string[]>([]);

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
    // 관리자 전용 — 서비스 토큰(무상) 발급. 고객에겐 안 보임.
    const { isAdmin } = useAuth();
    const [grantN, setGrantN] = useState(5);
    const [grantBusy, setGrantBusy] = useState(false);
    const [grantMsg, setGrantMsg] = useState('');
    const grantService = async () => {
        if (!clientId || grantN <= 0) return;
        setGrantBusy(true); setGrantMsg('');
        const { error } = await grantTokens(clientId, grantN, `서비스 토큰 · +${grantN}건`);
        setGrantBusy(false);
        if (error) { setGrantMsg('발급 실패: ' + error.message); return; }
        setGrantMsg(`서비스 토큰 ${grantN}건 발급 완료`);
        await loadTokens();
    };

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
        });
        void loadTokens();
        void loadRankPosts();
        const t = setInterval(() => { void loadRankPosts(); }, 15000);   // 오늘 발행 리스트 실시간 갱신
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
            setNaverLoggedIn(!!(s as { naver_login_at?: string } | null)?.naver_login_at);
            const bname = s?.board_name ?? req?.board_name; if (bname) setBoardName(bname);
            if (s?.board_url) setBoardUrl(s.board_url);
            if (s?.kakao_url) setKakaoUrl(s.kakao_url);
            if (s?.daily_cap != null) setDailyCap(s.daily_cap);
            if (s?.publish_gap_min != null) setGapMin(s.publish_gap_min);
            // 모델B 일별 발행 — 저장된 키워드 풀 + 제품키워드 + 현재 발행상태.
            if (s?.keyword_pool?.length) setPoolKw(s.keyword_pool);
            if (s?.product_kw) setProductKw(s.product_kw);
            // 삭제한 풀 키워드 복원(finder 재주입 차단이 새로고침에도 유지되게).
            try { const raw = clientId ? localStorage.getItem(RK_KEY(clientId)) : null; if (raw) setRemovedKw(new Set(JSON.parse(raw))); } catch { /* 무시 */ }
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

    // 라이트박스 열렸을 때 ESC로 닫기
    useEffect(() => {
        if (!preview) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPreview(null); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [preview]);

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
                            <img alt={`${label} ${i + 1}`} className="h-16 w-16 cursor-zoom-in rounded-md border border-[#e2e8f0] object-cover transition hover:brightness-95" src={src} onClick={() => setPreview(src)} title="클릭하면 크게 보기" />
                            <button className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-[#dc2626] text-[11px] font-bold text-white" onClick={() => setter((p) => p.filter((_, j) => j !== i))} type="button">×</button>
                        </div>
                    ))}
                </div>
            ) : <span className="text-[11px] font-normal text-[#cbd5e1]">아직 없음</span>}
        </div>
    );

    if (approved === false) return <CafeCustomerRequest clientId={clientId} />;

    // 토큰 소진(잔여 0) — 발행 사용 불가 + 연장(충전) 안내. 관리자는 우회(서비스 토큰 발급 등 관리 가능).
    if (approved && tokenBal <= 0 && !isAdmin) {
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
            {/* 이미지 확대 보기(라이트박스) — 썸네일 클릭 시 원본 크게 */}
            {preview ? (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-6" onClick={() => setPreview(null)}>
                    <img alt="확대 보기" className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain shadow-2xl" src={preview} onClick={(e) => e.stopPropagation()} />
                    <button className="absolute right-5 top-5 flex h-10 w-10 items-center justify-center rounded-full bg-white/90 text-xl font-bold text-[#334155] hover:bg-white" onClick={() => setPreview(null)} type="button" aria-label="닫기">×</button>
                </div>
            ) : null}

            <div className="rounded-lg bg-[#eff6ff] px-4 py-3 text-sm text-[#1e40af]">
                발행 대상 게시판: <b>{board ?? '(확인 중)'}</b>
                <span className="ml-2 text-[#64748b]">— 발행하면 본인 카페의 이 게시판에 자동 게시됩니다.</span>
            </div>

            {/* 관리자 전용 — 서비스 토큰(무상) 발급 */}
            {isAdmin ? (
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[#fbbf24] bg-[#fffbeb] px-4 py-2.5 text-sm">
                    <span className="font-bold text-[#92400e]">🎫 서비스 토큰 발급 <span className="font-normal text-[#b45309]">(관리자 전용)</span></span>
                    <span className="text-[#78716c]">잔여 <b className="text-[#92400e]">{tokenBal}</b>건</span>
                    <div className="ml-auto flex items-center gap-1.5">
                        {[3, 5, 10, 30].map((c) => (
                            <button key={c} type="button" onClick={() => setGrantN(c)}
                                className={`h-8 rounded-md px-2.5 text-xs font-bold ${grantN === c ? 'bg-[#d97706] text-white' : 'bg-white text-[#92400e] ring-1 ring-[#fbbf24]'}`}>{c}</button>
                        ))}
                        <input type="number" min={1} value={grantN} onChange={(e) => setGrantN(Math.max(1, Number(e.target.value) || 1))} className="h-8 w-16 rounded-md border border-[#fbbf24] px-2 text-sm" />
                        <button type="button" onClick={() => void grantService()} disabled={grantBusy}
                            className="h-8 rounded-md bg-[#d97706] px-4 text-xs font-bold text-white hover:bg-[#b45309] disabled:opacity-50">{grantBusy ? '발급 중…' : `＋${grantN}건 발급`}</button>
                    </div>
                    {grantMsg ? <span className="w-full text-[12px] font-semibold text-[#166534]">{grantMsg}</span> : null}
                </div>
            ) : null}

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
                    <label className="grid gap-1 text-xs font-semibold text-[#475569]">글쓰기 주소
                        <input className={inputCls} onChange={(e) => setBoardUrl(e.target.value)} placeholder="카페에서 '글쓰기' 열었을 때 주소창 URL" value={boardUrl} />
                        <span className="text-[11px] font-normal text-[#94a3b8]">발행할 게시판에서 '글쓰기'를 눌러 열린 주소창 URL을 그대로 붙여넣으세요(게시판 목록 주소 아님).</span>
                    </label>
                    <label className="grid gap-1 text-xs font-semibold text-[#475569]">하루 최대 발행 수
                        <input className={inputCls} type="number" min={1} max={10} value={dailyCap}
                            onChange={(e) => setDailyCap(Math.min(10, Math.max(1, Number(e.target.value) || 1)))} placeholder="1~10" />
                        <span className="text-[11px] font-normal text-[#94a3b8]">이 수만큼 발행하면 그날은 중단 → 다음날 자동 재개.</span>
                    </label>
                    <label className="grid gap-1 text-xs font-semibold text-[#475569]">발행 간격 <span className="font-normal text-[#94a3b8]">(발행 텀)</span>
                        <select className={inputCls} value={gapMin} onChange={(e) => setGapMin(Number(e.target.value))}>
                            <option value={0}>제한 없음</option>
                            <option value={30}>30분에 1건</option>
                            <option value={60}>1시간에 1건</option>
                            <option value={90}>1시간 30분에 1건</option>
                            <option value={120}>2시간에 1건</option>
                            <option value={150}>2시간 30분에 1건</option>
                            <option value={180}>3시간에 1건</option>
                        </select>
                        <span className="text-[11px] font-normal text-[#b45309]">⚠ 신규 카페는 짧은 간격 대량발행 시 노출 역효과 — 간격을 넉넉히(2~3시간급) 잡으세요.</span>
                    </label>
                </div>
                {/* 네이버 로그인 — SUB2가 이 고객 전용 크롬을 띄우고 담당자가 직접 로그인(자동입력 안 함=봇 방지) */}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button type="button" disabled={!clientId || loginBusy}
                        className={`h-10 rounded-lg px-5 text-sm font-bold disabled:opacity-50 ${naverLoggedIn
                            ? 'border-2 border-[#15803d] bg-white text-[#15803d] hover:bg-[#f0fdf4]'
                            : 'bg-[#03c75a] text-white hover:bg-[#02b350]'}`}
                        onClick={async () => {
                            if (!clientId) return;
                            setLoginBusy(true); setLoginMsg('전용 크롬 실행 중…');
                            const r = await customerLogin(clientId);
                            setLoginBusy(false);
                            if (r.ok) { setNaverLoggedIn(true); void markNaverLogin(clientId); }
                            setLoginMsg(r.ok
                                ? '전용 크롬을 띄웠습니다 — 뜬 창에서 직접 로그인하세요.'
                                : r.reached
                                    ? `크롬 실행 실패 — ${r.error || '알 수 없음'} (이미 열린 그 고객 크롬이 있으면 닫고 다시 시도하세요)`
                                    : `브릿지 연결 실패 — 발행 프로그램(SUB2)이 켜져 있는지·로컬에서 접속했는지 확인하세요. (${r.error || '연결 불가'})`);
                        }}>
                        {loginBusy ? '실행 중…' : naverLoggedIn ? '✓ 네이버 로그인됨 (재로그인)' : '네이버 로그인 (담당자 수동)'}
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

            {/* 키워드 찾기 유형 — 키워드형(플레이스) / 지역형(지역×키워드) / 직접 키워드. 한 번에 하나만. */}
            <div className="flex flex-wrap items-center gap-2">
                <span className="text-[12px] font-semibold text-[#64748b]">키워드 찾기 유형</span>
                {([['keyword', '키워드형 (플레이스 주소)'], ['region', '지역형 (지역 × 키워드)'], ['related', '🔗 연관 인기글 (보홀·하와이 등)'], ['info', '🌐 정보형 (홈페이지·블로그 주소)'], ['manual', '✍️ 직접 키워드']] as const).map(([m, label]) => (
                    <button key={m} type="button" onClick={() => setFinderMode(m)}
                        className={`rounded-full px-4 py-1.5 text-[13px] font-bold ${finderMode === m ? 'bg-[#0369a1] text-white' : 'bg-white text-[#475569] ring-1 ring-[#cbd5e1]'}`}>{label}</button>
                ))}
            </div>
            {finderMode === 'manual' ? (
                /* 직접 키워드 발행 — 인기탭 없어도 업체가 직접 넣어 발행. '추가'하면 아래 'SUB2 일별 발행' 풀에 칩으로 쌓이고, 발행은 그 섹션의 정보성/후기성으로. */
                <div className="rounded-xl border-2 border-[#f59e0b] bg-[#fffbeb] p-4">
                    <div className="mb-2 text-[13px] font-bold text-[#b45309]">✍️ 직접 키워드 발행 <span className="font-normal text-[#a16207]">(인기탭 없어도 발행 · 추가하면 아래 ‘SUB2 일별 발행’ 풀에 쌓입니다)</span></div>
                    <div className="flex flex-wrap items-center gap-2">
                        <input className={`${inputCls} flex-1 min-w-[200px]`} value={manualInput} onChange={(e) => setManualInput(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void addManualToPool(); } }}
                            placeholder="키워드 입력 후 추가 (예: 수원 출장뷔페) — 쉼표로 여러 개" />
                        <button type="button" onClick={() => void addManualToPool()} disabled={!manualInput.trim()} className="h-10 shrink-0 rounded-md bg-[#b45309] px-5 text-sm font-bold text-white hover:bg-[#92400e] disabled:opacity-50">추가 ↓</button>
                    </div>
                    <p className="m-0 mt-2 text-[11px] text-[#a16207]">추가한 키워드는 아래 <b>SUB2 일별 발행</b> 풀에 칩으로 쌓입니다. 거기서 건수를 고르고 <b>정보성/후기성</b>으로 발행하세요.</p>
                </div>) : null}
            {finderMode !== 'manual' ? (
                <CafeKeywordFinder
                    clientId={clientId}
                    mode={finderMode}
                    initialPicked={intakePicked}
                    extraUsed={intakePicked.map((p) => p.keyword)}
                    goalCount={goalCount}
                    onPick={(kws, pk) => {
                        setSelectedKw(new Set(kws));
                        setProductKw(pk);
                        // 모델B: 고른 키워드를 계약 키워드 풀에 누적(중복 제외) · 사용자가 삭제한 키워드는 재주입 금지.
                        setPoolKw((prev) => Array.from(new Set([...prev, ...kws.filter(Boolean)])).filter((k) => !removedKw.has(k)));
                    }}
                />
            ) : null}
            {/* 발행 요청 보내기 — 고른 키워드를 발행PC 대기열(cafe_gen_requests)로. 원고·이미지는 그 PC가 자기 양식으로 생성·게시. */}
            {(() => {
                const target = publishTargetFor(company);
                // 자체발행 전환 업체(더맨·설고·더반·누수상담소)는 고정 target이 있어도 dep_ 자기카페 UI를 쓴다.
                const forceSelf = company ? SELF_PUBLISH_KEYS.has(company) : false;
                // 고정업체(전환 안 된 우리 카페 고정 라우팅)=fixed UI. 그 외/전환업체=모델B(자기 카페·자기 계정 → SUB2 dep_).
                const isSelf = !!clientId && (!target || forceSelf);
                if (!target && !isSelf) return null;
                // ── 고정업체(전환 안 된 것만): 기존 단일 발행요청 ──
                if (target && !isSelf) {
                    const n = selectedKw.size;
                    const sendFixed = async () => {
                        if (!n) { setReqMsg('finder에서 발행할 키워드를 고르세요.'); return; }
                        const sched = computeScheduledAt();
                        setReqBusy(true); setReqMsg('');
                        const { error, count } = await enqueueGenRequests(company!, [...selectedKw], productKw, sched);
                        setReqBusy(false);
                        if (error) { setReqMsg(`요청 실패: ${error.message}`); return; }
                        setReqMsg(`${count}건 발행 요청 전송 완료 — ${sched ? `${fmtScheduled(sched)} 이후 예약` : `${target.pc} 발행 대기열에 담김`}(순차 게시).`);
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
                // held(발행 중단)도 '사용됨'으로 취급 → 예정 큐에 다시 안 뜬다(재개 버튼으로만 되돌림).
                const USED = new Set(['done', 'pending', 'processing', 'claimed', 'held']);
                const st = (kw: string) => genStatus[norm(kw)];
                const unused = poolKw.filter((kw) => !USED.has(st(kw)));
                const doneN = poolKw.filter((k) => st(k) === 'done').length;
                // ⚠️ '대기(pending)'와 '발행중(claimed)'을 구분한다 — 합치면 대기 4건이 "발행중 4"로 보인다.
                const waitN = poolKw.filter((k) => st(k) === 'pending').length;
                const runN = poolKw.filter((k) => ['claimed', 'processing', 'posted'].includes(st(k))).length;
                // 발행 대상 — 칩으로 고른 게 있으면 그것(선택발행), 없으면 앞에서 dailyCount건(순서발행).
                const chosen = selfPicked.size ? unused.filter((k) => selfPicked.has(k)) : unused.slice(0, dailyCount);
                const pick = chosen.length;
                const toggleSelf = (kw: string) => setSelfPicked((prev) => {
                    const n = new Set(prev);
                    if (n.has(kw)) n.delete(kw); else n.add(kw);
                    return n;
                });
                const sendSelf = async (style: 'info' | 'review') => {
                    const picks = chosen;
                    if (!picks.length) { setReqMsg('발행할 키워드가 없습니다 — 칩을 클릭해 고르거나 finder로 추가하세요.'); return; }
                    const sched = computeScheduledAt();
                    setReqBusy(true); setReqMsg('');
                    // 예약 시 발행텀(gapMin)만큼 각 건 시각 스태거 → 첫 13:00·2시간텀이면 15:00·17:00…
                    const { error, count } = await enqueueGenRequestsSelf(clientId!, picks, productKw, style, false, sched, gapMin);
                    setReqBusy(false);
                    if (error) { setReqMsg(`요청 실패: ${error.message}`); return; }
                    setSelfPicked(new Set());
                    const whenMsg = sched ? `${fmtScheduled(sched)}부터 ${gapMin > 0 ? `${gapMin}분 간격 ` : ''}예약 발행` : 'SUB2가 순차 게시';
                    setReqMsg(`${count}건 발행 요청 완료(${style === 'info' ? '정보성' : '후기성'}) — ${whenMsg}. 미사용 ${Math.max(0, unused.length - count)}개 남음.`);
                    await loadGenStatus();
                };
                // ── 여러 날 분산 예약 — 하루 최대(dailyCap)씩 연속일에 나눠 예약. 예) 14건·하루5 → 5/5/4(3일). ──
                const spreadBase = selfPicked.size ? unused.filter((k) => selfPicked.has(k)) : unused;
                const spreadN = spreadTotal ? Math.min(Math.max(1, Number(spreadTotal) || 0), spreadBase.length) : spreadBase.length;
                // 하루 발행건수 — 사용자가 고른 값(1~daily_cap). 빈값이면 daily_cap. SUB2 하루상한을 넘겨도 무의미하므로 cap으로 클램프.
                const capMax = Math.max(1, dailyCap);
                const perDay = spreadPerDay ? Math.min(Math.max(1, Number(spreadPerDay)), capMax) : capMax;
                // 시작 = 지정 datetime 또는 지금(KST). day0가 시작 시각(비우면 지금 = 즉시 발행). 이후 매일 같은 시각.
                const startNaive = spreadStartAt ? (spreadStartAt.length === 16 ? `${spreadStartAt}:00` : spreadStartAt.slice(0, 19)) : kstNowNaive();
                const startYmd = startNaive.slice(0, 10);
                const startTime = startNaive.slice(11, 19) || '10:00:00';
                // 끝 날짜를 정하면 그 범위로 제한(범위가 짧으면 다 못 넣고 나머지는 제외). 안 정하면 필요한 만큼.
                const neededDays = Math.max(1, Math.ceil(spreadN / perDay));
                const maxDays = spreadEnd ? Math.max(1, daysBetweenYmd(startYmd, spreadEnd) + 1) : neededDays;
                const spreadDays = Math.min(neededDays, maxDays);
                const effTotal = Math.min(spreadN, spreadDays * perDay);
                const spreadLeftover = spreadN - effTotal;
                const spreadEndYmd = addDaysYmd(startYmd, spreadDays - 1);
                const spreadChunks: number[] = [];
                for (let i = 0; i < effTotal; i += perDay) spreadChunks.push(Math.min(perDay, effTotal - i));
                const sendSpread = async (style: 'info' | 'review') => {
                    const picks = spreadBase.slice(0, effTotal);
                    if (!picks.length) { setReqMsg('분산할 미사용 키워드가 없습니다.'); return; }
                    setReqBusy(true); setReqMsg('');
                    let total = 0, day = 0;
                    for (let i = 0; i < picks.length; i += perDay) {
                        const chunk = picks.slice(i, i + perDay);
                        const at = `${addDaysYmd(startYmd, day)}T${startTime}`;
                        // 하루 안에서도 발행텀(gapMin)만큼 시각 스태거 → 화면·발행 시각 일치.
                        const { error, count } = await enqueueGenRequestsSelf(clientId!, chunk, productKw, style, false, at, gapMin);
                        if (error) { setReqBusy(false); setReqMsg(`요청 실패(${day + 1}일차): ${error.message}`); await loadGenStatus(); return; }
                        total += count; day += 1;
                    }
                    setReqBusy(false);
                    setSelfPicked(new Set());
                    const startLbl = spreadStartAt ? `${startYmd} ${startTime.slice(0, 5)}` : '지금';
                    setReqMsg(`${total}건을 ${day}일에 나눠 예약 완료(하루 ${perDay}건 · ${style === 'info' ? '정보성' : '후기성'}). ${startLbl}부터 ~ ${spreadEndYmd}${spreadLeftover ? ` · 범위 밖 ${spreadLeftover}건 제외` : ''}. 하루 안 간격은 SUB2가 분산.`);
                    await loadGenStatus();
                };
                return (
                    <div className="grid gap-2 rounded-xl border border-[#c4b5fd] bg-[#f5f3ff] p-3">
                        <div className="flex flex-wrap items-center gap-2">
                            <div className="text-[13px] font-bold text-[#6d28d9]">SUB2 일별 발행 <span className="font-normal text-[#94a3b8]">— 자기 카페 · 스타일+건수</span></div>
                            <span className="text-[11px] text-[#64748b]">
                                풀 {poolKw.length} · <span className="text-[#16a34a]">발행됨 {doneN}</span>
                                {runN ? <> · <span className="font-semibold text-[#b45309]">발행중 {runN}</span></> : null}
                                {waitN ? <> · <span className="text-[#0369a1]">대기 {waitN}</span></> : null}
                                {' '}· <b>미사용 {unused.length}</b>
                            </span>
                            <button type="button" onClick={() => void loadGenStatus()} className="ml-auto text-[11px] font-semibold text-[#4338ca] hover:underline">상태 새로고침</button>
                        </div>
                        {poolKw.length ? (
                            <>
                                <div className="flex items-center justify-between text-[11px] text-[#6d28d9]">
                                    <span>칩을 클릭해 <b>선택 발행</b> · 미선택 시 앞에서 {dailyCount}건{selfPicked.size ? <b className="ml-1 text-[#7c3aed]">· {selfPicked.size}개 선택됨</b> : null}</span>
                                    {selfPicked.size ? <button type="button" onClick={() => setSelfPicked(new Set())} className="font-semibold text-[#94a3b8] hover:text-[#4338ca]">선택 해제</button> : null}
                                </div>
                                <div className="flex max-h-36 flex-wrap gap-2 overflow-y-auto py-1">
                                    {poolKw.map((kw) => {
                                        const s = st(kw);
                                        const selectable = !USED.has(s);
                                        const picked = selfPicked.has(kw);
                                        const cls = s === 'done' ? 'bg-[#dcfce7] text-[#166534] line-through ring-1 ring-inset ring-[#bbf7d0]'
                                            : s === 'held' ? 'bg-[#f1f5f9] text-[#94a3b8] line-through ring-1 ring-inset ring-[#e2e8f0]'
                                            : USED.has(s) ? 'bg-[#fef9c3] text-[#854d0e] ring-1 ring-inset ring-[#fde68a]'
                                                : picked ? 'bg-[#ede9fe] text-[#5b21b6] ring-2 ring-inset ring-[#7c3aed]'
                                                    : 'bg-white text-[#475569] ring-1 ring-inset ring-[#cbd5e1]';
                                        return (
                                            <span key={kw} className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1.5 text-[11px] font-semibold leading-none ${cls}`}>
                                                {selectable ? (
                                                    <button type="button" onClick={() => toggleSelf(kw)} title="클릭해 선택 발행 대상 지정" className="inline-flex items-center gap-1">
                                                        {picked ? '✓ ' : ''}{kw}
                                                    </button>
                                                ) : <span>{kw}{s === 'done' ? ' ✓' : s === 'held' ? ' ⏸중단' : ' …'}</span>}
                                                <button type="button" onClick={() => void removePoolKw(kw)} title="풀에서 삭제" className="text-[#94a3b8] hover:text-[#dc2626]">×</button>
                                            </span>
                                        );
                                    })}
                                </div>
                            </>
                        ) : (
                            <div className="text-[12px] text-[#94a3b8]">아래 finder로 키워드를 찾아 고르면 여기 풀에 쌓입니다. <b>'값 저장하기'로 풀을 저장</b>하세요(1회 세팅).</div>
                        )}
                        {/* 발행 시점 — 지금 / 내일10시 / 직접 지정 / 여러 날 분산. 주말·연휴 미리 예약해 큐 굶주림 방지. */}
                        <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed border-[#c4b5fd] bg-white px-2.5 py-1.5">
                            <span className="text-[12px] font-semibold text-[#475569]">발행 시점</span>
                            {([['now', '지금'], ['tomorrow', '내일 오전 10시'], ['custom', '직접 지정'], ['spread', '여러 날 분산']] as const).map(([m, label]) => (
                                <button key={m} type="button" onClick={() => setScheduleMode(m)}
                                    className={`h-8 rounded-md px-3 text-[12px] font-bold ${scheduleMode === m ? 'bg-[#4338ca] text-white' : 'bg-white text-[#475569] ring-1 ring-[#cbd5e1]'}`}>{label}</button>
                            ))}
                            {scheduleMode === 'custom' ? (
                                <input type="datetime-local" value={scheduleAt} onChange={(e) => setScheduleAt(e.target.value)}
                                    className="h-8 rounded-md border border-[#cbd5e1] px-2 text-[12px] text-[#334155]" />
                            ) : null}
                            {scheduleMode !== 'now' && scheduleMode !== 'spread' ? (
                                <span className="text-[11px] font-semibold text-[#7c3aed]">
                                    {computeScheduledAt() ? `→ ${fmtScheduled(computeScheduledAt()!)} 이후 발행` : '→ 시각을 지정하세요'}
                                </span>
                            ) : null}
                        </div>
                        {/* 여러 날 분산 — 하루 최대(daily_cap)씩 연속일에 나눠 예약. 예) 14건·하루5 → 5/5/4(3일). */}
                        {scheduleMode === 'spread' ? (
                            <div className="grid gap-1.5 rounded-md border border-[#c4b5fd] bg-[#faf5ff] px-2.5 py-2">
                                <div className="flex flex-wrap items-center gap-2 text-[12px]">
                                    <span className="font-semibold text-[#475569]">총</span>
                                    <input type="number" min={1} max={spreadBase.length || 1} value={spreadTotal}
                                        onChange={(e) => setSpreadTotal(e.target.value)} placeholder={String(spreadBase.length)}
                                        className="h-8 w-20 rounded-md border border-[#cbd5e1] px-2 text-[12px]" />
                                    <span className="text-[#64748b]">건 · 하루</span>
                                    {Array.from({ length: capMax }, (_, i) => i + 1).map((n) => (
                                        <button key={n} type="button" onClick={() => setSpreadPerDay(n)}
                                            className={`h-8 w-8 rounded-md text-[12px] font-bold ${perDay === n ? 'bg-[#7c3aed] text-white' : 'bg-white text-[#475569] ring-1 ring-[#cbd5e1]'}`}>{n}</button>
                                    ))}
                                    <span className="text-[#64748b]">건 <span className="text-[#94a3b8]">(최대 {capMax})</span></span>
                                </div>
                                <div className="flex flex-wrap items-center gap-2 text-[12px]">
                                    <span className="font-semibold text-[#475569]">시작</span>
                                    <input type="datetime-local" value={spreadStartAt} onChange={(e) => setSpreadStartAt(e.target.value)}
                                        className="h-8 rounded-md border border-[#cbd5e1] px-2 text-[12px] text-[#334155]" />
                                    <span className="text-[#94a3b8]">{spreadStartAt ? '' : '(비우면 지금부터 즉시)'}</span>
                                    <span className="font-semibold text-[#475569]">끝</span>
                                    <input type="date" value={spreadEnd} onChange={(e) => setSpreadEnd(e.target.value)}
                                        className="h-8 rounded-md border border-[#cbd5e1] px-2 text-[12px] text-[#334155]" />
                                    <span className="text-[#94a3b8]">{spreadEnd ? '' : '(비우면 필요한 만큼)'}</span>
                                </div>
                                <div className="text-[11px] font-semibold text-[#7c3aed]">
                                    {effTotal ? `→ ${spreadChunks.join(' / ')} (${spreadChunks.length}일, ${startYmd}~${spreadEndYmd})` : '→ 분산할 미사용 키워드가 없습니다'}
                                    <span className="ml-1 font-normal text-[#94a3b8]">· {spreadStartAt ? `${startYmd} ${startTime.slice(0, 5)}` : '지금'}부터 · 하루 안 간격은 SUB2가 벌림</span>
                                    {spreadLeftover ? <span className="ml-1 font-bold text-[#dc2626]">· 범위 밖 {spreadLeftover}건 제외(끝을 늘리거나 하루 건수↑)</span> : null}
                                </div>
                            </div>
                        ) : null}
                        <div className="flex flex-wrap items-center gap-2">
                            {scheduleMode === 'spread' ? (
                                <span className="text-[12px] font-semibold text-[#7c3aed]">여러 날 분산 — 하루 {perDay}건씩 {spreadChunks.length || 0}일</span>
                            ) : (
                                <>
                                    <span className="text-[12px] font-semibold text-[#475569]">건수</span>
                                    {[1, 2, 3, 4, 5].map((c) => (
                                        <button key={c} type="button" onClick={() => setDailyCount(c)}
                                            className={`h-8 w-8 rounded-md text-[13px] font-bold ${dailyCount === c ? 'bg-[#4338ca] text-white' : 'bg-white text-[#475569] ring-1 ring-[#cbd5e1]'}`}>{c}</button>
                                    ))}
                                </>
                            )}
                            {scheduleMode === 'spread' ? (
                                <div className="ml-auto flex gap-2">
                                    <button type="button" onClick={() => void sendSpread('info')} disabled={reqBusy || !effTotal}
                                        className="h-10 rounded-lg bg-[#2563eb] px-5 text-sm font-bold text-white hover:bg-[#1d4ed8] disabled:opacity-50">
                                        {reqBusy ? '전송 중…' : `정보성 ${effTotal}건 분산`}
                                    </button>
                                    <button type="button" onClick={() => void sendSpread('review')} disabled={reqBusy || !effTotal}
                                        className="h-10 rounded-lg bg-[#7c3aed] px-5 text-sm font-bold text-white hover:bg-[#6d28d9] disabled:opacity-50">
                                        {reqBusy ? '전송 중…' : `후기성 ${effTotal}건 분산`}
                                    </button>
                                </div>
                            ) : (
                                <div className="ml-auto flex gap-2">
                                    <button type="button" onClick={() => void sendSelf('info')} disabled={reqBusy || !chosen.length}
                                        className="h-10 rounded-lg bg-[#2563eb] px-5 text-sm font-bold text-white hover:bg-[#1d4ed8] disabled:opacity-50">
                                        {reqBusy ? '전송 중…' : `정보성 ${pick}건`}
                                    </button>
                                    <button type="button" onClick={() => void sendSelf('review')} disabled={reqBusy || !chosen.length}
                                        className="h-10 rounded-lg bg-[#7c3aed] px-5 text-sm font-bold text-white hover:bg-[#6d28d9] disabled:opacity-50">
                                        {reqBusy ? '전송 중…' : `후기성 ${pick}건`}
                                    </button>
                                </div>
                            )}
                        </div>
                        {reqMsg ? <span className="text-[12px] font-semibold text-[#166534]">{reqMsg}</span> : null}
                        {/* 발행 예정 큐 미리보기 — 다음 발행 시 이 순서로 올라갈 키워드 */}
                        <div className="mt-1 rounded-lg border border-[#c7d2fe] bg-white p-2.5">
                            <div className="mb-1.5 text-[11px] font-bold text-[#4338ca]">🕒 발행 예정 큐 — {selfPicked.size ? '선택' : '다음'} {pick}건 <span className="font-normal text-[#94a3b8]">(정보성/후기성 누르면 이 순서로 발행됩니다)</span></div>
                            {chosen.length ? (
                                <ol className="grid gap-1">
                                    {chosen.map((kw, i) => (
                                        <li key={kw} className="flex items-center gap-2 rounded-md bg-[#f5f3ff] px-2.5 py-1 text-[12px]">
                                            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#7c3aed] text-[10px] font-bold text-white">{i + 1}</span>
                                            <span className="font-semibold text-[#4338ca]">{kw}</span>
                                            <span className="ml-auto text-[10px] text-[#94a3b8]">발행 예정</span>
                                        </li>
                                    ))}
                                </ol>
                            ) : <div className="py-1 text-center text-[11px] text-[#94a3b8]">미사용 키워드 없음 — finder로 추가하세요.</div>}
                            {/* 발행 대기열 상태바 — SUB2 poller 가 쓰는 cafe_gen_requests 를 5초 폴링해 그대로 표시(읽기 전용).
                                pending=대기(발행텀·하루상한 포함) / claimed=지금 게시 중 / done_at 오늘=오늘완료 / fail=사유 노출 */}
                            {queue && (queue.publishing.length || queue.pending || queue.doneToday || queue.failed.length || queue.scheduled.length) ? (
                                <div className="mt-1.5 rounded-md border border-[#e9d5ff] bg-white px-2 py-1.5">
                                    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px]">
                                        {queue.publishing.length ? (
                                            <span className="flex items-center gap-1 font-bold text-[#b45309]">
                                                <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[#f59e0b]" />
                                                발행중 {queue.publishing.length}
                                            </span>
                                        ) : null}
                                        <span className="text-[#0369a1]">대기 {queue.pending}</span>
                                        {queue.scheduled.length ? <span className="font-semibold text-[#7c3aed]">예약 {queue.scheduled.length}</span> : null}
                                        <span className="text-[#16a34a]">오늘완료 {queue.doneToday}</span>
                                        <span className={queue.failed.length ? 'font-semibold text-[#dc2626]' : 'text-[#94a3b8]'}>실패 {queue.failed.length}</span>
                                        {/* 발행 중단 — 대기건만 보류(진행 중 1건은 끝까지 게시). 중단분은 목록·카운트에서 사라진다. */}
                                        {queue.pending ? (
                                            <button type="button" disabled={holdBusy} onClick={() => void toggleHold(false)}
                                                className="ml-auto rounded border border-[#fecaca] bg-white px-2 py-0.5 text-[10px] font-bold text-[#dc2626] hover:bg-[#fef2f2] disabled:opacity-50"
                                                title="대기 중인 발행을 멈춥니다. 이미 게시 중인 1건은 끝까지 진행됩니다.">
                                                {holdBusy ? '처리 중…' : '■ 발행 중단'}
                                            </button>
                                        ) : null}
                                    </div>
                                    {queue.publishing.map((x) => (
                                        <div key={x.keyword} className="mt-1 truncate text-[10px] text-[#7c3aed]">▶ {x.keyword} 게시 중…</div>
                                    ))}
                                    {/* 예약 대기 — 발행 예정 시각(M/D HH:mm) · X로 그 예약 발행 취소 */}
                                    {queue.scheduled.slice(0, 30).map((x) => (
                                        <div key={x.id} className="mt-1 flex items-center gap-1 text-[10px] text-[#7c3aed]">
                                            <span className="shrink-0 rounded-full bg-[#ede9fe] px-1.5 py-0.5 font-bold">예약됨 {fmtScheduled(x.at)}</span>
                                            <span className="min-w-0 flex-1 truncate text-[#6d28d9]">{x.keyword}</span>
                                            <button type="button" onClick={() => void cancelQueueItem(x.id)} title="이 예약 발행 취소(삭제)"
                                                className="shrink-0 rounded px-1 font-bold text-[#a78bfa] hover:bg-[#fef2f2] hover:text-[#dc2626]">✕</button>
                                        </div>
                                    ))}
                                    {queue.scheduled.length > 30 ? <div className="mt-0.5 text-[10px] text-[#94a3b8]">외 예약 {queue.scheduled.length - 30}건</div> : null}
                                    {/* 실패 — X로 그 실패건 삭제(목록에서 제거) */}
                                    {queue.failed.slice(0, 30).map((x) => (
                                        <div key={x.id} className="mt-1 flex items-center gap-1 text-[10px] text-[#dc2626]" title={x.reason || ''}>
                                            <span className="min-w-0 flex-1 truncate">✖ {x.keyword} — {x.reason || '실패'}</span>
                                            <button type="button" onClick={() => void cancelQueueItem(x.id)} title="이 실패건 삭제"
                                                className="shrink-0 rounded px-1 font-bold text-[#fca5a5] hover:bg-[#fef2f2] hover:text-[#dc2626]">✕</button>
                                        </div>
                                    ))}
                                </div>
                            ) : null}
                            {/* 중단 보관분 — 발행 목록·카운트엔 넣지 않고 여기서만 알린다(재개 가능). */}
                            {heldN ? (
                                <div className="mt-1.5 flex items-center gap-2 rounded-md border border-dashed border-[#cbd5e1] bg-[#f8fafc] px-2 py-1 text-[10px] text-[#64748b]">
                                    <span>중단해 둔 발행 {heldN}건 (목록에서 제외됨)</span>
                                    <button type="button" disabled={holdBusy} onClick={() => void toggleHold(true)}
                                        className="ml-auto rounded border border-[#c7d2fe] bg-white px-2 py-0.5 font-bold text-[#4338ca] hover:bg-[#eef2ff] disabled:opacity-50">
                                        ▶ 발행 재개
                                    </button>
                                </div>
                            ) : null}
                            {/* 현재 발행건 게이지 — 진행중 1건의 단계(접수→작성·게시→완료)를 실시간 표시 */}
                            {(() => {
                                const STAGE: Record<string, { pct: number; label: string }> = {
                                    pending: { pct: 12, label: '발행 대기' },
                                    claimed: { pct: 45, label: '접수됨 · SUB2 준비' },
                                    processing: { pct: 78, label: '원고 작성·게시 중' },
                                    posted: { pct: 94, label: '게시 확인 중' },
                                    done: { pct: 100, label: '완료' },
                                };
                                // 현재 진행중 1건 = 가장 진행된 in-progress 키워드(작성>확인>접수>대기)
                                const curKw = poolKw.find((k) => st(k) === 'processing')
                                    || poolKw.find((k) => st(k) === 'posted')
                                    || poolKw.find((k) => st(k) === 'claimed')
                                    || poolKw.find((k) => st(k) === 'pending');
                                if (!curKw) return null;
                                const cs = st(curKw)!;
                                const stg = STAGE[cs] || { pct: 50, label: cs };
                                const active = cs !== 'done';
                                return (
                                    <div className="mt-2 border-t border-[#eef2ff] pt-2">
                                        <div className="mb-1 flex items-center justify-between gap-2 text-[10px] font-semibold">
                                            <span className="flex min-w-0 items-center gap-1 truncate text-[#4338ca]">
                                                {active ? <span className="inline-block h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-[#f59e0b]" /> : null}
                                                현재 발행:&nbsp;<b className="truncate">{curKw}</b>
                                            </span>
                                            <span className="shrink-0 text-[#b45309]">{stg.label} ({stg.pct}%)</span>
                                        </div>
                                        <div className="h-2.5 w-full overflow-hidden rounded-full bg-[#eef2ff]">
                                            <div className={`h-full rounded-full bg-gradient-to-r from-[#7c3aed] to-[#f59e0b] transition-all duration-700 ${active ? 'animate-pulse' : ''}`} style={{ width: `${stg.pct}%` }} />
                                        </div>
                                        <div className="mt-1 flex justify-between text-[9px] text-[#94a3b8]">
                                            <span>접수</span><span>작성·게시</span><span>완료</span>
                                        </div>
                                    </div>
                                );
                            })()}
                        </div>
                    </div>
                );
            })()}

            {/* 오늘 발행 — 당일 발행분만(다음날 자동 초기화). 순위트래커 등록분 기준, '이동'으로 게시글 열기. */}
            {(() => {
                const todayPosts = rankPosts.filter((p) => (p.published_date || '') === cafeTodayKST());
                return (
                    <div className="rounded-xl border border-[#e2e8f0] bg-white p-4">
                        <div className="mb-2 flex items-center justify-between">
                            <div className="text-[13px] font-bold text-[#334155]">오늘 발행 <span className="font-normal text-[#94a3b8]">— {cafeTodayKST()} · {todayPosts.length}건 · 다음날 초기화</span></div>
                            <button className="text-xs font-semibold text-[#4338ca] hover:underline" onClick={() => void loadRankPosts()} type="button">새로고침</button>
                        </div>
                        {todayPosts.length ? (
                            <div className="divide-y divide-[#f1f5f9]">
                                {todayPosts.map((p) => {
                                    const url = p.post_url || (p.cafe_name && p.article_id ? `https://cafe.naver.com/${p.cafe_name}/${p.article_id}` : '');
                                    return (
                                        <div className="flex items-center justify-between gap-3 py-1.5 text-[12px]" key={p.id}>
                                            <span className="min-w-0 flex-1 truncate text-[#334155]"><b className="text-[#4338ca]">{p.keyword_manual || p.keyword || '—'}</b> · {p.title || '—'}</span>
                                            {url
                                                ? <a className="shrink-0 rounded-md border border-[#4338ca] px-2.5 py-1 text-[11px] font-bold text-[#4338ca] hover:bg-[#eef2ff]" href={url} rel="noreferrer" target="_blank">이동</a>
                                                : <span className="shrink-0 text-[11px] text-[#cbd5e1]">링크 없음</span>}
                                        </div>
                                    );
                                })}
                            </div>
                        ) : <div className="py-4 text-center text-[12px] text-[#94a3b8]">오늘 발행한 글이 없습니다.</div>}
                    </div>
                );
            })()}

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
