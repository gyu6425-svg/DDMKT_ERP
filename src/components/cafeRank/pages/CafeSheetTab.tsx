import { useEffect, useMemo, useState } from 'react';
import {
    getCafeAccounts,
    setCafeAccountActive,
    updateCafeAccount,
    upsertCafeAccount,
    type CafeAccount,
} from '../../../api/cafeAccounts';
import { getCafeRankPosts, cafeTiStatus, type CafeRankPost } from '../../../api/cafeRank';
import { listPendingCafeRequests, setCafeRequestStatus, type CafeRequest } from '../../../api/cafeRequests';
import { cafeCompanyRank, cafeNameLabel, cafeNameRank } from '../../../lib/cafeAccounts';
import { DeployPublishSetupModal } from '../../cafe/DeployPublishSetupModal';

// 카페 관리시트 — 브랜드블로그 관리시트와 동일한 행 테이블 구조.
//   업체(게시판)별로 계약금액·계약일·담당·진행률·잔여·추적글·인기글 진입·상태·순위 를 한 줄에.

function goTracker(companyKey: string) {
    const u = new URL(window.location.href);
    u.searchParams.set('tab', 'tracker');
    u.searchParams.delete('q');
    u.searchParams.set('company', companyKey);
    window.history.pushState(null, '', u.pathname + u.search);
    window.dispatchEvent(new Event('app:navigate'));
}

const EMPTY = { company_key: '', display_name: '', board_name: '', board_short: '' };
// 자사(우리 회사) 운영 카페 — 계약/진행률 개념이 없어 관리시트에서 진행률 UI를 숨긴다.
const OWN_COMPANY_KEYS = new Set(['nusu']);
const OWN_COMPANY_NAMES = new Set(['누수상담소']);

