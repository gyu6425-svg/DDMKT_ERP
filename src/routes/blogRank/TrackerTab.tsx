import { useMemo, useState } from 'react';
import type { BlogAccount, BlogPost } from '../../api/blogRank';
import { dayN, lastM, PER_FEED } from './helpers';
import { Pager } from './ui';
import { PostSearchCell } from './PostSearchCell';
import { RankCell } from './RankCell';
import { openTrackerReport } from './report';
import { WebRankCell } from './WebRankCell';

export function TrackerTab({
    accounts,
    posts,
    onReload,
}: {
    accounts: BlogAccount[];
    posts: BlogPost[];
    onReload: () => Promise<void>;
}) {
    const [co, setCo] = useState('');
    const [nameQ, setNameQ] = useState('');
    const [month, setMonth] = useState('');
    const [inOnly, setInOnly] = useState(false);
    const [page, setPage] = useState(1);

    const nameOf = (id: string) => accounts.find((a) => a.id === id)?.name || '블로그';

    // 발행 월 목록(YYYY-MM) — 현재 co 필터에 맞춰, 최신월 먼저.
    const months = useMemo(() => {
        const set = new Set<string>();
        for (const p of posts) {
            if (co && p.blog_account_id !== co) continue;
            const m = (p.published_date || '').slice(0, 7);
            if (m) set.add(m);
        }
        return [...set].sort((a, b) => (a < b ? 1 : -1));
    }, [posts, co]);

    const filtered = useMemo(() => {
        const q = nameQ.trim().toLowerCase();
        const list = posts.filter(
            (p) =>
                (co === '' || p.blog_account_id === co) &&
                (q === '' || nameOf(p.blog_account_id).toLowerCase().includes(q)) &&
                (month === '' || (p.published_date || '').slice(0, 7) === month) &&
                (!inOnly || (p.measurements.length && (lastM(p)?.ti ?? 99) <= 10)),
        );
        return [...list].sort((a, b) => dayN(a) - dayN(b));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [posts, co, nameQ, month, inOnly, accounts]);

    const pages = Math.max(1, Math.ceil(filtered.length / PER_FEED));
    const current = Math.min(page, pages);
    const pageRows = filtered.slice((current - 1) * PER_FEED, current * PER_FEED);

    return (
        <div className="grid gap-3">
            <input
                aria-label="블로그 이름 검색"
                className="h-11 w-full rounded-md border border-[#cbd5e1] bg-white px-3 text-sm"
                onChange={(e) => {
                    setNameQ(e.target.value);
                    setPage(1);
                }}
                placeholder="블로그 이름 검색 (예: 더현대) — 일부만 입력해도 됩니다"
                value={nameQ}
            />

            <div className="flex flex-wrap items-center gap-2">
                <select
                    className="h-9 rounded-md border border-[#cbd5e1] bg-white px-2 text-xs"
                    onChange={(e) => {
                        setCo(e.target.value);
                        setPage(1);
                    }}
                    value={co}
                >
                    <option value="">블로그 전체</option>
                    {accounts.map((a) => (
                        <option key={a.id} value={a.id}>
                            {a.name}
                        </option>
                    ))}
                </select>
                <select
                    className="h-9 rounded-md border border-[#cbd5e1] bg-white px-2 text-xs"
                    onChange={(e) => {
                        setMonth(e.target.value);
                        setPage(1);
                    }}
                    value={month}
                >
                    <option value="">발행 월 전체</option>
                    {months.map((m) => {
                        const [y, mo] = m.split('-');
                        return (
                            <option key={m} value={m}>
                                {y}년 {Number(mo)}월
                            </option>
                        );
                    })}
                </select>
                <label className="flex items-center gap-1 text-xs text-[#334155]">
                    <input checked={inOnly} onChange={(e) => setInOnly(e.target.checked)} type="checkbox" />
                    통합 10위 이내만
                </label>
                <span className="ml-auto text-xs text-[#64748b]">{filtered.length}건</span>
                <button
                    className="rounded-md bg-[#1e40af] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#1e3a8a]"
                    onClick={() => {
                        if (!openTrackerReport(filtered, accounts)) {
                            window.alert('팝업이 차단되었습니다. 팝업 허용 후 다시 시도하세요.');
                        }
                    }}
                    title="현재 목록(필터 적용) 기준 성과 보고서(인쇄/PDF)"
                    type="button"
                >
                    성과
                </button>
            </div>

            <div className="overflow-x-auto rounded-md border border-[#e2e8f0] bg-white">
                <table className="w-full border-collapse text-left text-sm">
                    <thead>
                        <tr className="border-b-2 border-[#e2e8f0] bg-[#f1f5f9] text-[11px] text-[#64748b]">
                            <th className="px-3 py-2 font-semibold">발행</th>
                            <th className="px-3 py-2 font-semibold">블로그</th>
                            <th className="px-3 py-2 font-semibold">제목 · 자동 키워드</th>
                            <th className="px-3 py-2 font-semibold">키워드 검색</th>
                            <th className="px-3 py-2 text-center font-semibold">통합탭</th>
                            <th className="px-3 py-2 text-center font-semibold">블로그탭</th>
                            <th className="px-3 py-2 text-center font-semibold">웹사이트</th>
                            <th className="px-3 py-2 text-center font-semibold">경과</th>
                            <th className="px-3 py-2 text-center font-semibold">측정</th>
                        </tr>
                    </thead>
                    <tbody>
                        {pageRows.length ? (
                            pageRows.map((p) => {
                                const acc = accounts.find((a) => a.id === p.blog_account_id) ?? null;
                                return (
                                <tr key={p.id} className="border-b border-[#e2e8f0]">
                                    <td className="px-3 py-2 text-xs font-semibold text-[#475569]">
                                        {p.published_date
                                            ? new Date(p.published_date).toLocaleDateString('ko-KR', {
                                                  day: '2-digit',
                                                  month: '2-digit',
                                              })
                                            : '—'}
                                    </td>
                                    <td className="px-3 py-2 text-xs font-semibold text-[#475569]">
                                        {nameOf(p.blog_account_id)}
                                    </td>
                                    <td className="px-3 py-2">
                                        {(() => {
                                            const postLink = p.post_url || acc?.blog_url || '';
                                            const inner = (
                                                <>
                                                    <div className="max-w-[360px] truncate text-[13px] font-medium text-[#0f172a] group-hover:text-[#7c3aed] group-hover:underline">
                                                        {p.title || '제목 없음'}
                                                    </div>
                                                    {p.keyword_manual || p.keyword ? (
                                                        <span className="mt-1 inline-block rounded bg-[#ede9fe] px-1.5 py-0.5 text-[10px] font-semibold text-[#7c3aed]">
                                                            #{p.keyword_manual || p.keyword}
                                                            {p.keyword_manual ? ' (수정됨)' : ''}
                                                        </span>
                                                    ) : null}
                                                </>
                                            );
                                            return postLink ? (
                                                <a
                                                    className="group block cursor-pointer"
                                                    href={postLink}
                                                    rel="noopener noreferrer"
                                                    target="_blank"
                                                    title="실제 블로그 글로 이동"
                                                >
                                                    {inner}
                                                </a>
                                            ) : (
                                                <div>{inner}</div>
                                            );
                                        })()}
                                    </td>
                                    <td className="px-3 py-2">
                                        <PostSearchCell account={acc} post={p} onSaved={onReload} />
                                    </td>
                                    <td className="px-3 py-2 text-center">
                                        <RankCell post={p} keyName="ti" />
                                    </td>
                                    <td className="px-3 py-2 text-center">
                                        <RankCell post={p} keyName="bl" />
                                    </td>
                                    <td className="px-3 py-2 text-center">
                                        {acc ? (
                                            <WebRankCell account={acc} />
                                        ) : (
                                            <span className="text-xs text-[#94a3b8]">—</span>
                                        )}
                                    </td>
                                    <td className="px-3 py-2 text-center">
                                        <span className="rounded bg-[#f1f5f9] px-2 py-0.5 text-[11px] font-semibold text-[#475569]">
                                            D+{dayN(p)}
                                        </span>
                                    </td>
                                    <td className="px-3 py-2 text-center text-xs text-[#94a3b8]">
                                        {p.measurements.length}회
                                    </td>
                                </tr>
                                );
                            })
                        ) : (
                            <tr>
                                <td className="px-3 py-12 text-center text-sm text-[#64748b]" colSpan={9}>
                                    아직 수집된 글이 없습니다 · 파이썬 크롤러 실행 후 표시됩니다
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
                <Pager pages={pages} current={current} onGo={setPage} />
            </div>
        </div>
    );
}


// 인라인 즉시검색 — 키워드 입력 → 서버리스가 네이버 측정 → 그 블로그의 통합/블로그탭 순위 즉시 표시.
// 자동키워드 순위(기본, RankCell)와 별개. 'blog_id 매칭'이라 '글'이 아니라 '블로그 노출 순위'.
