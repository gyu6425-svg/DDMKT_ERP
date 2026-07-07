import { useEffect, useState } from 'react';
import {
    extractPlaceId,
    getPlaceAccounts,
    insertPlaceAccount,
    updatePlaceAccount,
    type PlaceAccount,
} from '../api/placeRank';

// 고객사 상세의 '플레이스 순위 URL' — 계약 관리의 홈페이지 URL과 별개.
//   여기 입력한 URL이 플레이스 대시보드 순위 트래커의 그 업체 URL이 된다(place_accounts, client_id로 연결).
export function PlaceUrlField({ clientId, clientName }: { clientId: string; clientName: string }) {
    const [acc, setAcc] = useState<PlaceAccount | null>(null);
    const [url, setUrl] = useState('');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [msg, setMsg] = useState('');

    useEffect(() => {
        let alive = true;
        (async () => {
            const { data } = await getPlaceAccounts(clientId);
            if (!alive) return;
            const a = data[0] || null;
            setAcc(a);
            setUrl(a?.place_url || '');
            setLoading(false);
        })();
        return () => {
            alive = false;
        };
    }, [clientId]);

    const save = async () => {
        const v = url.trim();
        const pid = v ? extractPlaceId(v) : null;
        if (v && !pid) {
            setMsg('URL에서 place id(숫자)를 찾지 못했습니다.');
            return;
        }
        setSaving(true);
        if (acc) {
            await updatePlaceAccount(acc.id, { place_id: pid, place_url: v || null });
            setAcc({ ...acc, place_id: pid, place_url: v || null });
        } else {
            const { data } = await insertPlaceAccount({
                client_id: clientId,
                is_active: true,
                name: clientName,
                place_id: pid,
                place_url: v || null,
            });
            setAcc(data[0] || null);
        }
        setSaving(false);
        setMsg('저장됨 — 순위 트래커에 반영됩니다.');
        window.setTimeout(() => setMsg(''), 2500);
    };

    return (
        <div className="rounded-lg border border-[#c7d2fe] bg-[#eef2ff] px-3 py-2.5">
            <div className="flex items-center justify-between">
                <span className="text-[12px] font-bold text-[#4338ca]">플레이스 순위 URL</span>
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
                        if (e.key === 'Enter') void save();
                    }}
                    placeholder={loading ? '불러오는 중…' : 'https://m.place.naver.com/.../1696402748/home'}
                    value={url}
                />
                <button
                    className="h-9 rounded-md bg-[#4338ca] px-3 text-sm font-bold text-white hover:bg-[#3730a3] disabled:opacity-50"
                    disabled={saving || loading}
                    onClick={() => void save()}
                    type="button"
                >
                    저장
                </button>
            </div>
            <div className="mt-1 text-[11px] text-[#6366f1]">
                {msg || '계약 관리의 홈페이지 URL과 별개인, 네이버 플레이스 주소입니다.'}
            </div>
        </div>
    );
}
