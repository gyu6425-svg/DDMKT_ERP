import { useEffect, useMemo, useState } from 'react';
import { useErpData } from '../../context/ErpDataContext';
import { getClientContracts } from '../../api/clientContracts';
import {
    deletePlaceAccount,
    deletePlaceKeyword,
    extractPlaceId,
    getPlaceAccounts,
    getPlaceKeywords,
    insertPlaceAccount,
    insertPlaceKeyword,
    updatePlaceAccount,
    type PlaceAccount,
    type PlaceKeyword,
    type PlaceMeasurement,
} from '../../api/placeRank';

// 플레이스 순위 트래커 — 업체(플레이스 URL)별 키워드의 날짜별 순위 표(애드로그류).
//   순위 값은 크롤러(place_rank_crawler.py)가 매일 기록. 여기선 업체·키워드 등록/삭제 + 조회.

const DEFAULT_SHOWN = 8; // 순위 스트립에 기본으로 한 줄에 보여줄 카드 수(나머지는 '더보기')
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
const weekdayOf = (date: string) => {
    const [y, m, d] = date.split('-').map(Number);
    return WEEKDAYS[new Date(y, (m || 1) - 1, d || 1).getDay()] || '';
};

// 순위 셀 클릭 → 그 키워드의 네이버 플레이스 검색(순위) 화면.
const placeSearchUrl = (kw: string) =>
    `https://m.place.naver.com/place/list?query=${encodeURIComponent(kw)}`;

function rankText(m: PlaceMeasurement | undefined): { label: string; color: string } {
    if (!m) return { color: '#cbd5e1', label: '—' };
    if (m.status === 'fail') return { color: '#94a3b8', label: '실패' };
    if (m.status === 'out' || m.rank >= 999) return { color: '#94a3b8', label: '권외' };
    const color = m.rank <= 3 ? '#059669' : m.rank <= 10 ? '#1e40af' : '#475569';
    return { color, label: `${m.rank}위` };
}

