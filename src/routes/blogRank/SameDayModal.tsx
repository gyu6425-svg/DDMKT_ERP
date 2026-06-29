import { useState } from 'react';
import { queueReportSend, type BlogAccount, type BlogMeasurement, type BlogPost } from '../../api/blogRank';
import { buildRankReportMessage } from './report';

// 측정 글 리스트 모달 — 크롤링 현황 KPI('당일 측정 글' / '전날 측정 글 순위') 클릭 시 표시.
//   mode='publish'(당일): 업체명 · 블로그(글링크) · [성과] 버튼(=발행 보고 카톡 발송).
//   mode='rank'(전날)   : 업체명 · 블로그(글링크) · 통합탭 · 블로그탭 순위.
//   '지금까지 조회된' 것만 → 크롤 진행 중 실시간 증가.
export type SameDayRow = { post: BlogPost; account: BlogAccount | null; m: BlogMeasurement };

// 업로드 시각(published_at, KST ISO) → '6/26 19:30'.
const fmtAt = (iso: string | null): string => {
    if (!iso) return '—';
    const d = iso.slice(5, 10).replace('-', '/');
    const t = iso.slice(11, 16);
    return t ? `${d} ${t}` : d;
};

// 통합탭/블로그탭 검색 URL — 크롤 측정과 동일한 m.search(모바일). 클릭 시 실제 검색 화면으로 이동.
const tiSearchUrl = (kw: string) => `https://m.search.naver.com/search.naver?query=${encodeURIComponent(kw)}`;
const blSearchUrl = (kw: string) => `https://m.search.naver.com/search.naver?ssc=tab.m_blog.all&query=${encodeURIComponent(kw)}`;

function Rank({
    v,
    status,
    tab,
    keyword,
}: {
    v: number | undefined;
    status: string | undefined;
    tab: 'ti' | 'bl';
    keyword: string;
}) {
    const st = status ?? 'ok';
    let label: string;
    let color: string;
    if (st === 'fail') {
        label = '실패';
        color = '#dc2626';
    } else if (st === 'out' || v == null || v > 30) {
        label = '권외';
        color = '#94a3b8';
    } else {
        label = `${v}위`;
        color = v <= 10 ? (tab === 'ti' ? '#059669' : '#1e40af') : '#475569';
    }
    if (!keyword) return <span className="text-[15px] font-bold" style={{ color }}>{label}</span>;
    const url = tab === 'ti' ? tiSearchUrl(keyword) : blSearchUrl(keyword);
    // 클릭 → 실제 네이버 검색 화면(새 탭). ※ 시크릿(로그아웃) 창에서 봐야 측정값과 일치(개인화 제거).
    return (
        <a
            className="text-[15px] font-bold underline decoration-dotted underline-offset-2 hover:opacity-80"
            href={url}
            rel="noopener noreferrer"
            style={{ color }}
            target="_blank"
            title="네이버 검색 화면 열기 — 시크릿(로그아웃) 창에서 보면 측정값과 일치합니다"
        >
            {label}
        </a>
    );
}

