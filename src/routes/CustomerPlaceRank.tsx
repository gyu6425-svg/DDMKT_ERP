import { useEffect, useState } from 'react';
import {
    getPlaceAccounts,
    getPlaceKeywords,
    type PlaceAccount,
    type PlaceKeyword,
    type PlaceMeasurement,
} from '../api/placeRank';

// 고객 ERP 플레이스 순위(읽기 전용) — 본인 업체(client_id)의 플레이스 키워드 일별 순위를 카드로 표시.
//   내부 미리보기(previewClientId)면 그 업체로 스코프, 실제 고객 로그인이면 RLS로 본인 것만.

const DEFAULT_SHOWN = 8;
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
const weekdayOf = (date: string) => {
    const [y, m, d] = date.split('-').map(Number);
    return WEEKDAYS[new Date(y, (m || 1) - 1, d || 1).getDay()] || '';
};
function rankText(m: PlaceMeasurement | undefined): { label: string; color: string } {
    if (!m) return { color: '#cbd5e1', label: '—' };
    if (m.status === 'fail') return { color: '#94a3b8', label: '실패' };
    if (m.status === 'out' || m.rank >= 999) return { color: '#94a3b8', label: '권외' };
    const color = m.rank <= 3 ? '#059669' : m.rank <= 10 ? '#1e40af' : '#475569';
    return { color, label: `${m.rank}위` };
}

export function CustomerPlaceRank({ previewClientId }: { previewClientId?: string | null }) {
    const [accounts, setAccounts] = useState<PlaceAccount[]>([]);
    const [keywords, setKeywords] = useState<PlaceKeyword[]>([]);
    const [loading, setLoading] = useState(true);
    const [expanded, setExpanded] = useState<Set<string>>(new Set());
    const toggleExpand = (id: string) =>
        setExpanded((p) => {
            const n = new Set(p);
            n.has(id) ? n.delete(id) : n.add(id);
            return n;
        });

    useEffect(() => {
        let alive = true;
        void (async () => {
            setLoading(true);
            const { data: a } = await getPlaceAccounts(previewClientId || undefined);
            const { data: k } = a.length ? await getPlaceKeywords(a.map((x) => x.id)) : { data: [] };
            if (!alive) return;
            setAccounts(a);
            setKeywords(k);
            setLoading(false);
        })();
        return () => {
            alive = false;
        };
    }, [previewClientId]);

    const kwByAccount = new Map<string, PlaceKeyword[]>();
    for (const k of keywords) {
        const arr = kwByAccount.get(k.place_account_id) || [];
        arr.push(k);
        kwByAccount.set(k.place_account_id, arr);
    }

    const rankStrip = (k: PlaceKeyword) => {
        const ms = [...(k.measurements || [])].sort((a, b) => b.date.localeCompare(a.date));
        if (!ms.length)
            return <span className="text-[11px] text-[#cbd5e1]">아직 측정 없음 · 매일 자동 기록됩니다</span>;
        const exp = expanded.has(k.id);
        const shown = exp ? ms : ms.slice(0, DEFAULT_SHOWN);
        return (
            <div className="flex items-center gap-2">
                <div className="flex gap-1 overflow-x-auto pb-0.5">
                    {shown.map((m) => {
                        const { label, color } = rankText(m);
                        return (
                            <div
                                className="shrink-0 rounded-lg border border-[#e2e8f0] bg-white px-2.5 py-1 text-center leading-tight"
                                key={m.date}
                            >
                                <div className="text-[10px] font-medium text-[#94a3b8]">
                                    {m.date.slice(5)}
                                    <span className="ml-0.5 text-[#cbd5e1]">({weekdayOf(m.date)})</span>
                                </div>
                                <div className="text-[13px] font-extrabold" style={{ color }}>
                                    {label}
                                </div>
                            </div>
                        );
                    })}
                </div>
                {ms.length > DEFAULT_SHOWN ? (
                    <button
                        className="shrink-0 rounded-md border border-[#cbd5e1] bg-white px-2 py-1 text-[11px] font-semibold text-[#475569] hover:bg-[#f1f5f9]"
                        onClick={() => toggleExpand(k.id)}
                        type="button"
                    >
                        {exp ? '접기' : `더보기 +${ms.length - DEFAULT_SHOWN}`}
                    </button>
                ) : null}
            </div>
        );
    };

    if (loading) return <div className="py-16 text-center text-sm text-[#94a3b8]">불러오는 중…</div>;
    if (!accounts.length)
        return (
            <div className="rounded-xl border border-dashed border-[#cbd5e1] bg-[#f8fafc] px-5 py-12 text-center text-sm text-[#94a3b8]">
                등록된 플레이스가 없습니다. 담당자에게 문의해 주세요.
            </div>
        );

    return (
        <div className="overflow-x-auto rounded-xl border border-[#e2e8f0]">
            <table className="w-full min-w-[640px] border-collapse text-sm">
                <thead>
                    <tr className="bg-[#f1f5f9] text-left text-[12px] text-[#475569]">
                        <th className="px-3 py-2 font-semibold">업체명</th>
                        <th className="px-3 py-2 font-semibold">검색 키워드</th>
                        <th className="px-3 py-2 font-semibold">순위 (일별)</th>
                    </tr>
                </thead>
                <tbody>
                    {accounts.map((acc) => {
                        const kws = kwByAccount.get(acc.id) || [];
                        const rowCount = Math.max(1, kws.length);
                        if (!kws.length)
                            return (
                                <tr className="border-t border-[#f1f5f9]" key={acc.id}>
                                    <td className="px-3 py-2 align-top font-bold text-[#0f172a]">{acc.name}</td>
                                    <td className="px-3 py-2 align-top text-[12px] text-[#94a3b8]" colSpan={2}>
                                        등록된 키워드가 없습니다.
                                    </td>
                                </tr>
                            );
                        return kws.map((k, ki) => (
                            <tr className="border-t border-[#f1f5f9]" key={k.id}>
                                {ki === 0 ? (
                                    <td className="px-3 py-2 align-top font-bold text-[#0f172a]" rowSpan={rowCount}>
                                        {acc.place_url ? (
                                            <a
                                                className="hover:text-[#1e40af] hover:underline"
                                                href={acc.place_url}
                                                rel="noreferrer"
                                                target="_blank"
                                            >
                                                {acc.name}
                                            </a>
                                        ) : (
                                            acc.name
                                        )}
                                    </td>
                                ) : null}
                                <td className="whitespace-nowrap px-3 py-2 align-top font-semibold text-[#7c3aed]">
                                    {k.keyword}
                                </td>
                                <td className="max-w-[520px] px-3 py-2 align-top">{rankStrip(k)}</td>
                            </tr>
                        ));
                    })}
                </tbody>
            </table>
        </div>
    );
}
