import type { BlogPost } from '../../api/blogRank';

export function RankCell({ post, keyName }: { post: BlogPost; keyName: 'ti' | 'bl' }) {
    if (!post.measurements.length) {
        return <span className="text-[11px] font-semibold text-[#d97706]">측정 대기</span>;
    }
    const cur = post.measurements[post.measurements.length - 1][keyName];
    const prev = post.measurements.length >= 2 ? post.measurements[post.measurements.length - 2][keyName] : null;
    const inTop = cur <= 10;
    const color = inTop ? (keyName === 'ti' ? '#059669' : '#1e40af') : '#94a3b8';
    let delta = <span className="block text-[10px] text-[#94a3b8]">첫 측정</span>;
    if (prev != null) {
        const diff = prev - cur;
        delta =
            diff > 0 ? (
                <span className="block text-[10px] font-bold text-[#dc2626]">▲{diff}</span>
            ) : diff < 0 ? (
                <span className="block text-[10px] font-bold text-[#1e40af]">▼{Math.abs(diff)}</span>
            ) : (
                <span className="block text-[10px] text-[#94a3b8]">—</span>
            );
    }
    return (
        <span>
            <span className="text-sm font-bold" style={{ color }}>
                {cur > 30 ? '권외' : `${cur}위`}
            </span>
            {delta}
        </span>
    );
}

// 웹사이트(회사 단위) 순위 셀. 글 단위 RankCell 과 별개 — SheetTab(업체 표)에서만 사용.
// 신뢰도가 ti/bl 보다 낮아(webkr API 추정) 색상을 보라(#7c3aed)로 구분하고 배지를 단다.
