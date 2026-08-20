import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { supabase } from '../../lib/supabase';
import { listTokens, balanceOf } from '../../api/cafeTokens';

// 하부 업체 통합 대시보드 — 카페 배포 하나만 본다.
//   블로그·플레이스·측정 글 카드는 뺐다. 하부 업체는 카페 배포만 쓰는데,
//   0으로 채워진 카드가 넉 장 붙어 있으면 "우리 건 아무것도 안 되고 있나" 로 읽힌다.
//   ★ 계약 건수는 대행사에게 받은 토큰이다. 우리(든든한마케팅)와 맺은 계약이 아니다.

type Post = {
    id: string;
    title: string | null;
    keyword: string | null;
    keyword_manual: string | null;
    published_date: string | null;
    top5_achieved_at: string | null;
    top5_seeded: boolean | null;
    measurements: { ti?: number | null; ti_status?: string | null; at?: string | null }[] | null;
};

const progColor = (p: number) => (p >= 70 ? '#059669' : p >= 40 ? '#d97706' : '#dc2626');

// 최근 측정에서의 통합탭 순위. 권외/측정불가는 그대로 문구로 보여준다 — 숫자로 뭉개면 오해한다.
function lastRank(p: Post): string {
    const m = (p.measurements ?? []).at(-1);
    if (!m) return '-';
    if (m.ti_status && m.ti_status !== 'ok' && m.ti_status !== 'list_ok') {
        return m.ti_status === 'no_section' ? '섹션없음' : '권외';
    }
    return m.ti ? `${m.ti}위` : '권외';
}

