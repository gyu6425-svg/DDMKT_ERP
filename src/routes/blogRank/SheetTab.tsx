import { useMemo, useState } from 'react';
import { deleteBlogAccount, extractBlogId, type BlogAccount, type BlogPost } from '../../api/blogRank';
import { crawlBlog } from '../../api/crawlBlog';
import { lastM, progOf, PER_SHEET } from './helpers';
import { Pager, Tag } from './ui';
import { AccountEditModal } from './AccountEditModal';
import { ImportModal } from './ImportModal';
import { NoteModal } from './NoteModal';
import { openBlogReport } from './report';

export function SheetTab({
    accounts,
    posts,
    onReload,
    onToast,
    onGoTracker,
}: {
    accounts: BlogAccount[];
    posts: BlogPost[];
    onReload: () => Promise<void>;
    onToast: (message: string) => void;
    onGoTracker: () => void;
}) {
    const [q, setQ] = useState('');
    const [mgr, setMgr] = useState('');
    const [lowOnly, setLowOnly] = useState(false);
    const [sortKey, setSortKey] = useState<'remain' | 'prog'>('remain');
    const [sortDir, setSortDir] = useState(1);
    const [page, setPage] = useState(1);
    const [importOpen, setImportOpen] = useState(false);
    const [editAcc, setEditAcc] = useState<BlogAccount | null>(null);
    const [noteAcc, setNoteAcc] = useState<BlogAccount | null>(null);
    const [crawlingId, setCrawlingId] = useState<string | null>(null);

    // 서버리스 즉시 크롤 — 터미널 없이 이 블로그의 RSS+순위 측정·기록.
    const doCrawl = async (a: BlogAccount) => {
        setCrawlingId(a.id);
        onToast(`${a.name} 측정 중...`);
        try {
            const r = await crawlBlog(a.id);
            await onReload();
            const errNote = r.errors?.length ? ` (${r.errors.join(', ')})` : '';
            onToast(`${a.name} 측정 완료 · 글 ${r.postsMeasured} · 키워드 ${r.keywordsMeasured}${errNote}`);
        } catch (e) {
            onToast(`측정 실패: ${e instanceof Error ? e.message : ''}`);
        } finally {
            setCrawlingId(null);
        }
    };

    const [bulkBusy, setBulkBusy] = useState(false);
    // 일괄삭제 — 현재 표(필터 적용)에 보이는 업체를 한 번에 삭제(측정 이력 포함). 되돌릴 수 없음.
    const bulkDelete = async () => {
        const targets = filtered;
        if (!targets.length || bulkBusy) {
            return;
        }
        if (
            !window.confirm(
                `현재 목록의 ${targets.length}개 업체를 모두 삭제할까요?\n측정 이력까지 함께 삭제되며 되돌릴 수 없습니다.`,
            )
        ) {
            return;
        }
        setBulkBusy(true);
        onToast(`${targets.length}개 삭제 중...`);
        let failed = 0;
        for (const a of targets) {
            const { error } = await deleteBlogAccount(a.id);
            if (error) failed += 1;
        }
        await onReload();
        setBulkBusy(false);
        onToast(`삭제 완료 · ${targets.length - failed}개${failed ? ` (실패 ${failed})` : ''}`);
    };

    const [bulkCrawlBusy, setBulkCrawlBusy] = useState(false);
    const [crawlDone, setCrawlDone] = useState<{ ok: number; failed: number } | null>(null);
    // 전체 측정 — 현재 표(필터 적용)에 보이는 업체를 위에서부터 차례로 즉시 크롤(RSS+순위 측정).
    const bulkCrawl = async () => {
        const targets = filtered;
        if (!targets.length || bulkCrawlBusy) {
            return;
        }
        if (
            !window.confirm(
                `현재 목록의 ${targets.length}개 업체를 모두 측정할까요?\n순서대로 진행되며 시간이 다소 걸릴 수 있습니다.`,
            )
        ) {
            return;
        }
        setBulkCrawlBusy(true);
        let done = 0;
        let failed = 0;
        for (const a of targets) {
            setCrawlingId(a.id);
            onToast(`전체 측정 중... (${done + 1}/${targets.length}) ${a.name}`);
            try {
                await crawlBlog(a.id);
            } catch {
                failed += 1;
            }
            done += 1;
        }
        setCrawlingId(null);
        await onReload();
        setBulkCrawlBusy(false);
        setCrawlDone({ ok: done - failed, failed });
    };

    const managers = useMemo(
        () => [...new Set(accounts.map((a) => a.manager).filter(Boolean))] as string[],
        [accounts],
    );

    const postCountOf = (id: string) => posts.filter((p) => p.blog_account_id === id);

    const filtered = useMemo(() => {
        let list = accounts.filter(
            (a) =>
                (!q || a.name.includes(q)) &&
                (!mgr || a.manager === mgr) &&
                (!lowOnly || (a.remain_count != null && a.remain_count <= 3)),
        );
        list = [...list].sort((x, y) => {
            if (sortKey === 'prog') {
                return ((progOf(x) ?? -1) - (progOf(y) ?? -1)) * sortDir;
            }
            return ((x.remain_count ?? 999) - (y.remain_count ?? 999)) * sortDir;
        });
        return list;
    }, [accounts, q, mgr, lowOnly, sortKey, sortDir]);

    const pages = Math.max(1, Math.ceil(filtered.length / PER_SHEET));
    const current = Math.min(page, pages);
    const pageRows = filtered.slice((current - 1) * PER_SHEET, current * PER_SHEET);

    const toggleSort = (key: 'remain' | 'prog') => {
        if (sortKey === key) {
            setSortDir((d) => -d);
        } else {
            setSortKey(key);
            setSortDir(1);
        }
    };

    return (
        <div className="grid gap-3">
            {crawlDone ? (
                <div className="flex flex-wrap items-center gap-3 rounded-lg border border-[#a7f3d0] bg-[#ecfdf5] px-4 py-3">
                    <span className="text-lg">✅</span>
                    <div className="mr-auto">
                        <div className="text-sm font-bold text-[#065f46]">자동 측정이 완료되었습니다</div>
                        <div className="text-xs text-[#047857]">
                            {crawlDone.ok}개 측정 완료
                            {crawlDone.failed ? ` · 실패 ${crawlDone.failed}개` : ''} · 순위 트래커에서 결과를
                            확인하세요
                        </div>
                    </div>
                    <button
                        className="inline-flex h-9 items-center justify-center whitespace-nowrap rounded-md bg-[#059669] px-4 text-sm font-semibold text-white"
                        onClick={() => {
                            setCrawlDone(null);
                            onGoTracker();
                        }}
                        type="button"
                    >
                        순위 트래커 보러가기
                    </button>
                    <button
                        aria-label="닫기"
                        className="inline-flex h-9 w-9 items-center justify-center rounded-md text-[#047857] hover:bg-[#d1fae5]"
                        onClick={() => setCrawlDone(null)}
                        type="button"
                    >
                        ✕
                    </button>
                </div>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
                <input
                    className="h-9 min-w-[180px] flex-1 rounded-md border border-[#cbd5e1] bg-white px-3 text-sm"
                    onChange={(e) => {
                        setQ(e.target.value);
                        setPage(1);
                    }}
                    placeholder="업체명 검색..."
                    value={q}
                />
                <select
                    className="h-9 rounded-md border border-[#cbd5e1] bg-white px-2 text-xs"
                    onChange={(e) => {
                        setMgr(e.target.value);
                        setPage(1);
                    }}
                    value={mgr}
                >
                    <option value="">담당 전체</option>
                    {managers.map((m) => (
                        <option key={m}>{m}</option>
                    ))}
                </select>
                <label className="flex items-center gap-1 text-xs text-[#334155]">
                    <input checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} type="checkbox" />
                    잔여 3건 이하만
                </label>
                <span className="ml-auto text-xs text-[#64748b]">{filtered.length}개</span>
                <button
                    className="inline-flex h-9 items-center rounded-md bg-[#1e40af] px-3 text-xs font-semibold text-white"
                    onClick={() => setImportOpen(true)}
                    type="button"
                >
                    시트 붙여넣기 등록
                </button>
                <button
                    className="inline-flex h-9 items-center rounded-md bg-[#059669] px-3 text-xs font-semibold text-white hover:bg-[#047857] disabled:opacity-50"
                    disabled={bulkCrawlBusy || bulkBusy || filtered.length === 0}
                    onClick={() => void bulkCrawl()}
                    title="현재 목록의 모든 업체를 위에서부터 차례로 측정"
                    type="button"
                >
                    {bulkCrawlBusy ? '측정 중…' : '전체 측정'}
                </button>
                <button
                    className="inline-flex h-9 items-center rounded-md border border-[#fca5a5] bg-white px-3 text-xs font-semibold text-[#dc2626] disabled:opacity-50"
                    disabled={bulkBusy || bulkCrawlBusy || filtered.length === 0}
                    onClick={() => void bulkDelete()}
                    type="button"
                >
                    {bulkBusy ? '삭제 중…' : '일괄삭제'}
                </button>
            </div>

            <div className="overflow-x-auto rounded-md border border-[#e2e8f0] bg-white">
                <table className="w-full border-collapse text-left text-sm">
                    <thead>
                        <tr className="border-b-2 border-[#e2e8f0] bg-[#f1f5f9] text-[11px] text-[#64748b]">
                            <th className="px-3 py-2 font-semibold">업체</th>
                            <th className="px-3 py-2 font-semibold">담당</th>
                            <th className="px-3 py-2 font-semibold">기자단</th>
                            <th
                                className="cursor-pointer px-3 py-2 font-semibold"
                                onClick={() => toggleSort('prog')}
                            >
                                진행률 {sortKey === 'prog' ? (sortDir > 0 ? '▲' : '▼') : ''}
                            </th>
                            <th
                                className="cursor-pointer px-3 py-2 text-center font-semibold"
                                onClick={() => toggleSort('remain')}
                            >
                                잔여 {sortKey === 'remain' ? (sortDir > 0 ? '▲' : '▼') : ''}
                            </th>
                            <th className="px-3 py-2 text-center font-semibold">주 발행</th>
                            <th className="px-3 py-2 text-center font-semibold">추적 글</th>
                            <th className="px-3 py-2 text-center font-semibold">통합 10위↓</th>
                            <th className="px-3 py-2 text-center font-semibold">상태</th>
                            <th className="px-3 py-2 font-semibold">특이사항</th>
                            <th className="px-3 py-2 text-center font-semibold">관리</th>
                        </tr>
                    </thead>
                    <tbody>
                        {pageRows.length ? (
                            pageRows.map((a) => {
                                const p = progOf(a);
                                const myPosts = postCountOf(a.id);
                                const measured = myPosts.filter((x) => x.measurements.length);
                                const inTen = measured.filter((x) => (lastM(x)?.ti ?? 99) <= 10).length;
                                const pc = p == null ? '#94a3b8' : p >= 70 ? '#059669' : p >= 40 ? '#d97706' : '#dc2626';
                                return (
                                    <tr key={a.id} className="border-b border-[#e2e8f0]">
                                        <td className="px-3 py-2">
                                            <div className="font-semibold">{a.name}</div>
                                            <a
                                                className="text-[11px] text-[#94a3b8] hover:underline"
                                                href={a.blog_url}
                                                rel="noreferrer"
                                                target="_blank"
                                            >
                                                {a.blog_id || extractBlogId(a.blog_url)}
                                            </a>
                                            {a.contract_date || a.amount ? (
                                                <div className="mt-0.5 flex flex-wrap gap-1.5 text-[11px] text-[#64748b]">
                                                    {a.contract_date ? (
                                                        <span>📅 {a.contract_date}</span>
                                                    ) : null}
                                                    {a.amount ? (
                                                        <span className="font-semibold text-[#475569]">
                                                            💰 {a.amount}
                                                        </span>
                                                    ) : null}
                                                </div>
                                            ) : null}
                                        </td>
                                        <td className="px-3 py-2">
                                            {a.manager ? (
                                                <span className="rounded bg-[#f1f5f9] px-2 py-0.5 text-[11px] font-semibold text-[#475569]">
                                                    {a.manager}
                                                </span>
                                            ) : (
                                                <span className="text-xs text-[#94a3b8]">미지정</span>
                                            )}
                                        </td>
                                        <td className="px-3 py-2">
                                            {a.reporter ? (
                                                <span className="rounded bg-[#ede9fe] px-2 py-0.5 text-[11px] font-semibold text-[#6d28d9]">
                                                    {a.reporter}
                                                </span>
                                            ) : (
                                                <span className="text-xs text-[#94a3b8]">—</span>
                                            )}
                                        </td>
                                        <td className="px-3 py-2">
                                            {p == null ? (
                                                <span className="text-xs text-[#94a3b8]">계약건수 미입력</span>
                                            ) : (
                                                <div className="min-w-[120px]">
                                                    <div className="flex items-baseline justify-between gap-2">
                                                        <span className="text-sm font-bold" style={{ color: pc }}>
                                                            {p}%
                                                        </span>
                                                        <span className="text-[10px] text-[#94a3b8]">
                                                            {(a.goal_count || 0) - (a.remain_count || 0)}/{a.goal_count}건
                                                        </span>
                                                    </div>
                                                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[#eef2f7]">
                                                        <div style={{ background: pc, width: `${p}%`, height: '100%' }} />
                                                    </div>
                                                </div>
                                            )}
                                        </td>
                                        <td className="px-3 py-2 text-center">
                                            {a.remain_count == null ? (
                                                <span className="text-xs text-[#94a3b8]">—</span>
                                            ) : (
                                                <span
                                                    className="text-sm font-bold"
                                                    style={{ color: a.remain_count <= 3 ? '#dc2626' : '#0f172a' }}
                                                >
                                                    {a.remain_count}
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-3 py-2 text-center text-xs text-[#64748b]">
                                            {a.weekly || '—'}
                                        </td>
                                        <td className="px-3 py-2 text-center text-sm font-semibold">
                                            {myPosts.length}
                                        </td>
                                        <td className="px-3 py-2 text-center text-sm">
                                            {measured.length ? (
                                                <span className="font-semibold text-[#059669]">
                                                    {inTen}/{measured.length}
                                                </span>
                                            ) : (
                                                <span className="text-xs text-[#94a3b8]">—</span>
                                            )}
                                        </td>
                                        <td className="px-3 py-2 text-center">
                                            {!a.is_active ? (
                                                <Tag kind="stop">중단</Tag>
                                            ) : a.remain_count != null && a.remain_count <= 3 ? (
                                                <Tag kind="low">재계약 임박</Tag>
                                            ) : a.goal_count == null ? (
                                                <Tag kind="muted">정보 부족</Tag>
                                            ) : (
                                                <Tag kind="run">진행 중</Tag>
                                            )}
                                        </td>
                                        <td className="px-3 py-2">
                                            <div className="flex items-center gap-1">
                                                <span
                                                    className="block max-w-[140px] truncate text-xs text-[#94a3b8]"
                                                    title={a.note || ''}
                                                >
                                                    {a.note || '—'}
                                                </span>
                                                <button
                                                    className="shrink-0 rounded border border-[#cbd5e1] px-1.5 py-0.5 text-[10px] font-semibold text-[#475569] hover:bg-[#f1f5f9]"
                                                    onClick={() => setNoteAcc(a)}
                                                    title="특이사항 자세히 보기·수정"
                                                    type="button"
                                                >
                                                    자세히
                                                </button>
                                            </div>
                                        </td>
                                        <td className="px-3 py-2 text-center">
                                            <div className="flex justify-center gap-1">
                                                <button
                                                    className="rounded bg-[#059669] px-2 py-1 text-[11px] font-semibold text-white hover:bg-[#047857] disabled:opacity-50"
                                                    disabled={crawlingId === a.id || bulkCrawlBusy}
                                                    onClick={() => void doCrawl(a)}
                                                    title="터미널 없이 이 블로그 RSS+순위를 지금 측정"
                                                    type="button"
                                                >
                                                    {crawlingId === a.id ? '측정 중…' : '지금 측정'}
                                                </button>
                                                <button
                                                    className="rounded border border-[#cbd5e1] px-2 py-1 text-[11px] font-semibold text-[#475569] hover:bg-[#f1f5f9]"
                                                    onClick={() => setEditAcc(a)}
                                                    title="업체 정보·계정·특이사항 편집"
                                                    type="button"
                                                >
                                                    편집
                                                </button>
                                                <button
                                                    className="rounded bg-[#1e40af] px-2 py-1 text-[11px] font-semibold text-white hover:bg-[#1e3a8a]"
                                                    onClick={() => {
                                                        if (!openBlogReport(a, postCountOf(a.id))) {
                                                            onToast('팝업이 차단되었습니다. 팝업 허용 후 다시 시도하세요.');
                                                        }
                                                    }}
                                                    title="계약·현재 노출 순위 기반 성과 보고서(인쇄/PDF)"
                                                    type="button"
                                                >
                                                    성과
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })
                        ) : (
                            <tr>
                                <td className="px-3 py-12 text-center text-sm text-[#64748b]" colSpan={11}>
                                    등록된 블로그가 없습니다 · '시트 붙여넣기 등록'으로 추가하세요
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
                <Pager pages={pages} current={current} onGo={setPage} />
            </div>

            {importOpen ? (
                <ImportModal
                    existing={accounts}
                    onClose={() => setImportOpen(false)}
                    onReload={onReload}
                    onToast={onToast}
                />
            ) : null}

            {editAcc ? (
                <AccountEditModal
                    account={editAcc}
                    onClose={() => setEditAcc(null)}
                    onReload={onReload}
                    onToast={onToast}
                />
            ) : null}
            {noteAcc ? (
                <NoteModal
                    account={noteAcc}
                    onClose={() => setNoteAcc(null)}
                    onReload={onReload}
                    onToast={onToast}
                />
            ) : null}
        </div>
    );
}

// ───────────────────────── 특이사항 자세히 보기·수정 ─────────────────────────
