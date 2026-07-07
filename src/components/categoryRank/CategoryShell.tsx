import { useEffect, useState, type ReactNode } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { SIDEBAR_CATEGORIES } from './categories';

// 카테고리 대시보드 공유 셸 — 관리자 게이트 + 헤더 + 탭바 + 활성 탭.
//   각 카테고리(영상/인스타/카페/트래픽) 페이지가 자기 탭 컴포넌트를 넘겨 재사용. 블로그 대시보드와 동일 UX.
export type ShellTab = { name: string; el: ReactNode; slug?: string };

// 탭 슬러그 기본 순서(대시보드·관리 시트·순위 트래커·크롤링 현황). ShellTab.slug로 개별 지정 가능
//   → 탭을 재배치(예: 대시보드에서 관리 시트를 맨 앞)해도 ?tab=sheet 등 딥링크가 올바른 탭을 가리킴.
const TAB_SLUGS = ['dashboard', 'sheet', 'tracker', 'crawl'];
const slugsOf = (tabs: ShellTab[]) => tabs.map((t, i) => t.slug ?? TAB_SLUGS[i] ?? `t${i}`);

// 드롭다운(하위 카테고리)이 있는 상위(플레이스·인스타·블로그)의 '대시보드'(=?sub 없음)만
//   탭 없는 순수 대시보드. 하위(?sub=)와 드롭다운 없는 카페·쇼핑·파워링크는 기존 4탭 유지.
function isDropdownDash(href: string): boolean {
    const [pathname, query = ''] = href.split('?');
    if (new URLSearchParams(query).has('sub')) return false;
    const scat = SIDEBAR_CATEGORIES.find((c) => c.dashHref.split('?')[0] === pathname);
    return !!scat && scat.subs.length > 0;
}

export function CategoryShell({
    label,
    badge,
    tabs,
    forceTabs,
}: {
    label: string;
    badge?: string;
    tabs: ShellTab[];
    forceTabs?: boolean; // true면 상위(?sub 없음) 대시보드에서도 탭 전부 표시(플레이스 순위 트래커용)
}) {
    const { isAdmin, canManageSheet, loading: authLoading } = useAuth();
    const [href, setHref] = useState(() => window.location.pathname + window.location.search);
    const [active, setActive] = useState(() => {
        const t = new URLSearchParams(window.location.search).get('tab');
        const i = slugsOf(tabs).indexOf(t || '');
        return i >= 0 ? i : 0;
    });
    useEffect(() => {
        const sync = () => {
            setHref(window.location.pathname + window.location.search);
            // ?tab 딥링크(예: 시트에서 행 클릭 → ?tab=tracker) 반영해 활성 탭 전환.
            const t = new URLSearchParams(window.location.search).get('tab');
            const i = slugsOf(tabs).indexOf(t || '');
            if (i >= 0) setActive(i);
        };
        window.addEventListener('popstate', sync);
        window.addEventListener('app:navigate', sync);
        return () => {
            window.removeEventListener('popstate', sync);
            window.removeEventListener('app:navigate', sync);
        };
    }, []);

    // 상위 대시보드면 첫 탭(대시보드)만, 탭바 없이. forceTabs면 항상 전체 탭.
    const dashOnly = !forceTabs && isDropdownDash(href);
    const shownTabs = dashOnly ? tabs.slice(0, 1) : tabs;
    const activeIdx = dashOnly ? 0 : Math.min(active, tabs.length - 1);

    // 접근 권한 — 관리자(전체) 또는 이 카테고리 담당(canManageSheet). 경로로 카테고리 판별.
    const catLabel = (() => {
        const [p] = href.split('?');
        const c = SIDEBAR_CATEGORIES.find(
            (x) => x.dashHref.split('?')[0] === p || x.subs.some((s) => s.href.split('?')[0] === p),
        );
        return c?.label ?? '';
    })();
    const allowed = isAdmin || (!!catLabel && canManageSheet(catLabel));
    if (!authLoading && !allowed) {
        return (
            <section className="grid place-items-center py-24 text-center">
                <div>
                    <h2 className="m-0 text-lg font-bold text-[#0f172a]">접근 권한 없음</h2>
                    <p className="mt-2 text-sm text-[#64748b]">{label}는 담당자·관리자만 접근할 수 있습니다.</p>
                </div>
            </section>
        );
    }

    return (
        <section className="grid gap-4">
            <div className="flex items-center gap-2">
                <h2 className="m-0 text-[22px] font-semibold text-[#0f172a]">{label}</h2>
                {badge ? (
                    <span className="rounded-full bg-[#fef3c7] px-2.5 py-1 text-xs font-bold text-[#b45309]">{badge}</span>
                ) : null}
            </div>

            {shownTabs.length > 1 ? (
                <div className="flex gap-1 border-b border-[#e2e8f0]">
                    {shownTabs.map((t, i) => (
                        <button
                            className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold ${
                                activeIdx === i ? 'border-[#1e40af] text-[#1e40af]' : 'border-transparent text-[#94a3b8]'
                            }`}
                            key={t.name}
                            onClick={() => setActive(i)}
                            type="button"
                        >
                            {t.name}
                        </button>
                    ))}
                </div>
            ) : null}

            {shownTabs[activeIdx]?.el}
        </section>
    );
}
