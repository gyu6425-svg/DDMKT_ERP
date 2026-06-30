import { useAuth } from '../../hooks/useAuth';
import type { CategoryDef } from './categories';

// 카테고리 대시보드 뼈대(준비 중) — 영상/인스타/카페/트래픽이 공유.
//   실제 기능(시트·트래커 등)은 다음 단계에서 이 폴더(src/components/categoryRank/)에 구현해 채운다.
//   블로그 대시보드와 동일하게 관리자 전용.
export function CategoryDashboardSkeleton({ def }: { def: CategoryDef }) {
    const { isAdmin, loading: authLoading } = useAuth();

    if (!authLoading && !isAdmin) {
        return (
            <section className="grid place-items-center py-24 text-center">
                <div>
                    <h2 className="m-0 text-lg font-bold text-[#0f172a]">관리자 전용 페이지</h2>
                    <p className="mt-2 text-sm text-[#64748b]">{def.label}는 관리자 계정만 접근할 수 있습니다.</p>
                </div>
            </section>
        );
    }

    return (
        <section className="grid gap-4">
            <div className="flex items-center gap-2">
                <h2 className="m-0 text-[22px] font-semibold text-[#0f172a]">{def.label}</h2>
                <span className="rounded-full bg-[#fef3c7] px-2.5 py-1 text-xs font-bold text-[#b45309]">준비 중</span>
            </div>
            <p className="m-0 text-sm text-[#64748b]">
                고객사 관리에서 <b>{def.label.replace(' 대시보드', '')}</b> 카테고리로 계약을 등록하면 이 페이지에서 관리합니다.
            </p>

            {/* 예정 탭 구조 (비활성 미리보기) */}
            <div className="flex gap-1 border-b border-[#e2e8f0]">
                {def.tabs.map((t, i) => (
                    <span
                        className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold ${
                            i === 0 ? 'border-[#cbd5e1] text-[#94a3b8]' : 'border-transparent text-[#cbd5e1]'
                        }`}
                        key={t}
                    >
                        {t}
                    </span>
                ))}
            </div>

            <div className="rounded-xl border border-dashed border-[#cbd5e1] bg-[#f8fafc] px-6 py-16 text-center">
                <div className="text-base font-semibold text-[#475569]">{def.label} — 곧 추가됩니다</div>
                <p className="mx-auto mt-2 max-w-md text-sm text-[#94a3b8]">
                    이 카테고리는 블로그 대시보드와 동일한 구조(
                    {def.tabs.join(' · ')})로 구현될 예정입니다. 데이터는 고객사 관리와 연동됩니다.
                </p>
            </div>
        </section>
    );
}
