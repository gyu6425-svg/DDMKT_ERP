import { Fragment, useEffect, useMemo, useState } from 'react';
import {
    excludeCafeRankPost,
    getCafeRankPosts,
    parseCafeUrl,
    upsertCafeRankPost,
    type CafeMeasurement,
    type CafeRankPost,
} from '../../../api/cafeRank';
import { CafeSearchCell } from '../components/CafeSearchCell';
import { countCafePendingMeasures, enqueueCafeRankMeasures } from '../../../api/cafeRankSearch';

// 카페 · 순위 트래커 — 자사 카페 글의 네이버 '인기글 테마 섹션' 내 순위. 측정은 PC 크롤러(cafe_rank_crawler.py)가 기록.

// 카페 vanity → 업체(카페) 표시명. 새 카페 추가 시 여기 매핑(크롤러 CLUB_TO_VANITY 와 짝).
const CAFE_LABEL: Record<string, string> = { ddmkt2: '마이클의 정보 세상' };
const cafeLabel = (vanity?: string | null) => (vanity && CAFE_LABEL[vanity]) || vanity || '';

// 게시판(board) — 동일 카페 안에서 게시판별 구분. 표시 순서·색. 새 게시판은 자동으로 뒤에 붙는다.
const BOARD_ORDER = ['누수', '더티클리닉', '설고점', '더맨시스템'];
// 관리시트 '순위 보기'(?company=)로 진입 시, 그 업체의 게시판 탭을 초기 선택.
const COMPANY_BOARD: Record<string, string> = { leak: '누수', dirty: '더티클리닉', seolgo: '설고점', theman: '더맨시스템' };
const BOARD_STYLE: Record<string, { bg: string; fg: string }> = {
    누수: { bg: '#eff6ff', fg: '#1d4ed8' },
    더티클리닉: { bg: '#f0fdfa', fg: '#0d9488' },
    설고점: { bg: '#fff7ed', fg: '#c2410c' },
    더맨시스템: { bg: '#faf5ff', fg: '#7c3aed' },
};
const boardKey = (p: CafeRankPost) => p.board || p.cafe_accounts?.board_short || '미분류';
const companyLabel = (p: CafeRankPost) => p.cafe_accounts?.display_name || boardKey(p);
const boardRank = (b: string) => {
    const i = BOARD_ORDER.indexOf(b);
    return i >= 0 ? i : b === '미분류' ? 999 : 500;
};
const boardStyle = (b: string) => BOARD_STYLE[b] || { bg: '#f1f5f9', fg: '#475569' };

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

