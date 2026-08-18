import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    cafeTiStatus,
    excludeCafeRankPost,
    getCafeRankPosts,
    parseCafeUrl,
    upsertCafeRankPost,
    type CafeMeasurement,
    type CafeRankPost,
} from '../../../api/cafeRank';
import { CafeSearchCell } from '../components/CafeSearchCell';
import { countCafePendingMeasures, enqueueCafeRankMeasures } from '../../../api/cafeRankSearch';
import { cafeNameRank } from '../../../lib/cafeAccounts';
import { Pager } from '../../blogRank/lib/ui';
import { PER_FEED } from '../../blogRank/lib/helpers';

// 카페 · 순위 트래커 — 자사 카페 글의 네이버 '인기글 테마 섹션' 내 순위. 측정은 PC 크롤러(cafe_rank_crawler.py)가 기록.
//   화면 골격은 블로그 순위 트래커(blogRank/pages/TrackerTab)와 동일하게 맞춘다(사장님 요청 2026-08-18).
//   · 위: 큰 검색창 한 줄 → 셀렉트/버튼 필터 한 줄 → 표 → 페이지 넘김
//   · 예전엔 카페 칩 줄 + 게시판 칩 줄 + 표 안 그룹 헤더까지 3중이라 보기 복잡했다. 필터는 셀렉트로 접고,
//     게시판은 업체 칸 아래 작은 칩으로 표시해 정보는 그대로 남긴다.
//   기능(재검색·전체 재검색·시트 등록·삭제·업체 스코프)은 전부 유지.

// 여러 업체가 함께 쓰는 카페만 이름을 고정한다. 그 외 카페는 아래 cafeText 가
//   cafe_accounts.display_name(업체명)으로 표시한다 — vanity(계정 아이디)를 화면에 내보내지 않는다.
const CAFE_LABEL: Record<string, string> = { ddmkt2: '마이클의 정보 세상' };

// 게시판(board) — 동일 카페 안에서 게시판별 구분. 표시 순서·색.
const BOARD_ORDER = ['누수', '더티클리닉', '설고점', '더맨시스템', '더반클린', '누수상담소'];
const BOARD_STYLE: Record<string, { bg: string; fg: string }> = {
    누수: { bg: '#eff6ff', fg: '#1d4ed8' },
    더티클리닉: { bg: '#f0fdfa', fg: '#0d9488' },
    설고점: { bg: '#fff7ed', fg: '#c2410c' },
    더맨시스템: { bg: '#faf5ff', fg: '#7c3aed' },
    더반클린: { bg: '#fdf2f8', fg: '#be185d' },
    누수상담소: { bg: '#f0f9ff', fg: '#0369a1' },
};
const boardKey = (p: CafeRankPost) => p.board || p.cafe_accounts?.board_short || '미분류';
const companyLabel = (p: CafeRankPost) => p.cafe_accounts?.display_name || boardKey(p);
const boardRank = (b: string) => {
    const i = BOARD_ORDER.indexOf(b);
    return i >= 0 ? i : b === '미분류' ? 999 : 500;
};
const boardStyle = (b: string) => BOARD_STYLE[b] || { bg: '#f1f5f9', fg: '#475569' };

const todayKST = () => {
    const now = new Date();
    return new Date(now.getTime() + (now.getTimezoneOffset() + 540) * 60000).toISOString().slice(0, 10);
};

// 순위 확인 링크 — 반드시 모바일(m.search).
//   ★ 인기글 섹션은 PC 와 모바일이 다르다. 실측(2026-08-07) '광진 소방업체'는
//     모바일엔 인기글 헤더가 있고 PC엔 없다(플레이스·뉴스만). CF 경유든 사무실 IP든 동일했다.
//     우리 측정(measure_cafe_rank)이 m.search 전용이므로 확인도 모바일로 통일해야
//     "화면엔 없는데 왜 있다고 하냐"는 어긋남이 안 생긴다.
const cafeSearchUrl = (kw: string) => `https://m.search.naver.com/search.naver?query=${encodeURIComponent(kw)}`;

// 마지막 측정이 '몇 위'인지(순위 없으면 null) — 5위 이내 필터·정렬용.
const lastRank = (p: CafeRankPost): number | null => {
    const ms = p.measurements;
    if (!ms || !ms.length) return null;
    const cur = ms[ms.length - 1];
    return cafeTiStatus(cur.ti_status) === 'ranked' ? cur.ti : null;
};

