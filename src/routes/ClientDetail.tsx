import { useEffect, useState } from 'react';
import type { BlogAccount } from '../api/blogRank';
import type { ErpClient } from '../api/erp';
import { amountTotal, currentField, fmtWon, latestContractDate, progOf } from '../components/blogRank/lib/helpers';
import { AmountModal } from '../components/blogRank/components/AmountModal';
import { ContractModal } from '../components/blogRank/components/ContractModal';
import { FieldHistoryModal } from '../components/blogRank/components/FieldHistoryModal';
import { NoteModal } from '../components/blogRank/components/NoteModal';
import { ProgressModal } from '../components/blogRank/components/ProgressModal';
import { CATEGORIES, categoryByKey, type CategoryKey } from '../components/categoryRank/categories';
import { SOURCE_OPTIONS } from '../lib/erpUtils';

// 고객사 상세 — 업체 기본정보 + 계약한 카테고리(현재 블로그)의 세부(블로그 관리 시트 내용)를 읽기로 표시.
//   세부 편집은 카테고리 대시보드에서(같은 레코드라 자동 반영). 미입력이면 '신규 계약' 안내 + 이동 버튼.
function navTo(path: string) {
    if (window.location.pathname + window.location.search !== path) {
        window.history.pushState(null, '', path);
        window.dispatchEvent(new Event('app:navigate'));
    }
}

// 계약일·진행률·잔여·계약금액 등을 하나하나 카드로.
function MetricCard({
    label,
    value,
    accent,
    small,
    onClick,
}: {
    label: string;
    value: string;
    accent?: string;
    small?: boolean;
    onClick?: () => void;
}) {
    return (
        <button
            className="min-w-[130px] flex-1 rounded-xl border border-[#e2e8f0] bg-white px-4 py-3 text-left shadow-sm enabled:cursor-pointer enabled:hover:border-[#1e40af] enabled:hover:shadow"
            disabled={!onClick}
            onClick={onClick}
            type="button"
        >
            <div className="text-[11px] font-semibold text-[#94a3b8]">{label}</div>
            <div
                className={`mt-1 font-bold ${small ? 'text-sm' : 'text-lg'}`}
                style={{ color: accent || '#0f172a' }}
            >
                {value}
            </div>
        </button>
    );
}

const progColor = (p: number | null) =>
    p == null ? '#94a3b8' : p >= 70 ? '#059669' : p >= 40 ? '#d97706' : '#dc2626';

// 입력/선택으로 바로 수정되는 카드 — 기본정보(담당자·경로·연락처·이메일). 변경 시(블러/선택) onSave 호출.
function EditCard({
    label,
    value,
    options,
    onSave,
}: {
    label: string;
    value: string;
    options?: string[];
    onSave: (v: string) => void;
}) {
    const [v, setV] = useState(value);
    useEffect(() => setV(value), [value]);
    return (
        <div className="rounded-xl border border-[#e2e8f0] bg-white px-5 py-4 shadow-sm">
            <div className="mb-1.5 text-xs font-semibold text-[#94a3b8]">{label}</div>
            {options ? (
                <select
                    className="h-11 w-full rounded-md border border-[#cbd5e1] bg-white px-3 text-base font-medium text-[#0f172a]"
                    onChange={(e) => {
                        setV(e.target.value);
                        onSave(e.target.value);
                    }}
                    value={v}
                >
                    <option value="">선택 안 함</option>
                    {options.map((o) => (
                        <option key={o}>{o}</option>
                    ))}
                </select>
            ) : (
                <input
                    className="h-11 w-full rounded-md border border-[#cbd5e1] px-3 text-base font-medium text-[#0f172a]"
                    onBlur={() => v !== value && onSave(v)}
                    onChange={(e) => setV(e.target.value)}
                    placeholder="입력..."
                    value={v}
                />
            )}
        </div>
    );
}

