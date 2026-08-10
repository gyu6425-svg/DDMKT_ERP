import { useEffect, useState } from 'react';

// 누수탐지 ERP 공용 '월' 필터 — 사이드바 드롭다운이 정하고 모든 탭이 읽어 같은 월로 필터.
//   값 = '' (전체) 또는 '01'~'12' (월만; 연도는 2027 넘어갈 때 확장). 현재 데이터는 전부 2026년이라 월만으로 충분.
//   공유 방식 = localStorage + 커스텀 이벤트(사이드바와 페이지가 서로 다른 서브트리라 URL/컨텍스트 대신 이 방식).
const KEY = 'leakMonth';
const EVT = 'leak:month';

export function getLeakMonth(): string {
    try { return localStorage.getItem(KEY) || ''; } catch { return ''; }
}
export function setLeakMonth(m: string): void {
    try { if (m) localStorage.setItem(KEY, m); else localStorage.removeItem(KEY); } catch { /* 무시 */ }
    window.dispatchEvent(new CustomEvent(EVT));
}
// 반응형 구독 — 사이드바가 바꾸면 모든 탭이 즉시 재필터.
export function useLeakMonth(): string {
    const [m, setM] = useState(getLeakMonth);
    useEffect(() => {
        const sync = () => setM(getLeakMonth());
        window.addEventListener(EVT, sync);
        window.addEventListener('storage', sync);   // 다른 탭/창 동기화
        return () => { window.removeEventListener(EVT, sync); window.removeEventListener('storage', sync); };
    }, []);
    return m;
}
// 날짜(YYYY-MM-DD 또는 ISO)가 선택 월에 속하는지. m='' → 전체 통과.
export function inLeakMonth(date: string | null | undefined, m: string): boolean {
    if (!m) return true;
    return (date || '').slice(5, 7) === m;
}
// 드롭다운 옵션 라벨 — '1월'…'12월'.
export const LEAK_MONTHS: { v: string; label: string }[] = Array.from({ length: 12 }, (_, i) => {
    const mm = String(i + 1).padStart(2, '0');
    return { v: mm, label: `${i + 1}월` };
});
