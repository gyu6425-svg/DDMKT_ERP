import { useEffect, useMemo, useState } from 'react';
import { getReports, setReportPaid, setReportSettled, reportOutUnit, type BlogPostReport, type ReportType } from '../../../api/blogPostReports';
import { getProfiles } from '../../../api/profiles';
import { getReporters } from '../../../api/blogRank';

const won = (n: number) => n.toLocaleString('ko-KR');

// 저장된 시각(UTC ISO) → KST 날짜(YYYY-MM-DD). 그냥 slice(0,10) 하면 새벽 처리분이 전날로 밀린다.
//   예) 2026-08-09 01:00 KST = 2026-08-08T16:00Z → slice=08-08(하루 어긋남).
function kstDay(iso: string | null | undefined): string {
    if (!iso) return '';
    const t = Date.parse(iso);
    if (Number.isNaN(t)) return String(iso).slice(0, 10);
    return new Date(t + 9 * 3600 * 1000).toISOString().slice(0, 10);
}
// 입금 버튼을 누른 시각(KST) "HH:mm" — 날짜 옆에 같이 보여 준다.
function kstTime(iso: string | null | undefined): string {
    if (!iso) return '';
    const t = Date.parse(iso);
    if (Number.isNaN(t)) return '';
    return new Date(t + 9 * 3600 * 1000).toISOString().slice(11, 16);
}

