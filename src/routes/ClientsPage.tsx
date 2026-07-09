import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
    deleteClient,
    insertClient,
    updateClient,
    type ClientHistory,
    type ErpClient,
} from '../api/erp';
import { ensureClientBlogAccount, getBlogAccounts, type BlogAccount } from '../api/blogRank';
import {
    completedOutsource,
    getClientContracts,
    insertClientContracts,
    totalOutsource,
    updateClientContract,
    type ClientContract,
} from '../api/clientContracts';
import { PRODUCT_CATEGORIES, isDailySub, isBrandBlogSub } from '../lib/products';
import { ClientDetail } from './ClientDetail';
import Button from '../components/Button';
import { ContractImportModal } from './ContractImportModal';
import { useErpData } from '../context/ErpDataContext';
import { useAuth } from '../hooks/useAuth';
import { DUTIES, canSeeAmounts } from '../lib/permissions';
import {
    INDUSTRY_OPTIONS,
    STATUS_BADGE,
    STATUS_OPTIONS,
    formatPhone,
    parsePaste,
    saleVat,
    todayStr,
} from '../lib/erpUtils';

// 문의 추가 '우리 담당자' 드롭다운 — 우선 2명만.
const OUR_MANAGERS = ['김종인', '송민경'];

const FAVS_KEY = 'erp_favs';
// 계약완료로 막 넘어온 '신규건' — localStorage에 완료 시각 기록, 24시간 동안 계약 관리에서 강조·상단 고정.
const NEW_KEY = 'erp_new_contracts';
const NEW_TTL = 24 * 60 * 60 * 1000; // 24시간
function readNewContracts(): Record<string, number> {
    try {
        const m = JSON.parse(localStorage.getItem(NEW_KEY) || '{}') as Record<string, number>;
        const now = Date.now();
        const kept: Record<string, number> = {};
        for (const [id, ts] of Object.entries(m)) {
            if (now - ts < NEW_TTL) kept[id] = ts; // 만료분 정리
        }
        return kept;
    } catch {
        return {};
    }
}
function markNewContract(id: string) {
    const m = readNewContracts();
    m[id] = Date.now();
    localStorage.setItem(NEW_KEY, JSON.stringify(m));
}
const DONE_STATUS = '계약완료'; // 계약 완료 판정 기준(상태). 계약 관리 진입 + 완료/미완료 탭이 공유.
const ENDED_STATUS = '계약종료'; // 계약 종료(터미널). 종료 탭. 5단계(신규~보류)와 별개.
// 숫자 입력 포맷 — 저장은 숫자만, 표시는 천단위 콤마(2000 → 2,000).
const onlyDigits = (s: string) => s.replace(/[^\d]/g, '');
const withCommas = (s: string) => (onlyDigits(s) ? Number(onlyDigits(s)).toLocaleString('ko-KR') : '');
// 상품 상세(진행률) — ClientDetail 카드와 동일 색/계산.
const progColor = (p: number | null) =>
    p == null ? '#94a3b8' : p >= 70 ? '#059669' : p >= 40 ? '#d97706' : '#dc2626';
// 금액 기반 진행률 — 완료 외주금액(doneAmt) ÷ 총금액(amt). 금액 우선 → 전량 완료여도 외주 적으면 100% 미만.
//   외주 데이터 없을 때만 건수 %로 폴백.
const progMoney = (
    goal: number | null,
    remain: number | null,
    amt: number,
    doneAmt: number,
): number | null => {
    if (goal == null || remain == null || goal === 0) return null;
    const done = goal - remain;
    // 금액 우선 — 완료 외주금액 ÷ 총금액.
    if (amt > 0 && doneAmt > 0) return Math.min(100, Math.round((doneAmt / amt) * 100));
    if (remain <= 0) return 100;
    if (done <= 0) return 0;
    return Math.round((done / goal) * 100);
};
// 카테고리별 박스 색(연한 배경 + 테두리) — 상품 셀 구분용.
const CAT_STYLE: Record<string, { bg: string; border: string }> = {
    플레이스: { bg: '#eff6ff', border: '#93c5fd' }, // 파란색
    블로그: { bg: '#f0fdf4', border: '#86efac' }, // 초록색
    쇼핑: { bg: '#fef2f2', border: '#fca5a5' }, // 빨간색
    카페: { bg: '#fdf2f8', border: '#f9a8d4' }, // 분홍색
    인스타: { bg: '#fdf4ff', border: '#e9d5ff' }, // 그대로(연보라)
    파워링크: { bg: '#ecfeff', border: '#67e8f9' }, // 그대로(하늘)
    영상: { bg: '#fff7ed', border: '#fdba74' }, // 주황색
    종합광고: { bg: '#f1f5f9', border: '#cbd5e1' },
};
const catStyle = (c: string) => CAT_STYLE[c] || { bg: '#f8fafc', border: '#e2e8f0' };
// 업체명 중복 비교용 정규화 — 공백 제거 + 소문자(저장값은 그대로, 비교에만 사용).
const normCompany = (s: string) => s.trim().replace(/\s+/g, '').toLowerCase();
// 사업자등록번호 3-2-5 하이픈 자동(입력하는 동안 000-00-00000).
const formatBizNo = (s: string) => {
    const d = onlyDigits(s).slice(0, 10);
    if (d.length <= 3) return d;
    if (d.length <= 5) return `${d.slice(0, 3)}-${d.slice(3)}`;
    return `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}`;
};

type ClientForm = {
    manager: string;
    source: string;
    company: string;
    contact: string;
    phone: string;
    email: string;
    product: string;
    budget: string;
    amount: string;
    next_contact: string;
    contract_start: string;
    contract_end: string;
    status: string;
    notes: string;
    url: string;
    historyText: string;
    business_number: string;
    address: string;
    industry: string;
    client_partner: string;
};

const emptyForm: ClientForm = {
    address: '',
    amount: '',
    budget: '',
    business_number: '',
    client_partner: '',
    company: '',
    industry: '',
    contact: '',
    contract_end: '',
    contract_start: '',
    email: '',
    manager: '',
    next_contact: '',
    notes: '',
    historyText: '',
    phone: '',
    product: '',
    source: '',
    status: STATUS_OPTIONS[0],
    url: '',
};

function loadFavs(): string[] {
    try {
        return JSON.parse(localStorage.getItem(FAVS_KEY) || '[]');
    } catch {
        return [];
    }
}

