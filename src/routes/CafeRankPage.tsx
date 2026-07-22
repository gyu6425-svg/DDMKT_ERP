import { CategoryDashPage } from '../components/categoryRank/SkeletonRankPage';
import { CafeDashboardTab } from '../components/cafeRank/pages/CafeDashboardTab';
import { CafeTrackerTab } from '../components/cafeRank/pages/CafeTrackerTab';
import { CafeSheetTab } from '../components/cafeRank/pages/CafeSheetTab';
import { CafeCrawlStatusTab } from '../components/cafeRank/pages/CafeCrawlStatusTab';

// 카페 대시보드 — 플레이스와 동일 구조(대시보드/관리시트 통합/순위/크롤 + 하위는 관리시트만).
function CafeRankPage() {
    return (
        <CategoryDashPage
            category="카페"
            crawl={<CafeCrawlStatusTab />}
            dashboard={<CafeDashboardTab />}
            label="카페"
            sheet={<CafeSheetTab />}
            tracker={<CafeTrackerTab />}
        />
    );
}

export default CafeRankPage;
