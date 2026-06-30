import type { BlogPost } from '../../api/blogRank';
import { blSearchUrl, tiSearchUrl } from './report';

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
    // 순위 클릭 → 측정에 쓴 바로 그 네이버 검색(m.search) 화면 열기. 키워드 없으면 링크 없음.
    const kw = (post.keyword_manual || post.keyword || '').trim();
    const url = kw ? (keyName === 'ti' ? tiSearchUrl(kw) : blSearchUrl(kw)) : '';
    const label = cur > 30 ? '권외' : `${cur}위`;
    return (
        <span>
            {url ? (
                <a
                    className="text-sm font-bold underline decoration-dotted underline-offset-2 hover:decoration-solid"
                    href={url}
                    rel="noopener noreferrer"
                    style={{ color }}
                    target="_blank"
                    title={`네이버 ${keyName === 'ti' ? '통합검색' : '블로그탭'}에서 '${kw}' 순위 확인`}
                >
                    {label}
                </a>
            ) : (
                <span className="text-sm font-bold" style={{ color }}>
                    {label}
                </span>
            )}
            {delta}
        </span>
    );
}

// 웹사이트(회사 단위) 순위 셀. 글 단위 RankCell 과 별개 — SheetTab(업체 표)에서만 사용.
// 신뢰도가 ti/bl 보다 낮아(webkr API 추정) 색상을 보라(#7c3aed)로 구분하고 배지를 단다.
