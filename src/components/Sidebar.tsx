import AdminOnly from './AdminOnly';
import { useAuth } from '../hooks/useAuth';
import type { MouseEvent } from 'react';

const navigationItems = [
    { path: '/dashboard', label: '대시보드' },
    { path: '/clients', label: '고객사 관리' },
    { path: '/contracts', label: '계약 관리' },
    { path: '/calendar', label: '캘린더' },
    { path: '/reports', label: '리포트' },
    { path: '/memos', label: '메모' },
    { path: '/blog', label: '블로그 작성기' },
    { path: '/banner-generator', label: '배너 생성기' },
];

function Sidebar() {
    const currentPath = window.location.pathname;
    const { signOut } = useAuth();
    const navigate = (event: MouseEvent<HTMLAnchorElement>, path: string) => {
        if (
            event.defaultPrevented ||
            event.button !== 0 ||
            event.metaKey ||
            event.altKey ||
            event.ctrlKey ||
            event.shiftKey
        ) {
            return;
        }

        event.preventDefault();

        if (window.location.pathname !== path) {
            window.history.pushState(null, '', path);
            window.dispatchEvent(new Event('app:navigate'));
        }
    };

    const linkClassName = (path: string) =>
        path === currentPath
            ? 'text-[16px] font-semibold text-[#111111] no-underline'
            : 'text-[16px] font-medium text-[#999999] no-underline hover:font-semibold hover:text-[#111111]';

    return (
        <aside
            className="sticky top-0 flex h-svh flex-col border-r border-[#e5e7eb] p-6 max-[800px]:static max-[800px]:h-auto max-[800px]:border-r-0 max-[800px]:border-b"
            aria-label="주요 메뉴"
        >
            <div className="mb-16">
                <strong className="text-base">DDMKT ERP</strong>
            </div>

            <nav className="grid gap-[18px] max-[800px]:grid-cols-2">
                {navigationItems.map((item) => (
                    <a
                        aria-current={item.path === currentPath ? 'page' : undefined}
                        className={linkClassName(item.path)}
                        href={item.path}
                        key={item.path}
                        onClick={(event) => navigate(event, item.path)}
                    >
                        {item.label}
                    </a>
                ))}
                <AdminOnly>
                    <a
                        aria-current={currentPath === '/admin' ? 'page' : undefined}
                        className={linkClassName('/admin')}
                        href="/admin"
                        onClick={(event) => navigate(event, '/admin')}
                    >
                        관리자 페이지
                    </a>
                </AdminOnly>
            </nav>

            <button
                className="mt-auto inline-flex items-center gap-2 text-left text-inherit max-[800px]:mt-6"
                onClick={() => {
                    void signOut();
                }}
                type="button"
            >
                <svg
                    aria-hidden="true"
                    className="h-5 w-5"
                    fill="none"
                    viewBox="0 0 24 24"
                    xmlns="http://www.w3.org/2000/svg"
                >
                    <path
                        d="M10 5H6.75A1.75 1.75 0 0 0 5 6.75v10.5C5 18.216 5.784 19 6.75 19H10"
                        stroke="currentColor"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="1.8"
                    />
                    <path
                        d="M15 8l4 4-4 4"
                        stroke="currentColor"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="1.8"
                    />
                    <path
                        d="M19 12H9"
                        stroke="currentColor"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="1.8"
                    />
                </svg>
                로그아웃
            </button>
        </aside>
    );
}

export default Sidebar;
