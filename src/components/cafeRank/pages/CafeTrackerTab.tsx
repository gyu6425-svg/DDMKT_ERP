import { useEffect, useMemo, useState } from 'react';
import {
    excludeCafeRankPost,
    getCafeRankPosts,
    parseCafeUrl,
    setCafeKeywordManual,
    upsertCafeRankPost,
    type CafeMeasurement,
    type CafeRankPost,
} from '../../../api/cafeRank';

// 카페 · 순위 트래커 — 자사 카페 글의 네이버 '인기글 테마 섹션' 내 순위. 측정은 PC 크롤러(cafe_rank_crawler.py)가 기록.

// 순위 셀 — 인기글 테마 섹션 내 순위. 측정없음=측정대기, fail=실패, no_section=측정불가(섹션없음), out=권외.
//   인기글 섹션은 보통 5~10개 → ≤3 초록(상위), ≤7 파랑, 그외 회색.
function RankCell({ ms }: { ms: CafeMeasurement[] }) {
    if (!ms || !ms.length) return <span className="text-[12px] font-semibold text-[#d97706]">측정 대기</span>;
    const cur = ms[ms.length - 1];
    const prev = ms.length > 1 ? ms[ms.length - 2] : null;
    if (cur.ti_status === 'fail') return <span className="text-[13px] font-bold text-[#dc2626]">실패</span>;
    if (cur.ti_status === 'no_section')
        return <span className="text-[12px] font-semibold text-[#94a3b8]" title="이 키워드엔 인기글 섹션이 없어 측정 대상이 아닙니다">측정불가</span>;
    if (cur.ti_status === 'out') return <span className="text-[13px] font-semibold text-[#64748b]">권외</span>;
    const color = cur.ti <= 3 ? '#059669' : cur.ti <= 7 ? '#2563eb' : '#64748b';
    let delta = null as null | { s: string; c: string };
    if (prev && prev.ti_status === 'ok') {
        const d = prev.ti - cur.ti;
        if (d > 0) delta = { s: `▲${d}`, c: '#dc2626' };
        else if (d < 0) delta = { s: `▼${-d}`, c: '#2563eb' };
        else delta = { s: '—', c: '#94a3b8' };
    }
    return (
        <span className="inline-flex items-center gap-1">
            <b style={{ color }} className="text-[14px]">{cur.ti}위</b>
            {delta ? <span className="text-[11px] font-bold" style={{ color: delta.c }}>{delta.s}</span> : null}
        </span>
    );
}

