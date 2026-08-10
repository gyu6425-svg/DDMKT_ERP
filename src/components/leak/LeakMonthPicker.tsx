import { LEAK_MONTHS, setLeakMonth, useLeakMonth } from './leakMonth';

// 사이드바 월 필터 드롭다운 — 누수탐지 ERP 전 탭 공용. 전체 / 1월~12월.
export function LeakMonthPicker() {
    const month = useLeakMonth();
    return (
        <div className="grid gap-1">
            <span className="text-[11px] font-semibold text-[#94a3b8]">월별 보기</span>
            <select
                value={month}
                onChange={(e) => setLeakMonth(e.target.value)}
                className="h-9 rounded-md border border-[#cbd5e1] bg-white px-2 text-sm font-semibold text-[#334155]"
            >
                <option value="">전체</option>
                {LEAK_MONTHS.map((m) => <option key={m.v} value={m.v}>{m.label}</option>)}
            </select>
        </div>
    );
}