export function SameDayModal({
    rows,
    dayLabel,
    mode = 'publish',
    allPosts = [],
    accounts = [],
    onClose,
    onToast,
}: {
    rows: SameDayRow[];
    dayLabel: string;
    mode?: 'publish' | 'rank';
    allPosts?: BlogPost[]; // 전체 글(누적 발송 리스트용 — 모든 날짜 발송분)
    accounts?: BlogAccount[]; // 업체(누적 발송 리스트 업체명 표시용)
    onClose: () => void;
    onToast: (m: string) => void;
}) {
    const [busy, setBusy] = useState<string | null>(null);
    const [sortAt, setSortAt] = useState<'desc' | 'asc' | null>(null); // 업로드 시간 정렬(null=업체명순)
    const [view, setView] = useState<'measured' | 'sent' | 'history'>('measured'); // 탭: 측정 글 / 발송 리스트 / 누적 발송 리스트
    const [histDate, setHistDate] = useState<string>(''); // 누적 발송 리스트 날짜 필터('' = 전체)
    // 발송 여부는 DB(report_sent_at/rank_sent_at) 기준. 방금 누른 글만 즉시 '요청됨' 표시(새로고침하면 DB 기준).
    const [rankReq, setRankReq] = useState<Set<string>>(() => new Set());
    const tiNorm = (m: BlogMeasurement) =>
        (m.ti_status ?? 'ok') === 'ok' && m.ti != null && m.ti <= 30 ? m.ti : 999;
    const sorted =
        mode === 'rank'
            ? [...rows].sort((a, b) => tiNorm(a.m) - tiNorm(b.m)) // 순위 좋은 순
            : sortAt
              ? [...rows].sort((a, b) => {
                    const c = (a.post.published_at || '').localeCompare(b.post.published_at || '');
                    return sortAt === 'asc' ? c : -c;
                })
              : [...rows].sort((a, b) => (a.account?.name || '').localeCompare(b.account?.name || '', 'ko'));
    const title = mode === 'rank' ? '전날 측정 글 순위' : '당일 측정 글';

    // 발송 리스트(자동발송 기록) — report_sent_at(DB) 기준. 최근 발송순.
    const sentInfo = (post: BlogPost): { at: string | null } | null =>
        post.report_sent_at ? { at: post.report_sent_at } : null;
    const sentList = [...rows]
        .filter((r) => !!sentInfo(r.post))
        .sort((a, b) => (b.post.report_sent_at || '').localeCompare(a.post.report_sent_at || ''));
    // 전날 순위 발송 리스트 — rank_sent_at(DB) 기준. 최근 발송순. (발송 전으로 되돌리려면 DB rank_sent_at 만 비우면 됨)
    const rankSentInfo = (post: BlogPost): { at: string | null } | null =>
        post.rank_sent_at ? { at: post.rank_sent_at } : null;
    const rankSentList = [...rows]
        .filter((r) => !!rankSentInfo(r.post))
        .sort((a, b) => (b.post.rank_sent_at || '').localeCompare(a.post.rank_sent_at || ''));
    // 측정 글 탭 = '아직 발송 안 한' 글만 (발송하면 발송 리스트로 빠짐). 당일=report_sent_at, 전날=rank_sent_at 기준.
    const measuredRows =
        mode === 'publish'
            ? sorted.filter((r) => !sentInfo(r.post))
            : sorted.filter((r) => !rankSentInfo(r.post));
    // 누적 발송 리스트 = 모든 날짜의 발송완료 글(report_sent_at 기준). 날짜 필터 가능.
    const accById = new Map(accounts.map((a) => [a.id, a]));
    const historyAll = allPosts
        .filter((p) => !!p.report_sent_at)
        .map((p) => ({ post: p, account: accById.get(p.blog_account_id) ?? null }))
        .sort((a, b) => (b.post.report_sent_at || '').localeCompare(a.post.report_sent_at || ''));
    const histDates = [...new Set(historyAll.map((r) => (r.post.report_sent_at || '').slice(0, 10)))]
        .sort()
        .reverse();
    const historyRows = histDate
        ? historyAll.filter((r) => (r.post.report_sent_at || '').slice(0, 10) === histDate)
        : historyAll;
    const publishSent = mode === 'publish' && view === 'sent';
    const publishHistory = mode === 'publish' && view === 'history';
    const rankSent = mode === 'rank' && view === 'sent'; // 전날 순위 발송 리스트 탭
    const headCount = publishHistory
        ? historyRows.length
        : rankSent
          ? rankSentList.length
          : publishSent
            ? sentList.length
            : measuredRows.length;

    // 전날(순위) 모달의 발송 = 카톡 비즈 웹 자동발송 큐에 '순위 성과보고' 요청을 넣는다(리스너가 발송).
    const onRankSend = async (account: BlogAccount | null, post: BlogPost, m: BlogMeasurement | null) => {
        if (!account) return;
        const message = buildRankReportMessage(account, post, m);
        if (!message) {
            onToast('10위 이내 노출이 없어 발송하지 않았습니다 (권외)');
            return;
        }
        setBusy(post.id);
        try {
            const { error } = await queueReportSend({ post_id: post.id, company: account.name, message, kind: 'rank' });
            if (error) {
                onToast('발송 요청 실패: ' + (error.message || ''));
            } else {
                setRankReq((s) => new Set(s).add(post.id)); // 즉시 '요청됨' 표시(새로고침하면 DB rank_sent_at 기준)
                onToast('순위 보고 발송 요청됨 — 곧 카톡으로 발송됩니다');
            }
        } finally {
            setBusy(null);
        }
    };
    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
            onMouseDown={(e) => e.target === e.currentTarget && onClose()}
        >
            <div className="flex max-h-[88vh] w-[min(900px,96vw)] flex-col rounded-2xl border-2 border-[#2563eb] bg-white p-6 shadow-xl">
                <div className="flex items-center justify-between">
                    <h3 className="m-0 text-lg font-bold text-[#0f172a]">
                        {title} <span className="text-[#2563eb]">({dayLabel})</span>
                    </h3>
                    <span className="rounded-full bg-[#eff6ff] px-3 py-1 text-xs font-bold text-[#1e40af]">총 {headCount}글</span>
                </div>

                {/* 상단 탭 — 당일: 당일 측정 글/발송 리스트/누적 / 전날: 전날 순위/발송 리스트 */}
                <div className="mt-3 flex gap-1 border-b border-[#e2e8f0]">
                    {(mode === 'publish'
                        ? ([
                              ['measured', '당일 측정 글', measuredRows.length],
                              ['sent', '발송 리스트', sentList.length],
                              ['history', '누적 발송 리스트', historyAll.length],
                          ] as const)
                        : ([
                              ['measured', '전날 측정 글 순위', measuredRows.length],
                              ['sent', '발송 리스트', rankSentList.length],
                          ] as const)
                    ).map(([key, label, n]) => (
                            <button
                                key={key}
                                className={`-mb-px rounded-t-md border-b-2 px-4 py-2 text-sm font-bold ${
                                    view === key
                                        ? 'border-[#2563eb] text-[#1e40af]'
                                        : 'border-transparent text-[#94a3b8] hover:text-[#475569]'
                                }`}
                                onClick={() => setView(key)}
                                type="button"
                            >
                                {label} <span className="text-xs font-semibold">({n})</span>
                            </button>
                        ))}
                    </div>

                <p className="mt-2 mb-3 text-sm text-[#64748b]">
                    {mode === 'rank'
                        ? rankSent
                            ? '순위 성과보고를 카톡으로 발송한 기록입니다. (전날 순위에서 발송하면 여기로 옮겨집니다)'
                            : `전날(${dayLabel}) 발행·측정 글 중 아직 발송 안 한 순위입니다. 발송하면 발송 리스트로 빠집니다. (통합탭 노출 좋은 순)`
                        : publishHistory
                          ? '날짜별로 누적된 발송 완료 기록입니다. 날짜를 골라 그날 발송분만 볼 수 있어요.'
                          : publishSent
                            ? '오늘 발송 완료된 글입니다. (당일 측정 글에서 발송하면 여기로 옮겨집니다)'
                            : '오늘 발행·측정된 글 중 아직 발송 안 한 글입니다. 발송하면 발송 리스트로 빠집니다.'}
                </p>

                {/* 누적 발송 리스트 — 날짜 필터 */}
                {publishHistory && (
                    <div className="mb-3 flex items-center gap-2">
                        <span className="text-xs font-semibold text-[#64748b]">날짜</span>
                        <select
                            className="rounded-md border border-[#cbd5e1] px-2 py-1 text-sm"
                            onChange={(e) => setHistDate(e.target.value)}
                            value={histDate}
                        >
                            <option value="">전체 ({historyAll.length})</option>
                            {histDates.map((d) => (
                                <option key={d} value={d}>
                                    {d} ({historyAll.filter((r) => (r.post.report_sent_at || '').slice(0, 10) === d).length})
                                </option>
                            ))}
                        </select>
                    </div>
                )}

                {publishHistory ? (
                    <div className="overflow-y-auto rounded-md border border-[#e2e8f0]">
                        <table className="w-full border-collapse text-left text-sm">
                            <thead className="sticky top-0">
                                <tr className="border-b-2 border-[#e2e8f0] bg-[#f1f5f9] text-[11px] text-[#64748b]">
                                    <th className="px-3 py-2 font-semibold">업체명</th>
                                    <th className="px-3 py-2 font-semibold">블로그(글 링크)</th>
                                    <th className="px-3 py-2 text-center font-semibold">발행일</th>
                                    <th className="px-3 py-2 text-center font-semibold">발송 시각</th>
                                </tr>
                            </thead>
                            <tbody>
                                {historyRows.length ? (
                                    historyRows.map(({ post, account }) => {
                                        const link = post.post_url || account?.blog_url || '';
                                        return (
                                            <tr key={post.id} className="border-b border-[#e2e8f0] hover:bg-[#f8fafc]">
                                                <td className="px-3 py-2 text-[13px] font-semibold text-[#0f172a]">
                                                    {account?.name || '—'}
                                                </td>
                                                <td className="px-3 py-2">
                                                    {link ? (
                                                        <a
                                                            className="block max-w-[360px] truncate text-[13px] font-medium text-[#1d4ed8] hover:underline"
                                                            href={link}
                                                            rel="noopener noreferrer"
                                                            target="_blank"
                                                            title="블로그 글로 이동"
                                                        >
                                                            {post.title || link}
                                                        </a>
                                                    ) : (
                                                        <span className="text-[13px] text-[#94a3b8]">링크 없음</span>
                                                    )}
                                                </td>
                                                <td className="px-3 py-2 text-center text-[12px] font-semibold text-[#475569]">
                                                    {post.published_date || '—'}
                                                </td>
                                                <td className="px-3 py-2 text-center text-[12px] font-bold text-[#059669]">
                                                    {fmtAt(post.report_sent_at)}
                                                </td>
                                            </tr>
                                        );
                                    })
                                ) : (
                                    <tr>
                                        <td className="px-3 py-10 text-center text-sm text-[#94a3b8]" colSpan={4}>
                                            발송 기록이 없습니다.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                ) : publishSent ? (
                    <div className="overflow-y-auto rounded-md border border-[#e2e8f0]">
                        <table className="w-full border-collapse text-left text-sm">
                            <thead className="sticky top-0">
                                <tr className="border-b-2 border-[#e2e8f0] bg-[#f1f5f9] text-[11px] text-[#64748b]">
                                    <th className="px-3 py-2 font-semibold">업체명</th>
                                    <th className="px-3 py-2 font-semibold">블로그(글 링크)</th>
                                    <th className="px-3 py-2 text-center font-semibold">업로드 시간</th>
                                    <th className="px-3 py-2 text-center font-semibold">발송 시각</th>
                                </tr>
                            </thead>
                            <tbody>
                                {sentList.length ? (
                                    sentList.map(({ post, account }) => {
                                        const link = post.post_url || account?.blog_url || '';
                                        const info = sentInfo(post);
                                        return (
                                            <tr key={post.id} className="border-b border-[#e2e8f0] hover:bg-[#f8fafc]">
                                                <td className="px-3 py-2 text-[13px] font-semibold text-[#0f172a]">
                                                    {account?.name || '—'}
                                                </td>
                                                <td className="px-3 py-2">
                                                    {link ? (
                                                        <a
                                                            className="block max-w-[360px] truncate text-[13px] font-medium text-[#1d4ed8] hover:underline"
                                                            href={link}
                                                            rel="noopener noreferrer"
                                                            target="_blank"
                                                            title="블로그 글로 이동"
                                                        >
                                                            {post.title || link}
                                                        </a>
                                                    ) : (
                                                        <span className="text-[13px] text-[#94a3b8]">링크 없음</span>
                                                    )}
                                                </td>
                                                <td className="px-3 py-2 text-center text-[12px] font-semibold text-[#475569]">
                                                    {fmtAt(post.published_at)}
                                                </td>
                                                <td className="px-3 py-2 text-center text-[12px] font-bold text-[#059669]">
                                                    {info?.at ? fmtAt(info.at) : '보냄'}
                                                </td>
                                            </tr>
                                        );
                                    })
                                ) : (
                                    <tr>
                                        <td className="px-3 py-10 text-center text-sm text-[#94a3b8]" colSpan={4}>
                                            아직 발송한 글이 없습니다. 발송하면 여기에 기록됩니다.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                ) : rankSent ? (
                    <div className="overflow-y-auto rounded-md border border-[#e2e8f0]">
                        <table className="w-full border-collapse text-left text-sm">
                            <thead className="sticky top-0">
                                <tr className="border-b-2 border-[#e2e8f0] bg-[#f1f5f9] text-[11px] text-[#64748b]">
                                    <th className="px-3 py-2 font-semibold">업체명</th>
                                    <th className="px-3 py-2 font-semibold">블로그(글 링크)</th>
                                    <th className="px-3 py-2 text-center font-bold text-[#059669]">통합탭</th>
                                    <th className="px-3 py-2 text-center font-bold text-[#1e40af]">블로그탭</th>
                                    <th className="px-3 py-2 text-center font-semibold">발송 시각</th>
                                </tr>
                            </thead>
                            <tbody>
                                {rankSentList.length ? (
                                    rankSentList.map(({ post, account, m }) => {
                                        const link = post.post_url || account?.blog_url || '';
                                        const info = rankSentInfo(post);
                                        const kw = post.keyword_manual || post.keyword || '';
                                        return (
                                            <tr key={post.id} className="border-b border-[#e2e8f0] hover:bg-[#f8fafc]">
                                                <td className="px-3 py-2 text-[13px] font-semibold text-[#0f172a]">{account?.name || '—'}</td>
                                                <td className="px-3 py-2">
                                                    {link ? (
                                                        <a className="block max-w-[240px] truncate text-[13px] font-medium text-[#1d4ed8] hover:underline" href={link} rel="noopener noreferrer" target="_blank" title="블로그 글로 이동">
                                                            {post.title || link}
                                                        </a>
                                                    ) : (
                                                        <span className="text-[13px] text-[#94a3b8]">링크 없음</span>
                                                    )}
                                                </td>
                                                <td className="px-3 py-2 text-center">
                                                    <Rank v={m.ti} status={m.ti_status} tab="ti" keyword={kw} />
                                                </td>
                                                <td className="px-3 py-2 text-center">
                                                    <Rank v={m.bl} status={m.bl_status} tab="bl" keyword={kw} />
                                                </td>
                                                <td className="px-3 py-2 text-center text-[12px] font-bold text-[#059669]">
                                                    {info?.at ? fmtAt(info.at) : '보냄'}
                                                </td>
                                            </tr>
                                        );
                                    })
                                ) : (
                                    <tr>
                                        <td className="px-3 py-10 text-center text-sm text-[#94a3b8]" colSpan={5}>
                                            아직 발송한 순위 보고가 없습니다.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                ) : (
                <div className="overflow-y-auto rounded-md border border-[#e2e8f0]">
                    <table className="w-full border-collapse text-left text-sm">
                        <thead className="sticky top-0">
                            <tr className="border-b-2 border-[#e2e8f0] bg-[#f1f5f9] text-[11px] text-[#64748b]">
                                <th className="px-3 py-2 font-semibold">업체명</th>
                                <th className="px-3 py-2 font-semibold">블로그(글 링크)</th>
                                {mode === 'rank' ? (
                                    <>
                                        <th className="px-3 py-2 font-semibold">키워드</th>
                                        <th className="px-3 py-2 text-center font-bold text-[#059669]">통합탭</th>
                                        <th className="px-3 py-2 text-center font-bold text-[#1e40af]">블로그탭</th>
                                        <th className="px-3 py-2 text-center font-semibold">발송</th>
                                    </>
                                ) : (
                                    <th
                                        className="cursor-pointer select-none px-3 py-2 text-center font-semibold hover:text-[#1e40af]"
                                        onClick={() => setSortAt((s) => (s === 'desc' ? 'asc' : 'desc'))}
                                        title="업로드 시간 정렬(오름/내림)"
                                    >
                                        업로드 시간 {sortAt === 'desc' ? '↓' : sortAt === 'asc' ? '↑' : '↕'}
                                    </th>
                                )}
                            </tr>
                        </thead>
                        <tbody>
                            {measuredRows.length ? (
                                measuredRows.map(({ post, account, m }) => {
                                    const link = post.post_url || account?.blog_url || '';
                                    return (
                                        <tr key={post.id} className="border-b border-[#e2e8f0] hover:bg-[#f8fafc]">
                                            <td className="px-3 py-2 text-[13px] font-semibold text-[#0f172a]">
                                                {account?.name || '—'}
                                            </td>
                                            <td className="px-3 py-2">
                                                {link ? (
                                                    <a
                                                        className={`block truncate text-[13px] font-medium text-[#1d4ed8] hover:underline ${
                                                            mode === 'rank' ? 'max-w-[220px]' : 'max-w-[360px]'
                                                        }`}
                                                        href={link}
                                                        rel="noopener noreferrer"
                                                        target="_blank"
                                                        title="블로그 글로 이동"
                                                    >
                                                        {post.title || link}
                                                    </a>
                                                ) : (
                                                    <span className="text-[13px] text-[#94a3b8]">링크 없음</span>
                                                )}
                                            </td>
                                            {mode === 'rank' ? (
                                                <>
                                                    <td className="whitespace-nowrap px-3 py-2">
                                                        {post.keyword_manual || post.keyword ? (
                                                            <span className="inline-block whitespace-nowrap rounded bg-[#ede9fe] px-2 py-1 text-[13px] font-semibold text-[#7c3aed]">
                                                                #{post.keyword_manual || post.keyword}
                                                            </span>
                                                        ) : (
                                                            <span className="text-[12px] text-[#cbd5e1]">—</span>
                                                        )}
                                                    </td>
                                                    <td className="px-3 py-2 text-center">
                                                        <Rank
                                                            v={m.ti}
                                                            status={m.ti_status}
                                                            tab="ti"
                                                            keyword={post.keyword_manual || post.keyword || ''}
                                                        />
                                                    </td>
                                                    <td className="px-3 py-2 text-center">
                                                        <Rank
                                                            v={m.bl}
                                                            status={m.bl_status}
                                                            tab="bl"
                                                            keyword={post.keyword_manual || post.keyword || ''}
                                                        />
                                                    </td>
                                                    <td className="px-3 py-2 text-center">
                                                        <button
                                                            className={`rounded-md px-3 py-1.5 text-[12px] font-bold disabled:cursor-not-allowed ${
                                                                rankReq.has(post.id)
                                                                    ? 'bg-[#e2e8f0] text-[#94a3b8]'
                                                                    : 'bg-[#FEE500] text-[#3c1e1e] hover:brightness-95 disabled:opacity-50'
                                                            }`}
                                                            disabled={!account || busy === post.id || rankReq.has(post.id)}
                                                            onClick={() => void onRankSend(account, post, m)}
                                                            title={
                                                                rankReq.has(post.id)
                                                                    ? '발송 요청됨 — 곧 카톡으로 발송됩니다'
                                                                    : '순위 성과보고를 카톡 비즈 웹으로 발송(요청)'
                                                            }
                                                            type="button"
                                                        >
                                                            {busy === post.id ? '…' : rankReq.has(post.id) ? '요청됨' : '발송'}
                                                        </button>
                                                    </td>
                                                </>
                                            ) : (
                                                <td className="px-3 py-2 text-center text-[12px] font-semibold text-[#475569]">
                                                    {fmtAt(post.published_at)}
                                                </td>
                                            )}
                                        </tr>
                                    );
                                })
                            ) : (
                                <tr>
                                    <td className="px-3 py-10 text-center text-sm text-[#94a3b8]" colSpan={mode === 'rank' ? 6 : 3}>
                                        {mode === 'publish' && rows.length > 0
                                            ? '발송 안 한 글이 없습니다. (모두 발송 완료 → 발송 리스트 탭 확인)'
                                            : `아직 ${dayLabel} 측정된 글이 없습니다. 크롤이 진행되면 표시됩니다.`}
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
                )}

                <div className="mt-4 flex justify-end">
                    <button
                        className="rounded-md bg-[#1e40af] px-5 py-2 text-sm font-bold text-white hover:bg-[#1e3a8a]"
                        onClick={onClose}
                        type="button"
                    >
                        닫기
                    </button>
                </div>
            </div>
        </div>
    );
}
