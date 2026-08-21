import { useEffect, useMemo, useState } from 'react';
import { useErpData } from '../context/ErpDataContext';
import { calcContract, formatAmount, STATUS_BADGE } from '../lib/erpUtils';
import { getClientContracts, type ClientContract } from '../api/clientContracts';
import { isBrandBlogSub } from '../lib/products';
import Button from '../components/Button';

// 잔여 소진 임박 기준 — 카페는 10건, 브랜드 블로그는 5건 미만(사장님 지시 2026-08-21).
//   기준이 다른 이유: 카페는 하루 여러 건이 나가고 블로그는 주 단위라, 같은 숫자면 경보 시점이 어긋난다.
const CAFE_LOW = 10;
const BLOG_LOW = 5;

function go(path: string) {
    window.history.pushState({}, '', path);
    window.dispatchEvent(new Event('app:navigate'));
}

function DashboardPage() {
    const { clients, salespeople, contractData, canSeeAll, myName, loading, error } = useErpData();

    const today = new Date().toISOString().slice(0, 10);

    const stats = useMemo(() => {
        const rateOf = (manager: string | null) =>
            salespeople.find((s) => s.name === (manager || ''))?.commission_rate ?? null;

        let revenue = 0;
        let net = 0;
        let unpaid = 0;
        let incentive = 0;
        let contractCount = 0;

        clients.forEach((client) => {
            const cd = contractData[client.id];
            if (!cd) {
                return;
            }
            contractCount += 1;
            const fin = calcContract(cd, rateOf(client.manager));
            revenue += fin.revenue;
            net += fin.net;
            unpaid += fin.unpaid;
            incentive += fin.incentive;
        });

        const contracted = clients.filter((c) => c.status === '계약완료').length;
        return { contractCount, contracted, incentive, net, revenue, unpaid };
    }, [clients, contractData, salespeople]);

    // 만료 임박(30일 이내)
    const expiring = useMemo(() => {
        const limit = new Date();
        limit.setDate(limit.getDate() + 30);
        const limitStr = limit.toISOString().slice(0, 10);
        return clients
            .filter((c) => c.contract_end && c.contract_end >= today && c.contract_end <= limitStr)
            .sort((a, b) => (a.contract_end || '').localeCompare(b.contract_end || ''));
    }, [clients, today]);

    // 연락 필요(다음 연락일 지남)
    const needContact = useMemo(
        () =>
            clients
                .filter((c) => c.next_contact && c.next_contact <= today)
                .sort((a, b) => (a.next_contact || '').localeCompare(b.next_contact || '')),
        [clients, today],
    );

    // 잔여 소진 임박 — 카페 배포 / 브랜드 블로그.
    //   계약 진행률은 client_contracts.remain_count 하나가 출처다(카페는 크롤러가, 블로그는
    //   블로그 대시보드가 이 값을 깎는다). 관리시트의 실시간 계산과 몇 시간 어긋날 수 있다.
    const [contracts, setContracts] = useState<ClientContract[]>([]);
    useEffect(() => {
        let alive = true;
        void getClientContracts().then(({ data }) => { if (alive) setContracts(data); });
        return () => { alive = false; };
    }, []);

    const lowStock = useMemo(() => {
        // 내가 볼 수 있는 고객만. 대행사 하부 업체는 우리 계약이 아니라 제외(계약 관리와 같은 규칙).
        const nameOf = new Map<string, string>();
        for (const c of clients) {
            if ((c as { parent_client_id?: string | null }).parent_client_id) continue;
            nameOf.set(c.id, c.company || '업체');
        }
        const pick = (match: (ct: ClientContract) => boolean, limit: number) =>
            contracts
                .filter((ct) => nameOf.has(ct.client_id) && match(ct))
                // 만료 처리한 계약은 이미 끝난 건이라 뺀다 — 안 빼면 소진된 옛 계약이 영원히 쌓인다.
                .filter((ct) => !(ct.note || '').includes('[만료]'))
                .filter((ct) => (ct.goal_count ?? 0) > 0 && (ct.remain_count ?? 0) < limit)
                .map((ct) => ({
                    id: ct.id,
                    client_id: ct.client_id,
                    name: ct.blog_name || nameOf.get(ct.client_id) || '업체',
                    remain: Math.max(0, ct.remain_count ?? 0),
                    goal: ct.goal_count ?? 0,
                }))
                // ★ 잔여 0(이미 소진)을 앞에 두면 칩이 0으로만 채워져, 정작 '아직 막을 수 있는'
                //   1~n건 남은 업체가 안 보인다. 소진 건수는 위 빨간 숫자로 따로 세니
                //   칩은 잔여가 남은 곳부터 보여 준다.
                .sort((a, b) => (a.remain === 0 ? 1 : 0) - (b.remain === 0 ? 1 : 0) || a.remain - b.remain);

        const base = (s: string) => s.replace(/^상위노출 보장형 · /, '');
        return {
            cafe: pick((ct) => ct.category === '카페' && /배포/.test(ct.subtype || ''), CAFE_LOW),
            blog: pick((ct) => ct.category === '블로그' && isBrandBlogSub(base(ct.subtype || '')), BLOG_LOW),
        };
    }, [clients, contracts]);

    return (
        <section className="grid gap-4">
            <div>
                <p className="m-0 text-sm text-[#64748b]">
                    {canSeeAll ? '전체 현황' : `${myName} 님의 담당 현황`}
                    {loading ? ' · 불러오는 중...' : ''}
                </p>
            </div>

            {error ? (
                <p className="m-0 rounded-md bg-[#fee2e2] px-4 py-3 text-sm text-[#dc2626]">{error}</p>
            ) : null}

            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Kpi label="담당 고객" value={`${clients.length}`} sub={`계약완료 ${stats.contracted}`} />
                <Kpi label="총 매출" value={formatAmount(stats.revenue)} sub={`계약 ${stats.contractCount}건`} />
                <Kpi label="순수익" value={formatAmount(stats.net)} accent="#059669" sub={`인센 ${formatAmount(stats.incentive)}`} />
                <Kpi label="미수금" value={formatAmount(stats.unpaid)} accent="#dc2626" sub="수금 필요" />
            </div>

            {/* 잔여 소진 임박 — 재계약을 챙겨야 할 업체. 숫자만 두면 누구인지 몰라 못 움직인다. */}
            <div className="grid gap-3 lg:grid-cols-2">
                <LowStock label="카페 계약 소진 임박" limit={CAFE_LOW} rows={lowStock.cafe} tone="#7c3aed" />
                <LowStock label="브랜드 블로그 소진 임박" limit={BLOG_LOW} rows={lowStock.blog} tone="#0891b2" />
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
                {/* 알림: 연락 필요 */}
                <Panel
                    title="🔔 연락 필요"
                    count={needContact.length}
                    onMore={() => go('/clients')}
                >
                    {needContact.length ? (
                        needContact.slice(0, 6).map((c) => (
                            <Row key={c.id} onClick={() => go('/clients')}>
                                <span className="font-medium">{c.company || c.manager || '고객'}</span>
                                <span className="flex items-center gap-2">
                                    <Badge text={c.status || ''} />
                                    <span className="text-xs text-[#dc2626]">{c.next_contact}</span>
                                </span>
                            </Row>
                        ))
                    ) : (
                        <Empty text="연락 예정이 지난 고객이 없습니다" />
                    )}
                </Panel>

                {/* 만료 임박 */}
                <Panel
                    title="⏰ 계약 만료 임박 (30일)"
                    count={expiring.length}
                    onMore={() => go('/contracts')}
                >
                    {expiring.length ? (
                        expiring.slice(0, 6).map((c) => (
                            <Row key={c.id} onClick={() => go('/contracts')}>
                                <span className="font-medium">{c.company || '업체'}</span>
                                <span className="text-xs text-[#d97706]">~ {c.contract_end}</span>
                            </Row>
                        ))
                    ) : (
                        <Empty text="30일 내 만료 예정 계약이 없습니다" />
                    )}
                </Panel>
            </div>

        </section>
    );
}

