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

// 카페 vanity → 업체(카페) 표시명. 새 카페 추가 시 여기 매핑(크롤러 CLUB_TO_VANITY 와 짝).
const CAFE_LABEL: Record<string, string> = { ddmkt2: '마이클의 정보 세상' };
const cafeLabel = (vanity?: string | null) => (vanity && CAFE_LABEL[vanity]) || vanity || '';

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
    const [search, setSearch] = useState('');
    const [showAdd, setShowAdd] = useState(false);

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

    // 관리 시트에서 업체 클릭(?q=업체명) 시 그 업체만 필터. 업체명/카페명(vanity) 둘 다 매칭.
    const q = new URLSearchParams(window.location.search).get('q') || '';
    const rows = useMemo(() => {
        let r = [...posts];
        if (q) {
            const qq = q.trim();
            r = r.filter((p) => cafeLabel(p.cafe_name).includes(qq) || (p.cafe_name || '').includes(qq));
        }
        if (search.trim()) {
            const s = search.trim();
            r = r.filter((p) =>
                cafeLabel(p.cafe_name).includes(s) ||
                (p.title || '').includes(s) ||
                (p.keyword_manual || p.keyword || '').includes(s),
            );
        }
        return r.sort((a, b) => (b.published_date || '').localeCompare(a.published_date || ''));
    }, [posts, q, search]);

    return (
        <div className="grid gap-3">
            {/* 상단 안내 + 액션 바 (블로그 관리시트 스타일) */}
            <div className="flex flex-wrap items-center gap-2">
                <input
                    className="h-9 min-w-[180px] flex-1 rounded-md border border-[#cbd5e1] bg-white px-3 text-sm"
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="업체·제목·키워드 검색..."
                    value={search}
                />
                <span className="ml-auto text-xs text-[#64748b]">{rows.length}개</span>
                <button
                    className="inline-flex h-9 items-center rounded-md border border-[#cbd5e1] bg-white px-3 text-xs font-semibold text-[#475569] hover:bg-[#f1f5f9]"
                    onClick={() => void reload()}
                    type="button"
                >
                    새로고침
                </button>
                <button
                    className="inline-flex h-9 items-center rounded-md bg-[#1e40af] px-3 text-xs font-semibold text-white hover:bg-[#1e3a8a]"
                    onClick={() => setShowAdd((v) => !v)}
                    type="button"
                >
                    시트 붙여넣기 등록
                </button>
            </div>

            <p className="m-0 text-xs text-[#94a3b8]">
                자사 카페(<b className="text-[#64748b]">마이클의 정보 세상 · ddmkt2</b>) 글의 <b className="text-[#64748b]">네이버 인기글 테마 섹션</b>(예: 인테리어·DIY 인기글) 내 순위.
                PC의 <code className="rounded bg-[#f1f5f9] px-1">cafe_rank_crawler.py</code> 가 매일 측정. 섹션 없는 키워드는 ‘측정불가’.
            </p>

            {/* 등록 폼 (시트 붙여넣기) — 접기/펼치기 */}
            {showAdd ? (
                <div className="rounded-md border border-[#e2e8f0] bg-[#f8fafc] p-4">
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
            ) : null}

            {err ? <div className="rounded-md bg-[#fef2f2] px-3 py-2 text-[13px] text-[#b91c1c]">{err}</div> : null}

            {/* 순위 표 — 블로그 관리시트 스타일 */}
            <div className="overflow-x-auto rounded-md border border-[#e2e8f0] bg-white">
                <table className="w-full border-collapse text-left text-sm">
                    <thead>
                        <tr className="border-b-2 border-[#e2e8f0] bg-[#f1f5f9] text-[11px] text-[#64748b]">
                            <th className="px-3 py-2 font-semibold">업체(카페)</th>
                            <th className="px-3 py-2 font-semibold">제목</th>
                            <th className="px-3 py-2 text-center font-semibold">글번호</th>
                            <th className="px-3 py-2 font-semibold">키워드</th>
                            <th className="px-3 py-2 text-center font-semibold">인기글 순위</th>
                            <th className="px-3 py-2 text-center font-semibold">최근 측정</th>
                            <th className="px-3 py-2 text-center font-semibold">관리</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr><td className="px-3 py-10 text-center text-sm text-[#94a3b8]" colSpan={7}>불러오는 중…</td></tr>
                        ) : !rows.length ? (
                            <tr><td className="px-3 py-12 text-center text-sm text-[#64748b]" colSpan={7}>등록된 카페 글이 없습니다 · '시트 붙여넣기 등록'으로 추가하세요</td></tr>
                        ) : (
                            rows.map((p) => {
                                const last = p.measurements?.[p.measurements.length - 1];
                                return (
                                    <tr className="border-b border-[#e2e8f0] hover:bg-[#f8fafc]" key={p.id}>
                                        <td className="px-3 py-3">
                                            <a
                                                className="font-semibold text-[#0f172a] hover:text-[#1e40af] hover:underline"
                                                href={`https://cafe.naver.com/${p.cafe_name || ''}`}
                                                rel="noreferrer"
                                                target="_blank"
                                                title="카페로 이동"
                                            >
                                                {cafeLabel(p.cafe_name) || p.club_id}
                                            </a>
                                        </td>
                                        <td className="max-w-[280px] truncate px-3 py-3">
                                            {p.post_url ? (
                                                <a className="font-semibold text-[#0f172a] hover:text-[#1e40af] hover:underline" href={p.post_url} rel="noreferrer" target="_blank">{p.title || '(제목없음)'}</a>
                                            ) : <span className="font-semibold text-[#0f172a]">{p.title || '(제목없음)'}</span>}
                                        </td>
                                        <td className="px-3 py-3 text-center text-xs text-[#94a3b8]">{p.article_id}</td>
                                        <td className="px-3 py-3">
                                            <input
                                                className="h-7 w-32 rounded border border-[#e2e8f0] px-1.5 text-[12px]"
                                                defaultValue={p.keyword_manual || p.keyword || ''}
                                                onBlur={(e) => void saveKeyword(p.id, e.target.value)}
                                                onChange={(e) => void onKeyword(p.id, e.target.value)}
                                                placeholder="측정 키워드"
                                            />
                                        </td>
                                        <td className="px-3 py-3 text-center"><RankCell ms={p.measurements} /></td>
                                        <td className="px-3 py-3 text-center text-[11px] text-[#94a3b8]">{last?.date?.slice(5) || '—'}</td>
                                        <td className="px-3 py-3 text-center">
                                            <button
                                                className="rounded border border-[#fca5a5] bg-white px-2 py-1 text-[11px] font-semibold text-[#dc2626] hover:bg-[#fef2f2]"
                                                onClick={() => void remove(p.id)}
                                                title="삭제(측정 제외)"
                                                type="button"
                                            >삭제</button>
                                        </td>
                                    </tr>
                                );
                            })
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
