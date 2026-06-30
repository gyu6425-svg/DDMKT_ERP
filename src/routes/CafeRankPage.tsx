import { CategoryShell } from '../components/categoryRank/CategoryShell';
import { CafeDashboardTab } from '../components/cafeRank/pages/CafeDashboardTab';
import { CafeSheetTab } from '../components/cafeRank/pages/CafeSheetTab';
import { CafeTrackerTab } from '../components/cafeRank/pages/CafeTrackerTab';
import { CafeCrawlStatusTab } from '../components/cafeRank/pages/CafeCrawlStatusTab';

// 카페 대시보드 — 블로그와 동일 구조(공유 CategoryShell + 자기 탭 모듈). 탭 내용은 뼈대.
function CafeRankPage() {
    return (
        <CategoryShell
            badge="준비 중"
            label="카페 대시보드"
            tabs={[
                { name: '대시보드', el: <CafeDashboardTab /> },
                { name: '관리 시트', el: <CafeSheetTab /> },
                { name: '순위 트래커', el: <CafeTrackerTab /> },
                { name: '크롤링 현황', el: <CafeCrawlStatusTab /> },
            ]}
        />
    );
}

export default CafeRankPage;
