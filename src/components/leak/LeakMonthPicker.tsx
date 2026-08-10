import { LEAK_MONTHS } from './leakMonth';

// 월 필터 드롭다운(제어형) — 각 탭이 자기 로컬 state로 독립 관리. value/onChange 로 그 탭에만 적용.
export function LeakMonthPicker({ value, onChange, className = '' }: { value: string; onChange: (m: string) => void; className?: string }) {
    return (
        <select
            value={value}
            onChange={(e) => onChange(e.target.value)}
            title="월별 보기"
            className={`h-9 shrink-0 rounded-md border border-[#cbd5e1] bg-white px-2 text-sm font-semibold text-[#334155] ${className}`}
        >
            <option value="">전체 기간</option>
            {LEAK_MONTHS.map((m) => <option key={m.v} value={m.v}>{m.label}</option>)}
        </select>
    );
}
