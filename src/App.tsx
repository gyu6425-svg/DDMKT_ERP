import { useEffect, useState } from 'react';
import Layout from './components/Layout';
import ProtectedRoute from './components/ProtectedRoute';
import { ErpDataProvider } from './context/ErpDataContext';
import AdminPage from './routes/AdminPage';
import BlogPage from './routes/BlogPage';
import BlogRankPage from './routes/BlogRankPage';
import CalendarPage from './routes/CalendarPage';
import ClientsPage from './routes/ClientsPage';
import ContractsPage from './routes/ContractsPage';
import DashboardPage from './routes/DashboardPage';
import BannerGeneratorPage from './routes/BannerGeneratorPage';
import LoginPage from './routes/LoginPage';
import MemosPage from './routes/MemosPage';
import MyPage from './routes/MyPage';
import PowerLinkPage from './routes/PowerLinkPage';
import ReportsPage from './routes/ReportsPage';
import CustomerOverviewPage from './routes/CustomerOverviewPage';
import CustomerCategoryPage from './routes/CustomerCategoryPage';
import VideoRankPage from './routes/VideoRankPage';
import InstaRankPage from './routes/InstaRankPage';
import CafeRankPage from './routes/CafeRankPage';
import TrafficRankPage from './routes/TrafficRankPage';

const routes = [
    { path: '/dashboard', element: <DashboardPage /> },
    { path: '/clients', element: <ClientsPage /> },
    { path: '/contracts', element: <ContractsPage /> },
    { path: '/calendar', element: <CalendarPage /> },
    { path: '/reports', element: <ReportsPage /> },
    { path: '/memos', element: <MemosPage /> },
    { path: '/blog', element: <BlogPage /> },
    { path: '/blog-rank', element: <BlogRankPage /> },
    { path: '/video-rank', element: <VideoRankPage /> },
    { path: '/insta-rank', element: <InstaRankPage /> },
    { path: '/cafe-rank', element: <CafeRankPage /> },
    { path: '/traffic-rank', element: <TrafficRankPage /> },
    { path: '/portal', element: <CustomerOverviewPage /> },
    { path: '/portal/blog', element: <CustomerCategoryPage /> },
    { path: '/portal/video', element: <CustomerCategoryPage /> },
    { path: '/portal/insta', element: <CustomerCategoryPage /> },
    { path: '/portal/cafe', element: <CustomerCategoryPage /> },
    { path: '/portal/traffic', element: <CustomerCategoryPage /> },
    { path: '/banner-generator', element: <BannerGeneratorPage /> },
    { path: '/powerlink', element: <PowerLinkPage /> },
    { path: '/mypage', element: <MyPage /> },
    { path: '/admin', element: <AdminPage /> },
];

function App() {
    const [currentPath, setCurrentPath] = useState(window.location.pathname);

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

    if (currentPath === '/login') {
        return <LoginPage />;
    }

    const currentRoute = routes.find((route) => route.path === currentPath) ?? routes[0];
    const isBannerGeneratorActive = currentPath === '/banner-generator';

    return (
        <ProtectedRoute>
            <ErpDataProvider>
                <Layout>
                    <div hidden={!isBannerGeneratorActive}>
                        <BannerGeneratorPage />
                    </div>
                    {!isBannerGeneratorActive ? currentRoute.element : null}
                </Layout>
            </ErpDataProvider>
        </ProtectedRoute>
    );
}

export default App;
