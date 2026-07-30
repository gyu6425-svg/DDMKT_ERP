import { useEffect, useState } from 'react';
import {
    listCafeDeployRequests,
    listDeployCredentials,
    signedDeployUrls,
    setCafeDeployStatus,
    type CafeDeployRequest,
    type DeployCredential,
} from '../api/cafeDeployRequests';

// 관리자 — 카페 배포 접수 관리(전 고객). 접수 내용·사진·네이버계정·상태(접수→세팅중→완료)를 한 화면에서.
const STATUSES = ['접수', '세팅중', '완료'];
const ST_STYLE: Record<string, string> = {
    접수: 'bg-[#dbeafe] text-[#1e40af]', 세팅중: 'bg-[#fef9c3] text-[#854d0e]', 완료: 'bg-[#dcfce7] text-[#166534]',
};

export default function CafeDeployAdminPanel() {
    const [rows, setRows] = useState<CafeDeployRequest[]>([]);
    const [urls, setUrls] = useState<Record<string, string>>({});
    const [creds, setCreds] = useState<Record<string, DeployCredential>>({});
    const [reveal, setReveal] = useState<Record<string, boolean>>({});
    const [filter, setFilter] = useState<string>('전체');
    const [msg, setMsg] = useState('');

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
                                        <td className="whitespace-nowrap px-2 py-2">{r.keyword ?? '-'}</td>
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
                                                <div>
                                                    <div>{cd.naver_id ?? '-'}</div>
                                                    <div className="flex items-center gap-1">
                                                        <span className="font-mono">{reveal[r.id] ? (cd.naver_pw ?? '-') : '••••'}</span>
                                                        <button className="rounded border border-[#cbd5e1] px-1 text-[10px] text-[#475569]" onClick={() => setReveal((v) => ({ ...v, [r.id]: !v[r.id] }))} type="button">{reveal[r.id] ? '숨김' : '보기'}</button>
                                                    </div>
                                                </div>
                                            ) : <span className="text-[#94a3b8]">-</span>}
                                        </td>
                                        <td className="whitespace-nowrap px-2 py-2">{r.two_factor ? <span className="font-bold text-[#b45309]">사용</span> : '-'}</td>
                                        <td className="whitespace-nowrap px-2 py-2">
                                            <select className={`rounded-full px-2 py-1 text-xs font-bold ${ST_STYLE[r.status] ?? 'bg-[#f1f5f9] text-[#64748b]'}`} value={r.status} onChange={(e) => void changeStatus(r.id, e.target.value)}>
                                                {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                                            </select>
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
