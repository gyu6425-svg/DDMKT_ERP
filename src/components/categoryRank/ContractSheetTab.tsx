import { useEffect, useMemo, useState } from 'react';
import { getClients, type ErpClient } from '../../api/erp';
import { getClientContracts, type ClientContract } from '../../api/clientContracts';
import { SIDEBAR_CATEGORIES } from './categories';

// 하위 카테고리 관리 시트(1차) — 해당 category(+subtype) 계약을 업체별로 나열.
//   계약 관리(client_contracts)가 단일 출처 → 여기선 표시만. 행 클릭 시 고객사 상세로 이동해 수정.
//   subtype 미지정(상위 대시보드) 시 카테고리 전체를 세부유형 열과 함께 표시.
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

export function ContractSheetTab({ category, subtype }: { category: string; subtype?: string }) {
    const [clients, setClients] = useState<ErpClient[]>([]);
    const [contracts, setContracts] = useState<ClientContract[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let alive = true;
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

    const rows = useMemo(() => {
        return contracts
            .filter((ct) => ct.category === category && (!subtype || ct.subtype === subtype))
            .map((ct) => ({ ct, cl: clientById.get(ct.client_id) }))
            .filter((r) => r.cl) // 계약종료 등으로 client 없으면 제외
            .sort((a, b) => (a.cl!.company || '').localeCompare(b.cl!.company || '', 'ko'));
    }, [contracts, clientById, category, subtype]);

    if (loading) {
        return <div className="py-16 text-center text-sm text-[#94a3b8]">불러오는 중...</div>;
    }
    if (!rows.length) {
        return (
            <div className="rounded-xl border border-dashed border-[#cbd5e1] bg-[#f8fafc] px-6 py-16 text-center text-sm text-[#94a3b8]">
                {subtype || category} 계약이 없습니다.
            </div>
        );
    }

    const totalAmount = rows.reduce((s, r) => s + (r.ct.amount || 0), 0);
    const totalOut = rows.reduce((s, r) => s + (r.ct.outsource || 0), 0);

    return (
        <div className="overflow-x-auto rounded-xl border border-[#e2e8f0]">
            <div className="flex items-center justify-between gap-2 border-b border-[#e2e8f0] bg-[#f8fafc] px-4 py-2 text-xs font-semibold text-[#475569]">
                <span>
                    {subtype || category} · <b className="text-[#1e40af]">{rows.length}</b>건
                </span>
                <span>
                    매출 합계 <b className="text-[#1e40af]">{won(totalAmount)}</b>원 · 외주 합계{' '}
                    <b className="text-[#dc2626]">{won(totalOut)}</b>원
                </span>
            </div>
            <table className="w-full min-w-[720px] border-collapse text-sm">
                <thead>
                    <tr className="border-b border-[#e2e8f0] bg-white text-left text-xs text-[#64748b]">
                        <th className="px-3 py-2 font-semibold">업체명</th>
                        <th className="px-3 py-2 font-semibold">담당</th>
                        <th className="px-3 py-2 font-semibold">계약일</th>
                        {!subtype && <th className="px-3 py-2 font-semibold">세부유형</th>}
                        <th className="px-3 py-2 font-semibold">진행률</th>
                        <th className="px-3 py-2 text-right font-semibold">건수(잔여)</th>
                        <th className="px-3 py-2 text-right font-semibold">매출</th>
                        <th className="px-3 py-2 text-right font-semibold">외주단가</th>
                        <th className="px-3 py-2 text-right font-semibold">외주비</th>
                        <th className="px-3 py-2 font-semibold">외주업체</th>
                    </tr>
                </thead>
                <tbody>
                    {rows.map(({ ct, cl }) => {
                        const goal = ct.goal_count ?? 0;
                        const remain = ct.remain_count ?? goal;
                        const done = Math.max(0, goal - remain);
                        const pct = goal ? Math.round((done / goal) * 100) : null;
                        return (
                            <tr
                                className="cursor-pointer border-b border-[#eef2f7] hover:bg-[#f8fafc]"
                                key={ct.id}
                                onClick={() => navTo(`/clients?id=${cl!.id}`)}
                                title="클릭 → 고객사 상세에서 수정"
                            >
                                <td className="px-3 py-2 font-semibold text-[#0f172a]">{cl!.company || '-'}</td>
                                <td className="px-3 py-2 text-[#475569]">{cl!.manager || '-'}</td>
                                <td className="px-3 py-2 text-[#64748b]">{ct.contract_date || '-'}</td>
                                {!subtype && <td className="px-3 py-2 text-[#475569]">{ct.subtype}</td>}
                                <td className="px-3 py-2">
                                    {pct == null ? (
                                        <span className="text-xs text-[#94a3b8]">-</span>
                                    ) : (
                                        <div className="min-w-[92px]">
                                            <span className="text-xs font-bold" style={{ color: progColor(pct) }}>
                                                {pct}%
                                            </span>
                                            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[#eef2f7]">
                                                <div
                                                    className="h-full rounded-full"
                                                    style={{ background: progColor(pct), width: `${pct}%` }}
                                                />
                                            </div>
                                        </div>
                                    )}
                                </td>
                                <td className="px-3 py-2 text-right text-[#475569]">
                                    {goal ? `${goal}건` : '-'}
                                    {goal ? <span className="text-[#94a3b8]"> (잔여 {remain})</span> : null}
                                </td>
                                <td className="px-3 py-2 text-right font-semibold text-[#1e40af]">{won(ct.amount)}</td>
                                <td className="px-3 py-2 text-right text-[#64748b]">{won(ct.unit_outsource)}</td>
                                <td className="px-3 py-2 text-right font-semibold text-[#dc2626]">{won(ct.outsource)}</td>
                                <td className="px-3 py-2">
                                    {ct.outsource_company ? (
                                        <span className="rounded-full bg-[#fee2e2] px-2 py-0.5 text-[11px] font-semibold text-[#dc2626]">
                                            {ct.outsource_company}
                                        </span>
                                    ) : (
                                        <span className="text-xs text-[#cbd5e1]">-</span>
                                    )}
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}
