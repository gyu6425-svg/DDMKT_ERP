import { useEffect, useState } from 'react';
import type { ErpClient } from '../api/erp';
import {
    amountProgress,
    deleteClientContract,
    insertClientContracts,
    updateClientContract,
    type ClientContract,
    type ContractHistoryItem,
    type RewardWeeklyLog,
} from '../api/clientContracts';
import { ensureClientBlogAccount, getBlogAccounts, syncBlogAccountFromContract } from '../api/blogRank';
import { fmtWon } from '../components/blogRank/lib/helpers';
import {
    PRODUCT_CATEGORIES,
    isDailySub,
    isBrandBlogSub,
    CONTAINER_SUBS,
    SHORTFORM_SUB,
    SHORTFORM_PLATFORMS,
} from '../lib/products';
import { SIDEBAR_CATEGORIES } from '../components/categoryRank/categories';
import { INDUSTRY_OPTIONS, SOURCE_OPTIONS, formatPhone, saleVat, todayStr, withVat } from '../lib/erpUtils';
import { useAuth } from '../hooks/useAuth';
import CustomerAccountModal from '../components/CustomerAccountModal';
import { PlaceUrlField } from '../components/PlaceUrlField';
import { getCustomerAccount } from '../api/profiles';
import {
    parseTsvGrid,
    findCol,
    num,
    parseDate,
    normCompany,
    vendorFromProduct,
    productBase,
    mapProduct,
} from '../lib/contractImport';
import { ContractPasteAddModal } from './ContractPasteAddModal';

// 외주(진행) 시트 붙여넣기 머리글 — 사용자 시트와 동일. 아래에 데이터만 붙여넣음.
//   매핑: 수량→건수 · 단가→외주단가 · 업체명→외주업체 · 일자→처리일. (공급가액=건수×단가 검증)
const OUT_SHEET_HEADER =
    '일자-No.\t거래처명\t업체명\t관리항목명\t품목명(요약)\t수량\t단가\t공급가액\t부가세\t합계\t사원(담당)명';

// 고객사 상세 — 기본정보(클릭 편집) + 계약 내역(카테고리/세부유형별 건수 계약).
//   계약은 client_contracts 단일 출처. 등록 시(+계약 추가) 또는 여기서 '+ 계약 추가'로 생성.
function navTo(path: string) {
    if (window.location.pathname + window.location.search !== path) {
        window.history.pushState(null, '', path);
        window.dispatchEvent(new Event('app:navigate'));
    }
}

// 계약 카드 → 해당 세부유형의 관리 시트(하위 카테고리 페이지)로 이동할 경로.
//   subtype을 사이드바 하위와 매칭(부분 일치) → 매칭 없으면 카테고리 대시보드로. 업체명(q)로 필터.
function cardSheetHref(category: string, subtype: string, company: string, approved?: boolean): string {
    const scat = SIDEBAR_CATEGORIES.find((s) => s.label === category);
    const q = 'q=' + encodeURIComponent(company || '');
    if (!scat) return '';
    const sub = scat.subs.find(
        (s) => subtype === s.label || subtype.includes(s.label) || s.label.includes(subtype),
    );
    const base = sub ? sub.href : scat.dashHref;
    // tab=sheet 로 '관리 시트' 탭을 열고, q=업체명 필터, stab=시트 하위탭(미승인→신규, 승인→계약 중).
    const stab = approved ? '&stab=active' : '&stab=new';
    return base + (base.includes('?') ? '&' : '?') + 'tab=sheet&' + q + stab;
}

const progColor = (p: number | null) =>
    p == null ? '#94a3b8' : p >= 70 ? '#059669' : p >= 40 ? '#d97706' : '#dc2626';

// 숫자 입력 포맷 — 저장은 숫자만, 표시는 천단위 콤마(2000 → 2,000).
const onlyDigits = (s: string) => s.replace(/[^\d]/g, '');
const withCommas = (s: string) => (onlyDigits(s) ? Number(onlyDigits(s)).toLocaleString('ko-KR') : '');
// 계산식 입력 지원 — '64000/4' 처럼 사칙연산 식을 적으면 계산. 콤마·공백 무시. 숫자만이면 그대로.
const EXPR_CHARS = /[+\-*/()]/; // 연산자 포함 여부(식인지 판별)
const sanitizeExpr = (v: string) => v.replace(/[^\d.,+\-*/()\s]/g, ''); // 허용 문자만(숫자·연산자·콤마·공백)
// 사칙연산(+ - * /)·괄호만 지원. eval 미사용 — 셔ANTING-yard로 직접 계산(안전).
const evalNum = (raw: string): number => {
    const s = (raw || '').replace(/,/g, '').replace(/\s/g, '');
    if (!s) return 0;
    if (/^\d*\.?\d*$/.test(s)) return Number(s) || 0; // 순수 숫자
    if (!/^[\d.+\-*/()]+$/.test(s)) return 0; // 허용 외 문자 → 0
    const tokens = s.match(/(\d*\.?\d+|[+\-*/()])/g);
    if (!tokens) return 0;
    const prec: Record<string, number> = { '+': 1, '-': 1, '*': 2, '/': 2 };
    const output: Array<number | string> = [];
    const ops: string[] = [];
    for (const t of tokens) {
        if (/[\d.]/.test(t[0])) output.push(Number(t));
        else if (t === '(') ops.push(t);
        else if (t === ')') {
            while (ops.length && ops[ops.length - 1] !== '(') output.push(ops.pop()!);
            ops.pop();
        } else {
            while (ops.length && ops[ops.length - 1] !== '(' && prec[ops[ops.length - 1]] >= prec[t])
                output.push(ops.pop()!);
            ops.push(t);
        }
    }
    while (ops.length) output.push(ops.pop()!);
    const st: number[] = [];
    for (const t of output) {
        if (typeof t === 'number') st.push(t);
        else {
            const b = st.pop() ?? 0;
            const a = st.pop() ?? 0;
            st.push(t === '+' ? a + b : t === '-' ? a - b : t === '*' ? a * b : b === 0 ? 0 : a / b);
        }
    }
    const v = st.pop();
    return typeof v === 'number' && isFinite(v) ? v : 0;
};
// 외주단가 입력 표시값 — 식이면 그대로, 순수 숫자면 콤마.
const displayExpr = (s: string) => (EXPR_CHARS.test(s) ? s : withCommas(s));
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

// 금액 기반 진행률 — 완료 외주금액(Σ 배치 외주단가×건수) ÷ 계약금액. 공용 헬퍼(amountProgress) 사용.
const progOf = (ct: ClientContract): number | null => amountProgress(ct);

// ISO 주 키(예: 2026-W27) — 주간 로그 정렬·중복 방지용.
const isoWeek = (d: Date) => {
    const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const day = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
    const wk = Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
    return `${t.getUTCFullYear()}-W${String(wk).padStart(2, '0')}`;
};

// 외주비 실시간 분해 — 총(계약 시 확정) / 소진(진행 완료분) / 잔여(총 − 소진).
//   소진 = 완료 건수(총건수 − 남은건수) × 외주단가. 진행을 안 하면 소진 0(반올림 잔돈이 소진으로 안 잡히게).
//   전량 완료면 총액으로 맞춰 잔돈 없이 마감. remainOverride: 편집 모달의 낙관적 잔여 즉시 반영용.
const outsourceOf = (ct: ClientContract, remainOverride?: number) => {
    const unit = ct.unit_outsource ?? 0;
    const goal = ct.goal_count ?? 0;
    const remain = remainOverride ?? ct.remain_count ?? 0;
    const total = ct.outsource ?? unit * goal; // 저장된 총 외주비 우선, 없으면 단가×총건수
    const completed = Math.max(0, goal - remain); // 진행 완료 건수
    const used = remain <= 0 ? total : Math.min(total, unit * completed); // 소진 = 완료분(전량 완료 시 총액)
    return { total, remain: Math.max(0, total - used), used, unit };
};

