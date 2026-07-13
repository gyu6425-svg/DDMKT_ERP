import { useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent } from 'react';
import { toPng } from 'html-to-image';
import { zipSync } from 'fflate';

// 배경 + 텍스트 오버레이 편집기 — 내가 만든 배경 이미지를 올리고 텍스트만 얹어 PNG로 뽑는다.
//   OpenAI 재호출 0 · 한글 Pretendard 선명. 여러 장(카드뉴스) 지원 + 전체 ZIP.
const CARD = 1080; // 1080×1080 출력
const FONT = "'Pretendard Variable', Pretendard, 'Malgun Gothic', sans-serif";

type TextEl = {
    id: string;
    text: string;
    x: number; // 좌상단 X (%)
    y: number; // 좌상단 Y (%)
    w: number; // 폭 (%)
    size: number; // px (1080 기준)
    color: string;
    weight: number;
    align: 'left' | 'center' | 'right';
    lh: number; // 줄간격
    ls: number; // 자간
    shadow: boolean;
};
type Card = { bg: string | null; texts: TextEl[] };

let seq = 0;
const uid = () => `t${(seq += 1)}`;
const newText = (over: Partial<TextEl> = {}): TextEl => ({
    id: uid(),
    text: '텍스트',
    x: 8,
    y: 8,
    w: 60,
    size: 56,
    color: '#ffffff',
    weight: 800,
    align: 'left',
    lh: 1.2,
    ls: -1,
    shadow: true,
    ...over,
});

const readFile = (f: File): Promise<string> =>
    new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result));
        r.onerror = rej;
        r.readAsDataURL(f);
    });

