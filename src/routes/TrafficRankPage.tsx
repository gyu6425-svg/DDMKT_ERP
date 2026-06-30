import { CategoryDashboardSkeleton } from '../components/categoryRank/CategoryDashboardSkeleton';
import { categoryByKey } from '../components/categoryRank/categories';

function TrafficRankPage() {
    return <CategoryDashboardSkeleton def={categoryByKey('traffic')} />;
}

export default TrafficRankPage;
