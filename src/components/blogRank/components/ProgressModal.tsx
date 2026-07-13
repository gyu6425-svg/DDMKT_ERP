import { type BlogAccount } from '../../../api/blogRank';

// 진행률 확인 창 — 발행/잔여 진행률만 표시(읽기 전용). 잔여 조정·재계약·계약은 '계약 관리'에서.
export function ProgressModal({
    account,
    onClose,
}: {
    account: BlogAccount;
    onClose: () => void;
    onReload: () => Promise<void>;
    onToast: (message: string) => void;
}) {
    const goal = account.goal_count ?? 0;
    const hasGoal = account.goal_count != null;
    const remain = account.remain_count ?? account.goal_count ?? 0;
    const done = Math.max(0, goal - remain);
    const pct = goal ? Math.round((done / goal) * 100) : 0;
    const pc = pct >= 70 ? '#059669' : pct >= 40 ? '#d97706' : '#dc2626';

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
            onMouseDown={(e) => e.target === e.currentTarget && onClose()}
        >
            <div className="w-[min(380px,94vw)] rounded-2xl bg-white p-6">
                <h3 className="m-0 text-lg font-bold">{account.name} · 진행률</h3>
                {hasGoal ? (
                    <>
                        <div className="my-4 rounded-lg border border-[#e2e8f0] bg-[#f8fafc] px-4 py-3 text-center">
                            <div className="text-3xl font-bold" style={{ color: pc }}>
                                {pct}%
                            </div>
                            <div className="mt-1 text-sm text-[#475569]">
                                발행 <b>{done}</b> / 계약 {goal}건 · 잔여 <b>{remain}</b>건
                            </div>
                            <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#eef2f7]">
                                <div style={{ background: pc, width: `${pct}%`, height: '100%' }} />
                            </div>
                        </div>
                    </>
                ) : (
                    <p className="my-4 text-sm text-[#64748b]">
                        계약 건수가 입력돼 있지 않습니다. ‘편집’에서 계약건수·잔여건수를 먼저 입력하세요.
                    </p>
                )}
                <p className="mt-3 border-t border-[#e2e8f0] pt-3 text-xs text-[#94a3b8]">
                    재계약·계약 종료·계약일·금액 관리는 <b>계약 관리</b>에서 합니다.
                </p>
                <div className="mt-4 flex justify-end">
                    <button
                        className="rounded-md border border-[#cbd5e1] px-4 py-2 text-sm font-semibold text-[#64748b]"
                        onClick={onClose}
                        type="button"
                    >
                        닫기
                    </button>
                </div>
            </div>
        </div>
    );
}