// 한 카드(1080) 렌더 — 배경 + 텍스트. interactive면 드래그 핸들러 부착.
function CardCanvas({
    card,
    selId,
    onPointerDownText,
}: {
    card: Card;
    selId?: string | null;
    onPointerDownText?: (id: string, e: RPointerEvent<HTMLDivElement>) => void;
}) {
    return (
        <div style={{ position: 'relative', width: CARD, height: CARD, overflow: 'hidden', background: '#0c1626', fontFamily: FONT }}>
            {card.bg ? (
                <img src={card.bg} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : null}
            {card.texts.map((t) => {
                const style: CSSProperties = {
                    position: 'absolute',
                    left: `${t.x}%`,
                    top: `${t.y}%`,
                    width: `${t.w}%`,
                    fontSize: t.size,
                    color: t.color,
                    fontWeight: t.weight,
                    textAlign: t.align,
                    lineHeight: t.lh,
                    letterSpacing: t.ls,
                    whiteSpace: 'pre-line',
                    textShadow: t.shadow ? '0 3px 14px rgba(0,0,0,0.55)' : 'none',
                    cursor: onPointerDownText ? 'move' : 'default',
                    outline: onPointerDownText && selId === t.id ? '2px dashed #4c8dff' : 'none',
                    outlineOffset: 4,
                };
                return (
                    <div
                        key={t.id}
                        style={style}
                        onPointerDown={onPointerDownText ? (e) => onPointerDownText(t.id, e) : undefined}
                    >
                        {t.text}
                    </div>
                );
            })}
        </div>
    );
}

export function CafeThemanTab() {
    const [cards, setCards] = useState<Card[]>([{ bg: null, texts: [newText({ text: '여기에 텍스트' })] }]);
    const [active, setActive] = useState(0);
    const [selId, setSelId] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState('');
    const previewRef = useRef<HTMLDivElement | null>(null);
    const exportRefs = useRef<(HTMLDivElement | null)[]>([]);
    const dragRef = useRef<{ id: string; offX: number; offY: number } | null>(null);

    const card = cards[active];
    const sel = card?.texts.find((t) => t.id === selId) || null;

    const updateCard = (i: number, fn: (c: Card) => Card) => setCards((cs) => cs.map((c, j) => (j === i ? fn(c) : c)));
    const updateText = (id: string, patch: Partial<TextEl>) =>
        updateCard(active, (c) => ({ ...c, texts: c.texts.map((t) => (t.id === id ? { ...t, ...patch } : t)) }));

    // 드래그 — 미리보기 rect 기준 %로 위치 갱신(스케일 무관).
    const onPointerDownText = (id: string, e: RPointerEvent<HTMLDivElement>) => {
        e.preventDefault();
        setSelId(id);
        const rect = previewRef.current?.getBoundingClientRect();
        const t = card.texts.find((x) => x.id === id);
        if (!rect || !t) return;
        const curX = (t.x / 100) * rect.width + rect.left;
        const curY = (t.y / 100) * rect.height + rect.top;
        dragRef.current = { id, offX: e.clientX - curX, offY: e.clientY - curY };
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
    };
    const onPointerMove = (e: RPointerEvent<HTMLDivElement>) => {
        const drag = dragRef.current;
        const rect = previewRef.current?.getBoundingClientRect();
        if (!drag || !rect) return;
        const x = ((e.clientX - drag.offX - rect.left) / rect.width) * 100;
        const y = ((e.clientY - drag.offY - rect.top) / rect.height) * 100;
        updateText(drag.id, { x: Math.max(-5, Math.min(100, x)), y: Math.max(-5, Math.min(100, y)) });
    };
    const onPointerUp = () => {
        dragRef.current = null;
    };

    const exportNode = (node: HTMLElement) =>
        toPng(node, { cacheBust: true, height: CARD, pixelRatio: 1, width: CARD });

    const downloadOne = async (i: number) => {
        const node = exportRefs.current[i];
        if (!node) return;
        setBusy(true);
        try {
            const url = await exportNode(node);
            const a = document.createElement('a');
            a.download = `카드_${String(i + 1).padStart(2, '0')}.png`;
            a.href = url;
            a.click();
            setMsg(`${i + 1}번 카드 다운로드 완료`);
        } catch (err) {
            setMsg(err instanceof Error ? err.message : '내보내기 실패');
        } finally {
            setBusy(false);
        }
    };
    const downloadZip = async () => {
        setBusy(true);
        setMsg('이미지 생성 중…');
        try {
            const files: Record<string, Uint8Array> = {};
            for (let i = 0; i < cards.length; i += 1) {
                const node = exportRefs.current[i];
                if (!node) continue;
                const url = await exportNode(node);
                files[`카드_${String(i + 1).padStart(2, '0')}.png`] = Uint8Array.from(atob(url.split(',')[1]), (ch) => ch.charCodeAt(0));
            }
            const zip = zipSync(files, { level: 0 });
            const a = document.createElement('a');
            a.download = '카드뉴스.zip';
            a.href = URL.createObjectURL(new Blob([zip], { type: 'application/zip' }));
            a.click();
            URL.revokeObjectURL(a.href);
            setMsg(`ZIP 다운로드 완료 (${cards.length}장)`);
        } catch (err) {
            setMsg(err instanceof Error ? err.message : 'ZIP 실패');
        } finally {
            setBusy(false);
        }
    };

    const previewW = 460;
    const scale = previewW / CARD;
    const num = 'h-8 w-full rounded border border-[#cbd5e1] px-1.5 text-sm';
    const lbl = 'grid gap-0.5 text-[11px] font-semibold text-[#64748b]';

    return (
        <div className="grid gap-4">
            <div className="rounded-lg border border-[#e2e8f0] bg-[#f8fafc] px-4 py-3 text-sm text-[#475569]">
                <b className="text-[#0f172a]">배경 + 텍스트.</b> 직접 만든 배경 이미지를 올리고 텍스트를 드래그로 얹어 PNG로 뽑습니다.
                OpenAI 재호출 없이 무제한(비용 0) · 한글 선명. 카드는 여러 장 만들어 ZIP으로 받을 수 있어요.
            </div>

            {/* 카드 탭(여러 장) */}
            <div className="flex flex-wrap items-center gap-1.5">
                {cards.map((_, i) => (
                    <button
                        key={i}
                        className={`rounded-md border px-3 py-1.5 text-xs font-bold ${
                            i === active ? 'border-[#1e40af] bg-[#1e40af] text-white' : 'border-[#cbd5e1] bg-white text-[#475569]'
                        }`}
                        onClick={() => {
                            setActive(i);
                            setSelId(null);
                        }}
                        type="button"
                    >
                        {i + 1}
                    </button>
                ))}
                <button
                    className="rounded-md border border-dashed border-[#94a3b8] px-3 py-1.5 text-xs font-bold text-[#475569] hover:bg-[#f1f5f9]"
                    onClick={() => {
                        setCards((cs) => [...cs, { bg: null, texts: [newText()] }]);
                        setActive(cards.length);
                        setSelId(null);
                    }}
                    type="button"
                >
                    + 카드
                </button>
                {cards.length > 1 ? (
                    <button
                        className="rounded-md border border-[#fca5a5] px-3 py-1.5 text-xs font-bold text-[#dc2626] hover:bg-[#fef2f2]"
                        onClick={() => {
                            setCards((cs) => cs.filter((_, j) => j !== active));
                            setActive((a) => Math.max(0, a - 1));
                            setSelId(null);
                        }}
                        type="button"
                    >
                        현재 카드 삭제
                    </button>
                ) : null}
            </div>

            <div className="grid gap-4 lg:grid-cols-[auto_1fr]">
                {/* 미리보기(드래그) */}
                <div className="grid gap-2">
                    <div
                        style={{ width: previewW, height: previewW, overflow: 'hidden', borderRadius: 10, border: '1px solid #e2e8f0', touchAction: 'none' }}
                        onPointerMove={onPointerMove}
                        onPointerUp={onPointerUp}
                    >
                        <div ref={previewRef} style={{ width: CARD, height: CARD, transform: `scale(${scale})`, transformOrigin: 'top left' }}>
                            <CardCanvas card={card} selId={selId} onPointerDownText={onPointerDownText} />
                        </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <label className="cursor-pointer rounded-md bg-[#1e40af] px-3 py-2 text-xs font-bold text-white hover:bg-[#1e3a8a]">
                            배경 이미지 올리기
                            <input
                                accept="image/*"
                                className="hidden"
                                onChange={async (e) => {
                                    const f = e.target.files?.[0];
                                    if (f) updateCard(active, (c) => ({ ...c, bg: '' }));
                                    if (f) {
                                        const src = await readFile(f);
                                        updateCard(active, (c) => ({ ...c, bg: src }));
                                    }
                                }}
                                type="file"
                            />
                        </label>
                        <button
                            className="rounded-md border border-[#cbd5e1] px-3 py-2 text-xs font-semibold text-[#475569] hover:bg-[#f1f5f9]"
                            onClick={() => {
                                const t = newText({ text: '새 텍스트', y: 20 });
                                updateCard(active, (c) => ({ ...c, texts: [...c.texts, t] }));
                                setSelId(t.id);
                            }}
                            type="button"
                        >
                            + 텍스트 추가
                        </button>
                        <button
                            className="rounded-md border border-[#cbd5e1] px-3 py-2 text-xs font-semibold text-[#475569] hover:bg-[#f1f5f9] disabled:opacity-50"
                            disabled={busy}
                            onClick={() => void downloadOne(active)}
                            type="button"
                        >
                            이 카드 PNG
                        </button>
                    </div>
                </div>

                {/* 텍스트 목록 + 편집 */}
                <div className="grid content-start gap-2">
                    <div className="text-xs font-bold text-[#334155]">텍스트 ({card.texts.length}) — 클릭해 선택, 미리보기에서 드래그로 이동</div>
                    <div className="flex flex-wrap gap-1.5">
                        {card.texts.map((t) => (
                            <button
                                key={t.id}
                                className={`max-w-[160px] truncate rounded border px-2 py-1 text-[11px] ${
                                    selId === t.id ? 'border-[#1e40af] bg-[#eff6ff] text-[#1e40af]' : 'border-[#cbd5e1] text-[#475569]'
                                }`}
                                onClick={() => setSelId(t.id)}
                                type="button"
                            >
                                {t.text.split('\n')[0] || '(빈 텍스트)'}
                            </button>
                        ))}
                    </div>

                    {sel ? (
                        <div className="grid gap-2 rounded-lg border border-[#e2e8f0] p-3">
                            <textarea
                                className="w-full rounded border border-[#cbd5e1] px-2 py-1.5 text-sm"
                                onChange={(e) => updateText(sel.id, { text: e.target.value })}
                                placeholder="여러 줄 가능"
                                rows={2}
                                value={sel.text}
                            />
                            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                                <label className={lbl}>
                                    크기(px)
                                    <input className={num} onChange={(e) => updateText(sel.id, { size: Number(e.target.value) || 0 })} type="number" value={sel.size} />
                                </label>
                                <label className={lbl}>
                                    굵기
                                    <select className={num} onChange={(e) => updateText(sel.id, { weight: Number(e.target.value) })} value={sel.weight}>
                                        {[400, 500, 600, 700, 800, 900].map((w) => (
                                            <option key={w} value={w}>{w}</option>
                                        ))}
                                    </select>
                                </label>
                                <label className={lbl}>
                                    색상
                                    <input className="h-8 w-full rounded border border-[#cbd5e1]" onChange={(e) => updateText(sel.id, { color: e.target.value })} type="color" value={sel.color} />
                                </label>
                                <label className={lbl}>
                                    정렬
                                    <select className={num} onChange={(e) => updateText(sel.id, { align: e.target.value as TextEl['align'] })} value={sel.align}>
                                        <option value="left">왼쪽</option>
                                        <option value="center">가운데</option>
                                        <option value="right">오른쪽</option>
                                    </select>
                                </label>
                                <label className={lbl}>
                                    X(%)
                                    <input className={num} onChange={(e) => updateText(sel.id, { x: Number(e.target.value) })} type="number" value={Math.round(sel.x)} />
                                </label>
                                <label className={lbl}>
                                    Y(%)
                                    <input className={num} onChange={(e) => updateText(sel.id, { y: Number(e.target.value) })} type="number" value={Math.round(sel.y)} />
                                </label>
                                <label className={lbl}>
                                    폭(%)
                                    <input className={num} onChange={(e) => updateText(sel.id, { w: Number(e.target.value) })} type="number" value={sel.w} />
                                </label>
                                <label className={lbl}>
                                    줄간격
                                    <input className={num} onChange={(e) => updateText(sel.id, { lh: Number(e.target.value) || 1 })} step={0.05} type="number" value={sel.lh} />
                                </label>
                            </div>
                            <div className="flex items-center gap-3">
                                <label className="flex items-center gap-1 text-[11px] font-semibold text-[#475569]">
                                    <input checked={sel.shadow} onChange={(e) => updateText(sel.id, { shadow: e.target.checked })} type="checkbox" />
                                    그림자
                                </label>
                                <label className="flex items-center gap-1 text-[11px] font-semibold text-[#475569]">
                                    자간
                                    <input className="h-7 w-16 rounded border border-[#cbd5e1] px-1 text-sm" onChange={(e) => updateText(sel.id, { ls: Number(e.target.value) })} step={0.5} type="number" value={sel.ls} />
                                </label>
                                <button
                                    className="ml-auto rounded border border-[#fca5a5] px-2 py-1 text-[11px] font-semibold text-[#dc2626] hover:bg-[#fef2f2]"
                                    onClick={() => {
                                        updateCard(active, (c) => ({ ...c, texts: c.texts.filter((x) => x.id !== sel.id) }));
                                        setSelId(null);
                                    }}
                                    type="button"
                                >
                                    이 텍스트 삭제
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div className="rounded-lg border border-dashed border-[#cbd5e1] bg-[#f8fafc] px-3 py-6 text-center text-xs text-[#94a3b8]">
                            텍스트를 선택하면 편집 옵션이 나옵니다.
                        </div>
                    )}
                </div>
            </div>

            <div className="flex items-center gap-2">
                <button
                    className="rounded-md bg-[#059669] px-5 py-2.5 text-sm font-bold text-white hover:bg-[#047857] disabled:opacity-50"
                    disabled={busy}
                    onClick={() => void downloadZip()}
                    type="button"
                >
                    {busy ? '생성 중…' : `전체 ${cards.length}장 ZIP 다운로드`}
                </button>
                {msg ? <span className="text-xs text-[#64748b]">{msg}</span> : null}
            </div>

            {/* 내보내기용 숨김 원본(1080) — 모든 카드 */}
            <div style={{ position: 'fixed', left: -99999, top: 0, pointerEvents: 'none' }} aria-hidden>
                {cards.map((c, i) => (
                    <div
                        key={i}
                        ref={(el) => {
                            exportRefs.current[i] = el;
                        }}
                        style={{ width: CARD, height: CARD }}
                    >
                        <CardCanvas card={c} />
                    </div>
                ))}
            </div>
        </div>
    );
}
