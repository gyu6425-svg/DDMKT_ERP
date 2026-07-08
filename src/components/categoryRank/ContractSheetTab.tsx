import { Fragment, useEffect, useMemo, useState } from 'react';
import { getClients, type ErpClient } from '../../api/erp';
import { getClientContracts, updateClientContract, type ClientContract } from '../../api/clientContracts';
import { useAuth } from '../../hooks/useAuth';
import { SIDEBAR_CATEGORIES } from './categories';
import { CONTAINER_SUBS } from '../../lib/products';

// 컨테이너 2차 하위 subtype('상위노출 보장형 · 영수증 리뷰' 등)에서 접두를 벗겨 실제 세부유형만 남김.
//   서브시트 필터는 정확 일치라, 접두를 벗겨야 하위 계약이 해당 세부유형 시트에 노출됨. 일반 subtype은 그대로.
const stripContainer = (s: string) => {
    const p = CONTAINER_SUBS.find((c) => s.startsWith(c + ' · '));
    return p ? s.slice(p.length + 3) : s; // ' · ' = 3자
};

// 하위 카테고리 관리 시트(1차) — 해당 category(+subtype) 계약을 업체별로 나열.
//   브랜드블로그 관리시트(SheetTab)와 동일한 UI/컬럼 구성으로 통일. 계약 관리(client_contracts)가 단일 출처 →
//   여기선 표시만, 행/관리 클릭 시 고객사 상세로 이동해 수정. 블로그 전용 컬럼(주 발행·추적 글·통합 10위)은
//   비-블로그 계약엔 값이 없어 '—'로 표시(레이아웃만 통일).
function navTo(path: string) {
    if (window.location.pathname + window.location.search !== path) {
        window.history.pushState(null, '', path);
        window.dispatchEvent(new Event('app:navigate'));
    }
}

// 시트 행 클릭 → 같은 카테고리의 '순위 트래커' 탭으로 이동(업체명 q로 전달). ?sub 등 기존 파라미터 유지.
function goTracker(company: string) {
    const u = new URL(window.location.href);
    u.searchParams.set('tab', 'tracker');
    if (company) u.searchParams.set('q', company);
    navTo(u.pathname + u.search);
}

// 블로그 하위(고유 pathname)·쇼핑·파워링크는 ?sub이 없으므로 경로 → (category, subtype) 매핑.
const PATH_SCOPE: Record<string, { category: string; subtype: string }> = {
    '/blog-optimized': { category: '블로그', subtype: '최적화 블로그 배포' },
    '/blog-semi': { category: '블로그', subtype: '준최적화 블로그 배포' },
    '/blog-jeoinmang': { category: '블로그', subtype: '저인망 블로그 배포' },
    '/shopping-rank': { category: '쇼핑', subtype: '쇼핑' },
    '/powerlink-rank': { category: '파워링크', subtype: '파워링크' },
};

// 현재 URL → 표시할 계약 범위. subtype 없으면 카테고리 전체(상위 대시보드).
export function resolveScope(href: string): { category: string; subtype?: string } | null {
    const [path, query = ''] = href.split('?');
    const sub = new URLSearchParams(query).get('sub');
    const catByPath = SIDEBAR_CATEGORIES.find((c) => c.dashHref.split('?')[0] === path)?.label;
    if (sub && catByPath) return { category: catByPath, subtype: decodeURIComponent(sub) };
    if (PATH_SCOPE[path]) return PATH_SCOPE[path];
    if (catByPath) return { category: catByPath };
    return null;
}

// URL을 반응형 추적하며 해당 범위의 계약 시트를 렌더(전용 카테고리 페이지에서 공용으로 사용).
export function ContractSheetAuto() {
    const [href, setHref] = useState(() => window.location.pathname + window.location.search);
    useEffect(() => {
        const sync = () => setHref(window.location.pathname + window.location.search);
        window.addEventListener('popstate', sync);
        window.addEventListener('app:navigate', sync);
        return () => {
            window.removeEventListener('popstate', sync);
            window.removeEventListener('app:navigate', sync);
        };
    }, []);
    const scope = resolveScope(href);
    if (!scope) {
        return <div className="py-16 text-center text-sm text-[#94a3b8]">표시할 계약 범위를 찾지 못했습니다.</div>;
    }
    return <ContractSheetTab category={scope.category} subtype={scope.subtype} />;
}

