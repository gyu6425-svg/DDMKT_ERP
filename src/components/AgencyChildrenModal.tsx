import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { won } from '../api/cafeTokens';
import type { ClientContract } from '../api/clientContracts';

// 대행사 상세 → '카페 배포' 계약 카드 클릭 시. 하부 업체별 내역.
//   대행사는 발행하지 않는다. 실제 글은 하부 업체가 쓰고, 그 실적이 이 계약으로 합산된다.
//   ★ 달성 계산식은 크롤러(cafe_contract_sync·cafe_top5_tracker)와 **같은 문장**이어야 한다:
//     done_count(수동 베이스라인) + (top5_achieved_at 있고 top5_seeded=false 이고 excluded=false)
//     식이 갈라지면 카드의 3/60 과 이 모달 합계가 안 맞는다.

type Row = {
    clientId: string;
    company: string;
    given: number;     // 대행사가 배분한 건수
    balance: number;   // 남은 토큰
    done: number;      // 달성(계약 진행에 반영된 수)
};

const progColor = (p: number) => (p >= 70 ? '#059669' : p >= 40 ? '#d97706' : '#dc2626');

export default function AgencyChildrenModal({
    agencyId, agencyName, contract, onClose, onEditContract,
}: {
    agencyId: string;
    agencyName: string;
    contract: ClientContract;
    onClose: () => void;
    onEditContract: () => void;
}) {
    const [rows, setRows] = useState<Row[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let alive = true;
        void (async () => {
            // 하위 업체 + 대행사 본인. 대행사가 자기 카페로 직접 발행하는 경우가 있어(더업스)
            // 본인 실적을 빼면 카드 숫자와 어긋난다.
            const { data: kids } = await supabase
                .from('clients').select('id,company')
                .or(`parent_client_id.eq.${agencyId},id.eq.${agencyId}`);
            const ids = (kids ?? []).map((k) => k.id as string);
            if (!ids.length) { if (alive) { setRows([]); setLoading(false); } return; }

            const [accRes, tokRes, trRes] = await Promise.all([
                supabase.from('cafe_accounts').select('id,client_id,done_count').in('client_id', ids),
                supabase.from('cafe_tokens').select('client_id,delta').in('client_id', ids),
                supabase.from('agency_token_transfers').select('child_client_id,count').eq('agency_client_id', agencyId),
            ]);
            const accs = (accRes.data ?? []) as { id: string; client_id: string; done_count: number | null }[];
            const accIds = accs.map((a) => a.id);
            // ⚠️ 글은 1000행에서 조용히 잘린다(PostgREST db-max-rows). 페이지네이션으로 전부 받는다.
            const posts: { cafe_account_id: string | null }[] = [];
            for (let from = 0; ; from += 1000) {
                if (!accIds.length) break;
                const { data } = await supabase
                    .from('cafe_rank_posts').select('cafe_account_id')
                    .in('cafe_account_id', accIds)
                    .not('top5_achieved_at', 'is', null).eq('top5_seeded', false).eq('excluded', false)
                    .order('id').range(from, from + 999);
                const chunk = (data ?? []) as { cafe_account_id: string | null }[];
                posts.push(...chunk);
                if (chunk.length < 1000) break;
            }

            const doneByAcc = new Map<string, number>();
            posts.forEach((p) => p.cafe_account_id && doneByAcc.set(p.cafe_account_id, (doneByAcc.get(p.cafe_account_id) ?? 0) + 1));
            const out: Row[] = (kids ?? []).map((k) => {
                const mine = accs.filter((a) => a.client_id === k.id);
                return {
                    clientId: k.id as string,
                    company: (k.company as string) || '(이름 없음)',
                    given: (trRes.data ?? []).filter((t) => (t as { child_client_id: string }).child_client_id === k.id)
                        .reduce((s, t) => s + ((t as { count: number }).count || 0), 0),
                    balance: (tokRes.data ?? []).filter((t) => (t as { client_id: string }).client_id === k.id)
                        .reduce((s, t) => s + ((t as { delta: number }).delta || 0), 0),
                    done: mine.reduce((s, a) => s + (a.done_count ?? 0) + (doneByAcc.get(a.id) ?? 0), 0),
                };
            });
            if (alive) { setRows(out.sort((a, b) => (a.clientId === agencyId ? -1 : b.clientId === agencyId ? 1 : a.company.localeCompare(b.company)))); setLoading(false); }
        })();
        return () => { alive = false; };
    }, [agencyId]);

    const goal = contract.goal_count ?? 0;
    const doneTotal = rows.reduce((s, r) => s + r.done, 0);
    const prog = goal ? Math.min(100, Math.round((doneTotal / goal) * 100)) : null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
            <div className="max-h-[92vh] w-[min(760px,96vw)] overflow-y-auto rounded-2xl bg-white p-6" onClick={(e) => e.stopPropagation()}>
                <div className="mb-1 flex flex-wrap items-center gap-2">
                    <h3 className="m-0 text-lg font-bold text-[#0f172a]">{agencyName} · 카페 배포</h3>
                    <span className="rounded-full bg-[#ede9fe] px-2 py-0.5 text-[11px] font-bold text-[#6d28d9]">대행사</span>
                </div>
                <p className="m-0 mb-4 text-sm text-[#64748b]">
                    하위 업체가 발행하고, 그 실적이 이 계약으로 합산됩니다.
                </p>

                {/* 합계 */}
                <div className="mb-4 grid grid-cols-3 gap-3">
                    <div className="rounded-xl border border-[#e2e8f0] bg-white p-4">
                        <div className="text-[12px] text-[#64748b]">계약 건수</div>
                        <div className="mt-0.5 text-2xl font-bold text-[#0f172a]">{goal || '—'}</div>
                    </div>
                    <div className="rounded-xl border border-[#e2e8f0] bg-white p-4">
                        <div className="text-[12px] text-[#64748b]">달성</div>
                        <div className="mt-0.5 text-2xl font-bold text-[#1e40af]">{doneTotal}</div>
                    </div>
                    <div className="rounded-xl border border-[#e2e8f0] bg-white p-4">
                        <div className="text-[12px] text-[#64748b]">진행률</div>
                        {/* 목표가 없으면 0% 로 그리지 않는다 — 비어 있는데 정상처럼 보이는 게 제일 위험하다. */}
                        {prog == null ? (
                            <div className="mt-0.5 text-sm font-bold text-[#b45309]">목표 미설정</div>
                        ) : (
                            <>
                                <div className="mt-0.5 text-2xl font-bold" style={{ color: progColor(prog) }}>{prog}%</div>
                                <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-[#e2e8f0]">
                                    <div className="h-full rounded-full" style={{ background: progColor(prog), width: `${prog}%` }} />
                                </div>
                            </>
                        )}
                    </div>
                </div>

                {loading ? (
                    <div className="py-16 text-center text-sm text-[#94a3b8]">불러오는 중…</div>
                ) : rows.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-[#cbd5e1] bg-[#f8fafc] px-6 py-16 text-center">
                        <div className="text-base font-semibold text-[#475569]">하위 업체가 없습니다</div>
                        <p className="mx-auto mt-2 max-w-md text-sm text-[#94a3b8]">
                            대행사가 초대 코드로 하위 업체를 등록하면 여기에 나타납니다.
                        </p>
                    </div>
                ) : (
                    <div className="overflow-x-auto rounded-[8px] border border-[#e2e8f0] bg-white">
                        <table className="w-full border-collapse text-left text-sm">
                            <thead>
                                <tr className="border-b-2 border-[#e2e8f0] bg-[#f1f5f9] text-[11px] text-[#64748b]">
                                    {['업체', '배분받은 건수', '남은 토큰', '달성'].map((h) => (
                                        <th className="px-3 py-2 font-semibold" key={h}>{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map((r) => (
                                    <tr className="border-b border-[#e2e8f0]" key={r.clientId}>
                                        <td className="px-3 py-2 font-medium text-[#334155]">
                                            {r.company}
                                            {r.clientId === agencyId ? (
                                                <span className="ml-1.5 text-[11px] text-[#94a3b8]">(대행사 본인)</span>
                                            ) : null}
                                        </td>
                                        <td className="px-3 py-2 text-[#475569]">{r.given ? `${r.given}건` : '-'}</td>
                                        <td className="px-3 py-2 text-[#475569]">{r.balance}건</td>
                                        <td className="px-3 py-2 font-bold text-[#1e40af]">{r.done}건</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}

                <div className="mt-5 flex items-center justify-between">
                    <div className="text-[12px] text-[#94a3b8]">
                        공급가 ₩{won(contract.amount ?? 0)} <span className="text-[#cbd5e1]">(부가세 별도)</span>
                    </div>
                    <div className="flex gap-2">
                        {/* 계약 자체(금액·건수·계약일)를 고칠 길은 남겨 둔다 — 이 모달로 갈아끼우면서
                            수정 경로가 사라지면 recordTokenSale 실패분을 손으로 채울 수 없다. */}
                        <button
                            className="rounded-md border border-[#1e40af] px-4 py-2 text-sm font-semibold text-[#1e40af] hover:bg-[#eff6ff]"
                            onClick={onEditContract}
                            type="button"
                        >
                            계약 정보 수정
                        </button>
                        <button
                            className="rounded-md border border-[#cbd5e1] px-4 py-2 text-sm font-semibold text-[#475569] hover:bg-[#f1f5f9]"
                            onClick={onClose}
                            type="button"
                        >
                            닫기
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
