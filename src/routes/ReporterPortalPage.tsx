import { Fragment, useEffect, useState } from 'react';
import { BlogRankProvider, useBlogRank } from '../components/blogRank/lib/BlogRankContext';
import type { Tab } from '../components/blogRank/lib/helpers';
import { DashboardTab } from '../components/blogRank/pages/DashboardTab';
import { SheetTab } from '../components/blogRank/pages/SheetTab';
import { TrackerTab } from '../components/blogRank/pages/TrackerTab';
import { useAuth } from '../hooks/useAuth';
import { useAsParam } from './CustomerCategoryPage';
import { BLOG_KINDS, createReport, getReports, markPublished, reportOutUnit, resubmitReport, type BlogPostReport, type ReportType } from '../api/blogPostReports';
import { getReporters } from '../api/blogRank';
import {
    createAccountRequest,
    getAccountRequests,
    getReporterRegisteredBlogIdsSafe,
    resubmitAccountRequest,
    type BlogAccountRequest,
} from '../api/blogAccountRequests';

type RTab = 'dashboard' | 'sheet' | 'tracker' | 'report' | 'settlement';

// 블로그 종류 칩 색상 — 브랜드=파랑 · 최적화=초록 · 준최적화=주황 · 저인망=보라.
function kindChipCls(kind: string | null | undefined): string {
    const k = kind ?? '브랜드 블로그';
    if (k === '최적화') return 'bg-[#dcfce7] text-[#15803d]';
    if (k === '준최적화') return 'bg-[#fef3c7] text-[#b45309]';
    if (k === '저인망 배포') return 'bg-[#ede9fe] text-[#7c3aed]';
    return 'bg-[#dbeafe] text-[#1e40af]';
}
const kindLabel = (kind: string | null | undefined) => kind ?? '브랜드 블로그';

// 업체 등록 신청의 블로그 주소 — 스킴(https://)이 있어야 관리 시트에서 정상 분류된다.
const URL_PREFIX = 'https://';
const hasScheme = (u: string) => /^https?:\/\/.+/.test(u.trim());
const URL_HINT = '블로그 주소는 https:// 로 시작해야 합니다 · 주소 앞에 https:// 를 붙여주세요';

// 발행 보고/발행 전환의 글 주소 — 개별 글 주소(글 번호 포함)만 허용.
//   대문 주소(blog.naver.com/아이디)는 순위 트래커가 최신글로 오배정되므로 거부한다.
const hasArticleNo = (u: string) => /\/\d{6,}/.test(u.trim());
const ARTICLE_HINT = '개별 글 주소를 넣어주세요 (대문 주소가 아니라 글 번호가 포함된 주소, 예: blog.naver.com/아이디/224…)';

