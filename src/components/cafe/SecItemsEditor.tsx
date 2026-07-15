// 보안 배너 '하단 3개 항목' 직접 입력 에디터(더맨시스템/더맨시스템2 공용).
//   기본은 자동(보안종류 프리셋 또는 AI). 켜면 소제목·설명·아이콘을 직접 지정 → 그 값으로 렌더(추가 0원).

export type SecItem = { title: string; subtitle: string; icon: string };

// gpt-image가 그릴 단순 라인아이콘 키워드(영어). 필요시 추가 가능.
export const SEC_ICON_OPTS = ['shield', 'monitor', 'keycard', 'people', 'lock', 'car', 'clock', 'camera', 'checklist', 'siren'];

export const EMPTY_SEC_ITEMS: SecItem[] = [
    { title: '', subtitle: '', icon: 'monitor' },
    { title: '', subtitle: '', icon: 'keycard' },
    { title: '', subtitle: '', icon: 'shield' },
];

export function SecItemsEditor({
    enabled,
    setEnabled,
    items,
    setItems,
    accent,
}: {
    enabled: boolean;
    setEnabled: (v: boolean) => void;
    items: SecItem[];
    setItems: (v: SecItem[]) => void;
    accent: string;
}) {
    const patch = (i: number, key: keyof SecItem, val: string) =>
        setItems(items.map((it, idx) => (idx === i ? { ...it, [key]: val } : it)));

    return (
        <div className="mt-3">
            <label className="flex cursor-pointer items-center gap-2 text-[12px] font-semibold text-[#475569]">
                <input checked={enabled} onChange={(e) => setEnabled(e.target.checked)} type="checkbox" style={{ accentColor: accent }} />
                하단 3개 직접 입력 <span className="font-normal text-[#94a3b8]">(끄면 보안종류에 맞춰 자동)</span>
            </label>
            {enabled ? (
                <div className="mt-2 grid gap-2">
                    {items.map((it, i) => (
                        <div className="grid grid-cols-[1fr_1.3fr_auto] gap-2" key={i}>
                            <input
                                className="h-9 rounded-md border border-[#cbd5e1] bg-white px-2.5 text-sm"
                                onChange={(e) => patch(i, 'title', e.target.value)}
                                placeholder={`소제목 ${i + 1} (예: 24시 관제)`}
                                value={it.title}
                            />
                            <input
                                className="h-9 rounded-md border border-[#cbd5e1] bg-white px-2.5 text-sm"
                                onChange={(e) => patch(i, 'subtitle', e.target.value)}
                                placeholder={`설명 ${i + 1} (예: 실시간 모니터링)`}
                                value={it.subtitle}
                            />
                            <select
                                className="h-9 rounded-md border border-[#cbd5e1] bg-white px-2 text-sm"
                                onChange={(e) => patch(i, 'icon', e.target.value)}
                                title="아이콘"
                                value={it.icon}
                            >
                                {SEC_ICON_OPTS.map((ic) => (
                                    <option key={ic} value={ic}>
                                        {ic}
                                    </option>
                                ))}
                            </select>
                        </div>
                    ))}
                    <span className="text-[11px] text-[#94a3b8]">
                        3개 소제목을 모두 채우면 이 값으로 렌더됩니다(비어 있으면 자동으로 대체). 저화질에선 글자가 많으면 깨질 수 있어요.
                    </span>
                </div>
            ) : null}
        </div>
    );
}

// 직접 입력이 유효(3개 소제목 채움)하면 배열 반환, 아니면 undefined(자동 사용).
export function resolveSecItems(enabled: boolean, items: SecItem[]): SecItem[] | undefined {
    if (!enabled) return undefined;
    const filled = items.filter((i) => i.title.trim());
    return filled.length === 3 ? items : undefined;
}
