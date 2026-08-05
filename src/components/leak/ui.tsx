import type { ReactNode } from 'react';

// 누수탐지 ERP 공용 UI 조각 — 기존 ERP 톤(slate 계열 hex)에 맞춤.

export const INPUT_CLS = 'h-9 w-full rounded-md border border-[#cbd5e1] bg-white px-2.5 text-sm outline-none focus:border-[#1e40af]';

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
    return (
        <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-[#64748b]">{label}</span>
            {children}
            {hint ? <span className="text-[11px] text-[#94a3b8]">{hint}</span> : null}
        </label>
    );
}

export function Card({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) {
    return (
        <section className="rounded-xl border border-[#e2e8f0] bg-white p-4 shadow-sm">
            {/* 제목은 줄어들 수 있게(min-w-0), 우측 컨트롤은 눌리지 않게(shrink-0) — 글자 세로 깨짐 방지. */}
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="min-w-0 text-sm font-bold text-[#0f172a]">{title}</h2>
                {right ? <div className="flex shrink-0 items-center gap-2">{right}</div> : null}
            </div>
            {children}
        </section>
    );
}

export function Btn({
    children,
    onClick,
    kind = 'primary',
    type = 'button',
    disabled,
}: {
    children: ReactNode;
    onClick?: () => void;
    kind?: 'primary' | 'ghost' | 'danger';
    type?: 'button' | 'submit';
    disabled?: boolean;
}) {
    const cls =
        kind === 'primary'
            ? 'bg-[#1e40af] text-white hover:bg-[#1d4ed8]'
            : kind === 'danger'
              ? 'border border-[#fecaca] bg-white text-[#b91c1c] hover:bg-[#fef2f2]'
              : 'border border-[#cbd5e1] bg-white text-[#475569] hover:bg-[#f8fafc]';
    return (
        <button
            className={`h-9 shrink-0 rounded-md px-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${cls}`}
            disabled={disabled}
            onClick={onClick}
            type={type}
        >
            {children}
        </button>
    );
}

// 세그먼트 토글 — 선택된 것 다시 누르면 해제.
export function Toggle({
    options,
    value,
    onChange,
}: {
    options: readonly string[];
    value: string;
    onChange: (v: string) => void;
}) {
    return (
        <div className="inline-flex h-9 items-center rounded-md border border-[#cbd5e1] bg-white p-0.5">
            {options.map((o) => (
                <button
                    className={`h-full whitespace-nowrap rounded px-2.5 text-sm font-semibold ${
                        value === o ? 'bg-[#1e40af] text-white' : 'text-[#64748b] hover:bg-[#f1f5f9]'
                    }`}
                    key={o}
                    onClick={() => onChange(value === o ? '' : o)}
                    type="button"
                >
                    {o}
                </button>
            ))}
        </div>
    );
}

export function Chip({ tone, children }: { tone: 'ok' | 'warn' | 'muted' | 'info'; children: ReactNode }) {
    const cls =
        tone === 'ok'
            ? 'bg-[#dcfce7] text-[#15803d]'
            : tone === 'warn'
              ? 'bg-[#fee2e2] text-[#b91c1c]'
              : tone === 'info'
                ? 'bg-[#dbeafe] text-[#1e40af]'
                : 'bg-[#f1f5f9] text-[#64748b]';
    return <span className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-semibold ${cls}`}>{children}</span>;
}

// ⚠️ Tailwind 는 동적 클래스(`text-${align}`)를 정적 스캔하지 못한다 — 반드시 완성된 클래스명으로.
const ALIGN_CLS = { left: 'text-left', right: 'text-right', center: 'text-center' } as const;
type Align = keyof typeof ALIGN_CLS;

export function Th({ children, align = 'left' }: { children: ReactNode; align?: Align }) {
    return (
        <th className={`whitespace-nowrap border-b border-[#e2e8f0] px-2 py-2 text-[11px] font-semibold text-[#64748b] ${ALIGN_CLS[align]}`}>
            {children}
        </th>
    );
}

export function Td({ children, align = 'left', className = '' }: { children: ReactNode; align?: Align; className?: string }) {
    return (
        <td className={`whitespace-nowrap border-b border-[#f1f5f9] px-2 py-1.5 text-sm text-[#334155] ${ALIGN_CLS[align]} ${className}`}>
            {children}
        </td>
    );
}

export function Empty({ children }: { children: ReactNode }) {
    return <div className="px-3 py-8 text-center text-sm text-[#94a3b8]">{children}</div>;
}

// 등록/수정 모달 — 기존 ERP('+ 고객사 추가' 등)와 같은 방식.
export function Modal({
    title,
    onClose,
    children,
    footer,
    wide,
}: {
    title: string;
    onClose: () => void;
    children: ReactNode;
    footer?: ReactNode;
    wide?: boolean;
}) {
    return (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 py-10" onMouseDown={onClose}>
            <div
                className={`w-full rounded-xl bg-white p-5 shadow-xl ${wide ? 'max-w-5xl' : 'max-w-3xl'}`}
                onMouseDown={(e) => e.stopPropagation()}
            >
                <div className="mb-4 flex items-center justify-between gap-2">
                    <h3 className="m-0 text-base font-bold text-[#0f172a]">{title}</h3>
                    <button className="rounded px-2 py-1 text-lg leading-none text-[#94a3b8] hover:bg-[#f1f5f9]" onClick={onClose} type="button">
                        ×
                    </button>
                </div>
                {children}
                {footer ? <div className="mt-4 flex justify-end gap-2">{footer}</div> : null}
            </div>
        </div>
    );
}

// 상단 KPI 카드 — 기존 ERP 대시보드 톤.
export function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'blue' | 'green' | 'amber' }) {
    const val =
        tone === 'green' ? 'text-[#15803d]' : tone === 'amber' ? 'text-[#b45309]' : 'text-[#1e40af]';
    return (
        <div className="min-w-[140px] flex-1 rounded-xl border border-[#e2e8f0] bg-white px-4 py-3">
            <div className="text-[11px] font-semibold text-[#64748b]">{label}</div>
            <div className={`mt-0.5 text-xl font-bold ${val}`}>{value}</div>
            {sub ? <div className="text-[11px] text-[#94a3b8]">{sub}</div> : null}
        </div>
    );
}

export function Toast({ msg }: { msg: string }) {
    if (!msg) return null;
    const err = msg.startsWith('!');
    return (
        <div
            className={`fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg px-4 py-2 text-sm font-semibold shadow-lg ${
                err ? 'bg-[#b91c1c] text-white' : 'bg-[#0f172a] text-white'
            }`}
        >
            {err ? msg.slice(1) : msg}
        </div>
    );
}
