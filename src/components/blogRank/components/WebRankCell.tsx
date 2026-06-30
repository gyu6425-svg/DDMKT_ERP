import type { BlogAccount } from '../../../api/blogRank';
import { lastWe, prevWe } from '../lib/helpers';

export function WebRankCell({ account }: { account: BlogAccount }) {
    if (!account.website_url || !account.rep_keyword) {
        return <span className="text-xs text-[#94a3b8]">해당없음</span>;
    }
    const last = lastWe(account);
    if (!last) {
        return <span className="text-[11px] font-semibold text-[#d97706]">측정 대기</span>;
    }
    if (last.status === 'fail') {
        return (
            <span className="text-[11px] text-[#94a3b8]" title="측정 실패(API/네트워크). 진짜 권외와 다름.">
                측정 실패
            </span>
        );
    }
    if (last.status !== 'ok' || last.we > 30) {
        return (
            <span title="웹사이트 섹션 미노출 또는 권외 · webkr API 추정">
                <span className="text-sm font-bold text-[#94a3b8]">권외</span>
                <span className="block text-[10px] text-[#94a3b8]">미노출 포함</span>
            </span>
        );
    }
    const prev = prevWe(account);
    let delta = <span className="block text-[10px] text-[#94a3b8]">첫 측정</span>;
    if (prev && prev.status === 'ok') {
        const diff = prev.we - last.we;
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
        <span title="webkr API 추정 · 화면 순위와 다를 수 있음(신뢰도 낮음)">
            <span className="text-sm font-bold text-[#7c3aed]">{last.we}위</span>
            {delta}
        </span>
    );
}