type LowRow = { id: string; client_id: string; name: string; remain: number; goal: number };

const PREVIEW = 4;   // 카드에 바로 보여 주는 줄 수 — 나머지는 '자세히 보기'

// 한 줄 — 업체명 + 잔여/목표. 누르면 그 고객사 상세로.
function LowRowItem({ r }: { r: LowRow }) {
    const done = r.remain === 0;
    return (
        <Button
            className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-[#f8fafc]"
            // 고객사 상세는 별도 라우트가 아니라 /clients?id= 로 연다(ClientsPage 안의 패널).
            onClick={() => go(`/clients?id=${encodeURIComponent(r.client_id)}`)}
            type="button"
        >
            <span className="truncate font-medium text-[#334155]">{r.name}</span>
            <span className="flex shrink-0 items-center gap-1.5">
                {done ? (
                    <span className="rounded-full bg-[#fef2f2] px-1.5 py-0.5 text-[10px] font-bold text-[#b91c1c]">소진</span>
                ) : null}
                <span className={`text-xs font-bold ${done ? 'text-[#b91c1c]' : 'text-[#d97706]'}`}>{r.remain}건</span>
                <span className="text-[11px] text-[#94a3b8]">/ {r.goal}</span>
            </span>
        </Button>
    );
}

// 잔여 소진 임박 카드 — 큰 숫자(몇 곳) + 앞 4곳. 잔여 0은 이미 멈춘 것이라 빨강으로 따로 센다.
function LowStock({
    label,
    limit,
    rows,
    tone,
}: {
    label: string;
    limit: number;
    rows: LowRow[];
    tone: string;
}) {
    const [open, setOpen] = useState(false);
    const out = rows.filter((r) => r.remain === 0).length;
    const rest = rows.length - PREVIEW;

    return (
        <div className="rounded-[8px] border border-[#e2e8f0] bg-white p-4">
            <div className="flex items-start justify-between">
                <div>
                    <p className="m-0 text-xs text-[#64748b]">{label}</p>
                    <p className="m-0 mt-1 text-2xl font-bold" style={{ color: rows.length ? tone : '#94a3b8' }}>
                        {rows.length}
                        <span className="ml-1 text-[15px] font-semibold text-[#94a3b8]">곳</span>
                    </p>
                    <p className="m-0 mt-0.5 text-[11px] text-[#94a3b8]">
                        잔여 {limit}건 미만{out ? <span className="font-bold text-[#dc2626]"> · 소진 {out}곳</span> : null}
                    </p>
                </div>
                {rest > 0 ? (
                    <Button className="text-xs font-semibold text-[#1e40af]" onClick={() => setOpen(true)} type="button">
                        자세히 보기 →
                    </Button>
                ) : null}
            </div>

            {rows.length ? (
                <div className="mt-2 grid gap-0.5">
                    {rows.slice(0, PREVIEW).map((r) => <LowRowItem key={r.id} r={r} />)}
                    {rest > 0 ? (
                        <Button
                            className="mt-0.5 rounded-md border border-dashed border-[#cbd5e1] px-2 py-1.5 text-[11px] font-semibold text-[#64748b] hover:bg-[#f8fafc]"
                            onClick={() => setOpen(true)}
                            type="button"
                        >
                            나머지 {rest}곳 더 보기
                        </Button>
                    ) : null}
                </div>
            ) : (
                <p className="m-0 mt-2.5 text-[11px] text-[#94a3b8]">임박한 계약이 없습니다</p>
            )}

            {open ? (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setOpen(false)}>
                    <div className="max-h-[92vh] w-[min(560px,96vw)] overflow-y-auto rounded-2xl bg-white p-6" onClick={(e) => e.stopPropagation()}>
                        <div className="mb-1 flex items-center justify-between gap-2">
                            <h3 className="m-0 text-lg font-bold text-[#0f172a]">{label}</h3>
                            <Button className="text-sm font-bold text-[#94a3b8] hover:text-[#475569]" onClick={() => setOpen(false)} type="button">
                                닫기
                            </Button>
                        </div>
                        <p className="m-0 mb-4 text-sm text-[#64748b]">
                            잔여 {limit}건 미만 {rows.length}곳
                            {out ? <span className="font-bold text-[#dc2626]"> · 이미 소진 {out}곳</span> : null}
                            {' '}· 업체를 누르면 계약 상세로 이동합니다.
                        </p>
                        <div className="grid gap-0.5">
                            {rows.map((r) => <LowRowItem key={r.id} r={r} />)}
                        </div>
                    </div>
                </div>
            ) : null}
        </div>
    );
}

