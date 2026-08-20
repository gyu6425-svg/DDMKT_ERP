import { useEffect, useState } from 'react';
import { getCafeAccounts, type CafeAccount } from '../../../api/cafeAccounts';
import { getTokenBalances } from '../../../api/cafeTokens';
import { getPendingGenRequests } from '../../../api/cafeGenRequests';
import { getClientLabels } from '../../../api/erp';
import { useVisiblePolling } from '../../../lib/useVisiblePolling';
import { loadPendingScan } from '../../../api/cafeKwScan';
import { CafeCustomerStudio } from '../../cafe/CafeCustomerStudio';

// 카페 자동화 발행(관리자) — 접수 승인 후 토큰이 발행된 고객사를 골라 '우리가' 대신 발행한다.
//   고객사 목록 = publish_enabled 된 카페 계정. 각 업체의 잔여 토큰 표시. 선택 시 그 업체 발행 스튜디오 노출.
export function CafeAdminPublishTab() {
    const [accts, setAccts] = useState<CafeAccount[]>([]);
    // client_id → { company, isAgency, agencyId } — 업체명 + 대행사 계층 표시용.
    //   ⚠️ 예전엔 parent(=parent_company)로 묶었는데 그 값을 늘 null 로 넣고 있어 그룹이 한 번도 안 잡혔다.
    //      계층의 근거는 clients.parent_client_id 하나뿐이다(src/api/orgs.ts 와 같은 기준).
    const [clientInfo, setClientInfo] = useState<Record<string, { company: string; isAgency: boolean; agencyId: string | null }>>({});
    const [balById, setBalById] = useState<Record<string, number>>({}); // client_id → 잔여 토큰(원장)
    const [reservedById, setReservedById] = useState<Record<string, number>>({}); // client_id → 예약(발행요청 미완료) 건수 = 즉시 차감분
    // 선택 고객 client_id — 세팅해두면 유지(새로고침·재방문에도). localStorage 지속.
    const [sel, setSelState] = useState<string | null>(() => localStorage.getItem('cafeAdminPubSel'));
    const setSel = (id: string | null) => {
        setSelState(id);
        if (id) localStorage.setItem('cafeAdminPubSel', id); else localStorage.removeItem('cafeAdminPubSel');
    };
    const [loading, setLoading] = useState(true);

    const reload = () => {
        void getCafeAccounts().then(async ({ data }) => {
            // 발행 승인(토큰 발행)된 업체만. client_id 기준 중복 제거.
            const enabled = data.filter((a) => a.client_id && a.publish_enabled);
            const seen = new Set<string>();
            const uniq = enabled.filter((a) => (seen.has(a.client_id!) ? false : (seen.add(a.client_id!), true)));
            // client_id → 그 client 의 모든 company_key(고정업체 발행요청은 company 로 매칭).
            const keysByClient = new Map<string, Set<string>>();
            for (const a of data) if (a.client_id && a.company_key) {
                (keysByClient.get(a.client_id) ?? keysByClient.set(a.client_id, new Set()).get(a.client_id)!).add(a.company_key);
            }
            // 잔액은 1회 조회로 전부 받는다 — 고객 수만큼 listTokens 를 돌리던 걸 없앴다(8초 폴링 × N요청).
            const bals = await getTokenBalances();
            // 예약(발행요청 미완료) 건수 = 즉시 차감 — client_id 매칭(신규) 또는 company 매칭(고정).
            const pending = await getPendingGenRequests();
            const reserved: Record<string, number> = {};
            for (const a of uniq) {
                const cid = a.client_id!;
                const keys = keysByClient.get(cid) ?? new Set<string>();
                reserved[cid] = pending.filter((p) => p.client_id === cid || keys.has(p.company)).length;
            }
            setAccts(uniq);
            setBalById(bals);
            setReservedById(reserved);
            setLoading(false);
        });
        // 클라이언트 회사명 + 대행사 계층 — 발행 선택을 업체/대행사/하부업체로 가르는 근거.
        // 이름표만 필요하다 — clients 전체(*) 107 KB 를 8초마다 받던 걸 4개 컬럼(15 KB)으로 줄였다.
        void getClientLabels().then(({ data }) => {
            const m: Record<string, { company: string; isAgency: boolean; agencyId: string | null }> = {};
            for (const c of data) m[c.id] = { company: c.company || '', isAgency: !!c.is_agency, agencyId: c.parent_client_id };
            setClientInfo(m);
        });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => { reload(); }, []);
    // 20초 갱신 — 화면에 보일 때만. 8초 폴링 × 무거운 조회가 Egress 를 하루 1 GB 넘게 태웠다(실측 2026-08-14).
    useVisiblePolling(reload, 20000);
    // '발행하러 가기'로 넘어온 경우 URL의 client 를 선택(마지막 선택 localStorage 보다 우선).
    useEffect(() => {
        const q = new URLSearchParams(window.location.search).get('client');
        if (q) setSel(q);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    if (loading) {
        return <div className="rounded-xl border border-[#e2e8f0] bg-white px-6 py-16 text-center text-sm text-[#94a3b8]">불러오는 중…</div>;
    }
    if (!accts.length) {
        return (
            <div className="rounded-xl border border-dashed border-[#cbd5e1] bg-[#f8fafc] px-6 py-16 text-center">
                <div className="text-base font-semibold text-[#475569]">발행할 고객사가 없습니다</div>
                <p className="mx-auto mt-2 max-w-md text-sm text-[#94a3b8]">
                    카페 접수 관리에서 <b>승인 → 토큰 발행</b> 하면 그 고객사가 여기에 나타납니다.
                </p>
            </div>
        );
    }

    return (
        <div className="grid gap-4">
            {/* 고객사 선택 */}
            <div className="rounded-xl border border-[#e2e8f0] bg-white p-4">
                <div className="mb-2 flex items-center gap-2">
                    <div className="text-[14px] font-bold text-[#0f172a]">발행할 고객사 선택</div>
                    <button type="button" onClick={reload} className="ml-auto rounded-md border border-[#cbd5e1] px-2.5 py-1 text-xs font-semibold text-[#475569] hover:bg-[#f1f5f9]">새로고침</button>
                </div>
                {(() => {
                    // ── 자체 카페는 따로 뺀다(SUB2 요청 2026-08-20) ─────────────────
                    //   우리 콘텐츠용 카페는 토큰을 안 쓴다. 고객 대신발행과 한 목록에 섞이면
                    //   '잔여 토큰 0건'이 빨갛게 떠서 문제처럼 보이고, 매번 다시 짚어야 한다.
                    const own = accts.filter((a) => a.is_own);
                    const client = accts.filter((a) => !a.is_own);

                    // ── 4단 구분(요청 2026-08-20) ────────────────────────────────
                    //   업체 발행(직거래) / 대행사 업체 / 하부 업체 / 자체 발행.
                    //   판정 근거는 clients 두 컬럼뿐이다 — is_agency, parent_client_id.
                    //   ⚠️ 컬럼 없는 DB 로 폴백되면 둘 다 null 이라 전부 '업체 발행'으로 모인다.
                    //      섹션이 어긋나는 편이 낫다 — 카드가 사라지면 그 업체는 발행 자체를 못 한다.
                    const info = (a: CafeAccount) => clientInfo[a.client_id!];
                    const agency = client.filter((a) => info(a)?.isAgency);
                    const sub = client.filter((a) => !info(a)?.isAgency && info(a)?.agencyId);
                    const direct = client.filter((a) => !info(a)?.isAgency && !info(a)?.agencyId);
                    // 하부 업체 카드에 붙일 소속 대행사 이름 — 대행사가 카페 계정이 없어도 clients 이름표엔 있다.
                    const agencyName = (a: CafeAccount) => {
                        const pid = info(a)?.agencyId;
                        return pid ? (clientInfo[pid]?.company || '') : '';
                    };
                    const btn = (a: CafeAccount, showBiz: boolean, agencyLabel?: string) => {
                        const reserved = reservedById[a.client_id!] ?? 0;   // 발행요청 미완료 = 즉시 차감
                        const bal = Math.max(0, (balById[a.client_id!] ?? 0) - reserved);
                        const active = sel === a.client_id;
                        const bizName = clientInfo[a.client_id!]?.company || a.display_name || a.company_key;
                        // 다른 업체 스캔이 도는 중에도 이 업체 스캔을 새로 걸 수 있다(워커 슬롯 2개 · 2026-08-18).
                        //   어느 업체가 도는지 보이게 배지로 표시한다 — 이 브라우저에서 건 스캔 기준(localStorage).
                        const scanning = (loadPendingScan(a.client_id!)?.ids.length ?? 0) > 0;
                        // 자체 카페는 청록, 고객은 보라 — 어느 쪽을 고르고 있는지 색으로 바로 보이게.
                        const accent = a.is_own
                            ? { on: 'border-[#0d9488] bg-[#f0fdfa]', txt: 'text-[#0f766e]' }
                            : { on: 'border-[#7c3aed] bg-[#f5f3ff]', txt: 'text-[#6d28d9]' };
                        return (
                            <button key={a.id} type="button" onClick={() => setSel(a.client_id!)}
                                className={`min-w-[160px] rounded-lg border px-3 py-2 text-left text-sm ${active ? accent.on : 'border-[#e2e8f0] bg-white hover:bg-[#f8fafc]'}`}>
                                <div className="flex items-start gap-2">
                                    <div className={`font-bold ${active ? accent.txt : 'text-[#334155]'}`}>{showBiz ? bizName : (a.display_name || bizName)}</div>
                                    {/* 소속 대행사 — 하부 업체 카드에만. 대행사마다 같은 업종 업체가 있어 이게 없으면 구별이 안 된다. */}
                                    {agencyLabel ? (
                                        <span className="ml-auto shrink-0 rounded bg-[#ede9fe] px-1.5 py-0.5 text-[10px] font-bold text-[#6d28d9]" title={`소속 대행사: ${agencyLabel}`}>{agencyLabel}</span>
                                    ) : null}
                                </div>
                                {a.display_name && a.display_name !== bizName ? <div className="truncate text-[11px] text-[#94a3b8]" title={a.display_name}>{a.display_name}</div> : null}
                                {/* 자체 카페는 토큰을 안 쓴다 — '잔여 0건'을 빨갛게 띄우면 매번 문제로 오해한다. */}
                                {a.is_own ? (
                                    <div className="text-[12px] text-[#0d9488]">자체 콘텐츠{reserved ? <span className="text-[#b45309]"> · 발행중 {reserved}</span> : null}</div>
                                ) : (
                                    <div className={`text-[12px] ${bal > 0 ? 'text-[#059669]' : 'text-[#dc2626]'}`}>잔여 토큰 {bal}건{reserved ? <span className="text-[#b45309]"> · 발행중 {reserved}</span> : null}</div>
                                )}
                                {/* 카페 URL 이 아직 없는 계정 — 이 상태로 발행하면 어디로 나갈지 알 수 없다.
                                    club_id 기본값이 예전엔 마이클 카페였어서 '조용히 남의 카페로' 묶이는 사고가 가능했다(2026-08-20 제거).
                                    지금은 빈 값이라 안전하지만, 비어 있다는 사실 자체가 보여야 설정을 채우게 된다. */}
                                {!a.club_id ? (
                                    <div className="mt-0.5 text-[11px] font-bold text-[#b45309]">⚠ 카페 URL 미등록 — 선택 후 아래에서 설정</div>
                                ) : null}
                                {scanning ? <div className="mt-0.5 text-[11px] font-bold text-[#7c3aed]">🔎 인기탭 스캔중</div> : null}
                            </button>
                        );
                    };
                    return (
                        <div className="grid gap-3">
                            {/* ── ① 업체 발행 ── 대행사를 끼지 않은 직거래(설고점·더맨시스템·더티클리닉 …) */}
                            {direct.length ? (
                                <div>
                                    <div className="mb-1.5 text-[12px] font-bold text-[#334155]">
                                        🏢 업체 발행 <span className="font-normal text-[#94a3b8]">— 직거래 {direct.length}곳</span>
                                    </div>
                                    <div className="flex flex-wrap gap-2">{direct.map((a) => btn(a, false))}</div>
                                </div>
                            ) : null}
                            {/* ── ② 대행사 업체 ── clients.is_agency */}
                            {agency.length ? (
                                <div className="border-t border-dashed border-[#cbd5e1] pt-3">
                                    <div className="mb-1.5 text-[12px] font-bold text-[#6d28d9]">
                                        🏬 대행사 업체 <span className="font-normal text-[#94a3b8]">— {agency.length}곳</span>
                                    </div>
                                    <div className="flex flex-wrap gap-2">{agency.map((a) => btn(a, false))}</div>
                                </div>
                            ) : null}
                            {/* ── ③ 하부 업체 ── 대행사에 속한 업체. 카드마다 소속 대행사를 우측 상단에 적는다.
                                   비어 있어도 대행사가 있으면 자리를 남긴다 — 섹션이 통째로 사라지면
                                   '안 만들어졌다'로 보이고, 정작 손봐야 할 곳(조직도 연결)이 안 보인다. */}
                            {sub.length || agency.length ? (
                                <div className="border-t border-dashed border-[#cbd5e1] pt-3">
                                    <div className="mb-1.5 text-[12px] font-bold text-[#6d28d9]">
                                        🔗 하부 업체 <span className="font-normal text-[#94a3b8]">
                                            {sub.length ? `— ${sub.length}곳 · 우측이 소속 대행사` : '— 아직 없음'}
                                        </span>
                                    </div>
                                    {sub.length ? (
                                        <div className="flex flex-wrap gap-2">{sub.map((a) => btn(a, false, agencyName(a)))}</div>
                                    ) : (
                                        <div className="rounded-lg border border-dashed border-[#e2e8f0] bg-[#f8fafc] px-3 py-2 text-[11px] text-[#94a3b8]">
                                            조직도에서 대행사 아래로 연결하고 토큰을 발행하면 여기에 나타납니다.
                                        </div>
                                    )}
                                </div>
                            ) : null}
                            {/* ── ④ 자체 발행 ── 우리 카페. 토큰을 안 쓴다. */}
                            {own.length ? (
                                <div className="border-t border-dashed border-[#cbd5e1] pt-3">
                                    <div className="mb-1.5 text-[12px] font-bold text-[#0f766e]">
                                        🏠 자체 발행 <span className="font-normal text-[#94a3b8]">— 우리 카페 {own.length}개 · 토큰 차감 없음</span>
                                    </div>
                                    <div className="flex flex-wrap gap-2">{own.map((a) => btn(a, false))}</div>
                                </div>
                            ) : null}
                        </div>
                    );
                })()}
            </div>

            {/* 선택 고객사 발행 스튜디오 — key=client 로 업체 전환 시 전체 remount(이전 업체 값·키워드·계정 누출 방지) */}
            {sel ? (
                <CafeCustomerStudio key={sel} clientId={sel} />
            ) : (
                <div className="rounded-xl border border-dashed border-[#cbd5e1] bg-[#f8fafc] px-6 py-12 text-center text-sm text-[#94a3b8]">
                    위에서 발행할 고객사를 선택하세요.
                </div>
            )}
        </div>
    );
}
