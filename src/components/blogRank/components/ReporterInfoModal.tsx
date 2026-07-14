import { useEffect, useState } from 'react';
import { useAuth } from '../../../hooks/useAuth';
import { canIssueClientAccount } from '../../../lib/permissions';
import { maskAccount } from '../../../api/clientBilling';
import {
    getReporterBilling,
    maskRRN,
    upsertReporterBilling,
    type ReporterBilling,
} from '../../../api/reporterBilling';

// 기자단 계정 정보 — 이름/은행/계좌번호/주민번호(마스킹). 내부 전용(RLS). 편집은 관리자/허용계정만.
//   계좌번호·주민번호는 기본 마스킹, '보기'로만 노출(어깨너머 방지). 값은 관리자 조회 시에만 메모리 보관.
export function ReporterInfoModal({
    reporterId,
    reporterName,
    reporterEmail,
    onClose,
}: {
    reporterId: string;
    reporterName: string;
    reporterEmail: string;
    onClose: () => void;
}) {
    const { profile, isAdmin } = useAuth();
    const canManage = isAdmin || canIssueClientAccount(profile?.email);
    const [billing, setBilling] = useState<ReporterBilling | null>(null);
    const [loaded, setLoaded] = useState(false);
    const [revealAcc, setRevealAcc] = useState(false);
    const [revealRrn, setRevealRrn] = useState(false);
    const [editing, setEditing] = useState(false);
    const [saving, setSaving] = useState(false);
    const [msg, setMsg] = useState('');
    const [form, setForm] = useState({ bank_name: '', account_number: '', rrn: '' });

    useEffect(() => {
        let alive = true;
        void getReporterBilling(reporterId).then(({ data }) => {
            if (!alive) return;
            setBilling(data);
            setLoaded(true);
        });
        return () => {
            alive = false;
        };
    }, [reporterId]);

    const startEdit = () => {
        setForm({
            bank_name: billing?.bank_name || '',
            account_number: billing?.account_number || '',
            rrn: billing?.rrn || '',
        });
        setEditing(true);
    };
    const save = async () => {
        setSaving(true);
        setMsg('');
        const { error } = await upsertReporterBilling(reporterId, form, profile?.id ?? null);
        setSaving(false);
        if (error) {
            setMsg('저장 실패: ' + error.message);
            return;
        }
        setBilling({ ...form });
        setEditing(false);
        setRevealAcc(false);
        setRevealRrn(false);
    };

    const Row = ({
        k,
        children,
    }: {
        k: string;
        children: React.ReactNode;
    }) => (
        <div className="flex items-center justify-between gap-3 border-b border-[#f1f5f9] py-2 last:border-b-0">
            <span className="shrink-0 text-[13px] text-[#94a3b8]">{k}</span>
            <span className="text-right text-[14px] font-semibold text-[#334155]">{children}</span>
        </div>
    );

    return (
        <div
            className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4"
            onMouseDown={(e) => e.target === e.currentTarget && onClose()}
        >
            <div className="max-h-[90vh] w-[min(460px,96vw)] overflow-y-auto rounded-2xl bg-[#f8fafc] p-5">
                <div className="mb-3 flex items-center justify-between">
                    <h3 className="m-0 text-lg font-bold text-[#0f172a]">기자단 계정 정보</h3>
                    <button
                        className="rounded-md border border-[#cbd5e1] bg-white px-3 py-1 text-sm font-semibold text-[#64748b]"
                        onClick={onClose}
                        type="button"
                    >
                        닫기
                    </button>
                </div>

                <div className="rounded-xl border border-[#e2e8f0] bg-white p-4">
                    <div className="mb-1 flex items-center justify-between">
                        <div className="text-sm font-bold text-[#0f172a]">
                            정산 정보 <span className="text-[11px] font-semibold text-[#b45309]">· 내부 전용</span>
                        </div>
                        {canManage && !editing ? (
                            <button
                                className="rounded-md border border-[#cbd5e1] bg-white px-2.5 py-1 text-[11px] font-semibold text-[#475569] hover:bg-[#f1f5f9]"
                                onClick={startEdit}
                                type="button"
                            >
                                {billing ? '편집' : '등록'}
                            </button>
                        ) : null}
                    </div>

                    <Row k="이름">{reporterName || '-'}</Row>
                    <div className="mb-1 text-[11px] text-[#94a3b8]">{reporterEmail}</div>

                    {!loaded ? (
                        <div className="py-3 text-[13px] text-[#94a3b8]">불러오는 중…</div>
                    ) : editing ? (
                        <div className="mt-2 grid gap-2">
                            <input
                                className="h-9 w-full rounded border border-[#cbd5e1] bg-white px-2 text-sm"
                                onChange={(e) => setForm((f) => ({ ...f, bank_name: e.target.value }))}
                                placeholder="은행명 (예: 국민)"
                                value={form.bank_name}
                            />
                            <input
                                autoComplete="off"
                                className="h-9 w-full rounded border border-[#cbd5e1] bg-white px-2 text-sm"
                                onChange={(e) => setForm((f) => ({ ...f, account_number: e.target.value }))}
                                placeholder="계좌번호"
                                value={form.account_number}
                            />
                            <input
                                autoComplete="off"
                                className="h-9 w-full rounded border border-[#cbd5e1] bg-white px-2 text-sm"
                                onChange={(e) => setForm((f) => ({ ...f, rrn: e.target.value }))}
                                placeholder="주민등록번호"
                                value={form.rrn}
                            />
                            {msg ? <p className="m-0 text-xs text-[#dc2626]">{msg}</p> : null}
                            <div className="flex justify-end gap-1">
                                <button
                                    className="rounded-md border border-[#cbd5e1] bg-white px-3 py-1.5 text-xs font-semibold text-[#64748b]"
                                    onClick={() => setEditing(false)}
                                    type="button"
                                >
                                    취소
                                </button>
                                <button
                                    className="rounded-md bg-[#1e40af] px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
                                    disabled={saving}
                                    onClick={() => void save()}
                                    type="button"
                                >
                                    {saving ? '저장 중…' : '저장'}
                                </button>
                            </div>
                        </div>
                    ) : (
                        <>
                            <Row k="은행">{billing?.bank_name || '-'}</Row>
                            <Row k="계좌번호">
                                <span className="flex items-center justify-end gap-2">
                                    <span className="font-mono">
                                        {revealAcc ? billing?.account_number || '-' : maskAccount(billing?.account_number)}
                                    </span>
                                    {billing?.account_number ? (
                                        <button
                                            className="rounded border border-[#cbd5e1] bg-white px-1.5 py-0.5 text-[11px] font-semibold text-[#475569] hover:bg-[#f1f5f9]"
                                            onClick={() => setRevealAcc((v) => !v)}
                                            type="button"
                                        >
                                            {revealAcc ? '숨기기' : '보기'}
                                        </button>
                                    ) : null}
                                </span>
                            </Row>
                            <Row k="주민번호">
                                <span className="flex items-center justify-end gap-2">
                                    <span
                                        className={`font-mono ${revealRrn ? '' : 'select-none tracking-wider'}`}
                                    >
                                        {revealRrn ? billing?.rrn || '-' : maskRRN(billing?.rrn)}
                                    </span>
                                    {billing?.rrn ? (
                                        <button
                                            className="rounded border border-[#cbd5e1] bg-white px-1.5 py-0.5 text-[11px] font-semibold text-[#475569] hover:bg-[#f1f5f9]"
                                            onClick={() => setRevealRrn((v) => !v)}
                                            type="button"
                                        >
                                            {revealRrn ? '숨기기' : '보기'}
                                        </button>
                                    ) : null}
                                </span>
                            </Row>
                        </>
                    )}
                </div>
                <p className="mt-3 mb-0 text-[11px] leading-5 text-[#94a3b8]">
                    계좌번호·주민번호는 내부 전용(관리자)만 조회·수정할 수 있으며, 기본 마스킹 상태로 표시됩니다.
                </p>
            </div>
        </div>
    );
}
