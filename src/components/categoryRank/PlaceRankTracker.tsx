import { useEffect, useMemo, useState } from 'react';
import {
    deletePlaceAccount,
    deletePlaceKeyword,
    extractPlaceId,
    getPlaceAccounts,
    getPlaceKeywords,
    insertPlaceAccount,
    insertPlaceKeyword,
    type PlaceAccount,
    type PlaceKeyword,
    type PlaceMeasurement,
} from '../../api/placeRank';

// 플레이스 순위 트래커 — 업체(플레이스 URL)별 키워드의 날짜별 순위 표(애드로그류).
//   순위 값은 크롤러(place_rank_crawler.py)가 매일 기록. 여기선 업체·키워드 등록/삭제 + 조회.

const RECENT_DAYS = 10; // 표에 보여줄 최근 날짜 컬럼 수

function rankText(m: PlaceMeasurement | undefined): { label: string; color: string } {
    if (!m) return { color: '#cbd5e1', label: '—' };
    if (m.status === 'fail') return { color: '#94a3b8', label: '실패' };
    if (m.status === 'out' || m.rank >= 999) return { color: '#94a3b8', label: '권외' };
    const color = m.rank <= 3 ? '#059669' : m.rank <= 10 ? '#1e40af' : '#475569';
    return { color, label: `${m.rank}위` };
}

