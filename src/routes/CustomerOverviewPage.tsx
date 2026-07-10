import { useEffect, useState } from 'react';
import { BlogRankProvider, useBlogRank } from '../components/blogRank/lib/BlogRankContext';
import { Kpi } from '../components/blogRank/lib/ui';
import { lastM, fmtWon } from '../components/blogRank/lib/helpers';
import { todayKST } from '../api/blogRank';
import { getPlaceAccounts, getPlaceKeywords } from '../api/placeRank';
import { getClientContracts, amountProgress, type ClientContract } from '../api/clientContracts';
import type { CategoryKey } from '../components/categoryRank/categories';

// 진행률 색상 — 상세페이지 상품카드와 동일(70%↑ 초록 · 40%↑ 주황 · 그 외 빨강).
const progColor = (p: number | null) =>
    p == null ? '#94a3b8' : p >= 70 ? '#059669' : p >= 40 ? '#d97706' : '#dc2626';

// 계약 카테고리(한글 라벨) → 포털 카테고리 키. 클릭 시 /portal/<key> 로 이동.
const CAT_TO_KEY: Record<string, CategoryKey> = {
    블로그: 'blog',
    플레이스: 'place',
    인스타: 'insta',
    카페: 'cafe',
    쇼핑: 'shopping',
    파워링크: 'powerlink',
    영상: 'video',
    동영상: 'video',
};
// 섹션 표시 순서(없는 카테고리는 건너뜀, 미정의는 뒤에 붙임).
const CAT_ORDER = ['블로그', '플레이스', '인스타', '카페', '쇼핑', '파워링크', '영상'];
import { useAsParam } from './CustomerCategoryPage';
import { SameDayModal, type SameDayRow } from '../components/blogRank/components/SameDayModal';

function goPortal(path: string) {
    const as = new URLSearchParams(window.location.search).get('as');
    const sep = path.includes('?') ? '&' : '?';
    const url = `${path}${as ? `${sep}as=${as}` : ''}`;
    window.history.pushState({}, '', url);
    window.dispatchEvent(new Event('app:navigate'));
}

