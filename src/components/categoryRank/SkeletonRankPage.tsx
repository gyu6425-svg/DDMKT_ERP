import { CategoryShell } from './CategoryShell';

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
    return (
        <CategoryShell
            badge="준비 중"
            label={label}
            tabs={[
                { name: '대시보드', el: <Placeholder name="대시보드" /> },
                { name: '관리 시트', el: <Placeholder name="관리 시트" /> },
                { name: '순위 트래커', el: <Placeholder name="순위 트래커" /> },
                { name: '크롤링 현황', el: <Placeholder name="크롤링 현황" /> },
            ]}
        />
    );
}
