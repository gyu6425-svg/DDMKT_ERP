import { useState } from 'react';
import type { ErpClient } from '../api/erp';
import {
    deleteClientContract,
    insertClientContracts,
    updateClientContract,
    type ClientContract,
} from '../api/clientContracts';
import { fmtWon } from '../components/blogRank/lib/helpers';
import { PRODUCT_CATEGORIES, categoryByLabel } from '../lib/products';
import { SOURCE_OPTIONS } from '../lib/erpUtils';

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
    onClose,
    onReload,
    onToast,
}: {
    clientId: string;
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

// 계약 수정/삭제 모달.
function ContractEditModal({
    contract,
    onClose,
    onReload,
    onToast,
}: {
    contract: ClientContract;
    onClose: () => void;
    onReload: () => Promise<void>;
    onToast: (m: string) => void;
}) {
    const [goal, setGoal] = useState(contract.goal_count?.toString() ?? '');
    const [remain, setRemain] = useState(contract.remain_count?.toString() ?? '');
    const [amount, setAmount] = useState(contract.amount?.toString() ?? '');
    const [date, setDate] = useState(contract.contract_date ?? '');
    const [note, setNote] = useState(contract.note ?? '');
    const [saving, setSaving] = useState(false);
    const [confirmDel, setConfirmDel] = useState(false);

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
            <div className="w-[min(440px,94vw)] rounded-2xl bg-white p-6">
                <h3 className="m-0 text-lg font-bold">
                    {contract.category} · {contract.subtype}
                </h3>
                <p className="mt-1 mb-4 text-sm text-[#64748b]">계약 수정</p>
                <div className="grid gap-3">
                    <div className="grid grid-cols-2 gap-3">
                        <label className="block text-xs font-semibold text-[#475569]">
                            계약 건수
                            <input
                                className="mt-1 h-10 w-full rounded-md border border-[#cbd5e1] px-3 text-sm"
                                onChange={(e) => setGoal(e.target.value)}
                                type="number"
                                value={goal}
                            />
                        </label>
                        <label className="block text-xs font-semibold text-[#475569]">
                            잔여 건수
                            <input
                                className="mt-1 h-10 w-full rounded-md border border-[#cbd5e1] px-3 text-sm"
                                onChange={(e) => setRemain(e.target.value)}
                                type="number"
                                value={remain}
                            />
                        </label>
                    </div>
                    <label className="block text-xs font-semibold text-[#475569]">
                        금액(원)
                        <input
                            className="mt-1 h-10 w-full rounded-md border border-[#cbd5e1] px-3 text-sm"
                            onChange={(e) => setAmount(e.target.value)}
                            type="number"
                            value={amount}
                        />
                    </label>
                    <label className="block text-xs font-semibold text-[#475569]">
                        계약일
                        <input
                            className="mt-1 h-10 w-full rounded-md border border-[#cbd5e1] px-3 text-sm"
                            onChange={(e) => setDate(e.target.value)}
                            placeholder="2026-01-15"
                            value={date}
                        />
                    </label>
                    <label className="block text-xs font-semibold text-[#475569]">
                        특이사항
                        <textarea
                            className="mt-1 w-full rounded-md border border-[#cbd5e1] px-3 py-2 text-sm"
                            onChange={(e) => setNote(e.target.value)}
                            rows={2}
                            value={note}
                        />
                    </label>
                </div>
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

    const managerOptions = [
        ...new Set(([client.manager, ...salespeople.map((s) => s.name)].filter(Boolean) as string[])),
    ];

    // 카테고리별 합계 + 총액.
    const catAmount = (label: string) =>
        contracts.filter((ct) => ct.category === label).reduce((s, ct) => s + (ct.amount || 0), 0);
    const totalAmount = contracts.reduce((s, ct) => s + (ct.amount || 0), 0);
    // 카테고리 부모 순서로 정렬해 한 줄에 옆으로 흐르게(같은 카테고리끼리 인접).
    const catOrder = (label: string) => {
        const i = PRODUCT_CATEGORIES.findIndex((c) => c.label === label);
        return i === -1 ? 99 : i;
    };
    const sortedContracts = [...contracts].sort((a, b) => catOrder(a.category) - catOrder(b.category));

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

            {sortedContracts.length ? (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                    {sortedContracts.map((ct) => {
                        const prog = progOf(ct);
                        const done = (ct.goal_count || 0) - (ct.remain_count || 0);
                        const dashPath = categoryByLabel(ct.category)?.path;
                        return (
                            <div
                                className="relative cursor-pointer rounded-lg border-2 border-[#e2e8f0] bg-white px-4 py-3 text-left shadow-sm transition hover:border-[#1e40af] hover:shadow-md"
                                key={ct.id}
                                onClick={() => setEditContract(ct)}
                            >
                                {dashPath ? (
                                    <button
                                        className="absolute right-1.5 top-1.5 rounded border border-[#cbd5e1] bg-white px-1.5 py-0.5 text-[10px] font-semibold text-[#475569] hover:border-[#1e40af] hover:text-[#1e40af]"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            navTo(dashPath);
                                        }}
                                        title={`${ct.category} 대시보드로 이동`}
                                        type="button"
                                    >
                                        대시보드 →
                                    </button>
                                ) : null}
                                <div className="truncate text-[10px] font-bold text-[#1e40af]">{ct.category}</div>
                                <div className="truncate pr-14 text-xs font-bold text-[#334155]">{ct.subtype}</div>
                                <div className="mt-0.5 text-2xl font-bold" style={{ color: progColor(prog) }}>
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
                                    {ct.goal_count != null ? `${done}/${ct.goal_count}건` : '건수 미입력'}
                                    {ct.amount ? ` · ${fmtWon(ct.amount)}원` : ''}
                                </div>
                            </div>
                        );
                    })}
                </div>
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
                    onClose={() => setAddOpen(false)}
                    onReload={onReloadContracts}
                    onToast={onToast}
                />
            ) : null}
            {editContract ? (
                <ContractEditModal
                    contract={editContract}
                    onClose={() => setEditContract(null)}
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
        </section>
    );
}
