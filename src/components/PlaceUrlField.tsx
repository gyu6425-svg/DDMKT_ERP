import { useEffect, useState } from 'react';
import {
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
} from '../api/placeRank';

// 고객사 상세의 '플레이스 순위 URL + 순위 키워드' — 계약 관리에서 바로 플레이스 순위 추적 등록.
//   URL(place_accounts, client_id 연결) + 키워드(place_keywords)를 여기서 입력하면 순위 트래커/고객 ERP에 반영.

// 최신 측정값의 순위 라벨/색.
function latestRank(k: PlaceKeyword): { label: string; color: string } | null {
    const ms = k.measurements || [];
    if (!ms.length) return null;
    const m: PlaceMeasurement = [...ms].sort((a, b) => b.date.localeCompare(a.date))[0];
    if (m.status === 'fail') return { color: '#94a3b8', label: '실패' };
    if (m.status === 'out' || m.rank >= 999) return { color: '#94a3b8', label: '권외' };
    const color = m.rank <= 3 ? '#059669' : m.rank <= 10 ? '#1e40af' : '#475569';
    return { color, label: `${m.rank}위` };
}

export function PlaceUrlField({ clientId, clientName }: { clientId: string; clientName: string }) {
    const [acc, setAcc] = useState<PlaceAccount | null>(null);
    const [url, setUrl] = useState('');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [msg, setMsg] = useState('');
    const [keywords, setKeywords] = useState<PlaceKeyword[]>([]);
    const [kw, setKw] = useState('');
    const [kwBusy, setKwBusy] = useState(false);

    const loadKeywords = async (accountId: string) => {
        const { data } = await getPlaceKeywords([accountId]);
        setKeywords(data);
    };

    useEffect(() => {
        let alive = true;
        void (async () => {
            const { data } = await getPlaceAccounts(clientId);
            if (!alive) return;
            const a = data[0] || null;
            setAcc(a);
            setUrl(a?.place_url || '');
            if (a) await loadKeywords(a.id);
            setLoading(false);
        })();
        return () => {
            alive = false;
        };
    }, [clientId]);

    // URL 저장(+없으면 계정 생성). 저장 후 그 계정 id 반환(키워드 추가에 필요).
    const saveUrl = async (): Promise<PlaceAccount | null> => {
        const v = url.trim();
        const pid = v ? extractPlaceId(v) : null;
        if (v && !pid) {
            setMsg('URL에서 place id(숫자)를 찾지 못했습니다.');
            return acc;
        }
        setSaving(true);
        let next = acc;
        if (acc) {
            await updatePlaceAccount(acc.id, { place_id: pid, place_url: v || null });
            next = { ...acc, place_id: pid, place_url: v || null };
            setAcc(next);
        } else {
            const { data } = await insertPlaceAccount({
                client_id: clientId,
                is_active: true,
                name: clientName,
                place_id: pid,
                place_url: v || null,
            });
            next = data[0] || null;
            setAcc(next);
            if (next) await loadKeywords(next.id);
        }
        setSaving(false);
        setMsg('저장됨 — 순위 트래커에 반영됩니다.');
        window.setTimeout(() => setMsg(''), 2500);
        return next;
    };

    const addKeyword = async () => {
        const v = kw.trim();
        if (!v) return;
        setKwBusy(true);
        // 계정이 없으면(=URL 미저장) 먼저 계정 생성.
        let account = acc;
        if (!account) account = await saveUrl();
        if (!account) {
            setKwBusy(false);
            setMsg('먼저 플레이스 URL을 입력·저장하세요.');
            return;
        }
        const { error } = await insertPlaceKeyword(account.id, v);
        setKwBusy(false);
        if (error) {
            setMsg('키워드 추가 실패(중복일 수 있음).');
            return;
        }
        setKw('');
        await loadKeywords(account.id);
    };

    const removeKeyword = async (id: string) => {
        await deletePlaceKeyword(id);
        if (acc) await loadKeywords(acc.id);
    };

    return (
        <div className="rounded-lg border border-[#c7d2fe] bg-[#eef2ff] px-3 py-2.5">
            <div className="flex items-center justify-between">
                <span className="text-[12px] font-bold text-[#4338ca]">플레이스 순위 URL · 키워드</span>
                {acc?.place_id ? (
                    <span className="text-[11px] text-[#6366f1]">place id · {acc.place_id}</span>
                ) : null}
            </div>
            <div className="mt-1 flex gap-1.5">
                <input
                    className="h-9 flex-1 rounded-md border border-[#c7d2fe] bg-white px-2 text-sm"
                    disabled={loading}
                    onChange={(e) => setUrl(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') void saveUrl();
                    }}
                    placeholder={loading ? '불러오는 중…' : 'https://m.place.naver.com/.../1696402748/home'}
                    value={url}
                />
                <button
                    className="h-9 rounded-md bg-[#4338ca] px-3 text-sm font-bold text-white hover:bg-[#3730a3] disabled:opacity-50"
                    disabled={saving || loading}
                    onClick={() => void saveUrl()}
                    type="button"
                >
                    저장
                </button>
            </div>

            {/* 순위 키워드 — 여기서 입력하면 매일 자동 측정(순위 트래커·고객 ERP에 반영) */}
            <div className="mt-2">
                <div className="flex flex-wrap items-center gap-1.5">
                    {keywords.map((k) => {
                        const r = latestRank(k);
                        return (
                            <span
                                className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-[12px] font-semibold text-[#4338ca] ring-1 ring-[#c7d2fe]"
                                key={k.id}
                            >
                                #{k.keyword}
                                {r ? (
                                    <b style={{ color: r.color }}>{r.label}</b>
                                ) : (
                                    <span className="text-[10px] text-[#94a3b8]">측정대기</span>
                                )}
                                <button
                                    className="text-[#a5b4fc] hover:text-[#dc2626]"
                                    onClick={() => void removeKeyword(k.id)}
                                    title="키워드 삭제"
                                    type="button"
                                >
                                    ✕
                                </button>
                            </span>
                        );
                    })}
                </div>
                <div className="mt-1.5 flex gap-1.5">
                    <input
                        className="h-8 flex-1 rounded-md border border-[#c7d2fe] bg-white px-2 text-[13px]"
                        disabled={loading}
                        onChange={(e) => setKw(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') void addKeyword();
                        }}
                        placeholder="순위 키워드 추가 (예: 양산 국어학원)"
                        value={kw}
                    />
                    <button
                        className="h-8 rounded-md border border-[#4338ca] px-2.5 text-[12px] font-semibold text-[#4338ca] hover:bg-[#e0e7ff] disabled:opacity-50"
                        disabled={kwBusy || loading || !kw.trim()}
                        onClick={() => void addKeyword()}
                        type="button"
                    >
                        + 키워드
                    </button>
                </div>
            </div>

            <div className="mt-1 text-[11px] text-[#6366f1]">
                {msg || '플레이스 URL + 순위 키워드를 등록하면 매일 자동 측정돼 순위 트래커·고객 ERP에 표시됩니다.'}
            </div>
        </div>
    );
}
