import { CategoryShell } from '../components/categoryRank/CategoryShell';
import { ContractSheetAuto } from '../components/categoryRank/ContractSheetTab';
import { InstaDashboardTab } from '../components/instaRank/pages/InstaDashboardTab';
import { InstaTrackerTab } from '../components/instaRank/pages/InstaTrackerTab';
import { InstaCrawlStatusTab } from '../components/instaRank/pages/InstaCrawlStatusTab';

// 인스타 대시보드 — 관리 시트만 계약 시트(1차)로 뿌림. 대시보드/순위/크롤은 뼈대.
function InstaRankPage() {
    return (
        <CategoryShell
            badge="준비 중"
            label="인스타 대시보드"
            tabs={[
                { name: '대시보드', el: <InstaDashboardTab /> },
                { name: '관리 시트', el: <ContractSheetAuto /> },
                { name: '순위 트래커', el: <InstaTrackerTab /> },
                { name: '크롤링 현황', el: <InstaCrawlStatusTab /> },
            ]}
        />
    );
}

export default InstaRankPage;