function OverviewCards() {
    const { accounts, posts, scopedClientId } = useBlogRank();
    const [showSameDay, setShowSameDay] = useState(false);
    const [showPrevDay, setShowPrevDay] = useState(false);
    const [place, setPlace] = useState({ inTen: 0, total: 0 });
    const [contracts, setContracts] = useState<ClientContract[]>([]);

    // 본인 업체 계약(상품) 로드 — 매출/상품 진행률 KPI용. 업체 스코프(scopedClientId)일 때만.
    useEffect(() => {
        if (!scopedClientId) {
            setContracts([]);
            return;
        }
        let alive = true;
        void (async () => {
            const { data } = await getClientContracts(scopedClientId);
            if (alive) setContracts(data);
        })();
        return () => {
            alive = false;
        };
    }, [scopedClientId]);

    // 상품 = 승인/계약중 건(신규 등록 sheet_approved===false 제외). 매출은 공급가(amount) 합 — 외주비는 노출 안 함.
    const products = contracts.filter((c) => c.sheet_approved !== false);
    const totalSales = products.reduce((s, c) => s + (c.amount || 0), 0);
    const withProg = products.map((c) => ({ c, prog: amountProgress(c) }));
    const progList = withProg.filter((x) => x.prog != null);
    const activeCount = progList.filter((x) => (x.prog ?? 0) < 100).length;
    const avgProg = progList.length
        ? Math.round(progList.reduce((s, x) => s + (x.prog ?? 0), 0) / progList.length)
        : null;

    // 카테고리별 그룹(위아래 분리). 정의된 순서 먼저, 그 외는 뒤에.
    const byCat = new Map<string, typeof withProg>();
    for (const it of withProg) {
        const k = it.c.category || '기타';
        const arr = byCat.get(k);
        if (arr) arr.push(it);
        else byCat.set(k, [it]);
    }
    const orderedCats = [
        ...CAT_ORDER.filter((k) => byCat.has(k)),
        ...[...byCat.keys()].filter((k) => !CAT_ORDER.includes(k)),
    ];

    useEffect(() => {
        let alive = true;
        void (async () => {
            const { data: accs } = await getPlaceAccounts(scopedClientId || undefined);
            const { data: kws } = accs.length ? await getPlaceKeywords(accs.map((a) => a.id)) : { data: [] };
            if (!alive) return;
            const inTen = kws.filter((k) => {
                const m = [...(k.measurements || [])].sort((a, b) => b.date.localeCompare(a.date))[0];
                return m && m.status === 'ok' && m.rank <= 10;
            }).length;
            setPlace({ inTen, total: kws.length });
        })();
        return () => {
            alive = false;
        };
    }, [scopedClientId]);

    const today = todayKST();
    const yesterday = (() => {
        const [y, m, d] = today.split('-').map(Number);
        return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
    })();
    const measured = posts.filter((p) => p.measurements.length);
    const inTen = measured.filter((p) => (lastM(p)?.ti ?? 99) <= 10).length;
    const rowsForPub = (pub: string): SameDayRow[] =>
        posts
            .filter((p) => (p.published_date || '').slice(0, 10) === pub && p.measurements.some((x) => x.date === today))
            .map((p) => ({
                post: p,
                account: accounts.find((a) => a.id === p.blog_account_id) ?? null,
                m: p.measurements.find((x) => x.date === today)!,
            }));
    const sameDayRows = rowsForPub(today);
    const prevDayRows = rowsForPub(yesterday);
    const sameDayBlogs = new Set(sameDayRows.map((r) => r.post.blog_account_id)).size;
    const prevTop10 = prevDayRows.filter(
        (r) => (r.m.ti_status ?? 'ok') === 'ok' && r.m.ti != null && r.m.ti <= 10,
    ).length;
    const mmdd = (iso: string) => {
        const [, mo, d] = iso.split('-');
        return `${Number(mo)}월 ${Number(d)}일`;
    };

    return (
        <>
            {/* 매출 · 상품 진행률 (외주비 비노출) — 실시간. 계약 있을 때만. */}
            {products.length ? (
                <div className="grid gap-3 rounded-2xl border border-[#e2e8f0] bg-gradient-to-b from-[#f8fafc] to-white p-4">
                    <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-[#0f172a]">매출 · 상품 진행률</span>
                        <span className="rounded-full bg-[#dbeafe] px-2 py-0.5 text-[11px] font-bold text-[#1e40af]">실시간</span>
                    </div>
                    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
                        <Kpi label="매출 (공급가)" value={`${fmtWon(totalSales)}원`} accent="#1e40af" sub={`상품 ${products.length}개`} />
                        <Kpi label="진행 중 상품" value={`${activeCount}`} accent="#a16207" sub={`완료 ${products.length - activeCount}개`} />
                        <Kpi label="평균 진행률" value={avgProg != null ? `${avgProg}%` : '-'} accent={progColor(avgProg)} sub="외주비 소진 기준" />
                    </div>
                    {/* 카테고리별(플레이스/블로그…) 위아래 분리 — 카드/헤더 클릭 시 해당 카테고리로 이동 */}
                    <div className="grid gap-3">
                        {orderedCats.map((cat) => {
                            const items = byCat.get(cat) ?? [];
                            const key = CAT_TO_KEY[cat];
                            const go = () => key && goPortal(`/portal/${key}`);
                            return (
                                <div key={cat}>
                                    <div className="mb-1.5 flex items-center gap-2">
                                        <span className="text-[13px] font-bold text-[#334155]">{cat}</span>
                                        <span className="text-[11px] font-semibold text-[#94a3b8]">{items.length}개</span>
                                        {key ? (
                                            <button
                                                className="text-[11px] font-bold text-[#1e40af] hover:underline"
                                                onClick={go}
                                                type="button"
                                            >
                                                자세히 보기 →
                                            </button>
                                        ) : null}
                                    </div>
                                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                                        {items.map(({ c, prog }) => {
                                            const goal = c.goal_count ?? 0;
                                            const done = Math.max(0, goal - (c.remain_count ?? goal));
                                            return (
                                                <div
                                                    className={`flex flex-col rounded-lg border-2 border-[#e2e8f0] bg-white px-3.5 py-3 shadow-sm transition ${
                                                        key ? 'cursor-pointer hover:border-[#1e40af] hover:shadow-md' : ''
                                                    }`}
                                                    key={c.id}
                                                    onClick={go}
                                                    role={key ? 'button' : undefined}
                                                    tabIndex={key ? 0 : undefined}
                                                >
                                                    <div className="flex items-start justify-between gap-1.5">
                                                        <div className="truncate text-xs font-bold text-[#334155]">{c.subtype}</div>
                                                        {c.blog_name ? (
                                                            <span className="max-w-[110px] shrink-0 truncate rounded-full bg-[#ede9fe] px-2 py-0.5 text-[11px] font-extrabold text-[#7c3aed]">
                                                                {c.blog_name}
                                                            </span>
                                                        ) : null}
                                                    </div>
                                                    <div className="mt-0.5 truncate text-[11px] font-semibold text-[#94a3b8]">
                                                        {c.contract_date ? `📅 ${c.contract_date}` : c.category}
                                                    </div>
                                                    <div className="mt-0.5 text-2xl font-bold" style={{ color: progColor(prog) }}>
                                                        {prog != null ? `${prog}%` : goal ? `${goal}건` : '-'}
                                                    </div>
                                                    {prog != null ? (
                                                        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-[#e2e8f0]">
                                                            <div
                                                                className="h-full rounded-full"
                                                                style={{ background: progColor(prog), width: `${Math.min(100, Math.max(0, prog))}%` }}
                                                            />
                                                        </div>
                                                    ) : null}
                                                    <div className="mt-1 text-[11px] font-semibold text-[#64748b]">
                                                        {goal ? `${done}/${goal}건` : '건수 미입력'}
                                                        {c.amount ? ` · ${fmtWon(c.amount)}원` : ''}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            ) : null}

            <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-5">
                <Kpi
                    label="관리 블로그"
                    value={`${accounts.length}`}
                    sub={`진행 ${accounts.filter((a) => a.is_active).length} · 중단 ${accounts.filter((a) => !a.is_active).length}`}
                    onClick={() => goPortal('/portal/blog')}
                />
                <Kpi
                    label="관리 플레이스"
                    value={`${place.total}`}
                    accent="#7c3aed"
                    sub={place.total ? `10위 이내 ${place.inTen}건 · 눌러서 보기` : '등록된 키워드 없음'}
                    onClick={() => goPortal('/portal/place')}
                />
                <Kpi
                    label="통합탭 10위 이내"
                    value={measured.length ? `${inTen}` : '-'}
                    accent="#059669"
                    sub={measured.length ? `측정 ${measured.length}건 중 · 눌러서 보기` : '크롤러 기준 계산'}
                    onClick={() => goPortal('/portal/blog?tab=tracker')}
                />
                <Kpi
                    label={`당일 측정 글 (${mmdd(today)})`}
                    value={`${sameDayRows.length}`}
                    accent="#a16207"
                    sub={`블로그 ${sameDayBlogs}곳 · 눌러서 목록`}
                    onClick={() => setShowSameDay(true)}
                />
                <Kpi
                    label={`전날 측정 글 순위 (${mmdd(yesterday)})`}
                    value={`${prevDayRows.length}`}
                    accent="#6d28d9"
                    sub={`통합 10위내 ${prevTop10} · 눌러서 순위목록`}
                    onClick={() => setShowPrevDay(true)}
                />
            </div>
            {showSameDay ? (
                <SameDayModal
                    rows={sameDayRows}
                    dayLabel={mmdd(today)}
                    mode="publish"
                    allPosts={posts}
                    accounts={accounts}
                    customerMode
                    onClose={() => setShowSameDay(false)}
                    onToast={() => undefined}
                />
            ) : null}
            {showPrevDay ? (
                <SameDayModal
                    rows={prevDayRows}
                    dayLabel={mmdd(yesterday)}
                    mode="rank"
                    customerMode
                    onClose={() => setShowPrevDay(false)}
                    onToast={() => undefined}
                />
            ) : null}
        </>
    );
}

function CustomerOverviewPage() {
    const as = useAsParam();
    return (
        <section className="grid gap-4">
            <div className="flex items-center gap-2">
                <h2 className="m-0 text-[22px] font-semibold text-[#0f172a]">통합 대시보드</h2>
                <span className="rounded-full bg-[#dbeafe] px-2.5 py-1 text-xs font-bold text-[#1e40af]">고객 뷰</span>
            </div>
            <p className="m-0 text-sm text-[#64748b]">계약하신 카테고리 현황을 한눈에 봅니다.</p>

            <BlogRankProvider customerMode previewClientId={as || null}>
                <OverviewCards />
            </BlogRankProvider>
        </section>
    );
}

export default CustomerOverviewPage;
