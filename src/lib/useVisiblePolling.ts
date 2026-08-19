import { useEffect, useRef } from 'react';

// 화면에 보이고, 사람이 최근에 만졌을 때만 도는 폴링.
//
// 왜 필요한가
//   ① 배경 탭 (실측 2026-08-18 · Egress 6.7→10.5GB 초과)
//      카페 대시보드/크롤현황 60초마다 474KB · 발행탭 8초마다 130KB ·
//      블로그 크롤현황 15초마다 1.5MB. 보지도 않는 화면이 한도를 통째로 태웠다.
//   ② 모니터만 끈 PC (SUB3 지적 2026-08-19)  ← 이게 더 크다
//      사무실 PC 는 "절전 안 함 + 모니터만 끄기"로 상시가동한다. 이때 브라우저 탭은
//      visibilityState 가 'visible' 로 남는다 — ①의 가시성 게이트가 통째로 무력화된다.
//      퇴근 후 14시간을 그대로 받아내며, 추정 0.3~0.9 GB/일.
//
// 그래서 두 조건을 모두 본다.
//   · 탭이 화면에 보이는가 (visibilityState)
//   · 사람이 최근 IDLE_MS 안에 입력했는가 (마우스·키보드·스크롤·터치)
//   둘 중 하나라도 아니면 요청을 아예 보내지 않는다. 사람이 다시 만지면 즉시 1회 갱신하고 재개한다.
//   → 사장님이 탭을 닫는 걸 잊어도 새는 일이 없다.
const IDLE_MS = 15 * 60 * 1000;   // 15분간 아무 입력 없으면 '자리 비움'으로 본다

let lastInput = Date.now();
let bound = false;
function bindActivity() {
    if (bound || typeof window === 'undefined') return;
    bound = true;
    const touch = () => { lastInput = Date.now(); };
    // passive — 스크롤 성능에 영향 주지 않게.
    for (const ev of ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart', 'scroll']) {
        window.addEventListener(ev, touch, { passive: true });
    }
    // 탭으로 돌아오는 것도 '사람이 왔다'는 신호다.
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') touch();
    });
}

/** 사람이 지금 보고 있는가 — 폴링·구독을 돌릴지 판단하는 공통 기준. */
export function isUserPresent(): boolean {
    if (typeof document === 'undefined') return false;
    return document.visibilityState === 'visible' && (Date.now() - lastInput) < IDLE_MS;
}

export function useVisiblePolling(fn: () => void | Promise<void>, ms: number) {
    const ref = useRef(fn);
    ref.current = fn;
    useEffect(() => {
        bindActivity();
        let timer: number | undefined;
        let idle = false;                       // 자리 비움 상태였는지 — 돌아왔을 때 즉시 1회 갱신하려고
        const stop = () => { if (timer !== undefined) { window.clearInterval(timer); timer = undefined; } };
        const tick = () => {
            if (!isUserPresent()) { idle = true; return; }
            if (idle) { idle = false; }         // 돌아왔다 — 이번 tick 에서 바로 받는다
            void ref.current();
        };
        timer = window.setInterval(tick, ms);
        const onVis = () => { if (document.visibilityState === 'visible') tick(); };
        document.addEventListener('visibilitychange', onVis);
        return () => { stop(); document.removeEventListener('visibilitychange', onVis); };
    }, [ms]);
}
