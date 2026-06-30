import { useState } from 'react';
import { updateBlogAccount, type BlogAccount, type ContractPeriod } from '../../../api/blogRank';

// 계약 편집 창 — 계약 기간(시작일~종료일)을 입력하고, 재계약할 때마다 기간을 쌓는다.
// 마지막 기간 = 현재 계약. 종료일 = 다음 재계약 예정일(상태 '재계약 임박' 판정 기준).
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
    const seed: ContractPeriod[] =
        account.contracts && account.contracts.length
            ? account.contracts
            : account.contract_date
              ? [{ start: account.contract_date }]
              : [];
    const [periods, setPeriods] = useState<ContractPeriod[]>(seed);
    const [start, setStart] = useState('');
    const [count, setCount] = useState(''); // 계약 건수(일수/종료일 대신)
    const [saving, setSaving] = useState(false);

    const add = () => {
        const s = start.trim();
        if (!s) return;
        const n = Number(count.trim());
        setPeriods([...periods, { start: s, count: count.trim() && n > 0 ? n : undefined }]);
        setStart('');
        setCount('');
    };
    const remove = (i: number) => setPeriods(periods.filter((_, j) => j !== i));
    const updateStart = (i: number, value: string) =>
        setPeriods(periods.map((p, j) => (j === i ? { ...p, start: value } : p)));
    const updateCount = (i: number, value: string) =>
        setPeriods(periods.map((p, j) => (j === i ? { ...p, count: value.trim() ? Number(value) : undefined } : p)));

    const save = async () => {
        setSaving(true);
        const clean = periods
            .map((p) => ({ start: p.start.trim(), count: p.count, note: p.note }))
            .filter((p) => p.start);
        const { error } = await updateBlogAccount(account.id, {
            contracts: clean,
            contract_date: clean.length ? clean[0].start : null, // 레거시 동기화(최초 시작일)
        });
        setSaving(false);
        if (error) {
            onToast(`오류: ${error.message}`);
            return;
        }
        await onReload();
        onToast('계약 저장 완료');
        onClose();
    };

    const cur = periods.length ? periods[periods.length - 1] : null;

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
            onMouseDown={(e) => e.target === e.currentTarget && onClose()}
        >
            <div className="w-[min(500px,94vw)] rounded-2xl bg-white p-6">
                <h3 className="m-0 text-lg font-bold">{account.name} · 계약</h3>
                <p className="mt-1 mb-3 text-sm text-[#64748b]">
                    이 시스템은 ‘건 단위’ 계약입니다. 재계약할 때마다 계약 시작일·계약 건수를 추가하세요.
                </p>

                {/* 현재 계약 */}
                <div className="mb-4 rounded-lg border border-[#e2e8f0] bg-[#f8fafc] px-4 py-3">
                    <div className="text-xs font-semibold text-[#64748b]">현재 계약</div>
                    {cur ? (
                        <div className="text-base font-bold text-[#1e40af]">
                            {cur.start} <span className="text-[#94a3b8]">·</span> 계약 {cur.count ?? '—'}건
                        </div>
                    ) : (
                        <div className="text-sm text-[#94a3b8]">아직 계약 정보가 없습니다</div>
                    )}
                    <div className="mt-0.5 text-[11px] text-[#94a3b8]">총 {periods.length}차 계약</div>
                </div>

                {/* 계약/재계약 추가 */}
                <div className="mb-3">
                    <div className="mb-1 text-xs font-bold text-[#334155]">계약 추가 (시작일 · 계약 건수)</div>
                    <div className="flex flex-wrap gap-2">
                        <input
                            className="h-9 flex-1 rounded-md border border-[#cbd5e1] bg-white px-2 text-sm"
                            onChange={(e) => setStart(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())}
                            placeholder="계약 시작일 (예: 2026-01-15)"
                            value={start}
                        />
                        <input
                            className="h-9 w-[130px] rounded-md border border-[#cbd5e1] bg-white px-2 text-sm"
                            min="1"
                            onChange={(e) => setCount(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())}
                            placeholder="계약 건수 (예: 50)"
                            type="number"
                            value={count}
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

                {/* 계약 이력 */}
                <div className="mb-1 text-xs font-bold text-[#334155]">계약 이력</div>
                <div className="grid max-h-[34vh] gap-1 overflow-y-auto">
                    {periods.length ? (
                        periods.map((p, i) => (
                            <div
                                className="flex items-center gap-1.5 rounded-md border border-[#eef2f7] px-2 py-2 text-sm"
                                key={i}
                            >
                                <span
                                    className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                                        i === 0 ? 'bg-[#dbeafe] text-[#1e40af]' : 'bg-[#f1f5f9] text-[#475569]'
                                    }`}
                                >
                                    {i === 0 ? '최초' : `재${i}`}
                                </span>
                                <input
                                    className="h-8 w-[110px] rounded border border-[#cbd5e1] bg-white px-1.5 text-xs"
                                    onChange={(e) => updateStart(i, e.target.value)}
                                    placeholder="시작일"
                                    value={p.start}
                                />
                                <span className="text-[11px] text-[#94a3b8]">· 계약</span>
                                <input
                                    className="h-8 w-[64px] rounded border border-[#cbd5e1] bg-white px-1.5 text-xs"
                                    min="1"
                                    onChange={(e) => updateCount(i, e.target.value)}
                                    placeholder="건수"
                                    type="number"
                                    value={p.count ?? ''}
                                />
                                <span className="text-[11px] text-[#94a3b8]">건</span>
                                <button
                                    className="ml-auto shrink-0 rounded border border-[#fca5a5] px-2 py-0.5 text-[11px] font-semibold text-[#dc2626] hover:bg-[#fef2f2]"
                                    onClick={() => remove(i)}
                                    type="button"
                                >
                                    삭제
                                </button>
                            </div>
                        ))
                    ) : (
                        <div className="rounded-md border border-dashed border-[#cbd5e1] px-3 py-4 text-center text-xs text-[#94a3b8]">
                            아직 계약 정보가 없습니다 · 위에서 추가하세요
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
