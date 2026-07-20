import { useEffect, useState } from 'react';
import {
    createCommentJob,
    listCommentJobs,
    listCommentStats,
    type AccountStat,
    type CommentJob,
} from '../api/cafeCommentQueue';
import { buildComment } from '../lib/cafeCommentTemplates';

// 카페 댓글 자동화 — 대상 글 주소 + 댓글 내용을 큐에 적재.
//   로컬 데몬(crawler/cafe_cmt/comment_listener.py)이 폴링해, 작업의 계정에 맞는
//   로그인된 크롬(계정별 포트, crawler/cafe_cmt/accounts.txt)으로 댓글 작성.
//   ⚠️ 발행(CafePage)과 독립된 별도 페이지 — 병합 충돌 회피(docs/MERGE-SAFETY.md).

const ALL = '__ALL__';           // 전체 탭
const UNSET_LABEL = '(기본 계정)'; // account 가 비어있는 기록

const STATUS_LABEL: Record<CommentJob['status'], { text: string; cls: string }> = {
    pending: { text: '대기', cls: 'bg-[#f1f5f9] text-[#475569]' },
    processing: { text: '처리중', cls: 'bg-[#dbeafe] text-[#1d4ed8]' },
    done: { text: '완료', cls: 'bg-[#dcfce7] text-[#15803d]' },
    fail: { text: '실패', cls: 'bg-[#fee2e2] text-[#b91c1c]' },
};

