import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';

// 사용 가이드(온보딩 투어) — 전체 배경을 검정+블러로 덮고, 타겟 요소만 빨간 네모로 마크해 단계별 설명.
//   steps[i].selector 로 타겟을 찾아 스포트라이트(주변 4패널만 어둡게 → 타겟은 선명) + 빨간 박스.
//   타겟을 못 찾으면 중앙 카드(폴백)로 그 단계 설명만 표시하고 계속 진행 가능(끊기지 않게).
export type GuideStep = {
    // CSS 선택자(없으면 중앙 안내만).
    //   '||' 로 여러 개를 이어 붙이면 **앞에서부터** 화면에 실제로 보이는 첫 요소를 잡는다.
    //   왜 콤마(CSS 그룹 선택자)가 아니라 '||' 인가: querySelector 는 콤마를 써도 '문서 순서'로
    //   먼저 나오는 것을 준다. 바깥 상자와 그 안의 항목을 함께 적으면 항상 바깥 상자가 잡혀
    //   폴백이 본선을 이긴다. 우선순위를 우리가 정하려면 하나씩 순서대로 확인해야 한다.
    selector?: string;
    title: string;
    body: string;
};

// 보이는(0×0 아니고 숨겨지지 않은) 첫 후보를 찾는다. 후보가 하나뿐이면 종전과 같다.
export function resolveTarget(selector?: string): HTMLElement | null {
    if (!selector) return null;
    for (const sel of selector.split('||').map((s) => s.trim()).filter(Boolean)) {
        for (const el of Array.from(document.querySelectorAll(sel)) as HTMLElement[]) {
            const r = el.getBoundingClientRect();
            if ((r.width > 0 || r.height > 0) && el.offsetParent !== null) return el;
        }
    }
    return null;
}

const PAD = 8;          // 하이라이트 여백
const CARD_W = 320;     // 안내 카드 폭
const GAP = 14;         // 타겟과 카드 간격
const MISS_MS = 1200;   // 이 시간 넘게 타겟을 못 찾으면 카드에 "지금 화면에 없음" 안내

