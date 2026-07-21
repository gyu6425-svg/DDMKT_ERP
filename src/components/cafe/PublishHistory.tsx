import { useCallback, useEffect, useState } from 'react';
import { listPublishJobs } from '../../api/cafePublishQueue';

// 발행 히스토리 — cafe_publish_queue 의 최근 작업을 보여준다. 자동발행 탭 하단에 상시 노출.
//   status: pending(대기) / processing(작성중) / posted(등록됨·확인대기) / done(완료) / fail(실패)
type Row = {
    id: string;
    title: string | null;
    status: string;
    posted_url: string | null;
    reason: string | null;
    created_at: string;
    done_at: string | null;
};

const STATUS_STYLE: Record<string, { label: string; cls: string }> = {
    done: { label: '완료', cls: 'bg-[#dcfce7] text-[#166534]' },
    posted: { label: '등록됨(확인)', cls: 'bg-[#fef9c3] text-[#854d0e]' },
    processing: { label: '작성중', cls: 'bg-[#dbeafe] text-[#1e40af]' },
    pending: { label: '대기', cls: 'bg-[#f1f5f9] text-[#475569]' },
    fail: { label: '실패', cls: 'bg-[#fee2e2] text-[#991b1b]' },
};

function fmt(iso: string | null): string {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const p = (n: number) => String(n).padStart(2, '0');
    return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** filter: 제목이 이 문자열들 중 하나로 시작하는 행만(업체별 히스토리 분리). 없으면 전체. */
export function PublishHistory({ filterPrefixes }: { filterPrefixes?: string[] } = {}) {
    const [rows, setRows] = useState<Row[]>([]);
    const [loading, setLoading] = useState(false);
    const [msg, setMsg] = useState('');

    const load = useCallback(async () => {
        setLoading(true);
        const { data, error } = await listPublishJobs(40);
        setLoading(false);
        if (error) {
            setMsg('불러오기 실패');
            return;
        }
        setMsg('');
        setRows(data as Row[]);
    }, []);

    useEffect(() => {
        // effect 동기 본문에서 바로 setState 하지 않도록 다음 틱에 첫 로드.
        const first = window.setTimeout(() => void load(), 0);
        // 작성중/대기 상태가 있으면 진행 상황이 바뀌므로 주기적으로 갱신.
        const t = window.setInterval(() => void load(), 20000);
        return () => {
            window.clearTimeout(first);
            window.clearInterval(t);
        };
    }, [load]);

    const shown = filterPrefixes?.length
        ? rows.filter((r) => filterPrefixes.some((p) => (r.title || '').startsWith(p)))
        : rows;

    return (
        <div className="rounded-xl border border-[#e2e8f0] bg-white p-4">
            <div className="mb-2 flex items-center justify-between">
                <div className="text-[13px] font-bold text-[#334155]">발행 히스토리 <span className="font-normal text-[#94a3b8]">— 최근 {shown.length}건</span></div>
                <button
                    className="rounded-md border border-[#cbd5e1] px-2.5 py-1 text-[11px] font-semibold text-[#475569] hover:bg-[#f1f5f9]"
                    onClick={() => void load()}
                    type="button"
                >
                    {loading ? '새로고침 중…' : '새로고침'}
                </button>
            </div>
            {msg ? <div className="text-[12px] text-[#dc2626]">{msg}</div> : null}
            {shown.length === 0 && !loading ? (
                <div className="py-4 text-center text-[12px] text-[#94a3b8]">아직 발행 내역이 없습니다.</div>
            ) : (
                <div className="max-h-[360px] overflow-y-auto">
                    <table className="w-full text-[12px]">
                        <thead className="sticky top-0 bg-white text-[#94a3b8]">
                            <tr className="border-b border-[#e2e8f0]">
                                <th className="py-1.5 pr-2 text-left font-semibold">상태</th>
                                <th className="py-1.5 pr-2 text-left font-semibold">제목</th>
                                <th className="py-1.5 pr-2 text-left font-semibold">등록시각</th>
                                <th className="py-1.5 text-left font-semibold">링크</th>
                            </tr>
                        </thead>
                        <tbody>
                            {shown.map((r) => {
                                const s = STATUS_STYLE[r.status] || { label: r.status, cls: 'bg-[#f1f5f9] text-[#475569]' };
                                return (
                                    <tr className="border-b border-[#f1f5f9] align-top" key={r.id}>
                                        <td className="py-1.5 pr-2">
                                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${s.cls}`}>{s.label}</span>
                                        </td>
                                        <td className="py-1.5 pr-2 text-[#334155]">
                                            {r.title || '(제목 없음)'}
                                            {r.status === 'fail' && r.reason ? <div className="text-[10px] text-[#991b1b]">{r.reason.slice(0, 60)}</div> : null}
                                        </td>
                                        <td className="py-1.5 pr-2 text-[#64748b]">{fmt(r.done_at) || fmt(r.created_at)}</td>
                                        <td className="py-1.5">
                                            {r.posted_url ? (
                                                <a className="text-[#2563eb] hover:underline" href={r.posted_url} rel="noreferrer" target="_blank">보기</a>
                                            ) : (
                                                <span className="text-[#cbd5e1]">—</span>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
