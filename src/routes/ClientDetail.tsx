import { useState } from 'react';
import type { ErpClient } from '../api/erp';
import {
    deleteClientContract,
    insertClientContracts,
    updateClientContract,
    type ClientContract,
    type ContractHistoryItem,
} from '../api/clientContracts';
import { ensureClientBlogAccount } from '../api/blogRank';
import { fmtWon } from '../components/blogRank/lib/helpers';
import { PRODUCT_CATEGORIES } from '../lib/products';
import { SOURCE_OPTIONS, todayStr } from '../lib/erpUtils';

// 고객사 상세 — 기본정보(클릭 편집) + 계약 내역(카테고리/세부유형별 건수 계약).
//   계약은 client_contracts 단일 출처. 등록 시(+계약 추가) 또는 여기서 '+ 계약 추가'로 생성.
function navTo(path: string) {
    if (window.location.pathname + window.location.search !== path) {
        window.history.pushState(null, '', path);
        window.dispatchEvent(new Event('app:navigate'));
    }
}

const progColor = (p: number | null) =>
    p == null ? '#94a3b8' : p >= 70 ? '#059669' : p >= 40 ? '#d97706' : '#dc2626';

const progOf = (ct: ClientContract): number | null => {
    if (ct.goal_count == null || ct.remain_count == null || ct.goal_count === 0) return null;
    return Math.round(((ct.goal_count - ct.remain_count) / ct.goal_count) * 100);
};

// 기본정보(담당자·문의경로·연락처·이메일) 클릭 편집 모달.
function ClientFieldModal({
    label,
    value,
    options,
    onSave,
    onClose,
}: {
    label: string;
    value: string;
    options?: string[];
    onSave: (v: string) => void;
    onClose: () => void;
}) {
    const [v, setV] = useState(value);
    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
            onMouseDown={(e) => e.target === e.currentTarget && onClose()}
        >
            <div className="w-[min(380px,94vw)] rounded-2xl bg-white p-6">
                <h3 className="m-0 text-lg font-bold">{label} 수정</h3>
                <div className="mt-4">
                    {options ? (
                        <select
                            className="h-10 w-full rounded-md border border-[#cbd5e1] bg-white px-3 text-sm font-medium text-[#0f172a]"
                            onChange={(e) => setV(e.target.value)}
                            value={v}
                        >
                            <option value="">선택 안 함</option>
                            {options.map((o) => (
                                <option key={o}>{o}</option>
                            ))}
                        </select>
                    ) : (
                        <input
                            autoFocus
                            className="h-10 w-full rounded-md border border-[#cbd5e1] px-3 text-sm font-medium text-[#0f172a]"
                            onChange={(e) => setV(e.target.value)}
                            placeholder="입력..."
                            value={v}
                        />
                    )}
                </div>
                <div className="mt-5 flex justify-end gap-2">
                    <button
                        className="rounded-md border border-[#cbd5e1] px-4 py-2 text-sm font-semibold text-[#64748b]"
                        onClick={onClose}
                        type="button"
                    >
                        취소
                    </button>
                    <button
                        className="rounded-md bg-[#1e40af] px-4 py-2 text-sm font-semibold text-white"
                        onClick={() => {
                            onSave(v.trim());
                            onClose();
                        }}
                        type="button"
                    >
                        저장
                    </button>
                </div>
            </div>
        </div>
    );
}