export function ClientDetail({
    client,
    blogs,
    salespeople,
    onClose,
    onSave,
    onDelete,
    onReload,
    onToast,
}: {
    client: ErpClient;
    blogs: BlogAccount[];
    salespeople: { id: string; name: string }[];
    onClose: () => void;
    onSave: (patch: Partial<ErpClient>) => void;
    onDelete: () => void;
    onReload: () => Promise<void>;
    onToast: (message: string) => void;
}) {
    // 블로그 시트와 동일한 편집 모달 — 카드 클릭 시 그 계정으로 연다(편집·저장 동일).
    const [contractAcc, setContractAcc] = useState<BlogAccount | null>(null);
    const [amountAcc, setAmountAcc] = useState<BlogAccount | null>(null);
    const [progressAcc, setProgressAcc] = useState<BlogAccount | null>(null);
    const [reporterAcc, setReporterAcc] = useState<BlogAccount | null>(null);
    const [weeklyAcc, setWeeklyAcc] = useState<BlogAccount | null>(null);
    const [noteAcc, setNoteAcc] = useState<BlogAccount | null>(null);
    // 카테고리 탭(블로그=실제, 나머지=준비 중)
    const [tab, setTab] = useState<CategoryKey>('blog');
    const activeCat = categoryByKey(tab);
    const shortLabel = activeCat.label.replace(' 대시보드', '');
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
                <div className="flex-1" />
                <button
                    className="rounded-md border border-[#fca5a5] bg-white px-3 py-1.5 text-sm font-semibold text-[#dc2626] hover:bg-[#fef2f2]"
                    onClick={onDelete}
                    type="button"
                >
                    삭제
                </button>
            </div>

            {/* 기본 정보 — 각 카드에서 바로 수정 */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <EditCard
                    label="담당자"
                    onSave={(v) => onSave({ manager: v || null })}
                    options={[...new Set(([client.manager, ...salespeople.map((s) => s.name)].filter(Boolean) as string[]))]}
                    value={client.manager || ''}
                />
                <EditCard
                    label="문의 경로"
                    onSave={(v) => onSave({ source: v || null })}
                    options={SOURCE_OPTIONS}
                    value={client.source || ''}
                />
                <EditCard label="연락처" onSave={(v) => onSave({ contact: v || null })} value={client.contact || ''} />
                <EditCard label="이메일" onSave={(v) => onSave({ email: v || null })} value={client.email || ''} />
            </div>

            {/* 카테고리 탭 — 블로그=실제, 나머지=준비 중 */}
            <div className="flex flex-wrap gap-1 border-b border-[#e2e8f0]">
                {CATEGORIES.map((c) => {
                    const sl = c.label.replace(' 대시보드', '');
                    return (
                        <button
                            className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold ${
                                tab === c.key
                                    ? 'border-[#1e40af] text-[#1e40af]'
                                    : 'border-transparent text-[#94a3b8] hover:text-[#475569]'
                            }`}
                            key={c.key}
                            onClick={() => setTab(c.key)}
                            type="button"
                        >
                            {sl}
                        </button>
                    );
                })}
            </div>

            {/* 활성 카테고리 헤더 + 대시보드 이동 */}
            <div className="flex items-center gap-2">
                <h3 className="m-0 text-base font-bold text-[#0f172a]">{shortLabel}</h3>
                <button
                    className="rounded-md bg-[#1e40af] px-3 py-1 text-xs font-semibold text-white hover:bg-[#1e3a8a]"
                    onClick={() =>
                        navTo(
                            tab === 'blog'
                                ? `/blog-rank?tab=sheet&q=${encodeURIComponent(client.company || '')}`
                                : activeCat.path,
                        )
                    }
                    type="button"
                >
                    {shortLabel} 대시보드 이동 →
                </button>
            </div>

            {tab !== 'blog' ? (
                <div className="rounded-xl border border-dashed border-[#cbd5e1] bg-[#f8fafc] px-5 py-10 text-center text-sm text-[#94a3b8]">
                    {shortLabel} 카테고리는 준비 중입니다. (블로그와 동일한 구조로 추가 예정)
                </div>
            ) : blogs.length ? (
                blogs.map((b) => {
                    const prog = progOf(b);
                    const isNew = b.goal_count == null; // 계약 정보 미입력 = 신규 계약
                    return (
                        <div key={b.id} className="rounded-xl border border-[#e2e8f0] bg-[#f8fafc] px-5 py-4">
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
                                <>
                                    {/* 계약일·진행률·잔여·계약금액 — 하나하나 카드 */}
                                    <div className="flex flex-wrap gap-3">
                                        <MetricCard
                                            label="계약일"
                                            onClick={() => setContractAcc(b)}
                                            value={latestContractDate(b) || '-'}
                                        />
                                        <MetricCard
                                            accent={progColor(prog)}
                                            label="진행률"
                                            onClick={() => setProgressAcc(b)}
                                            value={
                                                prog == null
                                                    ? '-'
                                                    : `${prog}% · ${(b.goal_count || 0) - (b.remain_count || 0)}/${b.goal_count}건`
                                            }
                                        />
                                        <MetricCard
                                            accent={
                                                b.remain_count != null && b.remain_count <= 3 ? '#d97706' : undefined
                                            }
                                            label="잔여"
                                            onClick={() => setProgressAcc(b)}
                                            value={b.remain_count != null ? `${b.remain_count}건` : '-'}
                                        />
                                        <MetricCard
                                            label="계약금액"
                                            onClick={() => setAmountAcc(b)}
                                            value={amountTotal(b) ? `${fmtWon(amountTotal(b))}원` : '-'}
                                        />
                                    </div>
                                    {/* 기자단·주발행 — 카드(특이사항은 아래 계약 요약으로 이동) */}
                                    <div className="mt-3 flex flex-wrap gap-3">
                                        <MetricCard
                                            label="기자단"
                                            onClick={() => setReporterAcc(b)}
                                            small
                                            value={currentField(b.reporter_history, b.reporter) || '-'}
                                        />
                                        <MetricCard
                                            label="주 발행"
                                            onClick={() => setWeeklyAcc(b)}
                                            small
                                            value={currentField(b.weekly_history, b.weekly) || '-'}
                                        />
                                    </div>
                                </>
                            )}
                        </div>
                    );
                })
            ) : (
                <div className="rounded-xl border border-dashed border-[#cbd5e1] bg-[#f8fafc] px-5 py-10 text-center text-sm text-[#94a3b8]">
                    연결된 블로그 계정이 없습니다.
                </div>
            )}

            {/* 계약 요약 — 한눈에 보기(계약일·계약 건수·계약 금액·특이사항) */}
            <div className="overflow-hidden rounded-xl border border-[#e2e8f0] bg-white shadow-sm">
                <div className="border-b border-[#e2e8f0] bg-[#f8fafc] px-5 py-3 text-sm font-bold text-[#0f172a]">
                    계약 요약
                </div>
                {tab === 'blog' && blogs.length ? (
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-[#f1f5f9] text-left text-[12px] font-semibold text-[#94a3b8]">
                                <th className="px-5 py-2.5">업체(블로그)</th>
                                <th className="px-5 py-2.5">계약일</th>
                                <th className="px-5 py-2.5">계약 건수</th>
                                <th className="px-5 py-2.5">계약 금액</th>
                                <th className="px-5 py-2.5">특이사항</th>
                            </tr>
                        </thead>
                        <tbody>
                            {blogs.map((b) => (
                                <tr key={b.id} className="border-b border-[#f8fafc] last:border-0">
                                    <td className="px-5 py-3 font-semibold text-[#0f172a]">{b.name}</td>
                                    <td className="px-5 py-3 text-[#475569]">{latestContractDate(b) || '-'}</td>
                                    <td className="px-5 py-3 text-[#475569]">
                                        {b.goal_count != null ? `${b.goal_count}건` : '-'}
                                    </td>
                                    <td className="px-5 py-3 text-[#475569]">
                                        {amountTotal(b) ? `${fmtWon(amountTotal(b))}원` : '-'}
                                    </td>
                                    <td className="px-5 py-3">
                                        <button
                                            className="max-w-[260px] truncate rounded-md border border-[#e2e8f0] px-2.5 py-1 text-left text-[#475569] hover:border-[#1e40af] hover:text-[#1e40af]"
                                            onClick={() => setNoteAcc(b)}
                                            title={b.note || ''}
                                            type="button"
                                        >
                                            {b.note || '입력...'}
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                ) : (
                    <div className="px-5 py-8 text-center text-sm text-[#94a3b8]">{shortLabel} 계약 정보가 없습니다.</div>
                )}
            </div>

            {/* 블로그 시트와 동일한 편집 모달 — 카드 클릭 시 열림(저장 동일) */}
            {contractAcc ? (
                <ContractModal
                    account={contractAcc}
                    onClose={() => setContractAcc(null)}
                    onReload={onReload}
                    onToast={onToast}
                />
            ) : null}
            {amountAcc ? (
                <AmountModal
                    account={amountAcc}
                    onClose={() => setAmountAcc(null)}
                    onReload={onReload}
                    onToast={onToast}
                />
            ) : null}
            {progressAcc ? (
                <ProgressModal
                    account={progressAcc}
                    onClose={() => setProgressAcc(null)}
                    onReload={onReload}
                    onToast={onToast}
                />
            ) : null}
            {reporterAcc ? (
                <FieldHistoryModal
                    account={reporterAcc}
                    history={reporterAcc.reporter_history}
                    historyCol="reporter_history"
                    label="기자단"
                    legacyCol="reporter"
                    legacyValue={reporterAcc.reporter}
                    onClose={() => setReporterAcc(null)}
                    onReload={onReload}
                    onToast={onToast}
                    placeholder="예: A팀"
                />
            ) : null}
            {weeklyAcc ? (
                <FieldHistoryModal
                    account={weeklyAcc}
                    history={weeklyAcc.weekly_history}
                    historyCol="weekly_history"
                    label="주 발행"
                    legacyCol="weekly"
                    legacyValue={weeklyAcc.weekly}
                    onClose={() => setWeeklyAcc(null)}
                    onReload={onReload}
                    onToast={onToast}
                    placeholder="예: 주 5회"
                />
            ) : null}
            {noteAcc ? (
                <NoteModal account={noteAcc} onClose={() => setNoteAcc(null)} onReload={onReload} onToast={onToast} />
            ) : null}
        </section>
    );
}