export function PlaceRankTracker() {
    const [accounts, setAccounts] = useState<PlaceAccount[]>([]);
    const [keywords, setKeywords] = useState<PlaceKeyword[]>([]);
    const [loading, setLoading] = useState(true);
    const [addOpen, setAddOpen] = useState(false);
    const [name, setName] = useState('');
    const [url, setUrl] = useState('');
    const [kwInput, setKwInput] = useState<Record<string, string>>({}); // accountId → 입력값
    const [busy, setBusy] = useState(false);
    const [toast, setToast] = useState('');

    const reload = async () => {
        setLoading(true);
        const [a, k] = await Promise.all([getPlaceAccounts(), getPlaceKeywords()]);
        setAccounts(a.data);
        setKeywords(k.data);
        setLoading(false);
    };
    useEffect(() => {
        void reload();
    }, []);

    const flash = (m: string) => {
        setToast(m);
        window.setTimeout(() => setToast(''), 2500);
    };

    // 최근 날짜 컬럼 — 모든 키워드 measurements 날짜 합집합에서 최신 N개.
    const dates = useMemo(() => {
        const s = new Set<string>();
        for (const k of keywords) for (const m of k.measurements || []) s.add(m.date);
        return [...s].sort().reverse().slice(0, RECENT_DAYS);
    }, [keywords]);

    const kwByAccount = useMemo(() => {
        const map = new Map<string, PlaceKeyword[]>();
        for (const k of keywords) {
            const arr = map.get(k.place_account_id) || [];
            arr.push(k);
            map.set(k.place_account_id, arr);
        }
        return map;
    }, [keywords]);

    const addAccount = async () => {
        const pid = extractPlaceId(url);
        if (!name.trim() || !pid) {
            flash('업체명과 올바른 플레이스 URL(숫자 id 포함)을 입력하세요.');
            return;
        }
        setBusy(true);
        const { error } = await insertPlaceAccount({
            is_active: true,
            name: name.trim(),
            place_id: pid,
            place_url: url.trim(),
        });
        setBusy(false);
        if (error) {
            flash('추가 실패: ' + error.message);
            return;
        }
        setName('');
        setUrl('');
        setAddOpen(false);
        await reload();
    };

    const addKeyword = async (accountId: string) => {
        const kw = (kwInput[accountId] || '').trim();
        if (!kw) return;
        setBusy(true);
        const { error } = await insertPlaceKeyword(accountId, kw);
        setBusy(false);
        if (error) {
            flash('키워드 추가 실패(중복일 수 있음): ' + error.message);
            return;
        }
        setKwInput((p) => ({ ...p, [accountId]: '' }));
        await reload();
    };

    const removeKeyword = async (id: string) => {
        await deletePlaceKeyword(id);
        await reload();
    };
    const removeAccount = async (id: string) => {
        if (!window.confirm('이 업체와 등록된 키워드를 모두 삭제할까요?')) return;
        await deletePlaceAccount(id);
        await reload();
    };

    if (loading) {
        return <div className="py-16 text-center text-sm text-[#94a3b8]">불러오는 중…</div>;
    }

    return (
        <div className="grid gap-3">
            <div className="flex items-center justify-between">
                <div className="text-sm text-[#64748b]">
                    업체 <b className="text-[#0f172a]">{accounts.length}</b> · 키워드{' '}
                    <b className="text-[#0f172a]">{keywords.length}</b> · 순위는 매일 자동 측정
                </div>
                <button
                    className="rounded-md bg-[#1e40af] px-3 py-1.5 text-sm font-bold text-white hover:bg-[#1e3a8a]"
                    onClick={() => setAddOpen((o) => !o)}
                    type="button"
                >
                    + 업체 추가
                </button>
            </div>

            {addOpen ? (
                <div className="grid gap-2 rounded-lg border border-[#dbeafe] bg-[#f8fafc] p-3 sm:grid-cols-[1fr_2fr_auto]">
                    <input
                        className="h-9 rounded-md border border-[#cbd5e1] px-2 text-sm"
                        onChange={(e) => setName(e.target.value)}
                        placeholder="업체명 (예: 메디푸스)"
                        value={name}
                    />
                    <input
                        className="h-9 rounded-md border border-[#cbd5e1] px-2 text-sm"
                        onChange={(e) => setUrl(e.target.value)}
                        placeholder="플레이스 URL (예: https://m.place.naver.com/.../1696402748/home)"
                        value={url}
                    />
                    <button
                        className="h-9 rounded-md bg-[#1e40af] px-3 text-sm font-bold text-white disabled:opacity-50"
                        disabled={busy}
                        onClick={() => void addAccount()}
                        type="button"
                    >
                        저장
                    </button>
                </div>
            ) : null}

            {accounts.length === 0 ? (
                <div className="rounded-xl border border-dashed border-[#cbd5e1] bg-[#f8fafc] px-5 py-12 text-center text-sm text-[#94a3b8]">
                    추적할 업체가 없습니다. ‘+ 업체 추가’로 플레이스 URL을 등록하세요.
                </div>
            ) : (
                <div className="overflow-x-auto rounded-xl border border-[#e2e8f0]">
                    <table className="w-full min-w-[720px] border-collapse text-sm">
                        <thead>
                            <tr className="bg-[#f1f5f9] text-left text-[12px] text-[#475569]">
                                <th className="px-3 py-2 font-semibold">업체</th>
                                <th className="px-3 py-2 font-semibold">검색 키워드</th>
                                {dates.map((d) => (
                                    <th className="px-2 py-2 text-center font-semibold" key={d}>
                                        {d.slice(5)}
                                    </th>
                                ))}
                                <th className="px-2 py-2" />
                            </tr>
                        </thead>
                        <tbody>
                            {accounts.map((acc) => {
                                const kws = kwByAccount.get(acc.id) || [];
                                const rowCount = Math.max(1, kws.length) + 1; // 키워드들 + 입력행
                                return kws
                                    .map((k, ki) => (
                                        <tr className="border-t border-[#f1f5f9]" key={k.id}>
                                            {ki === 0 ? (
                                                <td
                                                    className="max-w-[180px] px-3 py-2 align-top"
                                                    rowSpan={rowCount}
                                                >
                                                    <div className="font-bold text-[#0f172a]">{acc.name}</div>
                                                    {acc.place_url ? (
                                                        <a
                                                            className="block truncate text-[11px] text-[#2563eb] hover:underline"
                                                            href={acc.place_url}
                                                            rel="noreferrer"
                                                            target="_blank"
                                                        >
                                                            {acc.place_id}
                                                        </a>
                                                    ) : null}
                                                    <button
                                                        className="mt-1 text-[11px] text-[#dc2626] hover:underline"
                                                        onClick={() => void removeAccount(acc.id)}
                                                        type="button"
                                                    >
                                                        업체 삭제
                                                    </button>
                                                </td>
                                            ) : null}
                                            <td className="px-3 py-2 font-semibold text-[#7c3aed]">
                                                {k.keyword}
                                            </td>
                                            {dates.map((d) => {
                                                const m = (k.measurements || []).find((x) => x.date === d);
                                                const { label, color } = rankText(m);
                                                return (
                                                    <td
                                                        className="px-2 py-2 text-center font-bold"
                                                        key={d}
                                                        style={{ color }}
                                                    >
                                                        {label}
                                                    </td>
                                                );
                                            })}
                                            <td className="px-2 py-2 text-center">
                                                <button
                                                    className="text-[11px] text-[#94a3b8] hover:text-[#dc2626]"
                                                    onClick={() => void removeKeyword(k.id)}
                                                    type="button"
                                                >
                                                    ✕
                                                </button>
                                            </td>
                                        </tr>
                                    ))
                                    .concat(
                                        <tr className="border-t border-[#f1f5f9] bg-[#fafbff]" key={acc.id + ':add'}>
                                            {kws.length === 0 ? (
                                                <td
                                                    className="max-w-[180px] px-3 py-2 align-top"
                                                    rowSpan={1}
                                                >
                                                    <div className="font-bold text-[#0f172a]">{acc.name}</div>
                                                    {acc.place_url ? (
                                                        <a
                                                            className="block truncate text-[11px] text-[#2563eb] hover:underline"
                                                            href={acc.place_url}
                                                            rel="noreferrer"
                                                            target="_blank"
                                                        >
                                                            {acc.place_id}
                                                        </a>
                                                    ) : null}
                                                    <button
                                                        className="mt-1 text-[11px] text-[#dc2626] hover:underline"
                                                        onClick={() => void removeAccount(acc.id)}
                                                        type="button"
                                                    >
                                                        업체 삭제
                                                    </button>
                                                </td>
                                            ) : null}
                                            <td className="px-3 py-2" colSpan={dates.length + 2}>
                                                <div className="flex gap-1">
                                                    <input
                                                        className="h-8 w-56 rounded-md border border-[#cbd5e1] px-2 text-[13px]"
                                                        onChange={(e) =>
                                                            setKwInput((p) => ({ ...p, [acc.id]: e.target.value }))
                                                        }
                                                        onKeyDown={(e) => {
                                                            if (e.key === 'Enter') void addKeyword(acc.id);
                                                        }}
                                                        placeholder="키워드 추가 (예: 인천 내성발톱)"
                                                        value={kwInput[acc.id] || ''}
                                                    />
                                                    <button
                                                        className="h-8 rounded-md border border-[#1e40af] px-2 text-[12px] font-semibold text-[#1e40af] hover:bg-[#eef2ff] disabled:opacity-50"
                                                        disabled={busy}
                                                        onClick={() => void addKeyword(acc.id)}
                                                        type="button"
                                                    >
                                                        + 키워드
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>,
                                    );
                            })}
                        </tbody>
                    </table>
                </div>
            )}

            {toast ? (
                <div className="fixed bottom-4 left-1/2 -translate-x-1/2 rounded-lg bg-[#0f172a] px-4 py-2 text-sm text-white shadow-lg">
                    {toast}
                </div>
            ) : null}
        </div>
    );
}
