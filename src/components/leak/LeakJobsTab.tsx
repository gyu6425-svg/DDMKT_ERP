import { useEffect, useMemo, useState } from 'react';
import {
    deleteJob,
    fmtPhone,
    fullPlace,
    listInquiries,
    listJobs,
    shareMismatch,
    won,
    type LeakInquiry,
    type LeakJob,
} from '../../api/leakErp';
import LeakJobForm from './LeakJobForm';
import { Btn, Card, Chip, Empty, INPUT_CLS, Kpi, Td, Th } from './ui';
import { inLeakMonth, useLeakMonth } from './leakMonth';

type JobTab = 'all' | 'unsettled' | 'settled' | 'noinvoice' | 'exception';

export default function LeakJobsTab({ notify }: { notify: (m: string) => void }) {
    const [rows, setRows] = useState<LeakJob[]>([]);
    const [inquiries, setInquiries] = useState<LeakInquiry[]>([]);
    const [loading, setLoading] = useState(true);
    const [q, setQ] = useState('');
    const [tab, setTab] = useState<JobTab>('all');
    const month = useLeakMonth(); // 사이드바 공용 월(''=전체)
    const [modal, setModal] = useState<{ edit: LeakJob | null } | null>(null);

    const load = async () => {
        setLoading(true);
        const [j, i] = await Promise.all([listJobs(), listInquiries()]);
        if (j.error) notify(`!불러오기 실패: ${j.error.message}`);
        setRows(j.data);
        setInquiries(i.data);
        setLoading(false);
    };
    useEffect(() => {
        void load();
    }, []);

    const remove = async (r: LeakJob) => {
        if (!window.confirm(`작업 삭제 — ${fullPlace(r.sido, r.region, r.site_name)}\n되돌릴 수 없습니다.`)) return;
        const { error } = await deleteJob(r.id);
        if (error) return notify(`!${error.message}`);
        notify('삭제했습니다');
        void load();
    };

    const inMonth = useMemo(() => (month ? rows.filter((r) => inLeakMonth(r.worked_on || r.created_at, month)) : rows), [rows, month]);

    const counts = useMemo(
        () => ({
            all: inMonth.length,
            exception: inMonth.filter((r) => r.is_rule_exception || shareMismatch(r) !== 0).length,
            noinvoice: inMonth.filter((r) => r.invoice_status !== '발행완료').length,
            settled: inMonth.filter((r) => !!r.settled_on).length,
            unsettled: inMonth.filter((r) => !r.settled_on).length,
        }),
        [inMonth],
    );

    const filtered = useMemo(() => {
        const s = q.trim().toLowerCase();
        return inMonth.filter((r) => {
            if (tab === 'unsettled' && r.settled_on) return false;
            if (tab === 'settled' && !r.settled_on) return false;
            if (tab === 'noinvoice' && r.invoice_status === '발행완료') return false;
            if (tab === 'exception' && !(r.is_rule_exception || shareMismatch(r) !== 0)) return false;
            if (!s) return true;
            return [r.sido, r.region, r.site_name, r.phone, r.vendor, r.note, r.deduction_note, r.exception_reason]
                .some((v) => (v || '').toLowerCase().includes(s));
        });
    }, [inMonth, q, tab]);

    const sum = useMemo(
        () => filtered.reduce(
            (a, r) => ({ gross: a.gross + r.gross_amount, our: a.our + r.our_share, partner: a.partner + r.partner_share }),
            { gross: 0, our: 0, partner: 0 },
        ),
        [filtered],
    );

    const tabBtn = (key: JobTab, label: string, n: number) => (
        <button
            className={`rounded-md px-3 py-1.5 ${tab === key ? 'bg-white text-[#1e40af] shadow-sm' : 'text-[#94a3b8]'}`}
            key={key}
            onClick={() => setTab(key)}
            type="button"
        >
            {label} {n}
        </button>
    );

    return (
        <div className="flex min-w-0 flex-col gap-4">
            <div className="flex flex-wrap gap-3">
                <Kpi label={month ? `${Number(month)}월 작업` : '전체 작업'} sub="건" value={`${counts.all}`} />
                <Kpi label="결제금액 합계" tone="amber" value={`${won(inMonth.reduce((a, r) => a + r.gross_amount, 0))}원`} />
                <Kpi label="든든 수취" tone="green" value={`${won(inMonth.reduce((a, r) => a + r.our_share, 0))}원`} />
                <Kpi label="정산 대기" sub="정산일 미입력" value={`${counts.unsettled}`} />
                <Kpi label="계산서 미발행" tone="amber" value={`${counts.noinvoice}`} />
            </div>

            <Card
                title={`작업 목록 (${filtered.length}건 · 결제 ${won(sum.gross)}원 · 든든 ${won(sum.our)}원 · 백준 ${won(sum.partner)}원)`}
                right={
                    <>
                        <input className={`${INPUT_CLS} w-52 shrink-0`} onChange={(e) => setQ(e.target.value)} placeholder="지역·현장·업체 검색" value={q} />
                        <Btn onClick={() => setModal({ edit: null })}>+ 작업 추가</Btn>
                    </>
                }
            >
                <div className="mb-3 inline-flex flex-wrap rounded-lg border border-[#e2e8f0] bg-[#f8fafc] p-0.5 text-sm font-semibold">
                    {tabBtn('all', '전체', counts.all)}
                    {tabBtn('unsettled', '정산대기', counts.unsettled)}
                    {tabBtn('settled', '정산완료', counts.settled)}
                    {tabBtn('noinvoice', '계산서 미발행', counts.noinvoice)}
                    {tabBtn('exception', '정산 예외', counts.exception)}
                </div>
                {loading ? (
                    <Empty>불러오는 중…</Empty>
                ) : filtered.length === 0 ? (
                    <Empty>{rows.length ? '해당 조건의 작업이 없습니다' : '등록된 작업이 없습니다 — 우측 상단에서 추가하세요'}</Empty>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[1140px]">
                            <thead>
                                <tr>
                                    <Th>진행일</Th><Th>지역</Th><Th>현장</Th><Th>연락처</Th><Th>업체</Th>
                                    <Th align="right">결제금액</Th><Th align="right">공제</Th>
                                    <Th align="right">든든</Th><Th align="right">백준</Th>
                                    <Th align="center">검산</Th><Th>정산일</Th><Th align="center">계산서</Th><Th align="right">관리</Th>
                                </tr>
                            </thead>
                            <tbody>
                                {filtered.map((r) => {
                                    const d = shareMismatch(r);
                                    return (
                                        <tr className="hover:bg-[#f8fafc]" key={r.id}>
                                            <Td>{r.worked_on ?? '-'}</Td>
                                            <Td>{r.sido ? <Chip tone="info">{r.sido}</Chip> : null} {r.region ?? ''}</Td>
                                            <Td className="font-semibold">{r.site_name ?? '-'}</Td>
                                            <Td>{fmtPhone(r.phone)}</Td>
                                            <Td>{r.vendor ?? '-'}</Td>
                                            <Td align="right">{won(r.gross_amount)}</Td>
                                            <Td align="right" className={r.deduction_amount ? 'text-[#b45309]' : ''}>
                                                {r.deduction_amount ? won(r.deduction_amount) : '-'}
                                            </Td>
                                            <Td align="right" className="font-semibold text-[#1e40af]">{won(r.our_share)}</Td>
                                            <Td align="right">{won(r.partner_share)}</Td>
                                            <Td align="center">
                                                {d === 0 ? <Chip tone="ok">OK</Chip> : <Chip tone="warn">{d > 0 ? '+' : ''}{won(d)}</Chip>}
                                            </Td>
                                            <Td>{r.settled_on ?? '-'}</Td>
                                            <Td align="center">
                                                {r.invoice_status === '발행완료' ? <Chip tone="ok">발행완료</Chip> : <Chip tone="muted">미발행</Chip>}
                                            </Td>
                                            <Td align="right">
                                                <div className="flex justify-end gap-1">
                                                    <button className="rounded px-2 py-1 text-xs font-semibold text-[#1e40af] hover:bg-[#eff6ff]" onClick={() => setModal({ edit: r })} type="button">수정</button>
                                                    <button className="rounded px-2 py-1 text-xs font-semibold text-[#b91c1c] hover:bg-[#fef2f2]" onClick={() => remove(r)} type="button">삭제</button>
                                                </div>
                                            </Td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </Card>

            {modal ? (
                <LeakJobForm
                    edit={modal.edit}
                    inquiries={inquiries}
                    notify={notify}
                    onClose={() => setModal(null)}
                    onSaved={load}
                />
            ) : null}
        </div>
    );
}
