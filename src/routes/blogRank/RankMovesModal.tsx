import type { BlogPost } from '../../api/blogRank';
import { lastM, prevM } from './helpers';
import { Sparkline } from './Sparkline';

export type RankMove = { p: BlogPost; d: number };

// 순위 변동 한 줄 — 제목/업체/키워드 + 추이 그래프(초록=통합, 파랑=블로그) + 이전→현재 + ▲/▼.
export function RankMoveRow({ move, nameOf }: { move: RankMove; nameOf: (id: string) => string }) {
    const { p, d } = move;
    const prev = prevM(p);
    const last = lastM(p);
    const improved = d > 0; // 통합탭 순위 숫자 감소 = 상승
    return (
        <div className="flex items-center gap-3 rounded-lg border border-[#e2e8f0] bg-white px-3 py-2.5">
            <div className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-[#0f172a]">
                    {p.title || '제목 없음'}
                </span>
                <span className="block truncate text-xs text-[#94a3b8]">
                    {nameOf(p.blog_account_id)} · #{p.keyword_manual || p.keyword || '-'}
                </span>
            </div>
            <div className="hidden shrink-0 sm:block">
                <Sparkline post={p} />
            </div>
            <div className="flex w-[92px] shrink-0 flex-col items-end whitespace-nowrap">
                <span className="text-[11px] text-[#94a3b8]">
                    {prev?.ti}위 → <b className="text-[#0f172a]">{last?.ti}위</b>
                </span>
                <span className="text-base font-extrabold" style={{ color: improved ? '#dc2626' : '#1e40af' }}>
                    {improved ? `▲${d}` : `▼${Math.abs(d)}`}
                </span>
            </div>
        </div>
    );
}

// '더보기' — 최근 순위 변동 전체를 그래프와 함께. 잔여 3건 모달처럼 주변 블러 + 창.
export function RankMovesModal({
    moves,
    nameOf,
    onClose,
}: {
    moves: RankMove[];
    nameOf: (id: string) => string;
    onClose: () => void;
}) {
    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
            onMouseDown={(e) => e.target === e.currentTarget && onClose()}
        >
            <div className="flex max-h-[88vh] w-[min(680px,96vw)] flex-col rounded-2xl bg-white p-6">
                <h3 className="m-0 text-lg font-bold text-[#0f172a]">최근 순위 변동 · 전체 {moves.length}건</h3>
                <p className="mt-1 mb-3 text-sm text-[#64748b]">
                    이전 크롤 대비 통합탭 순위가 2 이상 바뀐 글 (변동 큰 순) · 초록=통합탭, 파랑=블로그탭 추이
                </p>
                <div className="grid gap-2 overflow-y-auto">
                    {moves.length ? (
                        moves.map((m) => <RankMoveRow key={m.p.id} move={m} nameOf={nameOf} />)
                    ) : (
                        <p className="m-0 py-10 text-center text-sm text-[#94a3b8]">변동이 없습니다.</p>
                    )}
                </div>
                <div className="mt-4 flex justify-end">
                    <button
                        className="rounded-md border border-[#cbd5e1] px-4 py-2 text-sm font-semibold text-[#64748b]"
                        onClick={onClose}
                        type="button"
                    >
                        닫기
                    </button>
                </div>
            </div>
        </div>
    );
}
