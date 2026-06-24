import { useState } from 'react';
import { updateBlogAccount, type BlogAccount, type HistoryEntry } from '../../api/blogRank';

// 값+날짜 변경 이력 편집 창(주 발행·기자단 공용) — 변경할 때마다 (값+날짜) 한 건씩 쌓고 마지막이 현재값.
export function FieldHistoryModal({
    account,
    label,
    legacyValue,
    history,
    historyCol,
    legacyCol,
    placeholder,
    onClose,
    onReload,
    onToast,
}: {
    account: BlogAccount;
    label: string;
    legacyValue: string | null;
    history: HistoryEntry[] | null;
    historyCol: 'weekly_history' | 'reporter_history';
    legacyCol: 'weekly' | 'reporter';
    placeholder: string;
    onClose: () => void;
    onReload: () => Promise<void>;
    onToast: (message: string) => void;
}) {
    const seed: HistoryEntry[] =
        history && history.length ? history : legacyValue ? [{ value: legacyValue }] : [];
    const [entries, setEntries] = useState<HistoryEntry[]>(seed);
    const [val, setVal] = useState('');
    const [date, setDate] = useState('');
    const [saving, setSaving] = useState(false);

    const current = entries.length ? entries[entries.length - 1].value : '';

    const add = () => {
        const v = val.trim();
        if (!v) return;
        setEntries([...entries, { value: v, date: date.trim() || undefined }]);
        setVal('');
        setDate('');
    };
    const remove = (i: number) => setEntries(entries.filter((_, j) => j !== i));

    const save = async () => {
        setSaving(true);
        const last = entries.length ? entries[entries.length - 1].value : null;
        const payload: Partial<BlogAccount> = {};
        payload[historyCol] = entries;
        payload[legacyCol] = last;
        const { error } = await updateBlogAccount(account.id, payload);
        setSaving(false);
        if (error) {
            onToast(`오류: ${error.message}`);
            return;
        }
        await onReload();
        onToast(`${label} 저장 완료`);
        onClose();
    };

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
            onMouseDown={(e) => e.target === e.currentTarget && onClose()}
        >
            <div className="w-[min(480px,94vw)] rounded-2xl bg-white p-6">
                <h3 className="m-0 text-lg font-bold">
                    {account.name} · {label}
                </h3>
                <p className="mt-1 mb-3 text-sm text-[#64748b]">
                    변경할 때마다 값과 날짜가 이력으로 쌓이고, 마지막 값이 현재값으로 표시됩니다.
                </p>

                {/* 현재값 */}
                <div className="mb-4 rounded-lg border border-[#e2e8f0] bg-[#f8fafc] px-4 py-3">
                    <div className="text-xs font-semibold text-[#64748b]">현재 {label}</div>
                    <div className="text-xl font-bold text-[#1e40af]">{current || '—'}</div>
                </div>

                {/* 변경 입력 */}
                <div className="mb-3">
                    <div className="mb-1 text-xs font-bold text-[#334155]">{label} 변경</div>
                    <div className="flex gap-2">
                        <input
                            className="h-9 w-[130px] rounded-md border border-[#cbd5e1] bg-white px-2 text-sm"
                            onChange={(e) => setVal(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    e.preventDefault();
                                    add();
                                }
                            }}
                            placeholder={placeholder}
                            value={val}
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
                            placeholder="변경일(선택, 예: 2026-06-24)"
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

                {/* 이력 */}
                <div className="mb-1 text-xs font-bold text-[#334155]">변경 이력</div>
                <div className="grid max-h-[34vh] gap-1 overflow-y-auto">
                    {entries.length ? (
                        entries.map((e, i) => (
                            <div
                                className="flex items-center gap-2 rounded-md border border-[#eef2f7] px-3 py-2 text-sm"
                                key={i}
                            >
                                {i === entries.length - 1 ? (
                                    <span className="rounded bg-[#dbeafe] px-1.5 py-0.5 text-[10px] font-semibold text-[#1e40af]">
                                        현재
                                    </span>
                                ) : null}
                                <span className="font-semibold text-[#0f172a]">{e.value}</span>
                                <span className="ml-auto mr-2 text-xs text-[#94a3b8]">{e.date || '날짜 미입력'}</span>
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
                            아직 이력이 없습니다 · 위에서 추가하세요
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
