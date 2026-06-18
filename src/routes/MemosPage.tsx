import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { todayStr } from '../lib/erpUtils';

type Memo = {
    id: string;
    text: string;
    color: string;
    author: string;
    date: string;
};

const MEMOS_KEY = 'erp_memos';
const COLORS = ['#fef9c3', '#dbeafe', '#dcfce7', '#fce7f3', '#fee2e2', '#f3e8ff'];

function loadMemos(): Memo[] {
    try {
        return JSON.parse(localStorage.getItem(MEMOS_KEY) || '[]');
    } catch {
        return [];
    }
}

function MemosPage() {
    const { profile } = useAuth();
    const author = profile?.name ?? '나';

    const [memos, setMemos] = useState<Memo[]>(loadMemos);
    const [text, setText] = useState('');
    const [color, setColor] = useState(COLORS[0]);
    const [search, setSearch] = useState('');

    useEffect(() => {
        localStorage.setItem(MEMOS_KEY, JSON.stringify(memos));
    }, [memos]);

    const addMemo = () => {
        const value = text.trim();
        if (!value) {
            return;
        }
        const memo: Memo = {
            author,
            color,
            date: todayStr(),
            id: `${author}-${value.length}-${memos.length}-${value.slice(0, 4)}`,
            text: value,
        };
        setMemos((current) => [memo, ...current]);
        setText('');
    };

    const removeMemo = (id: string) => {
        setMemos((current) => current.filter((memo) => memo.id !== id));
    };

    const filtered = useMemo(() => {
        const term = search.trim().toLowerCase();
        if (!term) {
            return memos;
        }
        return memos.filter(
            (memo) =>
                memo.text.toLowerCase().includes(term) ||
                memo.author.toLowerCase().includes(term),
        );
    }, [memos, search]);

    return (
        <section className="grid gap-4">
            <div>
                <h2 className="m-0 text-[22px] font-semibold text-[#0f172a]">메모</h2>
                <p className="mt-1 mb-0 text-sm text-[#64748b]">
                    간단한 업무 메모를 붙여둡니다 (이 브라우저에 저장)
                </p>
            </div>

            <div className="rounded-xl border border-[#e2e8f0] bg-white p-4">
                <textarea
                    className="min-h-[80px] w-full resize-y rounded-md border border-[#cbd5e1] px-3 py-2 text-sm"
                    onChange={(event) => setText(event.target.value)}
                    onKeyDown={(event) => {
                        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                            addMemo();
                        }
                    }}
                    placeholder="메모 내용... (Ctrl/⌘+Enter 로 추가)"
                    value={text}
                />
                <div className="mt-2 flex items-center justify-between gap-2">
                    <div className="flex gap-1.5">
                        {COLORS.map((c) => (
                            <button
                                className={`h-6 w-6 rounded-full border-2 ${
                                    color === c ? 'border-[#0f172a]' : 'border-transparent'
                                }`}
                                key={c}
                                onClick={() => setColor(c)}
                                style={{ background: c }}
                                type="button"
                            />
                        ))}
                    </div>
                    <button
                        className="rounded-md bg-[#1e40af] px-4 py-2 text-sm font-semibold text-white"
                        onClick={addMemo}
                        type="button"
                    >
                        + 메모 추가
                    </button>
                </div>
            </div>

            <input
                className="h-9 w-full rounded-md border border-[#cbd5e1] bg-white px-3 text-sm"
                onChange={(event) => setSearch(event.target.value)}
                placeholder="메모 검색..."
                value={search}
            />

            {filtered.length ? (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {filtered.map((memo) => (
                        <div
                            className="group relative rounded-xl p-4 shadow-sm"
                            key={memo.id}
                            style={{ background: memo.color }}
                        >
                            <p className="m-0 whitespace-pre-wrap break-words text-sm text-[#1f2937]">
                                {memo.text}
                            </p>
                            <div className="mt-3 flex items-center justify-between text-[11px] text-[#6b7280]">
                                <span>
                                    {memo.author} · {memo.date}
                                </span>
                                <button
                                    className="opacity-0 transition group-hover:opacity-100"
                                    onClick={() => removeMemo(memo.id)}
                                    type="button"
                                >
                                    삭제
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            ) : (
                <p className="m-0 py-12 text-center text-sm text-[#94a3b8]">메모가 없습니다</p>
            )}
        </section>
    );
}

export default MemosPage;
