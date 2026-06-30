import { useEffect, useMemo, useState } from 'react';
import {
    deleteClient,
    insertClient,
    updateClient,
    type ClientHistory,
    type ErpClient,
} from '../api/erp';
import { getBlogAccounts, type BlogAccount } from '../api/blogRank';
import { ClientDetail } from './ClientDetail';
import Button from '../components/Button';
import { useErpData } from '../context/ErpDataContext';
import {
    SOURCE_BADGE,
    SOURCE_OPTIONS,
    STATUS_BADGE,
    STATUS_OPTIONS,
    parsePaste,
    todayStr,
} from '../lib/erpUtils';

const FAVS_KEY = 'erp_favs';
const DONE_STATUS = '계약완료'; // 계약 완료 판정 기준(상태). 계약 관리 진입 + 완료/미완료 탭이 공유.
const ENDED_STATUS = '계약종료'; // 계약 종료(터미널). 종료 탭. 5단계(신규~보류)와 별개.

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
};

const emptyForm: ClientForm = {
    amount: '',
    budget: '',
    company: '',
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
    const { clients, salespeople, loading, error, refresh } = useErpData();

    // 카테고리 = 그 고객사에 연결된 카테고리 계정에서 도출(현재 블로그). client_id 로 묶음.
    const [blogAccounts, setBlogAccounts] = useState<BlogAccount[]>([]);
    const reloadBlogs = () => getBlogAccounts().then(({ data }) => setBlogAccounts(data));
    useEffect(() => {
        void reloadBlogs();
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
    const [sourceFilter, setSourceFilter] = useState('');
    const [statusFilter, setStatusFilter] = useState('');
    const [favOnly, setFavOnly] = useState(false);
    const [favs, setFavs] = useState<string[]>(loadFavs);
    // 고객사 관리 하단 탭 — 계약 완료(블로그 등 계정 연결) vs 미완료(보류·문의만). contractsOnly 화면에선 미사용.
    const [clientTab, setClientTab] = useState<'done' | 'pending' | 'ended'>('pending');
    // 계약 진행 단계 변경 대상(5단계 선택 모달).
    const [stageClient, setStageClient] = useState<ErpClient | null>(null);
    // 재계약 임박 KPI 상세 펼침(기본 접힘 — 건수만).
    const [showImminent, setShowImminent] = useState(false);
    const [toast, setToast] = useState('');

    const [modalOpen, setModalOpen] = useState(false);
    const [editId, setEditId] = useState<string | null>(null);
    const [form, setForm] = useState<ClientForm>(emptyForm);
    const [pasteText, setPasteText] = useState('');
    const [saving, setSaving] = useState(false);

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
            const matchesSource = !sourceFilter || client.source === sourceFilter;
            const matchesStatus = !statusFilter || client.status === statusFilter;
            const matchesFav = !favOnly || favs.includes(client.id);
            // 계약 관리(contractsOnly)는 '계약완료' 상태만 진입.
            const matchesContract = !contractsOnly || client.status === DONE_STATUS;
            // 고객사 관리 전체 화면에서만 완료/미완료/종료 탭 적용(상태 기준).
            const matchesTab =
                contractsOnly ||
                (clientTab === 'done'
                    ? client.status === DONE_STATUS
                    : clientTab === 'ended'
                      ? client.status === ENDED_STATUS
                      : client.status !== DONE_STATUS && client.status !== ENDED_STATUS);

            return matchesQuery && matchesSource && matchesStatus && matchesFav && matchesContract && matchesTab;
        });

        return list.sort((a, b) => {
            const af = favs.includes(a.id) ? 0 : 1;
            const bf = favs.includes(b.id) ? 0 : 1;
            return af - bf;
        });
    }, [clients, search, sourceFilter, statusFilter, favOnly, favs, contractsOnly, clientTab]);

    // 계약 관리 KPI — 계약 중(계약완료 고객 수) + 재계약 임박(카테고리 계약 중 잔여 3건 미만).
    const doneClientIds = useMemo(
        () => new Set(clients.filter((c) => c.status === DONE_STATUS).map((c) => c.id)),
        [clients],
    );
    // 현재 카테고리 계정은 블로그뿐 → 향후 영상/인스타/카페/트래픽 계정 테이블 추가 시 여기에 합산.
    const imminentList = useMemo(
        () =>
            blogAccounts
                .filter(
                    (a) =>
                        a.client_id &&
                        doneClientIds.has(a.client_id) &&
                        !a.contract_ended_at &&
                        a.remain_count != null &&
                        a.remain_count < 3,
                )
                .map((a) => ({ category: '블로그', company: a.name, remain: a.remain_count as number }))
                .sort((x, y) => x.remain - y.remain),
        [blogAccounts, doneClientIds],
    );

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


    const saveClient = async () => {
        if (!form.manager.trim()) {
            showToast('담당자를 입력해주세요');
            return;
        }
        setSaving(true);

        const payload: Partial<ErpClient> = {
            amount: Number(form.amount) || 0,
            budget: form.budget.trim() || null,
            company: form.company.trim() || null,
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

        const { error: saveError } = editId
            ? await updateClient(editId, payload)
            : await insertClient(payload);

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
                blogs={blogAccounts.filter((a) => a.client_id === detailClient.id)}
                client={detailClient}
                onClose={closeDetail}
                onDelete={() =>
                    void deleteClient(detailClient.id).then(() => {
                        closeDetail();
                        void refresh();
                    })
                }
                onReload={reloadBlogs}
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
                <Button
                    className="inline-flex h-10 items-center justify-center rounded-md bg-[#1e40af] px-4 text-sm font-semibold text-white"
                    onClick={openAdd}
                    type="button"
                >
                    {contractsOnly ? '+ 계약 추가' : '+ 문의 추가'}
                </Button>
            </div>

            {/* 계약 관리 상단 KPI — 계약 중 / 재계약 임박(누르면 상세) */}
            {contractsOnly ? (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="flex items-center justify-between rounded-xl border border-[#e2e8f0] bg-white px-4 py-2.5 shadow-sm">
                        <span className="text-xs font-semibold text-[#94a3b8]">계약 중</span>
                        <span className="text-2xl font-bold text-[#1e40af]">{doneClientIds.size}건</span>
                    </div>
                    <div className="rounded-xl border border-[#e2e8f0] bg-white px-4 py-2.5 shadow-sm">
                        <button
                            className="flex w-full items-center justify-between"
                            onClick={() => setShowImminent((o) => !o)}
                            type="button"
                        >
                            <span className="flex items-center gap-1.5">
                                <span className="text-xs font-semibold text-[#94a3b8]">재계약 임박</span>
                                <span className="text-[10px] text-[#94a3b8]">
                                    잔여 3건 미만 · {showImminent ? '접기 ▲' : '상세 ▼'}
                                </span>
                            </span>
                            <span
                                className={`text-2xl font-bold ${
                                    imminentList.length ? 'text-[#dc2626]' : 'text-[#94a3b8]'
                                }`}
                            >
                                {imminentList.length}건
                            </span>
                        </button>
                        {showImminent ? (
                            imminentList.length ? (
                                <div className="mt-2 flex flex-wrap gap-1.5 border-t border-[#f1f5f9] pt-2">
                                    {imminentList.map((it, i) => (
                                        <span
                                            className="rounded-full bg-[#fef2f2] px-2 py-0.5 text-[11px] font-semibold text-[#b91c1c]"
                                            key={i}
                                        >
                                            {it.category} · {it.company} (잔여 {it.remain}건)
                                        </span>
                                    ))}
                                </div>
                            ) : (
                                <div className="mt-2 border-t border-[#f1f5f9] pt-2 text-[11px] text-[#94a3b8]">
                                    해당 없음
                                </div>
                            )
                        ) : null}
                    </div>
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
                    onChange={(event) => setSourceFilter(event.target.value)}
                    value={sourceFilter}
                >
                    <option value="">전체 경로</option>
                    {SOURCE_OPTIONS.map((s) => (
                        <option key={s}>{s}</option>
                    ))}
                </select>
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

            <div className="overflow-x-auto rounded-[8px] border border-[#e2e8f0] bg-white">
                <table className="w-full border-collapse text-left text-sm">
                    <thead>
                        <tr className="border-b-2 border-[#e2e8f0] bg-[#f1f5f9] text-[11px] text-[#64748b]">
                            <th className="px-3 py-2 font-semibold">⭐</th>
                            <th className="px-3 py-2 font-semibold">담당자</th>
                            <th className="px-3 py-2 font-semibold">경로</th>
                            <th className="px-3 py-2 font-semibold">업체명</th>
                            <th className="px-3 py-2 font-semibold">연락처</th>
                            <th className="px-3 py-2 font-semibold">카테고리</th>
                            <th className="px-3 py-2 font-semibold">상태</th>
                            <th className="px-3 py-2 font-semibold">최근 히스토리</th>
                            <th className="px-3 py-2 font-semibold">다음연락</th>
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
                                const dt = c.created_at
                                    ? new Date(c.created_at).toLocaleDateString('ko-KR', {
                                          day: '2-digit',
                                          month: '2-digit',
                                      })
                                    : '--';
                                const overdueContact =
                                    c.next_contact &&
                                    c.next_contact <= new Date().toISOString().slice(0, 10);
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
                                            {c.source ? (
                                                <span
                                                    className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                                                        SOURCE_BADGE[c.source] || 'bg-[#e2e8f0] text-[#64748b]'
                                                    }`}
                                                >
                                                    {c.source}
                                                </span>
                                            ) : (
                                                <span className="text-xs text-[#94a3b8]">-</span>
                                            )}
                                        </td>
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
                                            {blogAccounts.some((a) => a.client_id === c.id) ? (
                                                <span className="rounded-full bg-[#dcfce7] px-2 py-0.5 text-[11px] font-semibold text-[#16a34a]">
                                                    블로그
                                                </span>
                                            ) : (
                                                <span className="text-xs text-[#94a3b8]">--</span>
                                            )}
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
                                        <td className="max-w-[180px] truncate px-3 py-2 text-xs text-[#64748b]">
                                            {lastHist}
                                        </td>
                                        <td
                                            className={`px-3 py-2 text-xs ${
                                                overdueContact ? 'text-[#dc2626]' : 'text-[#64748b]'
                                            }`}
                                        >
                                            {c.next_contact || '--'}
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
                                    colSpan={11}
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
                            {/* 업체명·연락처·이메일·url */}
                            {(
                                [
                                    { key: 'company', label: '업체명', ph: '업체명 입력' },
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
