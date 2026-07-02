import { useEffect, useMemo, useState } from 'react';
import {
    deleteClient,
    insertClient,
    updateClient,
    type ClientHistory,
    type ErpClient,
} from '../api/erp';
import { ensureClientBlogAccount, getBlogAccounts, type BlogAccount } from '../api/blogRank';
import {
    getClientContracts,
    insertClientContracts,
    type ClientContract,
} from '../api/clientContracts';
import { PRODUCT_CATEGORIES, isDailySub, isBrandBlogSub } from '../lib/products';
import { ClientDetail } from './ClientDetail';
import Button from '../components/Button';
import { ContractImportModal } from './ContractImportModal';
import { useErpData } from '../context/ErpDataContext';
import {
    INDUSTRY_OPTIONS,
    SOURCE_OPTIONS,
    STATUS_BADGE,
    STATUS_OPTIONS,
    parsePaste,
    todayStr,
} from '../lib/erpUtils';

const FAVS_KEY = 'erp_favs';
const DONE_STATUS = '계약완료'; // 계약 완료 판정 기준(상태). 계약 관리 진입 + 완료/미완료 탭이 공유.
const ENDED_STATUS = '계약종료'; // 계약 종료(터미널). 종료 탭. 5단계(신규~보류)와 별개.
const TEMP_STATUS = '임시'; // 시트 임포터 테스트 등록 — 계약 관리에서 '임시(테스트)' 탭으로 분리 표시.
// 숫자 입력 포맷 — 저장은 숫자만, 표시는 천단위 콤마(2000 → 2,000).
const onlyDigits = (s: string) => s.replace(/[^\d]/g, '');
const withCommas = (s: string) => (onlyDigits(s) ? Number(onlyDigits(s)).toLocaleString('ko-KR') : '');
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
    const openDetail = (id: string) => {
        setDetailId(id);
        const u = new URL(window.location.href);
        u.searchParams.set('id', id);
        window.history.pushState(null, '', u.pathname + u.search);
    };
    const closeDetail = () => {
        setDetailId(null);
        const u = new URL(window.location.href);
        u.searchParams.delete('id');
        window.history.pushState(null, '', u.pathname + u.search);
    };

    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState('');
    const [favOnly, setFavOnly] = useState(false);
    const [favs, setFavs] = useState<string[]>(loadFavs);
    // 고객사 관리 하단 탭 — 계약 완료(블로그 등 계정 연결) vs 미완료(보류·문의만). contractsOnly 화면에선 미사용.
    const [clientTab, setClientTab] = useState<'done' | 'pending' | 'ended'>('pending');
    const [tempView, setTempView] = useState(false); // 계약 관리: false=계약완료, true=임시(테스트)
    // 계약 진행 단계 변경 대상(5단계 선택 모달).
    const [stageClient, setStageClient] = useState<ErpClient | null>(null);
    // 재계약 임박 KPI 상세 펼침(기본 접힘 — 건수만).
    const [showImminent, setShowImminent] = useState(false);
    const [outsourceClient, setOutsourceClient] = useState<string | null>(null); // 잔여 외주비 상세 대상 client_id
    const [dupMatches, setDupMatches] = useState<ErpClient[] | null>(null); // 업체명 중복 안내 대상
    const [importOpen, setImportOpen] = useState(false); // 시트 붙여넣기 일괄 등록
    const [toast, setToast] = useState('');

    const [modalOpen, setModalOpen] = useState(false);
    const [editId, setEditId] = useState<string | null>(null);
    const [form, setForm] = useState<ClientForm>(emptyForm);
    const [pasteText, setPasteText] = useState('');
    const [saving, setSaving] = useState(false);
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
            // 계약 관리(contractsOnly)는 '계약완료'(또는 임시 탭이면 '임시') 상태만 진입.
            const matchesContract =
                !contractsOnly || client.status === (tempView ? TEMP_STATUS : DONE_STATUS);
            // 고객사 관리 전체 화면에서만 완료/미완료/종료 탭 적용(상태 기준).
            const matchesTab =
                contractsOnly ||
                (clientTab === 'done'
                    ? client.status === DONE_STATUS
                    : clientTab === 'ended'
                      ? client.status === ENDED_STATUS
                      : client.status !== DONE_STATUS && client.status !== ENDED_STATUS);

            return matchesQuery && matchesStatus && matchesFav && matchesContract && matchesTab;
        });

        return list.sort((a, b) => {
            // 임시(테스트) 탭은 등록한 순서(먼저 등록 → 위)로.
            if (contractsOnly && tempView) {
                return (a.created_at || '').localeCompare(b.created_at || '');
            }
            const af = favs.includes(a.id) ? 0 : 1;
            const bf = favs.includes(b.id) ? 0 : 1;
            return af - bf;
        });
    }, [clients, search, statusFilter, favOnly, favs, contractsOnly, clientTab, tempView]);

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


    const openAdd = () => {
        setEditId(null);
        // 계약 관리에서 추가 = 바로 계약완료 기본값. 고객사 관리(문의) = 신규문의.
        setForm({ ...emptyForm, status: contractsOnly ? DONE_STATUS : STATUS_OPTIONS[0] });
        setPasteText('');
        setProdCats([]);
        setProdInputs({});
        setModalOpen(true);
    };

    // 상태 변경(계약 진행 단계 선택 / 계약 종료 처리 공용).
    const changeStatus = async (client: ErpClient, status: string, toastMsg?: string) => {
        const { error: statusError } = await updateClient(client.id, { status });
        if (statusError) {
            showToast(`오류: ${statusError.message}`);
            return;
        }
        setStageClient(null);
        showToast(toastMsg || `상태 변경: ${status}`);
        await refresh();
    };


    const saveClient = async (force = false) => {
        if (!form.manager.trim()) {
            showToast('담당자를 입력해주세요');
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

        setModalOpen(false);
        await refresh();
        showToast('저장되었습니다');
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

    const managerIsListed = salespeople.some((s) => s.name === form.manager);

    // 업체명 클릭 시 상세 페이지
    const detailClient = detailId ? clients.find((c) => c.id === detailId) : null;
    if (detailClient) {
        return (
            <ClientDetail
                client={detailClient}
                contracts={clientContracts.filter((c) => c.client_id === detailClient.id)}
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
                    {contractsOnly ? (
                        <Button
                            className="inline-flex h-10 items-center justify-center rounded-md border border-[#1e40af] px-4 text-sm font-semibold text-[#1e40af]"
                            onClick={() => setImportOpen(true)}
                            type="button"
                        >
                            시트 붙여넣기
                        </Button>
                    ) : null}
                    <Button
                        className="inline-flex h-10 items-center justify-center rounded-md bg-[#1e40af] px-4 text-sm font-semibold text-white"
                        onClick={openAdd}
                        type="button"
                    >
                        {contractsOnly ? '+ 계약 추가' : '+ 문의 추가'}
                    </Button>
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

            {!contractsOnly ? (
                <div className="flex gap-1 border-b border-[#e2e8f0]">
                    {(
                        [
                            { key: 'pending', label: '계약 미완료' },
                            { key: 'done', label: '계약 완료' },
                            { key: 'ended', label: '계약 종료' },
                        ] as { key: 'done' | 'pending' | 'ended'; label: string }[]
                    ).map((t) => {
                        const count =
                            t.key === 'done'
                                ? clients.filter((c) => c.status === DONE_STATUS).length
                                : t.key === 'ended'
                                  ? clients.filter((c) => c.status === ENDED_STATUS).length
                                  : clients.filter(
                                        (c) => c.status !== DONE_STATUS && c.status !== ENDED_STATUS,
                                    ).length;
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
                            { key: false, label: '계약', status: DONE_STATUS },
                            { key: true, label: '임시(테스트)', status: TEMP_STATUS },
                        ] as { key: boolean; label: string; status: string }[]
                    ).map((t) => {
                        const count = clients.filter((c) => c.status === t.status).length;
                        return (
                            <button
                                className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold ${
                                    tempView === t.key
                                        ? 'border-[#1e40af] text-[#1e40af]'
                                        : 'border-transparent text-[#94a3b8] hover:text-[#475569]'
                                }`}
                                key={String(t.key)}
                                onClick={() => setTempView(t.key)}
                                type="button"
                            >
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
                            <th className="px-3 py-2 font-semibold">연락처</th>
                            <th className="px-3 py-2 font-semibold">상품</th>
                            <th className="px-3 py-2 font-semibold">상태</th>
                            <th className="px-3 py-2 font-semibold">잔여 외주비</th>
                            <th className="px-3 py-2 font-semibold">최근 히스토리</th>
                            <th className="px-3 py-2 font-semibold">등록일</th>
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
                                const cds = clientContracts
                                    .filter((ct) => ct.client_id === c.id && ct.contract_date)
                                    .map((ct) => ct.contract_date as string)
                                    .sort();
                                const dt = cds.length
                                    ? cds[0]
                                    : c.created_at
                                      ? new Date(c.created_at).toLocaleDateString('ko-KR', {
                                            day: '2-digit',
                                            month: '2-digit',
                                        })
                                      : '--';
                                return (
                                    <tr
                                        key={c.id}
                                        className="cursor-pointer border-b border-[#e2e8f0] hover:bg-[#f8fafc]"
                                        onClick={(e) => {
                                            if ((e.target as HTMLElement).closest('button, a, input, select')) return;
                                            openDetail(c.id);
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
                                            <button
                                                className="font-medium text-[#1e40af] hover:underline"
                                                onClick={() => openDetail(c.id)}
                                                title="클릭해서 상세 보기"
                                                type="button"
                                            >
                                                {c.company || '--'}
                                            </button>
                                        </td>
                                        <td className="px-3 py-2 text-xs text-[#64748b]">
                                            {c.contact || '--'}
                                        </td>
                                        <td className="px-3 py-2">
                                            {(() => {
                                                // 카테고리별 계약 건수 집계 → '플레이스 3' 처럼 표시.
                                                const counts = new Map<string, number>();
                                                for (const ct of clientContracts) {
                                                    if (ct.client_id !== c.id) continue;
                                                    counts.set(ct.category, (counts.get(ct.category) || 0) + 1);
                                                }
                                                if (counts.size) {
                                                    return (
                                                        <span className="flex flex-wrap gap-1">
                                                            {[...counts.entries()].map(([cat, n]) => (
                                                                <span
                                                                    className="rounded-full bg-[#e0e7ff] px-2 py-0.5 text-[11px] font-semibold text-[#4338ca]"
                                                                    key={cat}
                                                                >
                                                                    {cat} <b className="text-[#1e40af]">{n}</b>
                                                                </span>
                                                            ))}
                                                        </span>
                                                    );
                                                }
                                                if (blogAccounts.some((a) => a.client_id === c.id)) {
                                                    return (
                                                        <span className="rounded-full bg-[#e0e7ff] px-2 py-0.5 text-[11px] font-semibold text-[#4338ca]">
                                                            블로그
                                                        </span>
                                                    );
                                                }
                                                return <span className="text-xs text-[#94a3b8]">--</span>;
                                            })()}
                                        </td>
                                        <td className="px-3 py-2">
                                            <span
                                                className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                                                    STATUS_BADGE[c.status || ''] ||
                                                    'bg-[#e2e8f0] text-[#64748b]'
                                                }`}
                                            >
                                                {c.status || '--'}
                                            </span>
                                        </td>
                                        <td className="px-3 py-2 text-xs">
                                            {(() => {
                                                const remainOut = clientContracts
                                                    .filter((ct) => ct.client_id === c.id)
                                                    .reduce(
                                                        (s, ct) =>
                                                            s +
                                                            (ct.unit_outsource ?? 0) *
                                                                (ct.remain_count ?? 0),
                                                        0,
                                                    );
                                                return remainOut > 0 ? (
                                                    <button
                                                        className="font-bold text-[#dc2626] hover:underline"
                                                        onClick={() => setOutsourceClient(c.id)}
                                                        title="외주비 상세 보기"
                                                        type="button"
                                                    >
                                                        {remainOut.toLocaleString('ko-KR')}원
                                                    </button>
                                                ) : (
                                                    <span className="text-[#94a3b8]">--</span>
                                                );
                                            })()}
                                        </td>
                                        <td className="max-w-[180px] truncate px-3 py-2 text-xs text-[#64748b]">
                                            {lastHist}
                                        </td>
                                        <td className="px-3 py-2 text-xs text-[#64748b]">{dt}</td>
                                        <td className="px-3 py-2">
                                            <div className="flex gap-1 whitespace-nowrap">
                                                {!contractsOnly && clientTab === 'pending' ? (
                                                    <Button
                                                        className="rounded border border-[#1e40af] px-2 py-1 text-[11px] font-semibold text-[#1e40af] hover:bg-[#eff6ff]"
                                                        onClick={() => setStageClient(c)}
                                                        type="button"
                                                    >
                                                        계약 진행
                                                    </Button>
                                                ) : null}
                                                {!contractsOnly && clientTab === 'done' ? (
                                                    <Button
                                                        className="rounded border border-[#cbd5e1] px-2 py-1 text-[11px] font-semibold text-[#64748b] hover:bg-[#f1f5f9]"
                                                        onClick={() =>
                                                            void changeStatus(c, ENDED_STATUS, '계약 종료 처리')
                                                        }
                                                        type="button"
                                                    >
                                                        계약 종료
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
                                );
                            })
                        ) : (
                            <tr>
                                <td
                                    className="px-3 py-12 text-center text-sm text-[#64748b]"
                                    colSpan={10}
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
                    onClick={(event) => event.target === event.currentTarget && setModalOpen(false)}
                >
                    <div className="max-h-[92vh] w-[min(620px,94vw)] overflow-y-auto rounded-[8px] bg-white p-6">
                        <h3 className="m-0 mb-4 text-lg font-bold">
                            {editId
                                ? '고객사 수정'
                                : contractsOnly
                                  ? '+ 계약 추가 (가이드 입력)'
                                  : '+ 문의 추가 (가이드 입력)'}
                        </h3>

                        {/* 가이드 입력 — 고정 라벨 옆 칸에 값 입력(블로그 대시보드와 동일 방식) */}
                        <div className="grid gap-2">
                            {/* 담당자 : */}
                            <div className="flex items-start gap-2">
                                <span className="mt-2 w-24 shrink-0 text-sm font-semibold text-[#475569]">
                                    담당자 :
                                </span>
                                <div className="w-full min-w-0">
                                    <select
                                        className="erp-input"
                                        onChange={(event) => updateField('manager', event.target.value)}
                                        value={managerIsListed ? form.manager : form.manager ? '__direct__' : ''}
                                    >
                                        <option value="">선택...</option>
                                        {salespeople.map((s) => (
                                            <option key={s.id} value={s.name}>
                                                {s.name}
                                            </option>
                                        ))}
                                        <option value="__direct__">직접 입력...</option>
                                    </select>
                                    {!managerIsListed ? (
                                        <input
                                            className="erp-input mt-1"
                                            onChange={(event) => updateField('manager', event.target.value)}
                                            placeholder="담당자 이름"
                                            value={form.manager}
                                        />
                                    ) : null}
                                </div>
                            </div>
                            {/* 문의 경로 : */}
                            <div className="flex items-center gap-2">
                                <span className="w-24 shrink-0 text-sm font-semibold text-[#475569]">
                                    문의 경로 :
                                </span>
                                <select
                                    className="erp-input w-full min-w-0"
                                    onChange={(event) => updateField('source', event.target.value)}
                                    value={form.source}
                                >
                                    <option value="">선택 안 함</option>
                                    {SOURCE_OPTIONS.map((s) => (
                                        <option key={s}>{s}</option>
                                    ))}
                                </select>
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
                            {/* 업종/업태 (선택) */}
                            <div className="flex items-center gap-2">
                                <span className="w-24 shrink-0 text-sm font-semibold text-[#475569]">
                                    업종/업태 :
                                </span>
                                <select
                                    className="erp-input w-full min-w-0"
                                    onChange={(event) => updateField('industry', event.target.value)}
                                    value={form.industry}
                                >
                                    <option value="">선택...</option>
                                    {INDUSTRY_OPTIONS.map((o) => (
                                        <option key={o}>{o}</option>
                                    ))}
                                </select>
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
                                        onChange={(event) => updateField(f.key, event.target.value)}
                                        placeholder={f.ph}
                                        value={form[f.key]}
                                    />
                                </div>
                            ))}
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
                                onClick={() => setModalOpen(false)}
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
                                (ct) => ct.client_id === outsourceClient && (ct.unit_outsource ?? 0) > 0,
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
                                            → 계약 완료 탭으로
                                        </span>
                                    ) : null}
                                </button>
                            ))}
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
