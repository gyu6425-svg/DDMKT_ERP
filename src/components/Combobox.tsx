import { useEffect, useRef, useState } from 'react';

// 검색 가능한 콤보박스 — 프리셋 목록 필터 + 리스트 밖 값 직접 입력 허용. 외부 라이브러리 없음.
//   value/onChange controlled. 등록폼·계약추가 등에서 외주업체 선택에 재사용.
export function Combobox({
    value,
    onChange,
    options,
    placeholder,
    className,
}: {
    value: string;
    onChange: (value: string) => void;
    options: readonly string[];
    placeholder?: string;
    className?: string;
}) {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        const onDown = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', onDown);
        return () => document.removeEventListener('mousedown', onDown);
    }, [open]);

    const q = value.trim().toLowerCase();
    const filtered = q ? options.filter((o) => o.toLowerCase().includes(q)) : options;
    const showCustom = value.trim() !== '' && !options.some((o) => o === value.trim());

    return (
        <div className="relative" ref={ref}>
            <input
                className={className ?? 'erp-input w-full min-w-0'}
                onChange={(e) => {
                    onChange(e.target.value);
                    setOpen(true);
                }}
                onFocus={() => setOpen(true)}
                placeholder={placeholder ?? '선택 또는 직접 입력'}
                value={value}
            />
            {open && (filtered.length || showCustom) ? (
                <div className="absolute z-[70] mt-1 max-h-48 w-full overflow-y-auto rounded-md border border-[#cbd5e1] bg-white shadow-lg">
                    {filtered.map((o) => (
                        <button
                            className="block w-full px-3 py-1.5 text-left text-sm hover:bg-[#eff6ff]"
                            key={o}
                            onMouseDown={(e) => {
                                e.preventDefault();
                                onChange(o);
                                setOpen(false);
                            }}
                            type="button"
                        >
                            {o}
                        </button>
                    ))}
                    {showCustom ? (
                        <button
                            className="block w-full border-t border-[#eef2f7] px-3 py-1.5 text-left text-sm text-[#64748b] hover:bg-[#eff6ff]"
                            onMouseDown={(e) => {
                                e.preventDefault();
                                setOpen(false);
                            }}
                            type="button"
                        >
                            직접 입력: <b className="text-[#1e40af]">{value.trim()}</b>
                        </button>
                    ) : null}
                </div>
            ) : null}
        </div>
    );
}
