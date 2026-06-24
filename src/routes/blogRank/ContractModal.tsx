import { useState } from 'react';
import { updateBlogAccount, type BlogAccount, type ContractRenewal } from '../../api/blogRank';

// 계약일 편집 창 — 최초 계약일 + 재계약 날짜 입력, 재계약할 때마다 하단 히스토리에 누적.
export function ContractModal({
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
    const [initial, setInitial] = useState(account.contract_date ?? '');
    const [renewals, setRenewals] = useState<ContractRenewal[]>(account.renewals ?? []);
    const [renewDate, setRenewDate] = useState('');
    const [saving, setSaving] = useState(false);

    const add = () => {
        const d = renewDate.trim();
        if (!d) return;
        setRenewals([...renewals, { date: d }]);
        setRenewDate('');
    };
    const remove = (i: number) => setRenewals(renewals.filter((_, j) => j !== i));

    const save = async () => {
        setSaving(true);
        const { error } = await updateBlogAccount(account.id, {
            contract_date: initial.trim() || null,
            renewals,
        });
        setSaving(false);
        if (error) {
            onToast(`오류: ${error.message}`);
            return;
        }
        await onReload();
        onToast('계약일 저장 완료');
        onClose();
    };

    // 히스토리(오래된→최신): 최초 + 재계약들
    const history: { label: string; date: string; idx: number | null }[] = [
        ...(initial ? [{ label: '최초 계약', date: initial, idx: null }] : []),
        ...renewals.map((r, i) => ({ label: `재계약 ${i + 1}회차`, date: r.date, idx: i })),
    ];

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
            onMouseDown={(e) => e.target === e.currentTarget && onClose()}
        >
            <div className="w-[min(480px,94vw)] rounded-2xl bg-white p-6">
                <h3 className="m-0 text-lg font-bold">{account.name} · 계약일</h3>
                <p className="mt-1 mb-3 text-sm text-[#64748b]">최초 계약일과 재계약 이력을 함께 관리합니다.</p>

                {/* 최초 계약일 */}
                <div className="mb-3">
                    <div className="mb-1 text-xs font-bold text-[#334155]">최초 계약일</div>
                    <input
                        className="h-9 w-full rounded-md border border-[#cbd5e1] bg-white px-2 text-sm"
                        onChange={(e) => setInitial(e.target.value)}
                        placeholder="예: 2026-01-15"
                        value={initial}
                    />
                </div>

                {/* 재계약 입력 */}
                <div className="mb-3">
                    <div className="mb-1 text-xs font-bold text-[#334155]">재계약</div>
                    <div className="flex gap-2">
                        <input
                            className="h-9 flex-1 rounded-md border border-[#cbd5e1] bg-white px-2 text-sm"
                            onChange={(e) => setRenewDate(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    e.preventDefault();
                                    add();
                                }
                            }}
                            placeholder="재계약 날짜 (예: 2026-07-15)"
                            value={renewDate}
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

                {/* 히스토리 */}
                <div className="mb-1 text-xs font-bold text-[#334155]">계약 히스토리</div>
                <div className="grid max-h-[34vh] gap-1 overflow-y-auto">
                    {history.length ? (
                        history.map((h) => (
                            <div
                                className="flex items-center gap-2 rounded-md border border-[#eef2f7] px-3 py-2 text-sm"
                                key={`${h.label}-${h.date}`}
                            >
                                <span
                                    className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                                        h.idx === null ? 'bg-[#dbeafe] text-[#1e40af]' : 'bg-[#f1f5f9] text-[#475569]'
                                    }`}
                                >
                                    {h.label}
                                </span>
                                <span className="font-semibold text-[#0f172a]">{h.date}</span>
                                {h.idx !== null ? (
                                    <button
                                        className="ml-auto rounded border border-[#fca5a5] px-2 py-0.5 text-[11px] font-semibold text-[#dc2626] hover:bg-[#fef2f2]"
                                        onClick={() => remove(h.idx as number)}
                                        type="button"
                                    >
                                        삭제
                                    </button>
                                ) : null}
                            </div>
                        ))
                    ) : (
                        <div className="rounded-md border border-dashed border-[#cbd5e1] px-3 py-4 text-center text-xs text-[#94a3b8]">
                            아직 계약일이 없습니다 · 위에서 입력하세요
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
