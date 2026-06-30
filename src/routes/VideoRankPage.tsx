import { CategoryDashboardSkeleton } from '../components/categoryRank/CategoryDashboardSkeleton';
import { categoryByKey } from '../components/categoryRank/categories';

function VideoRankPage() {
    return <CategoryDashboardSkeleton def={categoryByKey('video')} />;
}

export default VideoRankPage;
