import { useEffect, useMemo, useState } from 'react';
import {
    deleteInquiry,
    deleteJob,
    fmtPhone,
    fullPlace,
    listInquiries,
    listJobs,
    won,
    type LeakInquiry,
    type LeakJob,
} from '../../api/leakErp';
import LeakInquiryForm from './LeakInquiryForm';
import LeakJobForm from './LeakJobForm';
import { Btn, Card, Chip, Empty, INPUT_CLS, Kpi, Td, Th } from './ui';

// 고객 = 연락처(숫자만) 단위. 고객명을 받지 않으므로 번호가 유일한 식별자다.
type Customer = {
    phoneNorm: string;
    phone: string;
    sido: string | null;
    region: string | null;
    site: string | null;
    inquiries: LeakInquiry[];
    jobs: LeakJob[];
    lastAt: string;
    gross: number;
    our: number;
};

const STATUS = {
    done: { label: '작업완료', tone: 'ok' as const },
    waiting: { label: '작업대기', tone: 'info' as const },
    none: { label: '미진행', tone: 'muted' as const },
};
const statusOf = (c: Customer) =>
    c.jobs.length ? STATUS.done : c.inquiries.some((i) => i.contracted) ? STATUS.waiting : STATUS.none;

export default function LeakCustomersTab({ notify }: { notify: (m: string) => void }) {
    const [inquiries, setInquiries] = useState<LeakInquiry[]>([]);
    const [jobs, setJobs] = useState<LeakJob[]>([]);
    const [loading, setLoading] = useState(true);
    const [q, setQ] = useState('');
    const [filter, setFilter] = useState<'all' | 'done' | 'waiting' | 'none'>('all');
    const [openPhone, setOpenPhone] = useState(''); // 상세로 연 고객(연락처)
    const [inqModal, setInqModal] = useState<{ edit: LeakInquiry | null; lock?: string } | null>(null);
    const [jobModal, setJobModal] = useState<{ edit: LeakJob | null; lock?: string } | null>(null);

    const load = async () => {
        setLoading(true);
        const [i, j] = await Promise.all([listInquiries(), listJobs()]);
        if (i.error) notify(`!불러오기 실패: ${i.error.message}`);
        setInquiries(i.data);
        setJobs(j.data);
        setLoading(false);
    };
    useEffect(() => {
        void load();
    }, []);

    // 연락처로 묶기. 번호 없는 건은 고객으로 묶을 수 없어 별도 그룹('(연락처 없음)')으로 남긴다.
    const customers = useMemo(() => {
        const m = new Map<string, Customer>();
        const touch = (norm: string, raw: string | null) => {
            let c = m.get(norm);
            if (!c) {
                c = { gross: 0, inquiries: [], jobs: [], lastAt: '', our: 0, phone: raw ?? '', phoneNorm: norm, region: null, sido: null, site: null };
                m.set(norm, c);
            }
            if (!c.phone && raw) c.phone = raw;
            return c;
        };
        inquiries.forEach((i) => {
            const c = touch(i.phone_norm || '', i.phone);
            c.inquiries.push(i);
            const at = i.inquired_on || i.created_at.slice(0, 10);
            if (at > c.lastAt) c.lastAt = at;
            c.sido = c.sido ?? i.sido;
            c.region = c.region ?? i.region;
            c.site = c.site ?? i.site_name;
        });
        jobs.forEach((j) => {
            const c = touch(j.phone_norm || '', j.phone);
            c.jobs.push(j);
            const at = j.worked_on || j.created_at.slice(0, 10);
            if (at > c.lastAt) c.lastAt = at;
            c.gross += j.gross_amount;
            c.our += j.our_share;
            c.sido = c.sido ?? j.sido;
            c.region = c.region ?? j.region;
            c.site = c.site ?? j.site_name;
        });
        return [...m.values()].sort((a, b) => b.lastAt.localeCompare(a.lastAt));
    }, [inquiries, jobs]);

    const filtered = useMemo(() => {
        const s = q.trim().toLowerCase();
        return customers.filter((c) => {
            if (filter !== 'all') {
                const st = statusOf(c);
                if (filter === 'done' && st !== STATUS.done) return false;
                if (filter === 'waiting' && st !== STATUS.waiting) return false;
                if (filter === 'none' && st !== STATUS.none) return false;
            }
            if (!s) return true;
            return [c.phone, c.phoneNorm, c.sido, c.region, c.site, ...c.inquiries.map((i) => i.leak_type), ...c.inquiries.map((i) => i.counselor)]
                .some((v) => (v || '').toLowerCase().includes(s));
        });
    }, [customers, q, filter]);

    const kpi = useMemo(() => {
        const done = customers.filter((c) => statusOf(c) === STATUS.done).length;
        const waiting = customers.filter((c) => statusOf(c) === STATUS.waiting).length;
        return {
            done,
            our: customers.reduce((a, c) => a + c.our, 0),
            rate: customers.length ? Math.round((done / customers.length) * 100) : 0,
            total: customers.length,
            waiting,
        };
    }, [customers]);

    const opened = customers.find((c) => c.phoneNorm === openPhone) ?? null;

    const removeInq = async (r: LeakInquiry) => {
        if (!window.confirm(`상담 삭제 — ${fullPlace(r.sido, r.region, r.site_name)}\n되돌릴 수 없습니다.`)) return;
        const { error } = await deleteInquiry(r.id);
        if (error) return notify(`!${error.message}`);
        notify('삭제했습니다');
        void load();
    };
    const removeJob = async (r: LeakJob) => {
        if (!window.confirm(`작업 삭제 — ${fullPlace(r.sido, r.region, r.site_name)}\n되돌릴 수 없습니다.`)) return;
        const { error } = await deleteJob(r.id);
        if (error) return notify(`!${error.message}`);
        notify('삭제했습니다');
        void load();
    };

    const modals = (
        <>
            {inqModal ? (
                <LeakInquiryForm
                    edit={inqModal.edit}
                    known={inquiries}
                    lockPhone={inqModal.lock}
                    notify={notify}
                    onClose={() => setInqModal(null)}
                    onSaved={load}
                />
            ) : null}
            {jobModal ? (
                <LeakJobForm
                    edit={jobModal.edit}
                    inquiries={inquiries}
                    lockPhone={jobModal.lock}
                    notify={notify}
                    onClose={() => setJobModal(null)}
                    onSaved={load}
                />
            ) : null}
        </>
    );

    // ── 상세 ──────────────────────────────────────────────────────────────
    if (opened) {
        return (
            <div className="flex min-w-0 flex-col gap-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                        <Btn kind="ghost" onClick={() => setOpenPhone('')}>← 목록</Btn>
                        <div>
                            <div className="text-base font-bold text-[#0f172a]">
                                {opened.phoneNorm ? fmtPhone(opened.phone) : '(연락처 없음)'}
                            </div>
                            <div className="text-xs text-[#94a3b8]">{fullPlace(opened.sido, opened.region, opened.site)}</div>
                        </div>
                    </div>
                    <div className="flex gap-2">
                        <Btn kind="ghost" onClick={() => setInqModal({ edit: null, lock: opened.phone })}>+ 상담 추가</Btn>
                        <Btn onClick={() => setJobModal({ edit: null, lock: opened.phone })}>+ 작업 추가</Btn>
                    </div>
                </div>

                <div className="flex flex-wrap gap-3">
                    <Kpi label="문의" sub="건" value={`${opened.inquiries.length}`} />
                    <Kpi label="작업" sub="건" value={`${opened.jobs.length}`} />
                    <Kpi label="총 결제금액" tone="amber" value={`${won(opened.gross)}원`} />
                    <Kpi label="든든 수취" tone="green" value={`${won(opened.our)}원`} />
                </div>

                <Card title={`문의 이력 (${opened.inquiries.length}건)`}>
                    {opened.inquiries.length === 0 ? (
                        <Empty>문의 내역이 없습니다</Empty>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full min-w-[760px]">
                                <thead>
                                    <tr>
                                        <Th>문의일</Th><Th>상담자</Th><Th>지역</Th><Th>현장</Th>
                                        <Th>누수 종류</Th><Th>유입</Th><Th align="center">계약</Th><Th align="right">관리</Th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {opened.inquiries.map((r) => (
                                        <tr className="hover:bg-[#f8fafc]" key={r.id}>
                                            <Td>{r.inquired_on ?? '-'}</Td>
                                            <Td>{r.counselor ?? '-'}</Td>
                                            <Td>{r.sido ? <Chip tone="info">{r.sido}</Chip> : null} {r.region ?? ''}</Td>
                                            <Td>{r.site_name ?? '-'}</Td>
                                            <Td>{r.leak_type ?? '-'}</Td>
                                            <Td>{r.source ?? '-'}</Td>
                                            <Td align="center">{r.contracted ? <Chip tone="ok">진행</Chip> : <Chip tone="muted">미진행</Chip>}</Td>
                                            <Td align="right">
                                                <div className="flex justify-end gap-1">
                                                    <button className="rounded px-2 py-1 text-xs font-semibold text-[#1e40af] hover:bg-[#eff6ff]" onClick={() => setInqModal({ edit: r })} type="button">수정</button>
                                                    <button className="rounded px-2 py-1 text-xs font-semibold text-[#b91c1c] hover:bg-[#fef2f2]" onClick={() => removeInq(r)} type="button">삭제</button>
                                                </div>
                                            </Td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </Card>

                <Card title={`작업 · 정산 이력 (${opened.jobs.length}건)`}>
                    {opened.jobs.length === 0 ? (
                        <Empty>작업 내역이 없습니다</Empty>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full min-w-[820px]">
                                <thead>
                                    <tr>
                                        <Th>진행일</Th><Th>현장</Th><Th align="right">결제금액</Th><Th align="right">공제</Th>
                                        <Th align="right">든든</Th><Th align="right">백준</Th><Th>정산일</Th><Th align="center">계산서</Th><Th align="right">관리</Th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {opened.jobs.map((r) => (
                                        <tr className="hover:bg-[#f8fafc]" key={r.id}>
                                            <Td>{r.worked_on ?? '-'}</Td>
                                            <Td>{r.site_name ?? '-'}</Td>
                                            <Td align="right">{won(r.gross_amount)}</Td>
                                            <Td align="right">{r.deduction_amount ? won(r.deduction_amount) : '-'}</Td>
                                            <Td align="right" className="font-semibold text-[#1e40af]">{won(r.our_share)}</Td>
                                            <Td align="right">{won(r.partner_share)}</Td>
                                            <Td>{r.settled_on ?? '-'}</Td>
                                            <Td align="center">
                                                {r.invoice_status === '발행완료' ? <Chip tone="ok">발행완료</Chip> : <Chip tone="muted">미발행</Chip>}
                                            </Td>
                                            <Td align="right">
                                                <div className="flex justify-end gap-1">
                                                    <button className="rounded px-2 py-1 text-xs font-semibold text-[#1e40af] hover:bg-[#eff6ff]" onClick={() => setJobModal({ edit: r })} type="button">수정</button>
                                                    <button className="rounded px-2 py-1 text-xs font-semibold text-[#b91c1c] hover:bg-[#fef2f2]" onClick={() => removeJob(r)} type="button">삭제</button>
                                                </div>
                                            </Td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </Card>
                {modals}
            </div>
        );
    }

    // ── 목록 ──────────────────────────────────────────────────────────────
    const tabBtn = (key: typeof filter, label: string, n: number) => (
        <button
            className={`rounded-md px-3 py-1.5 ${filter === key ? 'bg-white text-[#1e40af] shadow-sm' : 'text-[#94a3b8]'}`}
            key={key}
            onClick={() => setFilter(key)}
            type="button"
        >
            {label} {n}
        </button>
    );

    return (
        <div className="flex min-w-0 flex-col gap-4">
            <div className="flex flex-wrap gap-3">
                <Kpi label="전체 고객" sub="연락처 기준" value={`${kpi.total}`} />
                <Kpi label="작업완료" sub={`성사율 ${kpi.rate}%`} tone="green" value={`${kpi.done}`} />
                <Kpi label="작업대기" sub="성사됐으나 작업 미등록" tone="amber" value={`${kpi.waiting}`} />
                <Kpi label="든든 누적 수취" value={`${won(kpi.our)}원`} />
            </div>

            <Card
                title={`고객 목록 (${filtered.length}명)`}
                right={
                    <>
                        <input className={`${INPUT_CLS} w-52 shrink-0`} onChange={(e) => setQ(e.target.value)} placeholder="연락처·지역·현장 검색" value={q} />
                        <Btn kind="ghost" onClick={() => setInqModal({ edit: null })}>+ 상담 추가</Btn>
                        <Btn onClick={() => setJobModal({ edit: null })}>+ 작업 추가</Btn>
                    </>
                }
            >
                <div className="mb-3 inline-flex rounded-lg border border-[#e2e8f0] bg-[#f8fafc] p-0.5 text-sm font-semibold">
                    {tabBtn('all', '전체', customers.length)}
                    {tabBtn('done', '작업완료', kpi.done)}
                    {tabBtn('waiting', '작업대기', kpi.waiting)}
                    {tabBtn('none', '미진행', customers.length - kpi.done - kpi.waiting)}
                </div>
                {loading ? (
                    <Empty>불러오는 중…</Empty>
                ) : filtered.length === 0 ? (
                    <Empty>{customers.length ? '검색 결과가 없습니다' : '등록된 고객이 없습니다 — 우측 상단에서 상담을 추가하세요'}</Empty>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[880px]">
                            <thead>
                                <tr>
                                    <Th>최근</Th><Th>연락처</Th><Th>지역</Th><Th>현장</Th>
                                    <Th align="center">문의</Th><Th align="center">작업</Th>
                                    <Th align="right">결제금액</Th><Th align="right">든든 수취</Th><Th align="center">상태</Th>
                                </tr>
                            </thead>
                            <tbody>
                                {filtered.map((c) => {
                                    const st = statusOf(c);
                                    return (
                                        <tr
                                            className="cursor-pointer hover:bg-[#f8fafc]"
                                            key={c.phoneNorm || '(none)'}
                                            onClick={() => setOpenPhone(c.phoneNorm)}
                                        >
                                            <Td>{c.lastAt || '-'}</Td>
                                            <Td className="font-semibold">{c.phoneNorm ? fmtPhone(c.phone) : '(연락처 없음)'}</Td>
                                            <Td>{c.sido ? <Chip tone="info">{c.sido}</Chip> : null} {c.region ?? ''}</Td>
                                            <Td>{c.site ?? '-'}</Td>
                                            <Td align="center">{c.inquiries.length}</Td>
                                            <Td align="center">{c.jobs.length || '-'}</Td>
                                            <Td align="right">{c.gross ? won(c.gross) : '-'}</Td>
                                            <Td align="right" className="font-semibold text-[#1e40af]">{c.our ? won(c.our) : '-'}</Td>
                                            <Td align="center"><Chip tone={st.tone}>{st.label}</Chip></Td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </Card>
            {modals}
        </div>
    );
}