export function CafeTrackerTab({ readOnly = false }: { readOnly?: boolean } = {}) {
    const external = readOnly; // 고객/기자단 뷰용(현재 미연결) — true면 삭제·키워드수정 숨김
    const [posts, setPosts] = useState<CafeRankPost[]>([]);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState('');
    const [paste, setPaste] = useState('');
    const [defaultCafe, setDefaultCafe] = useState('ddmkt2');
    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState('');
    const [search, setSearch] = useState('');
    const [showAdd, setShowAdd] = useState(false);
    const [deleting, setDeleting] = useState<string | null>(null);
    const [boardFilter, setBoardFilter] = useState(
        () => COMPANY_BOARD[new URLSearchParams(window.location.search).get('company') || ''] || '전체',
    );

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

    const remove = async (id: string) => {
        if (deleting) return;
        if (!window.confirm('이 글을 순위 추적에서 삭제할까요? (측정 중단 · 다시 등록 가능)')) return;
        setDeleting(id);
        const { error } = await excludeCafeRankPost(id);
        setDeleting(null);
        if (error) { alert('삭제 실패: ' + error.message); return; }
        setPosts((prev) => prev.filter((p) => p.id !== id));
    };

    // 관리 시트에서 업체 클릭(?q=업체명) 시 그 업체만 필터. 업체명/카페명(vanity) 둘 다 매칭.
    const params = new URLSearchParams(window.location.search);
    const q = params.get('q') || '';
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
                companyLabel(p).includes(s) ||
                boardKey(p).includes(s) ||
                (p.title || '').includes(s) ||
                (p.keyword_manual || p.keyword || '').includes(s),
            );
        }
        // 발행 최신순. 발행일이 없는 수동 등록분만 created_at으로 보완하고 id로 순서를 고정한다.
        return r.sort(
            (a, b) =>
                (b.published_date || '').localeCompare(a.published_date || '') ||
                (b.created_at || '').localeCompare(a.created_at || '') ||
                String(a.id).localeCompare(String(b.id)),
        );
    }, [posts, q, search]);

    // 기본 게시판은 0건이어도 탭을 항상 표시하고, 새 게시판은 데이터에 발견되면 뒤에 자동 추가한다.
    const boards = useMemo(() => {
        const cnt = new Map<string, number>();
        for (const p of posts) cnt.set(boardKey(p), (cnt.get(boardKey(p)) || 0) + 1);
        for (const b of BOARD_ORDER) if (!cnt.has(b)) cnt.set(b, 0);
        return [...cnt.entries()].sort((a, b) => boardRank(a[0]) - boardRank(b[0]) || a[0].localeCompare(b[0]));
    }, [posts]);

    // 게시판별 그룹 — 검색/필터 적용 후 게시판 순서대로 묶는다. '다 구분되어서' 보기 위함.
    const groups = useMemo(() => {
        const map = new Map<string, CafeRankPost[]>();
        for (const p of rows) {
            if (boardFilter !== '전체' && boardKey(p) !== boardFilter) continue;
            const b = boardKey(p);
            (map.get(b) || map.set(b, []).get(b)!).push(p);
        }
        return [...map.entries()].sort((a, b) => boardRank(a[0]) - boardRank(b[0]) || a[0].localeCompare(b[0]));
    }, [rows, boardFilter]);

    const shownCount = useMemo(() => groups.reduce((n, g) => n + g[1].length, 0), [groups]);
    const shownPosts = useMemo(() => groups.flatMap((g) => g[1]), [groups]);

    // 전체 재검색 — 지금 보이는 게시판(탭)의 글을 큐에 일괄 등록. 측정은 PC가 순차 처리(진행률만 폴링).
    const [bulk, setBulk] = useState<{ busy: boolean; left: number; msg: string }>({ busy: false, left: 0, msg: '' });
    const bulkResearch = async () => {
        if (bulk.busy) return;
        const targets = shownPosts.filter((p) => (p.keyword_manual || p.keyword || '').trim());
        if (!targets.length) { setBulk({ busy: false, left: 0, msg: '재검색할 글이 없습니다' }); return; }
        const where = boardFilter === '전체' ? '전체' : boardFilter;
        if (!window.confirm(
            `${where} ${targets.length}건을 전체 재검색합니다.\n\n` +
            `· PC가 1건씩 간격을 두고 순차 측정합니다(약 ${Math.ceil((targets.length * 3) / 60)}분)\n` +
            `· 블로그 크롤이 돌면 자동으로 멈췄다 재개합니다\n` +
            `· 이 창을 닫아도 계속 진행됩니다`,
        )) return;
        setBulk({ busy: true, left: targets.length, msg: '큐에 등록 중…' });
        const { error } = await enqueueCafeRankMeasures(
            targets.map((p) => ({
                post_id: p.id,
                keyword: (p.keyword_manual || p.keyword || '').trim(),
                cafe_name: p.cafe_name,
                article_id: p.article_id,
                club_id: p.club_id,
            })),
        );
        if (error) {
            setBulk({ busy: false, left: 0, msg: `등록 실패: ${error.message} (docs/cafe-research-bulk.sql 실행 필요)` });
            return;
        }
        setBulk({ busy: true, left: targets.length, msg: '측정 중…' });
        // 남은 건수를 폴링해 진행률 표시 → 0이 되면 목록 새로고침.
        for (let i = 0; i < 400; i += 1) {
            await new Promise((r) => setTimeout(r, 4000));
            const { count } = await countCafePendingMeasures();
            setBulk({ busy: true, left: count, msg: '측정 중…' });
            if (count === 0) break;
        }
        await reload();
        setBulk({ busy: false, left: 0, msg: '전체 재검색 완료' });
    };

    // 선택한 게시판이 더 이상 존재하지 않으면(모두 삭제/필터됨) '전체'로 되돌려 빈 화면에 갇히지 않게.
    useEffect(() => {
        if (boardFilter !== '전체' && !boards.some(([b]) => b === boardFilter)) setBoardFilter('전체');
    }, [boards, boardFilter]);

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
                <span className="ml-auto text-xs text-[#64748b]">{shownCount}개</span>
                <button
                    className="inline-flex h-9 items-center rounded-md border border-[#cbd5e1] bg-white px-3 text-xs font-semibold text-[#475569] hover:bg-[#f1f5f9]"
                    onClick={() => void reload()}
                    type="button"
                >
                    새로고침
                </button>
                {!external ? (
                    <button
                        className="inline-flex h-9 items-center rounded-md bg-[#0f766e] px-3 text-xs font-bold text-white hover:bg-[#115e59] disabled:opacity-50"
                        disabled={bulk.busy || !shownCount}
                        onClick={() => void bulkResearch()}
                        title="지금 보이는 게시판 글을 전부 재검색(PC가 순차 측정 · 블로그 크롤과 자동 비겹침)"
                        type="button"
                    >
                        {bulk.busy ? `측정 중… 남은 ${bulk.left}` : `전체 재검색 ${shownCount}`}
                    </button>
                ) : null}
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
            {bulk.msg ? (
                <div className="rounded-md bg-[#f0fdfa] px-3 py-2 text-[13px] font-semibold text-[#0f766e]">
                    {bulk.msg}{bulk.busy ? ` · 남은 ${bulk.left}건 (블로그 크롤 중이면 자동 대기)` : ''}
                </div>
            ) : null}

            {/* 게시판 필터 — 동일 카페 안의 게시판(누수 / 설고점 / 더맨시스템 / 더티클리닉…)별로 나눠 보기 */}
            {boards.length > 1 ? (
                <div className="flex flex-wrap items-center gap-1.5">
                    <span className="mr-1 text-[11px] font-semibold text-[#94a3b8]">게시판</span>
                    {[['전체', posts.length] as [string, number], ...boards].map(([b, c]) => {
                        const on = boardFilter === b;
                        const st = b === '전체' ? { bg: '#1e293b', fg: '#ffffff' } : boardStyle(b);
                        return (
                            <button
                                className="inline-flex items-center gap-1 rounded-full border px-3 py-1 text-[12px] font-bold"
                                key={b}
                                onClick={() => setBoardFilter(b)}
                                style={
                                    on
                                        ? { background: st.bg, color: st.fg, borderColor: st.fg }
                                        : { background: '#ffffff', color: '#64748b', borderColor: '#e2e8f0' }
                                }
                                type="button"
                            >
                                {b}
                                <span className={`text-[10px] font-semibold ${on ? 'opacity-80' : 'text-[#94a3b8]'}`}>{c}</span>
                            </button>
                        );
                    })}
                </div>
            ) : null}

            {/* 순위 표 — 블로그 관리시트 스타일 · 게시판별 그룹 */}
            <div className="overflow-x-auto rounded-md border border-[#e2e8f0] bg-white">
                <table className="w-full border-collapse text-left text-sm">
                    <thead>
                        <tr className="border-b-2 border-[#e2e8f0] bg-[#f1f5f9] text-[11px] text-[#64748b]">
                            <th className="px-3 py-2 font-semibold">발행</th>
                            <th className="px-3 py-2 font-semibold">업체(카페)</th>
                            <th className="px-3 py-2 font-semibold">키워드</th>
                            <th className="px-3 py-2 font-semibold">제목 · 자동 키워드</th>
                            <th className="px-3 py-2 text-center font-bold text-[#059669]">인기글 순위</th>
                            <th className="px-3 py-2 text-center font-semibold">최근 측정</th>
                            {!external ? <th className="px-2 py-2 text-center font-semibold">삭제</th> : null}
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr><td className="px-3 py-10 text-center text-sm text-[#94a3b8]" colSpan={external ? 6 : 7}>불러오는 중…</td></tr>
                        ) : !shownCount ? (
                            <tr><td className="px-3 py-12 text-center text-sm text-[#64748b]" colSpan={external ? 6 : 7}>{posts.length ? '검색·게시판 필터 결과가 없습니다' : "등록된 카페 글이 없습니다 · '시트 붙여넣기 등록'으로 추가하세요"}</td></tr>
                        ) : (
                            groups.map(([groupBoard, groupPosts]) => (
                                <Fragment key={groupBoard}>
                                    {boardFilter === '전체' && boards.length > 1 ? (
                                        <tr>
                                            <td
                                                className="border-b border-[#e2e8f0] px-3 py-1.5 text-[12px] font-bold"
                                                colSpan={external ? 6 : 7}
                                                style={{ background: boardStyle(groupBoard).bg, color: boardStyle(groupBoard).fg }}
                                            >
                                                {groupBoard}
                                                <span className="ml-1 text-[11px] font-semibold opacity-70">{groupPosts.length}개</span>
                                            </td>
                                        </tr>
                                    ) : null}
                                    {groupPosts.map((p) => {
                                        const last = p.measurements?.[p.measurements.length - 1];
                                        return (
                                    <tr className="border-b border-[#e2e8f0]" key={p.id}>
                                        <td className="px-3 py-2 text-xs font-semibold text-[#475569]">
                                            {p.published_date
                                                ? new Date(p.published_date).toLocaleDateString('ko-KR', { day: '2-digit', month: '2-digit' })
                                                : '—'}
                                        </td>
                                        <td className="px-3 py-2 text-[13px] font-semibold text-[#475569]">
                                            <a
                                                className="hover:text-[#1e40af] hover:underline"
                                                href={`https://cafe.naver.com/${p.cafe_name || ''}`}
                                                rel="noreferrer"
                                                target="_blank"
                                                title="카페로 이동"
                                            >
                                                {companyLabel(p)}
                                            </a>
                                            <div className="text-[10px] font-normal text-[#94a3b8]">{cafeLabel(p.cafe_name) || p.club_id}</div>
                                        </td>
                                        <td className="px-3 py-2">
                                            <CafeSearchCell external={external} onSaved={reload} post={p} />
                                        </td>
                                        <td className="px-3 py-2">
                                            {(() => {
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
                                                return p.post_url ? (
                                                    <a className="group block cursor-pointer" href={p.post_url} rel="noopener noreferrer" target="_blank" title="실제 카페 글로 이동">
                                                        {inner}
                                                    </a>
                                                ) : (
                                                    <div>{inner}</div>
                                                );
                                            })()}
                                        </td>
                                        <td className="px-3 py-2 text-center"><RankCell ms={p.measurements} /></td>
                                        <td className="px-3 py-2 text-center text-[11px] text-[#94a3b8]">{last?.date?.slice(5) || '—'}</td>
                                        {!external ? (
                                            <td className="px-2 py-2 text-center">
                                                <button
                                                    className="rounded-md border border-[#fca5a5] px-2 py-1 text-[11px] font-semibold text-[#dc2626] hover:bg-[#fef2f2] disabled:opacity-50"
                                                    disabled={deleting === p.id}
                                                    onClick={() => void remove(p.id)}
                                                    title="삭제(측정 제외)"
                                                    type="button"
                                                >{deleting === p.id ? '삭제 중…' : '삭제'}</button>
                                            </td>
                                        ) : null}
                                    </tr>
                                        );
                                    })}
                                </Fragment>
                            ))
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
