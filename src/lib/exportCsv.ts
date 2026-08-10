// 관리 시트 → 엑셀(CSV) 내보내기. UTF-8 BOM 을 앞에 붙여 엑셀에서 한글이 깨지지 않게 한다.
//   xlsx 라이브러리 없이 CSV 로 처리(엑셀에서 바로 열림). headers + rows(2차원 배열).
type Cell = string | number | null | undefined;

// 날짜(YYYY-MM-DD [HH:MM[:SS]])는 엑셀이 '날짜 값'으로 바꿔 버린다. 그러면 기본 열 너비(8.43자)보다
//   길어서 화면에 '#######' 로만 보인다 — 값이 없는 게 아니라 너비 때문에 가려지는 것이다.
//   CSV 로는 열 너비를 지정할 수 없으므로 ="..." 로 감싸 텍스트로 고정한다(엑셀·구글시트 모두 그대로 보인다).
//   실측 2026-08-10: 카페 누적발행 내려받기의 발행일 열이 전부 '#######' 이었다.
const DATE_LIKE = /^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?$/;

export function downloadCsv(filename: string, headers: string[], rows: Cell[][]): void {
    const esc = (v: Cell) => {
        const s = v == null ? '' : String(v);
        if (DATE_LIKE.test(s)) return `"=""${s}"""`;
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
