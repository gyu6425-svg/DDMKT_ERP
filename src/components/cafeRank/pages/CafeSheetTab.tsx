import { useEffect, useMemo, useState } from 'react';
import { getCafeAccounts, setCafeAccountActive, upsertCafeAccount, type CafeAccount } from '../../../api/cafeAccounts';
import { cafeCompanyRank, cafeNameLabel, cafeNameRank } from '../../../lib/cafeAccounts';

function goTracker(companyKey: string) {
    const u = new URL(window.location.href);
    u.searchParams.set('tab', 'tracker');
    u.searchParams.delete('q');
    u.searchParams.set('company', companyKey);
    window.history.pushState(null, '', u.pathname + u.search);
    window.dispatchEvent(new Event('app:navigate'));
}

const EMPTY = { company_key: '', display_name: '', board_name: '', board_short: '' };

export function CafeSheetTab() {
    const [accounts, setAccounts] = useState<CafeAccount[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [showAdd, setShowAdd] = useState(false);
    const [form, setForm] = useState(EMPTY);
    const [busy, setBusy] = useState(false);

    const reload = async () => {
        setLoading(true);
        const result = await getCafeAccounts();
        setAccounts(result.data);
        setError(result.error ? 'cafe_accounts가 없습니다. docs/cafe-accounts.sql을 Supabase SQL Editor에서 실행하세요.' : '');
        setLoading(false);
    };
    useEffect(() => { void reload(); }, []);

    // 카페(vanity)별로 묶어서 표시 — 한 카페 안에 여러 업체(게시판)가 있을 수 있다.
    const cafeGroups = useMemo(() => {
        const map = new Map<string, CafeAccount[]>();
        for (const a of accounts) {
            const key = a.cafe_name || '기타';
            (map.get(key) || map.set(key, []).get(key)!).push(a);
        }
        for (const [, list] of map) {
            list.sort((a, b) => cafeCompanyRank(a.company_key) - cafeCompanyRank(b.company_key) || a.display_name.localeCompare(b.display_name));
        }
        return [...map.entries()].sort((a, b) => cafeNameRank(a[0]) - cafeNameRank(b[0]) || a[0].localeCompare(b[0]));
    }, [accounts]);

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
        const result = await setCafeAccountActive(a.id, !a.active);
        if (result.error) return setError(result.error.message);
        setAccounts((prev) => prev.map((x) => x.id === a.id ? { ...x, active: !x.active } : x));
    };

    return (
        <div className="grid gap-3">
            <div className="flex flex-wrap items-center gap-2">
                <div>
                    <h2 className="m-0 text-base font-bold text-[#0f172a]">카페 업체 관리</h2>
                    <p className="m-0 mt-0.5 text-xs text-[#64748b]">카페별로 그 안에서 발행 중인 업체(게시판)를 묶어서 봅니다.</p>
                </div>
                <span className="ml-auto text-xs text-[#64748b]">카페 {cafeGroups.length} · 업체 {accounts.length}</span>
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

            {loading ? (
                <div className="rounded-md border border-[#e2e8f0] bg-white px-3 py-10 text-center text-[#94a3b8]">불러오는 중…</div>
            ) : !cafeGroups.length ? (
                <div className="rounded-md border border-[#e2e8f0] bg-white px-3 py-10 text-center text-[#94a3b8]">등록된 카페 업체가 없습니다.</div>
            ) : (
                cafeGroups.map(([cafeName, list]) => (
                    <div className="overflow-hidden rounded-lg border border-[#e2e8f0] bg-white" key={cafeName}>
                        {/* 카페 헤더 */}
                        <div className="flex items-center gap-2 border-b border-[#e2e8f0] bg-[#f8fafc] px-4 py-2.5">
                            <a
                                className="text-sm font-bold text-[#0f172a] hover:text-[#1e40af] hover:underline"
                                href={`https://cafe.naver.com/${cafeName}`}
                                rel="noreferrer"
                                target="_blank"
                            >
                                {cafeNameLabel(cafeName)}
                            </a>
                            <span className="text-[11px] text-[#94a3b8]">{cafeName} · {list[0]?.club_id}</span>
                            <span className="ml-auto rounded-full bg-[#eef2ff] px-2.5 py-0.5 text-[11px] font-semibold text-[#4338ca]">업체 {list.length}</span>
                        </div>
                        <table className="w-full border-collapse text-left text-sm">
                            <thead><tr className="border-b border-[#e2e8f0] bg-[#f1f5f9] text-[11px] text-[#64748b]">
                                <th className="px-4 py-2">업체</th><th className="px-3 py-2">게시판</th><th className="px-3 py-2 text-center">계약 연결</th><th className="px-3 py-2 text-center">상태</th><th className="px-3 py-2 text-center">순위</th>
                            </tr></thead>
                            <tbody>
                                {list.map((a) => (
                                    <tr className="border-b border-[#e2e8f0] last:border-b-0" key={a.id}>
                                        <td className="px-4 py-2 font-semibold text-[#0f172a]">{a.display_name}<div className="text-[10px] font-normal text-[#94a3b8]">{a.company_key}</div></td>
                                        <td className="px-3 py-2"><span className="rounded bg-[#f1f5f9] px-2 py-1 text-xs font-semibold text-[#475569]">{a.board_short}</span><div className="mt-1 text-[10px] text-[#94a3b8]">{a.board_name}</div></td>
                                        <td className="px-3 py-2 text-center text-xs text-[#64748b]">{a.client_id ? '연결됨' : '미계약'}</td>
                                        <td className="px-3 py-2 text-center"><button className={`rounded px-2 py-1 text-[11px] font-bold ${a.active ? 'bg-[#dcfce7] text-[#15803d]' : 'bg-[#f1f5f9] text-[#64748b]'}`} onClick={() => void toggle(a)} type="button">{a.active ? '사용 중' : '중지'}</button></td>
                                        <td className="px-3 py-2 text-center"><button className="rounded bg-[#1e40af] px-3 py-1 text-[11px] font-bold text-white" onClick={() => goTracker(a.company_key)} type="button">순위 보기</button></td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                ))
            )}
        </div>
    );
}