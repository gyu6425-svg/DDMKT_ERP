// 누수탐지 ERP '월' 필터 헬퍼 — 각 탭이 자기 로컬 state로 독립 관리(공용 아님).
//   값 = '' (전체) 또는 '01'~'12' (월만; 연도는 2027 넘어갈 때 확장). 현재 데이터는 전부 2026년이라 월만으로 충분.

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
