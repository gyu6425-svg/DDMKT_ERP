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
};

const Ctx = createContext<BlogRankCtx | null>(null);

export function useBlogRank(): BlogRankCtx {
    const v = useContext(Ctx);
    if (!v) {
        throw new Error('useBlogRank must be used within BlogRankProvider');
    }
    return v;
}

export function BlogRankProvider({ children }: { children: ReactNode }) {
    const { isAdmin, loading: authLoading } = useAuth();
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
    const [sheetQ, setSheetQ] = useState('');

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

    const showToast = (message: string) => {
        setToastMsg(message);
        window.setTimeout(() => setToastMsg(''), 2200);
    };

    const reload = async () => {
        setLoading(true);
        setError('');
        const [accRes, postRes] = await Promise.all([getBlogAccounts(), getBlogPosts()]);
        if (accRes.error || postRes.error) {
            setError(
                (accRes.error || postRes.error)?.message ||
                    '데이터를 불러오지 못했습니다. blog-rank-tables.sql 실행을 확인하세요.',
            );
            setLoading(false);
            return;
        }
        setAccounts(accRes.data);
        setPosts(postRes.data);
        setLoading(false);
    };

    const isAllowed = !authLoading && isAdmin;
    useEffect(() => {
        if (isAllowed) {
            void reload();
        }
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
    };

    return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