// 순위 셀 — 인기글 테마 섹션 내 순위. 측정없음=측정대기, fail=실패, no_section=측정불가(섹션없음), out=권외.
//   인기글 섹션은 보통 5~10개 → ≤3 초록(상위), ≤7 파랑, 그외 회색.
function RankCell({ ms, keyword }: { ms: CafeMeasurement[]; keyword?: string | null }) {
    const kw = (keyword || '').trim();
    // 순위(또는 상태)를 누르면 그 키워드의 모바일 검색결과가 새 탭으로 열린다.
    const wrap = (node: React.ReactNode) => (kw
        ? <a href={cafeSearchUrl(kw)} target="_blank" rel="noreferrer"
            title={`모바일 검색결과 열기 — ${kw}`} className="hover:underline">{node}</a>
        : node);
    if (!ms || !ms.length) return wrap(<span className="text-[12px] font-semibold text-[#d97706]">측정 대기</span>);
    const cur = ms[ms.length - 1];
    const prev = ms.length > 1 ? ms[ms.length - 2] : null;
    const curS = cafeTiStatus(cur.ti_status);   // ok/list_ok→ranked · out/list_out→out · no_section/no_list→no_section
    if (curS === 'fail') return wrap(<span className="text-[13px] font-bold text-[#dc2626]">실패</span>);
    if (curS === 'no_section')
        return wrap(<span className="text-[12px] font-semibold text-[#94a3b8]" title="모바일 기준 인기글 섹션이 없어 측정 대상이 아닙니다(눌러서 확인)">측정불가</span>);
    if (curS === 'out') return wrap(<span className="text-[13px] font-semibold text-[#64748b]">권외</span>);
    const color = cur.ti <= 3 ? '#059669' : cur.ti <= 7 ? '#2563eb' : '#64748b';
    let delta = null as null | { s: string; c: string };
    if (prev && cafeTiStatus(prev.ti_status) === 'ranked') {
        const d = prev.ti - cur.ti;
        if (d > 0) delta = { s: `▲${d}`, c: '#dc2626' };
        else if (d < 0) delta = { s: `▼${-d}`, c: '#2563eb' };
        else delta = { s: '—', c: '#94a3b8' };
    }
    return wrap(
        <span className="inline-flex items-center gap-1">
            <b style={{ color }} className="text-[14px]">{cur.ti}위</b>
            {delta ? <span className="text-[11px] font-bold" style={{ color: delta.c }}>{delta.s}</span> : null}
        </span>,
    );
}