const won = (n: number | null | undefined) => (n ? Number(n).toLocaleString('ko-KR') : '0');
const progColor = (p: number | null) =>
    p == null ? '#94a3b8' : p >= 70 ? '#059669' : p >= 40 ? '#d97706' : '#dc2626';

// 세부유형(상품)별 칩 색 — 상품명 해시로 고정 색 배정(같은 상품은 항상 같은 색).
const CHIP_PALETTE = [
    { bg: '#dbeafe', text: '#1e40af' }, // 파랑
    { bg: '#dcfce7', text: '#15803d' }, // 초록
    { bg: '#fef3c7', text: '#b45309' }, // 앰버
    { bg: '#fce7f3', text: '#be185d' }, // 분홍
    { bg: '#ede9fe', text: '#6d28d9' }, // 보라
    { bg: '#cffafe', text: '#0e7490' }, // 시안
    { bg: '#ffe4e6', text: '#be123c' }, // 로즈
    { bg: '#ecfccb', text: '#4d7c0f' }, // 라임
];
const chipColor = (s: string) => {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return CHIP_PALETTE[h % CHIP_PALETTE.length];
};

// 상태 뱃지 — 브랜드블로그 시트의 Tag와 동일 톤(진행 중=초록/재계약 임박=빨강·노랑/미입력=회색).
function StatusTag({ ct }: { ct: ClientContract }) {
    const base = 'inline-block rounded-full px-2 py-0.5 text-[11px] font-bold';
    if (ct.goal_count == null) {
        return <span className={`${base} bg-[#e2e8f0] text-[#64748b]`}>계약 건수 미입력</span>;
    }
    const remain = ct.remain_count ?? ct.goal_count;
    if (remain <= 1) return <span className={`${base} bg-[#fee2e2] text-[#dc2626]`}>재계약 임박</span>;
    if (remain <= 5) return <span className={`${base} bg-[#fef3c7] text-[#b45309]`}>재계약 임박</span>;
    return <span className={`${base} bg-[#dcfce7] text-[#16a34a]`}>진행 중</span>;
}

