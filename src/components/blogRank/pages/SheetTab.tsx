import { useEffect, useMemo, useState } from 'react';
import {
    deleteBlogAccount,
    getReporters,
    todayKST,
    updateBlogAccount,
    type BlogAccount,
    type ReporterProfile,
} from '../../../api/blogRank';
import CustomerAccountModal from '../../CustomerAccountModal';
import { ReporterManageModal } from '../components/ReporterManageModal';
import { crawlBlog } from '../../../api/crawlBlog';
import { amountTotal, currentField, fmtWon, isRenewalImminent, lastM, progOf, PER_SHEET, renewLevel } from '../lib/helpers';
import { NEW_CONTRACT_CUTOFF_MS, NEW_CONTRACT_TTL_MS } from '../../../lib/erpUtils';
import { Pager, Tag } from '../lib/ui';
import { useBlogRank } from '../lib/BlogRankContext';
import { AccountEditModal } from '../components/AccountEditModal';
import { GuideAddForm } from '../components/GuideAddForm';
import { FieldHistoryModal } from '../components/FieldHistoryModal';
import { ImportModal } from '../components/ImportModal';
import { NoteModal } from '../components/NoteModal';
import { ProgressModal } from '../components/ProgressModal';
import { openBlogReport } from '../lib/report';
import { BlogPerformanceModal } from '../components/BlogPerformanceModal';
import { ReporterMaterialsModal } from '../components/ReporterMaterialsModal';
import { useAuth } from '../../../hooks/useAuth';
import { getClients } from '../../../api/erp';
import { downloadCsv, todayTag } from '../../../lib/exportCsv';

