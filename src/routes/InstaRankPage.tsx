import { CategoryShell } from '../components/categoryRank/CategoryShell';
import { InstaDashboardTab } from '../components/instaRank/pages/InstaDashboardTab';
import { InstaSheetTab } from '../components/instaRank/pages/InstaSheetTab';
import { InstaTrackerTab } from '../components/instaRank/pages/InstaTrackerTab';
import { InstaCrawlStatusTab } from '../components/instaRank/pages/InstaCrawlStatusTab';

// 인스타 대시보드 — 블로그와 동일 구조(공유 CategoryShell + 자기 탭 모듈). 탭 내용은 뼈대.
function InstaRankPage() {
    return (
        <CategoryShell
            badge="준비 중"
            label="인스타 대시보드"
            tabs={[
                { name: '대시보드', el: <InstaDashboardTab /> },
                { name: '관리 시트', el: <InstaSheetTab /> },
                { name: '순위 트래커', el: <InstaTrackerTab /> },
                { name: '크롤링 현황', el: <InstaCrawlStatusTab /> },
            ]}
        />
    );
}

export default InstaRankPage;
