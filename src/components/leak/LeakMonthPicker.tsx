import { LEAK_MONTHS, setLeakMonth, useLeakMonth } from './leakMonth';

// 월 필터 드롭다운 — 누수탐지 ERP 각 탭 상단(헤더)에 배치. 전 탭 공용 상태라 어느 탭에서 바꿔도 동기화.
export function LeakMonthPicker({ className = '' }: { className?: string }) {
    const month = useLeakMonth();
    return (
        <select
            value={month}
            onChange={(e) => setLeakMonth(e.target.value)}
            title="월별 보기"
            className={`h-9 shrink-0 rounded-md border border-[#cbd5e1] bg-white px-2 text-sm font-semibold text-[#334155] ${className}`}
        >
            <option value="">전체 기간</option>
            {LEAK_MONTHS.map((m) => <option key={m.v} value={m.v}>{m.label}</option>)}
        </select>
    );
}
