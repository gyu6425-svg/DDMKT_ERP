import { CategoryDashPage } from '../components/categoryRank/SkeletonRankPage';
import { CafeDashboardTab } from '../components/cafeRank/pages/CafeDashboardTab';
import { CafeTrackerTab } from '../components/cafeRank/pages/CafeTrackerTab';
import { CafeSheetTab } from '../components/cafeRank/pages/CafeSheetTab';
import { CafeCrawlStatusTab } from '../components/cafeRank/pages/CafeCrawlStatusTab';
import { CafeAdminPublishTab } from '../components/cafeRank/pages/CafeAdminPublishTab';

// 카페 대시보드 — 플레이스와 동일 구조. '카페 배포' 하위 = 관리시트 + 순위트래커 + 자동화 발행 + 크롤링 현황.
function CafeRankPage() {
    return (
        <CategoryDashPage
            category="카페"
            crawl={<CafeCrawlStatusTab />}
            dashboard={<CafeDashboardTab />}
            label="카페"
            sheet={<CafeSheetTab />}
            tracker={<CafeTrackerTab />}
            automation={<CafeAdminPublishTab />}
        />
    );
}

export default CafeRankPage;