export function CafeTrackerTab() {
    const [posts, setPosts] = useState<CafeRankPost[]>([]);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState('');
    const [paste, setPaste] = useState('');
    const [defaultCafe, setDefaultCafe] = useState('ddmkt2');
    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState('');

    const reload = async () => {
        setLoading(true);
        const { data, error } = await getCafeRankPosts();
        if (error) setErr(error.message || 'cafe_rank_posts 조회 실패 — docs/cafe-rank-tables.sql 실행 필요');
        else { setErr(''); setPosts(data); }
        setLoading(false);
    };
    useEffect(() => { void reload(); }, []);

    // 시트 붙여넣기: 줄마다  URL [탭/콤마] 키워드 [탭] 제목(선택)
    const register = async () => {
        if (busy) return;
        const lines = paste.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        if (!lines.length) { setMsg('붙여넣을 내용이 없습니다.'); return; }
        setBusy(true); setMsg('등록 중…');
        let ok = 0; let skip = 0;
        for (const line of lines) {
            const cols = line.split(/\t|,/).map((c) => c.trim());
            const url = cols[0] || '';
            const keyword = cols[1] || '';
            const title = cols[2] || null;
            const p = parseCafeUrl(url);
            if (!p.articleId) { skip += 1; continue; }
            const { error } = await upsertCafeRankPost({
                club_id: p.clubId,
                cafe_name: p.cafeName || defaultCafe || null,
                article_id: p.articleId,
                post_url: url,
                title,
                keyword: keyword || null,
                published_date: null,
            });
            if (error) { skip += 1; } else { ok += 1; }
        }
        setBusy(false);
        setMsg(`등록 완료 — 성공 ${ok} / 스킵 ${skip}${skip ? ' (URL 파싱 실패/중복)' : ''}`);
        setPaste('');
        void reload();
    };

    const onKeyword = async (id: string, v: string) => {
        setPosts((prev) => prev.map((p) => (p.id === id ? { ...p, keyword_manual: v } : p)));
    };
    const saveKeyword = async (id: string, v: string) => {
        await setCafeKeywordManual(id, v);
    };
    const remove = async (id: string) => {
        await excludeCafeRankPost(id);
        setPosts((prev) => prev.filter((p) => p.id !== id));
    };

    const rows = useMemo(
        () => [...posts].sort((a, b) => (b.published_date || '').localeCompare(a.published_date || '')),
        [posts],
    );

    return (
        <div className="grid gap-5">
            <p className="m-0 text-sm text-[#64748b]">
                자사 카페(<b>마이클의 정보 세상 · ddmkt2</b>) 글의 <b>네이버 인기글 순위</b>를 추적합니다. 검색 시 뜨는
                <b> 테마 인기글 섹션</b>(예: 인테리어·DIY 인기글) 안에서의 위치를 잽니다. 아래에 <b>카페 글 URL + 키워드</b>를
                등록하면 PC의 <code className="rounded bg-[#f1f5f9] px-1">cafe_rank_crawler.py</code> 가 매일 측정해 표에 채웁니다.
                <span className="text-[#94a3b8]"> (모바일 통합검색 기준 · 인기글 섹션 없는 키워드는 ‘측정불가’)</span>
            </p>

            {/* 등록 (시트 붙여넣기) */}
            <div className="rounded-xl border border-[#e2e8f0] bg-white p-4">
                <div className="mb-2 flex flex-wrap items-center gap-3">
                    <div className="text-[13px] font-bold text-[#334155]">카페 글 등록</div>
                    <label className="flex items-center gap-1.5 text-[12px] font-semibold text-[#475569]">
                        기본 카페명(vanity)
                        <input
                            className="h-8 w-28 rounded-md border border-[#cbd5e1] px-2 text-[13px]"
                            onChange={(e) => setDefaultCafe(e.target.value)}
                            value={defaultCafe}
                        />
                    </label>
                    <span className="text-[11px] text-[#94a3b8]">URL에 vanity 없으면(clubid만) 이 값으로 매칭</span>
                </div>
                <textarea
                    className="h-24 w-full rounded-md border border-[#cbd5e1] bg-white px-3 py-2 font-mono text-[12px] leading-5"
                    onChange={(e) => setPaste(e.target.value)}
                    placeholder={'줄마다: 카페글URL [탭 또는 ,] 키워드 [탭] 제목(선택)\nhttps://cafe.naver.com/ddmkt2/13\t과천 누수탐지\t과천 누수탐지 후기\nhttps://cafe.naver.com/ArticleRead.nhn?clubid=31754130&articleid=8, 과천 누수탐지'}
                    value={paste}
                />
                <div className="mt-2 flex items-center gap-2">
                    <button
                        className="h-9 rounded-md bg-[#03c75a] px-5 text-sm font-bold text-white hover:bg-[#02b350] disabled:opacity-50"
                        disabled={busy || !paste.trim()}
                        onClick={() => void register()}
                        type="button"
                    >
                        {busy ? '등록 중…' : '등록'}
                    </button>
                    {msg ? <span className="text-[13px] text-[#6366f1]">{msg}</span> : null}
                </div>
            </div>

            {/* 순위 표 */}
            <div className="rounded-xl border border-[#e2e8f0] bg-white p-4">
                <div className="mb-2 text-[13px] font-bold text-[#334155]">추적 글 ({rows.length})</div>
                {err ? <div className="rounded-md bg-[#fef2f2] px-3 py-2 text-[13px] text-[#b91c1c]">{err}</div> : null}
                {loading ? (
                    <div className="py-8 text-center text-sm text-[#94a3b8]">불러오는 중…</div>
                ) : !rows.length && !err ? (
                    <div className="py-8 text-center text-sm text-[#94a3b8]">등록된 카페 글이 없습니다. 위에서 URL+키워드를 붙여넣어 등록하세요.</div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-[13px]">
                            <thead>
                                <tr className="border-b border-[#e2e8f0] text-left text-[12px] text-[#64748b]">
                                    <th className="py-2 pr-2">제목</th>
                                    <th className="py-2 pr-2">카페/글번호</th>
                                    <th className="py-2 pr-2">키워드</th>
                                    <th className="py-2 pr-2 text-center">인기글 순위</th>
                                    <th className="py-2 pr-2">최근 측정</th>
                                    <th className="py-2"></th>
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map((p) => {
                                    const last = p.measurements?.[p.measurements.length - 1];
                                    return (
                                        <tr className="border-b border-[#f1f5f9]" key={p.id}>
                                            <td className="max-w-[280px] truncate py-2 pr-2 font-semibold text-[#0f172a]">
                                                {p.post_url ? (
                                                    <a className="hover:text-[#4338ca]" href={p.post_url} rel="noreferrer" target="_blank">{p.title || '(제목없음)'}</a>
                                                ) : (p.title || '(제목없음)')}
                                            </td>
                                            <td className="py-2 pr-2 text-[12px] text-[#64748b]">{p.cafe_name || p.club_id}/{p.article_id}</td>
                                            <td className="py-2 pr-2">
                                                <input
                                                    className="h-7 w-32 rounded border border-[#e2e8f0] px-1.5 text-[12px]"
                                                    defaultValue={p.keyword_manual || p.keyword || ''}
                                                    onBlur={(e) => void saveKeyword(p.id, e.target.value)}
                                                    onChange={(e) => void onKeyword(p.id, e.target.value)}
                                                    placeholder="측정 키워드"
                                                />
                                            </td>
                                            <td className="py-2 pr-2 text-center"><RankCell ms={p.measurements} /></td>
                                            <td className="py-2 pr-2 text-[11px] text-[#94a3b8]">{last?.date || '—'}</td>
                                            <td className="py-2">
                                                <button
                                                    className="rounded px-1.5 text-[13px] text-[#cbd5e1] hover:text-[#dc2626]"
                                                    onClick={() => void remove(p.id)}
                                                    title="삭제(측정 제외)"
                                                    type="button"
                                                >✕</button>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}