function CafeCommentPage() {
    const [articleUrl, setArticleUrl] = useState('');
    const [body, setBody] = useState('');
    const [region, setRegion] = useState('과천');
    const [keyword, setKeyword] = useState('누수탐지');
    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState('');
    const [jobs, setJobs] = useState<CommentJob[]>([]);
    const [stats, setStats] = useState<AccountStat[]>([]);
    const [tab, setTab] = useState<string>(ALL); // 계정 탭(ALL=전체)

    // 고정 템플릿 풀에서 랜덤 문구 생성 → 본문에 채움(수정 가능). 직전 문구와 중복 회피.
    const generate = () => setBody(buildComment({ region, keyword }, { avoid: body }));

    const refresh = async (forTab: string = tab) => {
        const [{ data: rows }, { data: st }] = await Promise.all([
            // ALL=전체 / '' 탭은 계정 미지정 기록만 보고 싶은 것이므로 필터 없이 받아 아래에서 거른다
            listCommentJobs(30, forTab === ALL || forTab === '' ? null : forTab),
            listCommentStats(),
        ]);
        setJobs(forTab === '' ? rows.filter((j) => !j.account) : rows);
        setStats(st);
    };

    useEffect(() => {
        void refresh(tab);
        const t = setInterval(() => void refresh(tab), 5000); // 데몬 처리 상태 자동 갱신
        return () => clearInterval(t);
    }, [tab]);

    const submit = async () => {
        setBusy(true);
        setMsg('');
        // 특정 계정 탭에서 예약하면 그 계정으로 달린다(전체 탭이면 기본 계정).
        const account = tab === ALL || tab === '' ? null : tab;
        const { error, jobId } = await createCommentJob({ articleUrl, body, account });
        setBusy(false);
        if (error) {
            setMsg(`❌ ${error.message}`);
            return;
        }
        setMsg(`✅ 예약 완료 (${jobId?.slice(0, 8)}) — 데몬이 처리합니다.`);
        setBody('');
        void refresh();
    };

    return (
        <div className="mx-auto grid max-w-[820px] gap-5 p-5">
            <div>
                <h1 className="text-lg font-bold text-[#0f172a]">카페 댓글 자동화</h1>
                <p className="mt-1 text-[13px] text-[#64748b]">
                    대상 글 주소와 댓글 내용을 예약하면, 로컬 데몬이 로그인된 크롬으로 댓글을 작성합니다.
                    (준비: <code className="rounded bg-[#f1f5f9] px-1">run_chrome_login.bat</code> 로 네이버 로그인 →{' '}
                    <code className="rounded bg-[#f1f5f9] px-1">run_chrome.bat</code> +{' '}
                    <code className="rounded bg-[#f1f5f9] px-1">python comment_listener.py</code>)
                </p>
            </div>

            <div className="grid gap-3 rounded-lg border border-[#e2e8f0] bg-white p-4">
                <label className="grid gap-1">
                    <span className="text-[12px] font-semibold text-[#475569]">대상 글 주소 (전체 URL)</span>
                    <input
                        className="h-9 rounded-md border border-[#cbd5e1] bg-white px-2.5 text-sm"
                        placeholder="https://cafe.naver.com/..."
                        value={articleUrl}
                        onChange={(e) => setArticleUrl(e.target.value)}
                    />
                </label>
                <div className="grid grid-cols-2 gap-3">
                    <label className="grid gap-1">
                        <span className="text-[12px] font-semibold text-[#475569]">지역</span>
                        <input
                            className="h-9 rounded-md border border-[#cbd5e1] bg-white px-2.5 text-sm"
                            placeholder="예: 과천"
                            value={region}
                            onChange={(e) => setRegion(e.target.value)}
                        />
                    </label>
                    <label className="grid gap-1">
                        <span className="text-[12px] font-semibold text-[#475569]">키워드(업종)</span>
                        <input
                            className="h-9 rounded-md border border-[#cbd5e1] bg-white px-2.5 text-sm"
                            placeholder="예: 누수탐지 / 철거"
                            value={keyword}
                            onChange={(e) => setKeyword(e.target.value)}
                        />
                    </label>
                </div>
                <label className="grid gap-1">
                    <div className="flex items-center justify-between">
                        <span className="text-[12px] font-semibold text-[#475569]">댓글 내용</span>
                        <button
                            type="button"
                            className="rounded-md border border-[#16a34a] px-2 py-0.5 text-[12px] font-semibold text-[#16a34a] disabled:opacity-40"
                            disabled={!region.trim() || !keyword.trim()}
                            onClick={generate}
                        >
                            {body ? '🔄 다른 문구' : '✨ 문구 자동생성'}
                        </button>
                    </div>
                    <textarea
                        className="min-h-[96px] rounded-md border border-[#cbd5e1] bg-white p-2.5 text-sm"
                        placeholder="'문구 자동생성'을 누르거나 직접 입력하세요. (생성 후 수정 가능)"
                        value={body}
                        onChange={(e) => setBody(e.target.value)}
                    />
                </label>
                <div className="flex items-center gap-3">
                    <button
                        className="h-9 rounded-md bg-[#16a34a] px-4 text-sm font-semibold text-white disabled:opacity-50"
                        disabled={busy || !articleUrl.trim() || !body.trim()}
                        onClick={() => void submit()}
                    >
                        {busy ? '예약 중…' : '댓글 예약'}
                    </button>
                    {msg && <span className="text-[13px] text-[#475569]">{msg}</span>}
                </div>
            </div>

            <div className="grid gap-2">
                <div className="flex items-center justify-between">
                    <h2 className="text-sm font-semibold text-[#334155]">계정별 기록 (자동 갱신)</h2>
                    <button className="text-[12px] text-[#2563eb]" onClick={() => void refresh()}>
                        새로고침
                    </button>
                </div>

                {/* 계정 탭 — 큐에 기록된 계정들로 구성(계정 목록은 로컬 accounts.txt) */}
                <div className="flex flex-wrap gap-1.5 border-b border-[#e2e8f0] pb-2">
                    {(() => {
                        const totalAll = stats.reduce((n, s) => n + s.total, 0);
                        const doneAll = stats.reduce((n, s) => n + s.done, 0);
                        const tabs: { key: string; label: string; total: number; done: number }[] = [
                            { key: ALL, label: '전체', total: totalAll, done: doneAll },
                            ...stats.map((s) => ({
                                key: s.account,
                                label: s.account || UNSET_LABEL,
                                total: s.total,
                                done: s.done,
                            })),
                        ];
                        return tabs.map((t) => {
                            const on = tab === t.key;
                            return (
                                <button
                                    key={t.key || 'unset'}
                                    onClick={() => setTab(t.key)}
                                    className={`rounded-md px-2.5 py-1 text-[12px] font-semibold ${
                                        on
                                            ? 'bg-[#16a34a] text-white'
                                            : 'bg-[#f1f5f9] text-[#475569] hover:bg-[#e2e8f0]'
                                    }`}
                                    title={`완료 ${t.done} / 전체 ${t.total}`}
                                >
                                    {t.label}
                                    <span className={`ml-1 ${on ? 'text-white/80' : 'text-[#94a3b8]'}`}>
                                        {t.done}/{t.total}
                                    </span>
                                </button>
                            );
                        });
                    })()}
                </div>

                {/* 선택 탭 요약 */}
                {(() => {
                    const s =
                        tab === ALL
                            ? stats.reduce(
                                  (a, x) => ({
                                      account: '전체',
                                      total: a.total + x.total,
                                      done: a.done + x.done,
                                      fail: a.fail + x.fail,
                                      pending: a.pending + x.pending,
                                  }),
                                  { account: '전체', total: 0, done: 0, fail: 0, pending: 0 } as AccountStat,
                              )
                            : stats.find((x) => x.account === tab);
                    if (!s) return null;
                    return (
                        <div className="flex gap-4 rounded-md bg-[#f8fafc] px-3 py-2 text-[12px] text-[#475569]">
                            <span>전체 <b className="text-[#0f172a]">{s.total}</b></span>
                            <span>완료 <b className="text-[#15803d]">{s.done}</b></span>
                            <span>대기/처리중 <b className="text-[#1d4ed8]">{s.pending}</b></span>
                            <span>실패 <b className="text-[#b91c1c]">{s.fail}</b></span>
                        </div>
                    );
                })()}

                <div className="overflow-hidden rounded-lg border border-[#e2e8f0]">
                    <table className="w-full text-left text-[13px]">
                        <thead className="bg-[#f8fafc] text-[#64748b]">
                            <tr>
                                <th className="px-3 py-2 font-semibold">상태</th>
                                <th className="px-3 py-2 font-semibold">계정</th>
                                <th className="px-3 py-2 font-semibold">글 주소</th>
                                <th className="px-3 py-2 font-semibold">댓글</th>
                                <th className="px-3 py-2 font-semibold">시각</th>
                            </tr>
                        </thead>
                        <tbody>
                            {jobs.length === 0 ? (
                                <tr>
                                    <td className="px-3 py-4 text-[#94a3b8]" colSpan={5}>
                                        예약된 댓글이 없습니다.
                                    </td>
                                </tr>
                            ) : (
                                jobs.map((j) => {
                                    const s = STATUS_LABEL[j.status] ?? STATUS_LABEL.pending;
                                    return (
                                        <tr key={j.id} className="border-t border-[#f1f5f9]">
                                            <td className="px-3 py-2">
                                                <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${s.cls}`}>
                                                    {s.text}
                                                </span>
                                                {j.status === 'fail' && j.reason && (
                                                    <span className="ml-1 text-[11px] text-[#b91c1c]" title={j.reason}>
                                                        ⚠
                                                    </span>
                                                )}
                                            </td>
                                            <td className="whitespace-nowrap px-3 py-2 text-[#334155]">
                                                {j.account ? (
                                                    <span className="rounded bg-[#eef2ff] px-1.5 py-0.5 text-[11px] font-semibold text-[#4338ca]">
                                                        {j.account}
                                                    </span>
                                                ) : (
                                                    <span className="text-[11px] text-[#94a3b8]">{UNSET_LABEL}</span>
                                                )}
                                            </td>
                                            <td className="max-w-[200px] truncate px-3 py-2 text-[#475569]" title={j.article_url}>
                                                {j.posted_url ? (
                                                    <a className="text-[#2563eb]" href={j.posted_url} target="_blank" rel="noreferrer">
                                                        {j.article_url}
                                                    </a>
                                                ) : (
                                                    j.article_url
                                                )}
                                            </td>
                                            <td className="max-w-[220px] truncate px-3 py-2 text-[#334155]" title={j.body}>
                                                {j.body}
                                            </td>
                                            <td className="whitespace-nowrap px-3 py-2 text-[#94a3b8]">
                                                {new Date(j.created_at).toLocaleString('ko-KR', {
                                                    month: '2-digit',
                                                    day: '2-digit',
                                                    hour: '2-digit',
                                                    minute: '2-digit',
                                                })}
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}

export default CafeCommentPage;
