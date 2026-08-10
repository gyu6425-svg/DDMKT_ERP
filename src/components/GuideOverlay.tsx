import { useEffect, useLayoutEffect, useState, type CSSProperties } from 'react';

// 사용 가이드(온보딩 투어) — 전체 배경을 검정+블러로 덮고, 타겟 요소만 빨간 네모로 마크해 단계별 설명.
//   steps[i].selector 로 타겟을 찾아 스포트라이트(주변 4패널만 어둡게 → 타겟은 선명) + 빨간 박스.
//   타겟을 못 찾으면 중앙 카드(폴백)로 그 단계 설명만 표시하고 계속 진행 가능(끊기지 않게).
export type GuideStep = {
    selector?: string;   // CSS 선택자(없으면 중앙 안내만)
    title: string;
    body: string;
};

const PAD = 8;          // 하이라이트 여백
const CARD_W = 320;     // 안내 카드 폭
const GAP = 14;         // 타겟과 카드 간격

export function GuideOverlay({ steps, onFinish }: { steps: GuideStep[]; onFinish: () => void }) {
    const [i, setI] = useState(0);
    const [rect, setRect] = useState<DOMRect | null>(null);
    const step = steps[i];
    const last = i >= steps.length - 1;

    // 단계 바뀔 때 1회 타겟으로 스크롤(중앙 정렬).
    useEffect(() => {
        if (!step?.selector) return;
        const el = document.querySelector(step.selector);
        el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, [i, step?.selector]);

    // 타겟 위치 추적 — 스크롤/리사이즈/레이아웃 변동에 대응(250ms 폴링).
    useLayoutEffect(() => {
        const update = () => {
            const el = step?.selector ? document.querySelector(step.selector) : null;
            setRect(el ? el.getBoundingClientRect() : null);
        };
        update();
        const t = setInterval(update, 250);
        window.addEventListener('resize', update);
        window.addEventListener('scroll', update, true);
        return () => { clearInterval(t); window.removeEventListener('resize', update); window.removeEventListener('scroll', update, true); };
    }, [i, step?.selector]);

    // 키보드: ESC=종료 / ← 이전 / → 다음. (Enter 는 버튼 네이티브 처리에 맡겨 이중 전진 방지)
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onFinish();
            else if (e.key === 'ArrowRight') { if (last) onFinish(); else setI((v) => v + 1); }
            else if (e.key === 'ArrowLeft') setI((v) => Math.max(0, v - 1));
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [last, onFinish]);

    if (!step) return null;

    // 하이라이트 박스(여백 포함) — 뷰포트 밖으로 안 나가게 클램프.
    const r = rect
        ? {
              top: Math.max(0, rect.top - PAD),
              left: Math.max(0, rect.left - PAD),
              width: rect.width + PAD * 2,
              height: rect.height + PAD * 2,
          }
        : null;

    const vh = window.innerHeight;
    const vw = window.innerWidth;

    // 카드 위치 — 타겟 아래 우선, 공간 없으면 위, 그것도 없으면 화면 중앙.
    const cardStyle: CSSProperties = (() => {
        if (!r) return { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };
        const belowRoom = vh - (r.top + r.height) > 180;
        const left = Math.min(Math.max(12, r.left), vw - CARD_W - 12);
        return belowRoom
            ? { top: r.top + r.height + GAP, left }
            : { top: Math.max(12, r.top - GAP - 176), left };
    })();

    // 검정+블러 패널 공통 스타일.
    const panel = 'fixed bg-black/70 backdrop-blur-[3px]';

    return (
        <div className="fixed inset-0 z-[10000]" role="dialog" aria-modal="true" aria-label="사용 가이드">
            {r ? (
                <>
                    {/* 타겟 주변 4패널만 어둡게+블러 → 타겟은 선명하게 보인다 */}
                    <div className={panel} style={{ top: 0, left: 0, width: '100%', height: r.top }} />
                    <div className={panel} style={{ top: r.top + r.height, left: 0, width: '100%', bottom: 0 }} />
                    <div className={panel} style={{ top: r.top, left: 0, width: r.left, height: r.height }} />
                    <div className={panel} style={{ top: r.top, left: r.left + r.width, right: 0, height: r.height }} />
                    {/* 타겟 클릭 차단 — 가이드 중 하이라이트 요소가 실행되지 않게(예: '접수하기' 버튼 오클릭 방지). */}
                    <div className="fixed cursor-default"
                        style={{ top: r.top, left: r.left, width: r.width, height: r.height }}
                        onClick={(e) => { e.stopPropagation(); e.preventDefault(); }}
                        onMouseDown={(e) => e.preventDefault()} />
                    {/* 빨간 네모 마크 */}
                    <div className="pointer-events-none fixed rounded-lg"
                        style={{ top: r.top, left: r.left, width: r.width, height: r.height, border: '3px solid #ef4444', boxShadow: '0 0 0 2px rgba(239,68,68,0.35), 0 0 22px rgba(239,68,68,0.35)' }} />
                </>
            ) : (
                // 타겟 없음 — 전체 검정+블러
                <div className={`${panel}`} style={{ inset: 0, width: '100%', height: '100%' }} />
            )}

            {/* 안내 카드 */}
            <div className="fixed w-[320px] max-w-[calc(100vw-24px)] rounded-xl border border-[#ef4444]/40 bg-white p-4 shadow-2xl"
                style={cardStyle}>
                <div className="mb-1 flex items-center gap-2">
                    <span className="rounded-full bg-[#ef4444] px-2 py-0.5 text-[11px] font-bold text-white">{i + 1} / {steps.length}</span>
                    <div className="text-[15px] font-bold text-[#0f172a]">{step.title}</div>
                </div>
                <p className="m-0 mb-3 whitespace-pre-wrap text-[13px] leading-6 text-[#475569]">{step.body}</p>
                <div className="flex items-center gap-2">
                    <button type="button" onClick={onFinish} className="text-[12px] font-semibold text-[#94a3b8] hover:text-[#64748b]">건너뛰기</button>
                    <div className="ml-auto flex gap-2">
                        {i > 0 ? (
                            <button type="button" onClick={() => setI((v) => v - 1)}
                                className="h-9 rounded-lg border border-[#cbd5e1] bg-white px-4 text-[13px] font-bold text-[#475569] hover:bg-[#f8fafc]">이전</button>
                        ) : null}
                        <button type="button" onClick={() => (last ? onFinish() : setI((v) => v + 1))}
                            className="h-9 rounded-lg bg-[#ef4444] px-5 text-[13px] font-bold text-white hover:bg-[#dc2626]">{last ? '시작하기' : '다음'}</button>
                    </div>
                </div>
            </div>
        </div>
    );
}
