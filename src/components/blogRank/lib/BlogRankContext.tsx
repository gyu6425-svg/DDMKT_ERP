import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { getBlogAccounts, getBlogPosts, type BlogAccount, type BlogPost } from '../../../api/blogRank';
import { useAuth } from '../../../hooks/useAuth';
import type { Tab } from './helpers';

// 블로그 대시보드(5개 페이지)의 공유 상태/로직 — accounts·posts 1회 로드, 토스트, 탭·탭간 이동.
//   각 페이지 컴포넌트는 useBlogRank()로 필요한 값만 읽는다(prop-drilling 제거). 동작은 기존과 동일.
type BlogRankCtx = {
    isAdmin: boolean;
    authLoading: boolean;
    accounts: BlogAccount[];
    posts: BlogPost[];
    loading: boolean;
    error: string;
    reload: () => Promise<void>;
    toastMsg: string;
    showToast: (message: string) => void;
    tab: Tab;
    goTab: (key: Tab) => void;
    // 탭 간 이동 시 전달되는 초기 필터(일반 탭 이동 시 goTab 이 해제).
    trackerInOnly: boolean; // 통합 10위 이내만
    trackerCo: string; // 특정 업체만(시트 업체명 클릭)
    sheetQ: string; // 시트 검색 초기값(대시보드 재계약 임박 클릭)
    // 탭 간 이동 헬퍼.
    goTracker10: () => void; // 대시보드 → 트래커(통합10위 필터)
    goSheetBlog: (name: string) => void; // 대시보드 → 시트(업체검색)
    goCrawl: () => void; // 시트 → 크롤링 현황
    goTrackerBlog: (id: string) => void; // 시트 업체명 → 트래커(그 업체만)
    // 고객 ERP 모드 — true 면 관리시트에서 '계약 종료' 탭 숨김(계약 중만), 본인 업체 한정(데이터는 RLS로 격리).
    customerMode: boolean;
};

const Ctx = createContext<BlogRankCtx | null>(null);

export function useBlogRank(): BlogRankCtx {
    const v = useContext(Ctx);
    if (!v) {
        throw new Error('useBlogRank must be used within BlogRankProvider');
    }
    return v;
}

