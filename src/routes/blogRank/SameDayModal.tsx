import { useState } from 'react';
import type { BlogAccount, BlogMeasurement, BlogPost } from '../../api/blogRank';
import { openTrackerReport, sendPublishReport } from './report';

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
    onClose,
    onToast,
}: {
    rows: SameDayRow[];
    dayLabel: string;
    mode?: 'publish' | 'rank';
    onClose: () => void;
    onToast: (m: string) => void;
}) {
    const [busy, setBusy] = useState<string | null>(null);
    const [sortAt, setSortAt] = useState<'desc' | 'asc' | null>(null); // 업로드 시간 정렬(null=업체명순)
    // 이미 발송한 글은 비활성화(중복 발송 방지). localStorage 에 기억 → 새로고침해도 유지.
    const [sentVer, setSentVer] = useState(0);
    const isSent = (id: string) => {
        try {
            return !!localStorage.getItem(`pubsent:${id}`);
        } catch {
            return false;
        }
    };
    const markSent = (id: string) => {
        try {
            localStorage.setItem(`pubsent:${id}`, '1');
        } catch {
            /* noop */
        }
        setSentVer((v) => v + 1);
    };
    const unmarkSent = (id: string) => {
        try {
            localStorage.removeItem(`pubsent:${id}`);
        } catch {
            /* noop */
        }
        setSentVer((v) => v + 1);
    };
    void sentVer;
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

    // 전날(순위) 모달의 발송 = 그 블로그 1개만 순위 트래커 성과 보고서로 열기(호스팅 → 카톡 발송).
    const onTracker = async (account: BlogAccount | null, post: BlogPost) => {
        if (!account) return;
        setBusy(post.id);
        try {
            await openTrackerReport([post], [account]);
        } finally {
            setBusy(null);
        }
    };
    const onPerf = async (account: BlogAccount | null, post: BlogPost) => {
        if (!account) return;
        setBusy(post.id);
        try {
            const r = await sendPublishReport(account, post);
            markSent(post.id); // 발송 누른 글은 보냄 처리(비활성화)
            onToast(
                r === 'kakao'
                    ? '카카오톡 열림 — 받을 방 선택'
                    : r === 'helper'
                      ? '카톡 자동검색 실행 — 방 클릭 후 Ctrl+V·Enter (미설치면 메시지만 복사됨)'
                      : r === 'copied'
                        ? '메시지 복사됨 — 카톡에 붙여넣기(Ctrl+V)'
                        : '발행 보고 내용 표시됨',
            );
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
                    <span className="rounded-full bg-[#eff6ff] px-3 py-1 text-xs font-bold text-[#1e40af]">총 {rows.length}글</span>
                </div>
                <p className="mt-1 mb-3 text-sm text-[#64748b]">
                    {mode === 'rank'
                        ? `전날(${dayLabel}) 발행되어 측정된 글의 통합탭·블로그탭 순위입니다. (통합탭 노출 좋은 순)`
                        : '오늘 발행되어 오늘 측정된 글입니다. 성과 버튼을 누르면 발행 보고 메시지가 카톡 공유/복사됩니다.'}
                </p>

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
                                    <>
                                        <th
                                            className="cursor-pointer select-none px-3 py-2 text-center font-semibold hover:text-[#1e40af]"
                                            onClick={() => setSortAt((s) => (s === 'desc' ? 'asc' : 'desc'))}
                                            title="업로드 시간 정렬(오름/내림)"
                                        >
                                            업로드 시간 {sortAt === 'desc' ? '↓' : sortAt === 'asc' ? '↑' : '↕'}
                                        </th>
                                        <th className="px-3 py-2 text-center font-semibold">발송</th>
                                    </>
                                )}
                            </tr>
                        </thead>
                        <tbody>
                            {sorted.length ? (
                                sorted.map(({ post, account, m }) => {
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
                                                            className="rounded-md bg-[#FEE500] px-3 py-1.5 text-[12px] font-bold text-[#3c1e1e] hover:brightness-95 disabled:opacity-50"
                                                            disabled={!account || busy === post.id}
                                                            onClick={() => void onTracker(account, post)}
                                                            title="이 블로그 1개 순위 트래커 성과 보고서 만들기"
                                                            type="button"
                                                        >
                                                            {busy === post.id ? '…' : '발송'}
                                                        </button>
                                                    </td>
                                                </>
                                            ) : (
                                                <>
                                                <td className="px-3 py-2 text-center text-[12px] font-semibold text-[#475569]">
                                                    {fmtAt(post.published_at)}
                                                </td>
                                                <td className="px-3 py-2 text-center">
                                                    <button
                                                        className={`rounded-md px-3 py-1.5 text-[12px] font-bold disabled:cursor-not-allowed ${
                                                            isSent(post.id)
                                                                ? 'bg-[#e2e8f0] text-[#94a3b8]'
                                                                : 'bg-[#FEE500] text-[#3c1e1e] hover:brightness-95 disabled:opacity-50'
                                                        }`}
                                                        disabled={!account || !link || busy === post.id}
                                                        onClick={() =>
                                                            isSent(post.id) ? unmarkSent(post.id) : void onPerf(account, post)
                                                        }
                                                        title={isSent(post.id) ? '발송함 — 눌러서 다시 발송 활성화' : '발행 보고 카톡 메시지 만들기'}
                                                        type="button"
                                                    >
                                                        {busy === post.id ? '…' : isSent(post.id) ? '보냄 ↺' : '발송'}
                                                    </button>
                                                </td>
                                                </>
                                            )}
                                        </tr>
                                    );
                                })
                            ) : (
                                <tr>
                                    <td className="px-3 py-10 text-center text-sm text-[#94a3b8]" colSpan={mode === 'rank' ? 6 : 4}>
                                        아직 {dayLabel} 측정된 글이 없습니다. 크롤이 진행되면 표시됩니다.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>

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
