import { useState } from 'react';
import { updateBlogAccount, type BlogAccount, type ContractPeriod } from '../../../api/blogRank';

// 진행률 관리 창 — '1건 완료'로 잔여 건수를 1 줄여(=발행 1건 처리) 진행률에 자동 반영.
export function ProgressModal({
    account,
    onClose,
    onReload,
    onToast,
}: {
    account: BlogAccount;
    onClose: () => void;
    onReload: () => Promise<void>;
    onToast: (message: string) => void;
}) {
    const goal = account.goal_count ?? 0;
    const hasGoal = account.goal_count != null;
    const [remain, setRemain] = useState(account.remain_count ?? account.goal_count ?? 0);
    const [saving, setSaving] = useState(false);
    const [renewing, setRenewing] = useState(false); // 재계약 폼 표시
    const [reStart, setReStart] = useState('');
    const [reCount, setReCount] = useState('');

    const done = Math.max(0, goal - remain);
    const pct = goal ? Math.round((done / goal) * 100) : 0;
    const pc = pct >= 70 ? '#059669' : pct >= 40 ? '#d97706' : '#dc2626';
    const ended = !!account.contract_ended_at;
    // 계약 종료 버튼 노출 조건 — 잔여 3건 이하 또는 100% 채움(재계약 판단 시점).
    const canEnd = hasGoal && (remain <= 3 || pct >= 100);

    const setEnded = async (on: boolean) => {
        if (saving) return;
        setSaving(true);
        const { error } = await updateBlogAccount(account.id, {
            contract_ended_at: on ? new Date().toISOString() : null,
        });
        setSaving(false);
        if (error) {
            onToast(`오류: ${error.message}`);
            return;
        }
        onToast(on ? `${account.name} — 계약 종료 처리` : `${account.name} — 계약 중으로 복귀`);
        await onReload();
        onClose();
    };

    // 재계약 = 새 계약(시작일·건수)을 계약 이력에 추가 + 그 건수로 새 계약 시작(진행률 0%부터).
    const addRenewal = async () => {
        if (saving) return;
        const s = reStart.trim();
        const n = Number(reCount);
        if (!s || !n || n <= 0) {
            onToast('계약 시작일과 계약 건수를 입력하세요');
            return;
        }
        // 기존 계약 이력(없으면 최초 계약을 시드) 뒤에 이번 재계약을 쌓는다.
        const prev: ContractPeriod[] =
            account.contracts && account.contracts.length
                ? account.contracts
                : account.contract_date
                  ? [{ start: account.contract_date, count: hasGoal ? goal : undefined }]
                  : [];
        const next: ContractPeriod[] = [...prev, { start: s, count: n }];
        setSaving(true);
        const { error } = await updateBlogAccount(account.id, {
            contracts: next,
            goal_count: n, // 현재 계약 = 이번 재계약 건수
            remain_count: n, // 0%부터 시작
            contract_ended_at: null,
            contract_date: next[0]?.start ?? s,
        });
        setSaving(false);
        if (error) {
            onToast(`오류: ${error.message}`);
            return;
        }
        onToast(`${account.name} — 재계약 추가(계약 ${n}건 · 0%부터)`);
        await onReload();
        onClose();
    };

    // deltaDone=+1 → 1건 완료(잔여 -1), -1 → 되돌리기(잔여 +1)
    const adjust = async (deltaDone: number) => {
        if (saving || !hasGoal) return;
        const next = Math.max(0, Math.min(goal, remain - deltaDone));
        if (next === remain) return;
        setRemain(next); // 즉시 반영(낙관적)
        setSaving(true);
        const { error } = await updateBlogAccount(account.id, { remain_count: next });
        setSaving(false);
        if (error) {
            onToast(`오류: ${error.message}`);
            setRemain(remain); // 롤백
            return;
        }
        await onReload();
    };

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
                        <div className="flex gap-2">
                            <button
                                className="flex-1 rounded-md bg-[#059669] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#047857] disabled:opacity-50"
                                disabled={saving || remain <= 0}
                                onClick={() => void adjust(1)}
                                type="button"
                            >
                                + 1건 완료
                            </button>
                            <button
                                className="rounded-md border border-[#cbd5e1] px-3 py-2.5 text-sm font-semibold text-[#475569] hover:bg-[#f1f5f9] disabled:opacity-50"
                                disabled={saving || remain >= goal}
                                onClick={() => void adjust(-1)}
                                type="button"
                            >
                                되돌리기
                            </button>
                        </div>
                        <p className="mt-2 text-xs text-[#94a3b8]">
                            ‘1건 완료’를 누르면 잔여 건수가 1 줄고 진행률에 자동 반영됩니다(바로 저장).
                        </p>
                    </>
                ) : (
                    <p className="my-4 text-sm text-[#64748b]">
                        계약 건수가 입력돼 있지 않습니다. ‘편집’에서 계약건수·잔여건수를 먼저 입력하세요.
                    </p>
                )}
                {hasGoal && (canEnd || ended) ? (
                    <div className="mt-3 border-t border-[#e2e8f0] pt-3">
                        {ended ? (
                            <button
                                className="w-full rounded-md border border-[#cbd5e1] px-4 py-2.5 text-sm font-bold text-[#475569] hover:bg-[#f1f5f9] disabled:opacity-50"
                                disabled={saving}
                                onClick={() => void setEnded(false)}
                                type="button"
                            >
                                ↺ 계약 중으로 복귀
                            </button>
                        ) : (
                            <div className="flex flex-col gap-2">
                                {renewing ? (
                                    <div className="rounded-md border border-[#a7f3d0] bg-[#f0fdf4] p-2.5">
                                        <div className="mb-1.5 text-xs font-bold text-[#047857]">재계약 (새 계약 추가)</div>
                                        <div className="flex gap-2">
                                            <input
                                                className="h-9 flex-1 rounded-md border border-[#cbd5e1] bg-white px-2 text-sm"
                                                onChange={(e) => setReStart(e.target.value)}
                                                placeholder="계약 시작일 (예: 2026-07-01)"
                                                value={reStart}
                                            />
                                            <input
                                                className="h-9 w-[110px] rounded-md border border-[#cbd5e1] bg-white px-2 text-sm"
                                                min="1"
                                                onChange={(e) => setReCount(e.target.value)}
                                                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), void addRenewal())}
                                                placeholder="계약 건수"
                                                type="number"
                                                value={reCount}
                                            />
                                        </div>
                                        <div className="mt-2 flex gap-2">
                                            <button
                                                className="flex-1 rounded-md bg-[#059669] px-4 py-2 text-sm font-bold text-white hover:bg-[#047857] disabled:opacity-50"
                                                disabled={saving}
                                                onClick={() => void addRenewal()}
                                                type="button"
                                            >
                                                추가 (계약 이력에 쌓임)
                                            </button>
                                            <button
                                                className="rounded-md border border-[#cbd5e1] px-3 py-2 text-sm font-semibold text-[#475569]"
                                                onClick={() => setRenewing(false)}
                                                type="button"
                                            >
                                                취소
                                            </button>
                                        </div>
                                    </div>
                                ) : (
                                    <button
                                        className="w-full rounded-md bg-[#059669] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#047857] disabled:opacity-50"
                                        disabled={saving}
                                        onClick={() => setRenewing(true)}
                                        type="button"
                                    >
                                        재계약 (새 계약 시작)
                                    </button>
                                )}
                                <button
                                    className="w-full rounded-md bg-[#dc2626] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#b91c1c] disabled:opacity-50"
                                    disabled={saving}
                                    onClick={() => void setEnded(true)}
                                    type="button"
                                >
                                    계약 종료
                                </button>
                            </div>
                        )}
                        <p className="mt-1.5 text-xs text-[#94a3b8]">
                            {ended
                                ? '계약 종료 상태입니다. 복귀하면 ‘계약 중’ 목록으로 돌아갑니다.'
                                : '재계약 = 잔여를 계약 건수로 리셋(새 계약, 0%부터). 종료 = ‘계약 종료’ 탭으로 분리 보관.'}
                        </p>
                    </div>
                ) : null}
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