// 실제 사용 외주비(소진) — 진행 이력(완료 로그) 합 = Σ 건수 × 외주단가. 단가 없으면 진행 비율로 소진.
//   받은 외주비(ct.outsource, 합계)와 별개. 상단 소진/잔여 · 외주비 정산 공용.
const usedOutsourceOf = (ct: ClientContract): number => {
    const o = outsourceOf(ct);
    const logs = ct.weekly_logs ?? [];
    const goal = ct.goal_count ?? 0;
    const done = Math.max(0, goal - (ct.remain_count ?? goal));
    const hasUnit = (ct.unit_outsource || 0) > 0 || logs.some((l) => (l.outUnit || 0) > 0);
    if (hasUnit)
        return logs.reduce((s, l) => s + (l.count || 0) * (l.outUnit || ct.unit_outsource || 0), 0);
    return goal > 0 ? Math.round(o.total * (done / goal)) : done > 0 ? o.total : 0;
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
                    {/* 선택지가 있어도 자유 입력 가능(datalist 제안). 담당자·업종 등 직접 입력 허용. */}
                    <input
                        autoFocus
                        className="h-10 w-full rounded-md border border-[#cbd5e1] bg-white px-3 text-sm font-medium text-[#0f172a]"
                        list={options ? 'field-suggest' : undefined}
                        onChange={(e) => setV(format ? format(e.target.value) : e.target.value)}
                        placeholder={options ? '입력 또는 선택' : '입력...'}
                        value={v}
                    />
                    {options ? (
                        <datalist id="field-suggest">
                            {options.map((o) => (
                                <option key={o} value={o} />
                            ))}
                        </datalist>
                    ) : null}
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

// 기타 카테고리(종합광고 2차 전용) — 정해진 카테고리 없이 상품명 자유 입력, 금액만 반영.
const ETC_KEY = '__etc__';
const ETC_CAT = { key: ETC_KEY, label: '기타', path: '', ready: false, subs: [] as string[] };

// 계약 추가 모달 — 카테고리 → 세부유형 → 건수·금액·계약일.
//   boostPrefix 지정 시 = 상위노출 보장형 2차 등록: 카테고리 고정, subtype 앞에 접두 부착.
function ContractAddModal({
    clientId,
    companyName,
    managerName,
    boostPrefix,
    boostParentId,
    lockCategoryLabel,
    allCategorySubs,
    onClose,
    onReload,
    onToast,
}: {
    clientId: string;
    companyName: string;
    managerName: string;
    boostPrefix?: string;
    boostParentId?: string; // 컨테이너(회차) 계약 id — 하위를 그 회차로 귀속(parent_id)
    lockCategoryLabel?: string;
    allCategorySubs?: boolean; // 종합광고 2차: 카테고리 칩 보이고 전 카테고리 상품 선택(계약 category는 lockCategoryLabel로 고정)
    onClose: () => void;
    onReload: () => Promise<void>;
    onToast: (m: string) => void;
}) {
    const lockedCat = lockCategoryLabel
        ? PRODUCT_CATEGORIES.find((c) => c.label === lockCategoryLabel)
        : undefined;
    // 종합광고 2차는 실제 카테고리(플레이스 등)를 골라 상품 선택 → 계약 category는 lockCategoryLabel(종합광고)로 저장.
    const [catKey, setCatKey] = useState(
        allCategorySubs ? PRODUCT_CATEGORIES[0].key : lockedCat?.key ?? PRODUCT_CATEGORIES[0].key,
    );
    const isEtc = catKey === ETC_KEY; // 기타 = 상품명 자유 입력(종합광고 2차)
    const cat =
        PRODUCT_CATEGORIES.find((c) => c.key === catKey) ?? (isEtc ? ETC_CAT : PRODUCT_CATEGORIES[0]);
    // 2차 등록에선 컨테이너형(상위노출 보장형·종합광고) 자기 자신은 하위로 못 넣게 제외.
    const subOptions = boostPrefix ? cat.subs.filter((s) => !CONTAINER_SUBS.includes(s)) : cat.subs;
    // 카테고리 칩 표시: 일반 등록 또는 종합광고 2차(picking)에서. 종합광고 2차에서만 자기(종합광고)를 칩에서 제외.
    const showCatChips = !lockCategoryLabel || allCategorySubs;
    // 종합광고 2차엔 '기타' 칩 추가 → 정해진 카테고리 없이 상품명 입력만으로 금액 반영.
    const chipCats = allCategorySubs
        ? [...PRODUCT_CATEGORIES.filter((c) => c.label !== '종합광고'), ETC_CAT]
        : PRODUCT_CATEGORIES;
    const [subtype, setSubtype] = useState(subOptions[0]);
    const [count, setCount] = useState('');
    const [perDay, setPerDay] = useState('');
    const [days, setDays] = useState('');
    const [unit, setUnit] = useState('');
    const [amountInput, setAmountInput] = useState(''); // 기타 = 금액 직접 입력
    const [outUnit, setOutUnit] = useState('');
    const [outTotal, setOutTotal] = useState(''); // 외주비 직접입력(총액) — 입력 시 외주단가×수량 대신 사용
    const [outCompany, setOutCompany] = useState(''); // 외주업체명
    const [blogName, setBlogName] = useState(''); // 브랜드 블로그 이름(관리시트 업체명)
    const [blogUrl, setBlogUrl] = useState(''); // 브랜드 블로그 발행 URL(크롤 대상 연동)
    const [serviceNote, setServiceNote] = useState(''); // 서비스 내용 메모(무슨 서비스인지)
    const [noVat, setNoVat] = useState(false); // 부가세 없음(현금) — 실매출 VAT 미포함
    const [date, setDate] = useState('');
    const [saving, setSaving] = useState(false);
    const daily = isDailySub(subtype); // 리워드 등 = 일일수량 × 일수
    const isBrandBlog = cat.label === '블로그' && isBrandBlogSub(subtype); // 브랜드 블로그 = 블로그 이름 입력
    const isService = cat.label === '서비스'; // 서비스 = 금액만 입력 → 매출에 −(마이너스)로 저장, 외주비 0
    const isShortform = subtype === SHORTFORM_SUB; // 숏폼 = 릴스/틱톡/쇼츠 선택
    const cnt = daily
        ? (Number(onlyDigits(perDay)) || 0) * (Number(onlyDigits(days)) || 0)
        : Number(onlyDigits(count)) || 0;
    // 기타는 금액 직접 입력, 서비스는 입력 금액을 매출에 −로, 그 외는 단가 × 수량.
    const amt = isEtc
        ? Number(onlyDigits(amountInput)) || 0
        : isService
          ? -(Number(onlyDigits(amountInput)) || 0)
          : (Number(onlyDigits(unit)) || 0) * cnt;
    // 외주비: 총액을 직접 입력하면 그 값을 우선 사용(기존 등록 건). 없으면 외주단가 × 수량.
    const outDirect = Number(onlyDigits(outTotal)) || 0;
    const outAmt = outDirect > 0 ? outDirect : (Number(onlyDigits(outUnit)) || 0) * cnt;

    const pickCat = (key: string) => {
        setCatKey(key);
        if (key === ETC_KEY) {
            setSubtype(''); // 기타 = 상품명 직접 입력
            return;
        }
        const c = PRODUCT_CATEGORIES.find((x) => x.key === key);
        if (c) setSubtype((boostPrefix ? c.subs.filter((s) => !CONTAINER_SUBS.includes(s)) : c.subs)[0]);
    };

    const submit = async () => {
        const n = cnt > 0 ? cnt : null;
        if (isEtc && !subtype.trim()) {
            onToast('상품명을 입력하세요');
            return;
        }
        if (isService && amt === 0) {
            onToast('서비스 금액을 입력하세요');
            return;
        }
        if (!isService && !n && !amt) {
            onToast('수량 또는 단가를 입력하세요');
            return;
        }
        setSaving(true);
        const { error } = await insertClientContracts([
            {
                amount: amt,
                // 컨테이너 2차는 계약 category를 컨테이너(lockCategoryLabel)로 고정. 일반은 선택 카테고리.
                category: lockCategoryLabel ?? cat.label,
                client_id: clientId,
                contract_date: date || null,
                goal_count: n,
                // 보장형/종합광고 2차: 컨테이너 계약으로 명시적 귀속(그 회차 박스).
                ...(boostParentId ? { parent_id: boostParentId } : {}),
                outsource: outAmt,
                outsource_company: outCompany.trim() || null,
                per_day: daily ? Number(onlyDigits(perDay)) || null : null,
                remain_count: n,
                subtype: (boostPrefix ?? '') + subtype,
                // 외주비 직접입력 시 단가는 없음(null) → outsource(총액)만 저장.
                unit_outsource: outDirect > 0 ? null : outUnit.trim() ? Number(onlyDigits(outUnit)) : null,
                unit_price: unit.trim() ? Number(onlyDigits(unit)) : null,
                blog_name: blogName.trim() || null, // 업체명/이름 라벨(전 카테고리 공통, 카드 칩 표시)
                note: isService && serviceNote.trim() ? serviceNote.trim() : null, // 서비스 내용 메모
                no_vat: noVat, // 부가세 없음(현금)
            },
        ]);
        setSaving(false);
        if (error) {
            onToast(`오류: ${error.message}`);
            return;
        }
        // 브랜드 블로그 계약만 브랜드블로그 관리 시트(blog_accounts)에 등록.
        //   블로그 이름을 입력하면 그 이름이 관리시트 업체명(다중 블로그 A/B/C 구분). 없으면 업체명.
        //   최적화·준최적화·단순·AI 블로그 배포는 각 하위 카테고리 페이지에서 관리(브랜드블로그 시트 제외).
        //   컨테이너 2차(상위노출·종합광고) 하위는 블로그 계정 자동생성 제외.
        if (isBrandBlog && !boostPrefix) {
            await ensureClientBlogAccount(clientId, blogName.trim() || companyName || '업체', {
                amount: amt || null,
                contract_date: date || null,
                goal_count: n,
                manager: managerName || null,
                remain_count: n,
                blog_url: blogUrl.trim() || null, // 입력한 발행 URL → 즉시 크롤 대상으로 연동
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
                <h3 className="m-0 mb-4 text-lg font-bold">
                    {boostPrefix ? `${boostPrefix}상품 추가` : '+ 계약 추가'}
                </h3>
                <div className="grid gap-3">
                    {showCatChips ? (
                        <label className="block text-xs font-semibold text-[#475569]">
                            카테고리
                            <div className="mt-1 flex flex-wrap gap-1.5">
                                {chipCats.map((c) => (
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
                    ) : null}
                    {isService ? (
                        <>
                            <label className="block text-xs font-semibold text-[#475569]">
                                금액 (서비스 · 원)
                                <input
                                    className="mt-1 h-10 w-full rounded-md border border-[#fecaca] px-3 text-right text-sm"
                                    inputMode="numeric"
                                    onChange={(e) => setAmountInput(e.target.value)}
                                    placeholder="100,000"
                                    type="text"
                                    value={withCommas(amountInput)}
                                />
                            </label>
                            <div className="rounded-md bg-[#fff1f2] px-3 py-2 text-xs font-semibold text-[#dc2626]">
                                서비스 — 매출에 −{(Number(onlyDigits(amountInput)) || 0).toLocaleString('ko-KR')}원
                                (실매출 VAT −{withVat(Number(onlyDigits(amountInput)) || 0).toLocaleString('ko-KR')}원)로
                                반영됩니다. 외주비 없음.
                            </div>
                            <label className="block text-xs font-semibold text-[#475569]">
                                서비스 내용 (메모)
                                <textarea
                                    className="mt-1 h-16 w-full rounded-md border border-[#cbd5e1] px-3 py-2 text-sm"
                                    onChange={(e) => setServiceNote(e.target.value)}
                                    placeholder="예: 상세페이지 디자인 무상 제공"
                                    value={serviceNote}
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
                        </>
                    ) : (
                        <>
                    {isEtc ? (
                        <label className="block text-xs font-semibold text-[#475569]">
                            상품명 (기타)
                            <input
                                className="mt-1 h-10 w-full rounded-md border border-[#cbd5e1] bg-white px-3 text-sm"
                                onChange={(e) => setSubtype(e.target.value)}
                                placeholder="상품명 직접 입력 · 금액에 반영"
                                type="text"
                                value={subtype}
                            />
                        </label>
                    ) : (
                        <label className="block text-xs font-semibold text-[#475569]">
                            {boostPrefix ? '넣을 상품(리워드·영수증 등)' : '세부유형'}
                            <select
                                className="mt-1 h-10 w-full rounded-md border border-[#cbd5e1] bg-white px-3 text-sm"
                                onChange={(e) => setSubtype(e.target.value)}
                                value={subtype}
                            >
                                {subOptions.map((s) => (
                                    <option key={s}>{s}</option>
                                ))}
                            </select>
                        </label>
                    )}
                    {isEtc ? null : isShortform ? (
                        <label className="block text-xs font-semibold text-[#475569]">
                            숏폼 종류
                            <div className="mt-1 flex gap-1.5">
                                {SHORTFORM_PLATFORMS.map((p) => (
                                    <button
                                        className={`flex-1 rounded-md border px-3 py-2 text-sm font-bold ${
                                            blogName === p
                                                ? 'border-[#1e40af] bg-[#1e40af] text-white'
                                                : 'border-[#cbd5e1] bg-white text-[#475569] hover:border-[#1e40af]'
                                        }`}
                                        key={p}
                                        onClick={() => setBlogName(blogName === p ? '' : p)}
                                        type="button"
                                    >
                                        {p}
                                    </button>
                                ))}
                            </div>
                        </label>
                    ) : (
                        <label className="block text-xs font-semibold text-[#475569]">
                            {isBrandBlog ? '브랜드 블로그 이름' : '업체명'}
                            <input
                                className="mt-1 h-10 w-full rounded-md border border-[#cbd5e1] bg-white px-3 text-sm"
                                onChange={(e) => setBlogName(e.target.value)}
                                placeholder={
                                    isBrandBlog
                                        ? '관리시트 업체명 (예: 크레인커뮤니케이션A) · 비우면 업체명'
                                        : '업체명(선택) · 같은 카테고리 여러 건 구분용, 카드에 표시'
                                }
                                type="text"
                                value={blogName}
                            />
                        </label>
                    )}
                    {/* 브랜드 블로그 발행 URL — 계약 등록 시 입력하면 그 블로그 계정에 바로 연동(크롤 대상). */}
                    {isBrandBlog ? (
                        <label className="block text-xs font-semibold text-[#475569]">
                            블로그 발행 URL
                            <input
                                className="mt-1 h-10 w-full rounded-md border border-[#cbd5e1] bg-white px-3 text-sm"
                                onChange={(e) => setBlogUrl(e.target.value)}
                                placeholder="https://blog.naver.com/아이디 · 비우면 나중에 시트에서 입력"
                                type="text"
                                value={blogUrl}
                            />
                        </label>
                    ) : null}
                    {isEtc ? (
                        <div className="grid grid-cols-2 gap-2">
                            <label className="block text-xs font-semibold text-[#475569]">
                                수량
                                <input
                                    className="mt-1 h-10 w-full rounded-md border border-[#cbd5e1] px-2 text-right text-sm"
                                    inputMode="numeric"
                                    onChange={(e) => setCount(e.target.value)}
                                    placeholder="1"
                                    type="text"
                                    value={withCommas(count)}
                                />
                            </label>
                            <label className="block text-xs font-semibold text-[#475569]">
                                금액(원)
                                <input
                                    className="mt-1 h-10 w-full rounded-md border border-[#cbd5e1] px-2 text-right text-sm"
                                    inputMode="numeric"
                                    onChange={(e) => setAmountInput(e.target.value)}
                                    placeholder="500,000"
                                    type="text"
                                    value={withCommas(amountInput)}
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
                            <label className="block text-xs font-semibold text-[#475569]">
                                외주업체명
                                <input
                                    className="mt-1 h-10 w-full rounded-md border border-[#fecaca] px-2 text-sm"
                                    onChange={(e) => setOutCompany(e.target.value)}
                                    placeholder="외주업체명"
                                    type="text"
                                    value={outCompany}
                                />
                            </label>
                        </div>
                    ) : (
                        <>
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
                    {/* 외주업체 + 외주비 직접입력 — 외주단가×수량 대신 총액을 바로 입력(기존 등록 건). 입력 시 우선 적용. */}
                    <div className="grid grid-cols-2 gap-2">
                        <label className="block text-xs font-semibold text-[#475569]">
                            외주업체
                            <input
                                className="mt-1 h-10 w-full rounded-md border border-[#fecaca] px-2 text-sm"
                                onChange={(e) => setOutCompany(e.target.value)}
                                placeholder="외주업체명"
                                type="text"
                                value={outCompany}
                            />
                        </label>
                        <label className="block text-xs font-semibold text-[#475569]">
                            외주비(직접입력·원)
                            <input
                                className="mt-1 h-10 w-full rounded-md border border-[#fecaca] px-2 text-right text-sm"
                                inputMode="numeric"
                                onChange={(e) => setOutTotal(e.target.value)}
                                placeholder="총 외주비"
                                type="text"
                                value={withCommas(outTotal)}
                            />
                        </label>
                    </div>
                    {outDirect > 0 ? (
                        <div className="-mt-1 text-[11px] text-[#dc2626]">
                            외주비를 직접 입력해 외주단가×수량 대신 이 값을 사용합니다.
                        </div>
                    ) : null}
                    <div className="rounded-md bg-[#f8fafc] px-3 py-2 text-sm font-semibold text-[#0f172a]">
                        실매출(VAT){' '}
                        <span className="text-[#1e40af]">{saleVat(amt, noVat).toLocaleString('ko-KR')}</span> · 외주{' '}
                        <span className="text-[#dc2626]">{outAmt.toLocaleString('ko-KR')}</span> · 순매출{' '}
                        <span className="text-[#059669]">{(amt - outAmt).toLocaleString('ko-KR')}</span>원
                    </div>
                    {/* 부가세 없음(현금) — 체크 시 실매출에 VAT 10% 미포함 */}
                    <label className="flex items-center gap-1.5 text-xs font-semibold text-[#059669]">
                        <input checked={noVat} onChange={(e) => setNoVat(e.target.checked)} type="checkbox" />
                        부가세 없음 (현금 — 실매출에 VAT 10% 미포함)
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
                        </>
                    )}
                        </>
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
    companyName,
    onClose,
    onReload,
    onToast,
    onEnd,
}: {
    contract: ClientContract;
    companyName: string; // 현재 계약 업체명 — 외주 시트 붙여넣기 업체 대조용
    onClose: () => void;
    onReload: () => Promise<void>;
    onToast: (m: string) => void;
    onEnd: () => void; // 계약 종료 → 업체를 '계약 종료' 탭으로(상태 변경, 삭제 아님)
}) {
    const [goal] = useState(contract.goal_count?.toString() ?? '');
    const [remain, setRemain] = useState(contract.remain_count?.toString() ?? '');
    // 브랜드 블로그면 그 블로그 계정의 발행 URL을 찾아 제목 옆에 표시(클릭 시 실제 블로그로 이동).
    const isBrandContract = isBrandBlogSub(contract.subtype.replace(/^상위노출 보장형 · /, ''));
    const [blogUrl, setBlogUrl] = useState<string | null>(null);
    useEffect(() => {
        if (!isBrandContract) return;
        void getBlogAccounts(contract.client_id).then(({ data }) => {
            // 이름(blog_name/업체명) 일치 우선, 없으면 이 업체의 블로그 계정이 하나뿐이면 그걸로(단일 블로그).
            const acc =
                data.find((a) => a.name === (contract.blog_name || companyName)) ||
                data.find((a) => a.name === contract.blog_name) ||
                (data.length === 1 ? data[0] : undefined);
            const url = (acc?.blog_url || '').trim();
            setBlogUrl(/^https?:\/\//.test(url) ? url : null);
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isBrandContract, contract.client_id, contract.blog_name]);
    const [bulk, setBulk] = useState(''); // N건 일괄 완료 입력
    const [outSheetOpen, setOutSheetOpen] = useState(false); // 외주 시트 붙여넣기 모달
    const [outSheetText, setOutSheetText] = useState(OUT_SHEET_HEADER + '\n');
    const [outUnitEdit, setOutUnitEdit] = useState(contract.unit_outsource?.toString() ?? ''); // 나중 외주단가 입력
    const [outCompanyEdit, setOutCompanyEdit] = useState(contract.outsource_company ?? ''); // 나중 외주업체 입력
    // 받은 외주비(직접) — 비면 미설정(외주단가×수량 자동표시). 0이면 '받은 것 없음'.
    const [outReceivedEdit, setOutReceivedEdit] = useState(
        contract.outsource != null ? String(contract.outsource) : '',
    );
    const [weeklyLogs, setWeeklyLogs] = useState<RewardWeeklyLog[]>(contract.weekly_logs ?? []);
    const [weekInput, setWeekInput] = useState(''); // 리워드 주간 처리 타수
    const [weekPaid, setWeekPaid] = useState(false); // 이번 주 입금 처리 여부
    const [weekNoTax, setWeekNoTax] = useState(false); // 세금계산서 미발행 체크(기본=발행)
    const [editLog, setEditLog] = useState<{ idx: number; value: string } | null>(null); // 진행 이력 타수 수정
    const [amount] = useState(contract.amount?.toString() ?? '');
    const [date, setDate] = useState(contract.contract_date ?? '');
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
    // 금액 기반 진행률 — 완료 외주금액(Σ 배치 외주단가×건수) ÷ 계약금액. 외주 데이터 없으면 건수 %.
    //   live 상태(잔여·진행 이력) 반영. 전량 완료여도 외주단가가 낮으면 100% 미만이 될 수 있음(의도).
    const pct =
        amountProgress({ ...contract, goal_count: goalN, remain_count: remainN, weekly_logs: weeklyLogs }) ?? 0;
    // 재계약/계약 종료 버튼 노출 조건 — 우선 비활성화(사용자 요청). 필요 시 아래 조건 복원.
    //   원래: hasGoal && (remainN <= 5 || pct >= 80)  (잔여 5건 이하 또는 진행률 80%↑)
    const imminent = false;
    // 리워드(일 단위) — 주간 처리: 추천치 = 일일타수 × 7(잔여로 캡), Σ주간로그가 소진과 일치해야 함.
    const isReward = isDailySub(contract.subtype) || contract.subtype.includes('리워드');
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

    // 블로그 계약이면 계약 관리 변경을 블로그 관리 시트(blog_accounts)에 반영 — 진행률·금액·날짜·건수.
    //   블로그 대시보드 = 브랜드 블로그 1:1. 계약 관리가 단일 출처.
    const syncBlog = async (fields: {
        goal_count?: number | null;
        remain_count?: number | null;
        contract_date?: string | null;
        amount?: number | null;
    }) => {
        // 부스트 접두(상위노출 보장형 · )가 붙어도 브랜드블로그면 동기화되게 접두 제거 후 판정.
        if (!isBrandBlogSub(contract.subtype.replace(/^상위노출 보장형 · /, ''))) return;
        await syncBlogAccountFromContract(contract.client_id, fields, contract.blog_name);
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
        await syncBlog({ remain_count: next });
        await onReload();
    };

    // 나중 외주 입력 — 외주단가·외주업체·받은 외주비 저장.
    //   받은 외주비: 입력하면 그 값, 비우면 미설정(외주단가×수량 자동표시). '쓴 외주비'(진행 이력)와 별개.
    const saveOutsource = async () => {
        if (saving) return;
        const unit = outUnitEdit.trim() ? Math.round(evalNum(outUnitEdit)) : null;
        const received = outReceivedEdit.trim() ? Math.round(evalNum(outReceivedEdit)) : null;
        setSaving(true);
        const { error } = await updateClientContract(contract.id, {
            outsource: received, // 받은 외주비(직접) — 비우면 null(단가×수량 자동)
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

    // 계약일자 수정 — 상세페이지에서 바로 변경.
    const saveDate = async (v: string) => {
        if (saving || v === (contract.contract_date ?? '')) return;
        setSaving(true);
        const { error } = await updateClientContract(contract.id, { contract_date: v || null });
        setSaving(false);
        if (error) {
            onToast(`오류: ${error.message}`);
            return;
        }
        await onReload();
    };

    // 리워드 주간 처리 — 잔여(진실의 원천)를 먼저 저장해 게이지/외주비 즉시 반영,
    //   주차 로그는 별도 저장(weekly_logs 컬럼 미생성 시에도 진행은 반영되게).
    const commitWeek = async (count: number, auto: boolean) => {
        if (saving || !hasGoal || count <= 0) return;
        const applied = Math.min(remainN, count); // 잔여 초과 방지
        if (applied <= 0) return;
        const next = remainN - applied;
        // 입력한 외주단가·외주업체를 사용(비면 계약의 기존값). 외주비 = 타수 × 외주단가.
        const unit = outUnitEdit.trim() ? Math.round(evalNum(outUnitEdit)) : contract.unit_outsource ?? null;
        const vendor = outCompanyEdit.trim() || contract.outsource_company || null;
        const log: RewardWeeklyLog = {
            at: new Date().toISOString().slice(0, 10),
            auto,
            count: applied,
            outUnit: unit,
            paid: weekPaid,
            tax: !weekNoTax, // 기본 발행, 미발행 체크 시 false
            vendor,
            week: isoWeek(new Date()),
        };
        const newLogs = [...weeklyLogs, log];
        setRemain(String(next));
        setWeekInput('');
        setWeekPaid(false);
        setWeekNoTax(false);
        setSaving(true);
        // 1) 잔여 + 외주단가/외주업체 저장 — 실패 시 롤백.
        //    외주비 합계(받은 외주비)는 '계약 추가' 때 설정한 값으로만 고정. 진행 처리 입력은 실제 사용 외주비(이력)로만 집계.
        const patch: Partial<ClientContract> = {
            outsource_company: vendor,
            remain_count: next,
            unit_outsource: unit,
        };
        const { error } = await updateClientContract(contract.id, patch);
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
        await syncBlog({ remain_count: next });
        await onReload();
    };

    // 외주 시트 붙여넣기 — 각 행 = 진행 완료 배치 1건(진행 이력에 누적). 수량→건수, 단가→외주단가, 업체명→외주업체, 일자→처리일.
    const importOutsourceSheet = async () => {
        if (saving) return;
        const grid = parseTsvGrid(outSheetText.trim());
        if (grid.length < 2) {
            onToast('머리글 아래에 데이터를 붙여넣으세요.');
            return;
        }
        const H = grid[0].map((s) => s.trim());
        const iQty = findCol(H, ['수량']);
        const iUnit = findCol(H, ['단가']); // 외주단가
        const iVendor = findCol(H, ['품목', '품목명']); // 외주업체명 = 품목명(요약) 컬럼
        const iCompany = findCol(H, ['업체명', '업체']); // 현재 계약 업체 대조
        const iPartner = findCol(H, ['거래처']); // 업체 대조(대체)
        const iDate = findCol(H, ['일자', '날짜']);
        if (iQty < 0) {
            onToast('수량 컬럼을 찾지 못했습니다(머리글 확인).');
            return;
        }
        const myCompany = normCompany(companyName); // 현재 계약 업체
        const today = new Date().toISOString().slice(0, 10);
        let curRemain = remainN;
        let mismatch = 0; // 업체명이 현재 업체와 다른 행(등록 안 함)
        const added: RewardWeeklyLog[] = [];
        for (const c of grid.slice(1)) {
            const g = (idx: number) => (idx >= 0 ? (c[idx] || '').trim() : '');
            const qty = Number(onlyDigits(g(iQty))) || 0;
            if (qty <= 0) continue;
            // 업체 대조 — 시트의 업체명(또는 거래처명)이 현재 계약 업체와 같아야 등록. 다르면 건너뜀.
            const rowCompanies = [g(iCompany), g(iPartner)].map(normCompany).filter(Boolean);
            if (myCompany && rowCompanies.length && !rowCompanies.includes(myCompany)) {
                mismatch += 1;
                continue;
            }
            const applied = Math.min(curRemain, qty);
            if (applied <= 0) break; // 잔여 소진
            const unit = iUnit >= 0 && g(iUnit) ? Math.round(num(g(iUnit))) : contract.unit_outsource ?? null;
            // 품목명 → 회사명 매핑(슈퍼뭉치→에이치에스 등). 매핑 없으면 적힌 값 그대로.
            const rawVendor = g(iVendor);
            const vendor =
                (rawVendor ? vendorFromProduct(productBase(rawVendor)) || rawVendor : '') ||
                contract.outsource_company ||
                null;
            const d = (iDate >= 0 && parseDate(g(iDate))) || today;
            added.push({
                at: d,
                auto: false,
                count: applied,
                outUnit: unit,
                paid: false,
                vendor,
                week: isoWeek(new Date(d)),
            });
            curRemain -= applied;
        }
        if (!added.length) {
            onToast(
                mismatch
                    ? `업체명이 '${companyName}'와 달라 전부 건너뜀(${mismatch}행).`
                    : '처리할 행이 없습니다(수량 없음 또는 잔여 소진).',
            );
            return;
        }
        const next = curRemain;
        const newLogs = [...weeklyLogs, ...added];
        // 받은 외주비(합계)는 계약 추가 값으로 고정 — 시트는 실제 사용(이력)만 추가.
        const patch: Partial<ClientContract> = {
            remain_count: next,
            weekly_logs: newLogs,
            outsource_company: added.at(-1)?.vendor ?? contract.outsource_company ?? null,
            unit_outsource: added.at(-1)?.outUnit ?? contract.unit_outsource ?? null,
        };
        setSaving(true);
        const { error } = await updateClientContract(contract.id, patch);
        setSaving(false);
        if (error) {
            onToast(`오류: ${error.message}`);
            return;
        }
        setRemain(String(next));
        setWeeklyLogs(newLogs);
        await syncBlog({ remain_count: next });
        await onReload();
        setOutSheetOpen(false);
        setOutSheetText(OUT_SHEET_HEADER + '\n');
        onToast(
            `${added.length}건 진행 처리 완료 (잔여 ${next.toLocaleString('ko-KR')})` +
                (mismatch ? ` · 업체 불일치 ${mismatch}행 건너뜀` : ''),
        );
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
            await syncBlog({ remain_count: next });
            await onReload();
        }
    };

    // 진행 이력의 입금 처리/미처리 토글.
    const toggleLogPaid = async (i: number) => {
        if (saving) return;
        const newLogs = weeklyLogs.map((l, j) => (j === i ? { ...l, paid: !l.paid } : l));
        setWeeklyLogs(newLogs);
        setSaving(true);
        const { error } = await updateClientContract(contract.id, { weekly_logs: newLogs });
        setSaving(false);
        if (error) {
            onToast(`오류: ${error.message}`);
            setWeeklyLogs(weeklyLogs);
        } else {
            await onReload();
        }
    };

    // 진행 이력의 세금계산서 발행/미발행 토글(기본 발행). tax !== false = 발행.
    const toggleLogTax = async (i: number) => {
        if (saving) return;
        const newLogs = weeklyLogs.map((l, j) => (j === i ? { ...l, tax: l.tax === false } : l));
        setWeeklyLogs(newLogs);
        setSaving(true);
        const { error } = await updateClientContract(contract.id, { weekly_logs: newLogs });
        setSaving(false);
        if (error) {
            onToast(`오류: ${error.message}`);
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
            await syncBlog({ remain_count: nextRemain });
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
        await syncBlog({
            amount: nextAmount,
            contract_date: s,
            goal_count: nextGoal,
            remain_count: nextRemain,
        });
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
            <div className="max-h-[92vh] w-[min(760px,96vw)] overflow-y-auto rounded-2xl bg-white p-6">
                <h3 className="m-0 flex flex-wrap items-center gap-2 text-lg font-bold">
                    <span>
                        {contract.category} · {contract.subtype}
                    </span>
                    {blogUrl ? (
                        <a
                            className="rounded-full bg-[#ede9fe] px-2.5 py-0.5 text-[12px] font-semibold text-[#7c3aed] hover:bg-[#ddd6fe] hover:underline"
                            href={blogUrl}
                            onClick={(e) => e.stopPropagation()}
                            rel="noopener noreferrer"
                            target="_blank"
                            title="실제 블로그로 이동"
                        >
                            🔗 {blogUrl.replace(/^https?:\/\//, '')}
                        </a>
                    ) : null}
                </h3>

                {/* 계약일자 — 상세페이지에서 바로 수정 */}
                <label className="mt-2 flex items-center gap-2 text-xs font-semibold text-[#475569]">
                    계약일자
                    <input
                        className="h-8 rounded-md border border-[#cbd5e1] px-2 text-sm"
                        onChange={(e) => setDate(e.target.value)}
                        onBlur={(e) => void saveDate(e.target.value)}
                        type="date"
                        value={date}
                    />
                </label>

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
                                              {/* 기자단 3.3% 원천징수 — 참고 표시(계산 미반영) */}
                                              {contract.category === '블로그' ? (
                                                  <div className="text-[9px] text-[#94a3b8]">
                                                      3.3% 공제 {fmtWon(Math.round(o.total * 0.967))}원
                                                  </div>
                                              ) : null}
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
                                    <div className="flex gap-1">
                                        <button
                                            className="rounded-md border border-[#1e40af] bg-white px-2 py-1 text-[11px] font-semibold text-[#1e40af] hover:bg-[#eef2ff] disabled:opacity-50"
                                            disabled={saving}
                                            onClick={() => setOutSheetOpen(true)}
                                            type="button"
                                        >
                                            시트 붙여넣기
                                        </button>
                                        <button
                                            className="rounded-md border border-[#93c5fd] px-2 py-1 text-[11px] font-semibold text-[#1e40af] hover:bg-[#dbeafe] disabled:opacity-50"
                                            disabled={saving}
                                            onClick={() => void saveOutsource()}
                                            type="button"
                                        >
                                            외주 저장
                                        </button>
                                    </div>
                                </div>
                                <div className="mt-0.5 text-right text-[10px] text-[#64748b]">
                                    {perDay > 0
                                        ? `일일 ${perDay.toLocaleString('ko-KR')}타 · 주 추천 ${weekRec.toLocaleString('ko-KR')}타`
                                        : '일일 타수 미저장 — 직접 입력'}
                                </div>
                                {/* 외주단가·외주업체 — 입력값으로 외주비 계산(로그에도 반영) */}
                                <div className="mt-2 grid grid-cols-2 gap-1.5">
                                    <label className="block text-[11px] font-semibold text-[#475569]">
                                        외주단가(원)
                                        <input
                                            className="mt-0.5 h-9 w-full rounded-md border border-[#fecaca] px-2 text-right text-sm"
                                            onChange={(e) => setOutUnitEdit(sanitizeExpr(e.target.value))}
                                            placeholder="예: 33 · 식 입력 가능(64000/4)"
                                            value={displayExpr(outUnitEdit)}
                                        />
                                        {EXPR_CHARS.test(outUnitEdit) && evalNum(outUnitEdit) > 0 ? (
                                            <span className="mt-0.5 block text-right text-[10px] font-bold text-[#dc2626]">
                                                = {Math.round(evalNum(outUnitEdit)).toLocaleString('ko-KR')}원
                                            </span>
                                        ) : null}
                                    </label>
                                    <label className="block text-[11px] font-semibold text-[#475569]">
                                        외주업체명
                                        <input
                                            className="mt-0.5 h-9 w-full rounded-md border border-[#fecaca] px-2 text-sm"
                                            onChange={(e) => setOutCompanyEdit(e.target.value)}
                                            placeholder="외주업체명"
                                            value={outCompanyEdit}
                                        />
                                    </label>
                                </div>
                                {/* 받은 외주비(직접) — 업체한테 받은 금액. 안 받았으면 비워두거나 0. '쓴 외주비'와 별개 */}
                                <label className="mt-1.5 block text-[11px] font-semibold text-[#059669]">
                                    받은 외주비(원) — 안 받았으면 비워두세요
                                    <input
                                        className="mt-0.5 h-9 w-full rounded-md border border-[#bbf7d0] px-2 text-right text-sm"
                                        onChange={(e) => setOutReceivedEdit(sanitizeExpr(e.target.value))}
                                        placeholder="받은 외주비(직접 입력)"
                                        value={displayExpr(outReceivedEdit)}
                                    />
                                </label>
                                {/* 입금 처리/미처리 토글 — 로그에 함께 기록 */}
                                <div className="mt-2 flex gap-2">
                                    <button
                                        className={`flex-1 rounded-md py-2 text-sm font-extrabold ${
                                            weekPaid
                                                ? 'bg-[#059669] text-white'
                                                : 'border border-[#cbd5e1] bg-white text-[#94a3b8]'
                                        }`}
                                        onClick={() => setWeekPaid(true)}
                                        type="button"
                                    >
                                        입금 처리
                                    </button>
                                    <button
                                        className={`flex-1 rounded-md py-2 text-sm font-extrabold ${
                                            !weekPaid
                                                ? 'bg-[#dc2626] text-white'
                                                : 'border border-[#cbd5e1] bg-white text-[#94a3b8]'
                                        }`}
                                        onClick={() => setWeekPaid(false)}
                                        type="button"
                                    >
                                        입금 미처리
                                    </button>
                                </div>
                                {/* 세금계산서 — 기본 발행. 체크하면 이번 배치는 미발행으로 기록 */}
                                <label className="mt-2 flex items-center gap-1.5 text-[12px] font-semibold text-[#b45309]">
                                    <input
                                        checked={weekNoTax}
                                        onChange={(e) => setWeekNoTax(e.target.checked)}
                                        type="checkbox"
                                    />
                                    세금계산서 미발행 (체크 안 하면 발행으로 기록)
                                </label>
                                <div className="mt-2 text-[11px] font-bold text-[#1e40af]">이번 주 처리 타수</div>
                                <div className="mt-1 flex items-center gap-1.5">
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
                                {Number(onlyDigits(weekInput)) > 0 &&
                                (evalNum(outUnitEdit) || contract.unit_outsource || 0) > 0 ? (
                                    <div className="mt-1 text-right text-[11px] text-[#64748b]">
                                        이번 주 소진 외주비 ≈{' '}
                                        <b className="text-[#dc2626]">
                                            {fmtWon(
                                                Math.min(remainN, Number(onlyDigits(weekInput))) *
                                                    (evalNum(outUnitEdit) ||
                                                        contract.unit_outsource ||
                                                        0),
                                            )}
                                            원
                                        </b>
                                    </div>
                                ) : null}
                            </div>
                            </>
                        ) : (
                            <div className="mt-3 rounded-lg border border-[#dbeafe] bg-[#eff6ff] px-3 py-4 text-left">
                                <div className="flex items-center justify-between">
                                    <span className="text-sm font-bold text-[#1e40af]">진행 처리</span>
                                    <div className="flex gap-1">
                                        <button
                                            className="rounded-md border border-[#1e40af] bg-white px-2 py-1 text-[11px] font-semibold text-[#1e40af] hover:bg-[#eef2ff] disabled:opacity-50"
                                            disabled={saving}
                                            onClick={() => setOutSheetOpen(true)}
                                            type="button"
                                        >
                                            시트 붙여넣기
                                        </button>
                                        <button
                                            className="rounded-md border border-[#93c5fd] px-2 py-1 text-[11px] font-semibold text-[#1e40af] hover:bg-[#dbeafe] disabled:opacity-50"
                                            disabled={saving}
                                            onClick={() => void saveOutsource()}
                                            type="button"
                                        >
                                            외주 저장
                                        </button>
                                    </div>
                                </div>
                                {/* 외주단가·외주업체 — 리워드와 동일 구조. 완료 처리 시 이 값으로 외주비 계산·로그 기록 */}
                                <div className="mt-2 grid grid-cols-2 gap-1.5">
                                    <label className="block text-[11px] font-semibold text-[#475569]">
                                        외주단가(원)
                                        <input
                                            className="mt-0.5 h-9 w-full rounded-md border border-[#fecaca] px-2 text-right text-sm"
                                            onChange={(e) => setOutUnitEdit(sanitizeExpr(e.target.value))}
                                            placeholder="예: 8,000 · 식 입력 가능(64000/4)"
                                            value={displayExpr(outUnitEdit)}
                                        />
                                        {EXPR_CHARS.test(outUnitEdit) && evalNum(outUnitEdit) > 0 ? (
                                            <span className="mt-0.5 block text-right text-[10px] font-bold text-[#dc2626]">
                                                = {Math.round(evalNum(outUnitEdit)).toLocaleString('ko-KR')}원
                                            </span>
                                        ) : null}
                                    </label>
                                    <label className="block text-[11px] font-semibold text-[#475569]">
                                        외주업체명
                                        <input
                                            className="mt-0.5 h-9 w-full rounded-md border border-[#fecaca] px-2 text-sm"
                                            onChange={(e) => setOutCompanyEdit(e.target.value)}
                                            placeholder="외주업체명"
                                            value={outCompanyEdit}
                                        />
                                    </label>
                                </div>
                                {/* 받은 외주비(직접) — 업체한테 받은 금액. 안 받았으면 비워두거나 0. '쓴 외주비'와 별개 */}
                                <label className="mt-1.5 block text-[11px] font-semibold text-[#059669]">
                                    받은 외주비(원) — 안 받았으면 비워두세요
                                    <input
                                        className="mt-0.5 h-9 w-full rounded-md border border-[#bbf7d0] px-2 text-right text-sm"
                                        onChange={(e) => setOutReceivedEdit(sanitizeExpr(e.target.value))}
                                        placeholder="받은 외주비(직접 입력)"
                                        value={displayExpr(outReceivedEdit)}
                                    />
                                </label>
                                {/* 입금 처리/미처리 토글 */}
                                <div className="mt-2 flex gap-2">
                                    <button
                                        className={`flex-1 rounded-md py-2 text-sm font-extrabold ${
                                            weekPaid
                                                ? 'bg-[#059669] text-white'
                                                : 'border border-[#cbd5e1] bg-white text-[#94a3b8]'
                                        }`}
                                        onClick={() => setWeekPaid(true)}
                                        type="button"
                                    >
                                        입금 처리
                                    </button>
                                    <button
                                        className={`flex-1 rounded-md py-2 text-sm font-extrabold ${
                                            !weekPaid
                                                ? 'bg-[#dc2626] text-white'
                                                : 'border border-[#cbd5e1] bg-white text-[#94a3b8]'
                                        }`}
                                        onClick={() => setWeekPaid(false)}
                                        type="button"
                                    >
                                        입금 미처리
                                    </button>
                                </div>
                                {/* 세금계산서 — 기본 발행. 체크하면 이번 배치는 미발행으로 기록 */}
                                <label className="mt-2 flex items-center gap-1.5 text-[12px] font-semibold text-[#b45309]">
                                    <input
                                        checked={weekNoTax}
                                        onChange={(e) => setWeekNoTax(e.target.checked)}
                                        type="checkbox"
                                    />
                                    세금계산서 미발행 (체크 안 하면 발행으로 기록)
                                </label>
                                {/* 되돌리기 — +1건 완료 제거(수기 입력으로 처리). 마지막 기록 취소용만 유지 */}
                                <div className="mt-2">
                                    <button
                                        className="w-full rounded-md border border-[#cbd5e1] bg-white px-3 py-2 text-sm font-semibold text-[#475569] hover:bg-[#f1f5f9] disabled:opacity-50"
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
                                {/* 처리 건수 수기 입력 — 진행 이력에 기록 남김 */}
                                <div className="mt-2 flex items-center gap-1.5">
                                    <input
                                        className="h-9 w-full rounded-md border border-[#93c5fd] bg-white px-2 text-sm"
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
                                {Number(onlyDigits(bulk)) > 0 &&
                                (evalNum(outUnitEdit) || contract.unit_outsource || 0) > 0 ? (
                                    <div className="mt-1 text-right text-[11px] text-[#64748b]">
                                        이번 처리 소진 외주비 ≈{' '}
                                        <b className="text-[#dc2626]">
                                            {fmtWon(
                                                Math.min(remainN, Number(onlyDigits(bulk))) *
                                                    (evalNum(outUnitEdit) ||
                                                        contract.unit_outsource ||
                                                        0),
                                            )}
                                            원
                                        </b>
                                    </div>
                                ) : null}
                            </div>
                        )}
                        {/* 진행 이력 — 리워드/일반 공통(완료 처리마다 외주비 사용량 기록, 삭제 시 되돌림) */}
                        {hasGoal ? (
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
                                                <button
                                                    className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${
                                                        l.paid
                                                            ? 'bg-[#dcfce7] text-[#16a34a]'
                                                            : 'bg-[#fee2e2] text-[#dc2626]'
                                                    }`}
                                                    disabled={saving}
                                                    onClick={() => void toggleLogPaid(i)}
                                                    title="클릭해서 처리/미처리 전환"
                                                    type="button"
                                                >
                                                    {l.paid ? '처리' : '미처리'}
                                                </button>
                                                <button
                                                    className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${
                                                        l.tax === false
                                                            ? 'bg-[#fef3c7] text-[#b45309]'
                                                            : 'bg-[#e0e7ff] text-[#4338ca]'
                                                    }`}
                                                    disabled={saving}
                                                    onClick={() => void toggleLogTax(i)}
                                                    title="클릭해서 세금계산서 발행/미발행 전환"
                                                    type="button"
                                                >
                                                    {l.tax === false ? '계산서 미발행' : '계산서 발행'}
                                                </button>
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
                                                {l.vendor ? (
                                                    <span className="shrink-0 whitespace-nowrap rounded bg-[#fee2e2] px-1.5 py-0.5 text-[10px] font-bold text-[#dc2626]">
                                                        {l.vendor}
                                                    </span>
                                                ) : null}
                                                {(l.outUnit || contract.unit_outsource || 0) > 0 ? (
                                                    <span className="shrink-0 whitespace-nowrap text-[11px] font-semibold text-[#dc2626]">
                                                        {fmtWon(l.count * (l.outUnit || contract.unit_outsource || 0))}원
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
                                        실매출(VAT){' '}
                                        <span className="text-[#1e40af]">{withVat(reSales).toLocaleString('ko-KR')}</span> ·
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
                            <div className="flex gap-2">
                                <button
                                    className="flex-1 rounded-md bg-[#059669] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#047857]"
                                    onClick={() => setRenewMode(true)}
                                    type="button"
                                >
                                    재계약
                                </button>
                                <button
                                    className="flex-1 rounded-md bg-[#dc2626] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#b91c1c]"
                                    onClick={onEnd}
                                    type="button"
                                >
                                    계약 종료
                                </button>
                            </div>
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

                {/* 외주 시트 붙여넣기 — 머리글 아래 데이터 붙여넣으면 각 행 = 진행 완료 배치(실제 사용 외주비) */}
                {outSheetOpen ? (
                    <div
                        className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
                        onMouseDown={(e) => e.target === e.currentTarget && setOutSheetOpen(false)}
                    >
                        <div className="w-[min(640px,95vw)] rounded-2xl bg-white p-6">
                            <h3 className="m-0 text-lg font-bold">외주 시트 붙여넣기</h3>
                            <p className="mt-1 mb-3 text-sm text-[#64748b]">
                                <b>맨 윗줄(머리글)은 그대로 두고</b> 그 아래에 시트 행을 붙여넣으세요(탭 구분).
                                각 행 = <b>진행 완료 1건</b>으로 이력에 쌓입니다 — <b>수량→건수 · 단가→외주단가 · 업체명→외주업체 · 일자→처리일.</b>
                                <br />
                                실제 사용 외주비 = Σ(건수×외주단가)로 자동 반영(잔여만큼만). <b>받은 외주비 합계는 계약 추가 때 값으로 고정.</b>
                            </p>
                            <textarea
                                className="min-h-[200px] w-full resize-y rounded-md border-2 border-dashed border-[#cbd5e1] bg-[#f8fafc] px-3 py-2 font-mono text-xs"
                                onChange={(e) => setOutSheetText(e.target.value)}
                                spellCheck={false}
                                value={outSheetText}
                            />
                            <div className="mt-4 flex justify-end gap-2">
                                <button
                                    className="rounded-md border border-[#cbd5e1] px-4 py-2 text-sm font-semibold text-[#64748b]"
                                    onClick={() => setOutSheetOpen(false)}
                                    type="button"
                                >
                                    닫기
                                </button>
                                <button
                                    className="rounded-md bg-[#1e40af] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                                    disabled={saving}
                                    onClick={() => void importOutsourceSheet()}
                                    type="button"
                                >
                                    {saving ? '처리 중…' : '진행 처리'}
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
                                        ['실매출 (VAT 포함)', `${fmtWon(withVat(periodDetail.amount))}원`, '#1e40af'],
                                        ['외주업체', contract.outsource_company || '-'],
                                        ['외주단가', `${fmtWon(periodDetail.unitOutsource)}원`],
                                        ['외주비', `${fmtWon(periodDetail.outsource)}원`, '#dc2626'],
                                        [
                                            '순매출 (공급가 − 외주비)',
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
    const [pasteOpen, setPasteOpen] = useState(false); // 시트 붙여넣기로 계약 추가
    const [boostAdd, setBoostAdd] = useState<ClientContract | null>(null); // 상위노출 보장형 2차 등록 대상
    const [boostSheet, setBoostSheet] = useState<ClientContract | null>(null); // 상위노출 보장형 회차 시트 붙여넣기 대상
    const [boostSheetText, setBoostSheetText] = useState(OUT_SHEET_HEADER + '\n');
    const [boostSaving, setBoostSaving] = useState(false);
    const [editContract, setEditContract] = useState<ClientContract | null>(null);
    const [endOpen, setEndOpen] = useState(false); // 상단 계약 종료 모달(히스토리 입력)
    const [endNote, setEndNote] = useState('');
    const [custAcctOpen, setCustAcctOpen] = useState(false); // 고객 ERP 계정 발급 모달
    const [custAcct, setCustAcct] = useState<{ email: string | null; name: string | null } | null>(null); // 발급된 고객 계정
    const { isAdmin } = useAuth(); // 고객 계정 발급은 관리자만
    // 이 업체의 고객 ERP 계정 조회 — 있으면 발급 버튼 대신 아이디 표시.
    const loadCustAcct = async () => {
        const { data } = await getCustomerAccount(client.id);
        setCustAcct(data);
    };
    useEffect(() => {
        if (isAdmin) void loadCustAcct();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [client.id, isAdmin]);
    const [breakdown, setBreakdown] = useState<'net' | 'outsource' | 'sales' | null>(null); // 상품별 내역
    const [detailC, setDetailC] = useState<ClientContract | null>(null); // 내역에서 상품 클릭 시 상세
    const [expandedOut, setExpandedOut] = useState<string | null>(null); // 외주비 정산 사용 이력 펼침 대상(계약 id)
    const [bulkDeleting, setBulkDeleting] = useState(false); // 계약 내역 일괄삭제(임시 버튼)

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

    // 상위노출 보장형 컨테이너: 회차·시작/종료일 인라인 저장.
    const saveBoostMeta = async (ct: ClientContract, patch: Partial<ClientContract>) => {
        const { error } = await updateClientContract(ct.id, patch);
        if (error) {
            onToast('저장 실패');
            return;
        }
        await onReloadContracts();
    };

    // 상위노출 보장형 회차 시트 붙여넣기 — 각 행 = 컨테이너 옆 자식 카드 1개(구매 배치).
    //   컬럼: 거래처명=외주업체(리브리 등), 업체명=고객사(대조), 품목명=상품(→세부유형), 수량=건수, 단가=외주단가.
    //   외주비 합계(받은)는 외주단가×수량으로 자동 표시 — 세부 값은 각 카드에서 직접 수정.
    const importBoostSheet = async (container: ClientContract) => {
        if (boostSaving) return;
        const grid = parseTsvGrid(boostSheetText.trim());
        if (grid.length < 2) {
            onToast('머리글 아래에 데이터를 붙여넣으세요.');
            return;
        }
        const H = grid[0].map((s) => s.trim());
        const iQty = findCol(H, ['수량']);
        const iUnit = findCol(H, ['단가']); // 외주단가
        const iVendor = findCol(H, ['거래처']); // 외주업체 = 거래처명(리브리/라인업애드)
        const iProduct = findCol(H, ['품목']); // 품목명 → 세부유형
        const iClient = findCol(H, ['업체명', '업체']); // 고객사 대조
        const iDate = findCol(H, ['일자', '날짜']);
        if (iQty < 0 || iUnit < 0) {
            onToast('수량·단가 컬럼을 찾지 못했습니다(머리글 확인).');
            return;
        }
        const myCompany = normCompany(client.company || '');
        const cleanVendor = (s: string) => s.replace(/주식회사|㈜|\(주\)/g, '').trim();
        const today = todayStr();
        let mismatch = 0;
        const rows: Array<Partial<ClientContract>> = [];
        for (const c of grid.slice(1)) {
            const g = (idx: number) => (idx >= 0 ? (c[idx] || '').trim() : '');
            const qty = Number(onlyDigits(g(iQty))) || 0;
            const unit = Math.round(num(g(iUnit)));
            if (qty <= 0) continue;
            // 고객사 대조 — 업체명이 이 계약 고객사와 같아야 등록.
            if (myCompany && g(iClient) && normCompany(g(iClient)) !== myCompany) {
                mismatch += 1;
                continue;
            }
            const base = productBase(g(iProduct));
            const mp = mapProduct(base, unit);
            const sub = 'exclude' in mp ? base || '기타' : mp.subtype;
            const vendor = cleanVendor(g(iVendor)) || (base ? vendorFromProduct(base) : null) || null;
            const d = (iDate >= 0 && parseDate(g(iDate))) || today;
            const d2 = new Date(d);
            rows.push({
                amount: 0,
                category: container.category, // 컨테이너 카테고리로 고정
                client_id: container.client_id,
                contract_date: d,
                goal_count: qty,
                // 이 컨테이너(회차)로 명시적 귀속 — 그 회차 박스에만 들어감.
                parent_id: container.id,
                // 받은 외주비 = 0(빈값) — 나중에 카드에서 직접 입력. 시트 값은 '쓴(사용) 외주비'.
                outsource: 0,
                outsource_company: vendor,
                remain_count: qty,
                sheet_approved: true,
                subtype: `${container.subtype} · ${sub}`, // 컨테이너 하위(카드로 표시)
                unit_outsource: unit || null,
                // 쓴(사용) 외주비 = 수량×외주단가 → 진행 이력 1건으로 기록.
                weekly_logs: unit
                    ? [
                          {
                              at: d,
                              auto: false,
                              count: qty,
                              outUnit: unit,
                              paid: false,
                              vendor,
                              week: isoWeek(d2),
                          },
                      ]
                    : [],
            });
        }
        if (!rows.length) {
            onToast(
                mismatch
                    ? `업체명이 '${client.company}'와 달라 전부 건너뜀(${mismatch}행).`
                    : '처리할 행이 없습니다(수량 확인).',
            );
            return;
        }
        setBoostSaving(true);
        const { error } = await insertClientContracts(rows);
        setBoostSaving(false);
        if (error) {
            onToast(`오류: ${error.message}`);
            return;
        }
        onToast(`${rows.length}개 카드 추가됨`);
        setBoostSheet(null);
        setBoostSheetText(OUT_SHEET_HEADER + '\n');
        await onReloadContracts();
    };

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

    // 컨테이너(종합광고·상위노출 보장형) + 그 하위 상품 통째 삭제.
    const deleteContainer = async (parent: ClientContract) => {
        // 이 컨테이너(회차)와 그 하위만 삭제 — 같은 subtype의 다른 회차 자식은 건드리지 않음.
        const siblings = contracts
            .filter((c) => c.category === parent.category && c.subtype === parent.subtype)
            .sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));
        const legacyOwner = (child: ClientContract) => {
            let pick = siblings[0];
            for (const p of siblings) if ((p.created_at || '') <= (child.created_at || '')) pick = p;
            return pick?.id;
        };
        const targets = contracts.filter(
            (c) =>
                c.id === parent.id ||
                c.parent_id === parent.id ||
                (c.category === parent.category &&
                    c.subtype.startsWith(parent.subtype + ' · ') &&
                    !c.parent_id &&
                    legacyOwner(c) === parent.id),
        );
        if (
            !window.confirm(
                `'${parent.subtype}'와(과) 하위 상품 ${targets.length - 1}건을 모두 삭제할까요? 되돌릴 수 없습니다.`,
            )
        )
            return;
        for (const t of targets) {
            await deleteClientContract(t.id);
        }
        await onReloadContracts();
        onToast(`'${parent.subtype}' 삭제됨`);
    };

    // 카테고리별 합계 + 총액.
    const catAmount = (label: string) =>
        contracts.filter((ct) => ct.category === label).reduce((s, ct) => s + (ct.amount || 0), 0);
    // 실매출(VAT 포함) — 계약별로 부가세 없음(현금)이면 VAT 미포함. 합산은 계약별로.
    const totalReal = contracts.reduce((s, ct) => s + saleVat(ct.amount, ct.no_vat), 0);
    const totalSupply = contracts.reduce((s, ct) => s + (ct.amount || 0), 0); // 공급가(VAT 제외) 합계
    const totalOutsource = contracts.reduce((s, ct) => s + (ct.outsource || 0), 0); // 외주비 합계(받은·고정)
    // 순매출 = 공급가(VAT 제외) − 외주비 정산 차액(예상 외주비 − 실제 사용). (차액 = outMargin, 아래에서 계산)

    // 외주비 정산 — 품목별로 받은 외주비(단가×계약수량) vs 실제 사용 외주비(완료분 소진).
    //   실제 사용 = 진행 처리(완료)로 잔여가 줄면 자동 반영. 별도 수기 입력 없음.
    const outsourceRows = contracts
        .filter((ct) => (ct.outsource || 0) > 0 || (ct.unit_outsource || 0) > 0 || (ct.weekly_logs?.length ?? 0) > 0)
        .map((ct) => {
            const o = outsourceOf(ct);
            const logs = ct.weekly_logs ?? [];
            const used = usedOutsourceOf(ct); // 실제 사용(소진) — 상단 KPI와 동일 공식
            return {
                ct,
                id: ct.id,
                subtype: ct.subtype,
                date: ct.contract_date,
                received: o.total,
                used,
                logs, // 사용(완료) 이력 — 개별 삭제 대상
            };
        });
    const receivedTotal = totalOutsource; // 예상(받은) 외주비 = 상단 외주비 합계
    const usedTotal = outsourceRows.reduce((s, r) => s + r.used, 0); // 실제 사용 = 진행 이력 합
    const outMargin = receivedTotal - usedTotal; // 차액 = 예상 − 사용
    // 순매출 = 공급가(VAT 제외) − 외주비 정산 차액.
    const netRevenue = totalSupply - outMargin;

    // (외주비 정산 내역의 삭제 버튼은 제거 — 외주비/사용이력 삭제는 계약(카드/진행 이력)에서만)
    // 계약 내역 일괄삭제(임시 버튼) — 이 업체의 모든 계약행 제거. 되돌릴 수 없음.
    const deleteAllContracts = async () => {
        if (!contracts.length || bulkDeleting) return;
        if (!window.confirm(`이 업체의 계약 ${contracts.length}건을 모두 삭제할까요?\n(되돌릴 수 없습니다)`)) return;
        setBulkDeleting(true);
        let failed = 0;
        for (const ct of contracts) {
            const { error } = await deleteClientContract(ct.id);
            if (error) failed += 1;
        }
        setBulkDeleting(false);
        await onReloadContracts();
        onToast(failed ? `삭제 완료 — 실패 ${failed}건` : `계약 ${contracts.length}건 전체 삭제됨`);
    };

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
                {!confirmDel && isAdmin ? (
                    custAcct ? (
                        // 이미 발급된 고객 계정 — 발급 버튼 대신 고객 아이디 표시(클릭 시 재발급/비번재설정 모달).
                        <button
                            className="rounded-md border border-[#c7d2fe] bg-[#eef2ff] px-3 py-1.5 text-left text-xs font-semibold text-[#4338ca] hover:bg-[#e0e7ff]"
                            onClick={() => setCustAcctOpen(true)}
                            title="고객 ERP 계정 — 클릭하면 재발급/비밀번호 재설정"
                            type="button"
                        >
                            <span className="block text-[10px] font-normal text-[#818cf8]">고객 ERP 아이디</span>
                            {custAcct.email}
                        </button>
                    ) : (
                        <button
                            className="rounded-md border border-[#7c3aed] bg-white px-3 py-1.5 text-sm font-semibold text-[#7c3aed] hover:bg-[#f5f3ff]"
                            onClick={() => setCustAcctOpen(true)}
                            title="이 업체 전용 열람 계정(고객 ERP) 발급"
                            type="button"
                        >
                            고객 ERP 발급
                        </button>
                    )
                ) : null}
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

            {/* 누적 금액 — 순매출 = 실매출 − 외주비 정산 차액. 순매출·실매출·차액 누르면 상품별 내역 */}
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
                    <div className="text-[11px] font-semibold text-[#94a3b8]">공급가 (VAT 제외)</div>
                    <div className="mt-0.5 text-lg font-bold text-[#1e40af] sm:text-2xl">
                        {fmtWon(totalSupply)}원
                    </div>
                    <div className="mt-0.5 text-[10px] text-[#94a3b8]">
                        실매출 {fmtWon(totalReal)}원 (VAT 포함)
                    </div>
                </button>
                <div className="flex items-center text-xl font-bold text-[#94a3b8]">−</div>
                <button
                    className="flex-1 rounded-xl border border-[#e2e8f0] bg-white px-3 py-3 text-center shadow-sm transition hover:border-[#dc2626] hover:shadow-md"
                    onClick={() => setBreakdown('outsource')}
                    type="button"
                >
                    <div className="text-[11px] font-semibold text-[#94a3b8]">외주비 차액</div>
                    <div className="mt-0.5 text-lg font-bold text-[#dc2626] sm:text-2xl">
                        {fmtWon(outMargin)}원
                    </div>
                    <div className="mt-0.5 text-[10px] text-[#94a3b8]">
                        예상 {fmtWon(receivedTotal)} · 사용 {fmtWon(usedTotal)}
                    </div>
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

            {/* 외주비 정산 — 품목별 받은 외주비 − 실제 사용 외주비(진행 처리 완료분 자동 반영) = 차액. 순매출엔 미반영. */}
            <div className="rounded-xl border border-[#e2e8f0] bg-white p-3">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                    <h3 className="m-0 text-sm font-bold text-[#0f172a]">외주비 정산</h3>
                    <span className="text-[11px] text-[#94a3b8]">
                        업체한테 받을 예상 외주비 − 실제 사용 외주비(진행 완료분) = 우리 차액
                    </span>
                </div>
                <div className="mb-2 grid grid-cols-3 gap-2">
                    <div className="rounded-lg border border-[#bbf7d0] bg-[#f0fdf4] px-3 py-2 text-center">
                        <div className="text-[11px] font-semibold text-[#059669]">예상 외주비</div>
                        <div className="text-base font-bold text-[#059669]">{fmtWon(receivedTotal)}원</div>
                    </div>
                    <div className="rounded-lg border border-[#fecaca] bg-[#fff7f7] px-3 py-2 text-center">
                        <div className="text-[11px] font-semibold text-[#dc2626]">실제 사용 외주비</div>
                        <div className="text-base font-bold text-[#dc2626]">{fmtWon(usedTotal)}원</div>
                    </div>
                    <div className="rounded-lg border-2 border-[#1e40af] bg-[#eff6ff] px-3 py-2 text-center">
                        <div className="text-[11px] font-semibold text-[#1e40af]">차액</div>
                        <div className="text-base font-bold text-[#1e40af]">{fmtWon(outMargin)}원</div>
                    </div>
                </div>
                {/* 품목별 한 줄 — 받은/사용을 같은 줄에 나란히(품목이 섞이지 않게). 사용액은 진행 처리 완료 시 자동 누적. */}
                {outsourceRows.length ? (
                    <div className="overflow-hidden rounded-lg border border-[#e2e8f0]">
                        <div className="grid grid-cols-[1fr_auto_auto] gap-2 bg-[#f8fafc] px-3 py-1.5 text-[11px] font-semibold text-[#94a3b8]">
                            <span>품목</span>
                            <span className="w-24 text-right text-[#059669]">예상 외주비</span>
                            <span className="w-24 text-right text-[#dc2626]">실제 사용</span>
                        </div>
                        {outsourceRows.map((r) => (
                            <div className="border-t border-[#f1f5f9]" key={r.id}>
                                <div className="grid grid-cols-[1fr_auto_auto] items-center gap-2 px-3 py-1.5 text-[11px] hover:bg-[#f8fafc]">
                                    <button
                                        className="flex min-w-0 items-center text-left disabled:cursor-default"
                                        disabled={!r.logs.length}
                                        onClick={() => setExpandedOut(expandedOut === r.id ? null : r.id)}
                                        type="button"
                                    >
                                        <span className="min-w-0 truncate text-[#475569]">
                                            {r.logs.length ? (
                                                <span className="text-[#94a3b8]">
                                                    {expandedOut === r.id ? '▾' : '▸'}{' '}
                                                </span>
                                            ) : null}
                                            {r.subtype}
                                            {/* 리워드 업체명(외주업체) — 플레이스 리워드 옆에 칩으로 함께 표시 */}
                                            {r.ct.outsource_company ? (
                                                <span className="ml-1 rounded-full bg-[#fee2e2] px-1.5 py-0.5 text-[10px] font-extrabold text-[#dc2626]">
                                                    {r.ct.outsource_company}
                                                </span>
                                            ) : null}
                                            {r.date ? <span className="text-[#cbd5e1]"> · {r.date}</span> : null}
                                        </span>
                                    </button>
                                    <b className="w-24 text-right text-[#059669]">{fmtWon(r.received)}원</b>
                                    <b className="w-24 text-right text-[#dc2626]">{fmtWon(r.used)}원</b>
                                </div>
                                {/* 사용 이력 펼침 — 각 완료 기록 삭제(잔여 복원, 진행 이력과 동기화) */}
                                {expandedOut === r.id && r.logs.length ? (
                                    <div className="grid gap-1 bg-[#fff7f7] px-3 py-1.5">
                                        {r.logs.map((l, i) => (
                                            <div
                                                className="flex items-center justify-between gap-2 rounded bg-white px-2 py-1 text-[11px]"
                                                key={i}
                                            >
                                                <span className="min-w-0 truncate text-[#475569]">
                                                    {isDailySub(r.subtype) || r.subtype.includes('리워드')
                                                        ? `${i + 1}주차`
                                                        : `${i + 1}회`}
                                                    {l.at ? ` · ${l.at}` : ''} · {l.count.toLocaleString('ko-KR')}
                                                    {isDailySub(r.subtype) || r.subtype.includes('리워드') ? '타' : '건'}
                                                    {' × '}
                                                    {fmtWon(l.outUnit || r.ct.unit_outsource || 0)}원
                                                </span>
                                                <b className="shrink-0 text-[#dc2626]">
                                                    {fmtWon((l.count || 0) * (l.outUnit || r.ct.unit_outsource || 0))}원
                                                </b>
                                            </div>
                                        ))}
                                    </div>
                                ) : null}
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="text-[11px] text-[#94a3b8]">외주비 내역 없음</div>
                )}
            </div>

            {/* 플레이스 순위 URL — 계약 관리 홈페이지 URL과 별개. 순위 트래커에 연결 */}
            <PlaceUrlField clientId={client.id} clientName={client.company || ''} />

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
                <button
                    className="rounded-md border border-[#1e40af] px-3 py-1 text-xs font-semibold text-[#1e40af] hover:bg-[#eef2ff]"
                    onClick={() => setPasteOpen(true)}
                    type="button"
                >
                    시트 붙여넣기
                </button>
                {/* 임시 버튼 — 계약 내역 전체 일괄삭제(되돌릴 수 없음). 임시로 쓰는 버튼. */}
                {contracts.length ? (
                    <button
                        className="ml-auto rounded-md border border-dashed border-[#dc2626] px-3 py-1 text-xs font-semibold text-[#dc2626] hover:bg-[#fef2f2] disabled:opacity-50"
                        disabled={bulkDeleting}
                        onClick={() => void deleteAllContracts()}
                        type="button"
                    >
                        {bulkDeleting ? '삭제 중…' : `🗑 일괄삭제 (임시 · ${contracts.length}건)`}
                    </button>
                ) : null}
            </div>

            {activeCats.length ? (
                activeCats.map((c) => {
                    return (
                        <div key={c.key}>
                            <div className="mb-2 flex items-center gap-2">
                                <span className="rounded-full bg-[#e0e7ff] px-2.5 py-0.5 text-xs font-bold text-[#4338ca]">
                                    {c.label}
                                </span>
                            </div>
                            {(() => {
                                // 세부유형별 그룹 → 각 유형을 별도 그리드로(다음 유형은 새 줄부터 시작).
                                //   상위노출 보장형은 하위(· 리워드/영수증)까지 한 그룹으로 묶어 같은 줄에.
                                const catCts = contracts.filter((ct) => ct.category === c.label);
                                // 컨테이너형(상위노출 보장형·종합광고)은 하위(· X)까지 한 그룹으로 묶어 같은 줄에.
                                const groupKey = (s: string) =>
                                    CONTAINER_SUBS.find((p) => s.startsWith(p)) || s;
                                const subs = [...new Set(catCts.map((ct) => groupKey(ct.subtype)))].sort(
                                    (a, b) => {
                                        const ai = c.subs.indexOf(a);
                                        const bi = c.subs.indexOf(b);
                                        return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi);
                                    },
                                );
                                // 박스 구성: 일반 유형=유형별 1박스. 컨테이너(상위노출 보장형·종합광고)는 부모마다
                                //   별도 박스로 분리 → 하나 더 추가하면 아래로 쌓임. 자식(· X)은 접두사가 같아
                                //   부모 구분이 안 되므로 등록 시점(자식 created_at 이하의 가장 최근 부모)으로 귀속.
                                type BoxGroup = {
                                    key: string;
                                    title: string;
                                    isContainer: boolean;
                                    parent: ClientContract | null;
                                    members: ClientContract[];
                                };
                                const groups: BoxGroup[] = [];
                                for (const st of subs) {
                                    if (!CONTAINER_SUBS.includes(st)) {
                                        groups.push({
                                            isContainer: false,
                                            key: st,
                                            members: catCts.filter((ct) => groupKey(ct.subtype) === st),
                                            parent: null,
                                            title: st,
                                        });
                                        continue;
                                    }
                                    const parents = catCts
                                        .filter((ct) => ct.subtype === st)
                                        .sort((a, b) =>
                                            (a.created_at || '').localeCompare(b.created_at || ''),
                                        );
                                    const children = catCts.filter((ct) =>
                                        ct.subtype.startsWith(st + ' · '),
                                    );
                                    if (!parents.length) {
                                        groups.push({
                                            isContainer: true,
                                            key: st,
                                            members: children,
                                            parent: null,
                                            title: st,
                                        });
                                        continue;
                                    }
                                    // 자식→부모 귀속: parent_id(명시적 링크) 우선. 없으면 레거시 created_at 휴리스틱.
                                    const parentIds = new Set(parents.map((p) => p.id));
                                    const ownerId = (child: ClientContract) => {
                                        if (child.parent_id && parentIds.has(child.parent_id))
                                            return child.parent_id;
                                        let pick = parents[0];
                                        for (const p of parents) {
                                            if ((p.created_at || '') <= (child.created_at || '')) pick = p;
                                        }
                                        return pick.id;
                                    };
                                    parents.forEach((p) => {
                                        const mine = children.filter((ch) => ownerId(ch) === p.id);
                                        groups.push({
                                            isContainer: true,
                                            key: st + '#' + p.id,
                                            members: [p, ...mine],
                                            parent: p,
                                            title: st,
                                        });
                                    });
                                }
                                return groups.map((g) => {
                                    const st = g.title;
                                    const isContainerGroup = g.isContainer;
                                    const cards = g.members
                                        .slice()
                                        .sort((a, b) =>
                                            (a.contract_date || '').localeCompare(b.contract_date || ''),
                                        )
                                        .map((ct) => {
                                        const prog = progOf(ct);
                                        const done = (ct.goal_count || 0) - (ct.remain_count || 0);
                                        // 컨테이너 부모/자식 판별(상위노출 보장형·종합광고 공통).
                                        const containerPrefix = CONTAINER_SUBS.find((p) =>
                                            ct.subtype.startsWith(p + ' · '),
                                        );
                                        const isBoostParent = CONTAINER_SUBS.includes(ct.subtype);
                                        const isBoostChild = !!containerPrefix;
                                        const rawInner = isBoostChild
                                            ? ct.subtype.slice((containerPrefix as string).length + 3)
                                            : '';
                                        const innerLabel = rawInner.replace(/^플레이스용?\s*/, '');
                                        // 컨테이너(보장형/종합광고) 하위 상품의 실제 카테고리 — subtype으로 역추적.
                                        const childCat = isBoostChild
                                            ? PRODUCT_CATEGORIES.find((pc) => pc.subs.includes(rawInner))?.label ?? ''
                                            : '';
                                        // 컨테이너 부모 = 흐린 카드 + 상품 선택(2차 등록) 입구.
                                        if (isBoostParent) {
                                            return (
                                                <div
                                                    className="relative flex h-full min-h-[120px] cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-[#c7b8f0] bg-[#faf8ff] px-4 py-3 text-center transition hover:border-[#7c3aed] hover:bg-[#f3ecff]"
                                                    key={ct.id}
                                                    onClick={() => setBoostAdd(ct)}
                                                    role="button"
                                                    tabIndex={0}
                                                >
                                                    {/* 컨테이너(+하위 상품) 통째 삭제 */}
                                                    <button
                                                        className="absolute right-1.5 top-1.5 rounded-full px-1.5 text-[13px] font-bold text-[#c4b5fd] hover:bg-white hover:text-[#dc2626]"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            void deleteContainer(ct);
                                                        }}
                                                        title="종합광고/보장형 및 하위 상품 삭제"
                                                        type="button"
                                                    >
                                                        ✕
                                                    </button>
                                                    <div className="text-sm font-bold text-[#7c3aed]">
                                                        {ct.subtype}
                                                    </div>
                                                    {ct.subtype === '상위노출 보장형' ? (
                                                        <div
                                                            className="mt-1.5 flex flex-col items-center gap-1"
                                                            onClick={(e) => e.stopPropagation()}
                                                        >
                                                            <label className="flex items-center gap-1 text-[10px] text-[#94a3b8]">
                                                                회차
                                                                <input
                                                                    className="w-11 rounded border border-[#ddd6fe] px-1 py-0.5 text-center text-[11px] text-[#0f172a]"
                                                                    defaultValue={ct.boost_round || 1}
                                                                    min={1}
                                                                    onBlur={(e) => {
                                                                        const v = Number(e.target.value) || 1;
                                                                        if (v !== (ct.boost_round || 1))
                                                                            void saveBoostMeta(ct, { boost_round: v });
                                                                    }}
                                                                    type="number"
                                                                />
                                                            </label>
                                                            <div className="flex items-center gap-1 text-[10px] text-[#94a3b8]">
                                                                <input
                                                                    className="rounded border border-[#ddd6fe] px-1 py-0.5 text-[10px] text-[#0f172a]"
                                                                    defaultValue={ct.contract_date || ''}
                                                                    onChange={(e) =>
                                                                        void saveBoostMeta(ct, {
                                                                            contract_date: e.target.value || null,
                                                                        })
                                                                    }
                                                                    type="date"
                                                                />
                                                                <span>~</span>
                                                                <input
                                                                    className="rounded border border-[#ddd6fe] px-1 py-0.5 text-[10px] text-[#0f172a]"
                                                                    defaultValue={ct.boost_end || ''}
                                                                    onChange={(e) =>
                                                                        void saveBoostMeta(ct, {
                                                                            boost_end: e.target.value || null,
                                                                        })
                                                                    }
                                                                    type="date"
                                                                />
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <div className="mt-1 text-[11px] text-[#94a3b8] blur-[1.5px]">
                                                            {ct.goal_count ?? '—'}건 · {fmtWon(ct.amount || 0)}원
                                                        </div>
                                                    )}
                                                    <div className="mt-2 flex items-center gap-1">
                                                        <div className="rounded-full bg-[#7c3aed] px-3 py-1 text-xs font-bold text-white">
                                                            + 상품 선택
                                                        </div>
                                                        <button
                                                            className="rounded-full border border-[#7c3aed] bg-white px-2.5 py-1 text-[11px] font-bold text-[#7c3aed] hover:bg-[#f3ecff]"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                setBoostSheet(ct);
                                                            }}
                                                            title="회차별 진행(외주) 시트 붙여넣기"
                                                            type="button"
                                                        >
                                                            시트 붙여넣기
                                                        </button>
                                                    </div>
                                                    <div className="mt-1 text-[10px] text-[#94a3b8]">
                                                        {ct.subtype === '종합광고'
                                                            ? '모든 카테고리 상품 추가'
                                                            : '상품 추가 · 시트로 회차 진행 기록'}
                                                    </div>
                                                </div>
                                            );
                                        }
                                        return (
                                            <div
                                                className="flex h-full cursor-pointer flex-col rounded-lg border-2 border-[#e2e8f0] bg-white px-4 py-3 text-left shadow-sm transition hover:border-[#1e40af] hover:shadow-md"
                                                key={ct.id}
                                                onClick={() => setEditContract(ct)}
                                                role="button"
                                                tabIndex={0}
                                            >
                                                <div className="flex items-start justify-between gap-1.5">
                                                    <div className="truncate text-xs font-bold text-[#334155]">
                                                        {isBoostChild ? childCat || '기타' : ct.subtype}
                                                        {isBoostChild ? (
                                                            <span className="ml-1 rounded-full bg-[#ede9fe] px-1.5 py-0.5 text-[11px] font-extrabold text-[#7c3aed]">
                                                                {innerLabel}
                                                            </span>
                                                        ) : null}
                                                    </div>
                                                    <div className="flex shrink-0 items-center gap-1">
                                                        {ct.blog_name ? (
                                                            <span className="max-w-[130px] truncate rounded-full bg-[#ede9fe] px-2.5 py-0.5 text-[12px] font-extrabold text-[#7c3aed]">
                                                                {ct.blog_name}
                                                            </span>
                                                        ) : null}
                                                        {ct.outsource_company ? (
                                                            <span className="truncate rounded-full bg-[#fee2e2] px-2.5 py-0.5 text-[13px] font-extrabold text-[#dc2626]">
                                                                {ct.outsource_company}
                                                            </span>
                                                        ) : null}
                                                    </div>
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
                                                {ct.subtype === '서비스' && ct.note ? (
                                                    <div className="mt-0.5 line-clamp-2 text-[11px] text-[#7c3aed]">
                                                        📝 {ct.note}
                                                    </div>
                                                ) : null}
                                                {(ct.unit_outsource ?? 0) > 0 ? (
                                                    <div className="mt-0.5 text-[11px] font-semibold text-[#dc2626]">
                                                        잔여 외주 {fmtWon(outsourceOf(ct).remain)}원
                                                    </div>
                                                ) : null}
                                                {/* 브랜드 블로그는 블로그 이름(A/B/C)으로 시트 필터 → 그 블로그로 이동. 그 외는 업체명. */}
                                                {cardSheetHref(
                                                    ct.category,
                                                    ct.subtype,
                                                    ct.blog_name || client.company || '',
                                                ) ? (
                                                    <button
                                                        className="mt-auto self-start pt-2 text-[10px] font-semibold text-[#94a3b8] hover:text-[#1e40af]"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            navTo(
                                                                cardSheetHref(
                                                                    ct.category,
                                                                    ct.subtype,
                                                                    ct.blog_name || client.company || '',
                                                                    !!ct.sheet_approved,
                                                                ),
                                                            );
                                                        }}
                                                        type="button"
                                                    >
                                                        관리 시트 →
                                                    </button>
                                                ) : null}
                                            </div>
                                        );
                                        });
                                    // 컨테이너(상위노출 보장형·종합광고) 그룹은 보라색 박스로 감싸 하위 상품을 안에 표시.
                                    // 상위노출 보장형 헤더 우측에 회차+시작~종료일 표시(이 박스의 부모 계약 값).
                                    const boostParent =
                                        st === '상위노출 보장형' ? g.parent : null;
                                    return isContainerGroup ? (
                                        <div
                                            className="mb-3 rounded-xl border-2 border-[#c7b8f0] bg-[#faf8ff] p-3"
                                            key={g.key}
                                        >
                                            <div className="mb-2 flex items-center gap-2 text-sm font-bold text-[#7c3aed]">
                                                <span>{st}</span>
                                                {boostParent ? (
                                                    <span className="text-[15px] font-extrabold text-[#6d28d9]">
                                                        {boostParent.boost_round || 1}회차
                                                        {boostParent.contract_date || boostParent.boost_end
                                                            ? ` ${boostParent.contract_date || '…'} ~ ${boostParent.boost_end || '…'}`
                                                            : ''}
                                                    </span>
                                                ) : null}
                                            </div>
                                            <div className="grid auto-rows-fr grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                                                {cards}
                                            </div>
                                        </div>
                                    ) : (
                                        <div
                                            className="mb-3 grid auto-rows-fr grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4"
                                            key={g.key}
                                        >
                                            {cards}
                                        </div>
                                    );
                                });
                            })()}
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
                        { key: 'contact', label: '연락처', value: client.contact || '', format: formatPhone },
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
            {pasteOpen ? (
                <ContractPasteAddModal
                    clientId={client.id}
                    companyName={client.company || ''}
                    onClose={() => setPasteOpen(false)}
                    onReload={onReloadContracts}
                    onToast={onToast}
                />
            ) : null}
            {boostAdd ? (
                <ContractAddModal
                    allCategorySubs={CONTAINER_SUBS.includes(boostAdd.subtype)}
                    boostParentId={boostAdd.id}
                    boostPrefix={`${boostAdd.subtype} · `}
                    clientId={client.id}
                    companyName={client.company || ''}
                    lockCategoryLabel={boostAdd.category}
                    managerName={client.manager || ''}
                    onClose={() => setBoostAdd(null)}
                    onReload={onReloadContracts}
                    onToast={onToast}
                />
            ) : null}
            {boostSheet ? (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
                    onMouseDown={(e) => e.target === e.currentTarget && setBoostSheet(null)}
                >
                    <div className="max-h-[92vh] w-[min(720px,96vw)] overflow-y-auto rounded-2xl bg-white p-5">
                        <h3 className="m-0 text-base font-bold text-[#0f172a]">
                            {boostSheet.subtype} · 회차 진행 시트 붙여넣기
                        </h3>
                        <p className="mt-1 text-[12px] text-[#64748b]">
                            각 행 = 컨테이너 옆 <b>카드 1개</b>로 추가됩니다. <b>거래처명=외주업체</b>(리브리 등) ·
                            업체명=고객사(대조) · 품목명=상품 · <b>수량=건수 · 단가=외주단가</b>. 수량×외주단가는{' '}
                            <b>쓴(사용) 외주비</b>로 기록되고, <b>받은 외주비는 빈값</b>(나중에 각 카드에서 입력).
                        </p>
                        <textarea
                            className="mt-2 h-56 w-full rounded-lg border border-[#cbd5e1] p-2 font-mono text-[12px]"
                            onChange={(e) => setBoostSheetText(e.target.value)}
                            spellCheck={false}
                            value={boostSheetText}
                        />
                        <div className="mt-3 flex justify-end gap-2">
                            <button
                                className="rounded-md border border-[#cbd5e1] px-3 py-1.5 text-sm font-semibold text-[#64748b] hover:bg-[#f1f5f9]"
                                onClick={() => setBoostSheet(null)}
                                type="button"
                            >
                                취소
                            </button>
                            <button
                                className="rounded-md bg-[#7c3aed] px-4 py-1.5 text-sm font-bold text-white hover:bg-[#6d28d9] disabled:opacity-50"
                                disabled={boostSaving}
                                onClick={() => void importBoostSheet(boostSheet)}
                                type="button"
                            >
                                카드 추가
                            </button>
                        </div>
                    </div>
                </div>
            ) : null}
            {editContract ? (
                <ContractEditModal
                    contract={editContract}
                    companyName={client.company || ''}
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
                    onSave={(v) => {
                        const val = v || null;
                        onSave({ [editField.patchKey]: val } as Partial<ErpClient>);
                        // 업체명·담당·연락처는 브랜드블로그 관리시트에도 반영(계정이 있으면).
                        const map: Record<string, 'name' | 'manager' | 'contact'> = {
                            company: 'name',
                            contact: 'contact',
                            manager: 'manager',
                        };
                        const key = map[editField.patchKey];
                        if (key) void syncBlogAccountFromContract(client.id, { [key]: val });
                    }}
                    options={editField.options}
                    value={editField.value}
                />
            ) : null}
            {custAcctOpen ? (
                <CustomerAccountModal
                    clientId={client.id}
                    companyName={client.company || '고객사'}
                    onClose={() => {
                        setCustAcctOpen(false);
                        void loadCustAcct(); // 발급 후 아이디 표시로 전환
                    }}
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
                                ? '상품별 순매출 (공급가 − 외주비)'
                                : breakdown === 'sales'
                                  ? '상품별 실매출 (VAT 포함)'
                                  : '상품별 외주비'}
                        </p>
                        {contracts.length ? (
                            <div className="grid gap-1">
                                {contracts.map((ct) => {
                                    const val =
                                        breakdown === 'net'
                                            ? (ct.amount || 0) - (ct.outsource || 0)
                                            : breakdown === 'sales'
                                              ? saleVat(ct.amount, ct.no_vat) // 실매출 = VAT 포함(현금이면 미포함)
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
                                          ? totalReal
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
                                            ['실매출 (VAT 포함)', `${fmtWon(saleVat(detailC.amount, detailC.no_vat))}원`, '#1e40af'],
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
                                            ['실매출 (VAT 포함)', `${fmtWon(saleVat(detailC.amount, detailC.no_vat))}원`, '#1e40af'],
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
                                                    ? withVat(dGoal * uPrice) // 실매출 = VAT 포함
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