export default function SubDashboard() {
    const { profile } = useAuth();
    const asParam = new URLSearchParams(window.location.search).get('as') || '';
    const clientId = asParam || profile?.client_id || '';

    const [balance, setBalance] = useState(0);
    const [granted, setGranted] = useState(0);
    const [used, setUsed] = useState(0);
    const [posts, setPosts] = useState<Post[]>([]);
    const [loading, setLoading] = useState(true);

    const load = useCallback(() => {
        if (!clientId) { setLoading(false); return; }
        setLoading(true);
        void (async () => {
            const { data: toks } = await listTokens(clientId);
            setBalance(balanceOf(toks, clientId));
            setGranted(toks.filter((t) => t.delta > 0).reduce((a, t) => a + t.delta, 0));
            setUsed(toks.filter((t) => t.delta < 0 && t.kind !== '배분').reduce((a, t) => a - t.delta, 0));

            const { data: accs } = await supabase.from('cafe_accounts').select('id').eq('client_id', clientId);
            const ids = (accs ?? []).map((a) => a.id as string);
            if (!ids.length) { setPosts([]); setLoading(false); return; }
            const { data } = await supabase
                .from('cafe_rank_posts')
                .select('id,title,keyword,keyword_manual,published_date,top5_achieved_at,top5_seeded,measurements')
                .in('cafe_account_id', ids).eq('excluded', false)
                .order('published_date', { ascending: false }).limit(200);
            setPosts((data ?? []) as Post[]);
            setLoading(false);
        })();
    }, [clientId]);
    useEffect(load, [load]);

    if (loading) return <div className="py-16 text-center text-sm text-[#94a3b8]">불러오는 중…</div>;

    const achieved = posts.filter((p) => p.top5_achieved_at && !p.top5_seeded).length;
    const prog = granted ? Math.min(100, Math.round((used / granted) * 100)) : null;

    return (
        <div className="grid gap-4">
            {/* 남은 건수를 큰 숫자로 — 카드 밑 작은 글씨로만 두면 "지금 몇 건 쓸 수 있나"가 한눈에 안 들어온다. */}
            <div className="grid grid-cols-3 gap-3 max-[560px]:grid-cols-1">
                <div className="rounded-xl border border-[#e2e8f0] bg-white p-4">
                    <div className="text-[12px] text-[#64748b]">받은 건수</div>
                    <div className="mt-0.5 text-2xl font-bold text-[#0f172a]">{granted}<span className="ml-1 text-[15px] text-[#94a3b8]">건</span></div>
                </div>
                <div className="rounded-xl border border-[#e2e8f0] bg-white p-4">
                    <div className="text-[12px] text-[#64748b]">발행</div>
                    <div className="mt-0.5 text-2xl font-bold text-[#475569]">{used}<span className="ml-1 text-[15px] text-[#94a3b8]">건</span></div>
                </div>
                <div className={`rounded-xl border p-4 ${balance > 0 ? 'border-[#bfdbfe] bg-[#eff6ff]' : 'border-[#e2e8f0] bg-white'}`}>
                    <div className="text-[12px] text-[#64748b]">남은 건수</div>
                    <div className={`mt-0.5 text-2xl font-bold ${balance > 0 ? 'text-[#1e40af]' : 'text-[#b45309]'}`}>
                        {balance}<span className="ml-1 text-[15px] text-[#94a3b8]">건</span>
                    </div>
                    {balance === 0 ? (
                        <button className="mt-1 rounded-md bg-[#4338ca] px-2.5 py-1 text-[11px] font-bold text-white hover:bg-[#3730a3]"
                            onClick={() => {
                                const as = new URLSearchParams(window.location.search).get('as');
                                window.history.pushState(null, '', `/portal/cafe?tab=charge${as ? `&as=${encodeURIComponent(as)}` : ''}`);
                                window.dispatchEvent(new Event('app:navigate'));
                            }}
                            type="button">
                            충전 요청하러 가기
                        </button>
                    ) : null}
                </div>
            </div>

            {/* 카페 배포 — 계약 카드 한 장 */}
            <div>
                <div className="mb-2 flex items-center gap-2">
                    <span className="text-[14px] font-bold text-[#0f172a]">카페</span>
                    <span className="text-[12px] text-[#94a3b8]">1개</span>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                    <div className="flex flex-col rounded-lg border-2 border-[#e2e8f0] bg-white px-3.5 py-3 shadow-sm">
                        <div className="text-[13px] font-bold text-[#334155]">카페 배포</div>
                        {prog == null ? (
                            <div className="mt-1 text-[13px] font-bold text-[#b45309]">충전 전</div>
                        ) : (
                            <>
                                {/* 방금 충전해 아직 한 건도 안 나간 상태를 빨간 0% 로 보여주면 문제가 난 것처럼 읽힌다. */}
                                <div className="mt-0.5 text-2xl font-bold" style={{ color: used === 0 ? '#94a3b8' : progColor(prog) }}>{prog}%</div>
                                <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-[#e2e8f0]">
                                    <div className="h-full rounded-full" style={{ background: used === 0 ? '#cbd5e1' : progColor(prog), width: `${prog}%` }} />
                                </div>
                            </>
                        )}
                        <div className="mt-1.5 text-[11px] text-[#64748b]">{used}/{granted}건 · 잔여 {balance}건</div>
                    </div>
                </div>
            </div>

            {/* 발행 히스토리 */}
            <div className="rounded-xl border border-[#e2e8f0]">
                <div className="flex flex-wrap items-center gap-2 border-b border-[#e2e8f0] px-4 py-3">
                    <div className="text-[14px] font-bold text-[#0f172a]">발행 히스토리</div>
                    <span className="text-[12px] text-[#94a3b8]">{posts.length}건</span>
                    {achieved ? (
                        <span className="rounded-full bg-[#dcfce7] px-2 py-0.5 text-[11px] font-bold text-[#166534]">
                            5위 24시간 달성 {achieved}건
                        </span>
                    ) : null}
                </div>
                {posts.length === 0 ? (
                    <div className="px-4 py-14 text-center text-[13px] leading-6 text-[#94a3b8]">
                        아직 발행된 글이 없습니다.
                        <br />
                        &lsquo;주문서 작성&rsquo; 탭에서 접수하시면 담당자가 세팅 후 발행합니다.
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[640px] border-collapse text-left text-sm">
                            <thead>
                                <tr className="border-b-2 border-[#e2e8f0] bg-[#f1f5f9] text-[11px] text-[#64748b]">
                                    {['발행일', '제목', '키워드', '최근 순위', '달성'].map((h) => (
                                        <th className="px-3 py-2 font-semibold" key={h}>{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {posts.map((p) => (
                                    <tr className="border-b border-[#e2e8f0] hover:bg-[#f8fafc]" key={p.id}>
                                        <td className="whitespace-nowrap px-3 py-2 text-[#64748b]">{p.published_date || '-'}</td>
                                        <td className="px-3 py-2 font-medium text-[#334155]">{p.title || '-'}</td>
                                        <td className="px-3 py-2 text-[#475569]">{p.keyword_manual || p.keyword || '-'}</td>
                                        <td className="whitespace-nowrap px-3 py-2 font-semibold text-[#1e40af]">{lastRank(p)}</td>
                                        <td className="whitespace-nowrap px-3 py-2">
                                            {p.top5_achieved_at && !p.top5_seeded ? (
                                                <span className="rounded-full bg-[#dcfce7] px-2 py-0.5 text-[11px] font-bold text-[#166534]">달성</span>
                                            ) : (
                                                <span className="text-[11px] text-[#cbd5e1]">-</span>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}
