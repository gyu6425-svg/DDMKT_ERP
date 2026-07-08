import { useEffect, useState, type ReactNode } from 'react';
import { CategoryShell } from './CategoryShell';
import { SIDEBAR_CATEGORIES } from './categories';
import { ContractSheetTab, resolveScope } from './ContractSheetTab';
import { PlaceRankTracker } from './PlaceRankTracker';

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

function Placeholder({ name }: { name: string }) {
    return (
        <div className="rounded-xl border border-dashed border-[#cbd5e1] bg-[#f8fafc] px-6 py-16 text-center">
            <div className="text-base font-semibold text-[#475569]">{name} — 준비 중</div>
            <p className="mx-auto mt-2 max-w-md text-sm text-[#94a3b8]">
                순위 트래커·크롤링 현황은 블로그 대시보드와 동일한 구조로 추가될 예정입니다.
            </p>
        </div>
    );
}

export function SkeletonRankPage({ label, sheetOnly = false }: { label: string; sheetOnly?: boolean }) {
    const href = useLocHref();
    const displayLabel = subLabelOf(href, label);
    const scope = resolveScope(href);
    // 계약 시트는 '관리 시트' 탭에서만. 대시보드/순위/크롤은 준비 중.
    const sheet = scope ? (
        <ContractSheetTab category={scope.category} subtype={scope.subtype} />
    ) : (
        <Placeholder name={displayLabel} />
    );
    // sheetOnly: 관리 시트 탭만(단일 탭 → CategoryShell이 탭바 숨김). 블로그 배포 하위 등.
    if (sheetOnly) {
        return <CategoryShell label={displayLabel} tabs={[{ name: '관리 시트', el: sheet, slug: 'sheet' }]} />;
    }
    return (
        <CategoryShell
            badge="준비 중"
            label={displayLabel}
            tabs={[
                { name: '대시보드', el: <Placeholder name={displayLabel} /> },
                { name: '관리 시트', el: sheet },
                { name: '순위 트래커', el: <Placeholder name="순위 트래커" /> },
                { name: '크롤링 현황', el: <Placeholder name="크롤링 현황" /> },
            ]}
        />
    );
}

// 카테고리 대시보드 공용(플레이스/인스타/카페/쇼핑/파워링크/영상) — 플레이스와 동일 구조.
//   · 최상위(?sub 없음) = 대시보드 / 관리 시트(전 하위유형 통합) / 순위 트래커 / 크롤링 현황.
//   · 하위 카테고리(?sub=) = 관리 시트만(단일 탭 → 탭바 숨김).
//   dashboard/tracker/crawl 을 넘기면 그 컴포넌트를, 없으면 '준비 중' 플레이스홀더를 표시.
export function CategoryDashPage({
    category,
    label,
    dashboard,
    tracker,
    crawl,
}: {
    category: string;
    label: string;
    dashboard?: ReactNode;
    tracker?: ReactNode;
    crawl?: ReactNode;
}) {
    const href = useLocHref();
    const displayLabel = subLabelOf(href, `${label} 대시보드`);
    const hasSub = new URLSearchParams(href.split('?')[1] || '').has('sub');

    if (hasSub) {
        const scope = resolveScope(href);
        const sheet = scope ? (
            <ContractSheetTab category={scope.category} subtype={scope.subtype} />
        ) : (
            <Placeholder name={displayLabel} />
        );
        return <CategoryShell label={displayLabel} tabs={[{ name: '관리 시트', el: sheet, slug: 'sheet' }]} />;
    }

    return (
        <CategoryShell
            forceTabs
            label={`${label} 대시보드`}
            tabs={[
                { name: '대시보드', el: dashboard ?? <Placeholder name={`${label} 대시보드`} />, slug: 'dashboard' },
                { name: '관리 시트', el: <ContractSheetTab category={category} />, slug: 'sheet' },
                { name: '순위 트래커', el: tracker ?? <Placeholder name="순위 트래커" />, slug: 'tracker' },
                { name: '크롤링 현황', el: crawl ?? <Placeholder name="크롤링 현황" />, slug: 'crawl' },
            ]}
        />
    );
}

// 플레이스 대시보드 — 순위 트래커는 실제 컴포넌트(PlaceRankTracker), 나머지는 준비 중.
export function PlaceRankPage() {
    return <CategoryDashPage category="플레이스" label="플레이스" tracker={<PlaceRankTracker />} />;
}