function Kpi({
    label,
    value,
    sub,
    accent,
}: {
    label: string;
    value: string;
    sub?: string;
    accent?: string;
}) {
    return (
        <div className="rounded-[8px] border border-[#e2e8f0] bg-white p-4">
            <p className="m-0 text-xs text-[#64748b]">{label}</p>
            <p className="m-0 mt-1 text-2xl font-bold" style={{ color: accent ?? '#0f172a' }}>
                {value}
            </p>
            {sub ? <p className="m-0 mt-0.5 text-[11px] text-[#94a3b8]">{sub}</p> : null}
        </div>
    );
}

function Panel({
    title,
    count,
    onMore,
    children,
}: {
    title: string;
    count: number;
    onMore?: () => void;
    children: React.ReactNode;
}) {
    return (
        <div className="rounded-[8px] border border-[#e2e8f0] bg-white p-4">
            <div className="mb-2 flex items-center justify-between">
                <h3 className="m-0 text-sm font-bold text-[#0f172a]">
                    {title} <span className="text-[#94a3b8]">({count})</span>
                </h3>
                {onMore ? (
                    <Button
                        className="text-xs font-semibold text-[#1e40af]"
                        onClick={onMore}
                        type="button"
                    >
                        전체보기 →
                    </Button>
                ) : null}
            </div>
            <div className="grid gap-1">{children}</div>
        </div>
    );
}

function Row({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) {
    return (
        <Button
            className="flex items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-[#f8fafc]"
            onClick={onClick}
            type="button"
        >
            {children}
        </Button>
    );
}

function Badge({ text }: { text: string }) {
    if (!text) {
        return null;
    }
    return (
        <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                STATUS_BADGE[text] || 'bg-[#e2e8f0] text-[#64748b]'
            }`}
        >
            {text}
        </span>
    );
}

function Empty({ text }: { text: string }) {
    return <p className="m-0 py-5 text-center text-xs text-[#94a3b8]">{text}</p>;
}

export default DashboardPage;
