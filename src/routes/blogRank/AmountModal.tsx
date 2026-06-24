import { useState } from 'react';
import { updateBlogAccount, type AmountEntry, type BlogAccount } from '../../api/blogRank';
import { fmtWon } from './helpers';

// 계약금액 누적 편집 창 — '추가 계약 금액' 입력으로 한 건씩 쌓고, '누적 계약 금액'(합계)을 보여준다.
export function AmountModal({
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
    // 기존 내역(amounts) 우선, 없으면 레거시 amount 텍스트를 1건으로 시드.
    const seed: AmountEntry[] =
        account.amounts && account.amounts.length
            ? account.amounts
            : (() => {
                  const n = Number((account.amount || '').replace(/[^\d]/g, ''));
                  return n ? [{ amount: n }] : [];
              })();
    const [entries, setEntries] = useState<AmountEntry[]>(seed);
    const [amt, setAmt] = useState('');
    const [date, setDate] = useState('');
    const [saving, setSaving] = useState(false);

    const total = entries.reduce((s, e) => s + (Number(e.amount) || 0), 0);

    const add = () => {
        const n = Number(amt.replace(/[^\d]/g, ''));
        if (!n) return;
        setEntries([...entries, { amount: n, date: date.trim() || undefined }]);
        setAmt('');
        setDate('');
    };
    const remove = (i: number) => setEntries(entries.filter((_, j) => j !== i));

    const save = async () => {
        setSaving(true);
        const { error } = await updateBlogAccount(account.id, { amounts: entries });
        setSaving(false);
        if (error) {
            onToast(`오류: ${error.message}`);
            return;
        }
        await onReload();
        onToast('계약금액 저장 완료');
        onClose();
    };

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
            onMouseDown={(e) => e.target === e.currentTarget && onClose()}
        >
            <div className="w-[min(480px,94vw)] rounded-2xl bg-white p-6">
                <h3 className="m-0 text-lg font-bold">{account.name} · 계약금액</h3>
                <p className="mt-1 mb-3 text-sm text-[#64748b]">추가 계약마다 한 건씩 쌓이며 누적 합계로 관리됩니다.</p>

                {/* 누적 합계 */}
                <div className="mb-4 rounded-lg border border-[#e2e8f0] bg-[#f8fafc] px-4 py-3">
                    <div className="text-xs font-semibold text-[#64748b]">누적 계약 금액</div>
                    <div className="text-2xl font-bold text-[#1e40af]">
                        {fmtWon(total)}
                        <span className="ml-1 text-base font-semibold text-[#64748b]">원</span>
                    </div>
                    <div className="mt-0.5 text-[11px] text-[#94a3b8]">총 {entries.length}건</div>
                </div>

                {/* 추가 계약 금액 입력 */}
                <div className="mb-3">
                    <div className="mb-1 text-xs font-bold text-[#334155]">추가 계약 금액</div>
                    <div className="flex gap-2">
                        <input
                            className="h-9 w-[120px] rounded-md border border-[#cbd5e1] bg-white px-2 text-sm"
                            inputMode="numeric"
                            onChange={(e) => setAmt(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    e.preventDefault();
                                    add();
                                }
                            }}
                            placeholder="금액(예: 500000)"
                            value={amt}
                        />
                        <input
                            className="h-9 flex-1 rounded-md border border-[#cbd5e1] bg-white px-2 text-sm"
                            onChange={(e) => setDate(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    e.preventDefault();
                                    add();
                                }
                            }}
                            placeholder="계약일(선택, 예: 2026-06-24)"
                            value={date}
                        />
                        <button
                            className="rounded-md bg-[#1e40af] px-4 text-sm font-semibold text-white"
                            onClick={add}
                            type="button"
                        >
                            추가
                        </button>
                    </div>
                </div>

                {/* 내역 */}
                <div className="grid max-h-[34vh] gap-1 overflow-y-auto">
                    {entries.length ? (
                        entries.map((e, i) => (
                            <div
                                className="flex items-center justify-between rounded-md border border-[#eef2f7] px-3 py-2 text-sm"
                                key={i}
                            >
                                <span className="font-semibold text-[#0f172a]">{fmtWon(Number(e.amount) || 0)}원</span>
                                <span className="ml-auto mr-2 text-xs text-[#94a3b8]">{e.date || '일자 미입력'}</span>
                                <button
                                    className="rounded border border-[#fca5a5] px-2 py-0.5 text-[11px] font-semibold text-[#dc2626] hover:bg-[#fef2f2]"
                                    onClick={() => remove(i)}
                                    type="button"
                                >
                                    삭제
                                </button>
                            </div>
                        ))
                    ) : (
                        <div className="rounded-md border border-dashed border-[#cbd5e1] px-3 py-4 text-center text-xs text-[#94a3b8]">
                            아직 등록된 계약금액이 없습니다 · 위에서 추가하세요
                        </div>
                    )}
                </div>

                <div className="mt-4 flex justify-end gap-2">
                    <button
                        className="rounded-md border border-[#cbd5e1] px-4 py-2 text-sm font-semibold text-[#64748b]"
                        onClick={onClose}
                        type="button"
                    >
                        닫기
                    </button>
                    <button
                        className="rounded-md bg-[#1e40af] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                        disabled={saving}
                        onClick={() => void save()}
                        type="button"
                    >
                        {saving ? '저장 중…' : '저장'}
                    </button>
                </div>
            </div>
        </div>
    );
}
