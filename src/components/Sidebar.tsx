import { SIDEBAR_CATEGORIES } from './categoryRank/categories';
import { useAuth } from '../hooks/useAuth';
import { useEffect, useMemo, useState, type MouseEvent } from 'react';
import { getClientContracts, type ClientContract } from '../api/clientContracts';
import { CONTAINER_SUBS, PRODUCT_CATEGORIES } from '../lib/products';
import { canSeeAdminPage, canManagePermissions } from '../lib/permissions';
import { SIGNUP_ENABLED } from '../lib/authConfig';
import { LeakMonthPicker } from './leak/LeakMonthPicker';

const navigationItems = [
    // 대시보드는 좌측 상단 'DDMKT ERP' 로고 클릭으로 이동(아래 참고).
    { path: '/clients', label: '고객사 관리' },
    { path: '/contracts', label: '계약 관리' },
    { path: '/banner-generator', label: '배너 생성기' },
    // 카페 원고 생성기는 '카페' 카테고리 하위로 이동(categories.ts subs) — 최상위에서 제거.
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
    // 펼친 카테고리(클릭 토글) + 호버 카테고리. 현재 경로가 속한 카테고리는 기본 펼침.
    const [openKeys, setOpenKeys] = useState<Set<string>>(
        () => new Set(SIDEBAR_CATEGORIES.filter((c) => c.dashHref === window.location.pathname).map((c) => c.key)),
    );
    // 아코디언 — 다른 카테고리를 열면 기존 열린 건 자동으로 닫힌다(한 번에 하나만).
    const toggleOpen = (key: string) =>
        setOpenKeys((prev) => (prev.has(key) ? new Set<string>() : new Set<string>([key])));
    const { signOut, role, isAdmin, canManageSheet, profile } = useAuth();
    // 고객(viewer) — 자기 계약(RLS 스코프) 중 '시트 승인(sheet_approved)'된 것만 메뉴에 노출.
    //   내부(관리자) '고객 ERP' 토글 미리보기(?as=<업체>)면 그 업체 계약으로 로드 → 실제 로그인과 동일 메뉴.
    const previewAs = new URLSearchParams(loc.search).get('as') || '';
    const isCustomerViewPath = currentPath.startsWith('/portal');
    const [custContracts, setCustContracts] = useState<ClientContract[]>([]);
    useEffect(() => {
        // viewer 본인(RLS 스코프) 또는 내부 미리보기(고객뷰 경로 + ?as 대상)일 때만.
        if (role !== 'viewer' && !(isCustomerViewPath && previewAs)) return;
        let alive = true;
        void getClientContracts(previewAs || undefined).then(({ data }) => alive && setCustContracts(data));
        return () => {
            alive = false;
        };
    }, [role, previewAs, isCustomerViewPath]);
    // 계약 → (카테고리 → 하위유형 집합). 컨테이너(보장형/종합광고) 하위는 실제 카테고리로 역추적.
    const custCatMap = useMemo(() => {
        const m = new Map<string, Set<string>>();
        for (const ct of custContracts) {
            if (!ct.sheet_approved) continue; // 시트 승인된 것만
            const p = CONTAINER_SUBS.find((x) => ct.subtype.startsWith(x + ' · '));
            const raw = p ? ct.subtype.slice(p.length + 3) : ct.subtype;
            const cat = PRODUCT_CATEGORIES.find((pc) => pc.subs.includes(raw))?.label ?? ct.category;
            if (!m.has(cat)) m.set(cat, new Set());
            m.get(cat)!.add(raw);
        }
        // 카페는 계약이 없어도 모든 고객에게 항상 노출 — 미계약 고객도 '카페 배포' 접수를 넣을 수 있게.
        if (!m.has('카페')) m.set('카페', new Set());
        return m;
    }, [custContracts]);
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
    // 활성 판정 — pathname + ?sub 기준(내부 ?tab 은 무시해 브랜드 블로그 등 탭 전환에도 유지).
    const linkActive = (href: string) => {
        const [p, q] = href.split('?');
        const linkSub = q ? new URLSearchParams(q).get('sub') : null;
        const curSub = new URLSearchParams(loc.search).get('sub');
        return currentPath === p && (linkSub || null) === (curSub || null);
    };

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
    // 고객 ERP(/portal*)·기자단 ERP(/reporter)에서는 내부 메뉴를 숨기고 각 전용 메뉴만 보여준다.
    const isCustomerView = isCustomerViewPath;
    const isReporterView = currentPath.startsWith('/reporter');
    // 누수탐지 ERP — 회사 ERP와 별도 영역이라 전용 메뉴만 보여준다(4인 전용, 페이지에서 게이트).
    const isLeakView = currentPath.startsWith('/leak');

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
                {isLeakView ? (
                    <>
                        {/* 월 필터 — 모든 탭 공용(고객관리·작업정산·통장원장·외주발주). 연도는 2027 넘어갈 때 확장. */}
                        <LeakMonthPicker />
                        {renderNavItem({ path: '/leak', label: '고객 관리' })}
                        {renderNavItem({ path: '/leak/jobs', label: '작업 · 정산' })}
                        {renderNavItem({ path: '/leak/ledger', label: '통장 원장' })}
                        {renderNavItem({ path: '/leak/outsourcing', label: '외주 발주' })}
                        {renderNavItem({ path: '/leak/blog', label: '누수탐지 블로그' })}
                        {renderNavItem({ path: '/leak/cafe', label: '누수탐지 카페' })}
                    </>
                ) : isReporterView ? (
                    <>{renderNavItem({ path: '/reporter', label: '기자단 대시보드' })}</>
                ) : isCustomerView ? (
                    <>
                        {/* 통합 대시보드 + 계약(승인)된 카테고리·하위유형만 */}
                        {renderNavItem({ path: previewAs ? `/portal?as=${previewAs}` : '/portal', label: '통합 대시보드' })}
                        {[...custCatMap.entries()].map(([catLabel, subSet]) => {
                            const scat = SIDEBAR_CATEGORIES.find((c) => c.label === catLabel);
                            if (!scat) return null;
                            const base = `/portal/${scat.key}`;
                            // 내부(관리자) 미리보기(?as=업체)면 카테고리·하위 링크에도 as를 유지 → 스코프 유실 방지.
                            const asQ = previewAs ? `?as=${previewAs}` : '';
                            const baseHref = `${base}${asQ}`;
                            const subs = [...subSet];
                            return (
                                <div key={scat.key}>
                                    <a
                                        aria-current={currentPath === base ? 'page' : undefined}
                                        className={`text-[16px] no-underline ${
                                            currentPath === base
                                                ? 'font-semibold text-[#FF6000]'
                                                : 'font-normal text-[#777777] hover:text-[#000000]'
                                        }`}
                                        href={baseHref}
                                        onClick={(event) => navigate(event, baseHref)}
                                    >
                                        {catLabel}
                                    </a>
                                    {subs.length ? (
                                        <div className="ml-2 mt-2 grid gap-2 border-l border-[#eef0f2] pl-3">
                                            {subs.map((s) => {
                                                const href = `${baseHref}${asQ ? '&' : '?'}sub=${encodeURIComponent(s)}`;
                                                const active =
                                                    currentPath === base &&
                                                    new URLSearchParams(loc.search).get('sub') === s;
                                                return (
                                                    <a
                                                        className={`text-[14px] no-underline ${
                                                            active
                                                                ? 'font-semibold text-[#FF6000]'
                                                                : 'font-normal text-[#888888] hover:text-[#000000]'
                                                        }`}
                                                        href={href}
                                                        key={s}
                                                        onClick={(event) => navigate(event, href)}
                                                    >
                                                        {s}
                                                    </a>
                                                );
                                            })}
                                        </div>
                                    ) : null}
                                </div>
                            );
                        })}
                    </>
                ) : (
                    <>
                        {/* 고객사/계약 관리 등 내부 메뉴 — 관리자·매니저만. 사원은 담당 카테고리만. */}
                        {isAdmin || role === 'manager'
                            ? navigationItems.slice(0, afterContracts).map(renderNavItem)
                            : null}
                        {/* 카테고리 대시보드 — 관리자는 전체, 사원/매니저는 담당 시트 카테고리만. */}
                        {isAdmin || SIDEBAR_CATEGORIES.some((c) => canManageSheet(c.label)) ? (
                            <div className="grid gap-[18px] max-[800px]:col-span-2">
                                {/* 블로그가 가장 많이 쓰는 카테고리 → 계약 관리 바로 밑(맨 위)으로. */}
                                {[...SIDEBAR_CATEGORIES]
                                    .sort(
                                        (a, b) =>
                                            (a.key === 'blog' ? 0 : 1) - (b.key === 'blog' ? 0 : 1),
                                    )
                                    .filter((c) => isAdmin || canManageSheet(c.label))
                                    .map((c) => {
                                    // 하위가 없으면(쇼핑·파워링크) 드롭다운 없이 상위=대시보드 바로가기.
                                    if (!c.subs.length) {
                                        return (
                                            <a
                                                aria-current={
                                                    linkActive(c.dashHref) ? 'page' : undefined
                                                }
                                                className={`text-[16px] no-underline ${
                                                    linkActive(c.dashHref)
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
                                    const expanded = openKeys.has(c.key);
                                    const childActive =
                                        linkActive(c.dashHref) || c.subs.some((s) => linkActive(s.href));
                                    return (
                                        <div key={c.key}>
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
                                                                linkActive(c.dashHref)
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
                                                                    linkActive(s.href)
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
                        ) : null}
                        {isAdmin || role === 'manager'
                            ? navigationItems.slice(afterContracts).map(renderNavItem)
                            : null}
                        {canSeeAdminPage(profile?.email) ? (() => {
                            const adminActive = currentPath === '/admin';
                            const curTab = new URLSearchParams(loc.search).get('tab') || '';
                            const expanded = openKeys.has('admin');
                            const adminSubs = [
                                ...(canManagePermissions(profile?.email) ? [{ key: 'users', label: '사원 관리' }] : []),
                                ...(SIGNUP_ENABLED ? [{ key: 'signups', label: '가입 승인' }] : []),
                                { key: 'deploy', label: '카페 접수' },
                                { key: 'cafe', label: '카페 원고 생성기' },
                                { key: 'api', label: 'API 사용량' },
                            ];
                            return (
                                <div>
                                    <button
                                        aria-expanded={expanded}
                                        className={`flex w-full items-center justify-between text-[16px] no-underline ${
                                            adminActive ? 'font-semibold text-[#FF6000]' : 'font-normal text-[#777777] hover:text-[#000000]'
                                        }`}
                                        onClick={() => toggleOpen('admin')}
                                        type="button"
                                    >
                                        <span>관리자 페이지</span>
                                        <svg aria-hidden="true" className={`h-3.5 w-3.5 transition-transform ${expanded ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24">
                                            <path d="M9 6l6 6-6 6" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
                                        </svg>
                                    </button>
                                    <div className={`grid transition-all duration-300 ease-in-out ${expanded ? 'mt-3.5 grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
                                        <div className="overflow-hidden">
                                            <div className="ml-2 grid gap-2 border-l border-[#eef0f2] pl-3">
                                                {adminSubs.map((s) => {
                                                    const href = `/admin?tab=${s.key}`;
                                                    const active = adminActive && curTab === s.key;
                                                    return (
                                                        <a
                                                            key={s.key}
                                                            className={`text-[14px] no-underline ${active ? 'font-semibold text-[#FF6000]' : 'font-normal text-[#888888] hover:text-[#000000]'}`}
                                                            href={href}
                                                            onClick={(event) => navigate(event, href)}
                                                            tabIndex={expanded ? 0 : -1}
                                                        >
                                                            {s.label}
                                                        </a>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            );
                        })() : null}
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
