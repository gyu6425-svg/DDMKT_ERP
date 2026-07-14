// 관리 시트 → 엑셀(CSV) 내보내기. UTF-8 BOM 을 앞에 붙여 엑셀에서 한글이 깨지지 않게 한다.
//   xlsx 라이브러리 없이 CSV 로 처리(엑셀에서 바로 열림). headers + rows(2차원 배열).
type Cell = string | number | null | undefined;

export function downloadCsv(filename: string, headers: string[], rows: Cell[][]): void {
    const esc = (v: Cell) => {
        const s = v == null ? '' : String(v);
        return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const body = [headers, ...rows].map((r) => r.map(esc).join(',')).join('\r\n');
    const blob = new Blob(['﻿' + body], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
}

// 오늘 날짜(YYYY-MM-DD) — 파일명용.
export function todayTag(): string {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}
