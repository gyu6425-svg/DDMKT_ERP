import { useEffect, useMemo, useState } from 'react';
import { getClients, type ErpClient } from '../../api/erp';
import { getClientContracts, updateClientContract, type ClientContract } from '../../api/clientContracts';
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

// 블로그 하위(고유 pathname)·쇼핑·파워링크는 ?sub이 없으므로 경로 → (category, subtype) 매핑.
const PATH_SCOPE: Record<string, { category: string; subtype: string }> = {
    '/blog-optimized': { category: '블로그', subtype: '최적화 블로그 배포' },
    '/blog-semi': { category: '블로그', subtype: '준최적화 블로그 배포' },
    '/blog-simple': { category: '블로그', subtype: '단순 블로그 배포' },
    '/blog-ai': { category: '블로그', subtype: 'AI 블로그 배포' },
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
    const [clients, setClients] = useState<ErpClient[]>([]);
    const [contracts, setContracts] = useState<ClientContract[]>([]);
    const [loading, setLoading] = useState(true);
    // 계약 카드 '관리 시트 →'가 붙인 q=업체명을 초기값으로 → 도착 즉시 해당 업체 자동 필터.
    const [q, setQ] = useState(() => new URLSearchParams(window.location.search).get('q') ?? '');
    const [mgr, setMgr] = useState('');
    const [tab, setTab] = useState<'active' | 'new' | 'ended'>('active'); // 계약 중 / 신규 등록 건(24h) / 계약 종료

    // 시트 간 이동(app:navigate/popstate) 시 URL의 q를 다시 읽어 동기화(같은 컴포넌트 재사용이라 초기값만으론 부족).
    useEffect(() => {
        const syncQ = () => setQ(new URLSearchParams(window.location.search).get('q') ?? '');
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

    const rows = useMemo(() => {
        const qq = q.trim().toLowerCase();
        return allRows
            .filter(
                (r) =>
                    tabOf(r) === tab &&
                    (!qq || (r.cl.company || '').toLowerCase().includes(qq)) &&
                    (!mgr || r.cl.manager === mgr),
            )
            .sort((a, b) => (a.cl.company || '').localeCompare(b.cl.company || '', 'ko'));
    }, [allRows, q, mgr, tab]);

    if (loading) {
        return <div className="py-16 text-center text-sm text-[#94a3b8]">불러오는 중...</div>;
    }

    // 매출은 시트에 연동하지 않음(매출은 계약 관리에서만). 외주비만 참고로 표시.
    const totalOut = rows.reduce((s, r) => s + (r.ct.outsource || 0), 0);
    const showSub = !subtype;
    const showApprove = tab === 'new'; // 신규 등록 건 탭에서만 승인 버튼 노출
    const dash = <span className="text-xs text-[#cbd5e1]">—</span>;
    const colSpan = showSub ? 12 : 11;

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
                ).map((t) => {
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
                            <th className="px-3 py-2 font-semibold">계약일</th>
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
                        {rows.length ? (
                            rows.map(({ ct, cl }) => {
                                const goal = ct.goal_count ?? 0;
                                const remain = ct.remain_count ?? goal;
                                const done = Math.max(0, goal - remain);
                                const pct = goal ? Math.round((done / goal) * 100) : null;
                                const remainColor =
                                    ct.remain_count == null
                                        ? '#94a3b8'
                                        : remain <= 1
                                          ? '#dc2626'
                                          : remain <= 5
                                            ? '#d97706'
                                            : '#0f172a';
                                return (
                                    <tr
                                        className="cursor-pointer border-b border-[#e2e8f0] hover:bg-[#f8fafc]"
                                        key={ct.id}
                                        onClick={() => navTo(`/clients?id=${cl.id}`)}
                                        title="클릭 → 고객사 상세에서 수정"
                                    >
                                        <td className="px-3 py-2 text-[13px] font-semibold text-[#0f172a]">
                                            {cl.company || '—'}
                                        </td>
                                        <td className="px-3 py-2 text-[13px] font-semibold text-[#475569]">
                                            {ct.contract_date || '—'}
                                        </td>
                                        {showSub && (
                                            <td className="px-3 py-2 text-[13px] text-[#475569]">{ct.subtype}</td>
                                        )}
                                        <td className="px-3 py-2 text-[13px] text-[#475569]">{cl.manager || '—'}</td>
                                        <td className="px-3 py-2">
                                            {pct == null ? (
                                                dash
                                            ) : (
                                                <div className="min-w-[110px]">
                                                    <div className="flex items-baseline justify-between gap-2">
                                                        <span
                                                            className="text-sm font-bold"
                                                            style={{ color: progColor(pct) }}
                                                        >
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
                                        <td
                                            className="px-3 py-2 text-center text-sm font-bold"
                                            style={{ color: remainColor }}
                                        >
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
