import { useState, type ReactNode } from 'react';

// 이미지 드래그&드롭 영역 — 파일을 끌어다 놓으면 onFiles 로 넘긴다.
//   클릭 업로드(+ 추가 / 이미지 추가 버튼)는 children 이 그대로 담당하고, 여기서는 드롭만 얹는다.
//   · 이미지가 아닌 파일은 걸러 낸다(엑셀·PDF를 떨궈도 조용히 무시되지 않게 안내).
//   · 드래그 중에는 테두리를 강조하고 "여기에 놓으세요" 오버레이를 띄운다.
//   · 브라우저 기본 동작(파일을 새 탭으로 여는 것)을 막기 위해 dragover 에서 preventDefault 필수.
export function ImageDropZone({
    onFiles,
    className = '',
    children,
    disabled = false,
    label = '여기에 놓으면 추가됩니다',
}: {
    onFiles: (files: File[]) => void;
    className?: string;
    children: ReactNode;
    disabled?: boolean;
    label?: string;
}) {
    const [over, setOver] = useState(false);
    const [warn, setWarn] = useState('');

    const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        setOver(false);
        if (disabled) return;
        const all = Array.from(e.dataTransfer?.files ?? []);
        const imgs = all.filter((f) => f.type.startsWith('image/'));
        if (!all.length) return;
        if (!imgs.length) {
            setWarn('이미지 파일만 넣을 수 있습니다');
            window.setTimeout(() => setWarn(''), 2500);
            return;
        }
        if (imgs.length < all.length) {
            setWarn(`이미지 ${imgs.length}장만 추가했습니다(나머지는 이미지가 아님)`);
            window.setTimeout(() => setWarn(''), 2500);
        }
        onFiles(imgs);
    };

    return (
        <div
            className={`relative ${className} ${over ? 'ring-2 ring-[#4338ca] ring-offset-1' : ''}`}
            onDragEnter={(e) => { if (!disabled) { e.preventDefault(); setOver(true); } }}
            onDragOver={(e) => { if (!disabled) { e.preventDefault(); setOver(true); } }}
            onDragLeave={(e) => {
                // 자식 요소로 넘어갈 때도 leave 가 뜬다 → 영역 밖으로 나갈 때만 해제.
                if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
                setOver(false);
            }}
            onDrop={handleDrop}
        >
            {children}
            {over ? (
                <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-[#4338ca]/10">
                    <span className="rounded-md bg-[#4338ca] px-2.5 py-1 text-[12px] font-bold text-white">{label}</span>
                </div>
            ) : null}
            {warn ? (
                <div className="mt-1 text-center text-[11px] font-semibold text-[#b45309]">{warn}</div>
            ) : null}
        </div>
    );
}