export function SheetTab() {
    const {
        accounts,
        posts,
        reload: onReload,
        showToast: onToast,
        goCrawl: onGoCrawl,
        goTrackerBlog: onGoTrackerBlog,
        sheetQ: initialQ,
        customerMode,
        reporterMode,
    } = useBlogRank();
    const { isAdmin } = useAuth(); // 기자단 계정 삭제(관리)는 관리자만
    const [q, setQ] = useState(initialQ);
    // 대시보드 '재계약 임박' 블로그 클릭으로 진입하면 그 업체명으로 검색 채움(마운트 타이밍 무관).
    //   ※ 키 입력마다 컨텍스트(setSheetQ)를 갱신하면 Provider 전체가 매 키 리렌더돼 한글 IME 조합이
    //     끊긴다(느린 PC에서 '썼다 지웠다'). 그래서 로컬 q 만 쓰고 컨텍스트 역동기화는 하지 않는다.
    useEffect(() => {
        if (initialQ) setQ(initialQ);
    }, [initialQ]);
    const [mgr, setMgr] = useState('');
    const [lowOnly, setLowOnly] = useState(false);
    const [sortKey, setSortKey] = useState<'remain' | 'prog' | 'date'>('date'); // 기본=계약일 최신순
    const [sortDir, setSortDir] = useState(1);
    const [monthFilter, setMonthFilter] = useState(0); // 0=전체, 1~12=해당 월(계약일 기준)
    const [tab, setTab] = useState<'active' | 'new' | 'nourl' | 'ext' | 'hold' | 'ended'>('active'); // 계약 중 / 신규 / URL미입력 / 연장 건 / 보류 / 계약 종료
    const [page, setPage] = useState(1);
    const [importOpen, setImportOpen] = useState(false);
    const [editAcc, setEditAcc] = useState<BlogAccount | null>(null);
    const [noteAcc, setNoteAcc] = useState<BlogAccount | null>(null);
    const [weeklyAcc, setWeeklyAcc] = useState<BlogAccount | null>(null);
    const [reporterAcc, setReporterAcc] = useState<BlogAccount | null>(null);
    const [historyAcc, setHistoryAcc] = useState<BlogAccount | null>(null); // 지난 기자단 이력 모달
    const [reportAcc, setReportAcc] = useState<BlogAccount | null>(null); // 성과 보고서 글 선택 모달
    const [materialsAcc, setMaterialsAcc] = useState<BlogAccount | null>(null); // 기자단 자료 받기 모달
    const [progressAcc, setProgressAcc] = useState<BlogAccount | null>(null);
    const [crawlingId, setCrawlingId] = useState<string | null>(null);
    // 기자단(개인) 계정 목록 + 발급 대상 블로그 — 담당 기자단 지정 드롭다운/발급용(내부 전용).
    //   발급은 '이 블로그(업체) 담당' 맥락에서 → 발급 성공 시 그 블로그에 자동 배정.
    const [reporters, setReporters] = useState<ReporterProfile[]>([]);
    const [issueForBlog, setIssueForBlog] = useState<BlogAccount | null>(null);
    const [reporterManageOpen, setReporterManageOpen] = useState(false);
    // 동명이인 구분용 라벨 — 이름 + 이메일 앞부분(이메일은 고유).
    const reporterLabel = (r: ReporterProfile) =>
        `${r.name || '이름없음'} (${(r.email || '').split('@')[0]})`;
    useEffect(() => {
        if (customerMode) return; // 외부(고객/기자단)는 발급/지정 없음
        void getReporters().then(({ data }) => setReporters(data));
    }, [customerMode]);
    // 거래처명(client_partner) 표시용 — 블로그 client_id → 고객사 거래처명 매핑.
    const [partnerById, setPartnerById] = useState<Record<string, string>>({});
    useEffect(() => {
        if (customerMode || reporterMode) return; // 내부 뷰에서만 거래처명 컬럼 노출
        void getClients().then(({ data }) => {
            const m: Record<string, string> = {};
            for (const c of data) if (c.client_partner) m[c.id] = c.client_partner;
            setPartnerById(m);
        });
    }, [customerMode, reporterMode]);
    // 담당 기자단(계정) 지정 → blog_accounts.reporter_id. 이 블로그가 그 기자단 ERP에 보이게 됨.
    const assignReporter = async (a: BlogAccount, reporterId: string) => {
        const rid = reporterId || null;
        const { error } = await updateBlogAccount(a.id, { reporter_id: rid });
        if (error) {
            onToast('담당 기자단 지정 실패: ' + error.message);
            return;
        }
        await onReload();
        onToast(rid ? '담당 기자단 지정됨' : '담당 기자단 해제됨');
    };

    // 서버리스 즉시 크롤 — 터미널 없이 이 블로그의 RSS+순위 측정·기록.
    const doCrawl = async (a: BlogAccount) => {
        setCrawlingId(a.id);
        onToast(`${a.name} 측정 중...`);
        try {
            // 서버는 한 번에 일부 글만 측정(한도) → 남은 글(postsRemaining)이 0이 될 때까지 재호출로 마저 채움.
            let r = await crawlBlog(a.id);
            let totalPosts = r.postsMeasured;
            for (let pass = 1; r.postsRemaining > 0 && pass < 6; pass += 1) {
                onToast(`${a.name} 측정 중... (남은 글 ${r.postsRemaining}개)`);
                r = await crawlBlog(a.id);
                totalPosts += r.postsMeasured;
            }
            await onReload();
            const errNote = r.errors?.length ? ` (${r.errors.join(', ')})` : '';
            onToast(`${a.name} 측정 완료 · 글 ${totalPosts} · 키워드 ${r.keywordsMeasured}${errNote}`);
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

    const managers = useMemo(
        () => [...new Set(accounts.map((a) => a.manager).filter(Boolean))] as string[],
        [accounts],
    );

    const postCountOf = (id: string) => posts.filter((p) => p.blog_account_id === id);
    // 이 블로그의 최신 발행 날짜(추적 글 중 가장 늦은 published_date) — 없으면 null.
    const latestPubOf = (id: string): string | null => {
        let best: string | null = null;
        for (const p of posts) {
            if (p.blog_account_id !== id) continue;
            const d = (p.published_date || '').slice(0, 10);
            if (d && (!best || d > best)) best = d;
        }
        return best;
    };

    // 실제 네이버 블로그 URL(http로 시작)이 아직 없는 계정 = 발행 URL 미입력 → 'URL미입력 건' 탭.
    const isUrlPending = (a: BlogAccount) => !/^https?:\/\//.test((a.blog_url || '').trim());
    // 보류 — note 마커 '[보류]'로 표시(별도 컬럼 없이, '자사 관리' 배지와 동일 패턴). 계약 편집에서 토글.
    const isHold = (a: BlogAccount) => (a.note || '').includes('[보류]');
    // 연장 건 — 재계약 시 note '[연장:날짜]' 마커. 그날 당일만 '연장 건' 탭에 노출, 다음날부터 자동으로 계약 중 탭.
    //   기준일 = 마커에 심긴 날짜(KST). 구형 날짜없는 '[연장]'은 만료로 간주(계약 중).
    const isExt = (a: BlogAccount) => {
        const m = (a.note || '').match(/\[연장:(\d{4}-\d{2}-\d{2})\]/);
        return !!m && m[1] === todayKST();
    };
    // 특이사항 표시용 — 연장 마커는 내부용이라 화면에선 숨김(만료 후 노트에 남아 누적되는 것 방지).
    const displayNote = (note: string | null) =>
        (note || '').replace(/\[연장(:\d{4}-\d{2}-\d{2})?\]\s*/g, '').trim();
    // 최근 처음 등록 = 컷오프 이후 생성 + 24h 이내(방금 계약 관리에서 등록). 계약 종료 아닌 것만.
    const isRecent = (a: BlogAccount) => {
        const t = a.created_at ? Date.parse(a.created_at) : NaN;
        return !Number.isNaN(t) && t > NEW_CONTRACT_CUTOFF_MS && Date.now() - t < NEW_CONTRACT_TTL_MS;
    };
    // 각 탭 소속 판정(종료·보류·연장 우선 → URL미입력 → 신규(최근 처음 등록·URL 있음) → 계약 중). 상호 배타.
    const tabOf = (a: BlogAccount): 'ended' | 'hold' | 'ext' | 'nourl' | 'new' | 'active' => {
        if (a.contract_ended_at) return 'ended';
        if (isHold(a)) return 'hold';
        if (isExt(a)) return 'ext';
        if (isUrlPending(a)) return 'nourl';
        if (isRecent(a)) return 'new';
        return 'active';
    };

    // 계약일 월 옵션 — 전체 + 계약일에 존재하는 월(내림차순).
    const monthOptions = useMemo(() => {
        const s = new Set<number>();
        for (const a of accounts) {
            const m = Number((a.contract_date || '').slice(5, 7));
            if (m) s.add(m);
        }
        return [...s].sort((a, b) => b - a);
    }, [accounts]);

    const filtered = useMemo(() => {
        let list = accounts.filter(
            (a) =>
                (!q || a.name.includes(q)) &&
                (!mgr || a.manager === mgr) &&
                (!lowOnly || (a.remain_count != null && a.remain_count <= 5)) &&
                (!monthFilter || Number((a.contract_date || '').slice(5, 7)) === monthFilter) &&
                tabOf(a) === tab,
        );
        list = [...list].sort((x, y) => {
            if (sortKey === 'prog') {
                return ((progOf(x) ?? -1) - (progOf(y) ?? -1)) * sortDir;
            }
            if (sortKey === 'remain') {
                return ((x.remain_count ?? 999) - (y.remain_count ?? 999)) * sortDir;
            }
            // 계약일 최신순(기본).
            return String(y.contract_date || '').localeCompare(String(x.contract_date || ''));
        });
        return list;
    }, [accounts, q, mgr, lowOnly, monthFilter, sortKey, sortDir, tab]);

    // 탭별 개수(현재 업체명·담당 검색 범위 기준). 계약 중 / 신규 / URL미입력 / 보류 / 계약 종료.
    const tabCounts = useMemo(() => {
        const c = { active: 0, new: 0, nourl: 0, ext: 0, hold: 0, ended: 0 };
        for (const a of accounts) {
            if (q && !a.name.includes(q)) continue;
            if (mgr && a.manager !== mgr) continue;
            c[tabOf(a)] += 1;
        }
        return c;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [accounts, q, mgr]);

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

    // 현재 필터(탭·검색·담당·월)로 보이는 블로그를 엑셀(CSV)로 내보내기.
    const TAB_LABEL: Record<string, string> = { active: '계약 중', new: '신규 등록', nourl: 'URL미입력', ext: '연장', hold: '보류', ended: '계약 종료' };
    const exportExcel = () => {
        const headers = ['업체', '거래처명', '발행 블로그 URL', '최근 발행 날짜', '계약금액', '담당', '진행률(%)', '잔여', '상태', '특이사항'];
        const data = filtered.map((a) => [
            a.name || '',
            partnerById[a.client_id || ''] || '',
            a.blog_url || '',
            latestPubOf(a.id) || '',
            amountTotal(a) || '',
            a.manager || '',
            progOf(a) ?? '',
            a.remain_count ?? '',
            TAB_LABEL[tabOf(a)] || '',
            displayNote(a.note).replace(/\s+/g, ' ').trim(),
        ]);
        downloadCsv(`브랜드블로그_관리시트_${todayTag()}`, headers, data);
    };

    return (
        <div className="grid gap-3">
            {/* 업체 추가 폼 — 고객 ERP에선 숨김(조회 전용) */}
            {!customerMode && <GuideAddForm onReload={onReload} onToast={onToast} />}
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
                        setMonthFilter(Number(e.target.value));
                        setPage(1);
                    }}
                    title="계약일 월별 필터"
                    value={monthFilter}
                >
                    <option value={0}>전체 기간</option>
                    {monthOptions.map((m) => (
                        <option key={m} value={m}>
                            {m}월
                        </option>
                    ))}
                </select>
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
                    잔여 5건 이하만
                </label>
                <span className="ml-auto text-xs text-[#64748b]">{filtered.length}개</span>
                {/* 내부 액션(등록/전체측정/일괄삭제) — 고객 ERP에선 숨김(조회 전용) */}
                {!customerMode && (
                    <>
                        {isAdmin ? (
                            <button
                                className="inline-flex h-9 items-center rounded-md border border-[#6d28d9] px-3 text-xs font-semibold text-[#6d28d9] hover:bg-[#f5f3ff]"
                                onClick={() => setReporterManageOpen(true)}
                                title="발급된 기자단 계정 관리·삭제(관리자)"
                                type="button"
                            >
                                기자단 계정 관리
                            </button>
                        ) : null}
                        <button
                            className="inline-flex h-9 items-center rounded-md border border-[#059669] bg-white px-3 text-xs font-bold text-[#059669] hover:bg-[#ecfdf5] disabled:opacity-50"
                            disabled={!filtered.length}
                            onClick={exportExcel}
                            title="현재 목록을 엑셀(CSV)로 내려받기"
                            type="button"
                        >
                            ⬇ 엑셀
                        </button>
                        <button
                            className="inline-flex h-9 items-center rounded-md bg-[#1e40af] px-3 text-xs font-semibold text-white"
                            onClick={() => setImportOpen(true)}
                            type="button"
                        >
                            시트 붙여넣기 등록
                        </button>
                        <button
                            className="inline-flex h-9 items-center rounded-md bg-[#059669] px-3 text-xs font-semibold text-white hover:bg-[#047857]"
                            onClick={onGoCrawl}
                            title="크롤링 현황 페이지로 이동 — 전체 측정 시작/진행률 확인"
                            type="button"
                        >
                            전체 측정
                        </button>
                        <button
                            className="inline-flex h-9 items-center rounded-md border border-[#fca5a5] bg-white px-3 text-xs font-semibold text-[#dc2626] disabled:opacity-50"
                            disabled={bulkBusy || filtered.length === 0}
                            onClick={() => void bulkDelete()}
                            type="button"
                        >
                            {bulkBusy ? '삭제 중…' : '일괄삭제'}
                        </button>
                    </>
                )}
            </div>

            {/* 신규 등록 건 / 계약 중 / 계약 종료 탭 — 업체명 검색 밑. 고객 ERP에선 숨김(계약 중만 노출). */}
            <div className={`flex gap-1 border-b border-[#e2e8f0] ${customerMode ? 'hidden' : ''}`}>
                {([
                    ['new', '신규 등록 건', tabCounts.new],
                    ['nourl', 'URL미입력 건', tabCounts.nourl],
                    ['ext', '연장 건', tabCounts.ext],
                    ['active', '계약 중', tabCounts.active],
                    ['hold', '보류', tabCounts.hold],
                    ['ended', '계약 종료', tabCounts.ended],
                ] as const).map(([key, label, n]) => {
                    const hot = (key === 'new' || key === 'nourl' || key === 'ext') && n > 0;
                    return (
                        <button
                            key={key}
                            className={`-mb-px rounded-t-md border-b-2 px-4 py-2 text-sm font-bold ${
                                tab === key
                                    ? 'border-[#1e40af] text-[#1e40af]'
                                    : `border-transparent hover:text-[#475569] ${hot ? 'text-[#1e40af]' : 'text-[#94a3b8]'}`
                            }`}
                            onClick={() => {
                                setTab(key);
                                setPage(1);
                            }}
                            type="button"
                        >
                            {hot ? '🔵 ' : ''}
                            {label} <span className="text-xs font-semibold">({n})</span>
                        </button>
                    );
                })}
            </div>

            {tab === 'ended' ? (
                <div className="overflow-x-auto rounded-md border border-[#e2e8f0] bg-white">
                    <table className="w-full border-collapse text-left text-sm">
                        <thead>
                            <tr className="border-b-2 border-[#e2e8f0] bg-[#f1f5f9] text-[11px] text-[#64748b]">
                                <th className="px-3 py-2 font-semibold">업체</th>
                                <th className="px-3 py-2 font-semibold">발행 블로그</th>
                                <th className="px-3 py-2 font-semibold">이전 계약 일</th>
                                <th className="px-3 py-2 font-semibold">담당</th>
                                <th className="px-3 py-2 font-semibold">특이사항</th>
                            </tr>
                        </thead>
                        <tbody>
                            {pageRows.length ? (
                                pageRows.map((a) => (
                                    <tr key={a.id} className="border-b border-[#e2e8f0] hover:bg-[#f8fafc]">
                                        <td className="px-3 py-2 text-[13px] font-semibold text-[#0f172a]">{a.name}</td>
                                        <td className="px-3 py-2">
                                            {a.blog_url ? (
                                                <a
                                                    className="text-[13px] text-[#1d4ed8] hover:underline"
                                                    href={a.blog_url}
                                                    rel="noopener noreferrer"
                                                    target="_blank"
                                                >
                                                    {a.blog_url}
                                                </a>
                                            ) : (
                                                '—'
                                            )}
                                        </td>
                                        <td className="px-3 py-2 text-[13px] font-semibold text-[#475569]">
                                            {a.contract_date || '—'}
                                        </td>
                                        <td className="px-3 py-2 text-[13px] text-[#475569]">{a.manager || '—'}</td>
                                        <td className="px-3 py-2">
                                            <button
                                                className="block max-w-[320px] truncate text-left text-[13px] text-[#475569] hover:text-[#1e40af]"
                                                onClick={() => setNoteAcc(a)}
                                                title="특이사항 편집(히스토리)"
                                                type="button"
                                            >
                                                {displayNote(a.note) || <span className="text-[#94a3b8]">+ 특이사항 남기기</span>}
                                            </button>
                                        </td>
                                    </tr>
                                ))
                            ) : (
                                <tr>
                                    <td className="px-3 py-10 text-center text-sm text-[#94a3b8]" colSpan={5}>
                                        계약 종료된 업체가 없습니다.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                    <Pager pages={pages} current={current} onGo={setPage} />
                </div>
            ) : (
            <div className="overflow-x-auto rounded-md border border-[#e2e8f0] bg-white">
                <table className="w-full border-collapse text-left text-sm">
                    <thead>
                        <tr className="border-b-2 border-[#e2e8f0] bg-[#f1f5f9] text-[11px] text-[#64748b]">
                            <th className="px-3 py-2 font-semibold">업체</th>
                            {/* 거래처명(client_partner) — 내부 뷰에서만. 계약일은 시트에서 숨김(계약 편집에서만 표시). */}
                            {!customerMode && !reporterMode && <th className="px-3 py-2 font-semibold">거래처명</th>}
                            {!customerMode && <th className="whitespace-nowrap px-1.5 py-2 font-semibold">최근 발행</th>}
                            {!customerMode && <th className="px-3 py-2 font-semibold">계약금액</th>}
                            {!reporterMode && <th className="px-3 py-2 font-semibold">담당</th>}
                            {!customerMode && <th className="px-3 py-2 font-semibold">기자단</th>}
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
                            {!reporterMode && <th className="px-3 py-2 text-center font-semibold">주 발행</th>}
                            <th className="px-3 py-2 text-center font-semibold">추적 글</th>
                            <th className="px-3 py-2 text-center font-semibold">통합 10위↓</th>
                            {!customerMode && (
                                <>
                                    <th className="px-3 py-2 text-center font-semibold">상태</th>
                                    <th className="px-3 py-2 font-semibold">특이사항</th>
                                    <th className="px-3 py-2 text-center font-semibold">구글 시트</th>
                                    <th className="px-3 py-2 text-center font-semibold">관리</th>
                                </>
                            )}
                            {/* 고객 뷰: 맨 뒤 성과 컬럼(저장,발행 성과 + 순위 성과) */}
                            {customerMode && <th className="px-3 py-2 text-center font-semibold">성과</th>}
                        </tr>
                    </thead>
                    <tbody>
                        {pageRows.length ? (
                            pageRows.map((a) => {
                                const p = progOf(a);
                                const myPosts = postCountOf(a.id);
                                const measured = myPosts.filter((x) => x.measurements.length);
                                const inTen = measured.filter((x) => (lastM(x)?.ti ?? 99) <= 10).length;
                                // 오늘 '모든 글'을 '실패 없이' 측정했으면 지금 측정 비활성화(재측정 불필요).
                                const today = todayKST();
                                const fullyDone =
                                    myPosts.length > 0 &&
                                    myPosts.every((x) => {
                                        const m = x.measurements.find((mm) => mm.date === today);
                                        return m && m.ti_status !== 'fail' && m.bl_status !== 'fail';
                                    });
                                const pc = p == null ? '#94a3b8' : p >= 70 ? '#059669' : p >= 40 ? '#d97706' : '#dc2626';
                                return (
                                    <tr
                                        key={a.id}
                                        className="cursor-pointer border-b border-[#e2e8f0] [&>td]:py-4 hover:bg-[#f8fafc]"
                                        onClick={(e) => {
                                            // 버튼/링크/입력 등은 각자 동작, 빈 곳만 트래커로 이동.
                                            if ((e.target as HTMLElement).closest('button, a, input, select, label')) return;
                                            onGoTrackerBlog(a.id);
                                        }}
                                        title="빈 곳 클릭 → 순위 트래커에서 이 업체만 보기"
                                    >
                                        <td className="px-3 py-2">
                                            <a
                                                className="font-semibold text-[#0f172a] hover:text-[#1e40af] hover:underline"
                                                href={a.blog_url}
                                                rel="noreferrer"
                                                target="_blank"
                                                title="블로그로 이동"
                                            >
                                                {a.name}
                                            </a>
                                            {(a.note || '').includes('자사 관리') ? (
                                                <span
                                                    className="ml-1.5 inline-block rounded bg-[#dcfce7] px-1.5 py-0.5 text-[10px] font-bold text-[#15803d] align-middle"
                                                    title="우리 회사가 직접 관리하는 블로그"
                                                >
                                                    자사 관리
                                                </span>
                                            ) : null}
                                            {isExt(a) ? (
                                                <span
                                                    className="ml-1.5 inline-block rounded bg-[#fef3c7] px-1.5 py-0.5 text-[10px] font-bold text-[#b45309] align-middle"
                                                    title="재계약(연장) 건 — 계약 관리에서 재계약된 블로그"
                                                >
                                                    연장
                                                </span>
                                            ) : null}
                                        </td>
                                        {!customerMode && !reporterMode && (
                                            <td className="px-2 py-2">
                                                <span
                                                    className={`inline-block min-w-[82px] px-1.5 py-1 text-left text-xs ${partnerById[a.client_id || ''] ? 'font-semibold text-[#475569]' : 'text-[#cbd5e1]'}`}
                                                    title="거래처명(계약 관리에서 수정)"
                                                >
                                                    {partnerById[a.client_id || ''] || '-'}
                                                </span>
                                            </td>
                                        )}
                                        {!customerMode && (
                                            <td className="px-1.5 py-2">
                                                <span
                                                    className={`whitespace-nowrap text-xs ${latestPubOf(a.id) ? 'font-semibold text-[#475569]' : 'text-[#cbd5e1]'}`}
                                                    title={latestPubOf(a.id) ? `최근 발행: ${latestPubOf(a.id)}` : '최근 발행 글 없음'}
                                                >
                                                    {latestPubOf(a.id)?.slice(2) || '-'}
                                                </span>
                                            </td>
                                        )}
                                        {!customerMode && (
                                            <td className="px-2 py-2">
                                                <span
                                                    className={`inline-block min-w-[84px] px-1.5 py-1 text-left text-xs ${amountTotal(a) ? 'font-semibold text-[#475569]' : 'text-[#cbd5e1]'}`}
                                                    title="계약금액 수정은 계약 관리에서"
                                                >
                                                    {amountTotal(a) ? `${fmtWon(amountTotal(a))}원` : '-'}
                                                </span>
                                            </td>
                                        )}
                                        {!reporterMode && (
                                            <td className="px-3 py-2">
                                                {a.manager ? (
                                                    <span className="rounded bg-[#f1f5f9] px-2 py-0.5 text-[11px] font-semibold text-[#475569]">
                                                        {a.manager}
                                                    </span>
                                                ) : (
                                                    <span className="text-xs text-[#94a3b8]">미지정</span>
                                                )}
                                            </td>
                                        )}
                                        {!customerMode && (
                                            <td className="px-2 py-2">
                                                {(() => {
                                                    // 배정된 계정 이름 — 목록에 있으면 그걸, 없으면 기자단 텍스트로 폴백(목록 로딩 전에도 표시).
                                                    const assignedName = a.reporter_id
                                                        ? reporters.find((r) => r.id === a.reporter_id)?.name ||
                                                          currentField(a.reporter_history, a.reporter) ||
                                                          '기자단'
                                                        : '';
                                                    const inList = reporters.some((r) => r.id === a.reporter_id);
                                                    return (
                                                <div className="grid gap-1">
                                                    {/* 발급/배정 완료 표시 */}
                                                    {a.reporter_id ? (
                                                        <span className="rounded bg-[#dcfce7] px-2 py-0.5 text-[11px] font-bold text-[#16a34a]">
                                                            ✓ 발급 완료 · {assignedName}
                                                        </span>
                                                    ) : null}
                                                    {/* 담당 기자단(계정) — 지정하면 그 기자단 ERP에 이 블로그가 보임 */}
                                                    <select
                                                        className="h-7 rounded border border-[#cbd5e1] bg-white px-1 text-[11px] text-[#6d28d9]"
                                                        onChange={(e) => {
                                                            const val = e.target.value;
                                                            if (val === '__new__') {
                                                                setIssueForBlog(a); // 이 블로그 맥락에서 새 기자단 발급
                                                                return;
                                                            }
                                                            // 기존 계정 선택 시: 계정 이름 ≠ 기자단 텍스트면 배정 차단(오배정 방지).
                                                            if (val) {
                                                                const rep = reporters.find((r) => r.id === val);
                                                                const text = (
                                                                    currentField(a.reporter_history, a.reporter) || ''
                                                                ).replace(/\s+/g, '');
                                                                const repName = (rep?.name || '').replace(/\s+/g, '');
                                                                if (rep && text && repName !== text) {
                                                                    onToast(
                                                                        `'${rep.name}' 계정은 현재 블로그의 기자단 이름('${currentField(a.reporter_history, a.reporter)}')과 일치하지 않습니다.`,
                                                                    );
                                                                    return; // 배정 안 함(드롭다운은 원래 값으로 되돌아감)
                                                                }
                                                            }
                                                            void assignReporter(a, val);
                                                        }}
                                                        onClick={(e) => e.stopPropagation()}
                                                        title="담당 기자단(계정) 지정 — 기자단 ERP 노출 기준"
                                                        value={a.reporter_id || ''}
                                                    >
                                                        <option value="">{a.reporter_id ? '배정 해제' : '계정 미지정'}</option>
                                                        {reporters.map((r) => (
                                                            <option key={r.id} value={r.id}>
                                                                {reporterLabel(r)}
                                                            </option>
                                                        ))}
                                                        {/* 목록이 아직 안 뜬(RLS/로딩) 경우에도 배정된 계정을 선택 상태로 유지 */}
                                                        {a.reporter_id && !inList ? (
                                                            <option value={a.reporter_id}>{assignedName} (배정됨)</option>
                                                        ) : null}
                                                        <option value="__new__">+ 새 기자단 발급…</option>
                                                    </select>
                                                    {/* 기존 기자단 텍스트/이력(표시용) */}
                                                    <button
                                                        className="rounded px-1.5 py-0.5 text-xs hover:bg-[#f1f5f9]"
                                                        onClick={() => setReporterAcc(a)}
                                                        title="클릭해서 기자단 텍스트·이력 관리"
                                                        type="button"
                                                    >
                                                        {currentField(a.reporter_history, a.reporter) ? (
                                                            <span className="rounded bg-[#ede9fe] px-2 py-0.5 text-[11px] font-semibold text-[#6d28d9]">
                                                                {currentField(a.reporter_history, a.reporter)}
                                                            </span>
                                                        ) : (
                                                            <span className="text-[#cbd5e1]">+ 기자단 텍스트</span>
                                                        )}
                                                    </button>
                                                    {/* 지난 기자단 기록 보기 — reporter_history 이력이 있을 때만 */}
                                                    {(a.reporter_history?.length ?? 0) > 0 ? (
                                                        <button
                                                            className="rounded border border-[#c4b5fd] bg-white px-1.5 py-0.5 text-[10px] font-semibold text-[#6d28d9] hover:bg-[#f5f3ff]"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                setHistoryAcc(a);
                                                            }}
                                                            title="이 블로그의 지난 기자단 기록"
                                                            type="button"
                                                        >
                                                            기자단 히스토리
                                                        </button>
                                                    ) : null}
                                                </div>
                                                    );
                                                })()}
                                            </td>
                                        )}
                                        <td className="px-3 py-2">
                                            <button
                                                className="w-full rounded px-1 py-1 text-left hover:bg-[#f1f5f9]"
                                                onClick={() => setProgressAcc(a)}
                                                title="클릭해서 진행률 관리(1건 완료)"
                                                type="button"
                                            >
                                                {p == null ? (
                                                    <span className="text-xs text-[#94a3b8]">계약건수 미입력</span>
                                                ) : (
                                                    <div className="min-w-[110px]">
                                                        <div className="flex items-baseline justify-between gap-2">
                                                            <span className="text-sm font-bold" style={{ color: pc }}>
                                                                {p}%
                                                            </span>
                                                            <span className="text-[10px] text-[#94a3b8]">
                                                                {(a.goal_count || 0) - (a.remain_count || 0)}/
                                                                {a.goal_count}건
                                                            </span>
                                                        </div>
                                                        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[#eef2f7]">
                                                            <div style={{ background: pc, width: `${p}%`, height: '100%' }} />
                                                        </div>
                                                    </div>
                                                )}
                                            </button>
                                        </td>
                                        <td className="px-3 py-2 text-center">
                                            {a.remain_count == null ? (
                                                <span className="text-xs text-[#94a3b8]">—</span>
                                            ) : (
                                                <span
                                                    className="text-sm font-bold"
                                                    style={{
                                                        color:
                                                            a.remain_count <= 1
                                                                ? '#dc2626' // 1건↓ 빨강
                                                                : a.remain_count <= 5
                                                                  ? '#d97706' // 2~5건 노랑
                                                                  : '#0f172a',
                                                    }}
                                                >
                                                    {a.remain_count}
                                                </span>
                                            )}
                                        </td>
                                        {!reporterMode && (
                                            <td className="px-2 py-2 text-center">
                                                <button
                                                    className={`rounded px-1.5 py-1 text-xs hover:bg-[#f1f5f9] ${currentField(a.weekly_history, a.weekly) ? 'text-[#64748b]' : 'text-[#cbd5e1]'}`}
                                                    onClick={() => setWeeklyAcc(a)}
                                                    title="클릭해서 주 발행 변경·이력 관리"
                                                    type="button"
                                                >
                                                    {currentField(a.weekly_history, a.weekly) || '+ 주 발행'}
                                                </button>
                                            </td>
                                        )}
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
                                        {!customerMode && (
                                            <>
                                        <td className="px-3 py-2 text-center">
                                            {/* 상태 = 계약 건수(잔여) 기준: 미입력 → 임박(잔여 거의 소진) → 진행 중 */}
                                            {!a.is_active ? (
                                                <Tag kind="stop">중단</Tag>
                                            ) : a.goal_count == null ? (
                                                <Tag kind="muted">계약 건수 미입력</Tag>
                                            ) : isRenewalImminent(a) ? (
                                                <Tag kind={renewLevel(a) === 'red' ? 'urgent' : 'low'}>재계약 임박</Tag>
                                            ) : (
                                                <Tag kind="run">진행 중</Tag>
                                            )}
                                        </td>
                                        <td className="px-3 py-2">
                                            <div className="flex items-center gap-1">
                                                <span
                                                    className="block max-w-[72px] truncate text-xs text-[#94a3b8]"
                                                    title={displayNote(a.note)}
                                                >
                                                    {displayNote(a.note) || '—'}
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
                                            {a.manage_sheet_url ? (
                                                <a
                                                    className="inline-flex items-center gap-1 rounded border border-[#16a34a] bg-[#f0fdf4] px-2 py-1 text-[11px] font-semibold text-[#16a34a] hover:bg-[#dcfce7]"
                                                    href={
                                                        /^https?:\/\//.test(a.manage_sheet_url)
                                                            ? a.manage_sheet_url
                                                            : `https://${a.manage_sheet_url}`
                                                    }
                                                    rel="noopener noreferrer"
                                                    target="_blank"
                                                    title="이 업체의 발행 관리 구글 시트 열기"
                                                >
                                                    구글 시트
                                                </a>
                                            ) : (
                                                <span className="text-xs text-[#cbd5e1]">—</span>
                                            )}
                                        </td>
                                        <td className="px-3 py-2 text-center">
                                            <div className="flex justify-center gap-1">
                                                <button
                                                    className="rounded bg-[#059669] px-2 py-1 text-[11px] font-semibold text-white hover:bg-[#047857] disabled:opacity-50"
                                                    disabled={crawlingId === a.id || fullyDone}
                                                    onClick={() => void doCrawl(a)}
                                                    title={
                                                        fullyDone
                                                            ? '오늘 모든 글을 실패 없이 측정 완료 — 재측정 불필요'
                                                            : '터미널 없이 이 블로그 RSS+순위를 지금 측정'
                                                    }
                                                    type="button"
                                                >
                                                    {crawlingId === a.id ? '측정 중…' : fullyDone ? '측정됨' : '지금 측정'}
                                                </button>
                                                <button
                                                    className="rounded border border-[#cbd5e1] px-2 py-1 text-[11px] font-semibold text-[#475569] hover:bg-[#f1f5f9]"
                                                    onClick={() => setEditAcc(a)}
                                                    title="업체 정보·계정·특이사항 + 자료 관리"
                                                    type="button"
                                                >
                                                    정보
                                                </button>
                                                <button
                                                    className="rounded bg-[#1e40af] px-2 py-1 text-[11px] font-semibold text-white hover:bg-[#1e3a8a]"
                                                    onClick={() => setReportAcc(a)}
                                                    title="성과 보고서 만들기 — 넣을 글 선택 후 인쇄/PDF·카톡 발송"
                                                    type="button"
                                                >
                                                    성과
                                                </button>
                                            </div>
                                        </td>
                                            </>
                                        )}
                                        {/* 고객/기자단 뷰: 맨 뒤 성과 버튼. 기자단만 좌측에 '자료' 버튼(우리가 전달한 자료 받기) */}
                                        {customerMode && (
                                            <td className="px-3 py-2 text-center">
                                                <div className="flex justify-center gap-1">
                                                    {reporterMode && (
                                                        <button
                                                            className="rounded border border-[#0f766e] px-3 py-1 text-[11px] font-semibold text-[#0f766e] hover:bg-[#f0fdfa]"
                                                            onClick={() => setMaterialsAcc(a)}
                                                            title="이 블로그에 전달된 자료(키워드·사진) 받기"
                                                            type="button"
                                                        >
                                                            자료
                                                        </button>
                                                    )}
                                                    <button
                                                        className="rounded bg-[#1e40af] px-3 py-1 text-[11px] font-semibold text-white hover:bg-[#1e3a8a]"
                                                        onClick={() => setReportAcc(a)}
                                                        title="저장·발행 성과와 순위 성과 보기"
                                                        type="button"
                                                    >
                                                        성과
                                                    </button>
                                                </div>
                                            </td>
                                        )}
                                    </tr>
                                );
                            })
                        ) : (
                            <tr>
                                <td className="px-3 py-12 text-center text-sm text-[#64748b]" colSpan={customerMode ? 8 : reporterMode ? 11 : 14}>
                                    등록된 블로그가 없습니다 · '시트 붙여넣기 등록'으로 추가하세요
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
                <Pager pages={pages} current={current} onGo={setPage} />
            </div>
            )}

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
            {weeklyAcc ? (
                <FieldHistoryModal
                    account={weeklyAcc}
                    label="주 발행"
                    legacyCol="weekly"
                    legacyValue={weeklyAcc.weekly}
                    history={weeklyAcc.weekly_history}
                    historyCol="weekly_history"
                    onClose={() => setWeeklyAcc(null)}
                    onReload={onReload}
                    onToast={onToast}
                    placeholder="예: 주 5회"
                />
            ) : null}
            {reporterAcc ? (
                <FieldHistoryModal
                    account={reporterAcc}
                    label="기자단"
                    legacyCol="reporter"
                    legacyValue={reporterAcc.reporter}
                    history={reporterAcc.reporter_history}
                    historyCol="reporter_history"
                    onClose={() => setReporterAcc(null)}
                    onReload={onReload}
                    onToast={onToast}
                    placeholder="예: A팀"
                />
            ) : null}
            {/* 지난 기자단 히스토리(읽기 전용) — 이 블로그를 담당했던 기자단 기록을 최근순으로 표시 */}
            {historyAcc ? (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
                    onMouseDown={(e) => e.target === e.currentTarget && setHistoryAcc(null)}
                >
                    <div className="w-[min(420px,94vw)] rounded-2xl bg-white p-6">
                        <h3 className="m-0 text-lg font-bold">{historyAcc.name} · 기자단 히스토리</h3>
                        <p className="mt-1 mb-3 text-sm text-[#64748b]">
                            이 블로그를 담당했던 기자단 기록(최근순)입니다.
                        </p>
                        <div className="grid max-h-[50vh] gap-1 overflow-y-auto">
                            {(historyAcc.reporter_history?.length ?? 0) ? (
                                [...(historyAcc.reporter_history || [])].reverse().map((e, i) => (
                                    <div
                                        className="flex items-center gap-2 rounded-md border border-[#eef2f7] px-3 py-2 text-sm"
                                        key={i}
                                    >
                                        {i === 0 ? (
                                            <span className="rounded bg-[#dcfce7] px-1.5 py-0.5 text-[10px] font-bold text-[#16a34a]">
                                                현재
                                            </span>
                                        ) : (
                                            <span className="rounded bg-[#f1f5f9] px-1.5 py-0.5 text-[10px] font-semibold text-[#64748b]">
                                                이전
                                            </span>
                                        )}
                                        <span className="font-semibold text-[#0f172a]">{e.value}</span>
                                        <span className="ml-auto text-xs text-[#94a3b8]">{e.date || '날짜 미입력'}</span>
                                    </div>
                                ))
                            ) : (
                                <div className="rounded-md border border-dashed border-[#cbd5e1] px-3 py-4 text-center text-xs text-[#94a3b8]">
                                    기록 없음
                                </div>
                            )}
                        </div>
                        <div className="mt-4 flex justify-end">
                            <button
                                className="rounded-md border border-[#cbd5e1] px-4 py-2 text-sm font-semibold text-[#64748b]"
                                onClick={() => setHistoryAcc(null)}
                                type="button"
                            >
                                닫기
                            </button>
                        </div>
                    </div>
                </div>
            ) : null}
            {progressAcc ? (
                <ProgressModal
                    account={progressAcc}
                    onClose={() => setProgressAcc(null)}
                    onReload={onReload}
                    onToast={onToast}
                />
            ) : null}
            {reportAcc ? (
                <BlogPerformanceModal
                    account={reportAcc}
                    posts={postCountOf(reportAcc.id)}
                    internal={!customerMode && !reporterMode}
                    onClose={() => setReportAcc(null)}
                    onReport={(selected) => {
                        setReportAcc(null);
                        void openBlogReport(reportAcc, selected).then((ok) => {
                            if (!ok) onToast('팝업이 차단되었습니다. 팝업 허용 후 다시 시도하세요.');
                        });
                    }}
                />
            ) : null}
            {materialsAcc ? (
                <ReporterMaterialsModal account={materialsAcc} onClose={() => setMaterialsAcc(null)} onToast={onToast} />
            ) : null}
            {reporterManageOpen ? (
                <ReporterManageModal
                    accounts={accounts}
                    onChanged={() => {
                        void getReporters().then(({ data }) => setReporters(data));
                        void onReload(); // 담당 해제된 블로그 반영
                    }}
                    onClose={() => setReporterManageOpen(false)}
                    onToast={onToast}
                    reporters={reporters}
                />
            ) : null}
            {issueForBlog ? (
                <CustomerAccountModal
                    companyName={issueForBlog.name}
                    defaultName={currentField(issueForBlog.reporter_history, issueForBlog.reporter) || ''}
                    mode="reporter"
                    onClose={() => setIssueForBlog(null)}
                    onIssued={({ profileId }) => {
                        // 발급 성공 → 이 블로그에 자동 배정 + 목록 갱신.
                        void getReporters().then(({ data }) => setReporters(data));
                        if (profileId) void assignReporter(issueForBlog, profileId);
                        onToast(`'${issueForBlog.name}' 담당 기자단 발급·배정 완료`);
                    }}
                />
            ) : null}
        </div>
    );
}

// ───────────────────────── 특이사항 자세히 보기·수정 ─────────────────────────
