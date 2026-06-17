import { useEffect, useState } from 'react';
import Layout from './components/Layout';
import ProtectedRoute from './components/ProtectedRoute';
import CalendarPage from './routes/CalendarPage';
import ClientsPage from './routes/ClientsPage';
import ContractsPage from './routes/ContractsPage';
import DashboardPage from './routes/DashboardPage';
import BannerGeneratorPage from './routes/BannerGeneratorPage';
import LoginPage from './routes/LoginPage';
import MyPage from './routes/MyPage';
import ReportsPage from './routes/ReportsPage';

const routes = [
    { path: '/dashboard', element: <DashboardPage /> },
    { path: '/clients', element: <ClientsPage /> },
    { path: '/contracts', element: <ContractsPage /> },
    { path: '/calendar', element: <CalendarPage /> },
    { path: '/reports', element: <ReportsPage /> },
    { path: '/banner-generator', element: <BannerGeneratorPage /> },
    { path: '/mypage', element: <MyPage /> },
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
            <Layout>
                <div hidden={!isBannerGeneratorActive}>
                    <BannerGeneratorPage />
                </div>
                {!isBannerGeneratorActive ? currentRoute.element : null}
            </Layout>
        </ProtectedRoute>
    );
}

export default App;