export function PlaceRankTracker() {
    const { allClients } = useErpData();
    const [accounts, setAccounts] = useState<PlaceAccount[]>([]);
    const [keywords, setKeywords] = useState<PlaceKeyword[]>([]);
    const [loading, setLoading] = useState(true);
    const [addOpen, setAddOpen] = useState(false);
    const [name, setName] = useState('');
    const [url, setUrl] = useState('');
    const [kwInput, setKwInput] = useState<Record<string, string>>({}); // accountId → 입력값
    const [busy, setBusy] = useState(false);
    const [toast, setToast] = useState('');
    const [expanded, setExpanded] = useState<Set<string>>(new Set()); // 순위 전체 펼친 키워드 id
    // 관리 시트에서 업체명 클릭(?q=업체명)으로 들어오면 그 업체만 필터. app:navigate 로 재동기화.
    const [q, setQ] = useState(() => new URLSearchParams(window.location.search).get('q') || '');
    useEffect(() => {
        const sync = () => setQ(new URLSearchParams(window.location.search).get('q') || '');
        window.addEventListener('app:navigate', sync);
        window.addEventListener('popstate', sync);
        return () => {
            window.removeEventListener('app:navigate', sync);
            window.removeEventListener('popstate', sync);
        };
    }, []);
    const toggleExpand = (id: string) =>
        setExpanded((p) => {
            const n = new Set(p);
            n.has(id) ? n.delete(id) : n.add(id);
            return n;
        });

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

    // 계약관리의 '플레이스' 상품 업체를 순위 트래커로 불러오기(자동 등록). URL·키워드는 이후 직접 입력.
    const importFromContracts = async () => {
        setBusy(true);
        const { data: contracts } = await getClientContracts();
        const placeClientIds = [
            ...new Set(
                contracts
                    .filter((c) => c.category === '플레이스' && c.client_id)
                    .map((c) => c.client_id as string),
            ),
        ];
        const existing = new Set(accounts.map((a) => a.client_id).filter(Boolean) as string[]);
        const nameById = new Map(allClients.map((c) => [c.id, c.company || '(이름없음)']));
        let created = 0;
        for (const cid of placeClientIds) {
            if (existing.has(cid)) continue;
            const { error } = await insertPlaceAccount({
                client_id: cid,
                is_active: true,
                name: nameById.get(cid) || '(이름없음)',
            });
            if (!error) created += 1;
        }
        setBusy(false);
        flash(created ? `${created}개 업체 불러옴 — URL·키워드를 등록하세요` : '새로 불러올 플레이스 업체가 없습니다.');
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

    // URL 인라인 등록 — 계약에서 불러온 업체(URL 없음)에 플레이스 URL 저장 → place_id 추출.
    const saveUrl = async (acc: PlaceAccount, val: string) => {
        const pid = extractPlaceId(val);
        if (!pid) {
            flash('URL에서 place id(숫자)를 찾지 못했습니다.');
            return;
        }
        await updatePlaceAccount(acc.id, { place_id: pid, place_url: val.trim() });
        await reload();
    };

    // 업체 셀(이름/URL/삭제) — 키워드 유무 두 경우에서 공용.
    const accountCell = (acc: PlaceAccount, rowSpan: number) => (
        <td className="max-w-[200px] px-3 py-2 align-top" rowSpan={rowSpan}>
            {acc.place_url ? (
                <a
                    className="font-bold text-[#0f172a] hover:text-[#1e40af] hover:underline"
                    href={acc.place_url}
                    rel="noreferrer"
                    target="_blank"
                >
                    {acc.name}
                </a>
            ) : (
                <div className="font-bold text-[#0f172a]">{acc.name}</div>
            )}
            {acc.place_id ? (
                <div className="truncate text-[11px] text-[#94a3b8]">{acc.place_id}</div>
            ) : (
                <input
                    className="mt-1 h-7 w-full rounded border border-[#fbbf24] bg-[#fffbeb] px-1.5 text-[11px]"
                    onBlur={(e) => {
                        if (e.target.value.trim()) void saveUrl(acc, e.target.value);
                    }}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                    }}
                    placeholder="플레이스 URL 등록"
                />
            )}
            <button
                className="mt-1 block text-[11px] text-[#dc2626] hover:underline"
                onClick={() => void removeAccount(acc.id)}
                type="button"
            >
                업체 삭제
            </button>
        </td>
    );

    // 순위 스트립 — 그 키워드의 날짜별 순위를 한 줄로 나열(최신순). 기본 DEFAULT_SHOWN개, '더보기'로 처음 측정까지 전부.
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
                            <a
                                className="shrink-0 rounded-lg border border-[#e2e8f0] bg-white px-2.5 py-1 text-center leading-tight transition hover:border-[#1e40af] hover:shadow-sm"
                                href={placeSearchUrl(k.keyword)}
                                key={m.date}
                                rel="noreferrer"
                                target="_blank"
                                title={`${m.date} · 네이버 플레이스 검색`}
                            >
                                <div className="text-[10px] font-medium text-[#94a3b8]">
                                    {m.date.slice(5)}
                                    <span className="ml-0.5 text-[#cbd5e1]">({weekdayOf(m.date)})</span>
                                </div>
                                <div className="text-[13px] font-extrabold" style={{ color }}>
                                    {label}
                                </div>
                            </a>
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

    // 관리 시트에서 넘어온 업체명(?q)이 있으면 그 업체만. 없으면 전체.
    const shownAccounts = q.trim()
        ? accounts.filter((a) => (a.name || '').toLowerCase().includes(q.trim().toLowerCase()))
        : accounts;

    if (loading) {
        return <div className="py-16 text-center text-sm text-[#94a3b8]">불러오는 중…</div>;
    }

    return (
        <div className="grid gap-3">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm text-[#64748b]">
                    <span>
                        업체 <b className="text-[#0f172a]">{shownAccounts.length}</b> · 키워드{' '}
                        <b className="text-[#0f172a]">{keywords.length}</b> · 순위는 매일 자동 측정
                    </span>
                    {q.trim() ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-[#ede9fe] px-2 py-0.5 text-[12px] font-semibold text-[#6d28d9]">
                            🔎 {q}
                            <button
                                className="text-[#a78bfa] hover:text-[#6d28d9]"
                                onClick={() => setQ('')}
                                title="필터 해제(전체 보기)"
                                type="button"
                            >
                                ✕
                            </button>
                        </span>
                    ) : null}
                </div>
                <div className="flex gap-1.5">
                    <button
                        className="rounded-md border border-[#1e40af] bg-white px-3 py-1.5 text-sm font-semibold text-[#1e40af] hover:bg-[#eef2ff] disabled:opacity-50"
                        disabled={busy}
                        onClick={() => void importFromContracts()}
                        title="계약관리의 플레이스 상품 업체를 불러옵니다"
                        type="button"
                    >
                        계약에서 불러오기
                    </button>
                    <button
                        className="rounded-md bg-[#1e40af] px-3 py-1.5 text-sm font-bold text-white hover:bg-[#1e3a8a]"
                        onClick={() => setAddOpen((o) => !o)}
                        type="button"
                    >
                        + 업체 추가
                    </button>
                </div>
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

            {shownAccounts.length === 0 ? (
                <div className="rounded-xl border border-dashed border-[#cbd5e1] bg-[#f8fafc] px-5 py-12 text-center text-sm text-[#94a3b8]">
                    {q.trim()
                        ? `'${q}' 업체를 순위 트래커에서 찾지 못했습니다. ‘계약에서 불러오기’ 또는 ‘+ 업체 추가’로 등록하세요.`
                        : '추적할 업체가 없습니다. ‘+ 업체 추가’로 플레이스 URL을 등록하세요.'}
                </div>
            ) : (
                <div className="overflow-x-auto rounded-xl border border-[#e2e8f0]">
                    <table className="w-full min-w-[720px] border-collapse text-sm">
                        <thead>
                            <tr className="bg-[#f1f5f9] text-left text-[12px] text-[#475569]">
                                <th className="px-3 py-2 font-semibold">업체명</th>
                                <th className="px-3 py-2 font-semibold">검색 키워드</th>
                                <th className="px-3 py-2 font-semibold">순위 (일별)</th>
                                <th className="px-3 py-2 text-center font-semibold">월 검색량</th>
                                <th className="px-2 py-2" />
                            </tr>
                        </thead>
                        <tbody>
                            {shownAccounts.map((acc) => {
                                const kws = kwByAccount.get(acc.id) || [];
                                const rowCount = Math.max(1, kws.length) + 1; // 키워드들 + 입력행
                                return kws
                                    .map((k, ki) => (
                                        <tr className="border-t border-[#f1f5f9]" key={k.id}>
                                            {ki === 0 ? accountCell(acc, rowCount) : null}
                                            <td className="whitespace-nowrap px-3 py-2 align-top font-semibold text-[#7c3aed]">
                                                {k.keyword}
                                            </td>
                                            <td className="max-w-[520px] px-3 py-2 align-top">{rankStrip(k)}</td>
                                            <td className="px-3 py-2 text-center align-top text-[12px] text-[#cbd5e1]">
                                                —
                                            </td>
                                            <td className="px-2 py-2 text-center align-top">
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
                                            {kws.length === 0 ? accountCell(acc, 1) : null}
                                            <td className="px-3 py-2" colSpan={4}>
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
