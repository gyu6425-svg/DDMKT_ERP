import AdminOnly from './AdminOnly';
import { CUSTOMER_NAV, SIDEBAR_CATEGORIES } from './categoryRank/categories';
import { useAuth } from '../hooks/useAuth';
import { useEffect, useState, type MouseEvent } from 'react';

const navigationItems = [
    // 대시보드는 좌측 상단 'DDMKT ERP' 로고 클릭으로 이동(아래 참고).
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
    // pathname + search를 반응형으로 — 하위(?sub=) 활성표시가 정확히 갱신되게.
    const [loc, setLoc] = useState({
        path: window.location.pathname,
        search: window.location.search,
    });
    useEffect(() => {
        const sync = () =>
            setLoc({ path: window.location.pathname, search: window.location.search });
        window.addEventListener('popstate', sync);
        window.addEventListener('app:navigate', sync);
        return () => {
            window.removeEventListener('popstate', sync);
            window.removeEventListener('app:navigate', sync);
        };
    }, []);
    const currentPath = loc.path;
    const currentSub = new URLSearchParams(loc.search).get('sub');
    // 펼친 카테고리(클릭 토글) + 호버 카테고리. 현재 경로가 속한 카테고리는 기본 펼침.
    const [openKeys, setOpenKeys] = useState<Set<string>>(
        () => new Set(SIDEBAR_CATEGORIES.filter((c) => c.dashHref === window.location.pathname).map((c) => c.key)),
    );
    const [hoverKey, setHoverKey] = useState<string | null>(null);
    const toggleOpen = (key: string) =>
        setOpenKeys((prev) => {
            const next = new Set(prev);
            next.has(key) ? next.delete(key) : next.add(key);
            return next;
        });
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

        // path에 ?sub= 등 쿼리가 포함될 수 있어 pathname+search로 비교.
        if (window.location.pathname + window.location.search !== path) {
            window.history.pushState(null, '', path);
            window.dispatchEvent(new Event('app:navigate'));
        }
    };
    // 대시보드(하위값 없음) / 하위(sub=값) 활성 판정.
    const isDashActive = (dashHref: string) => currentPath === dashHref && !currentSub;
    const subActive = (href: string) => currentPath + loc.search === href;

    const linkClassName = (path: string) =>
        path === currentPath
            ? 'text-[16px] font-semibold text-[#FF6000] no-underline'
            : 'text-[16px] font-normal text-[#777777] no-underline hover:font-normal hover:text-[#000000]';

    const renderNavItem = (item: { path: string; label: string; disabled?: boolean }) =>
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
        );
    // 카테고리 대시보드(관리자 전용)를 '계약 관리' 바로 밑에 배치.
    const afterContracts = navigationItems.findIndex((i) => i.path === '/contracts') + 1;
    // 고객 ERP(/portal*)에서는 내부 메뉴를 숨기고 고객 메뉴(통합 대시보드 + 카테고리)만 보여준다.
    const isCustomerView = currentPath.startsWith('/portal');

    return (
        <aside
            className="sticky top-0 flex h-svh flex-col border-r border-[#e5e7eb] p-6 max-[800px]:static max-[800px]:h-auto max-[800px]:border-r-0 max-[800px]:border-b"
            aria-label="주요 메뉴"
        >
            <div className="mb-16">
                <a
                    aria-current={currentPath === '/dashboard' ? 'page' : undefined}
                    className="text-base font-bold text-inherit no-underline hover:text-[#FF6000]"
                    href="/dashboard"
                    onClick={(event) => navigate(event, '/dashboard')}
                    title="대시보드로 이동"
                >
                    DDMKT ERP
                </a>
            </div>

            <nav className="grid gap-[18px] max-[800px]:grid-cols-2">
                {isCustomerView ? (
                    CUSTOMER_NAV.map(renderNavItem)
                ) : (
                    <>
                        {navigationItems.slice(0, afterContracts).map(renderNavItem)}
                        <AdminOnly>
                            <div className="grid gap-[18px] max-[800px]:col-span-2">
                                {SIDEBAR_CATEGORIES.map((c) => {
                                    // 하위가 없으면(쇼핑·파워링크) 드롭다운 없이 상위=대시보드 바로가기.
                                    if (!c.subs.length) {
                                        return (
                                            <a
                                                aria-current={
                                                    currentPath === c.dashHref ? 'page' : undefined
                                                }
                                                className={`text-[16px] no-underline ${
                                                    currentPath === c.dashHref
                                                        ? 'font-semibold text-[#FF6000]'
                                                        : 'font-normal text-[#777777] hover:text-[#000000]'
                                                }`}
                                                href={c.dashHref}
                                                key={c.key}
                                                onClick={(event) => navigate(event, c.dashHref)}
                                            >
                                                {c.label}
                                            </a>
                                        );
                                    }
                                    const expanded = openKeys.has(c.key) || hoverKey === c.key;
                                    const childActive =
                                        isDashActive(c.dashHref) || c.subs.some((s) => subActive(s.href));
                                    return (
                                        <div
                                            key={c.key}
                                            onMouseEnter={() => setHoverKey(c.key)}
                                            onMouseLeave={() => setHoverKey((k) => (k === c.key ? null : k))}
                                        >
                                            {/* 최상위 — 클릭 시 펼침 토글 */}
                                            <button
                                                aria-expanded={expanded}
                                                className={`flex w-full items-center justify-between text-[16px] no-underline ${
                                                    childActive
                                                        ? 'font-semibold text-[#FF6000]'
                                                        : 'font-normal text-[#777777] hover:text-[#000000]'
                                                }`}
                                                onClick={() => toggleOpen(c.key)}
                                                type="button"
                                            >
                                                <span>{c.label}</span>
                                                <svg
                                                    aria-hidden="true"
                                                    className={`h-3.5 w-3.5 transition-transform ${expanded ? 'rotate-90' : ''}`}
                                                    fill="none"
                                                    viewBox="0 0 24 24"
                                                >
                                                    <path
                                                        d="M9 6l6 6-6 6"
                                                        stroke="currentColor"
                                                        strokeLinecap="round"
                                                        strokeLinejoin="round"
                                                        strokeWidth="2"
                                                    />
                                                </svg>
                                            </button>
                                            {/* 하위 — 대시보드 + 세부 카테고리 (부드러운 높이 슬라이드) */}
                                            <div
                                                className={`grid transition-all duration-300 ease-in-out ${
                                                    expanded
                                                        ? 'mt-3.5 grid-rows-[1fr] opacity-100'
                                                        : 'grid-rows-[0fr] opacity-0'
                                                }`}
                                            >
                                                <div className="overflow-hidden">
                                                    <div className="ml-2 grid gap-2 border-l border-[#eef0f2] pl-3">
                                                        <a
                                                            className={`text-[14px] no-underline ${
                                                                isDashActive(c.dashHref)
                                                                    ? 'font-semibold text-[#FF6000]'
                                                                    : 'font-normal text-[#888888] hover:text-[#000000]'
                                                            }`}
                                                            href={c.dashHref}
                                                            onClick={(event) => navigate(event, c.dashHref)}
                                                            tabIndex={expanded ? 0 : -1}
                                                        >
                                                            대시보드
                                                        </a>
                                                        {c.subs.map((s) => (
                                                            <a
                                                                className={`text-[14px] no-underline ${
                                                                    subActive(s.href)
                                                                        ? 'font-semibold text-[#FF6000]'
                                                                        : 'font-normal text-[#888888] hover:text-[#000000]'
                                                                }`}
                                                                href={s.href}
                                                                key={s.href}
                                                                onClick={(event) => navigate(event, s.href)}
                                                                tabIndex={expanded ? 0 : -1}
                                                            >
                                                                {s.label}
                                                            </a>
                                                        ))}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </AdminOnly>
                        {navigationItems.slice(afterContracts).map(renderNavItem)}
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
                    </>
                )}
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