export function ContractSheetTab({ category, subtype }: { category: string; subtype?: string }) {
    const { canManageSheet } = useAuth(); // 담당 카테고리 시트 권한자만 승인 가능
    const [clients, setClients] = useState<ErpClient[]>([]);
    const [contracts, setContracts] = useState<ClientContract[]>([]);
    const [loading, setLoading] = useState(true);
    // 계약 카드 '관리 시트 →'가 붙인 q=업체명을 초기값으로 → 도착 즉시 해당 업체 자동 필터.
    const [q, setQ] = useState(() => new URLSearchParams(window.location.search).get('q') ?? '');
    const [mgr, setMgr] = useState('');
    const [dateSort, setDateSort] = useState<'asc' | 'desc' | null>('desc'); // 계약일 정렬(기본 최신순)
    // 계약 중 / 신규 등록 건(24h) / 계약 종료.
    //   stab=new|active(계약 카드 '관리 시트 →'의 승인 여부) 또는 pending=1(알림)로 시작 탭 지정.
    const urlTab = (): 'active' | 'new' | 'ended' | null => {
        const p = new URLSearchParams(window.location.search);
        const s = p.get('stab');
        if (s === 'new' || s === 'active' || s === 'ended') return s;
        if (p.get('pending') === '1') return 'new';
        return null;
    };
    const [tab, setTab] = useState<'active' | 'new' | 'ended'>(() => urlTab() ?? 'active');

    // 시트 간 이동(app:navigate/popstate) 시 URL의 q·시작탭을 다시 읽어 동기화(같은 컴포넌트 재사용이라 초기값만으론 부족).
    useEffect(() => {
        const syncQ = () => {
            setQ(new URLSearchParams(window.location.search).get('q') ?? '');
            const t = urlTab();
            if (t) setTab(t);
        };
        window.addEventListener('popstate', syncQ);
        window.addEventListener('app:navigate', syncQ);
        return () => {
            window.removeEventListener('popstate', syncQ);
            window.removeEventListener('app:navigate', syncQ);
        };
    }, []);

    useEffect(() => {
        let alive = true;
        setLoading(true);
        void (async () => {
            const [cl, ct] = await Promise.all([getClients(), getClientContracts()]);
            if (!alive) return;
            setClients(cl.data ?? []);
            setContracts(ct.data ?? []);
            setLoading(false);
        })();
        return () => {
            alive = false;
        };
    }, []);

    const clientById = useMemo(() => {
        const m = new Map<string, ErpClient>();
        clients.forEach((c) => m.set(c.id, c));
        return m;
    }, [clients]);

    const allRows = useMemo(
        () =>
            contracts
                .filter((ct) => ct.category === category && (!subtype || stripContainer(ct.subtype) === subtype))
                .map((ct) => ({ ct, cl: clientById.get(ct.client_id) }))
                .filter((r): r is { ct: ClientContract; cl: ErpClient } => !!r.cl),
        [contracts, clientById, category, subtype],
    );

    const managers = useMemo(
        () => [...new Set(allRows.map((r) => r.cl.manager).filter(Boolean) as string[])].sort(),
        [allRows],
    );

    // 신규 등록 건 = 아직 '승인' 안 된 계약(sheet_approved=false). 승인 버튼을 눌러야 '계약 중'으로 이동.
    //   기존 계약은 마이그레이션(sheet_approved=true)으로 계약 중 유지. 종료=고객사 계약종료.
    const tabOf = (r: { ct: ClientContract; cl: ErpClient }) =>
        r.cl.status === '계약종료' ? 'ended' : r.ct.sheet_approved ? 'active' : 'new';

    // 승인 — 신규 등록 건을 최종 승인해 계약 중 시트로 이동(DB 반영 + 즉시 목록 갱신).
    const approve = async (id: string) => {
        const { error } = await updateClientContract(id, { sheet_approved: true });
        if (error) {
            alert('승인 실패: ' + error.message + '\n(client_contracts.sheet_approved 컬럼이 필요합니다)');
            return;
        }
        setContracts((prev) => prev.map((c) => (c.id === id ? { ...c, sheet_approved: true } : c)));
    };

    const counts = useMemo(() => {
        const c = { active: 0, new: 0, ended: 0 };
        for (const r of allRows) c[tabOf(r)] += 1;
        return c;
    }, [allRows]);

    // 진입 시(최초 1회): 신규 등록 건이 있으면 신규 탭으로 시작(없으면 계약 중). pending=1이면 그대로 신규.
    const [didInitTab, setDidInitTab] = useState(false);
    useEffect(() => {
        if (loading || didInitTab) return;
        setDidInitTab(true);
        // URL에 시작 탭(stab/pending)이 지정돼 있으면 그걸 우선(카드 '관리 시트 →'가 승인 여부로 지정).
        if (urlTab()) return;
        setTab(counts.new > 0 ? 'new' : 'active');
    }, [loading, didInitTab, counts.new]);
    // 신규가 0이 됐는데 신규 탭이면(승인 완료 등) 계약 중으로 자동 전환.
    useEffect(() => {
        if (!loading && tab === 'new' && counts.new === 0) setTab('active');
    }, [loading, tab, counts.new]);

    const rows = useMemo(() => {
        const qq = q.trim().toLowerCase();
        return allRows
            .filter(
                (r) =>
                    tabOf(r) === tab &&
                    (!qq || (r.cl.company || '').toLowerCase().includes(qq)) &&
                    (!mgr || r.cl.manager === mgr),
            )
            .sort((a, b) => {
                // 계약일 정렬(오름/내림) 우선. 없으면 업체명순.
                if (dateSort) {
                    const c = (a.ct.contract_date || '').localeCompare(b.ct.contract_date || '');
                    return dateSort === 'asc' ? c : -c;
                }
                return (a.cl.company || '').localeCompare(b.cl.company || '', 'ko');
            });
    }, [allRows, q, mgr, tab, dateSort]);

    // 업체 단위 그룹핑 — 같은 업체 여러 상품이면 1줄로 접어 목록 압축. rows 정렬(계약일/업체명)을 그대로 계승.
    //   상품 1개면 그룹 헤더 없이 바로 상품 행으로. 2개↑면 요약 헤더 + 펼침(클릭).
    const groups = useMemo(() => {
        const map = new Map<string, typeof rows>();
        const order: string[] = [];
        for (const r of rows) {
            const key = r.cl.id; // 동명 업체도 분리되도록 client id 기준
            if (!map.has(key)) {
                map.set(key, []);
                order.push(key);
            }
            map.get(key)!.push(r);
        }
        return order.map((key) => {
            const grp = map.get(key)!;
            let amtSum = 0;
            let doneAmtSum = 0;
            let goalSum = 0;
            let doneSum = 0;
            let remainSum = 0;
            let latest = '';
            for (const { ct } of grp) {
                const goal = ct.goal_count ?? 0;
                const remain = ct.remain_count ?? goal;
                const done = Math.max(0, goal - remain);
                goalSum += goal;
                doneSum += done;
                remainSum += remain;
                amtSum += ct.amount ?? 0;
                doneAmtSum += done * (ct.unit_price ?? 0);
                if ((ct.contract_date || '') > latest) latest = ct.contract_date || '';
            }
            const pct = !goalSum
                ? null
                : remainSum <= 0
                  ? 100
                  : doneSum <= 0
                    ? 0
                    : amtSum > 0 && doneAmtSum > 0
                      ? Math.min(100, Math.round((doneAmtSum / amtSum) * 100))
                      : Math.round((doneSum / goalSum) * 100);
            return {
                key,
                company: grp[0].cl.company || '—',
                manager: grp[0].cl.manager || '—',
                rows: grp,
                count: grp.length,
                pct,
                goalSum,
                doneSum,
                remainSum,
                latest,
            };
        });
    }, [rows]);

    // 펼친 업체(client id) 집합 — 기본은 접힘.
    const [expanded, setExpanded] = useState<Set<string>>(new Set());
    const toggleGroup = (key: string) =>
        setExpanded((prev) => {
            const next = new Set(prev);
            next.has(key) ? next.delete(key) : next.add(key);
            return next;
        });

    if (loading) {
        return <div className="py-16 text-center text-sm text-[#94a3b8]">불러오는 중...</div>;
    }

    // 매출은 시트에 연동하지 않음(매출은 계약 관리에서만). 외주비만 참고로 표시.
    const totalOut = rows.reduce((s, r) => s + (r.ct.outsource || 0), 0);
    const showSub = !subtype;
    const showApprove = tab === 'new' && canManageSheet(category); // 담당 시트 권한자 + 신규 탭에서만 승인
    const dash = <span className="text-xs text-[#cbd5e1]">—</span>;
    const colSpan = showSub ? 12 : 11;

    // 상품 1건 = 1행. detail=true면 그룹 안 상세행(업체명 대신 들여쓰기 마커).
    const renderProductRow = (ct: ClientContract, cl: ErpClient, detail: boolean) => {
        const goal = ct.goal_count ?? 0;
        const remain = ct.remain_count ?? goal;
        const done = Math.max(0, goal - remain);
        const amt = ct.amount ?? 0;
        const doneAmt = done * (ct.unit_price ?? 0);
        const pct = !goal
            ? null
            : remain <= 0
              ? 100
              : done <= 0
                ? 0
                : amt > 0 && doneAmt > 0
                  ? Math.min(100, Math.round((doneAmt / amt) * 100))
                  : Math.round((done / goal) * 100);
        const remainColor =
            ct.remain_count == null ? '#94a3b8' : remain <= 1 ? '#dc2626' : remain <= 5 ? '#d97706' : '#0f172a';
        return (
            <tr
                className={`cursor-pointer border-b border-[#e2e8f0] hover:bg-[#f8fafc] ${detail ? 'bg-[#fafbfc]' : ''}`}
                key={ct.id}
                onClick={() => goTracker(cl.company || '')}
                title="클릭 → 순위 트래커"
            >
                <td
                    className={
                        detail
                            ? 'px-3 py-2 pl-9 text-[12px] text-[#94a3b8]'
                            : 'px-3 py-2 text-[13px] font-semibold text-[#0f172a]'
                    }
                    style={detail ? { borderLeft: '3px solid #e2e8f0' } : undefined}
                >
                    {detail ? '└' : cl.company || '—'}
                </td>
                <td className="px-3 py-2 text-[13px] font-semibold text-[#475569]">{ct.contract_date || '—'}</td>
                {showSub && (
                    <td className="px-3 py-2">
                        <span
                            className="rounded px-1.5 py-0.5 text-[12px] font-semibold"
                            style={{ background: chipColor(ct.subtype).bg, color: chipColor(ct.subtype).text }}
                        >
                            {ct.subtype}
                        </span>
                    </td>
                )}
                <td className="px-3 py-2 text-[13px] text-[#475569]">{cl.manager || '—'}</td>
                <td className="px-3 py-2">
                    {pct == null ? (
                        dash
                    ) : (
                        <div className="min-w-[110px]">
                            <div className="flex items-baseline justify-between gap-2">
                                <span className="text-sm font-bold" style={{ color: progColor(pct) }}>
                                    {pct}%
                                </span>
                                <span className="text-[10px] text-[#94a3b8]">
                                    {done}/{goal}건
                                </span>
                            </div>
                            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[#eef2f7]">
                                <div
                                    className="h-full rounded-full"
                                    style={{ background: progColor(pct), width: `${pct}%` }}
                                />
                            </div>
                        </div>
                    )}
                </td>
                <td className="px-3 py-2 text-center text-sm font-bold" style={{ color: remainColor }}>
                    {ct.remain_count == null ? '—' : remain}
                </td>
                {/* 주 발행 · 추적 글 · 통합 10위 = 블로그 전용(크롤) → 비-블로그는 '—' */}
                <td className="px-3 py-2 text-center">{dash}</td>
                <td className="px-3 py-2 text-center">{dash}</td>
                <td className="px-3 py-2 text-center">{dash}</td>
                <td className="px-3 py-2 text-center">
                    <StatusTag ct={ct} />
                </td>
                <td className="px-3 py-2">
                    <div className="flex items-center gap-1">
                        <span
                            className="block max-w-[120px] truncate text-xs text-[#94a3b8]"
                            title={ct.note || ''}
                        >
                            {ct.note || '—'}
                        </span>
                    </div>
                </td>
                <td className="px-3 py-2 text-center">
                    <div className="flex items-center justify-center gap-1">
                        {showApprove ? (
                            <button
                                className="rounded bg-[#1e40af] px-2.5 py-1 text-[11px] font-bold text-white hover:bg-[#1e3a8a]"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    void approve(ct.id);
                                }}
                                title="승인 → 계약 중 시트로 이동"
                                type="button"
                            >
                                승인
                            </button>
                        ) : null}
                        <button
                            className="rounded border border-[#cbd5e1] px-2 py-1 text-[11px] font-semibold text-[#475569] hover:bg-[#f1f5f9]"
                            onClick={(e) => {
                                e.stopPropagation();
                                navTo(`/clients?id=${cl.id}`);
                            }}
                            title="고객사 상세에서 계약 편집"
                            type="button"
                        >
                            관리
                        </button>
                    </div>
                </td>
            </tr>
        );
    };

    return (
        <div className="grid gap-3">
            {/* 툴바 — 브랜드블로그 시트와 동일: 검색 + 담당 필터 + 개수/합계 */}
            <div className="flex flex-wrap items-center gap-2">
                <input
                    className="h-9 min-w-[180px] flex-1 rounded-md border border-[#cbd5e1] bg-white px-3 text-sm"
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="업체명 검색..."
                    value={q}
                />
                <select
                    className="h-9 rounded-md border border-[#cbd5e1] bg-white px-2 text-xs"
                    onChange={(e) => setMgr(e.target.value)}
                    value={mgr}
                >
                    <option value="">담당 전체</option>
                    {managers.map((m) => (
                        <option key={m}>{m}</option>
                    ))}
                </select>
                <span className="ml-auto text-xs text-[#64748b]">{rows.length}개</span>
                <span className="text-xs text-[#64748b]">
                    외주 <b className="text-[#dc2626]">{won(totalOut)}</b>
                </span>
            </div>

            {/* 신규 등록 건(24h) / 계약 중 / 계약 종료 — 브랜드블로그 시트와 동일 탭 구성 */}
            <div className="flex gap-1 border-b border-[#e2e8f0]">
                {(
                    [
                        { key: 'new', label: '신규 등록 건' },
                        { key: 'active', label: '계약 중' },
                        { key: 'ended', label: '계약 종료' },
                    ] as { key: 'new' | 'active' | 'ended'; label: string }[]
                )
                    // 신규 등록 건 탭은 미승인 건이 있을 때만 표시(평소엔 없음, 승인 완료 시 사라짐).
                    .filter((t) => t.key !== 'new' || counts.new > 0)
                    .map((t) => {
                    const on = tab === t.key;
                    const hot = t.key === 'new' && counts.new > 0;
                    return (
                        <button
                            className={`-mb-px border-b-2 px-4 py-2 text-sm font-bold ${
                                on
                                    ? 'border-[#1e40af] text-[#1e40af]'
                                    : `border-transparent hover:text-[#475569] ${hot ? 'text-[#1e40af]' : 'text-[#94a3b8]'}`
                            }`}
                            key={t.key}
                            onClick={() => setTab(t.key)}
                            type="button"
                        >
                            {hot ? '🔵 ' : ''}
                            {t.label} ({counts[t.key]})
                        </button>
                    );
                })}
            </div>

            <div className="overflow-x-auto rounded-md border border-[#e2e8f0] bg-white">
                <table className="w-full border-collapse text-left text-sm">
                    <thead>
                        <tr className="border-b-2 border-[#e2e8f0] bg-[#f1f5f9] text-[11px] text-[#64748b]">
                            <th className="px-3 py-2 font-semibold">업체</th>
                            <th className="px-3 py-2 font-semibold">
                                <button
                                    className="flex items-center gap-1 font-semibold text-[#475569] hover:text-[#1e40af]"
                                    onClick={() =>
                                        setDateSort((d) => (d === 'desc' ? 'asc' : d === 'asc' ? null : 'desc'))
                                    }
                                    title="계약일 정렬(최신순/오래된순/해제)"
                                    type="button"
                                >
                                    계약일 {dateSort === 'desc' ? '▼' : dateSort === 'asc' ? '▲' : '↕'}
                                </button>
                            </th>
                            {showSub && <th className="px-3 py-2 font-semibold">세부유형</th>}
                            <th className="px-3 py-2 font-semibold">담당</th>
                            <th className="px-3 py-2 font-semibold">진행률</th>
                            <th className="px-3 py-2 text-center font-semibold">잔여</th>
                            <th className="px-3 py-2 text-center font-semibold">주 발행</th>
                            <th className="px-3 py-2 text-center font-semibold">추적 글</th>
                            <th className="px-3 py-2 text-center font-semibold">통합 10위↓</th>
                            <th className="px-3 py-2 text-center font-semibold">상태</th>
                            <th className="px-3 py-2 font-semibold">특이사항</th>
                            <th className="px-3 py-2 text-center font-semibold">관리</th>
                        </tr>
                    </thead>
                    <tbody>
                        {groups.length ? (
                            groups.map((g) => {
                                // 상품 1개 업체 → 그룹 헤더 없이 바로 상품 행.
                                if (g.count === 1) return renderProductRow(g.rows[0].ct, g.rows[0].cl, false);
                                const open = expanded.has(g.key);
                                return (
                                    <Fragment key={g.key}>
                                        {/* 업체 요약 헤더 — 클릭하면 상품 상세 펼침/접힘 */}
                                        <tr
                                            className="cursor-pointer border-b border-[#e2e8f0] bg-[#f8fafc] hover:bg-[#f1f5f9]"
                                            onClick={() => toggleGroup(g.key)}
                                            title={open ? '접기' : '상품 펼치기'}
                                        >
                                            <td className="px-3 py-2 text-[13px] font-bold text-[#0f172a]">
                                                <span className="mr-1.5 inline-block w-3 text-[#64748b]">
                                                    {open ? '▼' : '▶'}
                                                </span>
                                                {g.company}
                                                <span className="ml-2 rounded-full bg-[#e0e7ff] px-2 py-0.5 text-[11px] font-bold text-[#3730a3]">
                                                    상품 {g.count}개
                                                </span>
                                            </td>
                                            <td className="px-3 py-2 text-[13px] font-semibold text-[#475569]">
                                                {g.latest || '—'}
                                            </td>
                                            {showSub && (
                                                <td className="px-3 py-2">
                                                    <div className="flex flex-wrap gap-1">
                                                        {[...new Set(g.rows.map((r) => r.ct.subtype))].map((s) => {
                                                            const cc = chipColor(s);
                                                            return (
                                                                <span
                                                                    className="rounded px-1.5 py-0.5 text-[11px] font-semibold"
                                                                    key={s}
                                                                    style={{ background: cc.bg, color: cc.text }}
                                                                >
                                                                    {s}
                                                                </span>
                                                            );
                                                        })}
                                                    </div>
                                                </td>
                                            )}
                                            <td className="px-3 py-2 text-[13px] text-[#475569]">{g.manager}</td>
                                            <td className="px-3 py-2">
                                                {g.pct == null ? (
                                                    dash
                                                ) : (
                                                    <div className="min-w-[110px]">
                                                        <div className="flex items-baseline justify-between gap-2">
                                                            <span
                                                                className="text-sm font-bold"
                                                                style={{ color: progColor(g.pct) }}
                                                            >
                                                                {g.pct}%
                                                            </span>
                                                            <span className="text-[10px] text-[#94a3b8]">
                                                                통합 {g.doneSum}/{g.goalSum}건
                                                            </span>
                                                        </div>
                                                        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[#eef2f7]">
                                                            <div
                                                                className="h-full rounded-full"
                                                                style={{
                                                                    background: progColor(g.pct),
                                                                    width: `${g.pct}%`,
                                                                }}
                                                            />
                                                        </div>
                                                    </div>
                                                )}
                                            </td>
                                            <td className="px-3 py-2 text-center text-sm font-bold text-[#475569]">
                                                {g.remainSum}
                                            </td>
                                            <td className="px-3 py-2 text-center">{dash}</td>
                                            <td className="px-3 py-2 text-center">{dash}</td>
                                            <td className="px-3 py-2 text-center">{dash}</td>
                                            <td className="px-3 py-2 text-center">{dash}</td>
                                            <td className="px-3 py-2 text-center text-[11px] text-[#94a3b8]">
                                                {open ? '접기' : '펼치기'}
                                            </td>
                                            <td className="px-3 py-2 text-center">
                                                <button
                                                    className="rounded border border-[#cbd5e1] px-2 py-1 text-[11px] font-semibold text-[#475569] hover:bg-[#f1f5f9]"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        navTo(`/clients?id=${g.rows[0].cl.id}`);
                                                    }}
                                                    title="고객사 상세로 이동"
                                                    type="button"
                                                >
                                                    관리
                                                </button>
                                            </td>
                                        </tr>
                                        {open && g.rows.map((r) => renderProductRow(r.ct, r.cl, true))}
                                    </Fragment>
                                );
                            })
                        ) : (
                            <tr>
                                <td className="px-3 py-10 text-center text-sm text-[#94a3b8]" colSpan={colSpan}>
                                    {subtype || category} 계약이 없습니다.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
