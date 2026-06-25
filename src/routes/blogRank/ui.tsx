import type { ReactNode } from 'react';

export function Kpi({
    label,
    value,
    sub,
    accent,
    onClick,
}: {
    label: string;
    value: string;
    sub?: string;
    accent?: string;
    onClick?: () => void;
}) {
    const clickable = !!onClick;
    return (
        <div
            className={`rounded-xl border border-[#e2e8f0] bg-white p-4 ${
                clickable ? 'cursor-pointer transition hover:border-[#1e40af] hover:shadow-sm' : ''
            }`}
            onClick={onClick}
            role={clickable ? 'button' : undefined}
            tabIndex={clickable ? 0 : undefined}
            onKeyDown={clickable ? (e) => (e.key === 'Enter' || e.key === ' ') && onClick?.() : undefined}
        >
            <p className="m-0 text-xs text-[#64748b]">{label}</p>
            <p className="m-0 mt-1 text-2xl font-bold" style={{ color: accent ?? '#0f172a' }}>
                {value}
            </p>
            {sub ? <p className="m-0 mt-0.5 text-[11px] text-[#94a3b8]">{sub}</p> : null}
        </div>
    );
}

export function Panel({
    title,
    sub,
    children,
    action,
}: {
    title: string;
    sub?: string;
    children: ReactNode;
    action?: ReactNode;
}) {
    return (
        <div className="rounded-xl border border-[#e2e8f0] bg-white p-4">
            <div className="flex items-start justify-between gap-2">
                <div>
                    <h3 className="m-0 text-sm font-bold text-[#0f172a]">{title}</h3>
                    {sub ? <p className="m-0 mt-0.5 mb-2 text-[11px] text-[#94a3b8]">{sub}</p> : null}
                </div>
                {action ? <div className="shrink-0">{action}</div> : null}
            </div>
            {children}
        </div>
    );
}

export function Tag({ kind, children }: { kind: 'run' | 'stop' | 'low' | 'muted' | 'urgent'; children: ReactNode }) {
    const map: Record<string, string> = {
        low: 'bg-[#fef3c7] text-[#d97706]',       // 노랑(잔여 2~3건)
        urgent: 'bg-[#fee2e2] text-[#dc2626]',    // 빨강(잔여 1건 이하 = 매우 임박)
        muted: 'bg-[#f1f5f9] text-[#94a3b8]',
        run: 'bg-[#d1fae5] text-[#059669]',
        stop: 'bg-[#fee2e2] text-[#dc2626]',
    };
    return (
        <span className={`rounded-md px-2 py-0.5 text-[10px] font-bold ${map[kind]}`}>{children}</span>
    );
}

export function Empty({ text }: { text: string }) {
    return <p className="m-0 py-8 text-center text-xs text-[#94a3b8]">{text}</p>;
}

export function Pager({ pages, current, onGo }: { pages: number; current: number; onGo: (p: number) => void }) {
    if (pages <= 1) {
        return null;
    }
    return (
        <div className="flex items-center justify-center gap-1.5 p-3">
            {Array.from({ length: pages }, (_, i) => i + 1).map((p) => (
                <button
                    className={`min-w-[30px] rounded px-2 py-1 text-xs font-semibold ${
                        p === current ? 'bg-[#1e40af] text-white' : 'text-[#64748b] hover:bg-[#f1f5f9]'
                    }`}
                    key={p}
                    onClick={() => onGo(p)}
                    type="button"
                >
                    {p}
                </button>
            ))}
        </div>
    );
}
