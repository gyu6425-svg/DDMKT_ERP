import { useEffect, useState } from 'react';
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

export function SkeletonRankPage({ label }: { label: string }) {
    const href = useLocHref();
    const displayLabel = subLabelOf(href, label);
    const scope = resolveScope(href);
    // 계약 시트는 '관리 시트' 탭에서만. 대시보드/순위/크롤은 준비 중.
    const sheet = scope ? (
        <ContractSheetTab category={scope.category} subtype={scope.subtype} />
    ) : (
        <Placeholder name={displayLabel} />
    );
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

// 플레이스 대시보드.
//   · 최상위(?sub 없음) = '순위 트래커'(애드로그류 크롤링 관리) 전용 화면.
//   · 하위 카테고리(?sub=영수증 리뷰 등) = 대시보드/관리 시트만 — 순위 트래커 없음.
export function PlaceRankPage() {
    const href = useLocHref();
    const displayLabel = subLabelOf(href, '플레이스 대시보드');
    const hasSub = new URLSearchParams(href.split('?')[1] || '').has('sub');

    if (hasSub) {
        const scope = resolveScope(href);
        const sheet = scope ? (
            <ContractSheetTab category={scope.category} subtype={scope.subtype} />
        ) : (
            <Placeholder name={displayLabel} />
        );
        return (
            <CategoryShell
                badge="준비 중"
                label={displayLabel}
                tabs={[
                    { name: '대시보드', el: <Placeholder name={displayLabel} /> },
                    { name: '관리 시트', el: sheet },
                    { name: '크롤링 현황', el: <Placeholder name="크롤링 현황" /> },
                ]}
            />
        );
    }

    // 최상위 플레이스 대시보드 = 순위 트래커(크롤링) 관리 영역.
    return (
        <CategoryShell
            forceTabs
            label="플레이스 대시보드"
            tabs={[
                { name: '순위 트래커', el: <PlaceRankTracker /> },
                { name: '크롤링 현황', el: <Placeholder name="크롤링 현황" /> },
            ]}
        />
    );
}
