import { useEffect, useState } from 'react';
import {
    submitCafeDeployRequest,
    listMyCafeDeployRequests,
    type CafeDeployRequest,
    type CafeDeployInput,
} from '../../api/cafeDeployRequests';

// 카페 배포 '접수' — 고객이 로그인 후 직접 접수 폼 작성 → 제출 → 하단 '내 접수 목록'.
//   금액/정산은 접수에 없음(입금·세팅 후 계약관리에서 별도). 미션 종료일도 없음(건수 계약).
const PHOTO_OPTS = ['제공', '미제공', '일부 제공'];
const PRODUCT_OPTS = ['카페 배포', '맘카페', '기타'];
const STATUS_STYLE: Record<string, string> = {
    접수: 'bg-[#dbeafe] text-[#1e40af]',
    세팅중: 'bg-[#fef9c3] text-[#854d0e]',
    완료: 'bg-[#dcfce7] text-[#166534]',
};

const empty: CafeDeployInput = {
    company_name: '', url: '', keyword: '', mission_start: '',
    daily_count: null, total_count: null, photo_provided: '', product_type: '', note: '',
};

export function CafeDeployIntake({ clientId }: { clientId: string | null }) {
    const [form, setForm] = useState<CafeDeployInput>(empty);
    const [rows, setRows] = useState<CafeDeployRequest[]>([]);
    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState('');

    const reload = () => {
        void listMyCafeDeployRequests().then(({ data }) => setRows(data));
    };
    useEffect(reload, []);

    const set = <K extends keyof CafeDeployInput>(k: K, v: CafeDeployInput[K]) =>
        setForm((f) => ({ ...f, [k]: v }));

    const submit = async () => {
        if (!clientId) return setMsg('고객 계정이 연결되어 있지 않습니다. 담당자에게 문의하세요.');
        if (!form.company_name.trim()) return setMsg('업체명을 입력하세요.');
        setBusy(true); setMsg('');
        const { error } = await submitCafeDeployRequest(clientId, form);
        setBusy(false);
        if (error) return setMsg(`접수 실패: ${error.message}`);
        setMsg('접수되었습니다. 담당자 확인 후 세팅해 드립니다.');
        setForm(empty);
        reload();
    };

    const inputCls = 'h-10 w-full rounded-md border border-[#cbd5e1] px-3 text-sm outline-none focus:border-[#4338ca]';
    const labelCls = 'mb-1 block text-[13px] font-semibold text-[#334155]';

    return (
        <div className="grid gap-5">
            {/* 접수 폼 */}
            <div className="rounded-xl border border-[#e2e8f0] bg-white p-5">
                <div className="mb-1 text-[15px] font-bold text-[#0f172a]">카페 배포 접수</div>
                <p className="mb-4 mt-0 text-[13px] text-[#64748b]">배포를 원하시는 내용을 접수해 주세요. 담당자 확인 후 세팅해 드립니다. (금액·정산은 별도 안내)</p>

                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <div className="md:col-span-2">
                        <label className={labelCls}>업체명 *</label>
                        <input className={inputCls} value={form.company_name} onChange={(e) => set('company_name', e.target.value)} placeholder="test" />
                    </div>
                    <div className="md:col-span-2">
                        <label className={labelCls}>플레이스 URL 또는 홈페이지</label>
                        <input className={inputCls} value={form.url} onChange={(e) => set('url', e.target.value)} placeholder="test" />
                    </div>
                    <div>
                        <label className={labelCls}>키워드 (업종)</label>
                        <input className={inputCls} value={form.keyword} onChange={(e) => set('keyword', e.target.value)} placeholder="test" />
                    </div>
                    <div>
                        <label className={labelCls}>미션 시작일</label>
                        <input className={inputCls} type="date" value={form.mission_start} onChange={(e) => set('mission_start', e.target.value)} />
                    </div>
                    <div>
                        <label className={labelCls}>일 발행건수</label>
                        <input className={inputCls} type="number" min={0} value={form.daily_count ?? ''} onChange={(e) => set('daily_count', e.target.value === '' ? null : Number(e.target.value))} placeholder="test" />
                    </div>
                    <div>
                        <label className={labelCls}>총 발행건수</label>
                        <input className={inputCls} type="number" min={0} value={form.total_count ?? ''} onChange={(e) => set('total_count', e.target.value === '' ? null : Number(e.target.value))} placeholder="test" />
                    </div>
                    <div>
                        <label className={labelCls}>사진 전달</label>
                        <select className={inputCls} value={form.photo_provided} onChange={(e) => set('photo_provided', e.target.value)}>
                            <option value="">선택</option>
                            {PHOTO_OPTS.map((o) => <option key={o} value={o}>{o}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className={labelCls}>상품종류</label>
                        <select className={inputCls} value={form.product_type} onChange={(e) => set('product_type', e.target.value)}>
                            <option value="">선택</option>
                            {PRODUCT_OPTS.map((o) => <option key={o} value={o}>{o}</option>)}
                        </select>
                    </div>
                    <div className="md:col-span-2">
                        <label className={labelCls}>비고</label>
                        <textarea className="min-h-[72px] w-full rounded-md border border-[#cbd5e1] px-3 py-2 text-sm outline-none focus:border-[#4338ca]" value={form.note} onChange={(e) => set('note', e.target.value)} placeholder="test" />
                    </div>
                </div>

                <div className="mt-4 flex items-center gap-3">
                    <button className="h-10 rounded-md bg-[#4338ca] px-6 text-sm font-bold text-white hover:bg-[#3730a3] disabled:opacity-50" disabled={busy || !clientId} onClick={() => void submit()} type="button">
                        {busy ? '접수 중…' : '접수하기'}
                    </button>
                    {msg && <span className="text-[13px] text-[#475569]">{msg}</span>}
                </div>
            </div>

            {/* 내 접수 목록 */}
            <div className="rounded-xl border border-[#e2e8f0] bg-white p-5">
                <div className="mb-3 text-[15px] font-bold text-[#0f172a]">내 접수 목록</div>
                {rows.length === 0 ? (
                    <div className="py-10 text-center text-sm text-[#94a3b8]">접수 내역이 없습니다.</div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[900px] border-collapse text-[13px]">
                            <thead>
                                <tr className="border-b border-[#e2e8f0] text-left text-[#64748b]">
                                    {['작성일', '업체명', 'URL', '키워드(업종)', '미션 시작일', '일 발행', '총 발행', '사진', '상품종류', '비고', '상태'].map((h) => (
                                        <th key={h} className="whitespace-nowrap px-2 py-2 font-semibold">{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map((r) => (
                                    <tr key={r.id} className="border-b border-[#f1f5f9] align-top text-[#334155]">
                                        <td className="whitespace-nowrap px-2 py-2">{r.created_at.slice(0, 10)}</td>
                                        <td className="whitespace-nowrap px-2 py-2 font-semibold">{r.company_name}</td>
                                        <td className="max-w-[180px] truncate px-2 py-2" title={r.url ?? ''}>{r.url ? <a className="text-[#2563eb] underline" href={r.url} target="_blank" rel="noreferrer">{r.url}</a> : '-'}</td>
                                        <td className="whitespace-nowrap px-2 py-2">{r.keyword ?? '-'}</td>
                                        <td className="whitespace-nowrap px-2 py-2">{r.mission_start ?? '-'}</td>
                                        <td className="px-2 py-2 text-center">{r.daily_count ?? '-'}</td>
                                        <td className="px-2 py-2 text-center">{r.total_count ?? '-'}</td>
                                        <td className="whitespace-nowrap px-2 py-2">{r.photo_provided ?? '-'}</td>
                                        <td className="whitespace-nowrap px-2 py-2">{r.product_type ?? '-'}</td>
                                        <td className="max-w-[160px] truncate px-2 py-2" title={r.note ?? ''}>{r.note ?? '-'}</td>
                                        <td className="whitespace-nowrap px-2 py-2">
                                            <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${STATUS_STYLE[r.status] ?? 'bg-[#f1f5f9] text-[#64748b]'}`}>{r.status}</span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}
