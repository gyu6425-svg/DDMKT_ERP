import { CategoryDashboardSkeleton } from '../components/categoryRank/CategoryDashboardSkeleton';
import { categoryByKey } from '../components/categoryRank/categories';

function CafeRankPage() {
    return <CategoryDashboardSkeleton def={categoryByKey('cafe')} />;
}

export default CafeRankPage;
