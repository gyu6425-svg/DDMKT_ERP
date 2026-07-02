import { CategoryShell } from '../components/categoryRank/CategoryShell';
import { ContractSheetAuto } from '../components/categoryRank/ContractSheetTab';
import { CafeTrackerTab } from '../components/cafeRank/pages/CafeTrackerTab';
import { CafeCrawlStatusTab } from '../components/cafeRank/pages/CafeCrawlStatusTab';

// 카페 대시보드 — 대시보드/관리 시트는 계약 시트(1차)로 뿌림. 순위/크롤은 뼈대.
function CafeRankPage() {
    return (
        <CategoryShell
            badge="준비 중"
            label="카페 대시보드"
            tabs={[
                { name: '대시보드', el: <ContractSheetAuto /> },
                { name: '관리 시트', el: <ContractSheetAuto /> },
                { name: '순위 트래커', el: <CafeTrackerTab /> },
                { name: '크롤링 현황', el: <CafeCrawlStatusTab /> },
            ]}
        />
    );
}

export default CafeRankPage;
