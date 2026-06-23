import AdminOnly from './AdminOnly';
import { useAuth } from '../hooks/useAuth';
import type { MouseEvent } from 'react';

const navigationItems = [
    { path: '/dashboard', label: '대시보드' },
    { path: '/clients', label: '고객사 관리' },
    { path: '/contracts', label: '계약 관리' },
    // 리포트·메모·캘린더는 추후 구현 — 지금은 비활성(클릭 불가).
    { path: '/calendar', label: '캘린더', disabled: true },
    { path: '/reports', label: '리포트', disabled: true },
    { path: '/memos', label: '메모', disabled: true },
    { path: '/banner-generator', label: '배너 생성기' },
    { path: '/powerlink', label: '파워링크' },
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
            ? 'text-[16px] font-semibold text-[#000000] no-underline'
            : 'text-[16px] font-normal text-[#777777] no-underline hover:font-normal hover:text-[#000000]';

    return (
        <aside
            className="sticky top-0 flex h-svh flex-col border-r border-[#e5e7eb] p-6 max-[800px]:static max-[800px]:h-auto max-[800px]:border-r-0 max-[800px]:border-b"
            aria-label="주요 메뉴"
        >
            <div className="mb-16">
                <strong className="text-base">DDMKT ERP</strong>
            </div>

            <nav className="grid gap-[18px] max-[800px]:grid-cols-2">
                {navigationItems.map((item) =>
                    item.disabled ? (
                        <span
                            aria-disabled="true"
                            className="cursor-not-allowed text-[16px] font-normal text-[#c4c4c4] no-underline"
                            key={item.path}
                            title="준비 중입니다"
                        >
                            {item.label}
                        </span>
                    ) : (
                        <a
                            aria-current={item.path === currentPath ? 'page' : undefined}
                            className={linkClassName(item.path)}
                            href={item.path}
                            key={item.path}
                            onClick={(event) => navigate(event, item.path)}
                        >
                            {item.label}
                        </a>
                    ),
                )}
                <AdminOnly>
                    <a
                        aria-current={currentPath === '/blog-rank' ? 'page' : undefined}
                        className={linkClassName('/blog-rank')}
                        href="/blog-rank"
                        onClick={(event) => navigate(event, '/blog-rank')}
                    >
                        블로그 대시보드
                    </a>
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