// contractsOnly=true → '계약 관리'(실제 계약 진행 중인 건만). false → '고객사 관리'(보류 포함 전체).
//   두 화면은 동일 UI/상세를 공유하고, 목록 필터만 다르다.
function ClientsPage({ contractsOnly = false }: { contractsOnly?: boolean } = {}) {
    const { clients, allClients, salespeople, loading, error, refresh } = useErpData();
    const { can, canEdit, profile } = useAuth(); // 권한: 계약완료 승인(duty) · 수정 가능 · 금액 열람(이메일 기준)

    // 카테고리 = 그 고객사에 연결된 카테고리 계정에서 도출(현재 블로그). client_id 로 묶음.
    const [blogAccounts, setBlogAccounts] = useState<BlogAccount[]>([]);
    const reloadBlogs = () => getBlogAccounts().then(({ data }) => setBlogAccounts(data));
    // 계약 내역(client_contracts) — 카테고리/세부유형별 건수 계약.
    const [clientContracts, setClientContracts] = useState<ClientContract[]>([]);
    const reloadContracts = () => getClientContracts().then(({ data }) => setClientContracts(data));
    useEffect(() => {
        void reloadBlogs();
        void reloadContracts();
    }, []);
    // 상세 페이지(업체 클릭) — ?id 쿼리로 열고 닫는다.
    const [detailId, setDetailId] = useState<string | null>(
        () => new URLSearchParams(window.location.search).get('id'),
    );
    // 목록 ↔ 상세 이동 시 목록 스크롤 위치 보존 — 스크롤 컨테이너는 Layout의 <main>(데스크톱) 또는 window(≤800px).
    const listScrollRef = useRef(0);
    // 실제 스크롤 요소 판별 — 데스크톱은 <main>(overflow-y-auto), ≤800px는 window(main은 overflow-visible).
    const getScroller = (): HTMLElement | null => {
        const el = document.querySelector('main') as HTMLElement | null;
        return el && el.scrollHeight > el.clientHeight + 1 ? el : null;
    };
    const openDetail = (id: string) => {
        const el = getScroller();
        listScrollRef.current = el ? el.scrollTop : window.scrollY; // 현재 목록 위치 저장
        setDetailId(id);
        const u = new URL(window.location.href);
        u.searchParams.set('id', id);
        window.history.pushState(null, '', u.pathname + u.search);
        // 상세는 맨 위에서 시작
        if (el) el.scrollTop = 0;
        else window.scrollTo(0, 0);
    };
    const closeDetail = () => {
        setDetailId(null);
        const u = new URL(window.location.href);
        u.searchParams.delete('id');
        window.history.pushState(null, '', u.pathname + u.search);
    };
    // 상세 닫혀 목록이 다시 렌더된 직후, 저장해둔 스크롤 위치로 복원(페인트 전 → 깜빡임 없음).
    useLayoutEffect(() => {
        if (detailId) return; // 상세 열림 상태면 복원하지 않음
        const y = listScrollRef.current;
        if (!y) return;
        const el = getScroller();
        if (el) el.scrollTop = y;
        else window.scrollTo(0, y);
    }, [detailId]);

    // 검색어 — ?q= 로 진입(벨 알림에서 업체명 검색)하면 그 값으로 시작.
    const [search, setSearch] = useState(
        () => new URLSearchParams(window.location.search).get('q') ?? '',
    );
    // 알림 등에서 ?q= 로 재진입(같은 페이지) 시 검색어 반영.
    useEffect(() => {
        const sync = () => {
            const q = new URLSearchParams(window.location.search).get('q');
            if (q != null) setSearch(q);
        };
        window.addEventListener('popstate', sync);
        window.addEventListener('app:navigate', sync);
        return () => {
            window.removeEventListener('popstate', sync);
            window.removeEventListener('app:navigate', sync);
        };
    }, []);
    const [statusFilter, setStatusFilter] = useState('');
    const [favOnly, setFavOnly] = useState(false);
    const [favs, setFavs] = useState<string[]>(loadFavs);
    // 고객사 관리 하단 탭 — 계약 완료(블로그 등 계정 연결) vs 미완료(보류·문의만). contractsOnly 화면에선 미사용.
    const [clientTab, setClientTab] = useState<
        'consult' | 'prospect' | 'hold' | 'done' | 'ended'
    >('consult');
    // 계약 관리 탭: 신규 등록건/계약중/계약 종료/임시. 기본=계약중, 신규(미승인) 있으면 신규로 시작(아래 effect).
    const [contractTab, setContractTab] = useState<'new' | 'active' | 'temp' | 'ended'>('active');
    const didInitTab = useRef(false);
    // 계약 관리 월 필터 — 전체 + 6월~현재월 드롭다운, 기본 = 이번 달(고정). (앞으로 12월까지 자동 확장)
    const currentMonth = new Date().getMonth() + 1;
    const currentYear = new Date().getFullYear();
    const [monthFilter, setMonthFilter] = useState(currentMonth); // 0 = 전체
    const [yearFilter, setYearFilter] = useState(currentYear); // 0 = 전체 · 계약 관리 년 필터
    // 년 옵션 — 전체 + 계약일자에 존재하는 연도(내림차순).
    const yearOptions = useMemo(() => {
        const set = new Set<number>([currentYear]);
        for (const ct of clientContracts) {
            const y = Number((ct.contract_date || '').slice(0, 4));
            if (y >= 2020 && y <= 2100) set.add(y);
        }
        return [0, ...[...set].sort((a, b) => b - a)];
    }, [clientContracts, currentYear]);
    // 월 옵션 — 전체 + (기본 6..현재월) + 계약일자에 실제 존재하는 월(예: 4월 등 자동 포함).
    const monthOptions = useMemo(() => {
        const set = new Set<number>();
        for (let m = 6; m <= currentMonth; m++) set.add(m);
        for (const ct of clientContracts) {
            const m = Number((ct.contract_date || '').slice(5, 7));
            if (m >= 1 && m <= 12) set.add(m);
        }
        // 상담건 등 계약 없는 고객은 등록월 기준 — 그 월들도 옵션에 포함.
        for (const c of clients) {
            const m = c.created_at ? new Date(c.created_at).getMonth() + 1 : 0;
            if (m >= 1 && m <= 12) set.add(m);
        }
        return [0, ...[...set].sort((a, b) => a - b)];
    }, [clientContracts, clients, currentMonth]);
    const [dateSort, setDateSort] = useState<null | 'asc' | 'desc'>(null); // 등록일 정렬(헤더 클릭)
    // 계약 진행 단계 변경 대상(5단계 선택 모달).
    const [stageClient, setStageClient] = useState<ErpClient | null>(null);
    // 계약 종료(사유 입력) 대상 — 신규 등록 건에서 종료 시.
    const [endTarget, setEndTarget] = useState<ErpClient | null>(null);
    const [endReason, setEndReason] = useState('');
    // 재계약 임박 KPI 상세 펼침(기본 접힘 — 건수만).
    const [showImminent, setShowImminent] = useState(false);
    const [outsourceClient, setOutsourceClient] = useState<string | null>(null); // 잔여 외주비 상세 대상 client_id
    const [expandedProduct, setExpandedProduct] = useState<string | null>(null); // 상품 상세(계약/진행/잔여) 펼친 client_id
    // 계약완료 처리로 계약 관리에 막 넘어온 신규건 — localStorage 기록 기준 24시간 강조·상단 고정.
    const [newMap, setNewMap] = useState<Record<string, number>>(readNewContracts);
    useEffect(() => {
        const sync = () => setNewMap(readNewContracts());
        window.addEventListener('app:navigate', sync);
        window.addEventListener('popstate', sync);
        // 남은 TTL 동안 자동 만료되도록 주기 갱신(1분).
        const timer = window.setInterval(sync, 60 * 1000);
        return () => {
            window.removeEventListener('app:navigate', sync);
            window.removeEventListener('popstate', sync);
            window.clearInterval(timer);
        };
    }, []);
    const newIds = useMemo(() => new Set(Object.keys(newMap)), [newMap]);
    const [dupMatches, setDupMatches] = useState<ErpClient[] | null>(null); // 업체명 중복 안내 대상
    const [importOpen, setImportOpen] = useState(false); // 시트 붙여넣기 일괄 등록
    const [toast, setToast] = useState('');

    const [modalOpen, setModalOpen] = useState(false);
    const [editId, setEditId] = useState<string | null>(null);
    const [form, setForm] = useState<ClientForm>(emptyForm);
    const [pasteText, setPasteText] = useState('');
    const [entryMode, setEntryMode] = useState<'guide' | 'paste'>('guide'); // 가이드 입력 / 붙여넣기
    const [saving, setSaving] = useState(false);
    // 붙여넣기 → 자동 채우기: 업체명·담당자·연락처·이메일은 칸에, 마케팅상품·광고예산·문의내용은 히스토리로.
    const applyPaste = () => {
        const p = parsePaste(pasteText);
        // 광고예산·문의내용(긴 글)은 히스토리로. 마케팅상품은 상품 칸으로.
        const hist: string[] = [];
        if (p.budget) hist.push(`광고예산: ${p.budget}`);
        if (p.inquiry) hist.push(p.inquiry);
        setForm((f) => ({
            ...f,
            company: p.company || f.company,
            manager: p.manager || f.manager,
            contact: p.contact ? formatPhone(p.contact) : f.contact,
            email: p.email || f.email,
            source: p.source || f.source,
            product: p.product || f.product,
            historyText: hist.join('\n') || f.historyText,
        }));
        setEntryMode('guide'); // 채운 뒤 가이드로 전환해 확인·수정
        showToast('붙여넣기 내용을 채웠습니다 — 확인 후 등록하세요');
    };
    // 등록 가이드 '상품' — 선택한 부모 카테고리(key) + 세부유형별 건수/금액 입력.
    const [prodCats, setProdCats] = useState<string[]>([]);
    const [prodInputs, setProdInputs] = useState<
        Record<
            string,
            { unit: string; count: string; outsource: string; perDay: string; days: string; outCompany: string }
        >
    >({});
    // 세부상품의 수량 — 일 단위(리워드)면 일일수량 × 일수, 아니면 count.
    const subQty = (catKey: string, sub: string) => {
        const inp = prodInputs[`${catKey}|${sub}`];
        if (!inp) return 0;
        return isDailySub(sub)
            ? (Number(onlyDigits(inp.perDay || '')) || 0) * (Number(onlyDigits(inp.days || '')) || 0)
            : Number(onlyDigits(inp.count || '')) || 0;
    };
    // 상품 정산 합계 — 공급가(Σ매출)·부가세포함(×1.1)·외주비(Σ외주)·순매출.
    const prodTotals = useMemo(() => {
        let supply = 0;
        let outs = 0;
        for (const catKey of prodCats) {
            const cat = PRODUCT_CATEGORIES.find((c) => c.key === catKey);
            if (!cat) continue;
            for (const sub of cat.subs) {
                const inp = prodInputs[`${catKey}|${sub}`];
                if (!inp) continue;
                const q = subQty(catKey, sub);
                supply += (Number(onlyDigits(inp.unit)) || 0) * q;
                outs += (Number(onlyDigits(inp.outsource)) || 0) * q;
            }
        }
        return { net: supply - outs, outs, supply, vat: Math.round(supply * 1.1) };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [prodCats, prodInputs]);

    const [histClient, setHistClient] = useState<ErpClient | null>(null);
    const [histInput, setHistInput] = useState('');

    const [delId, setDelId] = useState<string | null>(null);

    const showToast = (message: string) => {
        setToast(message);
        window.setTimeout(() => setToast(''), 2500);
    };

    // 등록일 정렬키 — (월 필터 시 그 달) 계약 contract_date 중 가장 이른 것. 없으면 생성일.
    const regKey = (client: ErpClient) => {
        const cs = scopeMonth(
            clientContracts.filter((ct) => ct.client_id === client.id && ct.contract_date),
        )
            .map((ct) => ct.contract_date as string)
            .sort();
        return cs.length ? cs[0] : client.created_at || '';
    };

    // 이 업체에 계약일(contract_date)이 있는 계약이 하나라도 있는지 — 없으면 '임시'.
    const hasDatedContract = (client: ErpClient) =>
        clientContracts.some((ct) => ct.client_id === client.id && ct.contract_date);
    // 업체가 특정 연/월에 속하는지 — 계약 contract_date 기준. 계약 관리는 날짜 없으면 매칭 안 함(임시 탭).
    //   고객사 관리(상담건 등)는 계약이 없으므로 등록월(created_at) 폴백.
    const clientInPeriod = (client: ErpClient, year: number, month: number) => {
        if (!year && !month) return true;
        const cs = clientContracts.filter((ct) => ct.client_id === client.id && ct.contract_date);
        if (cs.length) {
            return cs.some((ct) => {
                const d = ct.contract_date || '';
                return (!year || Number(d.slice(0, 4)) === year) && (!month || Number(d.slice(5, 7)) === month);
            });
        }
        if (contractsOnly) return false; // 계약 관리: 날짜 없으면 임시 탭에서만
        const cy = client.created_at ? new Date(client.created_at).getFullYear() : 0;
        const cm = client.created_at ? new Date(client.created_at).getMonth() + 1 : 0;
        return (!year || cy === year) && (!month || cm === month);
    };
    // 계약(상품)이 특정 연/월에 속하는지 — contract_date 기준(없으면 제외). 상세·목록 상품 스코프.
    const contractInPeriod = (ct: ClientContract, year: number, month: number) => {
        if (!year && !month) return true;
        const d = ct.contract_date || '';
        if (!d) return false;
        return (!year || Number(d.slice(0, 4)) === year) && (!month || Number(d.slice(5, 7)) === month);
    };
    // 계약 관리(연/월 필터 화면)에서만 상품을 스코프. 임시 탭은 스코프 안 함(날짜 없는 상품 전부).
    const scopeMonth = (cts: ClientContract[]) =>
        contractsOnly && contractTab === 'active' && (yearFilter || monthFilter)
            ? cts.filter((ct) => contractInPeriod(ct, yearFilter, monthFilter))
            : cts;

    // 계약 관리 신규(미승인) 건수 — 전체(연/월 무관).
    const newContractCount = useMemo(
        () =>
            !contractsOnly
                ? 0
                : clients.filter((c) => c.status === DONE_STATUS && !c.contract_approved).length,
        [contractsOnly, clients],
    );
    // 임시(날짜 미등록) 계약 업체 수 — 계약완료+승인인데 계약일 있는 계약이 하나도 없음.
    const tempCount = useMemo(
        () =>
            !contractsOnly
                ? 0
                : clients.filter(
                      (c) => c.status === DONE_STATUS && c.contract_approved && !hasDatedContract(c),
                  ).length,
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [contractsOnly, clients, clientContracts],
    );
    // 진입 시 기본 탭 — 신규 있으면 '신규 등록건', 없으면 '계약중'. (최초 1회)
    useEffect(() => {
        if (!contractsOnly || didInitTab.current || loading) return;
        setContractTab(newContractCount > 0 ? 'new' : 'active');
        didInitTab.current = true;
    }, [contractsOnly, loading, newContractCount]);
    // 신규/임시가 0이 되면 그 탭에서 계약중으로 자동 이동(탭이 사라지므로).
    useEffect(() => {
        if (contractsOnly && newContractCount === 0 && contractTab === 'new') setContractTab('active');
        if (contractsOnly && tempCount === 0 && contractTab === 'temp') setContractTab('active');
    }, [contractsOnly, newContractCount, tempCount, contractTab]);

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        const list = clients.filter((client) => {
            const matchesQuery =
                !q ||
                (client.manager || '').toLowerCase().includes(q) ||
                (client.company || '').toLowerCase().includes(q) ||
                (client.contact || '').toLowerCase().includes(q) ||
                (client.product || '').toLowerCase().includes(q);
            const matchesStatus = !statusFilter || client.status === statusFilter;
            const matchesFav = !favOnly || favs.includes(client.id);
            // 계약 관리(contractsOnly) 탭별 필터: 신규(미승인)/계약중(승인·계약일있음)/임시(승인·날짜없음)/종료.
            const matchesContract =
                !contractsOnly ||
                (contractTab === 'new'
                    ? client.status === DONE_STATUS && !client.contract_approved
                    : contractTab === 'temp'
                      ? client.status === DONE_STATUS &&
                        client.contract_approved &&
                        !hasDatedContract(client)
                      : contractTab === 'active'
                        ? client.status === DONE_STATUS &&
                          client.contract_approved &&
                          hasDatedContract(client)
                        : client.status === ENDED_STATUS);
            // 고객사 관리 탭(상태 기준): 상담건 / 가망 건 / 보류 / 계약 완료 / 계약 종료.
            const matchesTab =
                contractsOnly ||
                (clientTab === 'done'
                    ? client.status === DONE_STATUS
                    : clientTab === 'ended'
                      ? client.status === ENDED_STATUS
                      : clientTab === 'prospect'
                        ? client.status === '가망'
                        : clientTab === 'hold'
                          ? client.status === '보류'
                          : // consult(상담건) = 완료·종료·보류·가망 아닌 나머지(신규문의·상담중·제안완료).
                            client.status !== DONE_STATUS &&
                            client.status !== ENDED_STATUS &&
                            client.status !== '보류' &&
                            client.status !== '가망');

            // 연/월 필터 — 계약 관리는 '계약 중' 탭에서만(임시/신규/종료는 기간 무시). 고객사 관리는 항상.
            const applyPeriod = !contractsOnly || contractTab === 'active';
            const matchesMonth = !applyPeriod || clientInPeriod(client, yearFilter, monthFilter);

            return (
                matchesQuery && matchesStatus && matchesFav && matchesContract && matchesTab && matchesMonth
            );
        });

        return list.sort((a, b) => {
            // 등록일 정렬(헤더 클릭)이 켜져 있으면 날짜순 우선.
            if (dateSort) {
                const ka = regKey(a);
                const kb = regKey(b);
                const c = ka.localeCompare(kb);
                return dateSort === 'asc' ? c : -c;
            }
            // 신규건(24h)은 항상 맨 위, 최근 완료 순.
            const an = newIds.has(a.id);
            const bn = newIds.has(b.id);
            if (an !== bn) return an ? -1 : 1;
            if (an && bn) return (newMap[b.id] || 0) - (newMap[a.id] || 0);
            const af = favs.includes(a.id) ? 0 : 1;
            const bf = favs.includes(b.id) ? 0 : 1;
            return af - bf;
        });
    }, [clients, clientContracts, search, statusFilter, favOnly, favs, contractsOnly, clientTab, contractTab, monthFilter, yearFilter, dateSort, newIds, newMap]);

    // 월 매출 합계 카드 — 현재 필터(월/탭/검색)로 보이는 고객의 계약을, 선택 월에 해당하는 것만 합산.
    //   공급가(Σ amount) · 부가세(공급가×10%) · 실매출/합계(공급가+부가세) · 외주비 · 순매출(공급가−외주).
    const revenueSummary = useMemo(() => {
        const shown = new Set(filtered.map((c) => c.id));
        const cliById = new Map(clients.map((c) => [c.id, c]));
        let supply = 0;
        let outs = 0; // 예상(받은) 외주비 = Σ ct.outsource
        let used = 0; // 실제 사용(소진) 외주비 = Σ completedOutsource
        let total = 0; // 실매출 — 계약별 부가세(현금이면 VAT 미포함) 합산
        for (const ct of clientContracts) {
            if (!shown.has(ct.client_id)) continue;
            // 연/월 필터 시 계약일 기준(없으면 등록월 폴백)으로 그 기간 계약만 합산.
            if (yearFilter || monthFilter) {
                if (ct.contract_date) {
                    if (yearFilter && Number(ct.contract_date.slice(0, 4)) !== yearFilter) continue;
                    if (monthFilter && Number(ct.contract_date.slice(5, 7)) !== monthFilter) continue;
                } else {
                    const cl = cliById.get(ct.client_id);
                    const cy = cl?.created_at ? new Date(cl.created_at).getFullYear() : 0;
                    const cm = cl?.created_at ? new Date(cl.created_at).getMonth() + 1 : 0;
                    if (yearFilter && cy !== yearFilter) continue;
                    if (monthFilter && cm !== monthFilter) continue;
                }
            }
            supply += ct.amount || 0;
            outs += ct.outsource || 0;
            used += completedOutsource(ct); // 실제 사용(진행 완료분 소진)
            total += saleVat(ct.amount, ct.no_vat); // 계약별 VAT
        }
        // 남은 차액 = 예상 외주비 − 실제 사용 외주비(아직 안 쓴 외주비 여유분).
        return { supply, vat: total - supply, total, outs, used, diff: outs - used, net: supply - outs };
    }, [filtered, clients, clientContracts, monthFilter, yearFilter]);

    // 계약 관리 KPI — 계약 중(계약완료 고객 수) + 재계약 임박(카테고리 계약 중 잔여 5건 이하).
    const doneClientIds = useMemo(
        () => new Set(clients.filter((c) => c.status === DONE_STATUS).map((c) => c.id)),
        [clients],
    );
    // 재계약 임박 = 계약완료 고객의 상품(블로그 계정 + 계약 내역) 중 잔여 5건 이하. 0건=빨강, 1~5건=노랑.
    const imminentList = useMemo(() => {
        const fromBlogs = blogAccounts
            .filter(
                (a) =>
                    a.client_id &&
                    doneClientIds.has(a.client_id) &&
                    !a.contract_ended_at &&
                    a.remain_count != null &&
                    a.remain_count <= 5,
            )
            .map((a) => ({
                clientId: a.client_id as string,
                company: clients.find((c) => c.id === a.client_id)?.company || a.name,
                product: '블로그',
                remain: a.remain_count as number,
            }));
        const fromContracts = clientContracts
            .filter((ct) => doneClientIds.has(ct.client_id) && ct.remain_count != null && ct.remain_count <= 5)
            .map((ct) => ({
                clientId: ct.client_id,
                company: clients.find((c) => c.id === ct.client_id)?.company || '업체',
                product: ct.category,
                remain: ct.remain_count as number,
            }));
        return [...fromBlogs, ...fromContracts].sort((x, y) => x.remain - y.remain);
    }, [blogAccounts, clientContracts, doneClientIds, clients]);
    // KPI 카드 톤 — 0건 있으면 빨강, 있고 0건 없으면 노랑, 없으면 회색.
    const kpiTone: 'none' | 'red' | 'yellow' =
        imminentList.length === 0 ? 'none' : imminentList.some((it) => it.remain === 0) ? 'red' : 'yellow';

    const toggleFav = (id: string) => {
        setFavs((current) => {
            const next = current.includes(id)
                ? current.filter((x) => x !== id)
                : [...current, id];
            localStorage.setItem(FAVS_KEY, JSON.stringify(next));
            return next;
        });
    };

    const updateField = (field: keyof ClientForm, value: string) => {
        setForm((current) => ({ ...current, [field]: value }));
    };

    // 문의/계약 추가 초안 — 모달이 닫혀도(튕겨도) 다시 열면 입력 복원. 저장 성공 시 삭제.
    const draftKey = contractsOnly ? 'erp_draft_contract' : 'erp_draft_inquiry';
    // 신규 등록(가이드) 폼 값이 바뀔 때마다 초안 저장.
    useEffect(() => {
        if (!modalOpen || editId) return;
        try {
            localStorage.setItem(draftKey, JSON.stringify({ form, pasteText, entryMode }));
        } catch {
            /* 저장 실패 무시 */
        }
    }, [form, pasteText, entryMode, modalOpen, editId, draftKey]);

    const openAdd = () => {
        setEditId(null);
        // 이전에 튕겨서 남은 초안이 있으면 복원, 없으면 빈 폼.
        let draft: { form?: ClientForm; pasteText?: string; entryMode?: 'guide' | 'paste' } | null = null;
        try {
            draft = JSON.parse(localStorage.getItem(draftKey) || 'null');
        } catch {
            draft = null;
        }
        if (draft?.form) {
            setForm(draft.form);
            setPasteText(draft.pasteText || '');
            setEntryMode(draft.entryMode || 'guide');
        } else {
            // 계약 관리에서 추가 = 바로 계약완료 기본값. 고객사 관리(문의) = 신규문의.
            setForm({ ...emptyForm, status: contractsOnly ? DONE_STATUS : STATUS_OPTIONS[0] });
            setPasteText('');
            setEntryMode('guide');
        }
        setProdCats([]);
        setProdInputs({});
        setModalOpen(true);
    };

    // 승인 — 신규 등록건을 최종 승인해 '계약 중'으로 이동(DB 반영, 집/회사 공유).
    const approveContract = async (client: ErpClient) => {
        const { error } = await updateClient(client.id, { contract_approved: true });
        if (error) {
            showToast('승인 실패: ' + error.message + ' (clients.contract_approved 컬럼 필요)');
            return;
        }
        showToast('승인됨 → 계약 중');
        await refresh();
        openDetail(client.id); // 승인하면 그 업체 상세페이지로 이동
    };

    // 계약 종료(사유 필수) — 상태를 '계약종료'로 + 히스토리에 사유 기록(고객사 관리 계약 종료로 남음).
    const confirmEndContract = async () => {
        if (!endTarget) return;
        const reason = endReason.trim();
        if (!reason) {
            showToast('종료 사유를 입력해주세요');
            return;
        }
        const prev = Array.isArray(endTarget.history) ? endTarget.history : [];
        const { error } = await updateClient(endTarget.id, {
            status: ENDED_STATUS,
            history: [{ date: todayStr(), text: `계약 종료 사유: ${reason}` }, ...prev],
        });
        if (error) {
            showToast(`오류: ${error.message}`);
            return;
        }
        setEndTarget(null);
        setEndReason('');
        showToast('계약 종료 처리됨 (고객사 관리 · 계약 종료)');
        await refresh();
    };

    // 상태 변경(계약 진행 단계 선택 / 계약 종료 처리 공용).
    const changeStatus = async (client: ErpClient, status: string, toastMsg?: string) => {
        // 고객사 관리에서 '계약완료'로 넘어오면 승인 대기(신규 등록건). 승인 버튼을 눌러야 계약 중으로.
        const patch: Partial<ErpClient> =
            status === DONE_STATUS && !contractsOnly ? { status, contract_approved: false } : { status };
        const { error: statusError } = await updateClient(client.id, patch);
        if (statusError) {
            showToast(`오류: ${statusError.message}`);
            return;
        }
        setStageClient(null);
        showToast(toastMsg || `상태 변경: ${status}`);
        await refresh(); // 상태 반영된 목록을 먼저 받은 뒤 이동해야 계약 관리에서 바로 보임.
        // 고객사 관리에서 계약완료로 바꾸면 → 계약 관리 '신규 등록 건'으로 이동(상세는 승인 후에만).
        if (status === DONE_STATUS && !contractsOnly) {
            markNewContract(client.id);
            setNewMap(readNewContracts());
            window.history.pushState(null, '', '/contracts');
            window.dispatchEvent(new Event('app:navigate'));
        }
    };


    const saveClient = async (force = false) => {
        // 담당자는 선택 — 업체명만 있으면 등록 가능.
        if (!form.company.trim()) {
            showToast('업체명을 입력해주세요');
            return;
        }
        // 신규 등록 시 업체명 중복 차단 — 전체(allClients) 기준. 매칭되면 안내 모달 → 기존 상세로 유도.
        const co = form.company.trim();
        if (!editId && co && !force) {
            const key = normCompany(co);
            const hits = allClients.filter((c) => c.company && normCompany(c.company) === key);
            if (hits.length) {
                setDupMatches(hits);
                return;
            }
        }
        setSaving(true);

        const payload: Partial<ErpClient> = {
            address: form.address.trim() || null,
            amount: Number(form.amount) || 0,
            budget: form.budget.trim() || null,
            business_number: form.business_number.trim() || null,
            client_partner: form.client_partner.trim() || null,
            company: form.company.trim() || null,
            industry: form.industry || null,
            contact: form.contact.trim() || null,
            contract_end: form.contract_end || null,
            contract_start: form.contract_start || null,
            email: form.email.trim() || null,
            manager: form.manager.trim(),
            next_contact: form.next_contact || null,
            notes: form.notes.trim() || null,
            phone: form.phone.trim() || null,
            product: form.product.trim() || null,
            source: form.source || null,
            status: form.status,
            url: form.url.trim() || null,
        };

        // 초기 히스토리 — 등록 폼의 '히스토리 추가' 칸 우선, 없으면 붙여넣기에서 파싱.
        const parsed = parsePaste(pasteText);
        const histText = form.historyText.trim();
        if (!editId) {
            if (histText) {
                payload.history = [{ date: todayStr(), text: histText }];
            } else if (parsed.inquiry) {
                payload.history = [{ date: todayStr(), text: parsed.inquiry }];
            }
        }

        let saveError = null as { message: string } | null;
        let createdId: string | null = null;
        if (editId) {
            ({ error: saveError } = await updateClient(editId, payload));
        } else {
            const res = await insertClient(payload);
            saveError = res.error;
            createdId = res.data[0]?.id ?? null;
        }

        // 상품 → 계약 내역(client_contracts): 선택한 카테고리의 세부 중 건수/금액 입력된 것만.
        if (!saveError && createdId && prodCats.length) {
            const rows: Array<Partial<ClientContract>> = [];
            for (const catKey of prodCats) {
                const cat = PRODUCT_CATEGORIES.find((c) => c.key === catKey);
                if (!cat) continue;
                for (const sub of cat.subs) {
                    const inp = prodInputs[`${catKey}|${sub}`];
                    const qty = subQty(catKey, sub); // 일 단위면 일일수량×일수
                    const count = qty > 0 ? qty : null;
                    const unit = inp?.unit ? Number(onlyDigits(inp.unit)) : null;
                    const outUnit = inp?.outsource ? Number(onlyDigits(inp.outsource)) : null;
                    const amt = (unit || 0) * qty; // 매출 = 단가 × 수량
                    const outAmt = (outUnit || 0) * qty; // 외주비 = 외주단가 × 수량
                    if (qty > 0 || amt > 0) {
                        rows.push({
                            amount: amt,
                            category: cat.label,
                            client_id: createdId,
                            contract_date: todayStr(),
                            goal_count: count,
                            outsource: outAmt,
                            outsource_company: inp?.outCompany?.trim() || null,
                            per_day: isDailySub(sub) ? Number(onlyDigits(inp?.perDay || '')) || null : null,
                            remain_count: count,
                            subtype: sub,
                            unit_outsource: outUnit,
                            unit_price: unit,
                        });
                    }
                }
            }
            if (rows.length) {
                const { error: cErr } = await insertClientContracts(rows);
                if (cErr) showToast(`계약 저장 오류: ${cErr.message}`);
                await reloadContracts();
                // 브랜드 블로그 계약만 브랜드블로그 관리 시트(blog_accounts)에 등록.
                //   최적화·준최적화·단순·AI 블로그 배포는 각 하위 카테고리 페이지에서 관리.
                const blogRow = rows.find(
                    (r) => r.category === '블로그' && isBrandBlogSub(r.subtype || ''),
                );
                if (blogRow) {
                    await ensureClientBlogAccount(createdId, payload.company || '업체', {
                        amount: blogRow.amount ?? null,
                        contract_date: blogRow.contract_date ?? null,
                        goal_count: blogRow.goal_count ?? null,
                        manager: payload.manager ?? null,
                        remain_count: blogRow.remain_count ?? null,
                    });
                    await reloadBlogs();
                }
            }
        }

        setSaving(false);

        if (saveError) {
            showToast(`오류: ${saveError.message}`);
            return;
        }

        // 신규 등록(문의 추가 등) → 목록에서 파란색 강조(24h). newIds 기록.
        if (!editId && createdId) {
            markNewContract(createdId);
            setNewMap(readNewContracts());
        }

        // 저장 성공 → 초안 삭제(다음 추가는 빈 폼으로).
        if (!editId) {
            try {
                localStorage.removeItem(draftKey);
            } catch {
                /* 무시 */
            }
        }
        setModalOpen(false);
        await refresh();
        showToast('저장되었습니다');
    };

    // 등록일 인라인 수정 — 계약이 있으면 그 고객 계약들의 contract_date, 없으면 생성일을 그 날짜로.
    const setRegDate = async (client: ErpClient, date: string) => {
        if (!date) return;
        const cts = clientContracts.filter((ct) => ct.client_id === client.id);
        if (cts.length) {
            for (const ct of cts) {
                await updateClientContract(ct.id, { contract_date: date });
            }
            await reloadContracts();
        } else {
            await updateClient(client.id, {
                created_at: date + 'T00:00:00+00:00',
            } as Partial<ErpClient>);
        }
        await refresh();
        showToast('등록일 변경됨');
    };

    const addHistory = async () => {
        const text = histInput.trim();
        if (!text || !histClient) {
            return;
        }
        const history: ClientHistory[] = [
            { date: todayStr(), text },
            ...(Array.isArray(histClient.history) ? histClient.history : []),
        ];
        const { error: histError } = await updateClient(histClient.id, { history });
        if (histError) {
            showToast(`오류: ${histError.message}`);
            return;
        }
        setHistInput('');
        setHistClient({ ...histClient, history });
        await refresh();
    };

    const removeHistory = async (index: number) => {
        if (!histClient) {
            return;
        }
        const history = (Array.isArray(histClient.history) ? histClient.history : []).filter(
            (_, i) => i !== index,
        );
        const { error: histError } = await updateClient(histClient.id, { history });
        if (histError) {
            showToast(`오류: ${histError.message}`);
            return;
        }
        setHistClient({ ...histClient, history });
        await refresh();
    };

    const confirmDelete = async () => {
        if (!delId) {
            return;
        }
        const { error: delError } = await deleteClient(delId);
        if (delError) {
            showToast(`오류: ${delError.message}`);
            return;
        }
        setDelId(null);
        await refresh();
        showToast('삭제되었습니다');
    };

    const exportCsv = () => {
        const header = [
            '담당자',
            '경로',
            '업체명',
            '연락처',
            '이메일',
            '상품',
            '예산',
            '상태',
            '최근히스토리',
            '등록일',
            '메모',
        ];
        const rows = filtered.map((c) => {
            const h = Array.isArray(c.history) && c.history[0] ? c.history[0].text : '';
            const dt = c.created_at ? new Date(c.created_at).toLocaleDateString('ko-KR') : '';
            return [
                c.manager || '',
                c.source || '',
                c.company || '',
                c.contact || '',
                c.email || '',
                c.product || '',
                c.budget || '',
                c.status || '',
                h,
                dt,
                (c.notes || '').replace(/\n/g, ' '),
            ];
        });
        const csv =
            '﻿' +
            [header, ...rows]
                .map((row) => row.map((v) => `"${String(v)}"`).join(','))
                .join('\n');
        const link = document.createElement('a');
        link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
        link.download = `고객DB_${todayStr()}.csv`;
        link.click();
    };


    // 업체명 클릭 시 상세 페이지
    const detailClient = detailId ? clients.find((c) => c.id === detailId) : null;
    if (detailClient) {
        return (
            <ClientDetail
                client={detailClient}
                contracts={scopeMonth(clientContracts.filter((c) => c.client_id === detailClient.id))}
                onClose={closeDetail}
                onDelete={() =>
                    void deleteClient(detailClient.id).then(() => {
                        closeDetail();
                        void refresh();
                    })
                }
                onReloadContracts={reloadContracts}
                onSave={(patch) => void updateClient(detailClient.id, patch).then(() => void refresh())}
                onToast={showToast}
                salespeople={salespeople}
            />
        );
    }

    return (
        <section className="grid gap-4">
            <div className="flex items-center justify-between gap-3">
                <div>
                    <p className="m-0 text-sm text-[#64748b]">
                        {contractsOnly
                            ? '실제 계약 진행 중인 건을 관리합니다.'
                            : '문의·고객(계약·보류 포함)을 관리합니다.'}{' '}
                        {loading
                            ? '불러오는 중...'
                            : `총 ${contractsOnly ? clients.filter((c) => c.status === DONE_STATUS).length : clients.length}건`}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    {contractsOnly && canEdit ? (
                        <Button
                            className="inline-flex h-10 items-center justify-center rounded-md border border-[#1e40af] px-4 text-sm font-semibold text-[#1e40af]"
                            onClick={() => setImportOpen(true)}
                            type="button"
                        >
                            시트 붙여넣기
                        </Button>
                    ) : null}
                    {/* 등록/추가는 뷰어(고객 열람전용)에서 숨김 */}
                    {canEdit ? (
                        <Button
                            className="inline-flex h-10 items-center justify-center rounded-md bg-[#1e40af] px-4 text-sm font-semibold text-white"
                            onClick={openAdd}
                            type="button"
                        >
                            {contractsOnly ? '+ 계약 추가' : '+ 문의 추가'}
                        </Button>
                    ) : null}
                </div>
            </div>

            {/* 계약 관리 상단 KPI — 블로그 대시보드 KPI 스타일(라벨/큰 숫자/서브). 재계약 임박은 눌러서 상세. */}
            {contractsOnly ? (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <div className="rounded-lg border-2 border-[#1e40af] bg-[#eff6ff] px-4 py-3 shadow-sm ring-1 ring-[#bfdbfe]">
                        <div className="text-xs font-bold text-[#1e40af]">계약 중</div>
                        <div className="mt-0.5 text-2xl font-bold text-[#1e40af]">{doneClientIds.size}건</div>
                        <div className="mt-0.5 text-[11px] font-semibold text-[#64748b]">계약완료 상태 고객</div>
                    </div>
                    <button
                        className={`rounded-lg border-2 px-4 py-3 text-left shadow-sm ring-1 transition hover:shadow-md ${
                            kpiTone === 'red'
                                ? 'border-[#dc2626] bg-[#fef2f2] ring-[#fecaca]'
                                : kpiTone === 'yellow'
                                  ? 'border-[#eab308] bg-[#fefce8] ring-[#fde68a]'
                                  : 'border-[#e2e8f0] bg-white ring-[#f1f5f9]'
                        }`}
                        onClick={() => setShowImminent(true)}
                        type="button"
                    >
                        <div className="flex items-center justify-between">
                            <span
                                className="text-xs font-bold"
                                style={{
                                    color:
                                        kpiTone === 'red' ? '#b91c1c' : kpiTone === 'yellow' ? '#a16207' : '#64748b',
                                }}
                            >
                                재계약 임박
                            </span>
                            <span className="text-[10px] font-semibold text-[#94a3b8]">눌러서 보기 ↗</span>
                        </div>
                        <div
                            className="mt-0.5 text-2xl font-bold"
                            style={{
                                color: kpiTone === 'red' ? '#dc2626' : kpiTone === 'yellow' ? '#d97706' : '#94a3b8',
                            }}
                        >
                            {imminentList.length}건
                        </div>
                        <div className="mt-0.5 text-[11px] font-semibold text-[#64748b]">잔여 5건 이하</div>
                    </button>
                </div>
            ) : null}

            {error ? (
                <p className="m-0 rounded-md bg-[#fee2e2] px-4 py-3 text-sm text-[#dc2626]">
                    {error} — Supabase에 clients/contract_data 테이블이 생성됐는지 확인하세요
                    (docs/erp-tables.sql)
                </p>
            ) : null}

            <div className="flex flex-wrap items-center gap-2 rounded-[8px] border border-[#e2e8f0] bg-[#f1f5f9] p-3">
                {/* 년/월 필터 — 계약 관리 + 고객사 관리 공통. 년·월 2개로 구분. */}
                <select
                    className="h-9 rounded-md border border-[#1e40af] bg-white px-2 text-sm font-bold text-[#1e40af]"
                    onChange={(e) => setYearFilter(Number(e.target.value))}
                    title="년도별 보기"
                    value={yearFilter}
                >
                    {yearOptions.map((y) => (
                        <option key={y} value={y}>
                            {y === 0 ? '전체 년도' : `${String(y).slice(2)}년`}
                        </option>
                    ))}
                </select>
                <select
                    className="h-9 rounded-md border border-[#1e40af] bg-white px-2 text-sm font-bold text-[#1e40af]"
                    onChange={(e) => setMonthFilter(Number(e.target.value))}
                    title="월별 보기"
                    value={monthFilter}
                >
                    {monthOptions.map((m) => (
                        <option key={m} value={m}>
                            {m === 0 ? '전체 월' : `${m}월`}
                        </option>
                    ))}
                </select>
                <input
                    className="h-9 min-w-[180px] flex-1 rounded-md border border-[#cbd5e1] bg-white px-3 text-sm"
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="담당자·업체명·연락처 검색..."
                    value={search}
                />
                <select
                    className="h-9 rounded-md border border-[#cbd5e1] bg-white px-2 text-xs"
                    onChange={(event) => setStatusFilter(event.target.value)}
                    value={statusFilter}
                >
                    <option value="">전체 상태</option>
                    {STATUS_OPTIONS.map((s) => (
                        <option key={s}>{s}</option>
                    ))}
                </select>
                <label className="flex items-center gap-1 text-xs text-[#334155]">
                    <input
                        checked={favOnly}
                        onChange={(event) => setFavOnly(event.target.checked)}
                        type="checkbox"
                    />
                    ⭐ 즐겨찾기만
                </label>
                <span className="ml-auto text-xs font-medium text-[#64748b]">{filtered.length}건</span>
                <Button
                    className="inline-flex h-8 items-center rounded-md border border-[#cbd5e1] bg-white px-3 text-xs font-semibold"
                    onClick={exportCsv}
                    type="button"
                >
                    CSV
                </Button>
                <Button
                    className="inline-flex h-8 items-center rounded-md border border-[#cbd5e1] bg-white px-3 text-xs font-semibold"
                    onClick={() => void refresh()}
                    type="button"
                >
                    새로고침
                </Button>
            </div>

            {/* 월 매출 요약 카드 — 금액 열람 권한자(대표·테스트·조재현)만. */}
            {contractsOnly && canSeeAmounts(profile?.email) ? (
                <div className="rounded-[10px] border border-[#e2e8f0] bg-white p-3">
                    <div className="mb-2 flex items-baseline gap-2">
                        <span className="rounded-md bg-[#1e40af] px-2 py-0.5 text-xs font-bold text-white">
                            {yearFilter || monthFilter
                                ? `${yearFilter ? `${yearFilter}년 ` : ''}${monthFilter ? `${monthFilter}월` : ''}`.trim()
                                : '전체'}
                        </span>
                        <span className="text-xs font-semibold text-[#64748b]">매출 요약</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                        {(
                            [
                                ['공급가액', revenueSummary.supply, '#334155'],
                                ['부가세 (10%)', revenueSummary.vat, '#64748b'],
                                ['실매출 (VAT 포함)', revenueSummary.total, '#1e40af'],
                                ['외주비', revenueSummary.outs, '#dc2626'],
                                ['순매출 (공급가−외주)', revenueSummary.net, '#059669'],
                                // 남은 차액 = 예상 외주비 − 실제 사용 외주비(아직 안 쓴 외주비 여유분). 음수면 빨강.
                                ['남은 차액 (예상−사용)', revenueSummary.diff, revenueSummary.diff < 0 ? '#dc2626' : '#7c3aed'],
                            ] as [string, number, string][]
                        ).map(([label, val, color]) => (
                            <div
                                className="rounded-lg border border-[#eef2f7] bg-[#f8fafc] px-3 py-2 text-center"
                                key={label}
                            >
                                <div className="text-[11px] font-semibold text-[#94a3b8]">{label}</div>
                                <div className="mt-0.5 text-base font-bold sm:text-lg" style={{ color }}>
                                    {val.toLocaleString('ko-KR')}
                                    <span className="text-[11px] font-semibold text-[#94a3b8]">원</span>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            ) : null}

            {!contractsOnly ? (
                <div className="flex gap-1 border-b border-[#e2e8f0]">
                    {(
                        [
                            { key: 'consult', label: '상담 건' },
                            { key: 'prospect', label: '가망 건' },
                            { key: 'hold', label: '보류' },
                            { key: 'done', label: '계약 완료' },
                            { key: 'ended', label: '계약 종료' },
                        ] as {
                            key: 'consult' | 'prospect' | 'hold' | 'done' | 'ended';
                            label: string;
                        }[]
                    ).map((t) => {
                        const inMonth = (c: ErpClient) => clientInPeriod(c, yearFilter, monthFilter);
                        const statusFor = (c: ErpClient) =>
                            t.key === 'done'
                                ? c.status === DONE_STATUS
                                : t.key === 'ended'
                                  ? c.status === ENDED_STATUS
                                  : t.key === 'prospect'
                                    ? c.status === '가망'
                                    : t.key === 'hold'
                                      ? c.status === '보류'
                                      : c.status !== DONE_STATUS &&
                                        c.status !== ENDED_STATUS &&
                                        c.status !== '보류' &&
                                        c.status !== '가망';
                        const count = clients.filter((c) => statusFor(c) && inMonth(c)).length;
                        return (
                            <button
                                className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold ${
                                    clientTab === t.key
                                        ? 'border-[#1e40af] text-[#1e40af]'
                                        : 'border-transparent text-[#94a3b8] hover:text-[#475569]'
                                }`}
                                key={t.key}
                                onClick={() => setClientTab(t.key)}
                                type="button"
                            >
                                {t.label} ({count})
                            </button>
                        );
                    })}
                </div>
            ) : null}

            {contractsOnly ? (
                <div className="flex gap-1 border-b border-[#e2e8f0]">
                    {(
                        [
                            // 신규 등록건 탭은 신규(미승인)가 있을 때만 노출.
                            ...(newContractCount > 0
                                ? [{ key: 'new', label: '신규 등록건' } as const]
                                : []),
                            { key: 'active', label: '계약중' },
                            // 임시 탭은 날짜 미등록 계약이 있을 때만 노출.
                            ...(tempCount > 0 ? [{ key: 'temp', label: '임시' } as const] : []),
                            { key: 'ended', label: '계약 종료' },
                        ] as { key: 'new' | 'active' | 'temp' | 'ended'; label: string }[]
                    ).map((t) => {
                        // 계약중만 연/월 기준. 신규·임시·종료는 기간 무관 전체.
                        const count =
                            t.key === 'new'
                                ? newContractCount
                                : t.key === 'temp'
                                  ? tempCount
                                  : t.key === 'ended'
                                    ? clients.filter((c) => c.status === ENDED_STATUS).length
                                    : clients.filter(
                                          (c) =>
                                              c.status === DONE_STATUS &&
                                              c.contract_approved &&
                                              hasDatedContract(c) &&
                                              clientInPeriod(c, yearFilter, monthFilter),
                                      ).length;
                        const active = contractTab === t.key;
                        // 신규 등록건 탭은 파란 강조(신규건 UI와 통일).
                        const newTab = t.key === 'new';
                        return (
                            <button
                                className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold ${
                                    active
                                        ? 'border-[#1e40af] text-[#1e40af]'
                                        : 'border-transparent text-[#94a3b8] hover:text-[#475569]'
                                } ${newTab && count > 0 ? 'text-[#1e40af]' : ''}`}
                                key={t.key}
                                onClick={() => setContractTab(t.key)}
                                type="button"
                            >
                                {newTab && count > 0 ? '🔵 ' : ''}
                                {t.label} ({count})
                            </button>
                        );
                    })}
                </div>
            ) : null}

            <div className="overflow-x-auto rounded-[8px] border border-[#e2e8f0] bg-white">
                <table className="w-full border-collapse text-left text-sm">
                    <thead>
                        <tr className="border-b-2 border-[#e2e8f0] bg-[#f1f5f9] text-[11px] text-[#64748b]">
                            <th className="px-3 py-2 font-semibold">⭐</th>
                            <th className="px-3 py-2 font-semibold">담당자</th>
                            <th className="px-3 py-2 font-semibold">업체명</th>
                            {contractsOnly ? (
                                <th className="min-w-[280px] px-3 py-2 font-semibold">상품</th>
                            ) : null}
                            {!contractsOnly ? <th className="px-3 py-2 font-semibold">연락처</th> : null}
                            <th className="px-3 py-2 font-semibold">상태</th>
                            {contractsOnly ? (
                                <th className="px-3 py-2 font-semibold">잔여 외주비</th>
                            ) : null}
                            {!contractsOnly ? <th className="px-3 py-2 font-semibold">상품</th> : null}
                            {!contractsOnly ? (
                                <th className="px-3 py-2 font-semibold">최근 히스토리</th>
                            ) : null}
                            <th className="px-3 py-2 font-semibold">
                                <button
                                    className="inline-flex items-center gap-0.5 font-semibold hover:text-[#1e40af]"
                                    onClick={() =>
                                        setDateSort((d) => (d === 'asc' ? 'desc' : d === 'desc' ? null : 'asc'))
                                    }
                                    title="등록일 정렬 (오름/내림)"
                                    type="button"
                                >
                                    등록일 {dateSort === 'asc' ? '▲' : dateSort === 'desc' ? '▼' : '↕'}
                                </button>
                            </th>
                            <th className="px-3 py-2 font-semibold">액션</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filtered.length ? (
                            filtered.map((c) => {
                                const lastHist =
                                    Array.isArray(c.history) && c.history[0]
                                        ? c.history[0].text
                                        : '--';
                                // 등록일 = 시트 일자(계약 중 가장 이른 contract_date) 우선, 없으면 생성일.
                                //   월 필터 시 그 달 계약 기준(6월이면 6월 첫 계약일).
                                const cds = scopeMonth(
                                    clientContracts.filter((ct) => ct.client_id === c.id && ct.contract_date),
                                )
                                    .map((ct) => ct.contract_date as string)
                                    .sort();
                                // 표기 통일 — 계약일 우선, 없으면 생성일 모두 YYYY-MM-DD.
                                const dt = cds.length
                                    ? cds[0]
                                    : c.created_at
                                      ? c.created_at.slice(0, 10)
                                      : '--';
                                // 계약 관리 신규건 = 미승인(승인 전). 고객사 관리 화면에선 최근등록(newIds) 강조 유지.
                                const isNew = contractsOnly ? !c.contract_approved : newIds.has(c.id);
                                // 상품 상세 집계 — 카테고리 → 세부유형별 계약/진행/잔여(합산). 월 필터 시 그 달 상품만.
                                const myCts = scopeMonth(
                                    clientContracts.filter((ct) => ct.client_id === c.id),
                                );
                                const byCat = new Map<
                                    string,
                                    Map<string, { goal: number; remain: number; n: number; amt: number; doneAmt: number }>
                                >();
                                for (const ct of myCts) {
                                    const subs = byCat.get(ct.category) ?? new Map();
                                    const cur = subs.get(ct.subtype) ?? {
                                        amt: 0,
                                        doneAmt: 0,
                                        goal: 0,
                                        n: 0,
                                        remain: 0,
                                    };
                                    cur.goal += ct.goal_count ?? 0;
                                    cur.remain += ct.remain_count ?? 0;
                                    // 분모=총 외주비, 완료=소진 외주금액 → 진행률 = 소진/총외주(외주비 소진율)
                                    cur.amt += totalOutsource(ct);
                                    cur.doneAmt += completedOutsource(ct);
                                    cur.n += 1;
                                    subs.set(ct.subtype, cur);
                                    byCat.set(ct.category, subs);
                                }
                                const expanded = expandedProduct === c.id;
                                return (
                                    <Fragment key={c.id}>
                                    <tr
                                        className={`cursor-pointer border-b border-[#e2e8f0] ${
                                            isNew
                                                ? 'bg-[#eff6ff] ring-2 ring-inset ring-[#1e40af] hover:bg-[#dbeafe]'
                                                : 'hover:bg-[#f8fafc]'
                                        }`}
                                        onClick={(e) => {
                                            if ((e.target as HTMLElement).closest('button, a, input, select')) return;
                                            // 계약 관리: 승인된 건만 상세(신규 등록 건은 승인 후). 고객사 관리: 계약완료 건만.
                                            const canDetail = contractsOnly
                                                ? !!c.contract_approved
                                                : c.status === DONE_STATUS;
                                            if (canDetail) openDetail(c.id);
                                        }}
                                    >
                                        <td className="px-3 py-2">
                                            <button
                                                className="text-sm"
                                                onClick={() => toggleFav(c.id)}
                                                type="button"
                                            >
                                                {favs.includes(c.id) ? '⭐' : '☆'}
                                            </button>
                                        </td>
                                        <td className="px-3 py-2 font-semibold">{c.manager}</td>
                                        <td className="px-3 py-2">
                                            {(contractsOnly ? !!c.contract_approved : c.status === DONE_STATUS) ? (
                                                <button
                                                    className="font-medium text-[#1e40af] hover:underline"
                                                    onClick={() => openDetail(c.id)}
                                                    title="클릭해서 상세 보기"
                                                    type="button"
                                                >
                                                    {c.company || '--'}
                                                </button>
                                            ) : (
                                                <span
                                                    className="font-medium text-[#334155]"
                                                    title={
                                                        contractsOnly
                                                            ? '승인하면 상세로 이동합니다'
                                                            : '계약 진행 → 계약완료 후 상세가 생성됩니다'
                                                    }
                                                >
                                                    {c.company || '--'}
                                                </span>
                                            )}
                                            {isNew ? (
                                                <span className="ml-1.5 rounded-full bg-[#1e40af] px-1.5 py-0.5 text-[10px] font-bold text-white">
                                                    신규
                                                </span>
                                            ) : null}
                                        </td>
                                        {contractsOnly ? (
                                        <td className="min-w-[320px] px-3 py-2">
                                            {(() => {
                                                const entries = [...byCat.entries()];
                                                const subCount = entries.reduce((s, [, m]) => s + m.size, 0);
                                                // 계약 없음 → 블로그 계정만 있으면 칩, 아니면 --
                                                if (!subCount) {
                                                    return blogAccounts.some((a) => a.client_id === c.id) ? (
                                                        <span className="rounded-full bg-[#e0e7ff] px-2 py-0.5 text-[11px] font-semibold text-[#4338ca]">
                                                            블로그
                                                        </span>
                                                    ) : (
                                                        <span className="text-xs text-[#94a3b8]">--</span>
                                                    );
                                                }
                                                // 세부유형 4개 이하 → 인라인(가로) 표시. 초과 → 카테고리 칩 + 상세보기 아코디언.
                                                if (subCount <= 4) {
                                                    return (
                                                        <div className="grid gap-1">
                                                            {entries.flatMap(([cat, m]) =>
                                                                [...m.entries()].map(([sub, v]) => {
                                                                    const done = v.goal - v.remain;
                                                                    const prog = progMoney(v.goal, v.remain, v.amt, v.doneAmt);
                                                                    // 카테고리별 연한 배경 + 테두리로 박스 구분.
                                                                    const cs = catStyle(cat);
                                                                    return (
                                                                        <div
                                                                            className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px]"
                                                                            key={cat + sub}
                                                                            style={{
                                                                                background: cs.bg,
                                                                                borderColor: cs.border,
                                                                            }}
                                                                        >
                                                                            <span className="w-28 shrink-0 truncate font-semibold text-[#334155]">
                                                                                {sub}
                                                                                {v.n > 1 ? (
                                                                                    <span className="text-[#94a3b8]"> ×{v.n}</span>
                                                                                ) : null}
                                                                            </span>
                                                                            <div className="h-1.5 w-14 shrink-0 overflow-hidden rounded-full bg-[#e2e8f0]">
                                                                                {prog != null ? (
                                                                                    <div
                                                                                        className="h-full rounded-full"
                                                                                        style={{
                                                                                            background: progColor(prog),
                                                                                            width: `${Math.min(100, Math.max(0, prog))}%`,
                                                                                        }}
                                                                                    />
                                                                                ) : null}
                                                                            </div>
                                                                            <span
                                                                                className="w-8 shrink-0 text-right font-bold"
                                                                                style={{ color: progColor(prog) }}
                                                                            >
                                                                                {prog != null ? `${prog}%` : '-'}
                                                                            </span>
                                                                            <span className="whitespace-nowrap text-[#64748b]">
                                                                                {done}/{v.goal || 0}·
                                                                                <span className="font-bold text-[#dc2626]">
                                                                                    잔여{v.remain}
                                                                                </span>
                                                                            </span>
                                                                        </div>
                                                                    );
                                                                }),
                                                            )}
                                                        </div>
                                                    );
                                                }
                                                // 5개 이상 → 카테고리 칩 + 상세보기
                                                return (
                                                    <>
                                                        <span className="flex flex-wrap gap-1">
                                                            {entries.map(([cat, m]) => (
                                                                <span
                                                                    className="rounded-full bg-[#e0e7ff] px-2 py-0.5 text-[11px] font-semibold text-[#4338ca]"
                                                                    key={cat}
                                                                >
                                                                    {cat}{' '}
                                                                    <b className="text-[#1e40af]">
                                                                        {[...m.values()].reduce((s, v) => s + v.n, 0)}
                                                                    </b>
                                                                </span>
                                                            ))}
                                                        </span>
                                                        <button
                                                            className="mt-1 block text-[11px] font-semibold text-[#4338ca] hover:underline"
                                                            onClick={() =>
                                                                setExpandedProduct((p) => (p === c.id ? null : c.id))
                                                            }
                                                            type="button"
                                                        >
                                                            상세보기 {expanded ? '▲' : '▼'}
                                                        </button>
                                                        {/* 펼침 — 상품 셀 안에 세로로(일자) 박스 나열 */}
                                                        {expanded ? (
                                                            <div className="mt-2 grid max-w-[560px] gap-1">
                                                                {entries.flatMap(([cat, m]) =>
                                                                    [...m.entries()].map(([sub, v]) => {
                                                                        const done = v.goal - v.remain;
                                                                        const prog = progMoney(v.goal, v.remain, v.amt, v.doneAmt);
                                                                        const cs = catStyle(cat);
                                                                        return (
                                                                            <div
                                                                                className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px]"
                                                                                key={cat + sub}
                                                                                style={{ background: cs.bg, borderColor: cs.border }}
                                                                            >
                                                                                <span className="w-28 shrink-0 truncate font-semibold text-[#334155]">
                                                                                    {sub}
                                                                                    {v.n > 1 ? (
                                                                                        <span className="text-[#94a3b8]"> ×{v.n}</span>
                                                                                    ) : null}
                                                                                </span>
                                                                                <div className="h-1.5 w-14 shrink-0 overflow-hidden rounded-full bg-white/70">
                                                                                    {prog != null ? (
                                                                                        <div
                                                                                            className="h-full rounded-full"
                                                                                            style={{
                                                                                                background: progColor(prog),
                                                                                                width: `${Math.min(100, Math.max(0, prog))}%`,
                                                                                            }}
                                                                                        />
                                                                                    ) : null}
                                                                                </div>
                                                                                <span
                                                                                    className="w-8 shrink-0 text-right font-bold"
                                                                                    style={{ color: progColor(prog) }}
                                                                                >
                                                                                    {prog != null ? `${prog}%` : '-'}
                                                                                </span>
                                                                                <span className="whitespace-nowrap text-[#64748b]">
                                                                                    {done}/{v.goal || 0}·
                                                                                <span className="font-bold text-[#dc2626]">
                                                                                    잔여{v.remain}
                                                                                </span>
                                                                                </span>
                                                                            </div>
                                                                        );
                                                                    }),
                                                                )}
                                                            </div>
                                                        ) : null}
                                                    </>
                                                );
                                            })()}
                                        </td>
                                        ) : null}
                                        {!contractsOnly ? (
                                            <td className="px-3 py-2 text-xs text-[#64748b]">
                                                {c.contact || '--'}
                                            </td>
                                        ) : null}
                                        <td className="px-3 py-2">
                                            <span
                                                className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                                                    // 방금 등록(24h)한 미완료 건 → 파란색 강조.
                                                    newIds.has(c.id) &&
                                                    c.status !== DONE_STATUS &&
                                                    c.status !== ENDED_STATUS
                                                        ? 'bg-[#1e40af] text-white'
                                                        : STATUS_BADGE[c.status || ''] ||
                                                          'bg-[#e2e8f0] text-[#64748b]'
                                                }`}
                                            >
                                                {c.status || '--'}
                                            </span>
                                        </td>
                                        {contractsOnly ? (
                                        <td className="px-3 py-2 text-xs">
                                            {(() => {
                                                const mine = scopeMonth(
                                                    clientContracts.filter((ct) => ct.client_id === c.id),
                                                );
                                                // 잔여 외주비 = 외주단가 × 잔여수량(건별 소진 추적).
                                                const remainOut = mine.reduce(
                                                    (s, ct) =>
                                                        s +
                                                        (ct.unit_outsource ?? 0) * (ct.remain_count ?? 0),
                                                    0,
                                                );
                                                // 직접입력 등 총 외주비(단가 없는 건 포함) — 잔여가 0이어도 총액이 있으면 표시.
                                                const totalOut = mine.reduce(
                                                    (s, ct) => s + (ct.outsource ?? 0),
                                                    0,
                                                );
                                                if (remainOut > 0)
                                                    return (
                                                        <button
                                                            className="font-bold text-[#dc2626] hover:underline"
                                                            onClick={() => setOutsourceClient(c.id)}
                                                            title="외주비 상세 보기"
                                                            type="button"
                                                        >
                                                            {remainOut.toLocaleString('ko-KR')}원
                                                        </button>
                                                    );
                                                if (totalOut > 0)
                                                    return (
                                                        <button
                                                            className="text-[#94a3b8] hover:underline"
                                                            onClick={() => setOutsourceClient(c.id)}
                                                            title="외주비 상세 보기(총액)"
                                                            type="button"
                                                        >
                                                            {totalOut.toLocaleString('ko-KR')}원
                                                        </button>
                                                    );
                                                return <span className="text-[#94a3b8]">--</span>;
                                            })()}
                                        </td>
                                        ) : null}
                                        {!contractsOnly ? (
                                            <td className="px-3 py-2">
                                                {(() => {
                                                    const prod = c.product || '';
                                                    if (!prod)
                                                        return <span className="text-xs text-[#94a3b8]">--</span>;
                                                    // 브랜드 블로그 관련이면 보라 칩, 아니면 원문 회색 칩.
                                                    if (/브랜드\s*블로그/.test(prod))
                                                        return (
                                                            <span className="rounded-full bg-[#ede9fe] px-2 py-0.5 text-[11px] font-bold text-[#7c3aed]">
                                                                브랜드 블로그
                                                            </span>
                                                        );
                                                    return (
                                                        <span className="rounded-full bg-[#e0e7ff] px-2 py-0.5 text-[11px] font-semibold text-[#4338ca]">
                                                            {prod}
                                                        </span>
                                                    );
                                                })()}
                                            </td>
                                        ) : null}
                                        {!contractsOnly ? (
                                            <td className="max-w-[180px] truncate px-3 py-2 text-xs text-[#64748b]">
                                                {lastHist}
                                            </td>
                                        ) : null}
                                        <td className="px-3 py-2 text-xs text-[#64748b]">
                                            <input
                                                className="rounded border border-transparent bg-transparent px-1 py-0.5 text-xs text-[#64748b] hover:border-[#cbd5e1] focus:border-[#1e40af]"
                                                onChange={(e) => void setRegDate(c, e.target.value)}
                                                onClick={(e) => e.stopPropagation()}
                                                title="등록일(계약일) 수정"
                                                type="date"
                                                value={/^\d{4}-\d{2}-\d{2}$/.test(dt) ? dt : ''}
                                            />
                                        </td>
                                        <td className="px-3 py-2">
                                            <div className="flex gap-1 whitespace-nowrap">
                                                {contractsOnly && !c.contract_approved && can(DUTIES.CONTRACT_APPROVE) ? (
                                                    <>
                                                        <Button
                                                            className="rounded bg-[#1e40af] px-2.5 py-1 text-[11px] font-bold text-white hover:bg-[#1e3a8a]"
                                                            onClick={() => void approveContract(c)}
                                                            type="button"
                                                        >
                                                            승인
                                                        </Button>
                                                        <Button
                                                            className="rounded border border-[#dc2626] px-2 py-1 text-[11px] font-semibold text-[#dc2626] hover:bg-[#fef2f2]"
                                                            onClick={() => {
                                                                setEndTarget(c);
                                                                setEndReason('');
                                                            }}
                                                            type="button"
                                                        >
                                                            계약 종료
                                                        </Button>
                                                    </>
                                                ) : null}
                                                {/* 계약 진행(상태 변경) — 계약 완료 탭 제외(바꿀 일 없음). 나머지 탭에서 탭 간 상호 이동 */}
                                                {!contractsOnly && clientTab !== 'done' ? (
                                                    <Button
                                                        className="rounded border border-[#1e40af] px-2 py-1 text-[11px] font-semibold text-[#1e40af] hover:bg-[#eff6ff]"
                                                        onClick={() => setStageClient(c)}
                                                        type="button"
                                                    >
                                                        계약 진행
                                                    </Button>
                                                ) : null}
                                                <Button
                                                    className="rounded border border-[#cbd5e1] px-2 py-1 text-[11px] text-[#64748b]"
                                                    onClick={() => {
                                                        setHistClient(c);
                                                        setHistInput('');
                                                    }}
                                                    type="button"
                                                >
                                                    히스토리(
                                                    {Array.isArray(c.history) ? c.history.length : 0})
                                                </Button>
                                            </div>
                                        </td>
                                    </tr>
                                    </Fragment>
                                );
                            })
                        ) : (
                            <tr>
                                <td
                                    className="px-3 py-12 text-center text-sm text-[#64748b]"
                                    colSpan={contractsOnly ? 8 : 9}
                                >
                                    {loading ? '불러오는 중...' : '등록된 문의가 없습니다'}
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

            {modalOpen ? (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
                    // 배경 클릭으로 닫지 않음 — 실수로 눌러도 입력이 날아가지 않게(취소/저장 버튼으로만 닫힘).
                >
                    <div className="max-h-[92vh] w-[min(620px,94vw)] overflow-y-auto rounded-[8px] bg-white p-6">
                        <h3 className="m-0 mb-4 text-lg font-bold">
                            {editId
                                ? '고객사 수정'
                                : contractsOnly
                                  ? '+ 계약 추가'
                                  : '+ 문의 추가'}
                        </h3>

                        {/* 입력 방식 선택 — 가이드 입력 / 붙여넣기 (신규 등록만) */}
                        {!editId ? (
                            <div className="mb-3 flex gap-1 border-b border-[#e2e8f0]">
                                {(
                                    [
                                        ['guide', '가이드 입력'],
                                        ['paste', '붙여넣기'],
                                    ] as ['guide' | 'paste', string][]
                                ).map(([k, label]) => (
                                    <button
                                        className={`-mb-px border-b-2 px-4 py-2 text-sm font-bold ${
                                            entryMode === k
                                                ? 'border-[#1e40af] text-[#1e40af]'
                                                : 'border-transparent text-[#94a3b8] hover:text-[#475569]'
                                        }`}
                                        key={k}
                                        onClick={() => setEntryMode(k)}
                                        type="button"
                                    >
                                        {label}
                                    </button>
                                ))}
                            </div>
                        ) : null}

                        {/* 붙여넣기 — 카카오/메일 문의 통째로 붙여넣고 자동 채우기 */}
                        {!editId && entryMode === 'paste' ? (
                            <div className="mb-3 grid gap-2">
                                <textarea
                                    className="min-h-[200px] w-full resize-y rounded-md border border-[#cbd5e1] bg-white px-3 py-2 text-sm"
                                    onChange={(e) => setPasteText(e.target.value)}
                                    placeholder={
                                        '문의 내용을 통째로 붙여넣으세요.\n예)\n업체명\nWillog\n담당자명\n김수정\n연락처\n01063742667\ne-mail\nolivia@willog.io\n마케팅상품\n브랜드블로그 마케팅\n광고예산(예정)\n0~100만원\n문의내용\n안녕하세요, ...'
                                    }
                                    value={pasteText}
                                />
                                <div className="flex items-center gap-2">
                                    <Button
                                        className="rounded-md bg-[#1e40af] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                                        disabled={!pasteText.trim()}
                                        onClick={applyPaste}
                                        type="button"
                                    >
                                        자동 채우기 →
                                    </Button>
                                    <span className="text-xs text-[#94a3b8]">
                                        업체명·담당자·연락처·이메일은 칸에, 마케팅상품·광고예산·문의내용은 히스토리로 들어갑니다.
                                    </span>
                                </div>
                            </div>
                        ) : null}

                        {/* 가이드 입력 — 고정 라벨 옆 칸에 값 입력(블로그 대시보드와 동일 방식) */}
                        <div className={`grid gap-2 ${!editId && entryMode === 'paste' ? 'hidden' : ''}`}>
                            {/* 담당자(우리 담당자) : 드롭다운 — 김종인·송민경 2명. 기존값이 다르면 그 값도 유지 */}
                            <div className="flex items-center gap-2">
                                <span className="w-24 shrink-0 text-sm font-semibold text-[#475569]">
                                    담당자 :
                                </span>
                                <select
                                    className="erp-input w-full min-w-0"
                                    onChange={(event) => updateField('manager', event.target.value)}
                                    value={form.manager}
                                >
                                    <option value="">담당자 선택</option>
                                    {OUR_MANAGERS.map((m) => (
                                        <option key={m}>{m}</option>
                                    ))}
                                    {form.manager && !OUR_MANAGERS.includes(form.manager) ? (
                                        <option value={form.manager}>{form.manager}</option>
                                    ) : null}
                                </select>
                            </div>
                            {/* 문의 경로 : 직접 입력 */}
                            <div className="flex items-center gap-2">
                                <span className="w-24 shrink-0 text-sm font-semibold text-[#475569]">
                                    문의 경로 :
                                </span>
                                <input
                                    className="erp-input w-full min-w-0"
                                    onChange={(event) => updateField('source', event.target.value)}
                                    placeholder="문의 경로 직접 입력 (예: 인스타 DM, 지인 소개)"
                                    value={form.source}
                                />
                            </div>
                            {/* 업체명 (계약 추가만 거래처명·사업자등록번호·사업장 주소 추가) */}
                            {(
                                (contractsOnly
                                    ? [
                                          { key: 'company', label: '업체명', ph: '업체명 입력' },
                                          { key: 'client_partner', label: '거래처명', ph: '예: 에이치에스(HS)' },
                                          { key: 'business_number', label: '사업자등록번호', ph: '000-00-00000' },
                                          { key: 'address', label: '사업장 주소', ph: '주소 입력' },
                                      ]
                                    : [{ key: 'company', label: '업체명', ph: '업체명 입력' }]) as {
                                    key: keyof ClientForm;
                                    label: string;
                                    ph: string;
                                }[]
                            ).map((f) => (
                                <div className="flex items-center gap-2" key={f.key}>
                                    <span className="w-24 shrink-0 text-sm font-semibold text-[#475569]">
                                        {f.label} :
                                    </span>
                                    <input
                                        className="erp-input w-full min-w-0"
                                        onChange={(event) =>
                                            updateField(
                                                f.key,
                                                f.key === 'business_number'
                                                    ? formatBizNo(event.target.value)
                                                    : event.target.value,
                                            )
                                        }
                                        placeholder={f.ph}
                                        value={form[f.key]}
                                    />
                                </div>
                            ))}
                            {/* 업종/업태 : 입력+선택(직접 입력 자유) */}
                            <div className="flex items-center gap-2">
                                <span className="w-24 shrink-0 text-sm font-semibold text-[#475569]">
                                    업종/업태 :
                                </span>
                                <input
                                    className="erp-input w-full min-w-0"
                                    list="industry-suggest"
                                    onChange={(event) => updateField('industry', event.target.value)}
                                    placeholder="업종/업태 입력 또는 선택"
                                    value={form.industry}
                                />
                                <datalist id="industry-suggest">
                                    {INDUSTRY_OPTIONS.map((o) => (
                                        <option key={o} value={o} />
                                    ))}
                                </datalist>
                            </div>
                            {/* 연락처 · 이메일 · url */}
                            {(
                                [
                                    { key: 'contact', label: '연락처', ph: '연락처 입력' },
                                    { key: 'email', label: '이메일', ph: '이메일 입력' },
                                    { key: 'url', label: 'url', ph: 'https://...' },
                                ] as { key: keyof ClientForm; label: string; ph: string }[]
                            ).map((f) => (
                                <div className="flex items-center gap-2" key={f.key}>
                                    <span className="w-24 shrink-0 text-sm font-semibold text-[#475569]">
                                        {f.label} :
                                    </span>
                                    <input
                                        className="erp-input w-full min-w-0"
                                        onChange={(event) =>
                                            updateField(
                                                f.key,
                                                f.key === 'contact'
                                                    ? formatPhone(event.target.value)
                                                    : event.target.value,
                                            )
                                        }
                                        placeholder={f.ph}
                                        value={form[f.key]}
                                    />
                                </div>
                            ))}
                            {/* 마케팅상품 (문의 등록) — 붙여넣기 자동 채움 대상. 브랜드 블로그면 목록에 칩 표시. */}
                            {!contractsOnly ? (
                                <div className="flex items-center gap-2">
                                    <span className="w-24 shrink-0 text-sm font-semibold text-[#475569]">
                                        마케팅상품 :
                                    </span>
                                    <input
                                        className="erp-input w-full min-w-0"
                                        onChange={(event) => updateField('product', event.target.value)}
                                        placeholder="예: 브랜드블로그 마케팅"
                                        value={form.product}
                                    />
                                </div>
                            ) : null}
                            {/* 상품 : 카테고리 다중선택 → 세부유형별 건수/금액 (계약 추가 시) */}
                            {!editId && contractsOnly ? (
                                <div className="flex items-start gap-2">
                                    <span className="mt-2 w-24 shrink-0 text-sm font-semibold text-[#475569]">
                                        상품 :
                                    </span>
                                    <div className="w-full min-w-0">
                                        <div className="flex flex-wrap gap-1.5">
                                            {PRODUCT_CATEGORIES.map((c) => {
                                                const on = prodCats.includes(c.key);
                                                return (
                                                    <button
                                                        className={`rounded-md border px-3 py-1.5 text-xs font-semibold ${
                                                            on
                                                                ? 'border-[#1e40af] bg-[#1e40af] text-white'
                                                                : 'border-[#cbd5e1] bg-white text-[#475569]'
                                                        }`}
                                                        key={c.key}
                                                        onClick={() =>
                                                            setProdCats((prev) =>
                                                                prev.includes(c.key)
                                                                    ? prev.filter((k) => k !== c.key)
                                                                    : [...prev, c.key],
                                                            )
                                                        }
                                                        type="button"
                                                    >
                                                        {c.label}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                        {prodCats.length ? (
                                            <div className="mt-2 grid gap-2">
                                                {PRODUCT_CATEGORIES.filter((c) => prodCats.includes(c.key)).map(
                                                    (c) => (
                                                        <div
                                                            className="rounded-md border border-[#e2e8f0] bg-[#f8fafc] p-2"
                                                            key={c.key}
                                                        >
                                                            <div className="mb-1 text-xs font-bold text-[#334155]">
                                                                {c.label}
                                                            </div>
                                                            <div className="grid gap-1">
                                                                {c.subs.map((sub) => {
                                                                    const k = `${c.key}|${sub}`;
                                                                    const inp =
                                                                        prodInputs[k] || {
                                                                            count: '',
                                                                            days: '',
                                                                            outCompany: '',
                                                                            outsource: '',
                                                                            perDay: '',
                                                                            unit: '',
                                                                        };
                                                                    const set = (
                                                                        field:
                                                                            | 'count'
                                                                            | 'unit'
                                                                            | 'outsource'
                                                                            | 'perDay'
                                                                            | 'days',
                                                                        v: string,
                                                                    ) =>
                                                                        setProdInputs((prev) => ({
                                                                            ...prev,
                                                                            [k]: { ...inp, [field]: onlyDigits(v) },
                                                                        }));
                                                                    // 외주업체명은 텍스트(자리수 제한 없음).
                                                                    const setOutCompany = (v: string) =>
                                                                        setProdInputs((prev) => ({
                                                                            ...prev,
                                                                            [k]: { ...inp, outCompany: v },
                                                                        }));
                                                                    const daily = isDailySub(sub);
                                                                    const cnt = daily
                                                                        ? (Number(onlyDigits(inp.perDay || '')) || 0) *
                                                                          (Number(onlyDigits(inp.days || '')) || 0)
                                                                        : Number(onlyDigits(inp.count)) || 0;
                                                                    const amt = (Number(onlyDigits(inp.unit)) || 0) * cnt;
                                                                    const outAmt =
                                                                        (Number(onlyDigits(inp.outsource)) || 0) * cnt;
                                                                    return (
                                                                        <div
                                                                            className="rounded border border-[#e2e8f0] bg-white p-1.5"
                                                                            key={sub}
                                                                        >
                                                                            <div className="flex items-center gap-1">
                                                                                <span className="w-24 shrink-0 truncate text-xs font-semibold text-[#334155]">
                                                                                    {sub}
                                                                                </span>
                                                                                {daily ? (
                                                                                    <>
                                                                                        <input
                                                                                            className="h-7 w-12 rounded border border-[#cbd5e1] px-1 text-right text-xs"
                                                                                            inputMode="numeric"
                                                                                            onChange={(e) => set('perDay', e.target.value)}
                                                                                            placeholder="타"
                                                                                            title="일일 타수(예: 100타)"
                                                                                            type="text"
                                                                                            value={withCommas(inp.perDay || '')}
                                                                                        />
                                                                                        <span className="text-[10px] text-[#94a3b8]">×</span>
                                                                                        <input
                                                                                            className="h-7 w-12 rounded border border-[#cbd5e1] px-1 text-right text-xs"
                                                                                            inputMode="numeric"
                                                                                            onChange={(e) => set('days', e.target.value)}
                                                                                            placeholder="일수"
                                                                                            title="일수(예: 90일)"
                                                                                            type="text"
                                                                                            value={withCommas(inp.days || '')}
                                                                                        />
                                                                                    </>
                                                                                ) : (
                                                                                    <input
                                                                                        className="h-7 w-14 rounded border border-[#cbd5e1] px-1.5 text-right text-xs"
                                                                                        inputMode="numeric"
                                                                                        onChange={(e) => set('count', e.target.value)}
                                                                                        placeholder="수량"
                                                                                        type="text"
                                                                                        value={withCommas(inp.count)}
                                                                                    />
                                                                                )}
                                                                                <input
                                                                                    className="h-7 w-20 rounded border border-[#cbd5e1] px-1.5 text-right text-xs"
                                                                                    inputMode="numeric"
                                                                                    onChange={(e) => set('unit', e.target.value)}
                                                                                    placeholder="판매 단가"
                                                                                    type="text"
                                                                                    value={withCommas(inp.unit)}
                                                                                />
                                                                                <input
                                                                                    className="h-7 w-20 rounded border border-[#fecaca] px-1.5 text-right text-xs"
                                                                                    inputMode="numeric"
                                                                                    onChange={(e) =>
                                                                                        set('outsource', e.target.value)
                                                                                    }
                                                                                    placeholder="외주단가"
                                                                                    type="text"
                                                                                    value={withCommas(inp.outsource)}
                                                                                />
                                                                                <input
                                                                                    className="h-7 w-28 shrink-0 rounded border border-[#fecaca] px-1.5 text-xs"
                                                                                    onChange={(e) => setOutCompany(e.target.value)}
                                                                                    placeholder="외주업체"
                                                                                    type="text"
                                                                                    value={inp.outCompany || ''}
                                                                                />
                                                                            </div>
                                                                            {daily && cnt ? (
                                                                                <div className="mt-0.5 pl-24 text-[10px] text-[#94a3b8]">
                                                                                    총 {cnt.toLocaleString('ko-KR')}타
                                                                                </div>
                                                                            ) : null}
                                                                            {amt || outAmt ? (
                                                                                <div className="mt-1 flex flex-wrap gap-x-2 pl-24 text-[11px] font-semibold text-[#64748b]">
                                                                                    <span>
                                                                                        공급가{' '}
                                                                                        <b className="text-[#1e40af]">
                                                                                            {amt.toLocaleString('ko-KR')}
                                                                                        </b>
                                                                                    </span>
                                                                                    <span>
                                                                                        부가세{' '}
                                                                                        {Math.round(
                                                                                            amt * 1.1,
                                                                                        ).toLocaleString('ko-KR')}
                                                                                    </span>
                                                                                    <span>
                                                                                        외주{' '}
                                                                                        <b className="text-[#dc2626]">
                                                                                            {outAmt.toLocaleString('ko-KR')}
                                                                                        </b>
                                                                                    </span>
                                                                                    <span>
                                                                                        순매출{' '}
                                                                                        <b className="text-[#059669]">
                                                                                            {(amt - outAmt).toLocaleString('ko-KR')}
                                                                                        </b>
                                                                                    </span>
                                                                                </div>
                                                                            ) : null}
                                                                        </div>
                                                                    );
                                                                })}
                                                            </div>
                                                        </div>
                                                    ),
                                                )}
                                                {/* 정산 요약 — 공급가·부가세포함·외주비·순매출 */}
                                                <div className="rounded-md border border-[#1e40af] bg-[#eff6ff] px-3 py-2.5 text-xs font-semibold text-[#334155]">
                                                    <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                                                        <span>
                                                            공급가{' '}
                                                            <b className="text-[#1e40af]">
                                                                {prodTotals.supply.toLocaleString('ko-KR')}원
                                                            </b>
                                                        </span>
                                                        <span>
                                                            부가세포함 {prodTotals.vat.toLocaleString('ko-KR')}원
                                                        </span>
                                                        <span>
                                                            외주비{' '}
                                                            <b className="text-[#dc2626]">
                                                                {prodTotals.outs.toLocaleString('ko-KR')}원
                                                            </b>
                                                        </span>
                                                        <span>
                                                            순매출{' '}
                                                            <b className="text-[#059669]">
                                                                {prodTotals.net.toLocaleString('ko-KR')}원
                                                            </b>
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="mt-1 text-[11px] text-[#94a3b8]">
                                                카테고리를 선택하면 세부 항목이 나옵니다.
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ) : null}
                            {/* 히스토리 추가 : (신규 등록만) */}
                            {!editId ? (
                                <div className="flex items-start gap-2">
                                    <span className="mt-2 w-24 shrink-0 text-sm font-semibold text-[#475569]">
                                        히스토리 추가 :
                                    </span>
                                    <textarea
                                        className="erp-input w-full min-w-0"
                                        onChange={(event) => updateField('historyText', event.target.value)}
                                        placeholder="첫 상담·문의 내용 등 (등록 시 히스토리에 기록)"
                                        rows={2}
                                        value={form.historyText}
                                    />
                                </div>
                            ) : null}
                        </div>

                        <div className="mt-5 flex items-center gap-2">
                            {editId ? (
                                <Button
                                    className="rounded-md border border-[#fca5a5] bg-white px-4 py-2 text-sm font-semibold text-[#dc2626]"
                                    onClick={() => {
                                        setModalOpen(false);
                                        setDelId(editId);
                                    }}
                                    type="button"
                                >
                                    삭제
                                </Button>
                            ) : null}
                            <div className="flex-1" />
                            <Button
                                className="rounded-md border border-[#cbd5e1] bg-white px-4 py-2 text-sm font-semibold"
                                onClick={() => {
                                    // 취소 = 명시적 폐기(초안 삭제). 실수/튕김으로 닫힌 경우엔 초안이 남아 복원됨.
                                    if (!editId) {
                                        try {
                                            localStorage.removeItem(draftKey);
                                        } catch {
                                            /* 무시 */
                                        }
                                    }
                                    setModalOpen(false);
                                }}
                                type="button"
                            >
                                취소
                            </Button>
                            <Button
                                className="rounded-md bg-[#1e40af] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                                disabled={saving}
                                onClick={() => void saveClient()}
                                type="button"
                            >
                                {saving ? '저장 중...' : '저장하기'}
                            </Button>
                        </div>
                    </div>
                </div>
            ) : null}

            {histClient ? (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
                    onClick={(event) => event.target === event.currentTarget && setHistClient(null)}
                >
                    <div className="max-h-[92vh] w-[min(480px,94vw)] overflow-y-auto rounded-[8px] bg-white p-6">
                        <h3 className="m-0 text-lg font-bold">
                            {histClient.company || histClient.manager} 히스토리
                        </h3>
                        <p className="mt-1 mb-4 text-sm text-[#64748b]">
                            담당: {histClient.manager || '--'}
                        </p>
                        <div className="mb-3 flex flex-col gap-2">
                            {(Array.isArray(histClient.history) ? histClient.history : []).length ? (
                                (histClient.history || []).map((h, index) => (
                                    <div
                                        className="flex items-start justify-between gap-2 rounded-[8px] border border-[#e2e8f0] bg-[#f1f5f9] px-3 py-2"
                                        key={index}
                                    >
                                        <span className="font-mono text-[10px] text-[#64748b]">
                                            {h.date}
                                        </span>
                                        <span className="flex-1 text-sm">{h.text}</span>
                                        <Button
                                            className="text-[10px] text-[#dc2626]"
                                            onClick={() => void removeHistory(index)}
                                            type="button"
                                        >
                                            ✕
                                        </Button>
                                    </div>
                                ))
                            ) : (
                                <div className="px-2 py-3 text-sm text-[#64748b]">
                                    히스토리가 없습니다
                                </div>
                            )}
                        </div>
                        <div className="flex gap-2">
                            <input
                                className="erp-input"
                                onChange={(event) => setHistInput(event.target.value)}
                                onKeyDown={(event) => {
                                    if (event.key === 'Enter') void addHistory();
                                }}
                                placeholder="내용 입력 후 Enter"
                                value={histInput}
                            />
                            <Button
                                className="rounded-md bg-[#1e40af] px-4 text-sm font-semibold text-white"
                                onClick={() => void addHistory()}
                                type="button"
                            >
                                추가
                            </Button>
                        </div>
                        <div className="mt-4 flex justify-end">
                            <Button
                                className="rounded-md border border-[#cbd5e1] bg-white px-4 py-2 text-sm font-semibold"
                                onClick={() => setHistClient(null)}
                                type="button"
                            >
                                닫기
                            </Button>
                        </div>
                    </div>
                </div>
            ) : null}

            {contractsOnly && showImminent ? (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
                    onClick={(event) => event.target === event.currentTarget && setShowImminent(false)}
                >
                    <div className="max-h-[80vh] w-[min(480px,94vw)] overflow-y-auto rounded-[8px] bg-white p-6">
                        <div className="flex items-center justify-between">
                            <h3 className="m-0 text-lg font-bold">재계약 임박</h3>
                            <button
                                className="text-sm text-[#94a3b8] hover:text-[#475569]"
                                onClick={() => setShowImminent(false)}
                                type="button"
                            >
                                ✕
                            </button>
                        </div>
                        <p className="mt-1 mb-3 text-sm text-[#64748b]">
                            잔여 5건 이하 · 카테고리·업체별 (누르면 상세로)
                        </p>
                        {imminentList.length ? (
                            <div className="grid gap-1">
                                {imminentList.map((it, i) => (
                                    <button
                                        className="flex items-center justify-between gap-2 rounded-md border border-[#e2e8f0] px-3 py-2.5 text-left hover:bg-[#f8fafc]"
                                        key={i}
                                        onClick={() => {
                                            setShowImminent(false);
                                            openDetail(it.clientId);
                                        }}
                                        type="button"
                                    >
                                        <span className="flex min-w-0 items-center gap-2">
                                            <span className="shrink-0 rounded-full bg-[#e0e7ff] px-2 py-0.5 text-[11px] font-semibold text-[#4338ca]">
                                                {it.product}
                                            </span>
                                            <span className="truncate text-sm font-semibold text-[#0f172a]">
                                                {it.company}
                                            </span>
                                        </span>
                                        <span
                                            className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ring-1 ${
                                                it.remain === 0
                                                    ? 'bg-[#fef2f2] text-[#b91c1c] ring-[#fecaca]'
                                                    : 'bg-[#fefce8] text-[#a16207] ring-[#fde68a]'
                                            }`}
                                        >
                                            잔여 {it.remain}건
                                        </span>
                                    </button>
                                ))}
                            </div>
                        ) : (
                            <div className="px-2 py-10 text-center text-sm text-[#94a3b8]">
                                재계약 임박 건이 없습니다.
                            </div>
                        )}
                        <div className="mt-4 flex justify-end">
                            <Button
                                className="rounded-md border border-[#cbd5e1] bg-white px-4 py-2 text-sm font-semibold"
                                onClick={() => setShowImminent(false)}
                                type="button"
                            >
                                닫기
                            </Button>
                        </div>
                    </div>
                </div>
            ) : null}

            {/* 잔여 외주비 상세 — 상세페이지 KPI(외주비 내역)와 동일 구성: 업체별 계약 외주비 분해 */}
            {outsourceClient ? (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
                    onClick={(event) => event.target === event.currentTarget && setOutsourceClient(null)}
                >
                    <div className="max-h-[80vh] w-[min(460px,94vw)] overflow-y-auto rounded-2xl bg-white p-6">
                        {(() => {
                            const cts = clientContracts.filter(
                                (ct) =>
                                    ct.client_id === outsourceClient &&
                                    ((ct.unit_outsource ?? 0) > 0 || (ct.outsource ?? 0) > 0),
                            );
                            const co = clients.find((c) => c.id === outsourceClient)?.company || '업체';
                            const detail = cts.map((ct) => {
                                const unit = ct.unit_outsource ?? 0;
                                const goal = ct.goal_count ?? 0;
                                const remainN = ct.remain_count ?? 0;
                                const total = ct.outsource ?? unit * goal;
                                const remain = unit * remainN;
                                return { ct, unit, goal, remainN, total, remain, used: Math.max(0, total - remain) };
                            });
                            const tTotal = detail.reduce((s, d) => s + d.total, 0);
                            const tRemain = detail.reduce((s, d) => s + d.remain, 0);
                            const tUsed = Math.max(0, tTotal - tRemain);
                            return (
                                <>
                                    <div className="flex items-center justify-between">
                                        <h3 className="m-0 text-lg font-bold">{co} · 외주비 내역</h3>
                                        <button
                                            className="text-sm text-[#94a3b8] hover:text-[#475569]"
                                            onClick={() => setOutsourceClient(null)}
                                            type="button"
                                        >
                                            ✕
                                        </button>
                                    </div>
                                    <div className="mt-2 grid grid-cols-3 gap-1 rounded-lg border border-[#fee2e2] bg-[#fff7f7] px-2 py-2 text-center">
                                        <div>
                                            <div className="text-[10px] text-[#94a3b8]">총 외주비</div>
                                            <div className="text-sm font-bold text-[#475569]">
                                                {tTotal.toLocaleString('ko-KR')}원
                                            </div>
                                        </div>
                                        <div>
                                            <div className="text-[10px] text-[#94a3b8]">소진</div>
                                            <div className="text-sm font-bold text-[#94a3b8]">
                                                {tUsed.toLocaleString('ko-KR')}원
                                            </div>
                                        </div>
                                        <div>
                                            <div className="text-[10px] text-[#dc2626]">남은 외주비</div>
                                            <div className="text-base font-extrabold text-[#dc2626]">
                                                {tRemain.toLocaleString('ko-KR')}원
                                            </div>
                                        </div>
                                    </div>
                                    <div className="mt-3 grid gap-1">
                                        {detail.map((d) => (
                                            <div
                                                className="rounded-md border border-[#eef2f7] bg-[#f8fafc] px-3 py-2"
                                                key={d.ct.id}
                                            >
                                                <div className="flex items-center gap-2 text-sm">
                                                    <span className="min-w-0">
                                                        <span className="block font-semibold text-[#0f172a]">
                                                            {d.ct.subtype}
                                                        </span>
                                                        <span className="block text-[11px] text-[#94a3b8]">
                                                            {d.ct.category}
                                                            {d.ct.outsource_company
                                                                ? ` · 외주업체 ${d.ct.outsource_company}`
                                                                : ''}
                                                        </span>
                                                    </span>
                                                    <span className="ml-auto shrink-0 text-right">
                                                        <span className="block font-bold text-[#dc2626]">
                                                            {d.remain.toLocaleString('ko-KR')}원
                                                        </span>
                                                        <span className="block text-[10px] text-[#94a3b8]">
                                                            외주단가 {d.unit.toLocaleString('ko-KR')} × 잔여{' '}
                                                            {d.remainN.toLocaleString('ko-KR')}
                                                        </span>
                                                    </span>
                                                </div>
                                            </div>
                                        ))}
                                        {!detail.length ? (
                                            <div className="px-2 py-8 text-center text-sm text-[#94a3b8]">
                                                외주비가 있는 계약이 없습니다.
                                            </div>
                                        ) : null}
                                    </div>
                                    <div className="mt-4 flex justify-end">
                                        <Button
                                            className="rounded-md border border-[#cbd5e1] bg-white px-4 py-2 text-sm font-semibold"
                                            onClick={() => setOutsourceClient(null)}
                                            type="button"
                                        >
                                            닫기
                                        </Button>
                                    </div>
                                </>
                            );
                        })()}
                    </div>
                </div>
            ) : null}

            {importOpen ? (
                <ContractImportModal
                    allClients={allClients}
                    onClose={() => setImportOpen(false)}
                    onDone={async () => {
                        await refresh();
                        await reloadContracts();
                    }}
                    onToast={showToast}
                />
            ) : null}

            {/* 업체명 중복 안내 — 이미 등록된 업체면 저장 차단 + 기존 상세로 이동 */}
            {dupMatches && dupMatches.length ? (
                <div
                    className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
                    onClick={(event) => event.target === event.currentTarget && setDupMatches(null)}
                >
                    <div className="max-h-[80vh] w-[min(440px,94vw)] overflow-y-auto rounded-2xl bg-white p-6">
                        <h3 className="m-0 text-lg font-bold">이미 등록된 업체입니다</h3>
                        <p className="mt-1 mb-3 text-sm text-[#64748b]">
                            같은 업체명이 있습니다. 기존 업체 상세로 이동하거나, 그래도 새로 등록할 수 있습니다.
                        </p>
                        <div className="grid gap-1">
                            {dupMatches.map((m) => {
                                const visible = clients.some((c) => c.id === m.id);
                                return (
                                    <button
                                        className="flex items-center justify-between gap-2 rounded-md border border-[#e2e8f0] px-3 py-2.5 text-left hover:bg-[#f8fafc] disabled:cursor-not-allowed disabled:opacity-60"
                                        disabled={!visible}
                                        key={m.id}
                                        onClick={() => {
                                            setDupMatches(null);
                                            setModalOpen(false);
                                            openDetail(m.id);
                                        }}
                                        type="button"
                                    >
                                        <span className="min-w-0">
                                            <span className="block truncate text-sm font-bold text-[#0f172a]">
                                                {m.company}
                                            </span>
                                            <span className="block text-[11px] text-[#94a3b8]">
                                                {m.business_number || '사업자번호 없음'} · 담당 {m.manager || '-'}
                                                {visible ? '' : ' · 다른 담당자'}
                                            </span>
                                        </span>
                                        <span className="shrink-0 text-xs font-semibold text-[#1e40af]">
                                            {visible ? '상세 →' : ''}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                        <div className="mt-4 flex justify-end gap-2">
                            <Button
                                className="rounded-md border border-[#cbd5e1] bg-white px-4 py-2 text-sm font-semibold"
                                onClick={() => setDupMatches(null)}
                                type="button"
                            >
                                취소
                            </Button>
                            <Button
                                className="rounded-md border border-[#e2e8f0] bg-[#f8fafc] px-4 py-2 text-sm font-semibold text-[#64748b]"
                                onClick={() => {
                                    setDupMatches(null);
                                    void saveClient(true);
                                }}
                                type="button"
                            >
                                그래도 등록
                            </Button>
                        </div>
                    </div>
                </div>
            ) : null}

            {endTarget ? (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
                    onClick={(e) => e.target === e.currentTarget && setEndTarget(null)}
                >
                    <div className="w-[min(420px,94vw)] rounded-[8px] bg-white p-6">
                        <h3 className="m-0 text-lg font-bold text-[#0f172a]">
                            {endTarget.company || '고객사'} · 계약 종료
                        </h3>
                        <p className="mt-1 text-sm text-[#64748b]">
                            종료 사유를 입력하세요. 이 기록은 <b>고객사 관리 · 계약 종료</b>에 남습니다.
                        </p>
                        <textarea
                            autoFocus
                            className="mt-3 h-24 w-full rounded-md border border-[#cbd5e1] p-2 text-sm"
                            onChange={(e) => setEndReason(e.target.value)}
                            placeholder="예: 고객 예산 축소로 진행 보류"
                            value={endReason}
                        />
                        <div className="mt-4 flex justify-end gap-2">
                            <Button
                                className="rounded-md border border-[#cbd5e1] bg-white px-4 py-2 text-sm font-semibold text-[#64748b] hover:bg-[#f1f5f9]"
                                onClick={() => setEndTarget(null)}
                                type="button"
                            >
                                취소
                            </Button>
                            <Button
                                className="rounded-md bg-[#dc2626] px-4 py-2 text-sm font-bold text-white hover:bg-[#b91c1c] disabled:opacity-50"
                                disabled={!endReason.trim()}
                                onClick={() => void confirmEndContract()}
                                type="button"
                            >
                                계약 종료
                            </Button>
                        </div>
                    </div>
                </div>
            ) : null}

            {stageClient ? (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
                    onClick={(event) => event.target === event.currentTarget && setStageClient(null)}
                >
                    <div className="w-[min(420px,94vw)] rounded-[8px] bg-white p-6">
                        <h3 className="m-0 text-lg font-bold">
                            {stageClient.company || '고객사'} · 계약 진행
                        </h3>
                        <p className="mt-1 mb-4 text-sm text-[#64748b]">
                            현재 상태: <b>{stageClient.status || STATUS_OPTIONS[0]}</b>
                        </p>
                        <div className="grid gap-2">
                            {STATUS_OPTIONS.map((s) => (
                                <button
                                    className={`flex items-center justify-between rounded-md border px-4 py-2.5 text-left text-sm font-semibold ${
                                        stageClient.status === s
                                            ? 'border-[#1e40af] bg-[#eff6ff] text-[#1e40af]'
                                            : 'border-[#e2e8f0] text-[#334155] hover:bg-[#f8fafc]'
                                    }`}
                                    key={s}
                                    onClick={() => void changeStatus(stageClient, s)}
                                    type="button"
                                >
                                    {s}
                                    {s === DONE_STATUS ? (
                                        <span className="text-[11px] font-normal text-[#94a3b8]">
                                            → 계약 관리로 이동
                                        </span>
                                    ) : null}
                                </button>
                            ))}
                            {/* 계약 종료로 이동 — 어느 탭에서든 계약 종료 탭으로 보냄(터미널 상태). */}
                            <button
                                className={`flex items-center justify-between rounded-md border px-4 py-2.5 text-left text-sm font-semibold ${
                                    stageClient.status === ENDED_STATUS
                                        ? 'border-[#1e40af] bg-[#eff6ff] text-[#1e40af]'
                                        : 'border-[#e2e8f0] text-[#334155] hover:bg-[#f8fafc]'
                                }`}
                                onClick={() => void changeStatus(stageClient, ENDED_STATUS, '계약 종료 처리')}
                                type="button"
                            >
                                계약 종료
                                <span className="text-[11px] font-normal text-[#94a3b8]">→ 계약 종료 탭</span>
                            </button>
                            {/* 삭제 — 이 고객사(상담 건 등)를 완전 삭제. 되돌릴 수 없음. */}
                            <button
                                className="mt-1 flex items-center justify-between rounded-md border border-[#fecaca] px-4 py-2.5 text-left text-sm font-semibold text-[#dc2626] hover:bg-[#fef2f2]"
                                onClick={() => {
                                    if (
                                        !window.confirm(
                                            `'${stageClient.company || '고객사'}'을(를) 삭제할까요? 되돌릴 수 없습니다.`,
                                        )
                                    )
                                        return;
                                    const id = stageClient.id;
                                    setStageClient(null);
                                    void deleteClient(id).then(() => {
                                        void refresh();
                                        showToast('삭제됨');
                                    });
                                }}
                                type="button"
                            >
                                삭제
                                <span className="text-[11px] font-normal text-[#94a3b8]">되돌릴 수 없음</span>
                            </button>
                        </div>
                        <div className="mt-4 flex justify-end">
                            <Button
                                className="rounded-md border border-[#cbd5e1] bg-white px-4 py-2 text-sm font-semibold"
                                onClick={() => setStageClient(null)}
                                type="button"
                            >
                                닫기
                            </Button>
                        </div>
                    </div>
                </div>
            ) : null}

            {delId ? (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
                    <div className="w-[min(360px,94vw)] rounded-[8px] bg-white p-6">
                        <h3 className="m-0 text-lg font-bold">정말 삭제하시겠어요?</h3>
                        <p className="mt-2 mb-5 text-sm text-[#64748b]">되돌릴 수 없습니다.</p>
                        <div className="flex justify-end gap-2">
                            <Button
                                className="rounded-md border border-[#cbd5e1] bg-white px-4 py-2 text-sm font-semibold"
                                onClick={() => setDelId(null)}
                                type="button"
                            >
                                취소
                            </Button>
                            <Button
                                className="rounded-md bg-[#dc2626] px-4 py-2 text-sm font-semibold text-white"
                                onClick={() => void confirmDelete()}
                                type="button"
                            >
                                삭제
                            </Button>
                        </div>
                    </div>
                </div>
            ) : null}

            {toast ? (
                <div className="fixed bottom-6 left-1/2 z-[2000] -translate-x-1/2 rounded-md bg-[#0f172a] px-5 py-2 text-sm text-white">
                    {toast}
                </div>
            ) : null}
        </section>
    );
}

export default ClientsPage;
