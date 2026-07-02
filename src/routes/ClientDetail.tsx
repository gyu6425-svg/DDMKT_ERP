import { useState } from 'react';
import type { ErpClient } from '../api/erp';
import {
    deleteClientContract,
    insertClientContracts,
    updateClientContract,
    type ClientContract,
    type ContractHistoryItem,
    type RewardWeeklyLog,
} from '../api/clientContracts';
import { ensureClientBlogAccount } from '../api/blogRank';
import { fmtWon } from '../components/blogRank/lib/helpers';
import { PRODUCT_CATEGORIES, isDailySub } from '../lib/products';
import { INDUSTRY_OPTIONS, SOURCE_OPTIONS, todayStr } from '../lib/erpUtils';

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

// 숫자 입력 포맷 — 저장은 숫자만, 표시는 천단위 콤마(2000 → 2,000).
const onlyDigits = (s: string) => s.replace(/[^\d]/g, '');
const withCommas = (s: string) => (onlyDigits(s) ? Number(onlyDigits(s)).toLocaleString('ko-KR') : '');
// 사업자등록번호 3-2-5 하이픈 자동.
const formatBizNo = (s: string) => {
    const d = onlyDigits(s).slice(0, 10);
    if (d.length <= 3) return d;
    if (d.length <= 5) return `${d.slice(0, 3)}-${d.slice(3)}`;
    return `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}`;
};

// 기본정보/업종정보 카드 필드.
type FieldDef = {
    key:
        | 'manager'
        | 'source'
        | 'contact'
        | 'email'
        | 'business_number'
        | 'address'
        | 'industry'
        | 'url'
        | 'client_partner';
    label: string;
    value: string;
    options?: string[];
    format?: (v: string) => string;
};

const progOf = (ct: ClientContract): number | null => {
    if (ct.goal_count == null || ct.remain_count == null || ct.goal_count === 0) return null;
    return Math.round(((ct.goal_count - ct.remain_count) / ct.goal_count) * 100);
};

// ISO 주 키(예: 2026-W27) — 주간 로그 정렬·중복 방지용.
const isoWeek = (d: Date) => {
    const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const day = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
    const wk = Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
    return `${t.getUTCFullYear()}-W${String(wk).padStart(2, '0')}`;
};

// 외주비 실시간 분해 — 총(계약 시 확정) / 잔여(외주단가 × 남은건수) / 소진(총 − 잔여).
//   remainOverride: 편집 모달의 낙관적 잔여(remainN)로 즉시 반영할 때 사용.
const outsourceOf = (ct: ClientContract, remainOverride?: number) => {
    const unit = ct.unit_outsource ?? 0;
    const goal = ct.goal_count ?? 0;
    const remain = remainOverride ?? ct.remain_count ?? 0;
    const total = ct.outsource ?? unit * goal; // 저장된 총 외주비 우선, 없으면 단가×총건수
    const remainAmt = unit * remain;
    return { total, remain: remainAmt, used: Math.max(0, total - remainAmt), unit };
};