// 기자단 글 보고 탭 — 본인 담당 블로그에 쓴 글 URL을 보고. 내부(김다영 등)에게 알림이 감.
function ReportSubmitTab() {
    const { accounts, showToast } = useBlogRank();
    const { profile } = useAuth();
    const [blogId, setBlogId] = useState('');
    const [blogKind, setBlogKind] = useState<string>('브랜드 블로그'); // 블로그 종류
    const [round, setRound] = useState(''); // 회차(n회차)
    const [url, setUrl] = useState('');
    const [title, setTitle] = useState('');
    const [keyword, setKeyword] = useState('');
    const [saving, setSaving] = useState<ReportType | null>(null);
    const [publishing, setPublishing] = useState<string | null>(null);
    // 발행 전환 시 실제 글 주소 입력 — 저장은 링크가 없으므로 '발행' 버튼에서 그때 받는다.
    const [pubId, setPubId] = useState<string | null>(null);
    const [pubUrl, setPubUrl] = useState('');
    const [mine, setMine] = useState<BlogPostReport[]>([]);
    // 내 보고 내역 필터 — 저장/발행 탭 + 블로그별 탭
    const [histTab, setHistTab] = useState<ReportType>('save');
    const [blogFilter, setBlogFilter] = useState('all');
    // 재보고(반려 건 다시 보내기)
    const [reId, setReId] = useState<string | null>(null);
    const [reBlogId, setReBlogId] = useState('');
    const [reUrl, setReUrl] = useState('');
    const [reTitle, setReTitle] = useState('');
    const [reKeyword, setReKeyword] = useState('');
    const [reSaving, setReSaving] = useState(false);

    const loadMine = () => void getReports().then(({ data }) => setMine(data));
    useEffect(loadMine, []);

    const typeOf = (r: BlogPostReport): ReportType => r.report_type ?? 'save';

    const startRe = (r: BlogPostReport) => {
        setReId(r.id);
        setReBlogId(r.blog_account_id);
        setReUrl(r.post_url);
        setReTitle(r.title ?? '');
        setReKeyword(r.keyword || '');
    };
    const doRe = async (r: BlogPostReport) => {
        if (!reBlogId) return showToast('블로그를 선택하세요');
        if (!reUrl.trim()) return showToast('글 주소(URL)를 입력하세요');
        if (!reTitle.trim()) return showToast('제목을 입력하세요(필수)');
        setReSaving(true);
        const { error } = await resubmitReport(r.id, {
            blog_account_id: reBlogId,
            post_url: reUrl.trim(),
            keyword: reKeyword.trim() || null,
            title: reTitle.trim(),
            report_type: typeOf(r),
        });
        setReSaving(false);
        if (error) return showToast('재보고 실패: ' + error.message);
        setReId(null);
        showToast('재보고 완료 · 다시 검토중으로 전환됩니다');
        loadMine();
    };

    const submit = async (type: ReportType) => {
        if (!blogId) return showToast('블로그를 선택하세요');
        if (!title.trim()) return showToast('제목을 입력하세요(필수)');
        // 저장은 링크를 받지 않는다(발행 전 초안이라 실제 글 주소가 없음 → 대문 주소 오배정 방지).
        //   발행은 개별 글 주소(글 번호 포함) 필수.
        if (type === 'publish') {
            if (!url.trim()) return showToast('발행 글 주소(URL)를 입력하세요');
            if (!hasArticleNo(url)) return showToast(ARTICLE_HINT);
        }
        if (!profile?.id) return showToast('계정 정보를 확인할 수 없습니다');
        setSaving(type);
        const { error, duplicate } = await createReport({
            blog_account_id: blogId,
            reporter_id: profile.id,
            post_url: type === 'publish' ? url.trim() : '', // 저장은 링크 없음
            title: title.trim(),
            report_type: type,
            keyword: keyword.trim() || null,
            round: round.trim() ? Number(round) : null,
            blog_kind: blogKind || '브랜드 블로그',
        });
        setSaving(null);
        if (error) return showToast('보고 실패: ' + error.message);
        // 같은 제목/URL을 같은 구분으로 이미 보고한 글 → 중복 등록 방지 알림.
        if (duplicate) {
            setHistTab(type);
            showToast('이미 등록한 글입니다 · 제목이 동일한 보고가 있어요');
            loadMine();
            return;
        }
        setUrl('');
        setTitle('');
        setKeyword('');
        setRound('');
        setHistTab(type);
        showToast(`${type === 'publish' ? '발행' : '저장'} 보고 완료 · 담당자에게 전달됩니다`);
        loadMine();
    };

    // 기자단 '발행' 처리 — 저장으로 보고한 글을 발행쪽 히스토리로 이동(재카운트 없음) + 실제 글 주소 저장.
    //   저장 보고는 링크가 없으니 여기서 개별 글 주소(글 번호 포함)를 받아 저장 → 크롤러가 공개된 글을 잡아 순위 추적.
    const doPublish = async (r: BlogPostReport, articleUrl: string) => {
        if (!articleUrl.trim()) return showToast('발행한 글의 주소를 입력하세요');
        if (!hasArticleNo(articleUrl)) return showToast(ARTICLE_HINT);
        setPublishing(r.id);
        const { error } = await markPublished(r.id, articleUrl.trim());
        setPublishing(null);
        if (error) return showToast('발행 처리 실패: ' + error.message);
        setPubId(null);
        setPubUrl('');
        showToast('발행 처리 완료 · 글 주소가 저장되어 순위 추적이 시작됩니다');
        loadMine();
    };

    const nameOf = (id: string) => accounts.find((a) => a.id === id)?.name || '블로그';
    const statusTag = (s: BlogPostReport['status']) =>
        s === 'confirmed' || s === 'published'
            ? { t: '승인됨', c: 'bg-[#dcfce7] text-[#16a34a]' }
            : s === 'rejected'
              ? { t: '반려', c: 'bg-[#fee2e2] text-[#dc2626]' }
              : { t: '검토 중', c: 'bg-[#fef3c7] text-[#b45309]' };

    const countType = (t: ReportType) => mine.filter((r) => typeOf(r) === t).length;
    const filtered = mine.filter(
        (r) => typeOf(r) === histTab && (blogFilter === 'all' || r.blog_account_id === blogFilter),
    );

    const inputCls = 'mt-1 h-10 w-full rounded-md border border-[#cbd5e1] px-3 text-sm';

    return (
        <div className="grid gap-4">
            <div className="grid gap-2 rounded-lg border border-[#e2e8f0] bg-white p-4">
                <div className="text-sm font-bold text-[#0f172a]">새 글 보고</div>
                <label className="text-xs font-semibold text-[#475569]">
                    블로그
                    <select
                        className="mt-1 h-10 w-full rounded-md border border-[#cbd5e1] bg-white px-2 text-sm"
                        onChange={(e) => setBlogId(e.target.value)}
                        value={blogId}
                    >
                        <option value="">담당 블로그 선택</option>
                        {accounts.map((a) => (
                            <option key={a.id} value={a.id}>
                                {a.name}
                            </option>
                        ))}
                    </select>
                </label>
                <label className="text-xs font-semibold text-[#475569]">
                    블로그 종류
                    <select
                        className="mt-1 h-10 w-full rounded-md border border-[#cbd5e1] bg-white px-2 text-sm"
                        onChange={(e) => setBlogKind(e.target.value)}
                        value={blogKind}
                    >
                        {BLOG_KINDS.map((k) => (
                            <option key={k} value={k}>
                                {k}
                            </option>
                        ))}
                    </select>
                </label>
                <label className="text-xs font-semibold text-[#475569]">
                    회차(선택)
                    <input
                        className={inputCls}
                        inputMode="numeric"
                        onChange={(e) => setRound(e.target.value.replace(/[^0-9]/g, ''))}
                        placeholder="몇 회차인지 (예: 3)"
                        value={round}
                    />
                </label>
                <label className="text-xs font-semibold text-[#475569]">
                    제목(필수)
                    <input
                        className={inputCls}
                        onChange={(e) => setTitle(e.target.value)}
                        placeholder="글 제목 (제목으로 구분됩니다)"
                        value={title}
                    />
                </label>
                <label className="text-xs font-semibold text-[#475569]">
                    글 주소(URL) · 발행 시에만
                    <input
                        className={inputCls}
                        onChange={(e) => setUrl(e.target.value)}
                        placeholder="발행 글의 개별 주소 (저장은 비워두세요)"
                        value={url}
                    />
                    <span className="mt-1 block text-[11px] font-normal text-[#94a3b8]">
                        저장으로 보고할 땐 링크를 넣지 마세요. 발행 시 개별 글 주소(글 번호 포함)를 넣습니다.
                    </span>
                </label>
                <label className="text-xs font-semibold text-[#475569]">
                    키워드(선택)
                    <input
                        className={inputCls}
                        onChange={(e) => setKeyword(e.target.value)}
                        placeholder="노출 키워드"
                        value={keyword}
                    />
                </label>
                <div className="mt-1 flex justify-end gap-2">
                    <button
                        className="rounded-md border border-[#1e40af] bg-white px-4 py-2 text-sm font-bold text-[#1e40af] hover:bg-[#eff6ff] disabled:opacity-60"
                        disabled={!!saving}
                        onClick={() => void submit('save')}
                        type="button"
                    >
                        {saving === 'save' ? '보고 중…' : '📝 저장으로 보고'}
                    </button>
                    <button
                        className="rounded-md bg-[#1e40af] px-4 py-2 text-sm font-bold text-white hover:bg-[#1e3a8a] disabled:opacity-60"
                        disabled={!!saving}
                        onClick={() => void submit('publish')}
                        type="button"
                    >
                        {saving === 'publish' ? '보고 중…' : '🚀 발행으로 보고'}
                    </button>
                </div>
                <p className="m-0 text-[11px] text-[#94a3b8]">
                    보통은 <b>저장</b>으로 먼저 보고해 업체가 확인합니다. 담당자가 승인하면 계약 1건 카운트됩니다.
                </p>
            </div>

            <div className="grid gap-2">
                <div className="text-sm font-bold text-[#0f172a]">내 보고 내역</div>
                {/* 저장/발행 탭 */}
                <div className="flex gap-1 border-b border-[#e2e8f0]">
                    {(
                        [
                            ['save', '저장'],
                            ['publish', '발행'],
                        ] as [ReportType, string][]
                    ).map(([k, label]) => (
                        <button
                            className={`-mb-px border-b-2 px-4 py-2 text-sm font-bold ${
                                histTab === k ? 'border-[#1e40af] text-[#1e40af]' : 'border-transparent text-[#94a3b8]'
                            }`}
                            key={k}
                            onClick={() => setHistTab(k)}
                            type="button"
                        >
                            {label} <span className="text-xs">({countType(k)})</span>
                        </button>
                    ))}
                </div>
                {/* 블로그(업체)별 필터 — 드롭다운(담당 블로그 여러 개면 간결하게) */}
                {accounts.length > 1 ? (
                    <div className="flex items-center gap-2">
                        <span className="text-[12px] font-semibold text-[#64748b]">업체</span>
                        <select
                            className="h-9 min-w-[180px] rounded-md border border-[#cbd5e1] bg-white px-2.5 text-sm"
                            onChange={(e) => setBlogFilter(e.target.value)}
                            value={blogFilter}
                        >
                            <option value="all">전체 업체</option>
                            {accounts.map((a) => (
                                <option key={a.id} value={a.id}>
                                    {a.name}
                                </option>
                            ))}
                        </select>
                    </div>
                ) : null}

                {filtered.length === 0 ? (
                    <p className="m-0 rounded-md bg-[#f8fafc] px-4 py-6 text-center text-sm text-[#94a3b8]">
                        {histTab === 'save' ? '저장 보고 내역이 없습니다.' : '발행 보고 내역이 없습니다.'}
                    </p>
                ) : (
                    <div className="overflow-hidden rounded-md border border-[#e2e8f0] bg-white">
                        {filtered.map((r) => {
                            const st = statusTag(r.status);
                            const editing = reId === r.id;
                            return (
                                <div className="border-b border-[#f1f5f9] px-3 py-2 text-sm last:border-b-0" key={r.id}>
                                    <div className="flex items-center justify-between gap-2">
                                        <div className="min-w-0">
                                            <div className="truncate font-semibold text-[#334155]">
                                                {nameOf(r.blog_account_id)}
                                                {r.round ? ` · ${r.round}회차` : ''} · {r.title || '제목 없음'}
                                            </div>
                                            <a
                                                className="block truncate text-xs text-[#7c3aed] hover:underline"
                                                href={r.post_url}
                                                rel="noopener noreferrer"
                                                target="_blank"
                                            >
                                                {r.post_url}
                                            </a>
                                            {r.status === 'rejected' && r.note ? (
                                                <div className="mt-0.5 text-[11px] font-semibold text-[#dc2626]">
                                                    반려 사유: {r.note}
                                                </div>
                                            ) : null}
                                        </div>
                                        <div className="flex shrink-0 items-center gap-1">
                                            <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${kindChipCls(r.blog_kind)}`}>
                                                {kindLabel(r.blog_kind)}
                                            </span>
                                            <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${st.c}`}>
                                                {st.t}
                                            </span>
                                            {/* 저장 탭 항목엔 '발행' 버튼 — 누르면 실제 글 주소 입력받아 발행 처리 */}
                                            {histTab === 'save' && r.status !== 'rejected' ? (
                                                <button
                                                    className="rounded bg-[#059669] px-2 py-0.5 text-[11px] font-bold text-white hover:bg-[#047857] disabled:opacity-50"
                                                    disabled={publishing === r.id}
                                                    onClick={() => {
                                                        setPubId(pubId === r.id ? null : r.id);
                                                        setPubUrl('');
                                                    }}
                                                    title="이 글을 발행했다면 눌러 글 주소를 입력하세요"
                                                    type="button"
                                                >
                                                    {publishing === r.id ? '…' : '발행'}
                                                </button>
                                            ) : null}
                                            {r.status === 'rejected' && !editing ? (
                                                <button
                                                    className="rounded border border-[#1e40af] px-2 py-0.5 text-[11px] font-semibold text-[#1e40af] hover:bg-[#eff6ff]"
                                                    onClick={() => startRe(r)}
                                                    type="button"
                                                >
                                                    재보고
                                                </button>
                                            ) : null}
                                        </div>
                                    </div>
                                    {pubId === r.id ? (
                                        <div className="mt-2 grid gap-2 rounded-md border border-[#a7f3d0] bg-[#ecfdf5] p-2">
                                            <div className="text-[12px] font-semibold text-[#047857]">
                                                발행한 글의 주소를 넣어주세요 (글 번호 포함 · 대문 주소 X)
                                            </div>
                                            <input
                                                className="h-9 w-full rounded-md border border-[#cbd5e1] bg-white px-2 text-sm"
                                                onChange={(e) => setPubUrl(e.target.value)}
                                                placeholder="https://blog.naver.com/아이디/224…"
                                                value={pubUrl}
                                            />
                                            <div className="flex gap-2">
                                                <button
                                                    className="rounded-md bg-[#059669] px-3 py-1.5 text-[12px] font-bold text-white disabled:opacity-50"
                                                    disabled={publishing === r.id}
                                                    onClick={() => void doPublish(r, pubUrl)}
                                                    type="button"
                                                >
                                                    {publishing === r.id ? '처리 중…' : '발행 확정'}
                                                </button>
                                                <button
                                                    className="rounded-md border border-[#cbd5e1] bg-white px-3 py-1.5 text-[12px] font-bold text-[#475569]"
                                                    onClick={() => setPubId(null)}
                                                    type="button"
                                                >
                                                    취소
                                                </button>
                                            </div>
                                        </div>
                                    ) : null}
                                    {editing ? (
                                        <div className="mt-2 grid gap-2 rounded-md border border-[#c7d2fe] bg-[#eef2ff] p-2">
                                            <select
                                                className="h-9 w-full rounded-md border border-[#cbd5e1] bg-white px-2 text-sm"
                                                onChange={(e) => setReBlogId(e.target.value)}
                                                value={reBlogId}
                                            >
                                                <option value="">블로그 선택</option>
                                                {accounts.map((a) => (
                                                    <option key={a.id} value={a.id}>
                                                        {a.name}
                                                    </option>
                                                ))}
                                            </select>
                                            <input
                                                className="h-9 w-full rounded-md border border-[#cbd5e1] px-3 text-sm"
                                                onChange={(e) => setReTitle(e.target.value)}
                                                placeholder="제목(필수)"
                                                value={reTitle}
                                            />
                                            <input
                                                className="h-9 w-full rounded-md border border-[#cbd5e1] px-3 text-sm"
                                                onChange={(e) => setReUrl(e.target.value)}
                                                placeholder="글 주소(URL)"
                                                value={reUrl}
                                            />
                                            <input
                                                className="h-9 w-full rounded-md border border-[#cbd5e1] px-3 text-sm"
                                                onChange={(e) => setReKeyword(e.target.value)}
                                                placeholder="키워드(선택)"
                                                value={reKeyword}
                                            />
                                            <div className="flex justify-end gap-1">
                                                <button
                                                    className="rounded-md border border-[#cbd5e1] px-3 py-1.5 text-xs font-semibold text-[#64748b]"
                                                    onClick={() => setReId(null)}
                                                    type="button"
                                                >
                                                    취소
                                                </button>
                                                <button
                                                    className="rounded-md bg-[#1e40af] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
                                                    disabled={reSaving}
                                                    onClick={() => void doRe(r)}
                                                    type="button"
                                                >
                                                    {reSaving ? '보고 중…' : '재보고'}
                                                </button>
                                            </div>
                                        </div>
                                    ) : null}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}

// 정산 내역 탭 — 회사가 '승인'해 확정된 보고 = 외주비(건당 8,000원, 대박종합주방 10,000)가 쌓인 내역.
//   컬럼: 성함 · 업체 · 글 제목 · 금액. (회차 n/n은 진행률 기준으로 추후 반영) 읽기 전용.
function SettlementTab() {
    const { accounts } = useBlogRank();
    const { profile } = useAuth();
    const [rows, setRows] = useState<BlogPostReport[]>([]);
    const [names, setNames] = useState<Record<string, string>>({});
    const [loading, setLoading] = useState(true);
    // 기자단이 '업체 등록'으로 승인받은 블로그 — 외주비를 잡지 않으므로 정산에서도 0원 처리.
    const [ownBlogIds, setOwnBlogIds] = useState<Set<string>>(new Set());
    const [ownErr, setOwnErr] = useState(false); // 등록업체 판정 조회 실패 — 금액이 부정확할 수 있음

    useEffect(() => {
        let alive = true;
        setLoading(true);
        void Promise.all([getReports(), getReporters(), getReporterRegisteredBlogIdsSafe()]).then(
            ([rep, reps, own]) => {
                if (!alive) return;
                // 승인 확정(= 외주비 계상됨)만: confirmed(현행) / published(구 데이터).
                setRows(rep.data.filter((r) => r.status === 'confirmed' || r.status === 'published'));
                const m: Record<string, string> = {};
                reps.data.forEach((r) => (m[r.id] = r.name || r.email));
                setNames(m);
                setOwnBlogIds(own.ids);
                setOwnErr(!!own.error);
                setLoading(false);
            },
        );
        return () => {
            alive = false;
        };
    }, []);

    const companyOf = (id: string) => accounts.find((a) => a.id === id)?.name || '블로그';
    // 성함: 이름맵 우선 → 내 행이면 내 이름 → 그 외(널/미해결)는 '기자단'(미리보기 시 내부 사용자 이름으로 오표기 방지).
    const reporterName = (r: BlogPostReport) => {
        if (r.reporter_id && names[r.reporter_id]) return names[r.reporter_id];
        if (r.reporter_id && r.reporter_id === profile?.id) return profile?.name || '기자단';
        return '기자단';
    };
    // 기자단 등록 업체는 계약 관리 미연동이라 외주비가 계상되지 않는다 → 정산 금액 0원.
    //   (계약 관리와 합칠 때 별도 등록 예정. 그 외 블로그는 기존 규칙 그대로 8,000/10,000)
    const amountOf = (r: BlogPostReport) =>
        ownBlogIds.has(r.blog_account_id) ? 0 : reportOutUnit(r, companyOf(r.blog_account_id));
    const total = rows.reduce((s, r) => s + amountOf(r), 0);
    const unpaidTotal = rows.filter((r) => !r.paid).reduce((s, r) => s + amountOf(r), 0);

    return (
        <div className="grid gap-3">
            <div className="rounded-xl border border-[#e2e8f0] bg-white p-5">
                {ownErr ? (
                    <p className="m-0 mb-2 rounded-md bg-[#fef2f2] px-3 py-2 text-[12px] font-semibold text-[#dc2626]">
                        ⚠ 등록 업체 정보를 불러오지 못해 금액이 정확하지 않을 수 있습니다. 새로고침해 주세요.
                    </p>
                ) : null}
                <div className="flex items-center justify-between">
                    <div className="text-sm font-bold text-[#0f172a]">정산 내역</div>
                    <div className="text-sm text-[#64748b]">
                        누적 외주비 <b className="text-[#1e40af]">{total.toLocaleString('ko-KR')}원</b> · {rows.length}건
                        {' · '}미입금 <b className="text-[#b45309]">{unpaidTotal.toLocaleString('ko-KR')}원</b>
                    </div>
                </div>
            </div>
            <div className="overflow-hidden rounded-xl border border-[#e2e8f0] bg-white">
                <table className="w-full text-left text-sm">
                    <thead>
                        <tr className="border-b-2 border-[#e2e8f0] bg-[#f1f5f9] text-[11px] text-[#64748b]">
                            <th className="px-4 py-2 font-semibold">입금</th>
                            <th className="whitespace-nowrap px-4 py-2 font-semibold">회차</th>
                            <th className="px-4 py-2 font-semibold">성함</th>
                            <th className="px-4 py-2 font-semibold">업체</th>
                            <th className="px-4 py-2 font-semibold">글 제목</th>
                            <th className="whitespace-nowrap px-4 py-2 font-semibold">발행/저장일</th>
                            <th className="px-4 py-2 text-right font-semibold">금액</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr>
                                <td className="px-4 py-10 text-center text-sm text-[#94a3b8]" colSpan={7}>
                                    불러오는 중…
                                </td>
                            </tr>
                        ) : rows.length ? (
                            rows.map((r) => (
                                <tr className="border-b border-[#f1f5f9] last:border-b-0" key={r.id}>
                                    <td className="px-4 py-2">
                                        {r.paid ? (
                                            <span className="rounded-full bg-[#dcfce7] px-2 py-0.5 text-[11px] font-bold text-[#15803d]">
                                                입금
                                            </span>
                                        ) : (
                                            <span className="rounded-full bg-[#fef3c7] px-2 py-0.5 text-[11px] font-bold text-[#b45309]">
                                                미입금
                                            </span>
                                        )}
                                    </td>
                                    <td className="whitespace-nowrap px-4 py-2 font-semibold text-[#475569]">
                                        {r.round ? `${r.round}회차` : '-'}
                                    </td>
                                    <td className="px-4 py-2 font-semibold text-[#334155]">{reporterName(r)}</td>
                                    <td className="px-4 py-2 text-[#475569]">{companyOf(r.blog_account_id)}</td>
                                    <td className="max-w-[280px] truncate px-4 py-2 text-[#475569]">
                                        {r.title || '제목 없음'}
                                    </td>
                                    <td className="whitespace-nowrap px-4 py-2 text-[#64748b]">
                                        {(r.published_at || r.created_at || '').slice(0, 10) || '-'}
                                    </td>
                                    <td className="whitespace-nowrap px-4 py-2 text-right font-bold text-[#1e40af]">
                                        {amountOf(r).toLocaleString('ko-KR')}원
                                    </td>
                                </tr>
                            ))
                        ) : (
                            <tr>
                                <td className="px-4 py-10 text-center text-sm text-[#94a3b8]" colSpan={7}>
                                    아직 승인되어 정산된 글이 없습니다.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

// 기자단 업체 등록 모달 — '내 블로그' 탭 우측 상단 버튼으로 연다. 기자단이 본인이 진행할 업체를 직접 신청.
//   회사가 브랜드 블로그 시트에서 승인하면 그때 블로그가 생성되고 담당 기자단으로 본인이 붙어
//   '내 블로그'에 바로 나타난다. (계약 관리에는 들어가지 않는다 — 브랜드 블로그에서만 관리)
function CompanyRequestModal({ onClose }: { onClose: () => void }) {
    const { showToast, reload } = useBlogRank();
    const { profile } = useAuth();
    const inputCls = 'mt-1 h-10 w-full rounded-md border border-[#cbd5e1] px-3 text-sm';

    const [name, setName] = useState('');
    // 주소창은 https:// 를 미리 채워두고 뒤에 붙여넣게 한다 — 스킴이 없으면 시트에서 'URL미입력 건'으로
    //   분류돼(SheetTab isUrlPending) 신규 등록 건에 안 보이므로, 입력 단계에서 막는다.
    const [url, setUrl] = useState(URL_PREFIX);
    const [contractCount, setContractCount] = useState('');
    const [progressCount, setProgressCount] = useState('');
    const [saving, setSaving] = useState(false);
    const [mine, setMine] = useState<BlogAccountRequest[]>([]);

    // 재신청(반려 건 수정 후 다시 보내기)
    const [reId, setReId] = useState<string | null>(null);
    const [reName, setReName] = useState('');
    const [reUrl, setReUrl] = useState('');
    const [reContract, setReContract] = useState('');
    const [reProgress, setReProgress] = useState('');
    const [reSaving, setReSaving] = useState(false);

    const loadMine = () => void getAccountRequests().then(({ data }) => setMine(data));
    useEffect(loadMine, []);

    const numOrNull = (v: string) => (v.trim() ? Number(v) : null);
    const onlyNum = (v: string) => v.replace(/[^0-9]/g, '');

    const submit = async () => {
        if (!name.trim()) return showToast('업체 이름을 입력하세요');
        if (!url.trim() || url.trim() === URL_PREFIX) return showToast('블로그 주소를 입력하세요');
        if (!hasScheme(url)) return showToast(URL_HINT);
        if (!profile?.id) return showToast('계정 정보를 확인할 수 없습니다');
        setSaving(true);
        const { error, duplicate } = await createAccountRequest({
            reporter_id: profile.id,
            name: name.trim(),
            blog_url: url.trim(),
            contract_count: numOrNull(contractCount),
            progress_count: numOrNull(progressCount),
        });
        setSaving(false);
        if (error) return showToast('신청 실패: ' + error.message);
        if (duplicate) {
            showToast('이미 신청한 블로그입니다 · 검토중인 신청이 있어요');
            loadMine();
            return;
        }
        setName('');
        setUrl(URL_PREFIX);
        setContractCount('');
        setProgressCount('');
        showToast('업체 등록 신청 완료 · 담당자 승인 후 내 블로그에 추가됩니다');
        loadMine();
    };

    const startRe = (r: BlogAccountRequest) => {
        setReId(r.id);
        setReName(r.name);
        setReUrl(r.blog_url || URL_PREFIX);
        setReContract(r.contract_count == null ? '' : String(r.contract_count));
        setReProgress(r.progress_count == null ? '' : String(r.progress_count));
    };
    const doRe = async (r: BlogAccountRequest) => {
        if (!reName.trim()) return showToast('업체 이름을 입력하세요');
        if (!reUrl.trim() || reUrl.trim() === URL_PREFIX) return showToast('블로그 주소를 입력하세요');
        if (!hasScheme(reUrl)) return showToast(URL_HINT);
        setReSaving(true);
        const { error } = await resubmitAccountRequest(r.id, {
            name: reName,
            blog_url: reUrl,
            contract_count: numOrNull(reContract),
            progress_count: numOrNull(reProgress),
        });
        setReSaving(false);
        if (error) return showToast('재신청 실패: ' + error.message);
        setReId(null);
        showToast('재신청 완료 · 다시 검토중으로 전환됩니다');
        loadMine();
    };

    const statusTag = (s: BlogAccountRequest['status']) => {
        if (s === 'approved') return <span className="rounded-full bg-[#dcfce7] px-2 py-0.5 text-[11px] font-bold text-[#15803d]">승인</span>;
        if (s === 'rejected') return <span className="rounded-full bg-[#fee2e2] px-2 py-0.5 text-[11px] font-bold text-[#dc2626]">반려</span>;
        return <span className="rounded-full bg-[#fef3c7] px-2 py-0.5 text-[11px] font-bold text-[#b45309]">검토중</span>;
    };

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
            onMouseDown={(e) => e.target === e.currentTarget && onClose()}
        >
            <div className="flex max-h-[88vh] w-[min(760px,95vw)] flex-col gap-5 overflow-y-auto rounded-2xl bg-white p-6">
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <h3 className="m-0 text-lg font-bold text-[#0f172a]">업체 등록</h3>
                        <p className="mt-1 mb-0 text-sm text-[#64748b]">
                            내가 진행할 업체를 신청하면 담당자 승인 후 <b>내 블로그</b>에 추가됩니다.
                        </p>
                    </div>
                    <button
                        className="rounded-md border border-[#cbd5e1] bg-white px-3 py-1.5 text-[12px] font-bold text-[#475569] hover:bg-[#f8fafc]"
                        onClick={onClose}
                        type="button"
                    >
                        닫기
                    </button>
                </div>

            <div className="grid gap-3 rounded-lg border border-[#e2e8f0] bg-white p-4">
                <div className="text-sm font-bold text-[#0f172a]">업체 등록 신청</div>
                <label className="text-xs font-semibold text-[#475569]">
                    업체 이름
                    <input
                        className={inputCls}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="예: 대박종합주방"
                        value={name}
                    />
                </label>
                <label className="text-xs font-semibold text-[#475569]">
                    블로그 주소
                    <input
                        className={inputCls}
                        onChange={(e) => setUrl(e.target.value)}
                        placeholder="https://blog.naver.com/..."
                        value={url}
                    />
                    {url.trim() && url.trim() !== URL_PREFIX && !hasScheme(url) ? (
                        <span className="mt-1 block text-[11px] font-semibold text-[#dc2626]">⚠ {URL_HINT}</span>
                    ) : (
                        <span className="mt-1 block text-[11px] font-normal text-[#94a3b8]">
                            https:// 뒤에 블로그 주소를 붙여넣으세요 (예: https://blog.naver.com/myblog)
                        </span>
                    )}
                </label>
                <div className="grid grid-cols-2 gap-3">
                    <label className="text-xs font-semibold text-[#475569]">
                        계약 건
                        <input
                            className={inputCls}
                            inputMode="numeric"
                            onChange={(e) => setContractCount(onlyNum(e.target.value))}
                            placeholder="총 계약 건수"
                            value={contractCount}
                        />
                    </label>
                    <label className="text-xs font-semibold text-[#475569]">
                        진행 건
                        <input
                            className={inputCls}
                            inputMode="numeric"
                            onChange={(e) => setProgressCount(onlyNum(e.target.value))}
                            placeholder="이미 진행한 건수"
                            value={progressCount}
                        />
                    </label>
                </div>
                <div className="mt-1 flex justify-end">
                    <button
                        className="rounded-md bg-[#1e40af] px-4 py-2 text-sm font-bold text-white hover:bg-[#1e3a8a] disabled:opacity-60"
                        disabled={saving}
                        onClick={() => void submit()}
                        type="button"
                    >
                        {saving ? '신청 중…' : '업체 등록 신청'}
                    </button>
                </div>
                <p className="m-0 text-[11px] text-[#94a3b8]">
                    담당자가 <b>승인</b>하면 이 업체가 <b>내 블로그</b>에 추가되고 글 보고를 할 수 있습니다. 잔여 건수는{' '}
                    <b>계약 건 − 진행 건</b>으로 계산됩니다.
                </p>
            </div>

            <div className="grid gap-2">
                <div className="text-sm font-bold text-[#0f172a]">내 신청 내역</div>
                <div className="overflow-x-auto rounded-lg border border-[#e2e8f0] bg-white">
                    <table className="w-full border-collapse text-sm">
                        <thead>
                            <tr className="border-b border-[#e2e8f0] bg-[#f8fafc] text-[12px] text-[#64748b]">
                                <th className="px-4 py-2 text-left font-semibold">업체</th>
                                <th className="px-4 py-2 text-left font-semibold">블로그 주소</th>
                                <th className="px-4 py-2 text-right font-semibold">계약</th>
                                <th className="px-4 py-2 text-right font-semibold">진행</th>
                                <th className="px-4 py-2 text-left font-semibold">상태</th>
                                <th className="px-4 py-2 text-left font-semibold">신청일</th>
                            </tr>
                        </thead>
                        <tbody>
                            {mine.length ? (
                                mine.map((r) => (
                                    <Fragment key={r.id}>
                                        <tr className="border-b border-[#f1f5f9]">
                                            <td className="px-4 py-2.5 font-semibold text-[#0f172a]">{r.name}</td>
                                            <td className="max-w-[280px] truncate px-4 py-2.5 text-[#475569]">
                                                {r.blog_url}
                                            </td>
                                            <td className="px-4 py-2.5 text-right">{r.contract_count ?? '-'}</td>
                                            <td className="px-4 py-2.5 text-right">{r.progress_count ?? '-'}</td>
                                            <td className="px-4 py-2.5">{statusTag(r.status)}</td>
                                            <td className="px-4 py-2.5 text-[12px] text-[#94a3b8]">
                                                {r.created_at.slice(0, 10)}
                                            </td>
                                        </tr>
                                        {r.status === 'rejected' ? (
                                            <tr className="border-b border-[#f1f5f9] bg-[#fff7ed]">
                                                <td className="px-4 py-2.5" colSpan={6}>
                                                    <div className="text-[12px] text-[#b45309]">
                                                        반려 사유: {r.note || '사유 없음'}
                                                    </div>
                                                    {reId === r.id ? (
                                                        <div className="mt-2 grid max-w-[520px] gap-2">
                                                            <input
                                                                className="h-9 rounded-md border border-[#cbd5e1] px-3 text-sm"
                                                                onChange={(e) => setReName(e.target.value)}
                                                                placeholder="업체 이름"
                                                                value={reName}
                                                            />
                                                            <input
                                                                className="h-9 rounded-md border border-[#cbd5e1] px-3 text-sm"
                                                                onChange={(e) => setReUrl(e.target.value)}
                                                                placeholder="블로그 주소"
                                                                value={reUrl}
                                                            />
                                                            <div className="grid grid-cols-2 gap-2">
                                                                <input
                                                                    className="h-9 rounded-md border border-[#cbd5e1] px-3 text-sm"
                                                                    inputMode="numeric"
                                                                    onChange={(e) => setReContract(onlyNum(e.target.value))}
                                                                    placeholder="계약 건"
                                                                    value={reContract}
                                                                />
                                                                <input
                                                                    className="h-9 rounded-md border border-[#cbd5e1] px-3 text-sm"
                                                                    inputMode="numeric"
                                                                    onChange={(e) => setReProgress(onlyNum(e.target.value))}
                                                                    placeholder="진행 건"
                                                                    value={reProgress}
                                                                />
                                                            </div>
                                                            <div className="flex gap-2">
                                                                <button
                                                                    className="rounded-md bg-[#1e40af] px-3 py-1.5 text-[12px] font-bold text-white disabled:opacity-60"
                                                                    disabled={reSaving}
                                                                    onClick={() => void doRe(r)}
                                                                    type="button"
                                                                >
                                                                    {reSaving ? '전송 중…' : '재신청'}
                                                                </button>
                                                                <button
                                                                    className="rounded-md border border-[#cbd5e1] bg-white px-3 py-1.5 text-[12px] font-bold text-[#475569]"
                                                                    onClick={() => setReId(null)}
                                                                    type="button"
                                                                >
                                                                    취소
                                                                </button>
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <button
                                                            className="mt-1.5 rounded-md border border-[#1e40af] bg-white px-3 py-1 text-[12px] font-bold text-[#1e40af]"
                                                            onClick={() => startRe(r)}
                                                            type="button"
                                                        >
                                                            수정 후 재신청
                                                        </button>
                                                    )}
                                                </td>
                                            </tr>
                                        ) : null}
                                    </Fragment>
                                ))
                            ) : (
                                <tr>
                                    <td className="px-4 py-10 text-center text-sm text-[#94a3b8]" colSpan={6}>
                                        아직 신청한 업체가 없습니다.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
                <button
                    className="justify-self-start rounded-md border border-[#cbd5e1] bg-white px-3 py-1.5 text-[12px] font-bold text-[#475569]"
                    onClick={() => {
                        loadMine();
                        void reload(); // 승인된 업체가 '내 블로그'에 바로 보이도록 함께 갱신
                    }}
                    type="button"
                >
                    새로고침
                </button>
            </div>
            </div>
        </div>
    );
}

// 기자단 ERP 포털 — 본인 담당 블로그만(RLS 스코프) 읽기전용 + 글 보고.
function ReporterShell() {
    const { accounts, posts, loading, error, reload, toastMsg, tab, goTab } = useBlogRank();
    // 대시보드/내블로그/순위는 context tab 사용(대시보드 KPI 클릭 네비게이션이 먹히도록). 글 보고·정산 내역은 별도 플래그.
    const [extraTab, setExtraTab] = useState<'report' | 'settlement' | null>(null);
    const [companyOpen, setCompanyOpen] = useState(false); // 업체 등록 모달('내 블로그' 탭 우측 상단 버튼)
    const active: RTab = extraTab
        ? extraTab
        : tab === 'sheet'
          ? 'sheet'
          : tab === 'tracker'
            ? 'tracker'
            : 'dashboard';
    const select = (key: RTab) => {
        if (key === 'report' || key === 'settlement') {
            setExtraTab(key);
            return;
        }
        setExtraTab(null);
        goTab(key as Tab);
    };

    return (
        <section className="grid gap-4">
            <div className="flex items-center justify-between gap-3">
                <div>
                    <div className="flex items-center gap-2">
                        <h2 className="m-0 text-[22px] font-semibold text-[#0f172a]">기자단 대시보드</h2>
                        <span className="rounded-full bg-[#ede9fe] px-2.5 py-1 text-xs font-bold text-[#6d28d9]">
                            기자단 뷰
                        </span>
                    </div>
                    <p className="mt-1 mb-0 text-sm text-[#64748b]">
                        내가 담당하는 블로그와 글 순위를 한눈에{' '}
                        {loading ? '· 불러오는 중...' : `· 블로그 ${accounts.length}개 · 글 ${posts.length}건`}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    {/* 업체 등록 — '내 블로그' 탭에서만. 신청 → 담당자 승인 시 내 블로그에 추가됨. */}
                    {active === 'sheet' ? (
                        <button
                            className="inline-flex h-10 items-center justify-center rounded-md border border-[#1e40af] bg-white px-4 text-sm font-semibold text-[#1e40af] hover:bg-[#eff6ff]"
                            onClick={() => setCompanyOpen(true)}
                            type="button"
                        >
                            + 업체 등록
                        </button>
                    ) : null}
                    <button
                        className="inline-flex h-10 items-center justify-center rounded-md bg-[#1e40af] px-4 text-sm font-semibold text-white"
                        onClick={() => void reload()}
                        type="button"
                    >
                        새로고침
                    </button>
                </div>
            </div>

            {error ? (
                <p className="m-0 rounded-md bg-[#fee2e2] px-4 py-3 text-sm text-[#dc2626]">{error}</p>
            ) : null}

            <div className="flex gap-1 border-b border-[#e2e8f0]">
                {(
                    [
                        ['dashboard', '대시보드'],
                        ['sheet', '내 블로그'],
                        ['tracker', '순위 트래커'],
                        ['report', '글 보고'],
                        ['settlement', '정산 내역'],
                    ] as const
                ).map(([key, label]) => (
                    <button
                        className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold ${
                            active === key ? 'border-[#1e40af] text-[#1e40af]' : 'border-transparent text-[#94a3b8]'
                        }`}
                        key={key}
                        onClick={() => select(key as RTab)}
                        type="button"
                    >
                        {label}
                    </button>
                ))}
            </div>

            {active === 'dashboard' ? <DashboardTab /> : null}
            {active === 'sheet' ? <SheetTab /> : null}
            {active === 'tracker' ? <TrackerTab /> : null}
            {active === 'report' ? <ReportSubmitTab /> : null}
            {companyOpen ? <CompanyRequestModal onClose={() => setCompanyOpen(false)} /> : null}
            {active === 'settlement' ? <SettlementTab /> : null}

            {toastMsg ? (
                <div className="fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 rounded-full bg-[#0f172a] px-5 py-2.5 text-sm font-medium text-white shadow-lg">
                    {toastMsg}
                </div>
            ) : null}
        </section>
    );
}

function ReporterPortalPage() {
    const as = useAsParam(); // 내부 미리보기 대상 기자단 id(있으면 그 기자단 시점)
    return (
        <BlogRankProvider previewReporterId={as || null} reporterMode>
            <ReporterShell />
        </BlogRankProvider>
    );
}

export default ReporterPortalPage;
