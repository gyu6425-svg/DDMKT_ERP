import { useState } from 'react';
import { updateBlogAccount, type BlogAccount } from '../../../api/blogRank';
import { syncContractProgressFromBlog } from '../../../api/clientContracts';

// 진행률 창 — 기본은 읽기 전용(발행/잔여 진행률만 표시).
//   canEdit(=김다영 계정, 임시)면 '진행 건수 수정' 가능 → 블로그 잔여 갱신 + 계약 관리 잔여도 자동 연동.
export function ProgressModal({
    account,
    canEdit = false,
    onClose,
    onReload,
    onToast,
}: {
    account: BlogAccount;
    canEdit?: boolean;
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

    const [editing, setEditing] = useState(false);
    const [goalInput, setGoalInput] = useState(hasGoal ? String(goal) : '');
    const [doneInput, setDoneInput] = useState(String(done));
    const [saving, setSaving] = useState(false);
    const onlyNum = (s: string) => s.replace(/[^\d]/g, '');

    const save = async () => {
        const g = Number(onlyNum(goalInput)) || 0;
        if (!g) return onToast('계약 건수를 입력하세요');
        const d = Math.min(g, Number(onlyNum(doneInput)) || 0); // 진행 건수는 계약 건수 초과 불가
        const newRemain = Math.max(0, g - d);
        setSaving(true);
        const { error } = await updateBlogAccount(account.id, { goal_count: g, remain_count: newRemain });
        if (error) {
            setSaving(false);
            return onToast('저장 실패: ' + error.message);
        }
        // 계약 관리 연동 — 그 고객사 브랜드블로그 계약의 잔여도 함께 반영(양방향 연동).
        const { synced } = await syncContractProgressFromBlog(account.client_id, newRemain, account.name);
        setSaving(false);
        await onReload();
        onToast(synced ? '진행 건수 저장 · 계약 관리에도 반영됐습니다' : '진행 건수 저장 완료(연동할 계약 없음)');
        onClose();
    };

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
            onMouseDown={(e) => e.target === e.currentTarget && onClose()}
        >
            <div className="w-[min(380px,94vw)] rounded-2xl bg-white p-6">
                <h3 className="m-0 text-lg font-bold">{account.name} · 진행률</h3>
                {hasGoal ? (
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
                ) : (
                    <p className="my-4 text-sm text-[#64748b]">
                        계약 건수가 입력돼 있지 않습니다.
                        {canEdit ? " '진행 건수 수정'에서 계약·진행 건수를 입력하세요." : " ‘편집’에서 먼저 입력하세요."}
                    </p>
                )}

                {/* 진행 건수 직접 수정 — 김다영 계정 전용(임시). 저장 시 계약 관리 잔여도 자동 연동. */}
                {canEdit ? (
                    editing ? (
                        <div className="grid gap-2 rounded-lg border border-[#c7d2fe] bg-[#eef2ff] p-3">
                            <div className="text-xs font-bold text-[#4338ca]">진행 건수 수정 (계약 관리에도 연동됨)</div>
                            <div className="grid grid-cols-2 gap-2">
                                <label className="text-[11px] font-semibold text-[#475569]">
                                    계약 건수
                                    <input
                                        className="mt-1 h-9 w-full rounded-md border border-[#cbd5e1] px-2 text-right text-sm"
                                        inputMode="numeric"
                                        onChange={(e) => setGoalInput(onlyNum(e.target.value))}
                                        placeholder="예: 24"
                                        value={goalInput}
                                    />
                                </label>
                                <label className="text-[11px] font-semibold text-[#475569]">
                                    진행 건수
                                    <input
                                        className="mt-1 h-9 w-full rounded-md border border-[#cbd5e1] px-2 text-right text-sm"
                                        inputMode="numeric"
                                        onChange={(e) => setDoneInput(onlyNum(e.target.value))}
                                        placeholder="예: 5"
                                        value={doneInput}
                                    />
                                </label>
                            </div>
                            <div className="text-[11px] text-[#64748b]">
                                잔여 = {Math.max(0, (Number(onlyNum(goalInput)) || 0) - (Number(onlyNum(doneInput)) || 0))}건
                                (계약 − 진행)
                            </div>
                            <div className="flex justify-end gap-2">
                                <button
                                    className="rounded-md border border-[#cbd5e1] px-3 py-1.5 text-xs font-semibold text-[#64748b]"
                                    onClick={() => setEditing(false)}
                                    type="button"
                                >
                                    취소
                                </button>
                                <button
                                    className="rounded-md bg-[#1e40af] px-4 py-1.5 text-xs font-bold text-white disabled:opacity-50"
                                    disabled={saving}
                                    onClick={() => void save()}
                                    type="button"
                                >
                                    {saving ? '저장 중…' : '저장'}
                                </button>
                            </div>
                        </div>
                    ) : (
                        <button
                            className="w-full rounded-md border border-[#1e40af] bg-white px-3 py-2 text-sm font-bold text-[#1e40af] hover:bg-[#eff6ff]"
                            onClick={() => {
                                setGoalInput(hasGoal ? String(goal) : '');
                                setDoneInput(String(done));
                                setEditing(true);
                            }}
                            type="button"
                        >
                            ✎ 진행 건수 수정
                        </button>
                    )
                ) : (
                    <p className="mt-3 border-t border-[#e2e8f0] pt-3 text-xs text-[#94a3b8]">
                        재계약·계약 종료·계약일·금액 관리는 <b>계약 관리</b>에서 합니다.
                    </p>
                )}

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
