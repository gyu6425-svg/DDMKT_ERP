import { useEffect, useState, type ReactNode } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { SIDEBAR_CATEGORIES } from './categories';

// 카테고리 대시보드 공유 셸 — 관리자 게이트 + 헤더 + 탭바 + 활성 탭.
//   각 카테고리(영상/인스타/카페/트래픽) 페이지가 자기 탭 컴포넌트를 넘겨 재사용. 블로그 대시보드와 동일 UX.
export type ShellTab = { name: string; el: ReactNode };

// 탭 순서 고정: 대시보드·관리 시트·순위 트래커·크롤링 현황 → ?tab=sheet 등으로 딥링크(계약 카드에서 이동).
const TAB_SLUGS = ['dashboard', 'sheet', 'tracker', 'crawl'];

// 드롭다운(하위 카테고리)이 있는 상위(플레이스·인스타·블로그)의 '대시보드'(=?sub 없음)만
//   탭 없는 순수 대시보드. 하위(?sub=)와 드롭다운 없는 카페·쇼핑·파워링크는 기존 4탭 유지.
function isDropdownDash(href: string): boolean {
    const [pathname, query = ''] = href.split('?');
    if (new URLSearchParams(query).has('sub')) return false;
    const scat = SIDEBAR_CATEGORIES.find((c) => c.dashHref.split('?')[0] === pathname);
    return !!scat && scat.subs.length > 0;
}

export function CategoryShell({ label, badge, tabs }: { label: string; badge?: string; tabs: ShellTab[] }) {
    const { isAdmin, loading: authLoading } = useAuth();
    const [href, setHref] = useState(() => window.location.pathname + window.location.search);
    useEffect(() => {
        const sync = () => setHref(window.location.pathname + window.location.search);
        window.addEventListener('popstate', sync);
        window.addEventListener('app:navigate', sync);
        return () => {
            window.removeEventListener('popstate', sync);
            window.removeEventListener('app:navigate', sync);
        };
    }, []);

    // 상위 대시보드면 첫 탭(대시보드)만, 탭바 없이.
    const dashOnly = isDropdownDash(href);
    const shownTabs = dashOnly ? tabs.slice(0, 1) : tabs;

    const [active, setActive] = useState(() => {
        const t = new URLSearchParams(window.location.search).get('tab');
        const i = TAB_SLUGS.indexOf(t || '');
        return i >= 0 && i < tabs.length ? i : 0;
    });
    const activeIdx = dashOnly ? 0 : active;

    if (!authLoading && !isAdmin) {
        return (
            <section className="grid place-items-center py-24 text-center">
                <div>
                    <h2 className="m-0 text-lg font-bold text-[#0f172a]">관리자 전용 페이지</h2>
                    <p className="mt-2 text-sm text-[#64748b]">{label}는 관리자 계정만 접근할 수 있습니다.</p>
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
