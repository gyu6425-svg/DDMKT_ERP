import { useEffect, useState } from 'react';
import { CategoryShell } from './CategoryShell';
import { SIDEBAR_CATEGORIES } from './categories';

// 하위 카테고리(?sub=) 진입 시 '영수증 리뷰 대시보드'처럼 제목 표시. 사이드바 트리에서 표시 라벨 조회.
function useSubLabel(fallback: string) {
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

export function SkeletonRankPage({ label }: { label: string }) {
    const displayLabel = useSubLabel(label);
    return (
        <CategoryShell
            badge="준비 중"
            label={displayLabel}
            tabs={[{ name: '대시보드', el: <Placeholder name={displayLabel} /> }]}
        />
    );
}