// 기본정보(담당자·문의경로·연락처·이메일) 클릭 편집 모달.
function ClientFieldModal({
    label,
    value,
    options,
    format,
    onSave,
    onClose,
}: {
    label: string;
    value: string;
    options?: string[];
    format?: (v: string) => string;
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
                            onChange={(e) => setV(format ? format(e.target.value) : e.target.value)}
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
    const [perDay, setPerDay] = useState('');
    const [days, setDays] = useState('');
    const [unit, setUnit] = useState('');
    const [outUnit, setOutUnit] = useState('');
    const [outCompany, setOutCompany] = useState(''); // 외주업체명
    const [date, setDate] = useState('');
    const [saving, setSaving] = useState(false);
    const daily = isDailySub(subtype); // 리워드 등 = 일일수량 × 일수
    const cnt = daily
        ? (Number(onlyDigits(perDay)) || 0) * (Number(onlyDigits(days)) || 0)
        : Number(onlyDigits(count)) || 0;
    const amt = (Number(onlyDigits(unit)) || 0) * cnt; // 매출 = 단가 × 수량
    const outAmt = (Number(onlyDigits(outUnit)) || 0) * cnt; // 외주비 = 외주단가 × 수량

    const pickCat = (key: string) => {
        setCatKey(key);
        const c = PRODUCT_CATEGORIES.find((x) => x.key === key);
        if (c) setSubtype(c.subs[0]);
    };

    const submit = async () => {
        const n = cnt > 0 ? cnt : null;
        if (!n && !amt) {
            onToast('수량 또는 단가를 입력하세요');
            return;
        }
        setSaving(true);
        const { error } = await insertClientContracts([
            {
                amount: amt,
                category: cat.label,
                client_id: clientId,
                contract_date: date || null,
                goal_count: n,
                outsource: outAmt,
                outsource_company: outCompany.trim() || null,
                per_day: daily ? Number(onlyDigits(perDay)) || null : null,
                remain_count: n,
                subtype,
                unit_outsource: outUnit.trim() ? Number(onlyDigits(outUnit)) : null,
                unit_price: unit.trim() ? Number(onlyDigits(unit)) : null,
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
                    <div className="grid grid-cols-3 gap-2">
                        <label className="block text-xs font-semibold text-[#475569]">
                            {daily ? '타 × 일수' : '수량'}
                            {daily ? (
                                <div className="mt-1 flex items-center gap-1">
                                    <input
                                        className="h-10 w-full rounded-md border border-[#cbd5e1] px-1 text-right text-sm"
                                        inputMode="numeric"
                                        onChange={(e) => setPerDay(e.target.value)}
                                        placeholder="타"
                                        type="text"
                                        value={withCommas(perDay)}
                                    />
                                    <span className="text-xs text-[#94a3b8]">×</span>
                                    <input
                                        className="h-10 w-full rounded-md border border-[#cbd5e1] px-1 text-right text-sm"
                                        inputMode="numeric"
                                        onChange={(e) => setDays(e.target.value)}
                                        placeholder="일수"
                                        type="text"
                                        value={withCommas(days)}
                                    />
                                </div>
                            ) : (
                                <input
                                    className="mt-1 h-10 w-full rounded-md border border-[#cbd5e1] px-2 text-right text-sm"
                                    inputMode="numeric"
                                    onChange={(e) => setCount(e.target.value)}
                                    placeholder="300"
                                    type="text"
                                    value={withCommas(count)}
                                />
                            )}
                        </label>
                        <label className="block text-xs font-semibold text-[#475569]">
                            판매 단가(원)
                            <input
                                className="mt-1 h-10 w-full rounded-md border border-[#cbd5e1] px-2 text-right text-sm"
                                inputMode="numeric"
                                onChange={(e) => setUnit(e.target.value)}
                                placeholder="2,000"
                                type="text"
                                value={withCommas(unit)}
                            />
                        </label>
                        <label className="block text-xs font-semibold text-[#475569]">
                            외주단가(원)
                            <input
                                className="mt-1 h-10 w-full rounded-md border border-[#fecaca] px-2 text-right text-sm"
                                inputMode="numeric"
                                onChange={(e) => setOutUnit(e.target.value)}
                                placeholder="150"
                                type="text"
                                value={withCommas(outUnit)}
                            />
                        </label>
                    </div>
                    <label className="block text-xs font-semibold text-[#475569]">
                        외주업체명
                        <input
                            className="mt-1 h-10 w-full rounded-md border border-[#fecaca] px-2 text-sm"
                            onChange={(e) => setOutCompany(e.target.value)}
                            placeholder="외주업체명 입력"
                            type="text"
                            value={outCompany}
                        />
                    </label>
                    <div className="rounded-md bg-[#f8fafc] px-3 py-2 text-sm font-semibold text-[#0f172a]">
                        매출 <span className="text-[#1e40af]">{amt.toLocaleString('ko-KR')}</span> · 외주{' '}
                        <span className="text-[#dc2626]">{outAmt.toLocaleString('ko-KR')}</span> · 순매출{' '}
                        <span className="text-[#059669]">{(amt - outAmt).toLocaleString('ko-KR')}</span>원
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
    const [bulk, setBulk] = useState(''); // N건 일괄 완료 입력
    const [outUnitEdit, setOutUnitEdit] = useState(contract.unit_outsource?.toString() ?? ''); // 나중 외주단가 입력
    const [outCompanyEdit, setOutCompanyEdit] = useState(contract.outsource_company ?? ''); // 나중 외주업체 입력
    const [weeklyLogs, setWeeklyLogs] = useState<RewardWeeklyLog[]>(contract.weekly_logs ?? []);
    const [weekInput, setWeekInput] = useState(''); // 리워드 주간 처리 타수
    const [editLog, setEditLog] = useState<{ idx: number; value: string } | null>(null); // 진행 이력 타수 수정
    const [amount] = useState(contract.amount?.toString() ?? '');
    const [date] = useState(contract.contract_date ?? '');
    const [note, setNote] = useState(contract.note ?? '');
    const [saving, setSaving] = useState(false);
    const [confirmDel, setConfirmDel] = useState(false);
    const [renewMode, setRenewMode] = useState(false); // 재계약 클릭 → 계약 추가 UI
    const [reStart, setReStart] = useState('');
    const [reCount, setReCount] = useState('');
    const [rePerDay, setRePerDay] = useState('');
    const [reDays, setReDays] = useState('');
    const [reUnit, setReUnit] = useState('');
    const [reOutUnit, setReOutUnit] = useState('');
    // 특이사항 편집 대상 — 'current'=현재 계약(note), 숫자=history[i]. 각 계약별로 따로 저장.
    const [noteEdit, setNoteEdit] = useState<{ idx: number | 'current'; value: string } | null>(null);
    // 이력 항목(최초/재N) 클릭 → 그 회차 계약의 상세(누적 아닌 그 회차 실제 금액).
    const [periodDetail, setPeriodDetail] = useState<{
        label: string;
        goal: number;
        amount: number;
        outsource: number;
        unitPrice: number;
        unitOutsource: number;
        date: string | null;
        note: string | null;
    } | null>(null);

    const [history, setHistory] = useState<ContractHistoryItem[]>(contract.history ?? []);
    const goalN = Number(goal) || 0;
    const remainN = Number(remain) || 0;
    const hasGoal = goal.trim() !== '';
    const done = Math.max(0, goalN - remainN);
    const pct = goalN ? Math.round((done / goalN) * 100) : 0;
    const imminent = hasGoal && (remainN <= 5 || pct >= 80); // 잔여 5건 이하 또는 진행률 80%↑ → 재계약/종료
    // 리워드(일 단위) — 주간 처리: 추천치 = 일일타수 × 7(잔여로 캡), Σ주간로그가 소진과 일치해야 함.
    const isReward = isDailySub(contract.subtype);
    const perDay = contract.per_day ?? 0;
    const weekRec = Math.min(remainN, perDay * 7); // 주간 추천 타수
    const weekSum = weeklyLogs.reduce((s, l) => s + (l.count || 0), 0); // 기록된 총 처리 타수
    const unitLabel = isReward ? '타' : '건'; // 리워드는 '타' 단위
    // 재계약 입력(계약 추가와 동일) — 수량(리워드는 타×일수) · 단가 · 외주단가 → 매출/외주/순매출.
    const reDaily = isDailySub(contract.subtype);
    const reQty = reDaily
        ? (Number(onlyDigits(rePerDay)) || 0) * (Number(onlyDigits(reDays)) || 0)
        : Number(onlyDigits(reCount)) || 0;
    const reSales = (Number(onlyDigits(reUnit)) || 0) * reQty;
    const reOutAmt = (Number(onlyDigits(reOutUnit)) || 0) * reQty;

    // 계약 이력 표시용: 과거(history) + 현재 계약. 0번=최초, 나머지=재N, 마지막=현재.
    const periods = [
        ...history,
        {
            amount: Number(amount) || 0,
            at: date || '',
            contract_date: date || null,
            goal_count: hasGoal ? goalN : null,
            note: note || null,
            outsource: contract.outsource ?? null,
            remain_count: remainN,
            unit_outsource: contract.unit_outsource ?? null,
            unit_price: contract.unit_price ?? null,
        } as ContractHistoryItem,
    ];
    // 회차 델타 — periods는 누적 스냅샷이라, 그 회차 실제 계약분 = 이번 − 직전.
    const deltaOf = (i: number) => {
        const cur = periods[i];
        const prev = i > 0 ? periods[i - 1] : null;
        return {
            amount: (cur.amount ?? 0) - (prev?.amount ?? 0),
            date: cur.contract_date ?? cur.at ?? null,
            goal: (cur.goal_count ?? 0) - (prev?.goal_count ?? 0),
            note: cur.note ?? null,
            outsource: (cur.outsource ?? 0) - (prev?.outsource ?? 0),
            unitOutsource: cur.unit_outsource ?? 0,
            unitPrice: cur.unit_price ?? 0,
        };
    };

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

    // 나중 외주 입력 — 외주단가·외주업체 저장. 외주비 = 외주단가 × 수량(상세페이지 계산과 동일).
    const saveOutsource = async () => {
        if (saving) return;
        const unit = outUnitEdit.trim() ? Number(onlyDigits(outUnitEdit)) : null;
        setSaving(true);
        const { error } = await updateClientContract(contract.id, {
            outsource: (unit ?? 0) * goalN,
            outsource_company: outCompanyEdit.trim() || null,
            unit_outsource: unit,
        });
        setSaving(false);
        if (error) {
            onToast(`오류: ${error.message}`);
            return;
        }
        onToast('외주 정보 저장됨');
        await onReload();
    };

    // 리워드 주간 처리 — 잔여(진실의 원천)를 먼저 저장해 게이지/외주비 즉시 반영,
    //   주차 로그는 별도 저장(weekly_logs 컬럼 미생성 시에도 진행은 반영되게).
    const commitWeek = async (count: number, auto: boolean) => {
        if (saving || !hasGoal || count <= 0) return;
        const applied = Math.min(remainN, count); // 잔여 초과 방지
        if (applied <= 0) return;
        const next = remainN - applied;
        const log: RewardWeeklyLog = {
            at: new Date().toISOString().slice(0, 10),
            auto,
            count: applied,
            week: isoWeek(new Date()),
        };
        const newLogs = [...weeklyLogs, log];
        setRemain(String(next));
        setWeekInput('');
        setSaving(true);
        // 1) 잔여 먼저 — 실패 시 롤백(핵심 값이라 반드시 저장돼야 함).
        const { error } = await updateClientContract(contract.id, { remain_count: next });
        if (error) {
            setSaving(false);
            onToast(`오류: ${error.message}`);
            setRemain(String(remainN));
            return;
        }
        // 2) 주차 로그 — 컬럼 없으면 실패해도 진행은 유지(안내만).
        setWeeklyLogs(newLogs);
        const { error: logErr } = await updateClientContract(contract.id, { weekly_logs: newLogs });
        setSaving(false);
        if (logErr) {
            setWeeklyLogs(weeklyLogs);
            onToast('진행은 반영됨. 진행 이력 저장 실패 — Supabase에 weekly_logs 컬럼 추가 필요');
        } else {
            onToast(
                `${applied.toLocaleString('ko-KR')}${unitLabel} 완료 (잔여 ${next.toLocaleString('ko-KR')}${unitLabel})`,
            );
        }
        await onReload();
    };

    // 주간 로그 삭제(오기입 되돌리기) — 잔여 복원 + 로그 제거.
    const deleteWeekLog = async (i: number) => {
        const removed = weeklyLogs[i];
        if (!removed) return;
        const next = Math.min(goalN, remainN + (removed.count || 0));
        const newLogs = weeklyLogs.filter((_, j) => j !== i);
        setRemain(String(next));
        setWeeklyLogs(newLogs);
        setSaving(true);
        const { error } = await updateClientContract(contract.id, {
            remain_count: next,
            weekly_logs: newLogs,
        });
        setSaving(false);
        if (error) {
            onToast(`오류: ${error.message}`);
            setRemain(String(remainN));
            setWeeklyLogs(weeklyLogs);
        } else {
            await onReload();
        }
    };

    // 진행 이력 타수 수정 — 변경분(신−구)만큼 잔여를 반대로 조정(정합 유지).
    const editWeekLog = async (i: number, rawCount: number) => {
        const target = weeklyLogs[i];
        if (!target) return;
        const oldCount = target.count || 0;
        const diff = rawCount - oldCount; // +면 더 진행 → 잔여 감소
        const nextRemain = remainN - diff;
        if (nextRemain < 0 || nextRemain > goalN) {
            onToast(`잔여 범위를 벗어납니다(0~${goalN.toLocaleString('ko-KR')})`);
            return;
        }
        const newLogs = weeklyLogs.map((l, j) => (j === i ? { ...l, count: rawCount } : l));
        setEditLog(null);
        setRemain(String(nextRemain));
        setWeeklyLogs(newLogs);
        setSaving(true);
        const { error } = await updateClientContract(contract.id, {
            remain_count: nextRemain,
            weekly_logs: newLogs,
        });
        setSaving(false);
        if (error) {
            onToast(`오류: ${error.message}`);
            setRemain(String(remainN));
            setWeeklyLogs(weeklyLogs);
        } else {
            await onReload();
        }
    };

    // 재계약 = 현재 계약을 이력으로 넣고, 진행분 유지한 채 수량·매출·외주비 누적(2/5 + 5 → 2/10).
    const addRenewal = async () => {
        const s = reStart.trim();
        if (!s || reQty <= 0) {
            onToast('계약 시작일과 수량을 입력하세요');
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
                outsource: contract.outsource ?? null,
                remain_count: remainN,
                unit_outsource: contract.unit_outsource ?? null,
                unit_price: contract.unit_price ?? null,
            },
        ];
        const nextGoal = goalN + reQty;
        const nextRemain = remainN + reQty;
        const nextAmount = (Number(amount) || 0) + reSales;
        const nextOutsource = (contract.outsource || 0) + reOutAmt;
        setSaving(true);
        const { error } = await updateClientContract(contract.id, {
            amount: nextAmount,
            contract_date: s,
            goal_count: nextGoal,
            history: newHistory,
            outsource: nextOutsource,
            // 리워드 재계약: 일일 타수가 바뀌면 갱신(추천치 정확도 유지)
            ...(reDaily && Number(onlyDigits(rePerDay)) > 0
                ? { per_day: Number(onlyDigits(rePerDay)) }
                : {}),
            remain_count: nextRemain,
        });
        setSaving(false);
        if (error) {
            onToast(`오류: ${error.message}`);
            return;
        }
        onToast(`재계약 — ${reQty.toLocaleString('ko-KR')}건 추가 (총 ${nextGoal.toLocaleString('ko-KR')}건 · 매출 ${fmtWon(nextAmount)}원)`);
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

    // 특이사항 저장 — 대상 계약(현재/이력 항목)별로 따로 저장.
    const saveNote = async () => {
        if (!noteEdit) return;
        const v = noteEdit.value.trim() || null;
        setSaving(true);
        let error;
        if (noteEdit.idx === 'current') {
            ({ error } = await updateClientContract(contract.id, { note: v }));
            if (!error) setNote(v || '');
        } else {
            const nh = history.map((h, j) => (j === noteEdit.idx ? { ...h, note: v } : h));
            ({ error } = await updateClientContract(contract.id, { history: nh }));
            if (!error) setHistory(nh);
        }
        setSaving(false);
        if (error) {
            onToast(`오류: ${error.message}`);
            return;
        }
        setNoteEdit(null);
        onToast('특이사항 저장');
        await onReload();
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
                {contract.outsource_company ? (
                    <div className="mt-1 inline-flex items-center gap-1 rounded-md bg-[#fef2f2] px-2 py-0.5 text-xs font-semibold text-[#dc2626]">
                        외주업체 · {contract.outsource_company}
                    </div>
                ) : null}

                {/* 진행률 — 1건 완료로 잔여 감소(자동 반영) */}
                {hasGoal ? (
                    <div className="my-3 rounded-lg border border-[#e2e8f0] bg-[#f8fafc] px-4 py-3 text-center">
                        <div className="text-3xl font-bold" style={{ color: progColor(pct) }}>
                            {pct}%
                        </div>
                        <div className="mt-1 text-sm text-[#475569]">
                            {isReward ? '진행' : '발행'} <b>{done}</b> / 계약 {goalN}
                            {unitLabel} · 잔여 <b>{remainN}</b>
                            {unitLabel}
                        </div>
                        <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#eef2f7]">
                            <div style={{ background: progColor(pct), height: '100%', width: `${pct}%` }} />
                        </div>
                        {/* 외주비 실시간 — 남은 외주비 = 외주단가 × 잔여건수 */}
                        {(contract.unit_outsource ?? 0) > 0
                            ? (() => {
                                  const o = outsourceOf(contract, remainN);
                                  return (
                                      <div className="mt-2 grid grid-cols-3 gap-1 rounded-lg border border-[#fee2e2] bg-[#fff7f7] px-2 py-2 text-center">
                                          <div>
                                              <div className="text-[10px] text-[#94a3b8]">총 외주비</div>
                                              <div className="text-xs font-bold text-[#475569]">
                                                  {fmtWon(o.total)}원
                                              </div>
                                          </div>
                                          <div>
                                              <div className="text-[10px] text-[#94a3b8]">소진</div>
                                              <div className="text-xs font-bold text-[#94a3b8]">
                                                  {fmtWon(o.used)}원
                                              </div>
                                          </div>
                                          <div>
                                              <div className="text-[10px] text-[#dc2626]">남은 외주비</div>
                                              <div className="text-sm font-extrabold text-[#dc2626]">
                                                  {fmtWon(o.remain)}원
                                              </div>
                                          </div>
                                          {/* 잔여 외주비 게이지 — 진행될수록 빨간 막대(잔여)가 줄어듦 */}
                                          <div className="col-span-3 mt-1 h-1.5 overflow-hidden rounded-full bg-[#fee2e2]">
                                              <div
                                                  className="h-full rounded-full bg-[#dc2626] transition-all"
                                                  style={{
                                                      width: `${o.total > 0 ? Math.round((o.remain / o.total) * 100) : 0}%`,
                                                  }}
                                              />
                                          </div>
                                          <div className="col-span-3 mt-0.5 text-[10px] text-[#94a3b8]">
                                              외주단가 {fmtWon(o.unit)}원 × 잔여 {remainN}
                                              {unitLabel}
                                          </div>
                                      </div>
                                  );
                              })()
                            : null}
                        {isReward ? (
                            /* 리워드 주간 처리 — 추천치(일일타수×7) 확인/보정 후 확정. 9000타를 주 단위로. */
                            <>
                            <div className="mt-3 rounded-lg border border-[#dbeafe] bg-[#eff6ff] px-3 py-4 text-left">
                                <div className="flex items-center justify-between">
                                    <span className="text-sm font-bold text-[#1e40af]">주간 진행</span>
                                    <span className="text-[10px] text-[#64748b]">
                                        {perDay > 0
                                            ? `일일 ${perDay.toLocaleString('ko-KR')}타 · 주 추천 ${weekRec.toLocaleString('ko-KR')}타`
                                            : '일일 타수 미저장 — 직접 입력'}
                                    </span>
                                </div>
                                <div className="mt-2 flex items-center gap-1.5">
                                    <input
                                        className="h-9 w-full rounded-md border border-[#93c5fd] bg-white px-2 text-sm"
                                        inputMode="numeric"
                                        onChange={(e) => setWeekInput(withCommas(e.target.value))}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter' && Number(onlyDigits(weekInput)) > 0) {
                                                void commitWeek(Number(onlyDigits(weekInput)), false);
                                            }
                                        }}
                                        placeholder="이번 주 처리 타수"
                                        value={weekInput}
                                    />
                                    {perDay > 0 && weekRec > 0 ? (
                                        <button
                                            className="shrink-0 rounded-md border border-[#93c5fd] px-2 py-2 text-[11px] font-semibold text-[#1e40af] hover:bg-[#dbeafe] disabled:opacity-50"
                                            disabled={saving}
                                            onClick={() => setWeekInput(withCommas(String(weekRec)))}
                                            type="button"
                                        >
                                            추천 {weekRec.toLocaleString('ko-KR')}
                                        </button>
                                    ) : null}
                                    <button
                                        className="shrink-0 rounded-md bg-[#1e40af] px-3 py-2 text-sm font-bold text-white hover:bg-[#1e3a8a] disabled:opacity-50"
                                        disabled={saving || Number(onlyDigits(weekInput)) <= 0 || remainN <= 0}
                                        onClick={() =>
                                            void commitWeek(
                                                Number(onlyDigits(weekInput)),
                                                Number(onlyDigits(weekInput)) === weekRec,
                                            )
                                        }
                                        type="button"
                                    >
                                        주간 확정
                                    </button>
                                </div>
                                {Number(onlyDigits(weekInput)) > 0 && (contract.unit_outsource ?? 0) > 0 ? (
                                    <div className="mt-1 text-right text-[11px] text-[#64748b]">
                                        이번 주 소진 외주비 ≈{' '}
                                        <b className="text-[#dc2626]">
                                            {fmtWon(
                                                Math.min(remainN, Number(onlyDigits(weekInput))) *
                                                    (contract.unit_outsource ?? 0),
                                            )}
                                            원
                                        </b>
                                    </div>
                                ) : null}
                            </div>
                            </>
                        ) : (
                            <>
                                <div className="mt-2 flex gap-2">
                                    <button
                                        className="flex-1 rounded-md bg-[#059669] px-4 py-2 text-sm font-bold text-white hover:bg-[#047857] disabled:opacity-50"
                                        disabled={saving || remainN <= 0}
                                        onClick={() => void commitWeek(1, false)}
                                        type="button"
                                    >
                                        + 1건 완료
                                    </button>
                                    <button
                                        className="rounded-md border border-[#cbd5e1] px-3 py-2 text-sm font-semibold text-[#475569] hover:bg-[#f1f5f9] disabled:opacity-50"
                                        disabled={saving || remainN >= goalN}
                                        onClick={() =>
                                            weeklyLogs.length
                                                ? void deleteWeekLog(weeklyLogs.length - 1)
                                                : void quick(-1)
                                        }
                                        type="button"
                                    >
                                        되돌리기
                                    </button>
                                </div>
                                {/* N건 일괄 완료 — 진행 이력에 기록 남김 */}
                                <div className="mt-2 flex items-center gap-1.5">
                                    <input
                                        className="h-9 w-full rounded-md border border-[#cbd5e1] px-2 text-sm"
                                        inputMode="numeric"
                                        onChange={(e) => setBulk(withCommas(e.target.value))}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter' && Number(onlyDigits(bulk)) > 0) {
                                                void commitWeek(Number(onlyDigits(bulk)), false);
                                                setBulk('');
                                            }
                                        }}
                                        placeholder="여러 건 한번에"
                                        value={bulk}
                                    />
                                    <button
                                        className="shrink-0 rounded-md bg-[#1e40af] px-3 py-2 text-sm font-bold text-white hover:bg-[#1e3a8a] disabled:opacity-50"
                                        disabled={saving || Number(onlyDigits(bulk)) <= 0 || remainN <= 0}
                                        onClick={() => {
                                            void commitWeek(Number(onlyDigits(bulk)), false);
                                            setBulk('');
                                        }}
                                        type="button"
                                    >
                                        일괄 완료
                                    </button>
                                </div>
                                {Number(onlyDigits(bulk)) > 0 && (contract.unit_outsource ?? 0) > 0 ? (
                                    <div className="mt-1 text-right text-[11px] text-[#94a3b8]">
                                        이번 처리 소진 외주비 ≈{' '}
                                        <b className="text-[#475569]">
                                            {fmtWon(
                                                Math.min(remainN, Number(onlyDigits(bulk))) *
                                                    (contract.unit_outsource ?? 0),
                                            )}
                                            원
                                        </b>
                                    </div>
                                ) : null}
                            </>
                        )}
                        {/* 진행 이력 — 리워드/일반 공통(완료 처리마다 기록) */}
                        {weeklyLogs.length || !isReward ? (
                            <div className="mt-3 rounded-lg border border-[#e2e8f0] bg-white px-3 py-3 text-left">
                                <div className="mb-1.5 flex items-center justify-between">
                                    <span className="text-sm font-bold text-[#334155]">진행 이력</span>
                                    <span
                                        className={
                                            weekSum === done
                                                ? 'text-[11px] text-[#059669]'
                                                : 'text-[11px] font-bold text-[#dc2626]'
                                        }
                                    >
                                        Σ {weekSum.toLocaleString('ko-KR')}
                                        {unitLabel}
                                        {weekSum === done
                                            ? ' ✓'
                                            : ` ≠ 소진 ${done.toLocaleString('ko-KR')}${unitLabel}`}
                                    </span>
                                </div>
                                {weeklyLogs.length ? (
                                    <div className="grid max-h-[34vh] gap-1 overflow-y-auto">
                                        {weeklyLogs.map((l, i) => (
                                            <div
                                                className="flex items-center gap-1.5 rounded-md border border-[#eef2f7] bg-[#f8fafc] px-2 py-1.5 text-xs"
                                                key={i}
                                            >
                                                <span className="rounded bg-[#dbeafe] px-1.5 py-0.5 text-[11px] font-bold text-[#1e40af]">
                                                    {isReward ? `${i + 1}주차` : `${i + 1}회`}
                                                </span>
                                                <span className="text-[#64748b]">{l.at}</span>
                                                {editLog?.idx === i ? (
                                                    <input
                                                        autoFocus
                                                        className="ml-auto h-7 w-20 rounded border border-[#1e40af] px-1.5 text-right text-xs"
                                                        inputMode="numeric"
                                                        onBlur={() =>
                                                            void editWeekLog(
                                                                i,
                                                                Number(onlyDigits(editLog.value)) || 0,
                                                            )
                                                        }
                                                        onChange={(e) =>
                                                            setEditLog({
                                                                idx: i,
                                                                value: withCommas(e.target.value),
                                                            })
                                                        }
                                                        onKeyDown={(e) => {
                                                            if (e.key === 'Enter')
                                                                void editWeekLog(
                                                                    i,
                                                                    Number(onlyDigits(editLog.value)) || 0,
                                                                );
                                                            if (e.key === 'Escape') setEditLog(null);
                                                        }}
                                                        value={editLog.value}
                                                    />
                                                ) : (
                                                    <button
                                                        className="ml-auto font-bold text-[#1e40af] hover:underline"
                                                        onClick={() =>
                                                            setEditLog({
                                                                idx: i,
                                                                value: withCommas(String(l.count)),
                                                            })
                                                        }
                                                        title="수량 수정"
                                                        type="button"
                                                    >
                                                        {l.count.toLocaleString('ko-KR')}
                                                        {unitLabel}
                                                    </button>
                                                )}
                                                {(contract.unit_outsource ?? 0) > 0 ? (
                                                    <span className="text-[11px] text-[#dc2626]">
                                                        {fmtWon(l.count * (contract.unit_outsource ?? 0))}원
                                                    </span>
                                                ) : null}
                                                <button
                                                    className="text-[#cbd5e1] hover:text-[#dc2626]"
                                                    disabled={saving}
                                                    onClick={() => void deleteWeekLog(i)}
                                                    title="이 진행 기록 되돌리기"
                                                    type="button"
                                                >
                                                    ✕
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="py-4 text-center text-[11px] text-[#94a3b8]">
                                        아직 진행 이력이 없습니다. 완료 처리를 하면 기록됩니다.
                                    </div>
                                )}
                            </div>
                        ) : null}
                    </div>
                ) : null}

                {/* 외주 정보 — 나중에 외주단가·외주업체 입력(재계약 이력 없는 계약만). 외주비=외주단가×수량 */}
                {history.length === 0 ? (
                    <div className="my-3 rounded-lg border border-[#fee2e2] bg-[#fff7f7] px-4 py-3">
                        <div className="mb-1.5 text-xs font-bold text-[#dc2626]">외주 정보</div>
                        <div className="grid grid-cols-2 gap-2">
                            <label className="block text-[11px] font-semibold text-[#475569]">
                                외주단가(원)
                                <input
                                    className="mt-1 h-9 w-full rounded-md border border-[#fecaca] px-2 text-right text-sm"
                                    inputMode="numeric"
                                    onChange={(e) => setOutUnitEdit(withCommas(e.target.value))}
                                    placeholder="예: 33"
                                    value={withCommas(outUnitEdit)}
                                />
                            </label>
                            <label className="block text-[11px] font-semibold text-[#475569]">
                                외주업체명
                                <input
                                    className="mt-1 h-9 w-full rounded-md border border-[#fecaca] px-2 text-sm"
                                    onChange={(e) => setOutCompanyEdit(e.target.value)}
                                    placeholder="외주업체명 입력"
                                    value={outCompanyEdit}
                                />
                            </label>
                        </div>
                        <div className="mt-1.5 flex items-center justify-between">
                            <span className="text-[11px] text-[#94a3b8]">
                                외주비 = 외주단가 × {goalN.toLocaleString('ko-KR')} ={' '}
                                <b className="text-[#dc2626]">
                                    {fmtWon((Number(onlyDigits(outUnitEdit)) || 0) * goalN)}원
                                </b>
                            </span>
                            <button
                                className="rounded-md bg-[#dc2626] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#b91c1c] disabled:opacity-50"
                                disabled={saving}
                                onClick={() => void saveOutsource()}
                                type="button"
                            >
                                외주 저장
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
                                {/* 재계약 추가 (계약 추가와 동일: 수량·단가·외주단가 → 매출/외주/순매출) */}
                                <div>
                                    <div className="mb-1 text-xs font-bold text-[#334155]">
                                        재계약 추가 (시작일 · {reDaily ? '타 × 일수' : '수량'} · 단가 · 외주단가)
                                    </div>
                                    <input
                                        className="mb-2 h-9 w-full rounded-md border border-[#cbd5e1] bg-white px-2 text-sm"
                                        onChange={(e) => setReStart(e.target.value)}
                                        placeholder="계약 시작일 (예: 2026-01-15)"
                                        value={reStart}
                                    />
                                    <div className="flex flex-wrap items-center gap-1.5">
                                        {reDaily ? (
                                            <>
                                                <input
                                                    className="h-9 w-14 rounded-md border border-[#cbd5e1] bg-white px-1.5 text-right text-sm"
                                                    inputMode="numeric"
                                                    onChange={(e) => setRePerDay(e.target.value)}
                                                    placeholder="타"
                                                    type="text"
                                                    value={withCommas(rePerDay)}
                                                />
                                                <span className="text-xs text-[#94a3b8]">×</span>
                                                <input
                                                    className="h-9 w-14 rounded-md border border-[#cbd5e1] bg-white px-1.5 text-right text-sm"
                                                    inputMode="numeric"
                                                    onChange={(e) => setReDays(e.target.value)}
                                                    placeholder="일수"
                                                    type="text"
                                                    value={withCommas(reDays)}
                                                />
                                            </>
                                        ) : (
                                            <input
                                                className="h-9 w-16 rounded-md border border-[#cbd5e1] bg-white px-1.5 text-right text-sm"
                                                inputMode="numeric"
                                                onChange={(e) => setReCount(e.target.value)}
                                                placeholder="수량"
                                                type="text"
                                                value={withCommas(reCount)}
                                            />
                                        )}
                                        <input
                                            className="h-9 w-24 rounded-md border border-[#cbd5e1] bg-white px-1.5 text-right text-sm"
                                            inputMode="numeric"
                                            onChange={(e) => setReUnit(e.target.value)}
                                            placeholder="단가"
                                            type="text"
                                            value={withCommas(reUnit)}
                                        />
                                        <input
                                            className="h-9 w-24 rounded-md border border-[#fecaca] bg-white px-1.5 text-right text-sm"
                                            inputMode="numeric"
                                            onChange={(e) => setReOutUnit(e.target.value)}
                                            placeholder="외주단가"
                                            type="text"
                                            value={withCommas(reOutUnit)}
                                        />
                                    </div>
                                    <div className="mt-2 rounded-md bg-[#f8fafc] px-3 py-2 text-sm font-semibold text-[#0f172a]">
                                        매출{' '}
                                        <span className="text-[#1e40af]">{reSales.toLocaleString('ko-KR')}</span> ·
                                        외주{' '}
                                        <span className="text-[#dc2626]">{reOutAmt.toLocaleString('ko-KR')}</span> ·
                                        순매출{' '}
                                        <span className="text-[#059669]">
                                            {(reSales - reOutAmt).toLocaleString('ko-KR')}
                                        </span>
                                        원
                                    </div>
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


                {/* 계약 이력 — 최초 계약 + 재N (마지막=현재). 항상 표시. */}
                {periods.length ? (
                    <div className="mt-3 border-t border-[#e2e8f0] pt-3">
                        <div className="mb-1.5 text-xs font-bold text-[#334155]">계약 이력</div>
                        <div className="grid max-h-[26vh] gap-1 overflow-y-auto">
                            {periods.map((p, i) => {
                                const isCurrent = i === periods.length - 1;
                                const isFirst = i === 0;
                                const pLabel = isFirst ? '최초 계약' : `재계약 ${i}`;
                                const d = deltaOf(i); // 그 회차 실제 계약분(누적 아님)
                                return (
                                    <div
                                        className="flex cursor-pointer items-center gap-1.5 rounded-md border border-[#eef2f7] bg-[#f8fafc] px-2.5 py-1.5 text-xs text-[#475569] hover:border-[#1e40af]"
                                        key={i}
                                        onClick={() => setPeriodDetail({ label: pLabel, ...d })}
                                    >
                                        <span
                                            className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${
                                                isFirst ? 'bg-[#dbeafe] text-[#1e40af]' : 'bg-[#f1f5f9] text-[#475569]'
                                            }`}
                                        >
                                            {pLabel}
                                        </span>
                                        <span className="font-semibold">
                                            {d.date || '-'} · 계약 {d.goal.toLocaleString('ko-KR')}건
                                        </span>
                                        {/* 이월 = 이 계약에서 다음 계약으로 넘어간 잔여 건수 */}
                                        {!isCurrent ? (
                                            <span className="shrink-0 rounded bg-[#fef3c7] px-1.5 py-0.5 text-[10px] font-bold text-[#b45309]">
                                                {p.remain_count ?? 0}건 이월
                                            </span>
                                        ) : null}
                                        <span className="ml-auto">{d.amount ? `${fmtWon(d.amount)}원` : ''}</span>
                                        <button
                                            className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-semibold ${
                                                p.note
                                                    ? 'border-[#1e40af] text-[#1e40af]'
                                                    : 'border-[#cbd5e1] text-[#94a3b8]'
                                            } hover:bg-[#eff6ff]`}
                                            onClick={() =>
                                                setNoteEdit({
                                                    idx: isCurrent ? 'current' : i,
                                                    value: p.note || '',
                                                })
                                            }
                                            title="특이사항 편집"
                                            type="button"
                                        >
                                            특이사항{p.note ? '' : ' +'}
                                        </button>
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
                    {renewMode ? (
                        <button
                            className="rounded-md bg-[#1e40af] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                            disabled={saving}
                            onClick={() => void addRenewal()}
                            type="button"
                        >
                            {saving ? '저장 중…' : '계약'}
                        </button>
                    ) : null}
                </div>

                {/* 특이사항 편집 팝업 — 계약별로 따로 저장 */}
                {noteEdit !== null ? (
                    <div
                        className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
                        onMouseDown={(e) => e.target === e.currentTarget && setNoteEdit(null)}
                    >
                        <div className="w-[min(380px,92vw)] rounded-xl bg-white p-5 shadow-xl">
                            <h4 className="m-0 text-sm font-bold text-[#0f172a]">
                                특이사항 {noteEdit.idx === 'current' ? '(현재 계약)' : `(재계약 ${noteEdit.idx})`}
                            </h4>
                            <textarea
                                autoFocus
                                className="mt-2 w-full rounded-md border border-[#cbd5e1] px-3 py-2 text-sm"
                                onChange={(e) =>
                                    setNoteEdit((prev) => (prev ? { ...prev, value: e.target.value } : prev))
                                }
                                rows={4}
                                value={noteEdit.value}
                            />
                            <div className="mt-4 flex justify-end gap-2">
                                <button
                                    className="rounded-md border border-[#cbd5e1] px-4 py-2 text-sm font-semibold text-[#64748b]"
                                    onClick={() => setNoteEdit(null)}
                                    type="button"
                                >
                                    취소
                                </button>
                                <button
                                    className="rounded-md bg-[#1e40af] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                                    disabled={saving}
                                    onClick={() => void saveNote()}
                                    type="button"
                                >
                                    저장
                                </button>
                            </div>
                        </div>
                    </div>
                ) : null}

                {/* 이력 회차 상세 — 그 회차 실제 계약분 */}
                {periodDetail ? (
                    <div
                        className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
                        onMouseDown={(e) => e.target === e.currentTarget && setPeriodDetail(null)}
                    >
                        <div className="w-[min(400px,94vw)] rounded-2xl bg-white p-6">
                            <h3 className="m-0 text-lg font-bold">
                                {contract.subtype}{' '}
                                <span className="text-sm font-semibold text-[#64748b]">· {periodDetail.label}</span>
                            </h3>
                            <div className="mt-3 grid gap-1.5 text-sm">
                                {(
                                    [
                                        ['계약일', periodDetail.date || '-'],
                                        ['수량', `${periodDetail.goal.toLocaleString('ko-KR')}건`],
                                        ['단가', `${fmtWon(periodDetail.unitPrice)}원`],
                                        ['매출 (실매출)', `${fmtWon(periodDetail.amount)}원`, '#1e40af'],
                                        ['외주업체', contract.outsource_company || '-'],
                                        ['외주단가', `${fmtWon(periodDetail.unitOutsource)}원`],
                                        ['외주비', `${fmtWon(periodDetail.outsource)}원`, '#dc2626'],
                                        [
                                            '순매출',
                                            `${fmtWon(periodDetail.amount - periodDetail.outsource)}원`,
                                            '#059669',
                                        ],
                                        ['특이사항', periodDetail.note || '-'],
                                    ] as [string, string, string?][]
                                ).map(([k, v, color]) => (
                                    <div
                                        className="flex items-center justify-between border-b border-[#f1f5f9] py-1.5"
                                        key={k}
                                    >
                                        <span className="text-[#64748b]">{k}</span>
                                        <span className="font-bold" style={{ color: color || '#0f172a' }}>
                                            {v}
                                        </span>
                                    </div>
                                ))}
                            </div>
                            <div className="mt-4 flex justify-end">
                                <button
                                    className="rounded-md border border-[#cbd5e1] px-4 py-2 text-sm font-semibold text-[#64748b]"
                                    onClick={() => setPeriodDetail(null)}
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
        patchKey:
            | 'manager'
            | 'source'
            | 'contact'
            | 'email'
            | 'business_number'
            | 'address'
            | 'industry'
            | 'url'
            | 'client_partner';
        label: string;
        value: string;
        options?: string[];
        format?: (v: string) => string;
    } | null>(null);
    const [addOpen, setAddOpen] = useState(false);
    const [editContract, setEditContract] = useState<ClientContract | null>(null);
    const [endOpen, setEndOpen] = useState(false); // 상단 계약 종료 모달(히스토리 입력)
    const [endNote, setEndNote] = useState('');
    const [breakdown, setBreakdown] = useState<'net' | 'outsource' | 'sales' | null>(null); // 상품별 내역
    const [detailC, setDetailC] = useState<ClientContract | null>(null); // 내역에서 상품 클릭 시 상세

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

    const renderFieldCard = (f: FieldDef) => (
        <button
            className="rounded-lg border border-[#e2e8f0] bg-white px-3 py-2.5 text-left shadow-sm hover:border-[#1e40af]"
            key={f.key}
            onClick={() =>
                setEditField({
                    format: f.format,
                    label: f.label,
                    options: f.options,
                    patchKey: f.key,
                    value: f.value,
                })
            }
            type="button"
        >
            <div className="text-[11px] font-semibold text-[#94a3b8]">{f.label}</div>
            <div className="mt-0.5 truncate text-sm font-medium text-[#0f172a]">{f.value || '-'}</div>
        </button>
    );

    // 카테고리별 합계 + 총액.
    const catAmount = (label: string) =>
        contracts.filter((ct) => ct.category === label).reduce((s, ct) => s + (ct.amount || 0), 0);
    const totalAmount = contracts.reduce((s, ct) => s + (ct.amount || 0), 0); // 실매출
    const totalOutsource = contracts.reduce((s, ct) => s + (ct.outsource || 0), 0); // 외주비 합계
    const outRemainSum = contracts.reduce((s, ct) => s + outsourceOf(ct).remain, 0); // 남은 외주비 합계
    const outUsedSum = Math.max(0, totalOutsource - outRemainSum); // 소진 외주비 합계
    const netRevenue = totalAmount - totalOutsource; // 순매출 = 실매출 − 외주비
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
                <div className="min-w-0">
                    <h2 className="m-0 text-[22px] font-semibold text-[#0f172a]">
                        {client.company || '고객사'}
                        <span className="ml-2 text-xs font-semibold text-[#94a3b8]">업체명</span>
                    </h2>
                    <div className="mt-0.5 text-sm font-semibold text-[#64748b]">
                        {client.client_partner || '—'}
                        <span className="ml-2 text-xs font-normal text-[#94a3b8]">거래처명</span>
                    </div>
                </div>
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

            {/* 누적 금액 — 순매출 = 실매출 − 외주비 (카드별 + 연산자). 순매출·외주비 누르면 상품별 내역 */}
            <div className="flex items-stretch gap-2">
                <button
                    className="flex-1 rounded-xl border-2 border-[#059669] bg-[#f0fdf4] px-3 py-3 text-center shadow-sm transition hover:shadow-md"
                    onClick={() => setBreakdown('net')}
                    type="button"
                >
                    <div className="text-[11px] font-semibold text-[#059669]">순매출</div>
                    <div className="mt-0.5 text-lg font-bold text-[#059669] sm:text-2xl">{fmtWon(netRevenue)}원</div>
                </button>
                <div className="flex items-center text-xl font-bold text-[#94a3b8]">=</div>
                <button
                    className="flex-1 rounded-xl border border-[#e2e8f0] bg-white px-3 py-3 text-center shadow-sm transition hover:border-[#1e40af] hover:shadow-md"
                    onClick={() => setBreakdown('sales')}
                    type="button"
                >
                    <div className="text-[11px] font-semibold text-[#94a3b8]">실매출 (누적)</div>
                    <div className="mt-0.5 text-lg font-bold text-[#1e40af] sm:text-2xl">{fmtWon(totalAmount)}원</div>
                </button>
                <div className="flex items-center text-xl font-bold text-[#94a3b8]">−</div>
                <button
                    className="flex-1 rounded-xl border border-[#e2e8f0] bg-white px-3 py-3 text-center shadow-sm transition hover:border-[#dc2626] hover:shadow-md"
                    onClick={() => setBreakdown('outsource')}
                    type="button"
                >
                    <div className="text-[11px] font-semibold text-[#94a3b8]">외주비 합계</div>
                    <div className="mt-0.5 text-lg font-bold text-[#dc2626] sm:text-2xl">
                        {fmtWon(totalOutsource)}원
                    </div>
                    {outRemainSum > 0 || outUsedSum > 0 ? (
                        <div className="mt-0.5 text-[10px] text-[#94a3b8]">
                            소진 {fmtWon(outUsedSum)} · 잔여{' '}
                            <b className="text-[#dc2626]">{fmtWon(outRemainSum)}</b>원
                        </div>
                    ) : null}
                </button>
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
                                    // 상위 카테고리 안에서 세부유형끼리 묶기(subs 순서), 같은 유형은 계약일 순.
                                    .sort((a, b) => {
                                        const ai = c.subs.indexOf(a.subtype);
                                        const bi = c.subs.indexOf(b.subtype);
                                        const an = ai < 0 ? 999 : ai;
                                        const bn = bi < 0 ? 999 : bi;
                                        if (an !== bn) return an - bn;
                                        return (a.contract_date || '').localeCompare(b.contract_date || '');
                                    })
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
                                                <div className="flex items-start justify-between gap-1.5">
                                                    <div className="truncate text-xs font-bold text-[#334155]">
                                                        {ct.subtype}
                                                    </div>
                                                    {ct.outsource_company && ct.outsource_company !== '실계' ? (
                                                        <span className="shrink-0 truncate rounded-full bg-[#fee2e2] px-2.5 py-0.5 text-[13px] font-extrabold text-[#dc2626]">
                                                            {ct.outsource_company}
                                                        </span>
                                                    ) : null}
                                                </div>
                                                {ct.contract_date ? (
                                                    <div className="mt-0.5 text-[11px] font-semibold text-[#94a3b8]">
                                                        📅 {ct.contract_date}
                                                    </div>
                                                ) : null}
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
                                                {(ct.unit_outsource ?? 0) > 0 ? (
                                                    <div className="mt-0.5 text-[11px] font-semibold text-[#dc2626]">
                                                        잔여 외주 {fmtWon(outsourceOf(ct).remain)}원
                                                    </div>
                                                ) : null}
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

            {/* 기본 정보 — 담당자·문의 경로·연락처·이메일 */}
            <h3 className="m-0 mt-2 text-base font-bold text-[#0f172a]">기본 정보</h3>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {(
                    [
                        { key: 'manager', label: '담당자', value: client.manager || '', options: managerOptions },
                        {
                            key: 'client_partner',
                            label: '거래처명',
                            value: client.client_partner || '',
                        },
                        { key: 'source', label: '문의 경로', value: client.source || '', options: SOURCE_OPTIONS },
                        { key: 'contact', label: '연락처', value: client.contact || '' },
                        { key: 'email', label: '이메일', value: client.email || '' },
                    ] as FieldDef[]
                ).map(renderFieldCard)}
            </div>

            {/* 업종 정보 — 사업자등록번호·사업장 주소·업종/업태·URL */}
            <h3 className="m-0 mt-2 text-base font-bold text-[#0f172a]">업종 정보</h3>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {(
                    [
                        {
                            key: 'business_number',
                            label: '사업자등록번호',
                            value: client.business_number || '',
                            format: formatBizNo,
                        },
                        { key: 'address', label: '사업장 주소', value: client.address || '' },
                        { key: 'industry', label: '업종/업태', value: client.industry || '', options: INDUSTRY_OPTIONS },
                        { key: 'url', label: 'URL', value: client.url || '' },
                    ] as FieldDef[]
                ).map(renderFieldCard)}
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
                    format={editField.format}
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
            {breakdown ? (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
                    onMouseDown={(e) => e.target === e.currentTarget && setBreakdown(null)}
                >
                    <div className="max-h-[80vh] w-[min(460px,94vw)] overflow-y-auto rounded-2xl bg-white p-6">
                        <h3 className="m-0 text-lg font-bold">
                            {breakdown === 'net' ? '순매출 내역' : breakdown === 'sales' ? '실매출 내역' : '외주비 내역'}
                        </h3>
                        <p className="mt-1 mb-3 text-sm text-[#64748b]">
                            {breakdown === 'net'
                                ? '상품별 순매출 (매출 − 외주비)'
                                : breakdown === 'sales'
                                  ? '상품별 실매출(매출)'
                                  : '상품별 외주비'}
                        </p>
                        {contracts.length ? (
                            <div className="grid gap-1">
                                {contracts.map((ct) => {
                                    const val =
                                        breakdown === 'net'
                                            ? (ct.amount || 0) - (ct.outsource || 0)
                                            : breakdown === 'sales'
                                              ? ct.amount || 0
                                              : ct.outsource || 0;
                                    const color =
                                        breakdown === 'net'
                                            ? '#059669'
                                            : breakdown === 'sales'
                                              ? '#1e40af'
                                              : '#dc2626';
                                    return (
                                        <div
                                            className="cursor-pointer rounded-md border border-[#eef2f7] bg-[#f8fafc] px-3 py-2 hover:border-[#1e40af]"
                                            key={ct.id}
                                            onClick={() => setDetailC(ct)}
                                        >
                                            <div className="flex items-center gap-2 text-sm">
                                                <span className="min-w-0">
                                                    <span className="block font-semibold text-[#0f172a]">
                                                        {ct.subtype}
                                                    </span>
                                                    <span className="block text-[11px] text-[#94a3b8]">
                                                        {ct.category}
                                                        {(breakdown === 'outsource' || breakdown === 'net') &&
                                                        ct.outsource_company
                                                            ? ` · 외주업체 ${ct.outsource_company}`
                                                            : ''}
                                                        {breakdown === 'net'
                                                            ? ` · 매출 ${fmtWon(ct.amount || 0)} − 외주 ${fmtWon(ct.outsource || 0)}`
                                                            : ''}
                                                    </span>
                                                </span>
                                                <span className="ml-auto shrink-0 font-bold" style={{ color }}>
                                                    {fmtWon(val)}원
                                                </span>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        ) : (
                            <div className="px-2 py-8 text-center text-sm text-[#94a3b8]">계약이 없습니다.</div>
                        )}
                        <div className="mt-3 flex items-center justify-between border-t border-[#e2e8f0] pt-3 text-sm font-bold">
                            <span>합계</span>
                            <span
                                style={{
                                    color:
                                        breakdown === 'net'
                                            ? '#059669'
                                            : breakdown === 'sales'
                                              ? '#1e40af'
                                              : '#dc2626',
                                }}
                            >
                                {fmtWon(
                                    breakdown === 'net'
                                        ? netRevenue
                                        : breakdown === 'sales'
                                          ? totalAmount
                                          : totalOutsource,
                                )}
                                원
                            </span>
                        </div>
                        <div className="mt-4 flex justify-end">
                            <button
                                className="rounded-md border border-[#cbd5e1] px-4 py-2 text-sm font-semibold text-[#64748b]"
                                onClick={() => setBreakdown(null)}
                                type="button"
                            >
                                닫기
                            </button>
                        </div>
                    </div>
                </div>
            ) : null}
            {/* 내역에서 상품 클릭 → 계약 상세(단가·외주비 등) */}
            {detailC ? (
                <div
                    className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
                    onMouseDown={(e) => e.target === e.currentTarget && setDetailC(null)}
                >
                    <div className="w-[min(400px,94vw)] rounded-2xl bg-white p-6">
                        <h3 className="m-0 text-lg font-bold">
                            {detailC.category} · {detailC.subtype}
                        </h3>
                        <div className="mt-3 grid gap-1.5 text-sm">
                            {(
                                breakdown === 'outsource'
                                    ? ([
                                          ['외주업체', detailC.outsource_company || '-'],
                                          ['수량', `${(detailC.goal_count ?? 0).toLocaleString('ko-KR')}건`],
                                          ['외주단가', `${fmtWon(detailC.unit_outsource || 0)}원`],
                                          ['외주비', `${fmtWon(detailC.outsource || 0)}원`, '#dc2626'],
                                      ] as [string, string, string?][])
                                    : breakdown === 'net'
                                      ? ([
                                            ['실매출 (매출)', `${fmtWon(detailC.amount || 0)}원`, '#1e40af'],
                                            ['외주비', `${fmtWon(detailC.outsource || 0)}원`, '#dc2626'],
                                            [
                                                '순매출 (매출 − 외주비)',
                                                `${fmtWon((detailC.amount || 0) - (detailC.outsource || 0))}원`,
                                                '#059669',
                                            ],
                                        ] as [string, string, string?][])
                                      : ([
                                            ['수량', `${(detailC.goal_count ?? 0).toLocaleString('ko-KR')}건`],
                                            ['단가', `${fmtWon(detailC.unit_price || 0)}원`],
                                            ['실매출 (매출)', `${fmtWon(detailC.amount || 0)}원`, '#1e40af'],
                                        ] as [string, string, string?][])
                            ).map(([k, v, color]) => (
                                <div
                                    className="flex items-center justify-between border-b border-[#f1f5f9] py-1.5"
                                    key={k}
                                >
                                    <span className="text-[#64748b]">{k}</span>
                                    <span className="font-bold" style={{ color: color || '#0f172a' }}>
                                        {v}
                                    </span>
                                </div>
                            ))}
                        </div>
                        {/* 계약 히스토리별 (그 회차 실제 계약분 — 누적 아님) */}
                        {(() => {
                            const per = [
                                ...(detailC.history || []),
                                {
                                    amount: detailC.amount ?? 0,
                                    contract_date: detailC.contract_date,
                                    goal_count: detailC.goal_count,
                                    outsource: detailC.outsource ?? 0,
                                    unit_price: detailC.unit_price,
                                    unit_outsource: detailC.unit_outsource,
                                },
                            ];
                            const label =
                                breakdown === 'sales'
                                    ? '실매출'
                                    : breakdown === 'outsource'
                                      ? '외주비'
                                      : '순매출';
                            const color =
                                breakdown === 'sales'
                                    ? '#1e40af'
                                    : breakdown === 'outsource'
                                      ? '#dc2626'
                                      : '#059669';
                            return (
                                <div className="mt-4">
                                    <div className="mb-1.5 text-xs font-bold text-[#64748b]">
                                        계약 히스토리별 {label}
                                    </div>
                                    <div className="grid gap-1">
                                        {per.map((p, i) => {
                                            const prev = i > 0 ? per[i - 1] : null;
                                            const dGoal = (p.goal_count ?? 0) - (prev?.goal_count ?? 0);
                                            // 그 회차 실제 금액 = 그 회차 수량 × 그 회차 단가(회차값 없으면 현재값)
                                            const uPrice = (p.unit_price ?? detailC.unit_price) || 0;
                                            const uOut = (p.unit_outsource ?? detailC.unit_outsource) || 0;
                                            const dv =
                                                breakdown === 'sales'
                                                    ? dGoal * uPrice
                                                    : breakdown === 'outsource'
                                                      ? dGoal * uOut
                                                      : dGoal * (uPrice - uOut);
                                            const unit = breakdown === 'outsource' ? uOut : uPrice;
                                            const isCur = i === per.length - 1;
                                            return (
                                                <div
                                                    className="flex items-center gap-1.5 rounded-md bg-[#f8fafc] px-2 py-1.5 text-[12px]"
                                                    key={i}
                                                >
                                                    <span
                                                        className={`rounded px-1 py-0.5 text-[11px] font-bold ${
                                                            isCur
                                                                ? 'bg-[#dcfce7] text-[#16a34a]'
                                                                : 'bg-[#f1f5f9] text-[#475569]'
                                                        }`}
                                                    >
                                                        {i === 0 ? '최초' : `재계약 ${i}`}
                                                        {isCur ? '·현재' : ''}
                                                    </span>
                                                    <span className="text-[#94a3b8]">
                                                        {p.contract_date || '-'} ·{' '}
                                                        {dGoal.toLocaleString('ko-KR')}건
                                                        {unit
                                                            ? ` × ${fmtWon(unit)}원`
                                                            : ''}
                                                    </span>
                                                    <span className="ml-auto font-bold" style={{ color }}>
                                                        {fmtWon(dv)}원
                                                    </span>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            );
                        })()}
                        <div className="mt-4 flex justify-end">
                            <button
                                className="rounded-md border border-[#cbd5e1] px-4 py-2 text-sm font-semibold text-[#64748b]"
                                onClick={() => setDetailC(null)}
                                type="button"
                            >
                                닫기
                            </button>
                        </div>
                    </div>
                </div>
            ) : null}
        </section>
    );
}
