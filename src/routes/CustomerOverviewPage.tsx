import { useEffect, useState } from 'react';
import { BlogRankProvider, useBlogRank } from '../components/blogRank/lib/BlogRankContext';
import { Kpi } from '../components/blogRank/lib/ui';
import { lastM } from '../components/blogRank/lib/helpers';
import { todayKST } from '../api/blogRank';
import { getPlaceAccounts, getPlaceKeywords } from '../api/placeRank';
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
