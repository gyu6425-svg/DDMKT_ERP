import { useEffect, useState } from 'react';
import Layout from './components/Layout';
import ProtectedRoute from './components/ProtectedRoute';
import { useAuth } from './hooks/useAuth';
import { ErpDataProvider } from './context/ErpDataContext';
import AdminPage from './routes/AdminPage';
import BlogPage from './routes/BlogPage';
import BlogRankPage from './routes/BlogRankPage';
import CalendarPage from './routes/CalendarPage';
import ClientsPage from './routes/ClientsPage';
import DashboardPage from './routes/DashboardPage';
import BannerGeneratorPage from './routes/BannerGeneratorPage';
import LoginPage from './routes/LoginPage';
import MemosPage from './routes/MemosPage';
import MyPage from './routes/MyPage';
import PowerLinkPage from './routes/PowerLinkPage';
import ReportsPage from './routes/ReportsPage';
import CustomerOverviewPage from './routes/CustomerOverviewPage';
import CustomerCategoryPage from './routes/CustomerCategoryPage';
import { SkeletonRankPage } from './components/categoryRank/SkeletonRankPage';
import InstaRankPage from './routes/InstaRankPage';
import CafeRankPage from './routes/CafeRankPage';
import { UpdateBanner } from './components/UpdateBanner';

const routes = [
    { path: '/dashboard', element: <DashboardPage /> },
    { path: '/clients', element: <ClientsPage /> },
    { path: '/contracts', element: <ClientsPage contractsOnly /> },
    { path: '/calendar', element: <CalendarPage /> },
    { path: '/reports', element: <ReportsPage /> },
    { path: '/memos', element: <MemosPage /> },
    { path: '/blog', element: <BlogPage /> },
    { path: '/place-rank', element: <SkeletonRankPage label="플레이스 대시보드" /> },
    { path: '/insta-rank', element: <InstaRankPage /> },
    { path: '/cafe-rank', element: <CafeRankPage /> },
    { path: '/shopping-rank', element: <SkeletonRankPage label="쇼핑 대시보드" /> },
    { path: '/powerlink-rank', element: <SkeletonRankPage label="파워링크 대시보드" /> },
    { path: '/video-rank', element: <SkeletonRankPage label="영상 대시보드" /> },
    { path: '/blog-rank', element: <BlogRankPage /> }, // 브랜드 블로그(기존 작업물)
    { path: '/blog-dash', element: <SkeletonRankPage label="블로그 대시보드" /> },
    { path: '/blog-optimized', element: <SkeletonRankPage label="최적화 블로그 배포" /> },
    { path: '/blog-semi', element: <SkeletonRankPage label="준최적화 블로그 배포" /> },
    { path: '/blog-jeoinmang', element: <SkeletonRankPage label="저인망 블로그 배포" /> },
    { path: '/portal', element: <CustomerOverviewPage /> },
    { path: '/portal/place', element: <CustomerCategoryPage /> },
    { path: '/portal/insta', element: <CustomerCategoryPage /> },
    { path: '/portal/cafe', element: <CustomerCategoryPage /> },
    { path: '/portal/shopping', element: <CustomerCategoryPage /> },
    { path: '/portal/powerlink', element: <CustomerCategoryPage /> },
    { path: '/portal/video', element: <CustomerCategoryPage /> },
    { path: '/portal/blog', element: <CustomerCategoryPage /> },
    { path: '/banner-generator', element: <BannerGeneratorPage /> },
    { path: '/powerlink', element: <PowerLinkPage /> },
    { path: '/mypage', element: <MyPage /> },
    { path: '/admin', element: <AdminPage /> },
];

function App() {
    const [currentPath, setCurrentPath] = useState(window.location.pathname);
    const { role, loading } = useAuth();
    // 고객(viewer) = 고객 포털(/portal)만 접근 가능. 회사 ERP 경로는 못 봄.
    const isCustomer = role === 'viewer';

    useEffect(() => {
        const syncPath = () => {
            setCurrentPath(window.location.pathname);
        };

        window.addEventListener('popstate', syncPath);
        window.addEventListener('app:navigate', syncPath);

        return () => {
            window.removeEventListener('popstate', syncPath);
            window.removeEventListener('app:navigate', syncPath);
        };
    }, []);

    // 고객이 내부 경로로 오면 즉시 고객 포털로 되돌림(회사 ERP 화면 차단).
    useEffect(() => {
        if (loading) return;
        if (isCustomer && currentPath !== '/login' && !currentPath.startsWith('/portal')) {
            window.history.replaceState(null, '', '/portal');
            window.dispatchEvent(new Event('app:navigate'));
        }
    }, [isCustomer, currentPath, loading]);

    if (currentPath === '/login') {
        return (
            <>
                <UpdateBanner />
                <LoginPage />
            </>
        );
    }

    // 고객은 포털 경로만 렌더(내부 경로 요청이 남아있어도 포털로 강제).
    const effectivePath = isCustomer && !currentPath.startsWith('/portal') ? '/portal' : currentPath;
    const currentRoute = routes.find((route) => route.path === effectivePath) ?? routes[0];
    const isBannerGeneratorActive = !isCustomer && currentPath === '/banner-generator';

    return (
        <>
            <UpdateBanner />
            <ProtectedRoute>
                <ErpDataProvider>
                    <Layout>
                        {!isCustomer ? (
                            <div hidden={!isBannerGeneratorActive}>
                                <BannerGeneratorPage />
                            </div>
                        ) : null}
                        {!isBannerGeneratorActive ? currentRoute.element : null}
                    </Layout>
                </ErpDataProvider>
            </ProtectedRoute>
        </>
    );
}

export default App;
