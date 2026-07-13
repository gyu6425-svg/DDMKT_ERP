import { useEffect, useMemo, useState } from 'react';
import { excludeBlogPost, todayKST } from '../../../api/blogRank';
import { dayN, lastM, PER_FEED } from '../lib/helpers';
import { Pager } from '../lib/ui';
import { useBlogRank } from '../lib/BlogRankContext';
import { PostSearchCell } from '../components/PostSearchCell';
import { RankCell } from '../components/RankCell';

export function TrackerTab() {
    const {
        accounts,
        posts,
        reload: onReload,
        trackerInOnly: initialInOnly,
        trackerCo: initialCo,
        setTrackerCo,
        customerMode,
        reporterMode,
    } = useBlogRank();
    const external = customerMode || reporterMode; // 외부(고객·기자단) = 읽기전용 → 삭제 버튼 숨김(내부만)
    const [deleting, setDeleting] = useState<string | null>(null);
    // 순위 트래커에서 글 삭제(소프트) — 우리 기자단이 안 쓴 글 등. 트래커 숨김 + 크롤러 측정·재등록 제외.
    const removePost = async (id: string, title: string) => {
        if (deleting) return;
        if (!window.confirm(`이 글을 순위 추적에서 삭제할까요?\n\n"${title || '제목 없음'}"\n\n삭제하면 다음 크롤에서도 측정·재등록되지 않습니다.`)) return;
        setDeleting(id);
        const { error } = await excludeBlogPost(id);
        setDeleting(null);
        if (error) {
            window.alert('삭제 실패: ' + error.message);
            return;
        }
        await onReload();
    };
    const [co, setCo] = useState(initialCo);
    // 트래커 드롭다운 선택을 컨텍스트에 반영 → 관리 시트 탭으로 넘어갈 때 그 업체가 유지되게.
    useEffect(() => {
        setTrackerCo(co);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [co]);
    const [nameQ, setNameQ] = useState('');
    const [month, setMonth] = useState('');
    const [inOnly, setInOnly] = useState(initialInOnly);
    const [pubFilter, setPubFilter] = useState<'all' | 'today' | 'yesterday'>('all'); // 당일/전날 발행 필터
    const [page, setPage] = useState(1);
    // 우측 '키워드 검색' 결과 슬롯 — post.id → 최근 검색 최대 3개(세션 유지). 자동키워드 순위와 별개로 쌓임.
    type Slot = { kw: string; ti: number; ti_status: string; bl: number; bl_status: string };
    const [extraByPost, setExtraByPost] = useState<Record<string, Slot[]>>({});
    const addExtra = (postId: string, kw: string, r: Omit<Slot, 'kw'>) => {
        setExtraByPost((prev) => {
            const cur = prev[postId] || [];
            const rest = cur.filter((e) => e.kw !== kw); // 같은 키워드는 최신값으로 교체
            return { ...prev, [postId]: [...rest, { kw, ...r }].slice(-3) }; // 최근 3개만
        });
    };
    const rankLabel = (v: number, status: string) =>
        status === 'ok' ? `${v}위` : status === 'fail' ? '실패' : '권외';
    // 오늘/어제(KST) — 발행일 필터용.
    const today = todayKST();
    const yesterday = (() => {
        const [y, m, d] = today.split('-').map(Number);
        return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
    })();
    // 대시보드 '통합탭 10위 이내' 카드로 진입하면(initialInOnly=true) 마운트 타이밍과 무관하게 필터를 켠다.
    useEffect(() => {
        if (initialInOnly) setInOnly(true);
    }, [initialInOnly]);
    // 시트 업체명 클릭으로 진입하면(initialCo=그 업체) 그 업체만 보이게.
    useEffect(() => {
        if (initialCo) setCo(initialCo);
    }, [initialCo]);

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
                !p.excluded && // 삭제(제외)된 글은 트래커에서 숨김
                (co === '' || p.blog_account_id === co) &&
                (q === '' || nameOf(p.blog_account_id).toLowerCase().includes(q)) &&
                (month === '' || (p.published_date || '').slice(0, 7) === month) &&
                (pubFilter === 'all' ||
                    (p.published_date || '').slice(0, 10) === (pubFilter === 'today' ? today : yesterday)) &&
                (!inOnly || (p.measurements.length && (lastM(p)?.ti ?? 99) <= 10)),
        );
        // 경과일 순 + id tiebreaker — 재검색/수정으로 재조회돼도 순서 고정(측정값과 무관한 결정적 정렬).
        return [...list].sort((a, b) => dayN(a) - dayN(b) || String(a.id).localeCompare(String(b.id)));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [posts, co, nameQ, month, inOnly, pubFilter, accounts]);

    // 당일/전날 발행 글 수(필터 버튼 옆 표시) — 현재 co·이름 검색 범위 기준.
    const pubCounts = useMemo(() => {
        const q = nameQ.trim().toLowerCase();
        let t = 0;
        let y = 0;
        for (const p of posts) {
            if (co !== '' && p.blog_account_id !== co) continue;
            if (q !== '' && !nameOf(p.blog_account_id).toLowerCase().includes(q)) continue;
            const d = (p.published_date || '').slice(0, 10);
            if (d === today) t += 1;
            else if (d === yesterday) y += 1;
        }
        return { today: t, yesterday: y };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [posts, co, nameQ, today, yesterday, accounts]);

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
                <button
                    className={`rounded-full border-2 px-4 py-1.5 text-sm font-bold transition ${
                        pubFilter === 'today'
                            ? 'border-[#ea580c] bg-[#f97316] text-white shadow-sm'
                            : 'border-[#fdba74] bg-white text-[#ea580c] hover:bg-[#fff7ed]'
                    }`}
                    onClick={() => {
                        setPubFilter((v) => (v === 'today' ? 'all' : 'today'));
                        setPage(1);
                    }}
                    type="button"
                >
                    당일 올라온 글 ({pubCounts.today})
                </button>
                <button
                    className={`rounded-full border-2 px-4 py-1.5 text-sm font-bold transition ${
                        pubFilter === 'yesterday'
                            ? 'border-[#c2410c] bg-[#ea580c] text-white shadow-sm'
                            : 'border-[#fdba74] bg-white text-[#c2410c] hover:bg-[#fff7ed]'
                    }`}
                    onClick={() => {
                        setPubFilter((v) => (v === 'yesterday' ? 'all' : 'yesterday'));
                        setPage(1);
                    }}
                    type="button"
                >
                    전날 올라온 글 ({pubCounts.yesterday})
                </button>
                <label className="flex items-center gap-1 text-xs text-[#334155]">
                    <input checked={inOnly} onChange={(e) => setInOnly(e.target.checked)} type="checkbox" />
                    통합 10위 이내만
                </label>
                <span className="ml-auto text-xs text-[#64748b]">{filtered.length}건</span>
            </div>

            <div className="overflow-x-auto rounded-md border border-[#e2e8f0] bg-white">
                <table className="w-full border-collapse text-left text-sm">
                    <thead>
                        <tr className="border-b-2 border-[#e2e8f0] bg-[#f1f5f9] text-[11px] text-[#64748b]">
                            <th className="px-3 py-2 font-semibold">발행</th>
                            <th className="px-3 py-2 font-semibold">블로그</th>
                            {/* 키워드 검색란을 왼쪽으로 이동(공간 확보) */}
                            <th className="px-3 py-2 font-semibold">키워드 검색</th>
                            <th className="px-3 py-2 font-semibold">제목 · 자동 키워드</th>
                            <th className="px-3 py-2 text-center font-bold text-[#059669]">통합탭</th>
                            <th className="px-3 py-2 text-center font-bold text-[#1e40af]">블로그탭</th>
                            {/* 웹사이트탭·경과·측정 자리 → 직접 검색한 키워드 3개 결과 슬롯 */}
                            <th className="px-2 py-2 text-center font-semibold">검색 ①</th>
                            <th className="px-2 py-2 text-center font-semibold">검색 ②</th>
                            <th className="px-2 py-2 text-center font-semibold">검색 ③</th>
                            {!external ? <th className="px-2 py-2 text-center font-semibold">삭제</th> : null}
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
                                    <td className="px-3 py-2 text-[13px] font-semibold text-[#475569]">
                                        {nameOf(p.blog_account_id)}
                                    </td>
                                    <td className="px-3 py-2">
                                        <PostSearchCell
                                            account={acc}
                                            hideEdit={customerMode}
                                            post={p}
                                            onSaved={onReload}
                                            onExtraResult={(kw, r) => addExtra(p.id, kw, r)}
                                        />
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
                                                        <span className="mt-1 inline-block rounded bg-[#ede9fe] px-1.5 py-0.5 text-[12px] font-semibold text-[#7c3aed]">
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
                                    <td className="px-3 py-2 text-center">
                                        <RankCell post={p} keyName="ti" />
                                    </td>
                                    <td className="px-3 py-2 text-center">
                                        <RankCell post={p} keyName="bl" />
                                    </td>
                                    {/* 직접 검색한 키워드 결과 슬롯 3개 — #키워드 아래 통합/블로그 순위 작게 */}
                                    {[0, 1, 2].map((i) => {
                                        const slot = (extraByPost[p.id] || [])[i];
                                        return (
                                            <td className="px-2 py-2 text-center align-top" key={i}>
                                                {slot ? (
                                                    <div className="min-w-[84px]">
                                                        <div
                                                            className="truncate text-[11px] font-semibold text-[#7c3aed]"
                                                            title={slot.kw}
                                                        >
                                                            #{slot.kw}
                                                        </div>
                                                        <div className="mt-0.5 text-[11px] leading-tight">
                                                            <span className="font-bold text-[#059669]">
                                                                통합 {rankLabel(slot.ti, slot.ti_status)}
                                                            </span>
                                                            <span className="mx-1 text-[#cbd5e1]">·</span>
                                                            <span className="font-bold text-[#1e40af]">
                                                                블로그 {rankLabel(slot.bl, slot.bl_status)}
                                                            </span>
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <span className="text-[11px] text-[#cbd5e1]">—</span>
                                                )}
                                            </td>
                                        );
                                    })}
                                    {!external ? (
                                        <td className="px-2 py-2 text-center">
                                            <button
                                                className="rounded-md border border-[#fca5a5] px-2 py-1 text-[11px] font-semibold text-[#dc2626] hover:bg-[#fef2f2] disabled:opacity-50"
                                                disabled={deleting === p.id}
                                                onClick={() => void removePost(p.id, p.title || '')}
                                                title="이 글을 순위 추적에서 삭제(재크롤 안 함)"
                                                type="button"
                                            >
                                                {deleting === p.id ? '삭제 중…' : '삭제'}
                                            </button>
                                        </td>
                                    ) : null}
                                </tr>
                                );
                            })
                        ) : (
                            <tr>
                                <td className="px-3 py-12 text-center text-sm text-[#64748b]" colSpan={external ? 9 : 10}>
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