// 계약 추가 모달 — 카테고리 → 세부유형 → 건수·금액·계약일.
function ContractAddModal({
    clientId,
    companyName,
    managerName,
    onClose,
    onReload,
    onToast,
}: {
    clientId: string;
    companyName: string;
    managerName: string;
    onClose: () => void;
    onReload: () => Promise<void>;
    onToast: (m: string) => void;
}) {
    const [catKey, setCatKey] = useState(PRODUCT_CATEGORIES[0].key);
    const cat = PRODUCT_CATEGORIES.find((c) => c.key === catKey) ?? PRODUCT_CATEGORIES[0];
    const [subtype, setSubtype] = useState(cat.subs[0]);
    const [count, setCount] = useState('');
    const [amount, setAmount] = useState('');
    const [date, setDate] = useState('');
    const [saving, setSaving] = useState(false);

    const pickCat = (key: string) => {
        setCatKey(key);
        const c = PRODUCT_CATEGORIES.find((x) => x.key === key);
        if (c) setSubtype(c.subs[0]);
    };

    const submit = async () => {
        const n = count.trim() ? Number(count) : null;
        const amt = amount.trim() ? Number(amount) : null;
        if (!n && !amt) {
            onToast('건수 또는 금액을 입력하세요');
            return;
        }
        setSaving(true);
        const { error } = await insertClientContracts([
            {
                amount: amt || 0,
                category: cat.label,
                client_id: clientId,
                contract_date: date || null,
                goal_count: n,
                remain_count: n,
                subtype,
            },
        ]);
        setSaving(false);
        if (error) {
            onToast(`오류: ${error.message}`);
            return;
        }
        // 블로그 계약이면 블로그 관리 시트에도 자동 등록.
        if (cat.label === '블로그') {
            await ensureClientBlogAccount(clientId, companyName || '업체', {
                amount: amt || null,
                contract_date: date || null,
                goal_count: n,
                manager: managerName || null,
                remain_count: n,
            });
        }
        await onReload();
        onToast('계약 추가 완료');
        onClose();
    };

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
            onMouseDown={(e) => e.target === e.currentTarget && onClose()}
        >
            <div className="w-[min(440px,94vw)] rounded-2xl bg-white p-6">
                <h3 className="m-0 mb-4 text-lg font-bold">+ 계약 추가</h3>
                <div className="grid gap-3">
                    <label className="block text-xs font-semibold text-[#475569]">
                        카테고리
                        <div className="mt-1 flex flex-wrap gap-1.5">
                            {PRODUCT_CATEGORIES.map((c) => (
                                <button
                                    className={`rounded-md border px-3 py-1.5 text-xs font-semibold ${
                                        catKey === c.key
                                            ? 'border-[#1e40af] bg-[#1e40af] text-white'
                                            : 'border-[#cbd5e1] bg-white text-[#475569]'
                                    }`}
                                    key={c.key}
                                    onClick={() => pickCat(c.key)}
                                    type="button"
                                >
                                    {c.label}
                                </button>
                            ))}
                        </div>
                    </label>
                    <label className="block text-xs font-semibold text-[#475569]">
                        세부유형
                        <select
                            className="mt-1 h-10 w-full rounded-md border border-[#cbd5e1] bg-white px-3 text-sm"
                            onChange={(e) => setSubtype(e.target.value)}
                            value={subtype}
                        >
                            {cat.subs.map((s) => (
                                <option key={s}>{s}</option>
                            ))}
                        </select>
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                        <label className="block text-xs font-semibold text-[#475569]">
                            계약 건수
                            <input
                                className="mt-1 h-10 w-full rounded-md border border-[#cbd5e1] px-3 text-sm"
                                onChange={(e) => setCount(e.target.value)}
                                placeholder="예: 30"
                                type="number"
                                value={count}
                            />
                        </label>
                        <label className="block text-xs font-semibold text-[#475569]">
                            금액(원)
                            <input
                                className="mt-1 h-10 w-full rounded-md border border-[#cbd5e1] px-3 text-sm"
                                onChange={(e) => setAmount(e.target.value)}
                                placeholder="예: 500000"
                                type="number"
                                value={amount}
                            />
                        </label>
                    </div>
                    <label className="block text-xs font-semibold text-[#475569]">
                        계약일
                        <input
                            className="mt-1 h-10 w-full rounded-md border border-[#cbd5e1] px-3 text-sm"
                            onChange={(e) => setDate(e.target.value)}
                            placeholder="2026-01-15"
                            value={date}
                        />
                    </label>
                </div>
                <div className="mt-5 flex justify-end gap-2">
                    <button
                        className="rounded-md border border-[#cbd5e1] px-4 py-2 text-sm font-semibold text-[#64748b]"
                        onClick={onClose}
                        type="button"
                    >
                        취소
                    </button>
                    <button
                        className="rounded-md bg-[#1e40af] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                        disabled={saving}
                        onClick={() => void submit()}
                        type="button"
                    >
                        {saving ? '저장 중…' : '추가'}
                    </button>
                </div>
            </div>
        </div>
    );
}

