import { useEffect, useState } from 'react';
import { BlogRankProvider, useBlogRank } from '../components/blogRank/lib/BlogRankContext';
import { Kpi } from '../components/blogRank/lib/ui';
import { lastM } from '../components/blogRank/lib/helpers';
import { todayKST } from '../api/blogRank';
import { getPlaceAccounts, getPlaceKeywords } from '../api/placeRank';
import { useAsParam } from './CustomerCategoryPage';

// 고객 ERP 통합 대시보드 — 계약한 카테고리(블로그·플레이스)의 핵심 지표를 한눈에 요약.
//   BlogRankProvider(customerMode)로 본인 업체 블로그 데이터를 로드하고, 플레이스는 별도 조회.
//   각 카드 클릭 시 해당 카테고리 화면으로 이동.

// 현재 ?as 를 유지하며 경로 이동(내부 미리보기 대상 유지).
function goPortal(path: string) {
    const as = new URLSearchParams(window.location.search).get('as');
    const sep = path.includes('?') ? '&' : '?';
    const url = `${path}${as ? `${sep}as=${as}` : ''}`;
    window.history.pushState({}, '', url);
    window.dispatchEvent(new Event('app:navigate'));
}

function OverviewCards() {
    const { accounts, posts, scopedClientId } = useBlogRank();

    // 플레이스 — 본인 업체 키워드 수 / 최신 측정 10위 이내.
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

    // 블로그 지표(대시보드 탭과 동일 기준).
    const today = todayKST();
    const yesterday = (() => {
        const [y, m, d] = today.split('-').map(Number);
        return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
    })();
    const measured = posts.filter((p) => p.measurements.length);
    const inTen = measured.filter((p) => (lastM(p)?.ti ?? 99) <= 10).length;
    // 특정 발행일에 오늘 측정된 글들의 '블로그 수'(중복 제거).
    const blogsMeasuredForPub = (pub: string) =>
        new Set(
            posts
                .filter(
                    (p) =>
                        (p.published_date || '').slice(0, 10) === pub &&
                        p.measurements.some((x) => x.date === today),
                )
                .map((p) => p.blog_account_id),
        ).size;
    const sameDayBlogs = blogsMeasuredForPub(today);
    const prevDayBlogs = blogsMeasuredForPub(yesterday);
    const mmdd = (iso: string) => {
        const [, mo, d] = iso.split('-');
        return `${Number(mo)}월 ${Number(d)}일`;
    };

    return (
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
                value={measured.length ? `${inTen}` : '—'}
                accent="#059669"
                sub={measured.length ? `측정 ${measured.length}건 중 · 눌러서 보기` : '크롤링 후 계산'}
                onClick={() => goPortal('/portal/blog?tab=tracker')}
            />
            <Kpi
                label="당일 측정 블로그"
                value={`${sameDayBlogs}`}
                accent="#a16207"
                sub={`${mmdd(today)} 측정 완료 · 블로그 ${sameDayBlogs}곳`}
                onClick={() => goPortal('/portal/blog')}
            />
            <Kpi
                label="전날 측정 블로그"
                value={`${prevDayBlogs}`}
                accent="#6d28d9"
                sub={`${mmdd(yesterday)} 측정 완료 · 블로그 ${prevDayBlogs}곳`}
                onClick={() => goPortal('/portal/blog')}
            />
        </div>
    );
}

function CustomerOverviewPage() {
    const as = useAsParam(); // 내부 미리보기 대상 업체 id(있으면 그 업체 시점)
    return (
        <section className="grid gap-4">
            <div className="flex items-center gap-2">
                <h2 className="m-0 text-[22px] font-semibold text-[#0f172a]">통합 대시보드</h2>
                <span className="rounded-full bg-[#dbeafe] px-2.5 py-1 text-xs font-bold text-[#1e40af]">고객 뷰</span>
            </div>
            <p className="m-0 text-sm text-[#64748b]">계약하신 카테고리(블로그·플레이스)의 현황을 한눈에 봅니다.</p>

            <BlogRankProvider customerMode previewClientId={as || null}>
                <OverviewCards />
            </BlogRankProvider>
        </section>
    );
}

export default CustomerOverviewPage;
