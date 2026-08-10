import { useState } from 'react';
import { extractBlogId, extractLogNo } from '../../../api/blogRank';
import { searchRankPC } from '../../../api/rankSearch';
import { blSearchUrl, tiSearchUrl } from '../lib/report';

// 즉석 순위 조회 — 계약 업체와 무관하게, 블로그(글) 주소 + 키워드만 넣으면 그 자리에서 순위를 본다.
//   저장하지 않는 1회성 조회(관리시트/트래커 데이터 안 건드림). 측정 = 트래커와 동일 경로(PC 리스너 큐).
type Res = { ti: number; ti_status: string; bl: number; bl_status: string };

// 트래커 표(RankCell)와 동일한 표기: ok면 'N위'(단 30 초과는 권외), fail이면 '실패', 그 외 권외.
function rankLabel(v: number, status: string) {
    if (status === 'fail') return '실패';
    if (status !== 'ok' || v > 30) return '권외';
    return `${v}위`;
}

export function QuickRankLookup() {
    const [url, setUrl] = useState('');
    const [kw, setKw] = useState('');
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState('');
    const [res, setRes] = useState<Res | null>(null);
    const [shown, setShown] = useState<{ url: string; kw: string; blogId: string } | null>(null);

    const run = async () => {
        const blogId = extractBlogId(url);
        const logNo = extractLogNo(url);
        const q = kw.trim();
        if (!blogId) { setErr('블로그 주소에서 아이디를 찾지 못했습니다. 글 주소를 확인해 주세요.'); return; }
        if (!q) { setErr('키워드를 입력해 주세요.'); return; }
        setBusy(true); setErr(''); setRes(null);
        try {
            const r = await searchRankPC(q, blogId, logNo);
            setRes({ ti: r.ti, ti_status: r.ti_status, bl: r.bl, bl_status: r.bl_status });
            setShown({ url, kw: q, blogId });
        } catch (e) {
            setErr(e instanceof Error ? e.message : '조회 실패');
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="rounded-md border border-[#c7d2fe] bg-[#eef2ff] p-3">
            <div className="mb-2 flex items-center gap-2">
                <span className="text-[13px] font-bold text-[#3730a3]">🔎 즉석 순위 조회</span>
                <span className="text-[11px] text-[#6366f1]">계약 업체가 아니어도, 블로그 주소 + 키워드만 넣으면 바로 순위 확인 (저장 안 됨)</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
                <input
                    className="h-10 min-w-[280px] flex-1 rounded-md border border-[#cbd5e1] bg-white px-3 text-sm"
                    onChange={(e) => setUrl(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && void run()}
                    placeholder="블로그 글 주소 (예: https://blog.naver.com/아이디/2231…)"
                    value={url}
                />
                <input
                    className="h-10 w-full min-w-[160px] rounded-md border border-[#cbd5e1] bg-white px-3 text-sm sm:w-56"
                    onChange={(e) => setKw(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && void run()}
                    placeholder="키워드 (예: 강남 맛집)"
                    value={kw}
                />
                <button
                    className="h-10 shrink-0 rounded-md bg-[#4338ca] px-5 text-sm font-semibold text-white hover:bg-[#3730a3] disabled:opacity-50"
                    disabled={busy || !url.trim() || !kw.trim()}
                    onClick={() => void run()}
                    type="button"
                >
                    {busy ? '측정 중…' : '조회'}
                </button>
            </div>
            {err ? <div className="mt-2 text-[12px] font-semibold text-[#dc2626]">{err}</div> : null}

            {res ? (
                <div className="mt-3 overflow-x-auto rounded-md border border-[#e2e8f0] bg-white">
                    <table className="w-full border-collapse text-left text-sm">
                        <thead>
                            <tr className="border-b-2 border-[#e2e8f0] bg-[#f1f5f9] text-[11px] text-[#64748b]">
                                <th className="px-3 py-2 font-semibold">블로그</th>
                                <th className="px-3 py-2 font-semibold">키워드</th>
                                <th className="px-3 py-2 text-center font-bold text-[#059669]">통합탭</th>
                                <th className="px-3 py-2 text-center font-bold text-[#1e40af]">블로그탭</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr className="border-b border-[#e2e8f0]">
                                <td className="px-3 py-2 text-[13px] font-semibold text-[#475569]">
                                    {shown?.url ? (
                                        <a className="hover:text-[#7c3aed] hover:underline" href={shown.url} rel="noopener noreferrer" target="_blank">
                                            {shown.blogId || '블로그'}
                                        </a>
                                    ) : (shown?.blogId || '블로그')}
                                </td>
                                <td className="px-3 py-2">
                                    <span className="inline-block rounded bg-[#ede9fe] px-1.5 py-0.5 text-[12px] font-semibold text-[#7c3aed]">#{shown?.kw}</span>
                                </td>
                                <td className="px-3 py-2 text-center">
                                    <a
                                        className="text-sm font-bold underline decoration-dotted underline-offset-2 hover:decoration-solid"
                                        href={shown?.kw ? tiSearchUrl(shown.kw) : '#'}
                                        rel="noopener noreferrer"
                                        style={{ color: res.ti_status === 'ok' && res.ti <= 10 ? '#059669' : '#94a3b8' }}
                                        target="_blank"
                                        title="네이버 통합검색에서 확인"
                                    >
                                        {rankLabel(res.ti, res.ti_status)}
                                    </a>
                                </td>
                                <td className="px-3 py-2 text-center">
                                    <a
                                        className="text-sm font-bold underline decoration-dotted underline-offset-2 hover:decoration-solid"
                                        href={shown?.kw ? blSearchUrl(shown.kw) : '#'}
                                        rel="noopener noreferrer"
                                        style={{ color: res.bl_status === 'ok' && res.bl <= 10 ? '#1e40af' : '#94a3b8' }}
                                        target="_blank"
                                        title="네이버 블로그탭에서 확인"
                                    >
                                        {rankLabel(res.bl, res.bl_status)}
                                    </a>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            ) : null}
        </div>
    );
}
