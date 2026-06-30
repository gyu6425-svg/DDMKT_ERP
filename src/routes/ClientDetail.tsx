import type { BlogAccount } from '../api/blogRank';
import type { ErpClient } from '../api/erp';
import { amountTotal, currentField, fmtWon, latestContractDate, progOf } from '../components/blogRank/lib/helpers';

// 고객사 상세 — 업체 기본정보 + 계약한 카테고리(현재 블로그)의 세부(블로그 관리 시트 내용)를 읽기로 표시.
//   세부 편집은 카테고리 대시보드에서(같은 레코드라 자동 반영). 미입력이면 '신규 계약' 안내 + 이동 버튼.
function navTo(path: string) {
    if (window.location.pathname + window.location.search !== path) {
        window.history.pushState(null, '', path);
        window.dispatchEvent(new Event('app:navigate'));
    }
}

function Info({ label, value }: { label: string; value: string }) {
    return (
        <div>
            <div className="text-[11px] font-semibold text-[#94a3b8]">{label}</div>
            <div className="text-sm text-[#0f172a]">{value || '-'}</div>
        </div>
    );
}

export function ClientDetail({
    client,
    blogs,
    onClose,
}: {
    client: ErpClient;
    blogs: BlogAccount[];
    onClose: () => void;
}) {
    return (
        <section className="grid gap-4">
            <div className="flex items-center gap-3">
                <button
                    className="rounded-md border border-[#cbd5e1] bg-white px-3 py-1.5 text-sm font-semibold text-[#475569] hover:bg-[#f1f5f9]"
                    onClick={onClose}
                    type="button"
                >
                    ← 목록으로
                </button>
                <h2 className="m-0 text-[22px] font-semibold text-[#0f172a]">{client.company || '고객사'}</h2>
            </div>

            {/* 기본 정보 */}
            <div className="grid grid-cols-2 gap-4 rounded-xl border border-[#e2e8f0] bg-[#f8fafc] px-5 py-4 sm:grid-cols-4">
                <Info label="담당자" value={client.manager || ''} />
                <Info label="문의 경로" value={client.source || ''} />
                <Info label="연락처" value={client.contact || ''} />
                <Info label="이메일" value={client.email || ''} />
            </div>

            {/* 블로그 카테고리 세부 */}
            <div className="flex items-center gap-2">
                <h3 className="m-0 text-base font-bold text-[#0f172a]">블로그</h3>
                <button
                    className="rounded-md bg-[#1e40af] px-3 py-1 text-xs font-semibold text-white hover:bg-[#1e3a8a]"
                    onClick={() => navTo('/blog-rank?tab=sheet')}
                    type="button"
                >
                    블로그 대시보드 이동 →
                </button>
            </div>

            {blogs.length ? (
                blogs.map((b) => {
                    const prog = progOf(b);
                    const isNew = b.goal_count == null; // 계약 정보 미입력 = 신규 계약
                    return (
                        <div key={b.id} className="rounded-xl border border-[#e2e8f0] bg-white px-5 py-4">
                            <div className="mb-3 flex items-center gap-2">
                                <a
                                    className="text-sm font-bold text-[#0f172a] hover:text-[#1e40af] hover:underline"
                                    href={b.blog_url}
                                    rel="noreferrer"
                                    target="_blank"
                                >
                                    {b.name}
                                </a>
                                {isNew ? (
                                    <span className="rounded-full bg-[#fef3c7] px-2 py-0.5 text-[11px] font-bold text-[#b45309]">
                                        신규 계약 (세부 미입력)
                                    </span>
                                ) : (
                                    <span className="rounded-full bg-[#dcfce7] px-2 py-0.5 text-[11px] font-bold text-[#16a34a]">
                                        계약 중
                                    </span>
                                )}
                            </div>
                            {isNew ? (
                                <p className="m-0 text-sm text-[#64748b]">
                                    계약일·건수·금액 등 세부사항이 아직 입력되지 않았습니다. 위 ‘블로그 대시보드 이동’에서
                                    입력하세요.
                                </p>
                            ) : (
                                <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                                    <Info label="계약일" value={latestContractDate(b) || ''} />
                                    <Info
                                        label="진행률"
                                        value={
                                            prog == null
                                                ? '-'
                                                : `${prog}% (${(b.goal_count || 0) - (b.remain_count || 0)}/${b.goal_count}건)`
                                        }
                                    />
                                    <Info label="잔여" value={b.remain_count != null ? `${b.remain_count}건` : ''} />
                                    <Info label="계약금액" value={amountTotal(b) ? `${fmtWon(amountTotal(b))}원` : ''} />
                                    <Info label="기자단" value={currentField(b.reporter_history, b.reporter) || ''} />
                                    <Info label="주 발행" value={currentField(b.weekly_history, b.weekly) || ''} />
                                    <Info label="특이사항" value={b.note || ''} />
                                </div>
                            )}
                        </div>
                    );
                })
            ) : (
                <div className="rounded-xl border border-dashed border-[#cbd5e1] bg-[#f8fafc] px-5 py-10 text-center text-sm text-[#94a3b8]">
                    연결된 블로그 계정이 없습니다.
                </div>
            )}
        </section>
    );
}
