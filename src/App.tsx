import { useEffect, useState } from 'react';
import Layout from './components/Layout';
import ProtectedRoute from './components/ProtectedRoute';
import { useAuth } from './hooks/useAuth';
import { ErpDataProvider } from './context/ErpDataContext';
import AdminPage from './routes/AdminPage';
import BlogPage from './routes/BlogPage';
import CafePage from './routes/CafePage';
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
import ReporterPortalPage from './routes/ReporterPortalPage';
import { SkeletonRankPage, PlaceRankPage, CategoryDashPage } from './components/categoryRank/SkeletonRankPage';
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
    { path: '/cafe', element: <CafePage /> },
    { path: '/place-rank', element: <PlaceRankPage /> },
    { path: '/insta-rank', element: <InstaRankPage /> },
    { path: '/cafe-rank', element: <CafeRankPage /> },
    { path: '/shopping-rank', element: <CategoryDashPage category="쇼핑" label="쇼핑" /> },
    { path: '/powerlink-rank', element: <CategoryDashPage category="파워링크" label="파워링크" /> },
    { path: '/video-rank', element: <CategoryDashPage category="영상" label="영상" /> },
    { path: '/blog-rank', element: <BlogRankPage sheetOnly /> }, // 브랜드 블로그 하위 = 관리 시트만
    { path: '/blog-dash', element: <BlogRankPage /> }, // 블로그 대시보드 = 브랜드 블로그 전체(대시보드/관리시트/순위/크롤/작성기)
    { path: '/blog-optimized', element: <SkeletonRankPage label="최적화 블로그 배포" sheetOnly /> },
    { path: '/blog-semi', element: <SkeletonRankPage label="준최적화 블로그 배포" sheetOnly /> },
    { path: '/blog-jeoinmang', element: <SkeletonRankPage label="저인망 블로그 배포" sheetOnly /> },
    { path: '/portal', element: <CustomerOverviewPage /> },
    { path: '/portal/place', element: <CustomerCategoryPage /> },
    { path: '/portal/insta', element: <CustomerCategoryPage /> },
    { path: '/portal/cafe', element: <CustomerCategoryPage /> },
    { path: '/portal/shopping', element: <CustomerCategoryPage /> },
    { path: '/portal/powerlink', element: <CustomerCategoryPage /> },
    { path: '/portal/video', element: <CustomerCategoryPage /> },
    { path: '/portal/blog', element: <CustomerCategoryPage /> },
    { path: '/reporter', element: <ReporterPortalPage /> },
    { path: '/banner-generator', element: <BannerGeneratorPage /> },
    { path: '/powerlink', element: <PowerLinkPage /> },
    { path: '/mypage', element: <MyPage /> },
    { path: '/admin', element: <AdminPage /> },
];

function App() {
    const [currentPath, setCurrentPath] = useState(window.location.pathname);
    const { role, loading } = useAuth();
    // 고객(viewer) = 고객 포털(/portal)만. 기자단(reporter) = 기자단 포털(/reporter)만. 회사 ERP 경로 차단.
    const isCustomer = role === 'viewer';
    const isReporter = role === 'reporter';
    const externalHome = isReporter ? '/reporter' : '/portal'; // 외부 사용자 홈 경로
    const isExternal = isCustomer || isReporter;

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

    // 외부 사용자(고객/기자단)가 자기 포털 밖 경로로 오면 즉시 자기 홈으로 되돌림(회사 ERP 차단).
    useEffect(() => {
        if (loading) return;
        if (isExternal && currentPath !== '/login' && !currentPath.startsWith(externalHome)) {
            window.history.replaceState(null, '', externalHome);
            window.dispatchEvent(new Event('app:navigate'));
        }
    }, [isExternal, externalHome, currentPath, loading]);

    if (currentPath === '/login') {
        return (
            <>
                <UpdateBanner />
                <LoginPage />
            </>
        );
    }

    // 외부 사용자는 자기 포털 경로만 렌더(내부 경로 요청이 남아있어도 포털로 강제).
    const effectivePath =
        isExternal && !currentPath.startsWith(externalHome) ? externalHome : currentPath;
    const currentRoute = routes.find((route) => route.path === effectivePath) ?? routes[0];
    const isBannerGeneratorActive = !isExternal && currentPath === '/banner-generator';

    return (
        <>
            <UpdateBanner />
            <ProtectedRoute>
                <ErpDataProvider>
                    <Layout>
                        {!isExternal ? (
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
