import { CategoryShell } from '../components/categoryRank/CategoryShell';
import { VideoDashboardTab } from '../components/videoRank/pages/VideoDashboardTab';
import { VideoSheetTab } from '../components/videoRank/pages/VideoSheetTab';
import { VideoTrackerTab } from '../components/videoRank/pages/VideoTrackerTab';
import { VideoCrawlStatusTab } from '../components/videoRank/pages/VideoCrawlStatusTab';

// 영상 대시보드 — 블로그와 동일 구조(공유 CategoryShell + 자기 탭 모듈). 탭 내용은 뼈대.
function VideoRankPage() {
    return (
        <CategoryShell
            badge="준비 중"
            label="영상 대시보드"
            tabs={[
                { name: '대시보드', el: <VideoDashboardTab /> },
                { name: '관리 시트', el: <VideoSheetTab /> },
                { name: '순위 트래커', el: <VideoTrackerTab /> },
                { name: '크롤링 현황', el: <VideoCrawlStatusTab /> },
            ]}
        />
    );
}

export default VideoRankPage;
