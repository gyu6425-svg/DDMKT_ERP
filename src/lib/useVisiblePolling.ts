import { useEffect, useRef } from 'react';

// 화면에 보일 때만 도는 폴링.
//
// 왜 필요한가 (실측 2026-08-14 — Supabase 무료 한도 초과)
//   Egress 6.709 / 5 GB (134%) · 청구주기 시작 이틀 만에 초과. 원인은 배경 탭 폴링이었다.
//     카페 대시보드/크롤현황  60초마다 474 KB  → 탭 1개당 약 0.7 GB/일
//     카페 발행탭             8초마다 130 KB   → 탭 1개당 약 1.4 GB/일
//   ERP 를 하루 종일 열어두면(보통 그렇게 쓴다) 보지도 않는 화면이 한도를 통째로 태운다.
//
// 동작
//   · 탭이 숨겨지면(다른 탭·최소화) 타이머를 아예 멈춘다 — 요청 0.
//   · 다시 보이면 즉시 1회 갱신하고 타이머를 재개한다 → 화면은 항상 최신으로 보인다.
//   · 최초 1회 로드는 호출부가 그대로 담당한다(이 훅은 '반복'만 맡는다).
export function useVisiblePolling(fn: () => void | Promise<void>, ms: number) {
    const ref = useRef(fn);
    ref.current = fn;
    useEffect(() => {
        let timer: number | undefined;
        const visible = () => document.visibilityState === 'visible';
        const stop = () => { if (timer !== undefined) { window.clearInterval(timer); timer = undefined; } };
        const start = () => { stop(); timer = window.setInterval(() => { if (visible()) void ref.current(); }, ms); };
        const onVis = () => {
            if (visible()) { void ref.current(); start(); } else stop();
        };
        if (visible()) start();
        document.addEventListener('visibilitychange', onVis);
        return () => { stop(); document.removeEventListener('visibilitychange', onVis); };
    }, [ms]);
}
