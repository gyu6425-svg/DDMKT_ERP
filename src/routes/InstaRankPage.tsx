import { CategoryDashPage } from '../components/categoryRank/SkeletonRankPage';
import { InstaDashboardTab } from '../components/instaRank/pages/InstaDashboardTab';
import { InstaTrackerTab } from '../components/instaRank/pages/InstaTrackerTab';
import { InstaCrawlStatusTab } from '../components/instaRank/pages/InstaCrawlStatusTab';

// 인스타 대시보드 — 플레이스와 동일 구조(대시보드/관리시트 통합/순위/크롤 + 하위는 관리시트만).
function InstaRankPage() {
    return (
        <CategoryDashPage
            category="인스타"
            crawl={<InstaCrawlStatusTab />}
            dashboard={<InstaDashboardTab />}
            label="인스타"
            tracker={<InstaTrackerTab />}
        />
    );
}

export default InstaRankPage;