export function CafeTrackerTab({
    readOnly = false,
    lockCompany = null,
    scopeClientId = null,
}: { readOnly?: boolean; lockCompany?: string | string[] | null; scopeClientId?: string | null } = {}) {
    // lockCompany: 고객 뷰 — 이 업체(company_key) 글만(자동 읽기전용).
    // scopeClientId: 내부 관리 스코프(누수탐지 등) — 이 client 의 카페 글만, 등록/붙여넣기는 그대로 가능.
    const external = readOnly || !!lockCompany;
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
    const [boardFilter, setBoardFilter] = useState('전체');
    const [cafeFilter, setCafeFilter] = useState('전체'); // 카페(vanity)별 필터
    const [month, setMonth] = useState('');               // 발행 월(YYYY-MM)
    const [pubFilter, setPubFilter] = useState<'all' | 'today' | 'yesterday'>('all');
    const [topOnly, setTopOnly] = useState(false);        // 인기글 5위 이내만(= 실적 기준선)
    const [page, setPage] = useState(1);
    // 관리시트에서 '순위 보기'(?company=company_key)로 들어오면 그 업체 글만 남긴다.
    //   ★ 예전엔 업체키→게시판 이름을 손으로 적어둔 표(6곳)로 게시판 탭만 골랐다. 표에 없는
    //     새 업체(출장뷔페·재활요양 등)는 전부 '전체'로 떨어져 남의 글까지 보였다.
    //     이제 cafe_accounts.company_key 로 직접 거른다 — 표를 고칠 일이 없고,
    //     한 업체가 카페를 둘 쓰는 경우(더맨시스템+더맨자체)도 같이 나온다.
    const [companyFilter, setCompanyFilter] = useState(
        () => new URLSearchParams(window.location.search).get('company') || '',
    );

    const reload = async () => {
        setLoading(true);
        const { data, error } = await getCafeRankPosts();
        if (error) setErr(error.message || 'cafe_rank_posts 조회 실패 — docs/cafe-rank-tables.sql 실행 필요');
        else {
            setErr('');
            let list = data;
            if (lockCompany) list = list.filter((p) => { const ck = p.cafe_accounts?.company_key ?? ''; return Array.isArray(lockCompany) ? lockCompany.includes(ck) : ck === lockCompany; });
            if (scopeClientId) list = list.filter((p) => p.cafe_accounts?.client_id === scopeClientId);
            setPosts(list);
        }
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

    // 업체 매칭 기준 — client_id 우선, 없으면 company_key.
    //   ★ company_key 하나로는 모자란다: 설고점·더맨시스템은 카페가 둘이라 계정도 둘이고
    //     업체키가 서로 다르다(seolgo/seolgo2, theman/theman2). 업체키로만 거르면
    //     같은 회사 글이 절반씩 잘려 나간다(실측 설고 8+21, 더맨 18+28).
    //     두 계정은 client_id 가 같으므로 그걸로 묶어야 회사 단위가 맞는다.
    const companyClientId = useMemo(() => {
        if (!companyFilter) return null;
        const hit = posts.find((p) => (p.cafe_accounts?.company_key ?? '') === companyFilter);
        return hit?.cafe_accounts?.client_id || null;
    }, [posts, companyFilter]);
    const matchCompany = useCallback(
        (p: CafeRankPost) => (companyClientId
            ? p.cafe_accounts?.client_id === companyClientId
            : (p.cafe_accounts?.company_key ?? '') === companyFilter),
        [companyClientId, companyFilter],
    );

    const today = todayKST();
    const yesterday = useMemo(() => {
        const [y, m, d] = today.split('-').map(Number);
        return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
    }, [today]);

    // 업체를 골라 들어왔으면 카페·게시판 목록도 그 업체 것만 — 남의 게시판이 깔리지 않게.
    const scopedPosts = useMemo(
        () => (companyFilter ? posts.filter(matchCompany) : posts),
        [posts, companyFilter, matchCompany],
    );

    // 카페 표시는 vanity(ddnusu·themansys 같은 계정 아이디)가 아니라 업체명으로 — 사장님 요청 2026-08-18.
    //   cafe_accounts.display_name 을 카페별로 모아 쓴다. 한 카페를 여러 업체가 쓰면(마이클) 카페 이름을 쓰고,
    //   그마저 없으면 업체명을 나열한다. vanity 는 정말 아무것도 없을 때의 마지막 수단.
    const cafeNames = useMemo(() => {
        const m = new Map<string, Set<string>>();
        for (const p of posts) {
            const v = p.cafe_name || '기타';
            const n = (p.cafe_accounts?.display_name || '').trim();
            if (!n) continue;
            (m.get(v) ?? m.set(v, new Set<string>()).get(v)!).add(n);
        }
        return m;
    }, [posts]);
    const cafeText = useCallback((v?: string | null) => {
        const key = v || '';
        if (CAFE_LABEL[key]) return CAFE_LABEL[key];
        const names = [...(cafeNames.get(key) || [])];
        if (names.length) return names.join(' · ');
        return key || '기타';
    }, [cafeNames]);

    // 카페(vanity) 목록 — 셀렉트용. 순서는 cafeNameRank.
    const cafes = useMemo(() => {
        const cnt = new Map<string, number>();
        for (const p of scopedPosts) { const k = p.cafe_name || '기타'; cnt.set(k, (cnt.get(k) || 0) + 1); }
        return [...cnt.entries()].sort((a, b) => cafeNameRank(a[0]) - cafeNameRank(b[0]) || a[0].localeCompare(b[0]));
    }, [scopedPosts]);

    // 게시판 목록 — 선택한 카페의 게시판만.
    const boards = useMemo(() => {
        const scoped = cafeFilter === '전체' ? scopedPosts : scopedPosts.filter((p) => (p.cafe_name || '기타') === cafeFilter);
        const cnt = new Map<string, number>();
        for (const p of scoped) cnt.set(boardKey(p), (cnt.get(boardKey(p)) || 0) + 1);
        return [...cnt.entries()].sort((a, b) => boardRank(a[0]) - boardRank(b[0]) || a[0].localeCompare(b[0]));
    }, [scopedPosts, cafeFilter]);

    // 발행 월 목록(YYYY-MM) — 현재 카페/업체 범위 기준, 최신월 먼저.
    const months = useMemo(() => {
        const set = new Set<string>();
        for (const p of scopedPosts) {
            if (cafeFilter !== '전체' && (p.cafe_name || '기타') !== cafeFilter) continue;
            const m = (p.published_date || '').slice(0, 7);
            if (m) set.add(m);
        }
        return [...set].sort((a, b) => (a < b ? 1 : -1));
    }, [scopedPosts, cafeFilter]);

    const rows = useMemo(() => {
        let r = [...posts];
        if (companyFilter) r = r.filter(matchCompany);
        if (cafeFilter !== '전체') r = r.filter((p) => (p.cafe_name || '기타') === cafeFilter);
        if (boardFilter !== '전체') r = r.filter((p) => boardKey(p) === boardFilter);
        if (month) r = r.filter((p) => (p.published_date || '').slice(0, 7) === month);
        if (pubFilter !== 'all') {
            const d = pubFilter === 'today' ? today : yesterday;
            r = r.filter((p) => (p.published_date || '').slice(0, 10) === d);
        }
        if (topOnly) r = r.filter((p) => { const n = lastRank(p); return n != null && n <= 5; });
        if (q) {
            const qq = q.trim();
            r = r.filter((p) => cafeText(p.cafe_name).includes(qq) || (p.cafe_name || '').includes(qq));
        }
        if (search.trim()) {
            const s = search.trim();
            r = r.filter((p) =>
                cafeText(p.cafe_name).includes(s) ||
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
    }, [posts, q, search, cafeFilter, boardFilter, month, pubFilter, topOnly, companyFilter, matchCompany, today, yesterday, cafeText]);

    // 당일/전날 발행 글 수(버튼 옆 표시) — 지금 카페·게시판·업체 범위 기준(월/5위 필터는 빼고 센다).
    const pubCounts = useMemo(() => {
        let t = 0;
        let y = 0;
        for (const p of scopedPosts) {
            if (cafeFilter !== '전체' && (p.cafe_name || '기타') !== cafeFilter) continue;
            if (boardFilter !== '전체' && boardKey(p) !== boardFilter) continue;
            const d = (p.published_date || '').slice(0, 10);
            if (d === today) t += 1;
            else if (d === yesterday) y += 1;
        }
        return { today: t, yesterday: y };
    }, [scopedPosts, cafeFilter, boardFilter, today, yesterday]);

    // 업체 필터 표시 이름 + 해제. 해제하면 주소의 ?company= 도 지워 새로고침해도 안 돌아온다.
    const companyName = useMemo(() => {
        if (!companyFilter) return '';
        const hit = posts.find((p) => (p.cafe_accounts?.company_key ?? '') === companyFilter);
        return hit?.cafe_accounts?.display_name || companyFilter;
    }, [posts, companyFilter]);
    const clearCompany = () => {
        setCompanyFilter('');
        const u = new URL(window.location.href);
        u.searchParams.delete('company');
        window.history.replaceState(null, '', u.pathname + u.search);
    };

    const pages = Math.max(1, Math.ceil(rows.length / PER_FEED));
    const current = Math.min(page, pages);
    const pageRows = rows.slice((current - 1) * PER_FEED, current * PER_FEED);

    // 전체 재검색 — 지금 필터로 걸러진 글 전부를 큐에 등록. 측정은 PC가 순차 처리(진행률만 폴링).
    //   ★ 페이지에 보이는 30건이 아니라 '필터 결과 전체'가 대상이다(예전 동작 유지).
    const [bulk, setBulk] = useState<{ busy: boolean; left: number; msg: string }>({ busy: false, left: 0, msg: '' });
    const bulkResearch = async () => {
        if (bulk.busy) return;
        const targets = rows.filter((p) => (p.keyword_manual || p.keyword || '').trim());
        if (!targets.length) { setBulk({ busy: false, left: 0, msg: '재검색할 글이 없습니다' }); return; }
        if (!window.confirm(
            `지금 보고 있는 ${targets.length}건을 전체 재검색합니다.\n\n` +
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

    // 선택한 카페/게시판이 더 이상 없으면 '전체'로 되돌려 빈 화면에 갇히지 않게.
    useEffect(() => {
        if (cafeFilter !== '전체' && !cafes.some(([c]) => c === cafeFilter)) setCafeFilter('전체');
    }, [cafes, cafeFilter]);
    useEffect(() => {
        if (boardFilter !== '전체' && !boards.some(([b]) => b === boardFilter)) setBoardFilter('전체');
    }, [boards, boardFilter]);
    // 필터가 바뀌면 1페이지로.
    useEffect(() => { setPage(1); }, [search, cafeFilter, boardFilter, month, pubFilter, topOnly, companyFilter]);

    const SELECT = 'h-9 rounded-md border border-[#cbd5e1] bg-white px-2 text-xs';
    const colSpan = external ? 6 : 7;

    return (
        <div className="grid gap-3">
            {/* 관리시트에서 업체를 눌러 들어온 상태 — 지금 누구 것만 보고 있는지 알리고, 한 번에 풀 수 있게. */}
            {companyFilter && !lockCompany ? (
                <div className="flex items-center gap-2 rounded-lg border border-[#c7d2fe] bg-[#eef2ff] px-3 py-2 text-[12px] text-[#3730a3]">
                    <b>{companyName}</b> 글만 보는 중 · {scopedPosts.length}건
                    <button type="button" onClick={clearCompany}
                        className="ml-auto rounded border border-[#c7d2fe] bg-white px-2 py-0.5 text-[11px] font-bold text-[#4338ca] hover:bg-[#f5f3ff]">
                        전체 보기 ✕
                    </button>
                </div>
            ) : null}

            {/* 블로그 트래커와 동일 — 큰 검색창 한 줄 */}
            <input
                aria-label="업체·제목·키워드 검색"
                className="h-11 w-full rounded-md border border-[#cbd5e1] bg-white px-3 text-sm"
                onChange={(e) => setSearch(e.target.value)}
                placeholder="업체·제목·키워드 검색 (예: 누수탐지) — 일부만 입력해도 됩니다"
                value={search}
            />

            {/* 필터 한 줄 — 카페 / 게시판 / 발행 월 / 당일·전날 / 5위 이내 / 건수 */}
            <div className="flex flex-wrap items-center gap-2">
                {cafes.length > 1 ? (
                    <select className={SELECT} onChange={(e) => { setCafeFilter(e.target.value); setBoardFilter('전체'); }} value={cafeFilter}>
                        <option value="전체">카페 전체</option>
                        {cafes.map(([c, n]) => (
                            <option key={c} value={c}>{cafeText(c)} ({n})</option>
                        ))}
                    </select>
                ) : null}
                {boards.length > 1 ? (
                    <select className={SELECT} onChange={(e) => setBoardFilter(e.target.value)} value={boardFilter}>
                        <option value="전체">게시판 전체</option>
                        {boards.map(([b, n]) => (
                            <option key={b} value={b}>{b} ({n})</option>
                        ))}
                    </select>
                ) : null}
                <select className={SELECT} onChange={(e) => setMonth(e.target.value)} value={month}>
                    <option value="">발행 월 전체</option>
                    {months.map((m) => {
                        const [y, mo] = m.split('-');
                        return <option key={m} value={m}>{y}년 {Number(mo)}월</option>;
                    })}
                </select>
                <button
                    className={`rounded-full border-2 px-4 py-1.5 text-sm font-bold transition ${
                        pubFilter === 'today'
                            ? 'border-[#ea580c] bg-[#f97316] text-white shadow-sm'
                            : 'border-[#fdba74] bg-white text-[#ea580c] hover:bg-[#fff7ed]'
                    }`}
                    onClick={() => setPubFilter((v) => (v === 'today' ? 'all' : 'today'))}
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
                    onClick={() => setPubFilter((v) => (v === 'yesterday' ? 'all' : 'yesterday'))}
                    type="button"
                >
                    전날 올라온 글 ({pubCounts.yesterday})
                </button>
                <label className="flex items-center gap-1 text-xs text-[#334155]" title="실적 기준선 — 인기글 5위 이내로 측정된 글만">
                    <input checked={topOnly} onChange={(e) => setTopOnly(e.target.checked)} type="checkbox" />
                    인기글 5위 이내만
                </label>
                <span className="ml-auto text-xs text-[#64748b]">{rows.length}건</span>
            </div>

            {/* 내부 전용 동작 — 새로고침 / 전체 재검색 / 시트 등록. 필터 줄과 분리해 한 줄로 모은다. */}
            {!external ? (
                <div className="flex flex-wrap items-center gap-2">
                    <button
                        className="inline-flex h-9 items-center rounded-md border border-[#cbd5e1] bg-white px-3 text-xs font-semibold text-[#475569] hover:bg-[#f1f5f9]"
                        onClick={() => void reload()}
                        type="button"
                    >
                        새로고침
                    </button>
                    <button
                        className="inline-flex h-9 items-center rounded-md bg-[#0f766e] px-3 text-xs font-bold text-white hover:bg-[#115e59] disabled:opacity-50"
                        disabled={bulk.busy || !rows.length}
                        onClick={() => void bulkResearch()}
                        title="지금 필터로 보이는 글을 전부 재검색(PC가 순차 측정 · 블로그 크롤과 자동 비겹침)"
                        type="button"
                    >
                        {bulk.busy ? `측정 중… 남은 ${bulk.left}` : `전체 재검색 ${rows.length}`}
                    </button>
                    <button
                        className="inline-flex h-9 items-center rounded-md bg-[#1e40af] px-3 text-xs font-semibold text-white hover:bg-[#1e3a8a]"
                        onClick={() => setShowAdd((v) => !v)}
                        type="button"
                    >
                        시트 붙여넣기 등록
                    </button>
                    <span className="text-[11px] text-[#94a3b8]">
                        네이버 <b className="text-[#64748b]">인기글 테마 섹션</b> 내 순위(광고 제외) · 섹션 없는 키워드는 ‘측정불가’
                    </span>
                </div>
            ) : null}

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

            {/* 순위 표 — 블로그 순위 트래커와 동일 골격(그룹 헤더 없이 한 줄씩 · 하단 페이지 넘김) */}
            <div className="overflow-x-auto rounded-md border border-[#e2e8f0] bg-white">
                <table className="w-full border-collapse text-left text-sm">
                    <thead>
                        <tr className="border-b-2 border-[#e2e8f0] bg-[#f1f5f9] text-[11px] text-[#64748b]">
                            <th className="px-3 py-2 font-semibold">발행</th>
                            <th className="px-3 py-2 font-semibold">업체(카페)</th>
                            <th className="px-3 py-2 font-semibold">키워드 검색</th>
                            <th className="px-3 py-2 font-semibold">제목 · 자동 키워드</th>
                            <th className="px-3 py-2 text-center font-bold text-[#059669]">인기글 순위</th>
                            <th className="px-3 py-2 text-center font-semibold">최근 측정</th>
                            {!external ? <th className="px-2 py-2 text-center font-semibold">삭제</th> : null}
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr><td className="px-3 py-10 text-center text-sm text-[#94a3b8]" colSpan={colSpan}>불러오는 중…</td></tr>
                        ) : !rows.length ? (
                            <tr><td className="px-3 py-12 text-center text-sm text-[#64748b]" colSpan={colSpan}>{posts.length ? '검색·필터 결과가 없습니다' : "등록된 카페 글이 없습니다 · '시트 붙여넣기 등록'으로 추가하세요"}</td></tr>
                        ) : (
                            pageRows.map((p) => {
                                const last = p.measurements?.[p.measurements.length - 1];
                                const bd = boardKey(p);
                                const st = boardStyle(bd);
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
                                            {/* 게시판은 그룹 헤더 대신 여기 작은 칩으로 — 줄 수를 늘리지 않고 구분은 남긴다. */}
                                            <div className="mt-0.5 flex items-center gap-1">
                                                <span className="rounded px-1.5 py-0.5 text-[10px] font-bold" style={{ background: st.bg, color: st.fg }}>{bd}</span>
                                                {/* 카페 이름이 업체명과 같으면 같은 말이 두 번 나오므로 감춘다. */}
                                                {cafeText(p.cafe_name) !== companyLabel(p) ? (
                                                    <span className="text-[10px] font-normal text-[#94a3b8]">{cafeText(p.cafe_name)}</span>
                                                ) : null}
                                            </div>
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
                                        <td className="px-3 py-2 text-center"><RankCell ms={p.measurements} keyword={p.keyword_manual || p.keyword} /></td>
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
                            })
                        )}
                    </tbody>
                </table>
                <Pager pages={pages} current={current} onGo={setPage} />
            </div>
        </div>
    );
}
