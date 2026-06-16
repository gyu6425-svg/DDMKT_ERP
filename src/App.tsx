import Layout from './components/Layout';
import ProtectedRoute from './components/ProtectedRoute';
import CalendarPage from './routes/CalendarPage';
import ClientsPage from './routes/ClientsPage';
import ContractsPage from './routes/ContractsPage';
import DashboardPage from './routes/DashboardPage';
import LoginPage from './routes/LoginPage';
import MyPage from './routes/MyPage';
import ReportsPage from './routes/ReportsPage';

const routes = [
    { path: '/dashboard', element: <DashboardPage /> },
    { path: '/clients', element: <ClientsPage /> },
    { path: '/contracts', element: <ContractsPage /> },
    { path: '/calendar', element: <CalendarPage /> },
    { path: '/reports', element: <ReportsPage /> },
    { path: '/mypage', element: <MyPage /> },
];

function App() {
    const currentPath = window.location.pathname;

    if (currentPath === '/login') {
        return <LoginPage />;
    }

    const currentRoute = routes.find((route) => route.path === currentPath) ?? routes[0];

    return (
        <ProtectedRoute>
            <Layout>{currentRoute.element}</Layout>
        </ProtectedRoute>
    );
}

export default App;