// 계약 수정/재계약/삭제 모달.
//   잔여 5건 이하이면 편집 필드 숨기고 재계약/계약 종료 노출 + 계약 이력(최초 계약) 표시.
//   재계약 클릭 시 블로그 시트의 '계약' 창처럼 현재 계약 + 계약 추가(시작일·건수) UI.
function ContractEditModal({
    contract,
    onClose,
    onReload,
    onToast,
    onEnd,
}: {
    contract: ClientContract;
    onClose: () => void;
    onReload: () => Promise<void>;
    onToast: (m: string) => void;
    onEnd: () => void; // 계약 종료 → 업체를 '계약 종료' 탭으로(상태 변경, 삭제 아님)
}) {
    const [goal] = useState(contract.goal_count?.toString() ?? '');
    const [remain, setRemain] = useState(contract.remain_count?.toString() ?? '');
    const [amount] = useState(contract.amount?.toString() ?? '');
    const [date] = useState(contract.contract_date ?? '');
    const [note, setNote] = useState(contract.note ?? '');
    const [saving, setSaving] = useState(false);
    const [confirmDel, setConfirmDel] = useState(false);
    const [renewMode, setRenewMode] = useState(false); // 재계약 클릭 → 계약 추가 UI
    const [reStart, setReStart] = useState('');
    const [reCount, setReCount] = useState('');
    const [reAmount, setReAmount] = useState('');
    const [noteView, setNoteView] = useState<string | null>(null); // 히스토리 특이사항 보기

    const [history, setHistory] = useState<ContractHistoryItem[]>(contract.history ?? []);
    const goalN = Number(goal) || 0;
    const remainN = Number(remain) || 0;
    const hasGoal = goal.trim() !== '';
    const done = Math.max(0, goalN - remainN);
    const pct = goalN ? Math.round((done / goalN) * 100) : 0;
    const imminent = hasGoal && remainN <= 5; // 잔여 5건 이하 → 재계약/종료(필드 숨김)

    // 계약 이력 표시용: 과거(history) + 현재 계약. 0번=최초, 나머지=재N, 마지막=현재.
    const periods = [
        ...history,
        {
            amount: Number(amount) || 0,
            at: date || '',
            contract_date: date || null,
            goal_count: hasGoal ? goalN : null,
            note: note || null,
            remain_count: remainN,
        } as ContractHistoryItem,
    ];

    // +1건 완료 / 되돌리기 — 잔여를 바로 저장(진행률 자동 반영).
    const quick = async (delta: number) => {
        if (saving || !hasGoal) return;
        const next = Math.max(0, Math.min(goalN, remainN - delta));
        if (next === remainN) return;
        setRemain(String(next));
        setSaving(true);
        const { error } = await updateClientContract(contract.id, { remain_count: next });
        setSaving(false);
        if (error) {
            onToast(`오류: ${error.message}`);
            setRemain(String(remainN));
            return;
        }
        await onReload();
    };

    // 재계약 = 현재 계약을 이력으로 넣고, 기존 진행분은 유지한 채 건수 누적(예: 2/5 + 5건 → 2/10).
    const addRenewal = async () => {
        const s = reStart.trim();
        const n = Number(reCount);
        if (!s || !n || n <= 0) {
            onToast('계약 시작일과 계약 건수를 입력하세요');
            return;
        }
        const newHistory: ContractHistoryItem[] = [
            ...history,
            {
                amount: Number(amount) || 0,
                at: new Date().toISOString().slice(0, 10),
                contract_date: date || null,
                goal_count: hasGoal ? goalN : null,
                note: note || null,
                remain_count: remainN,
            },
        ];
        const nextGoal = goalN + n; // 기존 건수 + 재계약 건수(누적)
        const nextRemain = remainN + n; // 진행분(done) 유지 → 잔여만 증가
        const nextAmount = (Number(amount) || 0) + (reAmount.trim() ? Number(reAmount) : 0); // 금액 누적
        setSaving(true);
        const { error } = await updateClientContract(contract.id, {
            amount: nextAmount,
            contract_date: s,
            goal_count: nextGoal,
            history: newHistory,
            remain_count: nextRemain,
        });
        setSaving(false);
        if (error) {
            onToast(`오류: ${error.message}`);
            return;
        }
        onToast(`재계약 — ${n}건 추가 (총 ${nextGoal}건 · ${fmtWon(nextAmount)}원)`);
        await onReload();
        onClose();
    };

    // 계약 이력에서 재계약 항목 삭제(최초 계약·현재는 불가).
    const deleteHistoryEntry = async (i: number) => {
        const newHistory = history.filter((_, j) => j !== i);
        setSaving(true);
        const { error } = await updateClientContract(contract.id, { history: newHistory });
        setSaving(false);
        if (error) {
            onToast(`오류: ${error.message}`);
            return;
        }
        setHistory(newHistory);
        onToast('재계약 이력 삭제됨');
        await onReload();
    };

    const save = async () => {
        setSaving(true);
        const { error } = await updateClientContract(contract.id, {
            amount: amount.trim() ? Number(amount) : 0,
            contract_date: date || null,
            goal_count: goal.trim() ? Number(goal) : null,
            note: note.trim() || null,
            remain_count: remain.trim() ? Number(remain) : null,
        });
        setSaving(false);
        if (error) {
            onToast(`오류: ${error.message}`);
            return;
        }
        await onReload();
        onToast('계약 수정 완료');
        onClose();
    };

    const remove = async () => {
        const { error } = await deleteClientContract(contract.id);
        if (error) {
            onToast(`오류: ${error.message}`);
            return;
        }
        await onReload();
        onToast('계약 삭제됨');
        onClose();
    };

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
            onMouseDown={(e) => e.target === e.currentTarget && onClose()}
        >
            <div className="max-h-[92vh] w-[min(440px,94vw)] overflow-y-auto rounded-2xl bg-white p-6">
                <h3 className="m-0 text-lg font-bold">
                    {contract.category} · {contract.subtype}
                </h3>

                {/* 진행률 — 1건 완료로 잔여 감소(자동 반영) */}
                {hasGoal ? (
                    <div className="my-3 rounded-lg border border-[#e2e8f0] bg-[#f8fafc] px-4 py-3 text-center">
                        <div className="text-3xl font-bold" style={{ color: progColor(pct) }}>
                            {pct}%
                        </div>
                        <div className="mt-1 text-sm text-[#475569]">
                            발행 <b>{done}</b> / 계약 {goalN}건 · 잔여 <b>{remainN}</b>건
                        </div>
                        <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#eef2f7]">
                            <div style={{ background: progColor(pct), height: '100%', width: `${pct}%` }} />
                        </div>
                        <div className="mt-2 flex gap-2">
                            <button
                                className="flex-1 rounded-md bg-[#059669] px-4 py-2 text-sm font-bold text-white hover:bg-[#047857] disabled:opacity-50"
                                disabled={saving || remainN <= 0}
                                onClick={() => void quick(1)}
                                type="button"
                            >
                                + 1건 완료
                            </button>
                            <button
                                className="rounded-md border border-[#cbd5e1] px-3 py-2 text-sm font-semibold text-[#475569] hover:bg-[#f1f5f9] disabled:opacity-50"
                                disabled={saving || remainN >= goalN}
                                onClick={() => void quick(-1)}
                                type="button"
                            >
                                되돌리기
                            </button>
                        </div>
                    </div>
                ) : null}

                {imminent ? (
                    /* 잔여 5건 이하 — 편집 필드 숨김. 재계약/계약 종료 + 계약 이력. */
                    <div className="mb-1 flex flex-col gap-2 border-t border-[#e2e8f0] pt-3">
                        {renewMode ? (
                            <>
                                {/* 현재 계약 */}
                                <div className="rounded-lg border border-[#e2e8f0] bg-[#f8fafc] px-4 py-3">
                                    <div className="text-xs font-semibold text-[#64748b]">현재 계약</div>
                                    <div className="text-base font-bold text-[#1e40af]">
                                        {date || '-'} <span className="text-[#94a3b8]">·</span> 계약{' '}
                                        {hasGoal ? goalN : '—'}건
                                    </div>
                                    <div className="mt-0.5 text-[11px] text-[#94a3b8]">총 {periods.length}차 계약</div>
                                </div>
                                {/* 계약 추가 (시작일 · 건수 · 금액) */}
                                <div>
                                    <div className="mb-1 text-xs font-bold text-[#334155]">
                                        계약 추가 (시작일 · 계약 건수 · 금액)
                                    </div>
                                    <input
                                        className="mb-2 h-9 w-full rounded-md border border-[#cbd5e1] bg-white px-2 text-sm"
                                        onChange={(e) => setReStart(e.target.value)}
                                        placeholder="계약 시작일 (예: 2026-01-15)"
                                        value={reStart}
                                    />
                                    <div className="flex gap-2">
                                        <input
                                            className="h-9 w-[90px] rounded-md border border-[#cbd5e1] bg-white px-2 text-sm"
                                            min="1"
                                            onChange={(e) => setReCount(e.target.value)}
                                            placeholder="건수"
                                            type="number"
                                            value={reCount}
                                        />
                                        <input
                                            className="h-9 flex-1 rounded-md border border-[#cbd5e1] bg-white px-2 text-sm"
                                            onChange={(e) => setReAmount(e.target.value)}
                                            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), void addRenewal())}
                                            placeholder="금액(원)"
                                            type="number"
                                            value={reAmount}
                                        />
                                    </div>
                                    <p className="mt-1 text-[11px] text-[#94a3b8]">
                                        아래 <b>계약</b> 버튼을 누르면 재계약이 저장됩니다.
                                    </p>
                                    <button
                                        className="mt-2 text-xs font-semibold text-[#64748b] hover:text-[#475569]"
                                        onClick={() => setRenewMode(false)}
                                        type="button"
                                    >
                                        ← 취소
                                    </button>
                                </div>
                            </>
                        ) : (
                            <>
                                <button
                                    className="w-full rounded-md bg-[#059669] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#047857]"
                                    onClick={() => setRenewMode(true)}
                                    type="button"
                                >
                                    재계약 (새 계약 시작)
                                </button>
                                <button
                                    className="w-full rounded-md bg-[#dc2626] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#b91c1c]"
                                    onClick={onEnd}
                                    type="button"
                                >
                                    계약 종료
                                </button>
                            </>
                        )}
                    </div>
                ) : null}

                {/* 특이사항만 편집 — 계약 건수/잔여/금액/계약일은 아래 계약 이력으로만 표시(수정은 재계약으로) */}
                <label className="mt-3 block text-xs font-semibold text-[#475569]">
                    특이사항
                    <textarea
                        className="mt-1 w-full rounded-md border border-[#cbd5e1] px-3 py-2 text-sm"
                        onChange={(e) => setNote(e.target.value)}
                        rows={2}
                        value={note}
                    />
                </label>

                {/* 계약 이력 — 최초 계약 + 재N (마지막=현재). 항상 표시. */}
                {periods.length ? (
                    <div className="mt-3 border-t border-[#e2e8f0] pt-3">
                        <div className="mb-1.5 text-xs font-bold text-[#334155]">계약 이력</div>
                        <div className="grid max-h-[26vh] gap-1 overflow-y-auto">
                            {periods.map((p, i) => {
                                const isCurrent = i === periods.length - 1;
                                const isFirst = i === 0;
                                return (
                                    <div
                                        className="flex items-center gap-1.5 rounded-md border border-[#eef2f7] bg-[#f8fafc] px-2.5 py-1.5 text-xs text-[#475569]"
                                        key={i}
                                    >
                                        <span
                                            className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${
                                                isFirst ? 'bg-[#dbeafe] text-[#1e40af]' : 'bg-[#f1f5f9] text-[#475569]'
                                            }`}
                                        >
                                            {isFirst ? '최초 계약' : `재${i}`}
                                        </span>
                                        <span className="font-semibold">
                                            {p.contract_date || p.at || '-'} · 계약 {p.goal_count ?? '—'}건
                                        </span>
                                        {/* 이월 = 이 계약에서 다음 계약으로 넘어간 잔여 건수 */}
                                        {!isCurrent ? (
                                            <span className="shrink-0 rounded bg-[#fef3c7] px-1.5 py-0.5 text-[10px] font-bold text-[#b45309]">
                                                {p.remain_count ?? 0}건 이월
                                            </span>
                                        ) : null}
                                        <span className="ml-auto">{p.amount ? `${fmtWon(p.amount)}원` : ''}</span>
                                        {p.note ? (
                                            <button
                                                className="shrink-0 rounded border border-[#cbd5e1] px-1.5 py-0.5 text-[10px] font-semibold text-[#475569] hover:border-[#1e40af] hover:text-[#1e40af]"
                                                onClick={() => setNoteView(p.note || '')}
                                                title="특이사항 보기"
                                                type="button"
                                            >
                                                특이사항
                                            </button>
                                        ) : null}
                                        {isCurrent ? (
                                            <span className="shrink-0 rounded bg-[#dcfce7] px-1.5 py-0.5 text-[10px] font-bold text-[#16a34a]">
                                                현재
                                            </span>
                                        ) : null}
                                        {/* 재계약 항목만 삭제(최초·현재는 불가) */}
                                        {!isFirst && !isCurrent ? (
                                            <button
                                                className="shrink-0 rounded border border-[#fca5a5] px-1.5 py-0.5 text-[10px] font-bold text-[#dc2626] hover:bg-[#fef2f2] disabled:opacity-50"
                                                disabled={saving}
                                                onClick={() => void deleteHistoryEntry(i)}
                                                title="재계약 이력 삭제"
                                                type="button"
                                            >
                                                ✕
                                            </button>
                                        ) : null}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                ) : null}

                <div className="mt-5 flex items-center gap-2">
                    {confirmDel ? (
                        <>
                            <span className="text-sm font-semibold text-[#dc2626]">삭제할까요?</span>
                            <button
                                className="rounded-md bg-[#dc2626] px-3 py-2 text-sm font-semibold text-white"
                                onClick={() => void remove()}
                                type="button"
                            >
                                삭제
                            </button>
                            <button
                                className="rounded-md border border-[#cbd5e1] px-3 py-2 text-sm font-semibold text-[#475569]"
                                onClick={() => setConfirmDel(false)}
                                type="button"
                            >
                                취소
                            </button>
                        </>
                    ) : (
                        <button
                            className="rounded-md border border-[#fca5a5] bg-white px-3 py-2 text-sm font-semibold text-[#dc2626]"
                            onClick={() => setConfirmDel(true)}
                            type="button"
                        >
                            삭제
                        </button>
                    )}
                    <div className="flex-1" />
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
                        onClick={() => void (renewMode ? addRenewal() : save())}
                        type="button"
                    >
                        {saving ? '저장 중…' : renewMode ? '계약' : '저장'}
                    </button>
                </div>

                {/* 특이사항 보기 팝업 */}
                {noteView !== null ? (
                    <div
                        className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
                        onMouseDown={(e) => e.target === e.currentTarget && setNoteView(null)}
                    >
                        <div className="w-[min(360px,92vw)] rounded-xl bg-white p-5 shadow-xl">
                            <h4 className="m-0 text-sm font-bold text-[#0f172a]">특이사항</h4>
                            <p className="mt-2 whitespace-pre-wrap text-sm text-[#475569]">
                                {noteView || '(내용 없음)'}
                            </p>
                            <div className="mt-4 flex justify-end">
                                <button
                                    className="rounded-md border border-[#cbd5e1] px-4 py-2 text-sm font-semibold text-[#64748b]"
                                    onClick={() => setNoteView(null)}
                                    type="button"
                                >
                                    닫기
                                </button>
                            </div>
                        </div>
                    </div>
                ) : null}
            </div>
        </div>
    );
}

export function ClientDetail({
    client,
    contracts,
    salespeople,
    onClose,
    onSave,
    onDelete,
    onReloadContracts,
    onToast,
}: {
    client: ErpClient;
    contracts: ClientContract[];
    salespeople: { id: string; name: string }[];
    onClose: () => void;
    onSave: (patch: Partial<ErpClient>) => void;
    onDelete: () => void;
    onReloadContracts: () => Promise<void>;
    onToast: (message: string) => void;
}) {
    const [confirmDel, setConfirmDel] = useState(false);
    const [editField, setEditField] = useState<{
        patchKey: 'manager' | 'source' | 'contact' | 'email';
        label: string;
        value: string;
        options?: string[];
    } | null>(null);
    const [addOpen, setAddOpen] = useState(false);
    const [editContract, setEditContract] = useState<ClientContract | null>(null);
    const [endOpen, setEndOpen] = useState(false); // 상단 계약 종료 모달(히스토리 입력)
    const [endNote, setEndNote] = useState('');

    // 계약 종료 = 업체 상태를 '계약종료'로(계약 종료 탭으로 이동, 계약행은 보존) → 목록으로.
    const endClient = () => {
        onSave({ status: '계약종료' });
        setEditContract(null);
        onClose();
    };
    // 상단 계약 종료 — 히스토리(사유)까지 남기고 종료.
    const confirmEnd = () => {
        const prev = Array.isArray(client.history) ? client.history : [];
        onSave({
            history: [{ date: todayStr(), text: endNote.trim() || '계약 종료' }, ...prev],
            status: '계약종료',
        });
        setEndOpen(false);
        onClose();
    };

    const managerOptions = [
        ...new Set(([client.manager, ...salespeople.map((s) => s.name)].filter(Boolean) as string[])),
    ];

    // 카테고리별 합계 + 총액.
    const catAmount = (label: string) =>
        contracts.filter((ct) => ct.category === label).reduce((s, ct) => s + (ct.amount || 0), 0);
    const totalAmount = contracts.reduce((s, ct) => s + (ct.amount || 0), 0);
    // 계약이 있는 카테고리(상품)만, 부모 순서로 — 상품별 섹션으로 나눠 표시.
    const activeCats = PRODUCT_CATEGORIES.filter((c) => contracts.some((ct) => ct.category === c.label));

    return (
        <section className="grid gap-4">
            <div className="flex items-center gap-3">
                <button
                    className="flex items-center gap-1 rounded-md border border-[#cbd5e1] bg-white px-3 py-1.5 text-sm font-semibold text-[#475569] hover:bg-[#f1f5f9]"
                    onClick={onClose}
                    type="button"
                >
                    <svg
                        fill="none"
                        height="14"
                        stroke="currentColor"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2.5"
                        viewBox="0 0 24 24"
                        width="14"
                    >
                        <polyline points="15 18 9 12 15 6" />
                    </svg>
                    목록으로
                </button>
                <h2 className="m-0 text-[22px] font-semibold text-[#0f172a]">{client.company || '고객사'}</h2>
                <div className="flex-1" />
                {!confirmDel && client.status !== '계약종료' ? (
                    <button
                        className="rounded-md border border-[#cbd5e1] bg-white px-3 py-1.5 text-sm font-semibold text-[#475569] hover:bg-[#f1f5f9]"
                        onClick={() => {
                            setEndNote('');
                            setEndOpen(true);
                        }}
                        type="button"
                    >
                        계약 종료
                    </button>
                ) : null}
                {confirmDel ? (
                    <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-[#dc2626]">정말 삭제할까요?</span>
                        <button
                            className="rounded-md bg-[#dc2626] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#b91c1c]"
                            onClick={onDelete}
                            type="button"
                        >
                            삭제
                        </button>
                        <button
                            className="rounded-md border border-[#cbd5e1] bg-white px-3 py-1.5 text-sm font-semibold text-[#475569] hover:bg-[#f1f5f9]"
                            onClick={() => setConfirmDel(false)}
                            type="button"
                        >
                            취소
                        </button>
                    </div>
                ) : (
                    <button
                        className="rounded-md border border-[#fca5a5] bg-white px-3 py-1.5 text-sm font-semibold text-[#dc2626] hover:bg-[#fef2f2]"
                        onClick={() => setConfirmDel(true)}
                        type="button"
                    >
                        삭제
                    </button>
                )}
            </div>

            {/* 누적 계약 금액 — 총액 + 6개 카테고리별 */}
            <div className="rounded-xl border border-[#e2e8f0] bg-white px-5 py-4 shadow-sm">
                <div className="text-xs font-semibold text-[#94a3b8]">총 계약 금액 (누적)</div>
                <div className="mt-1 text-3xl font-bold text-[#1e40af]">{fmtWon(totalAmount)}원</div>
            </div>
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
                {PRODUCT_CATEGORIES.map((c) => (
                    <div
                        className="rounded-xl border border-[#e2e8f0] bg-white px-3 py-3 text-center shadow-sm"
                        key={c.key}
                    >
                        <div className="text-[11px] font-semibold text-[#94a3b8]">{c.label}</div>
                        <div className="mt-1 text-sm font-bold text-[#0f172a]">{fmtWon(catAmount(c.label))}원</div>
                    </div>
                ))}
            </div>

            {/* 계약 내역 — 카테고리별 세부유형(건수·진행률·금액) */}
            <div className="flex items-center gap-2">
                <h3 className="m-0 text-base font-bold text-[#0f172a]">계약 내역</h3>
                <button
                    className="rounded-md bg-[#1e40af] px-3 py-1 text-xs font-semibold text-white hover:bg-[#1e3a8a]"
                    onClick={() => setAddOpen(true)}
                    type="button"
                >
                    + 계약 추가
                </button>
            </div>

            {activeCats.length ? (
                activeCats.map((c) => {
                    const dashPath = c.path;
                    return (
                        <div key={c.key}>
                            <div className="mb-2 flex items-center gap-2">
                                <span className="rounded-full bg-[#e0e7ff] px-2.5 py-0.5 text-xs font-bold text-[#4338ca]">
                                    {c.label}
                                </span>
                                <button
                                    className="rounded border border-[#cbd5e1] bg-white px-2 py-0.5 text-[10px] font-semibold text-[#475569] hover:border-[#1e40af] hover:text-[#1e40af]"
                                    onClick={() =>
                                        navTo(
                                            `${dashPath}?tab=sheet&q=${encodeURIComponent(client.company || '')}`,
                                        )
                                    }
                                    type="button"
                                >
                                    관리 시트 →
                                </button>
                            </div>
                            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                                {contracts
                                    .filter((ct) => ct.category === c.label)
                                    .map((ct) => {
                                        const prog = progOf(ct);
                                        const done = (ct.goal_count || 0) - (ct.remain_count || 0);
                                        return (
                                            <button
                                                className="rounded-lg border-2 border-[#e2e8f0] bg-white px-4 py-3 text-left shadow-sm transition hover:border-[#1e40af] hover:shadow-md"
                                                key={ct.id}
                                                onClick={() => setEditContract(ct)}
                                                type="button"
                                            >
                                                <div className="truncate text-xs font-bold text-[#334155]">
                                                    {ct.subtype}
                                                </div>
                                                <div
                                                    className="mt-0.5 text-2xl font-bold"
                                                    style={{ color: progColor(prog) }}
                                                >
                                                    {prog != null
                                                        ? `${prog}%`
                                                        : ct.goal_count != null
                                                          ? `${ct.goal_count}건`
                                                          : '-'}
                                                </div>
                                                {prog != null ? (
                                                    <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-[#e2e8f0]">
                                                        <div
                                                            className="h-full rounded-full"
                                                            style={{
                                                                background: progColor(prog),
                                                                width: `${Math.min(100, Math.max(0, prog))}%`,
                                                            }}
                                                        />
                                                    </div>
                                                ) : null}
                                                <div className="mt-1 text-[11px] font-semibold text-[#64748b]">
                                                    {ct.goal_count != null
                                                        ? `${done}/${ct.goal_count}건`
                                                        : '건수 미입력'}
                                                    {ct.amount ? ` · ${fmtWon(ct.amount)}원` : ''}
                                                </div>
                                            </button>
                                        );
                                    })}
                            </div>
                        </div>
                    );
                })
            ) : (
                <div className="rounded-xl border border-dashed border-[#cbd5e1] bg-[#f8fafc] px-5 py-10 text-center text-sm text-[#94a3b8]">
                    등록된 계약이 없습니다. ‘+ 계약 추가’로 등록하세요.
                </div>
            )}

            {/* 기본 정보 — 누르면 모달에서 변경 */}
            <h3 className="m-0 mt-2 text-base font-bold text-[#0f172a]">기본 정보</h3>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {(
                    [
                        { key: 'manager', label: '담당자', value: client.manager || '', options: managerOptions },
                        { key: 'source', label: '문의 경로', value: client.source || '', options: SOURCE_OPTIONS },
                        { key: 'contact', label: '연락처', value: client.contact || '' },
                        { key: 'email', label: '이메일', value: client.email || '' },
                    ] as {
                        key: 'manager' | 'source' | 'contact' | 'email';
                        label: string;
                        value: string;
                        options?: string[];
                    }[]
                ).map((f) => (
                    <button
                        className="rounded-lg border border-[#e2e8f0] bg-white px-3 py-2.5 text-left shadow-sm hover:border-[#1e40af]"
                        key={f.key}
                        onClick={() => setEditField({ label: f.label, options: f.options, patchKey: f.key, value: f.value })}
                        type="button"
                    >
                        <div className="text-[11px] font-semibold text-[#94a3b8]">{f.label}</div>
                        <div className="mt-0.5 truncate text-sm font-medium text-[#0f172a]">{f.value || '-'}</div>
                    </button>
                ))}
            </div>

            {addOpen ? (
                <ContractAddModal
                    clientId={client.id}
                    companyName={client.company || ''}
                    managerName={client.manager || ''}
                    onClose={() => setAddOpen(false)}
                    onReload={onReloadContracts}
                    onToast={onToast}
                />
            ) : null}
            {editContract ? (
                <ContractEditModal
                    contract={editContract}
                    onClose={() => setEditContract(null)}
                    onEnd={endClient}
                    onReload={onReloadContracts}
                    onToast={onToast}
                />
            ) : null}
            {editField ? (
                <ClientFieldModal
                    label={editField.label}
                    onClose={() => setEditField(null)}
                    onSave={(v) => onSave({ [editField.patchKey]: v || null } as Partial<ErpClient>)}
                    options={editField.options}
                    value={editField.value}
                />
            ) : null}
            {endOpen ? (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
                    onMouseDown={(e) => e.target === e.currentTarget && setEndOpen(false)}
                >
                    <div className="w-[min(420px,94vw)] rounded-2xl bg-white p-6">
                        <h3 className="m-0 text-lg font-bold">{client.company || '고객사'} · 계약 종료</h3>
                        <p className="mt-1 mb-3 text-sm text-[#64748b]">
                            ‘계약 종료’ 탭으로 이동합니다(삭제 아님). 히스토리에 사유를 남겨두세요.
                        </p>
                        <label className="block text-xs font-semibold text-[#475569]">
                            히스토리 (종료 사유)
                            <textarea
                                autoFocus
                                className="mt-1 w-full rounded-md border border-[#cbd5e1] px-3 py-2 text-sm"
                                onChange={(e) => setEndNote(e.target.value)}
                                placeholder="예: 계약 만료 · 재계약 미진행"
                                rows={3}
                                value={endNote}
                            />
                        </label>
                        <div className="mt-4 flex justify-end gap-2">
                            <button
                                className="rounded-md border border-[#cbd5e1] px-4 py-2 text-sm font-semibold text-[#64748b]"
                                onClick={() => setEndOpen(false)}
                                type="button"
                            >
                                취소
                            </button>
                            <button
                                className="rounded-md bg-[#dc2626] px-4 py-2 text-sm font-semibold text-white hover:bg-[#b91c1c]"
                                onClick={confirmEnd}
                                type="button"
                            >
                                계약 종료
                            </button>
                        </div>
                    </div>
                </div>
            ) : null}
        </section>
    );
}
