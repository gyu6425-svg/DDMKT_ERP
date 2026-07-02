import { useEffect, useState } from 'react';
import { CategoryShell } from './CategoryShell';
import { SIDEBAR_CATEGORIES } from './categories';

// 현재 URL(경로+쿼리)을 반응형으로 추적 — 네비게이션(app:navigate/popstate) 시 갱신.
function useLocHref() {
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
    return href;
}

// 하위 카테고리(?sub=) 진입 시 '영수증 리뷰 대시보드'처럼 제목 표시. 사이드바 트리에서 표시 라벨 조회.
function subLabelOf(href: string, fallback: string) {
    for (const c of SIDEBAR_CATEGORIES) {
        const sub = c.subs.find((s) => s.href === href);
        if (sub) return `${sub.label} 대시보드`;
    }
    return fallback;
}

// 준비 중 카테고리 대시보드 공용 페이지 — 블로그와 동일 셸/탭 구성, 내용은 '준비 중' 안내.
function Placeholder({ name }: { name: string }) {
    return (
        <div className="rounded-xl border border-dashed border-[#cbd5e1] bg-[#f8fafc] px-6 py-16 text-center">
            <div className="text-base font-semibold text-[#475569]">{name} — 준비 중</div>
            <p className="mx-auto mt-2 max-w-md text-sm text-[#94a3b8]">
                블로그 대시보드와 동일한 구조로 추가될 예정입니다.
            </p>
        </div>
    );
}

const FULL_TABS = [
    { name: '대시보드', el: <Placeholder name="대시보드" /> },
    { name: '관리 시트', el: <Placeholder name="관리 시트" /> },
    { name: '순위 트래커', el: <Placeholder name="순위 트래커" /> },
    { name: '크롤링 현황', el: <Placeholder name="크롤링 현황" /> },
];

export function SkeletonRankPage({ label }: { label: string }) {
    const href = useLocHref();
    const displayLabel = subLabelOf(href, label);

    // 드롭다운(하위 카테고리)이 있는 상위(플레이스·인스타·블로그)의 '대시보드'(=?sub 없음)만
    //   탭 없는 순수 대시보드. 하위(?sub=)와 드롭다운 없는 카페·쇼핑·파워링크는 기존 4탭 유지.
    const pathname = href.split('?')[0];
    const hasSub = new URLSearchParams(href.split('?')[1] || '').has('sub');
    const scat = SIDEBAR_CATEGORIES.find((c) => c.dashHref.split('?')[0] === pathname);
    const isDropdownDash = !!scat && scat.subs.length > 0 && !hasSub;

    return (
        <CategoryShell
            badge="준비 중"
            label={displayLabel}
            tabs={
                isDropdownDash
                    ? [{ name: '대시보드', el: <Placeholder name={displayLabel} /> }]
                    : FULL_TABS
            }
        />
    );
}
