import { CategoryDashboardSkeleton } from '../components/categoryRank/CategoryDashboardSkeleton';
import { categoryByKey } from '../components/categoryRank/categories';

function InstaRankPage() {
    return <CategoryDashboardSkeleton def={categoryByKey('insta')} />;
}

export default InstaRankPage;
