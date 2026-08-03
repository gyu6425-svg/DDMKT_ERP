import { useEffect, useState } from 'react';
import {
    listCafeDeployRequests,
    listDeployCredentials,
    signedDeployUrls,
    setCafeDeployStatus,
    deleteCafeDeployRequest,
    type CafeDeployRequest,
    type DeployCredential,
} from '../api/cafeDeployRequests';
import { grantTokens, listChargeRequests, setChargeRequestStatus, reverseDeployTokens } from '../api/cafeTokens';
import { enablePublishByClient } from '../api/cafeAccounts';

// 관리자 — 카페 배포 접수 관리(전 고객). 접수 내용·사진·네이버계정·상태(접수→결제대기→세팅중→완료)를 한 화면에서.
//   '승인' = 접수→결제대기. 이 순간 고객ERP에 결제(입금계좌) 안내가 노출된다.
const STATUSES = ['접수', '결제대기', '세팅중', '완료'];
const ST_STYLE: Record<string, string> = {
    접수: 'bg-[#dbeafe] text-[#1e40af]', 결제대기: 'bg-[#ffedd5] text-[#9a3412]', 세팅중: 'bg-[#fef9c3] text-[#854d0e]', 완료: 'bg-[#dcfce7] text-[#166534]',
};

export default function CafeDeployAdminPanel() {
    const [rows, setRows] = useState<CafeDeployRequest[]>([]);
    const [urls, setUrls] = useState<Record<string, string>>({});
    const [creds, setCreds] = useState<Record<string, DeployCredential>>({});
    const [reveal, setReveal] = useState<Record<string, boolean>>({});
    const [filter, setFilter] = useState<string>('전체');
    const [msg, setMsg] = useState('');
    const [issuing, setIssuing] = useState<string | null>(null); // 토큰 발행 중인 행
    const [delId, setDelId] = useState<string | null>(null); // 삭제 확인 대기 행
    const [kwOpen, setKwOpen] = useState<Record<string, boolean>>({}); // 키워드 칩 드롭다운 펼침
    const [credOpen, setCredOpen] = useState<Record<string, boolean>>({}); // 네이버 계정 자세히보기 펼침
    const [issueOpen, setIssueOpen] = useState<string | null>(null); // 토큰 발행 수 입력 중인 행
    const [issueCount, setIssueCount] = useState(''); // 발행할 토큰 수(편집)

    const load = () => {
        void listCafeDeployRequests(undefined, 200).then(async ({ data, error }) => {
            if (error) { setMsg(error.message); return; }
            setRows(data);
            const paths = data.flatMap((r) => (r.photos ? [...r.photos.main, ...r.photos.real, ...r.photos.banner] : []));
            if (paths.length) setUrls(await signedDeployUrls(paths));
        });
        void listDeployCredentials().then(({ data }) => {
            const m: Record<string, DeployCredential> = {};
            data.forEach((c) => { if (c.deploy_request_id) m[c.deploy_request_id] = c; });
            setCreds(m);
        });
    };
    useEffect(load, []);

    const changeStatus = async (id: string, status: string) => {
        const { error } = await setCafeDeployStatus(id, status);
        if (error) return setMsg('상태 변경 실패: ' + error.message);
        setRows((prev) => prev.map((r) => (r.id === id ? { ...r, status } : r)));
    };

    // 토큰 발행 — 결제 확인 후 발행건수(=토큰수)만큼 고객에게 지급 + 상태 세팅중 + 대기 충전요청 정리.
    //   발행 수는 접수 총건수(예: 50)를 기본값으로 두되, 관리자가 확인·수정해서 실제 그만큼 발행.
    const tokenCountOf = (r: CafeDeployRequest) => r.total_count ?? r.selected_keywords?.length ?? 0;
    const issueTokens = async (r: CafeDeployRequest, count: number) => {
        if (!count || count <= 0) { setMsg(`${r.company_name}: 발행할 토큰 수(건수)를 1 이상 입력하세요.`); return; }
        setIssuing(r.id); setMsg('');
        const { error } = await grantTokens(r.client_id, count, `카페 배포 결제확인 · ${r.company_name} [req:${r.id}]`);
        if (error) { setIssuing(null); return setMsg('토큰 발행 실패: ' + error.message); }
        await enablePublishByClient(r.client_id, r.company_name); // 자동화 발행 탭 활성화
        await setCafeDeployStatus(r.id, '세팅중');
        // 이 고객의 대기 충전요청을 완료 처리(중복 방지)
        const { data: reqs } = await listChargeRequests(r.client_id);
        await Promise.all((reqs || []).filter((q) => q.status === 'pending').map((q) => setChargeRequestStatus(q.id, 'done')));
        setRows((prev) => prev.map((x) => (x.id === r.id ? { ...x, status: '세팅중' } : x)));
        setIssuing(null); setIssueOpen(null);
        setMsg(`${r.company_name} +${count}건(토큰) 발행 완료 → 세팅중`);
    };

    // 접수내역 삭제 — ①발행했던 토큰 회수(고객 충전내역에 '조정 -N' 기록) ②사진·자격증명 정리 후 행 삭제(2단계 확인).
    //   토큰 발행 여부는 상태로 판단(세팅중/완료 = 발행됨). 미발행(접수/결제대기)이면 회수 0.
    const remove = async (r: CafeDeployRequest) => {
        const wasIssued = r.status === '세팅중' || r.status === '완료';
        const { reversed } = await reverseDeployTokens(r.client_id, r.id, wasIssued ? tokenCountOf(r) : 0, r.company_name);
        const { error } = await deleteCafeDeployRequest(r);
        if (error) { setDelId(null); return setMsg('삭제 실패: ' + error.message); }
        setRows((prev) => prev.filter((x) => x.id !== r.id));
        setDelId(null);
        setMsg(`${r.company_name} 접수내역 삭제됨${reversed ? ` · 발행 토큰 ${reversed}건 회수(고객 충전내역에 반영)` : ''}`);
    };

    const shown = filter === '전체' ? rows : rows.filter((r) => r.status === filter);

    return (
        <div>
            <div className="mb-3 flex flex-wrap items-center gap-2">
                <h3 className="m-0 text-[18px] font-bold text-[#111111]">카페 배포 접수 관리 ({rows.length})</h3>
                <div className="ml-2 flex gap-1">
                    {['전체', ...STATUSES].map((s) => (
                        <button key={s} type="button" onClick={() => setFilter(s)}
                            className={`rounded-full px-3 py-1 text-xs font-semibold ${filter === s ? 'bg-[#1e40af] text-white' : 'bg-[#f1f5f9] text-[#64748b]'}`}>{s}</button>
                    ))}
                </div>
                <button className="ml-auto rounded-md border border-[#cbd5e1] px-3 py-1 text-sm font-semibold text-[#475569]" onClick={load} type="button">새로고침</button>
            </div>
            {msg ? <p className="mb-2 text-sm text-[#dc2626]">{msg}</p> : null}

            {shown.length === 0 ? (
                <div className="rounded-lg border border-dashed border-[#cbd5e1] bg-[#f8fafc] px-5 py-12 text-center text-sm text-[#94a3b8]">접수 내역이 없습니다.</div>
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full min-w-[1100px] border-collapse text-[13px]">
                        <thead>
                            <tr className="border-b-2 border-[#e2e8f0] bg-[#f1f5f9] text-left text-[11px] text-[#64748b]">
                                {['작성일', '업체', '유형', '키워드', 'URL', '미션시작', '일/총', '사진', '네이버 계정', '2단계', '상태'].map((h) => (
                                    <th key={h} className="whitespace-nowrap px-2 py-2 font-semibold">{h}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {shown.map((r) => {
                                const paths = r.photos ? [...r.photos.main, ...r.photos.real, ...r.photos.banner] : [];
                                const cd = creds[r.id];
                                return (
                                    <tr key={r.id} className="border-b border-[#f1f5f9] align-top text-[#334155]">
                                        <td className="whitespace-nowrap px-2 py-2">{r.created_at.slice(0, 10)}</td>
                                        <td className="whitespace-nowrap px-2 py-2 font-semibold">{r.company_name}</td>
                                        <td className="whitespace-nowrap px-2 py-2">
                                            <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${r.deploy_type === '키워드형' ? 'bg-[#fef3c7] text-[#92400e]' : 'bg-[#e0e7ff] text-[#4338ca]'}`}>{r.deploy_type ?? '지역형'}</span>
                                            {r.region_sets?.length ? <div className="mt-0.5 text-[11px] text-[#64748b]">{r.region_sets.join('·')}</div> : null}
                                        </td>
                                        <td className="px-2 py-2">
                                            <div className="whitespace-nowrap">{r.keyword ?? '-'}</div>
                                            {r.selected_keywords?.length ? (
                                                <div className="mt-1">
                                                    <button type="button" onClick={() => setKwOpen((v) => ({ ...v, [r.id]: !v[r.id] }))}
                                                        className="inline-flex items-center gap-1 rounded-full bg-[#eef2ff] px-2 py-0.5 text-[10px] font-bold text-[#4338ca] hover:bg-[#e0e7ff]">
                                                        <span className={`text-[8px] transition-transform ${kwOpen[r.id] ? 'rotate-90' : ''}`}>▶</span>
                                                        선택 키워드 {r.selected_keywords.length}개
                                                    </button>
                                                    {kwOpen[r.id] ? (
                                                        <div className="mt-1 flex max-w-[240px] flex-wrap gap-1">
                                                            {r.selected_keywords.map((p) => (
                                                                <span key={p.keyword} className="rounded bg-[#eef2ff] px-1.5 py-0.5 text-[10px] font-semibold text-[#4338ca]" title={p.theme ? `${p.theme}${p.volume != null ? ` · 검색량 ${p.volume.toLocaleString()}` : ''}` : (p.volume != null ? `검색량 ${p.volume.toLocaleString()}` : '')}>{p.keyword}</span>
                                                            ))}
                                                        </div>
                                                    ) : null}
                                                </div>
                                            ) : null}
                                        </td>
                                        <td className="max-w-[150px] truncate px-2 py-2" title={r.url ?? ''}>{r.url ? <a className="text-[#2563eb] underline" href={r.url} target="_blank" rel="noreferrer">{r.url}</a> : '-'}</td>
                                        <td className="whitespace-nowrap px-2 py-2">{r.mission_start ?? '-'}</td>
                                        <td className="whitespace-nowrap px-2 py-2 text-center">{r.daily_count ?? '-'}/{r.total_count ?? '-'}</td>
                                        <td className="px-2 py-2">
                                            {paths.length === 0 ? <span className="text-[#94a3b8]">-</span> : (
                                                <div className="flex flex-wrap gap-1">
                                                    {paths.map((p) => (
                                                        <a key={p} href={urls[p] || '#'} target="_blank" rel="noreferrer" download title={p.split('/').pop() ?? ''}>
                                                            {urls[p] ? <img src={urls[p]} alt="" className="h-9 w-9 rounded border border-[#e2e8f0] object-cover hover:opacity-80" /> : <span className="flex h-9 w-9 items-center justify-center rounded border border-[#e2e8f0] text-[9px] text-[#94a3b8]">…</span>}
                                                        </a>
                                                    ))}
                                                </div>
                                            )}
                                        </td>
                                        <td className="whitespace-nowrap px-2 py-2 text-[12px]">
                                            {cd ? (
                                                credOpen[r.id] ? (
                                                    <div className="grid gap-0.5">
                                                        <div>아이디: <span className="font-mono">{cd.naver_id ?? '-'}</span></div>
                                                        <div className="flex items-center gap-1">
                                                            비번:
                                                            <span className={`font-mono ${reveal[r.id] ? '' : 'select-none blur-[4px]'}`}>{cd.naver_pw ?? '-'}</span>
                                                            <button className="rounded border border-[#cbd5e1] px-1 text-[10px] text-[#475569]" onClick={() => setReveal((v) => ({ ...v, [r.id]: !v[r.id] }))} type="button">{reveal[r.id] ? '가리기' : '보기'}</button>
                                                        </div>
                                                        <button className="mt-0.5 text-left text-[10px] font-semibold text-[#94a3b8] hover:text-[#64748b]" onClick={() => setCredOpen((v) => ({ ...v, [r.id]: false }))} type="button">접기</button>
                                                    </div>
                                                ) : (
                                                    <button className="rounded-md border border-[#c7d2fe] bg-[#eef2ff] px-2 py-1 text-[11px] font-semibold text-[#4338ca] hover:bg-[#e0e7ff]" onClick={() => setCredOpen((v) => ({ ...v, [r.id]: true }))} type="button">자세히 보기</button>
                                                )
                                            ) : <span className="text-[#94a3b8]">-</span>}
                                        </td>
                                        <td className="whitespace-nowrap px-2 py-2">{r.two_factor ? <span className="font-bold text-[#b45309]">사용</span> : '-'}</td>
                                        <td className="whitespace-nowrap px-2 py-2">
                                            <div className="flex items-center gap-1.5">
                                                <select className={`rounded-full px-2 py-1 text-xs font-bold ${ST_STYLE[r.status] ?? 'bg-[#f1f5f9] text-[#64748b]'}`} value={r.status} onChange={(e) => void changeStatus(r.id, e.target.value)}>
                                                    {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                                                </select>
                                                {r.status === '접수' ? (
                                                    <button type="button" onClick={() => void changeStatus(r.id, '결제대기')}
                                                        className="rounded-md bg-[#ea580c] px-2.5 py-1 text-[11px] font-bold text-white hover:bg-[#c2410c]"
                                                        title="승인 → 고객ERP에 입금/결제 안내가 노출됩니다">승인</button>
                                                ) : null}
                                                {r.status === '결제대기' ? (
                                                    issueOpen === r.id ? (
                                                        <span className="flex items-center gap-1">
                                                            <input type="number" min={1} value={issueCount} onChange={(e) => setIssueCount(e.target.value)}
                                                                className="h-6 w-16 rounded border border-[#cbd5e1] px-1 text-[11px]" placeholder="건수" />
                                                            <button type="button" disabled={issuing === r.id} onClick={() => void issueTokens(r, Number(issueCount))}
                                                                className="rounded-md bg-[#059669] px-2 py-1 text-[11px] font-bold text-white hover:bg-[#047857] disabled:opacity-50">
                                                                {issuing === r.id ? '발행 중…' : '발행'}
                                                            </button>
                                                            <button type="button" onClick={() => setIssueOpen(null)} className="rounded-md border border-[#cbd5e1] px-2 py-1 text-[11px] font-semibold text-[#64748b]">취소</button>
                                                        </span>
                                                    ) : (
                                                        <button type="button" onClick={() => { setIssueOpen(r.id); setIssueCount(String(tokenCountOf(r) || '')); }}
                                                            className="rounded-md bg-[#059669] px-2.5 py-1 text-[11px] font-bold text-white hover:bg-[#047857]"
                                                            title="결제 확인 → 발행할 토큰 수 확인 후 지급">
                                                            토큰 발행{tokenCountOf(r) ? ` (${tokenCountOf(r)})` : ''}
                                                        </button>
                                                    )
                                                ) : null}
                                                {r.status === '세팅중' ? (
                                                    <button type="button" onClick={() => {
                                                        const path = '/cafe-rank?sub=' + encodeURIComponent('카페 배포') + '&tab=automation'
                                                            + (r.client_id ? '&client=' + encodeURIComponent(r.client_id) : '');
                                                        window.history.pushState(null, '', path);
                                                        window.dispatchEvent(new Event('app:navigate'));
                                                    }}
                                                        className="rounded-md bg-[#7c3aed] px-2.5 py-1 text-[11px] font-bold text-white hover:bg-[#6d28d9]"
                                                        title="이 건 카페 배포 > 자동화 발행 화면으로 이동">발행하러 가기</button>
                                                ) : null}
                                                {delId === r.id ? (
                                                    <span className="flex items-center gap-1">
                                                        <button type="button" onClick={() => void remove(r)} className="rounded-md bg-[#dc2626] px-2 py-1 text-[11px] font-bold text-white hover:bg-[#b91c1c]">삭제 확인</button>
                                                        <button type="button" onClick={() => setDelId(null)} className="rounded-md border border-[#cbd5e1] px-2 py-1 text-[11px] font-semibold text-[#64748b]">취소</button>
                                                    </span>
                                                ) : (
                                                    <button type="button" onClick={() => setDelId(r.id)} className="rounded-md border border-[#fecaca] px-2 py-1 text-[11px] font-semibold text-[#dc2626] hover:bg-[#fef2f2]" title="이 접수내역 삭제(사진·계정 정리)">삭제</button>
                                                )}
                                            </div>
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
