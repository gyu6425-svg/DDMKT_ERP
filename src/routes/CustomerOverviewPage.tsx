// 고객 ERP 통합 대시보드 — 고객이 계약한 카테고리들의 현황을 한눈에(요약).
//   현재는 뼈대(준비 중). 카테고리별 데이터 연동 시 요약 카드로 채운다.
function CustomerOverviewPage() {
    return (
        <section className="grid gap-4">
            <div className="flex items-center gap-2">
                <h2 className="m-0 text-[22px] font-semibold text-[#0f172a]">통합 대시보드</h2>
                <span className="rounded-full bg-[#dbeafe] px-2.5 py-1 text-xs font-bold text-[#1e40af]">고객 뷰</span>
            </div>
            <p className="m-0 text-sm text-[#64748b]">계약하신 카테고리(블로그·영상·인스타·카페·트래픽)의 현황을 한눈에 봅니다.</p>

            <div className="rounded-xl border border-dashed border-[#cbd5e1] bg-[#f8fafc] px-6 py-16 text-center">
                <div className="text-base font-semibold text-[#475569]">통합 대시보드 — 준비 중</div>
                <p className="mx-auto mt-2 max-w-md text-sm text-[#94a3b8]">
                    계약한 카테고리별 요약(진행률·순위 등)이 여기에 표시될 예정입니다. 왼쪽 메뉴에서 각 카테고리를 선택하세요.
                </p>
            </div>
        </section>
    );
}

export default CustomerOverviewPage;
