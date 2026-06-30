// 영상 · 대시보드 탭 — 뼈대(placeholder). 블로그 대시보드와 동일 구조로 추후 구현.
export function VideoDashboardTab() {
    return (
        <div className="rounded-xl border border-dashed border-[#cbd5e1] bg-[#f8fafc] px-6 py-16 text-center">
            <div className="text-base font-semibold text-[#475569]">영상 · 대시보드</div>
            <p className="mx-auto mt-2 max-w-md text-sm text-[#94a3b8]">핵심 지표(업체 수·진행률·재계약 임박 등)를 한눈에.</p>
        </div>
    );
}
