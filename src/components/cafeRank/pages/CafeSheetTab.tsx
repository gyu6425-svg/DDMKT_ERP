import { useEffect, useMemo, useState } from 'react';
import {
    getCafeAccounts,
    setCafeAccountActive,
    updateCafeAccount,
    upsertCafeAccount,
    type CafeAccount,
} from '../../../api/cafeAccounts';
import { getCafeRankPosts, type CafeRankPost } from '../../../api/cafeRank';
import { cafeCompanyRank, cafeNameLabel, cafeNameRank } from '../../../lib/cafeAccounts';

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

const fmtWon = (n?: number | null) => (n ? n.toLocaleString('ko-KR') : '');
const onlyDigits = (s: string) => (s || '').replace(/[^\d]/g, '');
const EMPTY = { company_key: '', display_name: '', board_name: '', board_short: '' };

export function CafeSheetTab() {
    const [accounts, setAccounts] = useState<CafeAccount[]>([]);
    const [posts, setPosts] = useState<CafeRankPost[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [showAdd, setShowAdd] = useState(false);
    const [form, setForm] = useState(EMPTY);
    const [busy, setBusy] = useState(false);

    const reload = async () => {
        setLoading(true);
        const [acc, rp] = await Promise.all([getCafeAccounts(), getCafeRankPosts()]);
        setAccounts(acc.data);
        setPosts(rp.data);
        setError(acc.error ? 'cafe_accounts가 없습니다. docs/cafe-accounts.sql 실행 필요.' : '');
        setLoading(false);
    };
    useEffect(() => { void reload(); }, []);

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
            if (last?.ti_status === 'ok') s.ranked += 1;
            // 5위 24h 유지 달성(자동) — 수동 베이스라인에 없던 글만(seeded=false).
            if (p.top5_achieved_at && !p.top5_seeded) s.achieved += 1;
        }
        return m;
    }, [accounts, posts]);

    // 카페 순서 → 업체 순서로 정렬한 평평한 행(블로그 시트처럼).
    const rows = useMemo(
        () => [...accounts].sort(
            (a, b) => cafeNameRank(a.cafe_name) - cafeNameRank(b.cafe_name)
                || cafeCompanyRank(a.company_key) - cafeCompanyRank(b.company_key)
                || a.display_name.localeCompare(b.display_name),
        ),
        [accounts],
    );

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
        const result = await upsertCafeAccount({
            ...form,
            board_name: form.board_name || form.display_name,
            board_short: form.board_short || form.display_name,
        });
        setBusy(false);
        if (result.error) return setError(result.error.message);
        setForm(EMPTY);
        setShowAdd(false);
        void reload();
    };

    const toggle = async (a: CafeAccount) => {
        patchLocal(a.id, { active: !a.active });
        const result = await setCafeAccountActive(a.id, !a.active);
        if (result.error) setError(result.error.message);
    };

    const numCell = (a: CafeAccount, key: 'goal_count' | 'done_count' | 'amount', ph: string, w: string) => (
        <input
            className={`h-8 ${w} rounded border border-[#e2e8f0] px-1.5 text-right text-[12px]`}
            defaultValue={a[key] != null ? fmtWon(a[key]) : ''}
            onBlur={(e) => {
                const v = onlyDigits(e.target.value);
                // done_count 는 NOT NULL(기본 0) 컬럼 → 빈 칸은 null 대신 0으로(제약 위반 방지).
                const next = v ? Number(v) : key === 'done_count' ? 0 : null;
                void saveField(a.id, { [key]: next } as Partial<CafeAccount>);
            }}
            onClick={(e) => e.stopPropagation()}
            placeholder={ph}
        />
    );

    return (
        <div className="grid gap-3">
            <div className="flex flex-wrap items-center gap-2">
                <div>
                    <h2 className="m-0 text-base font-bold text-[#0f172a]">카페 관리시트</h2>
                    <p className="m-0 mt-0.5 text-xs text-[#64748b]">카페별 업체(게시판)의 계약·발행 진행·순위를 한눈에. (브랜드블로그 관리시트와 동일 구조)</p>
                </div>
                <span className="ml-auto text-xs text-[#64748b]">업체 {accounts.length}</span>
                <button className="h-9 rounded-md border border-[#cbd5e1] bg-white px-3 text-xs font-semibold text-[#475569]" onClick={() => void reload()} type="button">새로고침</button>
                <button className="h-9 rounded-md bg-[#1e40af] px-3 text-xs font-semibold text-white" onClick={() => setShowAdd((v) => !v)} type="button">업체 등록</button>
            </div>

            {showAdd ? (
                <div className="grid gap-2 rounded-md border border-[#bfdbfe] bg-[#eff6ff] p-3 md:grid-cols-2">
                    <input className="h-9 rounded border border-[#cbd5e1] px-3 text-sm" placeholder="업체 키 (예: dirty)" value={form.company_key} onChange={(e) => setForm({ ...form, company_key: e.target.value })} />
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

            <div className="overflow-x-auto rounded-md border border-[#e2e8f0] bg-white">
                <table className="w-full border-collapse text-left text-sm">
                    <thead>
                        <tr className="border-b-2 border-[#e2e8f0] bg-[#f1f5f9] text-[11px] text-[#64748b]">
                            <th className="px-3 py-2 font-semibold">업체</th>
                            <th className="px-3 py-2 font-semibold">카페</th>
                            <th className="px-3 py-2 font-semibold">계약일</th>
                            <th className="px-3 py-2 font-semibold">담당</th>
                            <th className="px-3 py-2 font-semibold">진행률</th>
                            <th className="px-2 py-2 text-center font-semibold">잔여</th>
                            <th className="px-2 py-2 text-center font-semibold">추적 글</th>
                            <th className="px-2 py-2 text-center font-semibold">인기글 진입</th>
                            <th className="px-2 py-2 text-center font-semibold">상태</th>
                            <th className="px-2 py-2 text-center font-semibold">순위</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr><td className="px-3 py-10 text-center text-[#94a3b8]" colSpan={10}>불러오는 중…</td></tr>
                        ) : rows.length ? rows.map((a) => {
                            const st = statByAccount.get(a.id) || { total: 0, ranked: 0, achieved: 0 };
                            const base = a.done_count || 0;   // 수동 베이스라인
                            const done = base + st.achieved;  // 실적 = 베이스라인 + 자동 달성(5위 24h)
                            const goal = a.goal_count || 0;
                            const pct = goal ? Math.min(100, Math.round((done / goal) * 100)) : 0;
                            const pc = !goal ? '#cbd5e1' : pct >= 70 ? '#059669' : pct >= 40 ? '#d97706' : '#dc2626';
                            const remain = goal ? Math.max(0, goal - done) : null;
                            return (
                                <tr
                                    key={a.id}
                                    className="cursor-pointer border-b border-[#e2e8f0] hover:bg-[#f8fafc]"
                                    onClick={(e) => {
                                        if ((e.target as HTMLElement).closest('button, a, input, select, label')) return;
                                        goTracker(a.company_key);
                                    }}
                                    title="빈 곳 클릭 → 순위 트래커에서 이 업체만 보기"
                                >
                                    <td className="px-3 py-2">
                                        <div className="font-semibold text-[#0f172a]">{a.display_name}</div>
                                        <span className="mt-0.5 inline-block rounded bg-[#f1f5f9] px-1.5 py-0.5 text-[10px] font-semibold text-[#475569]">{a.board_short}</span>
                                    </td>
                                    <td className="px-3 py-2">
                                        <a className="text-[12px] font-semibold text-[#475569] hover:text-[#1e40af] hover:underline" href={`https://cafe.naver.com/${a.cafe_name}`} rel="noreferrer" target="_blank">
                                            {cafeNameLabel(a.cafe_name)}
                                        </a>
                                        <div className="text-[10px] text-[#94a3b8]">{a.cafe_name}</div>
                                    </td>
                                    <td className="px-3 py-2">
                                        <input
                                            className="h-8 w-28 rounded border border-[#e2e8f0] px-1.5 text-[12px]"
                                            defaultValue={a.contract_date || ''}
                                            onBlur={(e) => void saveField(a.id, { contract_date: e.target.value || null })}
                                            onClick={(e) => e.stopPropagation()}
                                            placeholder="2026-07-10"
                                        />
                                    </td>
                                    <td className="px-3 py-2">
                                        <input
                                            className="h-8 w-16 rounded border border-[#e2e8f0] px-1.5 text-[12px]"
                                            defaultValue={a.manager || ''}
                                            onBlur={(e) => void saveField(a.id, { manager: e.target.value.trim() || null })}
                                            onClick={(e) => e.stopPropagation()}
                                            placeholder="담당"
                                        />
                                    </td>
                                    <td className="px-3 py-2">
                                        <div className="flex items-center gap-1.5 text-[12px]" title="실적 = 베이스라인(수동) + 자동달성(인기글 5위 24h 유지) / 목표">
                                            {numCell(a, 'done_count', '실적', 'w-12')}
                                            {st.achieved > 0 ? <span className="text-[10px] font-bold text-[#059669]" title="자동 달성(5위 24h)">+{st.achieved}</span> : null}
                                            <span className="text-[11px] text-[#94a3b8]">/</span>
                                            {numCell(a, 'goal_count', '목표', 'w-12')}
                                            <span className="ml-0.5 text-[11px] font-semibold text-[#475569]">= {done}</span>
                                        </div>
                                        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-[#f1f5f9]">
                                            <div className="h-full rounded-full" style={{ width: `${pct}%`, background: pc }} />
                                        </div>
                                    </td>
                                    <td className="px-2 py-2 text-center text-[13px] font-semibold" style={{ color: remain === 0 ? '#059669' : '#475569' }}>
                                        {remain == null ? '—' : remain}
                                    </td>
                                    <td className="px-2 py-2 text-center text-[13px] font-semibold text-[#475569]">{st.total || '—'}</td>
                                    <td className="px-2 py-2 text-center text-[13px] font-bold text-[#059669]">{st.ranked || (st.total ? 0 : '—')}</td>
                                    <td className="px-2 py-2 text-center">
                                        <button className={`rounded px-2 py-1 text-[11px] font-bold ${a.active ? 'bg-[#dcfce7] text-[#15803d]' : 'bg-[#f1f5f9] text-[#64748b]'}`} onClick={(e) => { e.stopPropagation(); void toggle(a); }} type="button">{a.active ? '사용 중' : '중지'}</button>
                                    </td>
                                    <td className="px-2 py-2 text-center">
                                        <button className="rounded bg-[#1e40af] px-3 py-1 text-[11px] font-bold text-white" onClick={(e) => { e.stopPropagation(); goTracker(a.company_key); }} type="button">순위 보기</button>
                                    </td>
                                </tr>
                            );
                        }) : <tr><td className="px-3 py-10 text-center text-[#94a3b8]" colSpan={10}>등록된 카페 업체가 없습니다.</td></tr>}
                    </tbody>
                </table>
            </div>
            <p className="m-0 text-[11px] text-[#94a3b8]">
                ※ 계약금액·건수·계약일·담당은 칸에 바로 입력하면 저장됩니다. 진행률 = 발행완료 / 목표건수. 추적 글·인기글 진입은 순위 트래커 데이터 기준.
            </p>
        </div>
    );
}