// ── 정산 주차 — 일요일 시작 ~ 토요일 끝. 8/2~8/8 = 8월 1주차, 8/9~8/15 = 8월 2주차(사장님 기준). ──
function weekSunday(ymd: string): string {
    const [y, m, d] = ymd.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() - dt.getUTCDay());
    return dt.toISOString().slice(0, 10);
}
function addDaysYmd(ymd: string, n: number): string {
    const [y, m, d] = ymd.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
// 그 달의 몇 번째 일요일인가 = 몇 주차. (2일→1주차, 9일→2주차, 16일→3주차 …)
function weekLabel(sunday: string): string {
    const [, m, d] = sunday.split('-').map(Number);
    return `${m}월 ${Math.floor((d - 1) / 7) + 1}주차`;
}
const mdOf = (ymd: string) => `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}`;

// 사업소득 원천징수 3.3% — 소득세 3%(원단위 절사) + 지방소득세 0.3%(원단위 절사). 실지급 = 공급가 - 세액.
function withhold(gross: number): { incomeTax: number; localTax: number; tax: number; net: number } {
    const incomeTax = Math.floor((gross * 0.03) / 10) * 10;
    const localTax = Math.floor((incomeTax * 0.1) / 10) * 10;
    const tax = incomeTax + localTax;
    return { incomeTax, localTax, tax, net: gross - tax };
}

// 블로그 종류 칩 색상 — 브랜드=파랑 · 최적화=초록 · 준최적화=주황 · 저인망=보라.
function kindChipCls(kind: string | null | undefined): string {
    const k = kind ?? '브랜드 블로그';
    if (k === '최적화') return 'bg-[#dcfce7] text-[#15803d]';
    if (k === '준최적화') return 'bg-[#fef3c7] text-[#b45309]';
    if (k === '저인망 배포') return 'bg-[#ede9fe] text-[#7c3aed]';
    return 'bg-[#dbeafe] text-[#1e40af]';
}

// 기자단 승인 처리 내역(내부) — 승인(confirmed)·발행완료(published) 보고를 히스토리 표로.
//   컬럼: 업로드일 / 승인일 / 승인직원 / 업체 / 기자단 / 블로그종류 / 제목 / 회차 / 구분 / 입금 처리.
//   기자단별 드롭다운 필터 · 입금 버튼(누르면 기자단 정산·계약 진행이력이 함께 처리로 전환).
export function ApprovedReportsModal({
    blogNameOf,
    accounts,
    onClose,
}: {
    blogNameOf: (id: string) => string;
    accounts: { id: string; name: string }[];
    onClose: () => void;
}) {
    const [reports, setReports] = useState<BlogPostReport[]>([]);
    const [nameMap, setNameMap] = useState<Record<string, string>>({}); // 직원(reviewed_by) 이름
    const [reporterMap, setReporterMap] = useState<Record<string, string>>({}); // 기자단(reporter_id) 이름
    const [loading, setLoading] = useState(true);
    // 탭 — 전체/저장/발행은 '미입금'만 보여주고, 입금 처리된 건은 '입금 완료' 탭으로 이동한다.
    const [typeTab, setTypeTab] = useState<'all' | ReportType | 'paid' | 'settle'>('all');
    const [blogFilter, setBlogFilter] = useState('all');
    const [reporterFilter, setReporterFilter] = useState('all');
    const [uploadSort, setUploadSort] = useState<'asc' | 'desc'>('asc'); // 업로드일 정렬(순번 기준)
    // 입금일 범위 — '입금 완료'·'정산 내역' 두 탭에 함께 적용(기준 = 입금 처리 시각 paid_at, KST).
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');
    const [includeNoDate, setIncludeNoDate] = useState(false); // 입금일 미기록(옛 데이터) 포함 여부
    const [paying, setPaying] = useState<string | null>(null);
    const [settling, setSettling] = useState<string | null>(null);

    useEffect(() => {
        let alive = true;
        setLoading(true);
        void (async () => {
            const [conf, pub, reps] = await Promise.all([
                getReports({ status: 'confirmed' }),
                getReports({ status: 'published' }),
                getReporters(),
            ]);
            if (!alive) return;
            const merged = [...conf.data, ...pub.data].sort((a, b) =>
                (b.reviewed_at || b.created_at || '').localeCompare(a.reviewed_at || a.created_at || ''),
            );
            setReports(merged);
            const rmap: Record<string, string> = {};
            for (const r of reps.data) rmap[r.id] = r.name || r.email;
            setReporterMap(rmap);
            // 승인 직원 이름 매핑(관리자만 profiles 조회 가능 — 실패 시 '—' 폴백).
            const { data: profs } = await getProfiles();
            const map: Record<string, string> = {};
            for (const p of profs) map[p.id] = p.name || p.email || '직원';
            setNameMap(map);
            setLoading(false);
        })();
        return () => {
            alive = false;
        };
    }, []);

    const typeOf = (r: BlogPostReport): ReportType => r.report_type ?? 'save';
    const reporterNameOf = (r: BlogPostReport) => (r.reporter_id ? reporterMap[r.reporter_id] || '기자단' : '기자단');
    // 미입금(입금 전) 기준 집계 — 입금 처리하면 '입금 완료' 탭으로 넘어간다.
    const unpaid = reports.filter((r) => !r.paid);
    const nUnpaid = unpaid.length;
    const nSave = unpaid.filter((r) => typeOf(r) === 'save').length;
    const nPub = unpaid.filter((r) => typeOf(r) === 'publish').length;
    const nPaid = reports.length - nUnpaid;

    // 기자단 드롭다운 옵션 — 목록에 등장하는 기자단만.
    const reporterOpts = useMemo(() => {
        const ids = new Set<string>();
        reports.forEach((r) => r.reporter_id && ids.add(r.reporter_id));
        return [...ids].map((id) => ({ id, name: reporterMap[id] || '기자단' })).sort((a, b) => a.name.localeCompare(b.name));
    }, [reports, reporterMap]);

    // 입금일(KST) 범위 판정 — 입금 완료·정산 내역이 같은 기준을 쓰도록 한 곳에서만 정의한다.
    //   paid_at 이 없는 옛 건은 기본 제외(체크로 포함). 범위를 안 정하면 전부 통과.
    const payDay = (r: BlogPostReport) => kstDay(r.paid_at);
    const inPayRange = useMemo(() => (r: BlogPostReport) => {
        if (!dateFrom && !dateTo) return true;
        const d = payDay(r);
        if (!d) return includeNoDate;
        if (dateFrom && d < dateFrom) return false;
        if (dateTo && d > dateTo) return false;
        return true;
    }, [dateFrom, dateTo, includeNoDate]);
    // 입금일이 기록되지 않은 입금완료 건 수 — 범위를 걸면 안 보이므로 화면에 알려 준다.
    const noDateCount = useMemo(() => reports.filter((r) => r.paid && !payDay(r)).length, [reports]);

    const filtered = useMemo(
        () =>
            reports.filter((r) => {
                // 입금 완료 탭 = 입금된 건만(+ 입금일 범위). 그 외 탭 = 미입금 건만(입금하면 입금 완료로 이동).
                if (typeTab === 'paid') {
                    if (!r.paid) return false;
                    if (!inPayRange(r)) return false;
                } else {
                    if (r.paid) return false;
                    if (typeTab !== 'all' && typeOf(r) !== typeTab) return false;
                }
                return (
                    (blogFilter === 'all' || r.blog_account_id === blogFilter) &&
                    (reporterFilter === 'all' || r.reporter_id === reporterFilter)
                );
            }),
        [reports, typeTab, blogFilter, reporterFilter, inPayRange],
    );

    // 순번/정렬 — 업로드일(created_at) 기준. 헤더 클릭으로 오름/내림 토글. 맨 앞 '순번' = 표시 순서 1..N.
    const ordered = useMemo(() => {
        const arr = [...filtered].sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));
        return uploadSort === 'desc' ? arr.reverse() : arr;
    }, [filtered, uploadSort]);

    // ── 정산 내역(입금완료 건) — 기자단별 · 입금일(날짜) 범위로 공급가/원천징수(3.3%)/실지급 ──
    const paidScoped = useMemo(
        () => reports.filter((r) => r.paid && (reporterFilter === 'all' || r.reporter_id === reporterFilter)),
        [reports, reporterFilter],
    );
    // 기자단별 집계(입금일 날짜 범위 반영). from/to 비면 전체.
    const settleRows = useMemo(() => {
        const scoped = paidScoped.filter(inPayRange);
        const byRep = new Map<string, BlogPostReport[]>();
        for (const r of scoped) {
            const k = r.reporter_id || 'none';
            const arr = byRep.get(k) ?? [];
            arr.push(r); byRep.set(k, arr);
        }
        return [...byRep.entries()]
            .map(([rid, list]) => {
                const gross = list.reduce((s, r) => s + reportOutUnit(r, blogNameOf(r.blog_account_id)), 0);
                const w = withhold(gross);
                return { rid, name: rid === 'none' ? '기자단' : reporterMap[rid] || '기자단', count: list.length, gross, tax: w.tax, net: w.net, list };
            })
            .sort((a, b) => b.gross - a.gross);
    }, [paidScoped, inPayRange, reporterMap, blogNameOf]);
    // 입금일별 요약 — '언제 얼마 나갔는지'가 한 줄로 보이게. 칩 클릭 = 그 날짜만 보기.
    //   기준은 입금 버튼을 누른 시각(paid_at, KST). 글 업로드일과 무관하다.
    const payDays = useMemo(() => {
        const m = new Map<string, { count: number; gross: number }>();
        for (const r of paidScoped) {
            const d = payDay(r) || '미기록';
            const cur = m.get(d) ?? { count: 0, gross: 0 };
            cur.count += 1;
            cur.gross += reportOutUnit(r, blogNameOf(r.blog_account_id));
            m.set(d, cur);
        }
        return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0]));
    }, [paidScoped, blogNameOf]);

    // 주차별 정산 — 입금일(입금 버튼 누른 날) 기준으로 일~토 한 주씩 쌓는다.
    //   데이터가 있는 주 + 이번 주는 항상 노출(이번 주에 아직 입금이 없어도 자리를 만들어 둔다).
    const weeks = useMemo(() => {
        const byWeek = new Map<string, { count: number; gross: number }>();
        for (const r of paidScoped) {
            const d = payDay(r);
            if (!d) continue;
            const s = weekSunday(d);
            const cur = byWeek.get(s) ?? { count: 0, gross: 0 };
            cur.count += 1;
            cur.gross += reportOutUnit(r, blogNameOf(r.blog_account_id));
            byWeek.set(s, cur);
        }
        const thisWeek = weekSunday(kstDay(new Date().toISOString()));
        if (!byWeek.has(thisWeek)) byWeek.set(thisWeek, { count: 0, gross: 0 });
        return [...byWeek.entries()]
            .map(([sun, v]) => ({ sun, end: addDaysYmd(sun, 6), label: weekLabel(sun), ...v }))
            .sort((a, b) => b.sun.localeCompare(a.sun));
    }, [paidScoped, blogNameOf]);

    const settleTotal = useMemo(() => {
        const gross = settleRows.reduce((s, r) => s + r.gross, 0);
        return { count: settleRows.reduce((s, r) => s + r.count, 0), gross, ...withhold(gross) };
    }, [settleRows]);

    const dateOf = (iso: string | null) => (iso ? iso.slice(0, 10) : '—');

    // 입금 처리 토글 — 정산(report.paid) + 계약 진행이력(week=rpt-id) 동기화.
    //   ⚠️ paid_at 을 화면 상태에도 같이 넣어야 한다. 입금 완료·정산 내역 탭은 paid_at(KST)으로 거르는데,
    //      예전엔 paid 만 바꿔서 방금 입금한 건이 paid_at=null 이 되고 → 날짜 범위를 걸어 둔 상태면
    //      '전체'에서는 사라졌는데 '입금 완료'에도 안 나타나 입금이 안 먹은 것처럼 보였다.
    //   finally 로 '처리 중…' 을 반드시 푼다(네트워크 예외로 버튼이 영구히 잠기던 경로 차단).
    const togglePay = async (r: BlogPostReport) => {
        setPaying(r.id);
        const next = !r.paid;
        try {
            const { error } = await setReportPaid(r, next);
            if (error) {
                alert('입금 처리 실패: ' + error.message);
                return;
            }
            const at = next ? new Date().toISOString() : null;
            setReports((prev) => prev.map((x) => (x.id === r.id ? { ...x, paid: next, paid_at: at } : x)));
        } catch (e) {
            alert('입금 처리 실패(네트워크·세션): ' + ((e as Error)?.message || e));
        } finally {
            setPaying(null);
        }
    };

    // 정산 토글(정산/미정산) — 입금의 전 단계 상태 구분. 입금·외주비엔 영향 없음.
    const toggleSettled = async (r: BlogPostReport) => {
        setSettling(r.id);
        const next = !r.settled;
        const { error } = await setReportSettled(r, next);
        setSettling(null);
        if (error) {
            alert('정산 처리 실패: ' + error.message + '\n(blog_post_reports.settled 컬럼이 없으면 docs/blog-report-settled.sql 실행 필요)');
            return;
        }
        setReports((prev) => prev.map((x) => (x.id === r.id ? { ...x, settled: next } : x)));
    };

    return (
        <div
            className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4"
            onMouseDown={(e) => e.target === e.currentTarget && onClose()}
        >
            <div className="max-h-[88vh] w-[min(1180px,97vw)] overflow-y-auto rounded-2xl bg-white p-6">
                <div className="mb-3 flex items-center justify-between">
                    <div>
                        <h3 className="m-0 text-lg font-bold text-[#0f172a]">기자단 승인 처리 내역</h3>
                        <p className="m-0 mt-0.5 text-[12px] text-[#94a3b8]">
                            승인·발행완료된 기자단 글 · 총 {reports.length}건 (미입금 {nUnpaid} · 입금완료 {nPaid})
                        </p>
                    </div>
                    <button
                        className="rounded-md border border-[#cbd5e1] px-3 py-1 text-sm font-semibold text-[#64748b]"
                        onClick={onClose}
                        type="button"
                    >
                        닫기
                    </button>
                </div>

                {/* 저장/발행 탭 */}
                <div className="mb-2 flex gap-1 border-b border-[#e2e8f0]">
                    {(
                        [
                            ['all', `전체 (${nUnpaid})`],
                            ['save', `저장 (${nSave})`],
                            ['publish', `발행 (${nPub})`],
                            ['paid', `입금 완료 (${nPaid})`],
                            ['settle', '정산 내역'],
                        ] as ['all' | ReportType | 'paid' | 'settle', string][]
                    ).map(([k, label]) => (
                        <button
                            className={`-mb-px border-b-2 px-4 py-2 text-sm font-bold ${
                                typeTab === k
                                    ? k === 'settle'
                                        ? 'border-[#7c3aed] text-[#7c3aed]' // 정산 = 보라
                                        : k === 'paid'
                                            ? 'border-[#2563eb] text-[#2563eb]' // 입금 완료 = 파랑(미입금과 구분)
                                            : 'border-[#16a34a] text-[#16a34a]'
                                    : 'border-transparent text-[#94a3b8]'
                            }`}
                            key={k}
                            onClick={() => setTypeTab(k)}
                            type="button"
                        >
                            {label}
                        </button>
                    ))}
                </div>

                {/* 필터 — 기자단 · 업체 드롭다운 */}
                <div className="mb-3 flex flex-wrap items-center gap-3">
                    <div className="flex items-center gap-2">
                        <span className="text-[12px] font-semibold text-[#64748b]">기자단</span>
                        <select
                            className="h-9 min-w-[150px] rounded-md border border-[#cbd5e1] bg-white px-2.5 text-sm"
                            onChange={(e) => setReporterFilter(e.target.value)}
                            value={reporterFilter}
                        >
                            <option value="all">전체 기자단</option>
                            {reporterOpts.map((o) => (
                                <option key={o.id} value={o.id}>
                                    {o.name}
                                </option>
                            ))}
                        </select>
                    </div>
                    {/* 입금일 범위 — 입금 완료·정산 내역 두 탭에 같은 기준(입금 처리 시점, KST)으로 적용 */}
                    {typeTab === 'settle' || typeTab === 'paid' ? (
                        <div className="flex flex-wrap items-center gap-2">
                            <span className="text-[12px] font-semibold text-[#64748b]">입금일</span>
                            <input type="date" className="h-9 rounded-md border border-[#cbd5e1] bg-white px-2 text-sm"
                                value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
                            <span className="text-[12px] text-[#94a3b8]">~</span>
                            <input type="date" className="h-9 rounded-md border border-[#cbd5e1] bg-white px-2 text-sm"
                                value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
                            {dateFrom || dateTo ? (
                                <button type="button" onClick={() => { setDateFrom(''); setDateTo(''); }}
                                    className="text-[12px] font-semibold text-[#64748b] hover:text-[#334155]">전체</button>
                            ) : null}
                            {/* 옛 데이터(입금일 미기록)는 범위를 걸면 사라진다 — 사라진 이유를 화면에 밝히고 포함 선택을 준다. */}
                            {(dateFrom || dateTo) && noDateCount ? (
                                <label className="flex cursor-pointer items-center gap-1 rounded-md border border-[#fed7aa] bg-[#fff7ed] px-2 py-1 text-[11px] font-semibold text-[#9a3412]">
                                    <input type="checkbox" className="h-3.5 w-3.5 accent-[#c2410c]" checked={includeNoDate}
                                        onChange={(e) => setIncludeNoDate(e.target.checked)} />
                                    입금일 미기록 {noDateCount}건 포함
                                </label>
                            ) : null}
                        </div>
                    ) : null}
                    {typeTab !== 'settle' && accounts.length > 1 ? (
                        <div className="flex items-center gap-2">
                            <span className="text-[12px] font-semibold text-[#64748b]">업체</span>
                            <select
                                className="h-9 min-w-[150px] rounded-md border border-[#cbd5e1] bg-white px-2.5 text-sm"
                                onChange={(e) => setBlogFilter(e.target.value)}
                                value={blogFilter}
                            >
                                <option value="all">전체 업체</option>
                                {accounts.map((a) => (
                                    <option key={a.id} value={a.id}>
                                        {a.name}
                                    </option>
                                ))}
                            </select>
                        </div>
                    ) : null}
                </div>

                {typeTab === 'settle' ? (
                    <>
                    {/* 주차 칩은 결과가 0건이어도 항상 보여야 한다 — 다른 주로 갈아탈 손잡이가 사라지면 안 된다. */}
                    <div className="mb-4 rounded-xl border border-[#ddd6fe] bg-[#faf5ff] p-3">
                        <div className="mb-1.5 text-[11px] font-bold text-[#6d28d9]">
                            정산 주차 <span className="font-normal text-[#a78bfa]">— 일~토 · 입금 버튼 누른 날 기준으로 쌓입니다</span>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                            <button type="button" onClick={() => { setDateFrom(''); setDateTo(''); }}
                                className={`rounded-full border px-2.5 py-1 text-[11px] font-bold ${!dateFrom && !dateTo ? 'border-[#6d28d9] bg-[#6d28d9] text-white' : 'border-[#cbd5e1] bg-white text-[#475569] hover:border-[#6d28d9]'}`}>
                                전체 기간
                            </button>
                            {weeks.map((w) => {
                                const on = dateFrom === w.sun && dateTo === w.end;
                                return (
                                    <button key={w.sun} type="button" onClick={() => { setDateFrom(w.sun); setDateTo(w.end); }}
                                        title={`${w.sun} ~ ${w.end} 에 입금 처리한 건`}
                                        className={`rounded-full border px-2.5 py-1 text-[11px] font-bold ${on ? 'border-[#6d28d9] bg-[#6d28d9] text-white' : 'border-[#cbd5e1] bg-white text-[#475569] hover:border-[#6d28d9]'}`}>
                                        {w.label} <span className={`font-normal ${on ? 'text-[#ddd6fe]' : 'text-[#94a3b8]'}`}>{mdOf(w.sun)}~{mdOf(w.end)}</span>
                                        {' · '}{w.count}건{w.count ? ` · ₩${won(w.gross)}` : ''}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                    {loading ? (
                        <div className="py-12 text-center text-sm text-[#94a3b8]">불러오는 중...</div>
                    ) : settleRows.length === 0 ? (
                        <div className="py-12 text-center text-sm text-[#94a3b8]">
                            {dateFrom || dateTo ? (
                                <>
                                    <div>{dateFrom || '처음'} ~ {dateTo || '오늘'} 사이에 입금 처리한 건이 없습니다.</div>
                                    <button type="button" onClick={() => { setDateFrom(''); setDateTo(''); }}
                                        className="mt-2 rounded-md border border-[#cbd5e1] px-3 py-1 text-[12px] font-semibold text-[#475569] hover:bg-[#f1f5f9]">전체 기간 보기</button>
                                </>
                            ) : '입금완료된 정산 내역이 없습니다.'}
                        </div>
                    ) : (
                        <div className="grid gap-4">
                            {/* 입금일별 — 입금 버튼 누른 날 기준. 칩을 누르면 그 날짜만 본다. */}
                            {payDays.length ? (
                                <div className="rounded-xl border border-[#e2e8f0] bg-[#f8fafc] p-3">
                                    <div className="mb-1.5 text-[11px] font-bold text-[#64748b]">
                                        입금일별 <span className="font-normal text-[#94a3b8]">— 입금 버튼을 누른 시점 기준(글 업로드일과 무관)</span>
                                    </div>
                                    <div className="flex flex-wrap gap-1.5">
                                        {payDays.map(([d, v]) => {
                                            const on = dateFrom === d && dateTo === d;
                                            return (
                                                <button key={d} type="button"
                                                    onClick={() => { if (on) { setDateFrom(''); setDateTo(''); } else if (d !== '미기록') { setDateFrom(d); setDateTo(d); } }}
                                                    title={d === '미기록' ? '입금 시각이 없는 옛 데이터' : `${d} 입금 건만 보기`}
                                                    className={`rounded-full border px-2.5 py-1 text-[11px] font-bold ${on ? 'border-[#7c3aed] bg-[#7c3aed] text-white' : 'border-[#cbd5e1] bg-white text-[#475569] hover:border-[#7c3aed]'}`}>
                                                    {d} · {v.count}건 · ₩{won(v.gross)}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            ) : null}
                            {/* 합계 요약 카드 */}
                            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                                <div className="rounded-xl border border-[#e2e8f0] bg-white p-3">
                                    <div className="text-[11px] text-[#64748b]">건수</div>
                                    <div className="text-xl font-bold text-[#334155]">{settleTotal.count}건</div>
                                </div>
                                <div className="rounded-xl border border-[#e2e8f0] bg-white p-3">
                                    <div className="text-[11px] text-[#64748b]">공급가 (원천징수 전)</div>
                                    <div className="text-xl font-bold text-[#0f172a]">₩{won(settleTotal.gross)}</div>
                                </div>
                                <div className="rounded-xl border border-[#fed7aa] bg-[#fff7ed] p-3">
                                    <div className="text-[11px] text-[#9a3412]">원천징수 3.3%</div>
                                    <div className="text-xl font-bold text-[#c2410c]">-₩{won(settleTotal.tax)}</div>
                                </div>
                                <div className="rounded-xl border border-[#bbf7d0] bg-[#f0fdf4] p-3">
                                    <div className="text-[11px] text-[#166534]">실지급 (세후)</div>
                                    <div className="text-xl font-bold text-[#15803d]">₩{won(settleTotal.net)}</div>
                                </div>
                            </div>
                            {/* 기자단별 정산 표 */}
                            <div className="overflow-x-auto rounded-xl border border-[#e2e8f0]">
                                <table className="w-full border-collapse text-sm">
                                    <thead>
                                        <tr className="border-b border-[#e2e8f0] bg-[#f8fafc] text-left text-[12px] text-[#64748b]">
                                            <th className="px-3 py-2 font-semibold">기자단</th>
                                            <th className="px-3 py-2 text-center font-semibold">건수</th>
                                            <th className="px-3 py-2 text-right font-semibold">공급가 (세전)</th>
                                            <th className="px-3 py-2 text-right font-semibold">원천징수 3.3%</th>
                                            <th className="px-3 py-2 text-right font-semibold">실지급 (세후)</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {settleRows.map((row) => (
                                            <tr className="border-b border-[#f1f5f9]" key={row.rid}>
                                                <td className="px-3 py-2 font-semibold text-[#334155]">{row.name}</td>
                                                <td className="px-3 py-2 text-center text-[#475569]">{row.count}건</td>
                                                <td className="px-3 py-2 text-right font-semibold text-[#0f172a]">₩{won(row.gross)}</td>
                                                <td className="px-3 py-2 text-right text-[#c2410c]">-₩{won(row.tax)}</td>
                                                <td className="px-3 py-2 text-right font-bold text-[#15803d]">₩{won(row.net)}</td>
                                            </tr>
                                        ))}
                                        <tr className="border-t-2 border-[#e2e8f0] bg-[#f8fafc] font-bold">
                                            <td className="px-3 py-2 text-[#334155]">합계</td>
                                            <td className="px-3 py-2 text-center text-[#334155]">{settleTotal.count}건</td>
                                            <td className="px-3 py-2 text-right text-[#0f172a]">₩{won(settleTotal.gross)}</td>
                                            <td className="px-3 py-2 text-right text-[#c2410c]">-₩{won(settleTotal.tax)}</td>
                                            <td className="px-3 py-2 text-right text-[#15803d]">₩{won(settleTotal.net)}</td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>
                            {/* 특정 기자단 선택 시 — 선택 날짜범위의 그 기자단 입금 건 상세 */}
                            {reporterFilter !== 'all' ? (
                                <div className="overflow-x-auto rounded-xl border border-[#e2e8f0]">
                                    <table className="w-full border-collapse text-[13px]">
                                        <thead>
                                            <tr className="border-b border-[#e2e8f0] bg-[#f8fafc] text-left text-[11px] text-[#64748b]">
                                                {['입금일', '업로드일', '업체', '제목', '회차', '금액'].map((h) => (
                                                    <th key={h} className="whitespace-nowrap px-3 py-2 font-semibold">{h}</th>
                                                ))}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {settleRows.flatMap((row) => row.list)
                                                .sort((a, b) => (b.paid_at || '').localeCompare(a.paid_at || ''))
                                                .map((r) => (
                                                    <tr className="border-b border-[#f1f5f9] text-[#334155]" key={r.id}>
                                                        <td className="whitespace-nowrap px-3 py-2">
                                                            {payDay(r) ? <>{payDay(r)} <span className="text-[11px] text-[#94a3b8]">{kstTime(r.paid_at)}</span></> : '—'}
                                                        </td>
                                                        <td className="whitespace-nowrap px-3 py-2 text-[#64748b]">{dateOf(r.created_at)}</td>
                                                        <td className="whitespace-nowrap px-3 py-2">{blogNameOf(r.blog_account_id)}</td>
                                                        <td className="px-3 py-2">{r.title || '—'}</td>
                                                        <td className="whitespace-nowrap px-3 py-2 text-[#64748b]">{r.round != null ? `${r.round}회차` : '—'}</td>
                                                        <td className="whitespace-nowrap px-3 py-2 text-right font-semibold">₩{won(reportOutUnit(r, blogNameOf(r.blog_account_id)))}</td>
                                                    </tr>
                                                ))}
                                        </tbody>
                                    </table>
                                </div>
                            ) : (
                                <p className="m-0 text-center text-[12px] text-[#94a3b8]">기자단을 선택하면 해당 기자단의 입금 건 상세가 표시됩니다.</p>
                            )}
                        </div>
                    )}
                    </>
                ) : loading ? (
                    <div className="py-12 text-center text-sm text-[#94a3b8]">불러오는 중...</div>
                ) : filtered.length === 0 ? (
                    <div className="py-12 text-center text-sm text-[#94a3b8]">승인 처리된 글이 없습니다.</div>
                ) : (
                    <div className="overflow-x-auto">
                        {/* 범위를 걸었을 때 몇 건이 보이는지 명시 — '설정했는데 전부 나온다'는 오해 방지 */}
                        {typeTab === 'paid' && (dateFrom || dateTo) ? (
                            <p className="m-0 mb-2 text-[12px] font-semibold text-[#1d4ed8]">
                                입금일 {dateFrom || '처음'} ~ {dateTo || '오늘'} · {filtered.length}건
                                <span className="ml-1 font-normal text-[#94a3b8]">(전체 입금완료 {nPaid}건 중)</span>
                            </p>
                        ) : null}
                        <table className="w-full border-collapse text-sm">
                            <thead>
                                <tr className="border-b border-[#e2e8f0] text-left text-[12px] text-[#64748b]">
                                    <th className="whitespace-nowrap px-2 py-2 text-center font-semibold">순번</th>
                                    <th className="whitespace-nowrap px-2 py-2 font-semibold">
                                        <button type="button" onClick={() => setUploadSort((d) => (d === 'asc' ? 'desc' : 'asc'))} className="inline-flex items-center gap-1 font-semibold hover:text-[#334155]" title="업로드일 정렬 전환">
                                            업로드일 <span className="text-[10px] text-[#94a3b8]">{uploadSort === 'asc' ? '▲' : '▼'}</span>
                                        </button>
                                    </th>
                                    <th className="whitespace-nowrap px-2 py-2 font-semibold">승인일</th>
                                    {typeTab === 'paid' ? <th className="whitespace-nowrap px-2 py-2 font-semibold text-[#1d4ed8]">입금일</th> : null}
                                    <th className="whitespace-nowrap px-2 py-2 font-semibold">승인 직원</th>
                                    <th className="whitespace-nowrap px-2 py-2 font-semibold">업체</th>
                                    <th className="whitespace-nowrap px-2 py-2 font-semibold">기자단</th>
                                    <th className="whitespace-nowrap px-2 py-2 font-semibold">블로그 종류</th>
                                    <th className="px-2 py-2 font-semibold">제목</th>
                                    <th className="whitespace-nowrap px-2 py-2 font-semibold">회차</th>
                                    <th className="whitespace-nowrap px-2 py-2 font-semibold">구분</th>
                                    <th className="whitespace-nowrap px-2 py-2 text-center font-semibold">정산</th>
                                    <th className="whitespace-nowrap px-2 py-2 text-center font-semibold">입금 처리</th>
                                </tr>
                            </thead>
                            <tbody>
                                {ordered.map((r, i) => (
                                    <tr className="border-b border-[#f1f5f9] align-top" key={r.id}>
                                        <td className="whitespace-nowrap px-2 py-2 text-center font-semibold text-[#94a3b8]">{i + 1}</td>
                                        <td className="whitespace-nowrap px-2 py-2 text-[#475569]">{dateOf(r.created_at)}</td>
                                        <td className="whitespace-nowrap px-2 py-2 text-[#475569]">{dateOf(r.reviewed_at)}</td>
                                        {typeTab === 'paid' ? (
                                            <td className="whitespace-nowrap px-2 py-2 font-semibold text-[#1d4ed8]">
                                                {payDay(r)
                                                    ? <>{payDay(r)} <span className="font-normal text-[#94a3b8]">{kstTime(r.paid_at)}</span></>
                                                    : <span className="font-normal text-[#f59e0b]" title="입금 처리 시각이 기록되지 않은 옛 데이터입니다. 입금 버튼을 껐다 켜면 그 시점으로 기록됩니다.">미기록</span>}
                                            </td>
                                        ) : null}
                                        <td className="whitespace-nowrap px-2 py-2 font-semibold text-[#334155]">
                                            {r.reviewed_by ? nameMap[r.reviewed_by] || '—' : '—'}
                                        </td>
                                        <td className="whitespace-nowrap px-2 py-2 text-[#334155]">{blogNameOf(r.blog_account_id)}</td>
                                        <td className="whitespace-nowrap px-2 py-2">
                                            <span className="rounded-full bg-[#e0e7ff] px-2 py-0.5 text-[11px] font-bold text-[#4338ca]">
                                                {reporterNameOf(r)}
                                            </span>
                                        </td>
                                        <td className="whitespace-nowrap px-2 py-2">
                                            <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${kindChipCls(r.blog_kind)}`}>
                                                {r.blog_kind ?? '브랜드 블로그'}
                                            </span>
                                        </td>
                                        <td className="px-2 py-2 text-[#0f172a]">
                                            {r.post_url ? (
                                                <a className="hover:underline" href={r.post_url} rel="noopener noreferrer" target="_blank">
                                                    {r.title || r.post_url}
                                                </a>
                                            ) : (
                                                r.title || '—'
                                            )}
                                        </td>
                                        <td className="whitespace-nowrap px-2 py-2 text-[#475569]">
                                            {r.round != null ? `${r.round}회차` : '—'}
                                        </td>
                                        <td className="whitespace-nowrap px-2 py-2">
                                            {typeOf(r) === 'publish' ? (
                                                <span className="rounded-full bg-[#dbeafe] px-2 py-0.5 text-[11px] font-bold text-[#1e40af]">발행</span>
                                            ) : (
                                                <span className="rounded-full bg-[#dcfce7] px-2 py-0.5 text-[11px] font-bold text-[#16a34a]">저장</span>
                                            )}
                                        </td>
                                        <td className="whitespace-nowrap px-2 py-2 text-center">
                                            <button
                                                className={`rounded-md px-2.5 py-1 text-[11px] font-bold disabled:opacity-50 ${
                                                    r.settled
                                                        ? 'bg-[#ede9fe] text-[#6d28d9] hover:bg-[#ddd6fe]'
                                                        : 'border border-[#cbd5e1] bg-white text-[#64748b] hover:bg-[#f1f5f9]'
                                                }`}
                                                disabled={settling === r.id}
                                                onClick={() => void toggleSettled(r)}
                                                title={r.settled ? '클릭 시 미정산으로 되돌림' : '정산 처리(입금 전 단계) — 입금·외주비엔 영향 없음'}
                                                type="button"
                                            >
                                                {settling === r.id ? '처리 중…' : r.settled ? '정산' : '미정산'}
                                            </button>
                                        </td>
                                        <td className="whitespace-nowrap px-2 py-2 text-center">
                                            {/* 미정산(settled=false)이면 입금 처리 불가 — 정산 먼저. 단 이미 입금된 건은 되돌릴 수 있게 허용. */}
                                            <button
                                                className={`rounded-md px-2.5 py-1 text-[11px] font-bold disabled:cursor-not-allowed disabled:opacity-50 ${
                                                    r.paid
                                                        ? 'bg-[#dcfce7] text-[#15803d] hover:bg-[#bbf7d0]'
                                                        : 'bg-[#1e40af] text-white hover:bg-[#1e3a8a]'
                                                }`}
                                                disabled={paying === r.id || (!r.settled && !r.paid)}
                                                onClick={() => void togglePay(r)}
                                                title={
                                                    !r.settled && !r.paid
                                                        ? '정산 먼저 처리하세요 (미정산 건은 입금 처리 불가)'
                                                        : r.paid
                                                            ? '클릭 시 미입금으로 되돌림'
                                                            : '입금 처리 — 기자단 정산·계약 진행이력에 함께 반영'
                                                }
                                                type="button"
                                            >
                                                {/* 비활성 이유를 버튼 글자로 — 예전엔 '입금' 그대로라 눌러도 반응 없는 것처럼 보였다. */}
                                                {paying === r.id
                                                    ? '처리 중…'
                                                    : r.paid
                                                      ? '입금완료'
                                                      : r.settled
                                                        ? '입금'
                                                        : '정산 먼저'}
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}
