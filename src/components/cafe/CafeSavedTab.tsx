import { useEffect, useState } from 'react';
import { listHistory, delHistory, type CafeHistoryEntry } from './cafeHistory';
import { downloadCafeZip } from './cafeExport';

// 카페 [저장] 탭 — 생성 히스토리 조회·ZIP 재다운로드·원고 보기·삭제. (IndexedDB, 새로고침 유지)
const TONE_LABEL: Record<string, string> = {
    info: '정보형',
    notice: '공지형',
    review: '후기형',
    story: '스토리형',
    talk: '대화형',
};

export function CafeSavedTab() {
    const [items, setItems] = useState<CafeHistoryEntry[]>([]);
    const [open, setOpen] = useState<string | null>(null);
    const [busy, setBusy] = useState<string | null>(null);
    const [msg, setMsg] = useState('');

    const reload = () => void listHistory().then(setItems);
    useEffect(() => {
        reload();
        // 다른 탭(테스트2)에서 생성·저장하면 즉시 목록 갱신 + 탭 재진입/포커스 시에도 갱신.
        const onSaved = () => reload();
        window.addEventListener('cafe:history-saved', onSaved);
        window.addEventListener('focus', onSaved);
        return () => {
            window.removeEventListener('cafe:history-saved', onSaved);
            window.removeEventListener('focus', onSaved);
        };
    }, []);

    const download = async (e: CafeHistoryEntry) => {
        setBusy(e.id);
        setMsg('');
        try {
            const images = e.firstCard ? [e.firstCard, ...e.fixedImages, e.firstCard] : [...e.fixedImages];
            const n = await downloadCafeZip({ bodyText: e.reviewBody, images, region: e.region, title: e.title });
            setMsg(`다운로드 완료 — 원고.txt + 사진 ${n}장(각각 새로 미세 변형).`);
        } catch {
            setMsg('다운로드 실패');
        } finally {
            setBusy(null);
        }
    };

    const remove = async (id: string) => {
        await delHistory(id);
        reload();
    };

    const fmt = (ms: number) =>
        new Date(ms).toLocaleString('ko-KR', { day: '2-digit', hour: '2-digit', minute: '2-digit', month: '2-digit' });

    return (
        <div className="grid gap-4">
            <p className="m-0 text-sm text-[#64748b]">
                생성한 원고·카드가 여기에 <b>자동 저장</b>됩니다(브라우저 로컬, 새로고침·재접속해도 유지). 언제든{' '}
                <b>ZIP 다시 다운로드</b> 가능하고, 다운로드할 때마다 이미지 속성은 <b>새로 미세 변형</b>됩니다.
            </p>
            {msg ? <span className="text-[13px] text-[#6366f1]">{msg}</span> : null}
            {items.length === 0 ? (
                <div className="rounded-xl border border-dashed border-[#cbd5e1] bg-[#f8fafc] px-6 py-16 text-center text-sm text-[#94a3b8]">
                    아직 저장된 생성물이 없습니다. 테스트2 탭에서 “생성”하면 여기에 쌓입니다.
                </div>
            ) : (
                <div className="grid gap-2">
                    {items.map((e) => (
                        <div className="rounded-xl border border-[#e2e8f0] bg-white p-3" key={e.id}>
                            <div className="flex items-center gap-3">
                                {e.firstCard ? (
                                    <img alt="" className="h-14 w-14 shrink-0 rounded-md border border-[#e2e8f0] object-cover" src={e.firstCard} />
                                ) : (
                                    <div className="h-14 w-14 shrink-0 rounded-md border border-[#e2e8f0] bg-[#f1f5f9]" />
                                )}
                                <div className="min-w-0 flex-1">
                                    <div className="truncate text-sm font-bold text-[#334155]">{e.title || e.keyword}</div>
                                    <div className="truncate text-[12px] text-[#94a3b8]">
                                        {e.region} · {e.keyword} · {TONE_LABEL[e.tone] || e.tone} · {fmt(e.at)}
                                    </div>
                                </div>
                                <button
                                    className="h-8 shrink-0 rounded-md bg-[#4338ca] px-3 text-xs font-bold text-white hover:bg-[#3730a3] disabled:opacity-50"
                                    disabled={busy === e.id}
                                    onClick={() => void download(e)}
                                    type="button"
                                >
                                    {busy === e.id ? '다운 중…' : 'ZIP 다운'}
                                </button>
                                <button
                                    className="h-8 shrink-0 rounded-md border border-[#cbd5e1] px-2 text-xs font-semibold text-[#64748b] hover:bg-[#f1f5f9]"
                                    onClick={() => setOpen(open === e.id ? null : e.id)}
                                    type="button"
                                >
                                    {open === e.id ? '접기' : '원고'}
                                </button>
                                <button
                                    className="h-8 shrink-0 rounded-md border border-[#fecaca] px-2 text-xs font-semibold text-[#dc2626] hover:bg-[#fef2f2]"
                                    onClick={() => void remove(e.id)}
                                    type="button"
                                >
                                    삭제
                                </button>
                            </div>
                            {open === e.id ? (
                                <textarea
                                    className="mt-2 h-56 w-full rounded-md border border-[#cbd5e1] bg-[#f8fafc] px-3 py-2 text-[13px] leading-6 text-[#0f172a]"
                                    readOnly
                                    value={`${e.title}\n\n${e.reviewBody}`}
                                />
                            ) : null}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