export function GuideOverlay({ steps, onFinish }: { steps: GuideStep[]; onFinish: () => void }) {
    const [i, setI] = useState(0);
    const [rect, setRect] = useState<DOMRect | null>(null);
    const [missing, setMissing] = useState(false);   // 타겟을 계속 못 찾는 중
    // 타겟으로 다시 스크롤 — 화면 밖으로 밀렸을 때 카드에서 눌러 되돌린다.
    const scrollToTarget = () => {
        resolveTarget(steps[Math.min(i, steps.length - 1)]?.selector)?.scrollIntoView({ block: 'center', behavior: 'auto' });
    };
    const cardRef = useRef<HTMLDivElement | null>(null);
    const [cardH, setCardH] = useState(176);         // 실제 카드 높이(위쪽 배치 계산용)

    // 단계 수가 줄어(모드 변경 등) 현재 인덱스가 범위를 벗어나면 마지막 단계로 당긴다.
    //   안 하면 step=undefined → 오버레이만 사라지고 onFinish 는 안 불려 '죽은 채 살아있는' 상태가 된다.
    useEffect(() => {
        if (!steps.length) { onFinish(); return; }
        if (i > steps.length - 1) setI(steps.length - 1);
    }, [steps.length, i, onFinish]);

    const step = steps[Math.min(i, Math.max(0, steps.length - 1))];
    const last = i >= steps.length - 1;

    // 단계 바뀔 때 1회 타겟으로 스크롤. smooth 면 좌표가 뒤늦게 확정돼 카드가 튄다 → 즉시 이동.
    useEffect(() => {
        setMissing(false);
        if (!step?.selector) return;
        resolveTarget(step.selector)?.scrollIntoView({ block: 'center', behavior: 'auto' });
    }, [i, step?.selector]);

    // 타겟 위치 추적 — 스크롤/리사이즈/레이아웃 변동에 대응(250ms 폴링).
    //   ⚠️ 접힌 details·hidden 안의 요소는 DOM 에는 있지만 rect 가 0×0 이다. 그대로 쓰면
    //      화면 좌상단에 16px 빨간 점을 찍고 하이라이트라 우기게 된다 → '없음'으로 취급.
    useLayoutEffect(() => {
        const t0 = Date.now();
        const update = () => {
            const el = resolveTarget(step?.selector);   // 보이는 후보만 돌려준다(0×0·hidden 제외)
            setRect(el ? el.getBoundingClientRect() : null);
            if (step?.selector) setMissing(!el && Date.now() - t0 > MISS_MS);
        };
        update();
        const t = setInterval(update, 250);
        window.addEventListener('resize', update);
        window.addEventListener('scroll', update, true);
        return () => { clearInterval(t); window.removeEventListener('resize', update); window.removeEventListener('scroll', update, true); };
    }, [i, step?.selector]);

    // 카드 실제 높이 측정 — 위쪽 배치에서 176px 고정값을 쓰면 긴 안내문이 화면 밖으로 나간다.
    useLayoutEffect(() => {
        const h = cardRef.current?.offsetHeight;
        if (h && Math.abs(h - cardH) > 4) setCardH(h);
    });

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

    const vh = window.innerHeight;
    const vw = window.innerWidth;

    // 하이라이트 박스(여백 포함) — 뷰포트와 교집합으로 자른다.
    //   폭·높이를 안 줄이면 사진 업로드처럼 화면보다 큰 블록에서 테두리 아랫변이 실제 요소 밖에 그려지고
    //   4분할 마스크도 어긋난다(아래쪽이 안 어두워짐).
    const r = (() => {
        if (!rect) return null;
        const top = Math.max(0, rect.top - PAD);
        const left = Math.max(0, rect.left - PAD);
        const bottom = Math.min(vh, rect.bottom + PAD);
        const right = Math.min(vw, rect.right + PAD);
        const height = Math.max(0, bottom - top);
        const width = Math.max(0, right - left);
        return height && width ? { top, left, width, height } : null;
    })();
    // 타겟은 있는데 스크롤 때문에 화면 밖으로 밀린 경우 — '못 찾음'과 구분해 되돌릴 손잡이를 준다.
    const offscreen = !!rect && !r;

    // 카드 위치 — 타겟 아래 우선, 공간 없으면 위, 그것도 없으면 화면 중앙.
    //   top 에 상한을 둔다(하한만 있으면 타겟이 화면 아래에 있을 때 카드가 화면 밖으로 나간다).
    const cardStyle: CSSProperties = (() => {
        if (!r) return { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };
        const belowRoom = vh - (r.top + r.height) > cardH + GAP + 12;
        const left = Math.min(Math.max(12, r.left), Math.max(12, vw - CARD_W - 12));
        const rawTop = belowRoom ? r.top + r.height + GAP : r.top - GAP - cardH;
        return { top: Math.min(Math.max(12, rawTop), Math.max(12, vh - cardH - 12)), left };
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
            {/* max-h + 스크롤 — 안내문이 길거나 화면이 낮으면 '다음' 버튼이 화면 밖으로 나가 눌리지 않는다. */}
            <div ref={cardRef} className="fixed flex max-h-[calc(100vh-24px)] w-[320px] max-w-[calc(100vw-24px)] flex-col overflow-y-auto rounded-xl border border-[#ef4444]/40 bg-white p-4 shadow-2xl"
                style={cardStyle}>
                <div className="mb-1 flex items-center gap-2">
                    <span className="rounded-full bg-[#ef4444] px-2 py-0.5 text-[11px] font-bold text-white">{i + 1} / {steps.length}</span>
                    <div className="text-[15px] font-bold text-[#0f172a]">{step.title}</div>
                </div>
                <p className="m-0 mb-3 whitespace-pre-wrap text-[13px] leading-6 text-[#475569]">{step.body}</p>
                {/* 타겟을 못 찾을 때 — 새까만 화면만 보여 주지 않고 이유를 밝힌다. */}
                {offscreen ? (
                    <p className="m-0 mb-3 flex items-center gap-2 rounded-md bg-[#eff6ff] px-2 py-1.5 text-[12px] font-semibold text-[#1d4ed8]">
                        화면 밖으로 밀렸습니다
                        <button type="button" onClick={scrollToTarget}
                            className="rounded border border-[#93c5fd] bg-white px-2 py-0.5 text-[11px] font-bold text-[#1d4ed8] hover:bg-[#eff6ff]">
                            이 항목 보기
                        </button>
                    </p>
                ) : missing ? (
                    <p className="m-0 mb-3 rounded-md bg-[#fff7ed] px-2 py-1.5 text-[12px] font-semibold text-[#9a3412]">
                        이 항목은 지금 화면에 없습니다 — 아직 이 단계가 아니라 화면에 없는 항목입니다. 다음으로 넘어가세요.
                    </p>
                ) : null}
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