export function CafeSheetTab({
    scopeCompanyKey = null,
    scopeClientId = null,
    readOnly = false,
}: { scopeCompanyKey?: string | string[] | null; scopeClientId?: string | null; readOnly?: boolean } = {}) {
    // scopeCompanyKey: 고객 뷰 — 이 업체만. scopeClientId: 내부 관리 스코프(누수탐지) — 이 client 계정만·등록 시 client_id 자동.
    // readOnly: 입력·등록·토글 숨기고 텍스트로 표시.
    const [accounts, setAccounts] = useState<CafeAccount[]>([]);
    const [setupAccount, setSetupAccount] = useState<CafeAccount | null>(null); // 발행 세팅 모달 대상
    const [posts, setPosts] = useState<CafeRankPost[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [showAdd, setShowAdd] = useState(false);
    const [form, setForm] = useState(EMPTY);
    const [busy, setBusy] = useState(false);
    const [reqs, setReqs] = useState<CafeRequest[]>([]);   // 고객 발행 신청(대기) — 내부만
    const [linkedReq, setLinkedReq] = useState<{ id: string; client_id: string; cafe_url: string | null } | null>(null); // 신청→등록 연결
    const [q, setQ] = useState('');   // 업체명 검색(업체명·게시판명·업체키·카페주소)

    const reload = async () => {
        setLoading(true);
        const [acc, rp] = await Promise.all([getCafeAccounts(), getCafeRankPosts()]);
        setAccounts(acc.data);
        setPosts(rp.data);
        setError(acc.error ? 'cafe_accounts가 없습니다. docs/cafe-accounts.sql 실행 필요.' : '');
        setLoading(false);
        if (!readOnly) {
            const { data } = await listPendingCafeRequests();   // 테이블 없으면 빈 배열
            setReqs(data);
        }
    };
    useEffect(() => { void reload(); }, []);

    // 신청 처리(완료/거절) — 계정 등록·승인은 아래 '업체 등록' + '발행 승인' 토글로 하고, 여기서 상태만 정리.
    const handleReq = async (id: string, status: 'done' | 'rejected') => {
        const { error } = await setCafeRequestStatus(id, status);
        if (error) { setError(error.message); return; }
        setReqs((prev) => prev.filter((r) => r.id !== id));
    };
    const prefillFromReq = (r: CafeRequest) => {
        setLinkedReq({ id: r.id, client_id: r.client_id, cafe_url: r.cafe_url });
        // ★ 업체 키를 빈칸으로 두면 담당자가 그때그때 지어낸다 — 화면에 보이던 라벨('자체 발행')이
        //   그대로 들어가 새 행이 생긴 사고가 있었다(2026-08-20). 이미 있는 계정의 키를 그대로 채운다.
        const mine = accounts.filter((a) => a.client_id === r.client_id);
        const base = mine.length === 1 ? mine[0] : null;
        setForm({
            company_key: base?.company_key || '',
            display_name: r.cafe_name || r.business || base?.display_name || '',
            board_name: r.board_name || base?.board_name || '',
            board_short: r.board_name || base?.board_short || '',
        });
        setShowAdd(true);
    };

    // 업체(계정)별 추적 글 수 · 인기글 진입 수 — cafe_account_id 우선, 없으면 board_short 매칭.
    const statByAccount = useMemo(() => {
        const m = new Map<string, { total: number; ranked: number; achieved: number }>();
        for (const a of accounts) m.set(a.id, { total: 0, ranked: 0, achieved: 0 });
        for (const p of posts) {
            let acc = accounts.find((a) => a.id === p.cafe_account_id);
            if (!acc) acc = accounts.find((a) => a.board_short === (p.board || ''));
            if (!acc) continue;
            const s = m.get(acc.id)!;
            s.total += 1;
            const last = p.measurements?.[p.measurements.length - 1];
            if (last && cafeTiStatus(last.ti_status) === 'ranked') s.ranked += 1;
            // 5위 24h 유지 달성(자동) — 수동 베이스라인에 없던 글만(seeded=false).
            if (p.top5_achieved_at && !p.top5_seeded) s.achieved += 1;
        }
        return m;
    }, [accounts, posts]);

    // 카페 순서 → 업체 순서로 정렬한 평평한 행(블로그 시트처럼). scopeCompanyKey면 그 업체만.
    //   자체 카페가 있는 업체(더맨·설고 등)는 마이클 공유카페(ddmkt2) 행을 관리시트에서 숨기고
    //   마지막 등록(자체 카페)만 보여준다. 순위 트래커(CafeTrackerTab)는 별도라 두 카페 모두 유지.
    const clientsWithOwnCafe = useMemo(
        () => new Set(accounts.filter((a) => a.cafe_name !== 'ddmkt2' && a.client_id).map((a) => a.client_id)),
        [accounts],
    );
    // 업체명 검색 — 업체명·게시판명(짧은/전체)·업체키·카페 주소를 모두 본다(대소문자 무시).
    //   업체가 늘면서 눈으로 훑기 어려워져 추가. 검색은 화면 필터일 뿐 데이터는 그대로다.
    const rows = useMemo(
        () => accounts
            .filter((a) => !scopeCompanyKey || (Array.isArray(scopeCompanyKey) ? scopeCompanyKey.includes(a.company_key) : a.company_key === scopeCompanyKey))
            .filter((a) => !scopeClientId || a.client_id === scopeClientId)
            .filter((a) => !(a.cafe_name === 'ddmkt2' && a.client_id && clientsWithOwnCafe.has(a.client_id)))
            .filter((a) => {
                const s = q.trim().toLowerCase();
                if (!s) return true;
                return [a.display_name, a.board_short, a.board_name, a.company_key, a.cafe_name, cafeNameLabel(a.cafe_name)]
                    .some((v) => (v || '').toLowerCase().includes(s));
            })
            .sort(
                (a, b) => cafeNameRank(a.cafe_name) - cafeNameRank(b.cafe_name)
                    || cafeCompanyRank(a.company_key) - cafeCompanyRank(b.company_key)
                    || a.display_name.localeCompare(b.display_name),
            ),
        [accounts, scopeCompanyKey, scopeClientId, clientsWithOwnCafe, q],
    );

    // 숨긴 마이클(ddmkt2) 카페의 실적을 같은 업체(client)의 자체 카페 행에 합산 — 회사 총 실적 표시.
    //   (마이클 카페의 24h 달성분이 관리시트에서 사라지지 않도록. 순위 트래커는 두 카페 각각 표시.)
    const hiddenStatByClient = useMemo(() => {
        const m = new Map<string, { total: number; ranked: number; achieved: number; doneBase: number }>();
        for (const a of accounts) {
            if (a.cafe_name === 'ddmkt2' && a.client_id && clientsWithOwnCafe.has(a.client_id)) {
                const s = statByAccount.get(a.id) || { total: 0, ranked: 0, achieved: 0 };
                const cur = m.get(a.client_id) || { total: 0, ranked: 0, achieved: 0, doneBase: 0 };
                // 마이클(ddmkt2) 계정의 수동 베이스라인(done_count '이전건')도 자체 카페 행에 합산.
                m.set(a.client_id, { total: cur.total + s.total, ranked: cur.ranked + s.ranked, achieved: cur.achieved + s.achieved, doneBase: cur.doneBase + (a.done_count || 0) });
            }
        }
        return m;
    }, [accounts, clientsWithOwnCafe, statByAccount]);
    // 합산 귀속 대상 = 업체별 첫 자체행(중복 합산 방지).
    // 계약 목표건수(goal_count)는 같은 업체(client)의 계정 중 아무 곳에 있어도 그 업체 행에 적용.
    //   (계약은 마이클 ddmkt2 계정에 있는데 관리시트는 자체 카페 행을 보여줘 goal 이 '—' 로 비던 문제 해결.)
    const goalByClient = useMemo(() => {
        const m = new Map<string, number>();
        for (const a of accounts) {
            if (a.client_id && a.goal_count != null) m.set(a.client_id, Math.max(m.get(a.client_id) || 0, a.goal_count));
        }
        return m;
    }, [accounts]);
    const firstRowIdOfClient = useMemo(() => {
        const m = new Map<string, string>();
        for (const a of rows) if (a.client_id && !m.has(a.client_id)) m.set(a.client_id, a.id);
        return m;
    }, [rows]);

    const patchLocal = (id: string, patch: Partial<CafeAccount>) =>
        setAccounts((prev) => prev.map((x) => (x.id === id ? { ...x, ...patch } : x)));

    const saveField = async (id: string, patch: Partial<CafeAccount>) => {
        patchLocal(id, patch);
        const { error } = await updateCafeAccount(id, patch);
        if (error) setError(error.message);
    };

    const save = async () => {
        if (!form.company_key.trim() || !form.display_name.trim()) return;
        setBusy(true);
        // 신청에서 온 등록이면 그 고객 client_id 를 연결(안 하면 고객이 자기 카페를 못 본다) + URL 에서 club_id 추출.
        const club = linkedReq?.cafe_url ? (linkedReq.cafe_url.match(/cafes\/(\d+)|clubid=(\d+)|\/(\d{6,})/) || [])[0]?.replace(/\D/g, '') : '';
        const result = await upsertCafeAccount({
            ...form,
            board_name: form.board_name || form.display_name,
            board_short: form.board_short || form.display_name,
            client_id: linkedReq?.client_id || scopeClientId || undefined,
            club_id: club || undefined,
        });
        setBusy(false);
        if (result.error) return setError(result.error.message);
        // 신청 처리완료 표시.
        if (linkedReq) {
            await setCafeRequestStatus(linkedReq.id, 'done');
            setReqs((prev) => prev.filter((r) => r.id !== linkedReq.id));
            setLinkedReq(null);
        }
        setForm(EMPTY);
        setShowAdd(false);
        void reload();
    };

    const toggle = async (a: CafeAccount) => {
        patchLocal(a.id, { active: !a.active });
        const result = await setCafeAccountActive(a.id, !a.active);
        if (result.error) setError(result.error.message);
    };

    return (
        <div className="grid gap-3">
            <div className="flex flex-wrap items-center gap-2">
                <div>
                    <h2 className="m-0 text-base font-bold text-[#0f172a]">카페 관리시트</h2>
                    <p className="m-0 mt-0.5 text-xs text-[#64748b]">카페별 업체(게시판)의 계약·발행 진행·순위를 한눈에. (브랜드블로그 관리시트와 동일 구조)</p>
                </div>
                <input
                    className="ml-auto h-9 w-[220px] rounded-md border border-[#cbd5e1] bg-white px-3 text-sm"
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="업체명 검색..."
                    value={q}
                />
                {q ? (
                    <button className="h-9 rounded-md border border-[#cbd5e1] bg-white px-2 text-xs text-[#64748b]" onClick={() => setQ('')} type="button">✕</button>
                ) : null}
                <span className="text-xs text-[#64748b]">업체 {rows.length}</span>
                <button className="h-9 rounded-md border border-[#cbd5e1] bg-white px-3 text-xs font-semibold text-[#475569]" onClick={() => void reload()} type="button">새로고침</button>
                {!readOnly ? (
                    <button className="h-9 rounded-md bg-[#1e40af] px-3 text-xs font-semibold text-white" onClick={() => setShowAdd((v) => !v)} type="button">업체 등록</button>
                ) : null}
            </div>

            {showAdd && !readOnly ? (
                <div className="grid gap-2 rounded-md border border-[#bfdbfe] bg-[#eff6ff] p-3 md:grid-cols-2">
                    {/* 무엇이 바뀔지 누르기 전에 보여준다 — '갱신인 줄 알았는데 새 행' 이 이 화면의 사고였다. */}
                    {(() => {
                        const cid = linkedReq?.client_id || scopeClientId;
                        if (!cid) return null;
                        const mine = accounts.filter((a) => a.client_id === cid);
                        const hit = mine.find((a) => a.company_key === form.company_key.trim()) ?? (mine.length === 1 ? mine[0] : null);
                        return hit ? (
                            <div className="md:col-span-2 rounded border border-[#a7f3d0] bg-[#ecfdf5] px-2 py-1 text-[11px] font-semibold text-[#047857]">
                                ↻ 기존 업체 <b>{hit.display_name || hit.company_key}</b>(<code>{hit.company_key}</code>) 를 갱신합니다 · 빈 칸은 기존 값 유지
                            </div>
                        ) : (
                            <div className="md:col-span-2 rounded border border-[#fde68a] bg-[#fffbeb] px-2 py-1 text-[11px] font-semibold text-[#92400e]">
                                ＋ <b>새 업체</b>로 등록됩니다{mine.length ? ` — 이 고객에 이미 카페 계정 ${mine.length}개가 있습니다` : ''}
                            </div>
                        );
                    })()}
                    <input className="h-9 rounded border border-[#cbd5e1] px-3 text-sm" placeholder="업체 키 (예: dirty · 영문·숫자·_)" value={form.company_key} onChange={(e) => setForm({ ...form, company_key: e.target.value })} />
                    <input className="h-9 rounded border border-[#cbd5e1] px-3 text-sm" placeholder="업체명 (예: 더티클리닉)" value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} />
                    <input className="h-9 rounded border border-[#cbd5e1] px-3 text-sm" placeholder="전체 게시판명" value={form.board_name} onChange={(e) => setForm({ ...form, board_name: e.target.value })} />
                    <input className="h-9 rounded border border-[#cbd5e1] px-3 text-sm" placeholder="표시 탭명" value={form.board_short} onChange={(e) => setForm({ ...form, board_short: e.target.value })} />
                    <div className="flex gap-2 md:col-span-2">
                        <button className="rounded bg-[#059669] px-4 py-2 text-xs font-bold text-white disabled:opacity-50" disabled={busy || !form.company_key.trim() || !form.display_name.trim()} onClick={() => void save()} type="button">{busy ? '등록 중…' : '등록'}</button>
                        <button className="rounded border border-[#cbd5e1] px-4 py-2 text-xs font-semibold text-[#64748b]" onClick={() => setShowAdd(false)} type="button">취소</button>
                    </div>
                </div>
            ) : null}

            {error ? <div className="rounded-md bg-[#fef2f2] px-3 py-2 text-sm text-[#b91c1c]">{error}</div> : null}

            {!readOnly && reqs.length ? (
                <div className="rounded-md border-2 border-[#f59e0b] bg-[#fffbeb] p-3">
                    <div className="mb-2 text-[13px] font-bold text-[#92400e]">카페 발행 신청 (대기 {reqs.length})</div>
                    <div className="grid gap-2">
                        {reqs.map((r) => (
                            <div className="flex flex-wrap items-center gap-2 rounded border border-[#fde68a] bg-white px-3 py-2 text-[12px]" key={r.id}>
                                <div className="min-w-0 flex-1">
                                    <div className="font-semibold text-[#334155]">{r.cafe_name || '(카페명 미기재)'}{r.business ? ` · ${r.business}` : ''}</div>
                                    <div className="text-[#64748b]">게시판: {r.board_name || '—'} · {r.cafe_url || '주소 미기재'}</div>
                                    {r.note ? <div className="text-[#94a3b8]">메모: {r.note}</div> : null}
                                    <div className="text-[10px] text-[#cbd5e1]">client {r.client_id.slice(0, 8)} · {new Date(r.created_at).toLocaleString('ko-KR')}</div>
                                </div>
                                <button className="rounded bg-[#0369a1] px-2 py-1 text-[11px] font-bold text-white" onClick={() => prefillFromReq(r)} type="button">이 정보로 등록</button>
                                <button className="rounded bg-[#059669] px-2 py-1 text-[11px] font-bold text-white" onClick={() => void handleReq(r.id, 'done')} type="button">처리완료</button>
                                <button className="rounded border border-[#cbd5e1] px-2 py-1 text-[11px] font-semibold text-[#64748b]" onClick={() => void handleReq(r.id, 'rejected')} type="button">거절</button>
                            </div>
                        ))}
                    </div>
                    <p className="m-0 mt-2 text-[11px] text-[#92400e]">"이 정보로 등록" → 업체 등록 폼에 채워짐 → company_key·client 연결해 등록 → 그 행 "발행 승인" 켜기 → "처리완료".</p>
                </div>
            ) : null}

            <div className="overflow-x-auto rounded-md border border-[#e2e8f0] bg-white">
                <table className="w-full border-collapse text-left text-sm">
                    <thead>
                        <tr className="border-b-2 border-[#e2e8f0] bg-[#f1f5f9] text-[11px] text-[#64748b]">
                            <th className="px-3 py-2 font-semibold">업체</th>
                            <th className="px-3 py-2 font-semibold">카페</th>
                            <th className="px-3 py-2 font-semibold">계약일</th>
                            <th className="px-3 py-2 font-semibold">진행률</th>
                            <th className="px-2 py-2 text-center font-semibold">잔여</th>
                            <th className="px-2 py-2 text-center font-semibold">추적 글</th>
                            <th className="px-2 py-2 text-center font-semibold">인기글 진입</th>
                            <th className="px-2 py-2 text-center font-semibold">상태</th>
                            {!readOnly ? <th className="px-2 py-2 text-center font-semibold">순위</th> : null}
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr><td className="px-3 py-10 text-center text-[#94a3b8]" colSpan={readOnly ? 8 : 9}>불러오는 중…</td></tr>
                        ) : rows.length ? rows.map((a) => {
                            const own = statByAccount.get(a.id) || { total: 0, ranked: 0, achieved: 0 };
                            const merged = (a.client_id && firstRowIdOfClient.get(a.client_id) === a.id)
                                ? (hiddenStatByClient.get(a.client_id) || { total: 0, ranked: 0, achieved: 0, doneBase: 0 })
                                : { total: 0, ranked: 0, achieved: 0, doneBase: 0 };
                            const st = { total: own.total + merged.total, ranked: own.ranked + merged.ranked, achieved: own.achieved + merged.achieved };
                            const base = (a.done_count || 0) + merged.doneBase;   // 수동 베이스라인(자체+마이클 이전건)
                            const done = base + st.achieved;  // 실적 = 베이스라인 + 자동 달성(5위 24h)
                            const goal = a.goal_count || (a.client_id ? goalByClient.get(a.client_id) || 0 : 0);
                            const pct = goal ? Math.min(100, Math.round((done / goal) * 100)) : 0;
                            const pc = !goal ? '#cbd5e1' : pct >= 70 ? '#059669' : pct >= 40 ? '#d97706' : '#dc2626';
                            const remain = goal ? Math.max(0, goal - done) : null;
                            const isOwn = OWN_COMPANY_KEYS.has(a.company_key) || OWN_COMPANY_NAMES.has(a.board_short) || OWN_COMPANY_NAMES.has(a.display_name);
                            return (
                                <tr
                                    key={a.id}
                                    className={`border-b border-[#e2e8f0] ${readOnly ? '' : 'cursor-pointer hover:bg-[#f8fafc]'}`}
                                    onClick={(e) => {
                                        if (readOnly) return;
                                        if ((e.target as HTMLElement).closest('button, a, input, select, label')) return;
                                        goTracker(a.company_key);
                                    }}
                                    title={readOnly ? '' : '빈 곳 클릭 → 순위 트래커에서 이 업체만 보기'}
                                >
                                    <td className="px-3 py-2">
                                        <div className="font-semibold text-[#0f172a]">{a.display_name}</div>
                                        <span className="mt-0.5 inline-block rounded bg-[#f1f5f9] px-1.5 py-0.5 text-[10px] font-semibold text-[#475569]">{a.board_short}</span>
                                    </td>
                                    <td className="px-3 py-2">
                                        <a className="text-[13px] font-semibold text-[#475569] hover:text-[#1e40af] hover:underline" href={`https://cafe.naver.com/${a.cafe_name}`} rel="noreferrer" target="_blank">
                                            {cafeNameLabel(a.cafe_name)}
                                        </a>
                                        {!readOnly ? (
                                            <button
                                                className={`mt-1.5 block rounded px-2 py-1 text-[11px] font-bold ${a.publish_enabled ? 'bg-[#dcfce7] text-[#15803d] hover:bg-[#bbf7d0]' : 'bg-[#eef2ff] text-[#4338ca] hover:bg-[#e0e7ff]'}`}
                                                onClick={(e) => { e.stopPropagation(); setSetupAccount(a); }}
                                                title={a.publish_enabled ? '발행(자동발행) 중 · 클릭하면 세팅 변경' : '발행 세팅(글쓰기 주소·계정 확인·발행 승인)'}
                                                type="button"
                                            >
                                                {a.publish_enabled ? '● 발행 중' : '발행 세팅'}
                                            </button>
                                        ) : null}
                                    </td>
                                    <td className="px-3 py-2">
                                        {readOnly ? (
                                            <span className="text-[12px] text-[#334155]">{a.contract_date || '—'}</span>
                                        ) : (
                                            <input
                                                className="h-8 w-28 rounded border border-[#e2e8f0] px-1.5 text-[12px]"
                                                defaultValue={a.contract_date || ''}
                                                onBlur={(e) => void saveField(a.id, { contract_date: e.target.value || null })}
                                                onClick={(e) => e.stopPropagation()}
                                                placeholder="2026-07-10"
                                            />
                                        )}
                                    </td>
                                    <td className="px-3 py-2">
                                        {isOwn ? (
                                            <span className="text-[11px] text-[#94a3b8]">자사 운영</span>
                                        ) : (
                                            <div className="min-w-[120px]">
                                                <div className="flex items-baseline justify-between gap-2">
                                                    <span className="text-sm font-bold" style={{ color: pc }}>{goal ? `${pct}%` : '—'}</span>
                                                    <span className="text-[10px] text-[#94a3b8]">
                                                        {done}/{goal || '—'}건{st.achieved > 0 ? <span className="ml-0.5 font-bold text-[#059669]" title="자동 달성(5위 24h)">(+{st.achieved})</span> : null}
                                                    </span>
                                                </div>
                                                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[#eef2f7]">
                                                    <div style={{ background: pc, width: `${pct}%`, height: '100%' }} />
                                                </div>
                                            </div>
                                        )}
                                    </td>
                                    <td className="px-2 py-2 text-center text-[13px] font-semibold" style={{ color: remain === 0 ? '#059669' : '#475569' }}>
                                        {remain == null ? '—' : remain}
                                    </td>
                                    <td className="px-2 py-2 text-center text-[13px] font-semibold text-[#475569]">{st.total || '—'}</td>
                                    <td className="px-2 py-2 text-center text-[13px] font-bold text-[#059669]">{st.ranked || (st.total ? 0 : '—')}</td>
                                    <td className="px-2 py-2 text-center">
                                        {readOnly ? (
                                            <span className={`rounded px-2 py-1 text-[11px] font-bold ${a.active ? 'bg-[#dcfce7] text-[#15803d]' : 'bg-[#f1f5f9] text-[#64748b]'}`}>{a.active ? '진행 중' : '중지'}</span>
                                        ) : (
                                            <button className={`rounded px-2 py-1 text-[11px] font-bold ${a.active ? 'bg-[#dcfce7] text-[#15803d]' : 'bg-[#f1f5f9] text-[#64748b]'}`} onClick={(e) => { e.stopPropagation(); void toggle(a); }} type="button">{a.active ? '사용 중' : '중지'}</button>
                                        )}
                                    </td>
                                    {!readOnly ? (
                                        <td className="px-2 py-2 text-center">
                                            <button className="rounded bg-[#1e40af] px-3 py-1 text-[11px] font-bold text-white" onClick={(e) => { e.stopPropagation(); goTracker(a.company_key); }} type="button">순위 보기</button>
                                        </td>
                                    ) : null}
                                </tr>
                            );
                        }) : <tr><td className="px-3 py-10 text-center text-[#94a3b8]" colSpan={readOnly ? 8 : 9}>등록된 카페 업체가 없습니다.</td></tr>}
                    </tbody>
                </table>
            </div>
            <p className="m-0 text-[11px] text-[#94a3b8]">
                ※ 계약금액·건수·계약일·담당은 칸에 바로 입력하면 저장됩니다. 진행률 = 발행완료 / 목표건수. 추적 글·인기글 진입은 순위 트래커 데이터 기준.
            </p>
            {setupAccount ? (
                <DeployPublishSetupModal account={setupAccount} onClose={() => setSetupAccount(null)} onSaved={() => void reload()} />
            ) : null}
        </div>
    );
}
