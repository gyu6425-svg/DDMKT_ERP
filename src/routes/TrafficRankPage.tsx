import { CategoryShell } from '../components/categoryRank/CategoryShell';
import { TrafficDashboardTab } from '../components/trafficRank/pages/TrafficDashboardTab';
import { TrafficSheetTab } from '../components/trafficRank/pages/TrafficSheetTab';
import { TrafficTrackerTab } from '../components/trafficRank/pages/TrafficTrackerTab';
import { TrafficCrawlStatusTab } from '../components/trafficRank/pages/TrafficCrawlStatusTab';

// 트래픽 대시보드 — 블로그와 동일 구조(공유 CategoryShell + 자기 탭 모듈). 탭 내용은 뼈대.
function TrafficRankPage() {
    return (
        <CategoryShell
            badge="준비 중"
            label="트래픽 대시보드"
            tabs={[
                { name: '대시보드', el: <TrafficDashboardTab /> },
                { name: '관리 시트', el: <TrafficSheetTab /> },
                { name: '순위 트래커', el: <TrafficTrackerTab /> },
                { name: '크롤링 현황', el: <TrafficCrawlStatusTab /> },
            ]}
        />
    );
}

export default TrafficRankPage;