export function BlogRankProvider({
    children,
    customerMode = false,
    reporterMode = false,
}: {
    children: ReactNode;
    customerMode?: boolean;
    reporterMode?: boolean;
}) {
    const { isAdmin, canManageSheet, loading: authLoading, profile } = useAuth();
    const canBlog = isAdmin || canManageSheet('블로그'); // 블로그 담당 사원/매니저도 내부 접근 허용
    // 외부(고객/기자단) = 읽기전용 UI(customerMode 로직 재사용).
    const external = customerMode || reporterMode;
    // 고객 모드면 본인 업체(client_id)로 데이터 스코프. 기자단은 RLS(reporter_id)로 스코프 → 전체 로드해도 본인 블로그만 옴.
    const scopedClientId = customerMode ? profile?.client_id ?? null : null;
    const [accounts, setAccounts] = useState<BlogAccount[]>([]);
    const [posts, setPosts] = useState<BlogPost[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    // 탭을 URL 쿼리(?tab=)에 저장 → 새로고침해도 현재 탭 유지.
    const [tab, setTab] = useState<Tab>(() => {
        const t = new URLSearchParams(window.location.search).get('tab');
        return t === 'sheet' || t === 'tracker' || t === 'crawl' || t === 'writer' ? t : 'dashboard';
    });
    const [toastMsg, setToastMsg] = useState('');
    const [trackerInOnly, setTrackerInOnly] = useState(false);
    const [trackerCo, setTrackerCo] = useState('');
    // 고객사 상세 → '블로그 대시보드 이동(?q=업체명)'으로 들어오면 그 업체만 보이게 시트 검색 초기값.
    const [sheetQ, setSheetQ] = useState(() => new URLSearchParams(window.location.search).get('q') || '');

    const goTab = (key: Tab) => {
        setTrackerInOnly(false);
        setTrackerCo('');
        setSheetQ('');
        setTab(key);
    };

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        if (tab === 'dashboard') {
            params.delete('tab');
        } else {
            params.set('tab', tab);
        }
        const qs = params.toString();
        window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : ''));
    }, [tab]);

    // 사이드바에서 같은 /blog-rank 내 ?tab= 딥링크로 이동하면(대시보드 ⇄ 브랜드 블로그) 탭 반영.
    useEffect(() => {
        const syncFromUrl = () => {
            const t = new URLSearchParams(window.location.search).get('tab');
            setTab(t === 'sheet' || t === 'tracker' || t === 'crawl' || t === 'writer' ? t : 'dashboard');
        };
        window.addEventListener('app:navigate', syncFromUrl);
        window.addEventListener('popstate', syncFromUrl);
        return () => {
            window.removeEventListener('app:navigate', syncFromUrl);
            window.removeEventListener('popstate', syncFromUrl);
        };
    }, []);

    const showToast = (message: string) => {
        setToastMsg(message);
        window.setTimeout(() => setToastMsg(''), 2200);
    };

    const reload = async () => {
        setLoading(true);
        setError('');
        const failMsg = '데이터를 불러오지 못했습니다. blog-rank-tables.sql 실행을 확인하세요.';
        // 고객 모드: 본인 업체 계정 → 그 계정들의 글만. 관리자: 전체(기존과 동일, 병렬).
        if (scopedClientId) {
            const accRes = await getBlogAccounts(scopedClientId);
            if (accRes.error) {
                setError(accRes.error.message || failMsg);
                setLoading(false);
                return;
            }
            const postRes = await getBlogPosts(accRes.data.map((a) => a.id));
            if (postRes.error) {
                setError(postRes.error.message || failMsg);
                setLoading(false);
                return;
            }
            setAccounts(accRes.data);
            setPosts(postRes.data);
            setLoading(false);
            return;
        }
        const [accRes, postRes] = await Promise.all([getBlogAccounts(), getBlogPosts()]);
        if (accRes.error || postRes.error) {
            setError((accRes.error || postRes.error)?.message || failMsg);
            setLoading(false);
            return;
        }
        setAccounts(accRes.data);
        setPosts(postRes.data);
        setLoading(false);
    };

    // 관리자/내부는 전체, 고객은 본인 업체 연결 시, 기자단은 reporter 역할이면 로드 허용(데이터는 RLS로 격리).
    const isAllowed = !authLoading && (canBlog || (customerMode && !!scopedClientId) || reporterMode);
    useEffect(() => {
        if (isAllowed) {
            void reload();
        }
    }, [isAllowed]);

    // 크롤 결과 자동 반영 — 탭을 다시 보거나(가시성 복귀) 창 포커스 시 재조회(수동 새로고침 없이 우측 순위 최신화).
    //   너무 잦은 재조회 방지: 마지막 로드 후 60초 지났을 때만.
    useEffect(() => {
        if (!isAllowed) return;
        let last = Date.now();
        const maybeReload = () => {
            if (document.visibilityState !== 'visible') return;
            if (Date.now() - last < 60_000) return;
            last = Date.now();
            void reload();
        };
        window.addEventListener('focus', maybeReload);
        document.addEventListener('visibilitychange', maybeReload);
        return () => {
            window.removeEventListener('focus', maybeReload);
            document.removeEventListener('visibilitychange', maybeReload);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isAllowed]);

    const value: BlogRankCtx = {
        isAdmin,
        authLoading,
        accounts,
        posts,
        loading,
        error,
        reload,
        toastMsg,
        showToast,
        tab,
        goTab,
        trackerInOnly,
        trackerCo,
        sheetQ,
        goTracker10: () => {
            setTrackerInOnly(true);
            setTab('tracker');
        },
        goSheetBlog: (name: string) => {
            setSheetQ(name);
            setTab('sheet');
        },
        goCrawl: () => setTab('crawl'),
        goTrackerBlog: (id: string) => {
            setTrackerCo(id);
            setTrackerInOnly(false);
            setTab('tracker');
        },
        customerMode: external, // 고객·기자단 모두 읽기전용 UI(관리 컬럼/버튼 숨김)
    };

    return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
