import { useEffect, useState } from 'react';
import {
    submitCafeDeployRequest,
    listCafeDeployRequests,
    uploadDeployPhoto,
    signedDeployUrls,
    type CafeDeployRequest,
    type CafeDeployInput,
    type DeployPhotos,
} from '../../api/cafeDeployRequests';

// 카페 배포 '접수' — 고객이 로그인 후 접수 폼 작성 + 사진(메인배너/실사사진/배너) 업로드 → 제출.
//   사진은 업로드 시 1600px 로 압축(용량·대역폭↓), deploy-intake 버킷의 본인 client_id 폴더에 저장.
//   금액/정산·미션종료일은 접수에 없음(계약관리/건수계약).
type Grp = 'main' | 'real' | 'banner';
const GROUPS: { key: Grp; label: string }[] = [
    { key: 'main', label: '메인배너' },
    { key: 'real', label: '실사사진' },
    { key: 'banner', label: '배너' },
];
const PRODUCT_FIXED = '카페';
const STATUS_STYLE: Record<string, string> = {
    접수: 'bg-[#dbeafe] text-[#1e40af]',
    세팅중: 'bg-[#fef9c3] text-[#854d0e]',
    완료: 'bg-[#dcfce7] text-[#166534]',
};

const empty: CafeDeployInput = {
    company_name: '', url: '', keyword: '', mission_start: '',
    daily_count: null, total_count: null, photo_provided: '', product_type: PRODUCT_FIXED, note: '',
};

// 업로드 전 압축 — 최대 1600px, JPEG 0.85. (실패 시 원본 반환)
async function compressImage(file: File, maxDim = 1600, quality = 0.85): Promise<Blob> {
    try {
        const img = await new Promise<HTMLImageElement>((res, rej) => {
            const im = new Image();
            im.onload = () => res(im);
            im.onerror = rej;
            im.src = URL.createObjectURL(file);
        });
        let w = img.naturalWidth || img.width;
        let h = img.naturalHeight || img.height;
        if (w > maxDim || h > maxDim) {
            const r = Math.min(maxDim / w, maxDim / h);
            w = Math.round(w * r); h = Math.round(h * r);
        }
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const ctx = c.getContext('2d');
        URL.revokeObjectURL(img.src);
        if (!ctx) return file;
        ctx.drawImage(img, 0, 0, w, h);
        return await new Promise<Blob>((res) => c.toBlob((b) => res(b || file), 'image/jpeg', quality));
    } catch {
        return file;
    }
}

export function CafeDeployIntake({ clientId }: { clientId: string | null }) {
    const [form, setForm] = useState<CafeDeployInput>(empty);
    const [files, setFiles] = useState<Record<Grp, File[]>>({ main: [], real: [], banner: [] });
    const [rows, setRows] = useState<CafeDeployRequest[]>([]);
    const [urls, setUrls] = useState<Record<string, string>>({});
    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState('');

    const reload = () => {
        void listCafeDeployRequests(clientId ?? undefined).then(async ({ data }) => {
            setRows(data);
            const paths = data.flatMap((r) => (r.photos ? [...r.photos.main, ...r.photos.real, ...r.photos.banner] : []));
            if (paths.length) setUrls(await signedDeployUrls(paths));
        });
    };
    useEffect(reload, [clientId]);

    const set = <K extends keyof CafeDeployInput>(k: K, v: CafeDeployInput[K]) =>
        setForm((f) => ({ ...f, [k]: v }));
    const addFiles = (g: Grp, list: FileList | null) => {
        if (!list?.length) return;
        setFiles((f) => ({ ...f, [g]: [...f[g], ...Array.from(list)] }));
    };
    const removeFile = (g: Grp, i: number) => setFiles((f) => ({ ...f, [g]: f[g].filter((_, j) => j !== i) }));
    const totalFiles = files.main.length + files.real.length + files.banner.length;

    const submit = async () => {
        if (!clientId) return setMsg('고객 계정이 연결되어 있지 않습니다. 담당자에게 문의하세요.');
        if (!form.company_name.trim()) return setMsg('업체명을 입력하세요.');
        setBusy(true); setMsg('');
        // 사진 업로드(압축)
        const batch = String(Date.now());
        const photos: DeployPhotos = { main: [], real: [], banner: [] };
        try {
            for (const g of ['main', 'real', 'banner'] as Grp[]) {
                for (let i = 0; i < files[g].length; i += 1) {
                    setMsg(`사진 업로드 중… (${g} ${i + 1}/${files[g].length})`);
                    const blob = await compressImage(files[g][i]);
                    const { path, error } = await uploadDeployPhoto(clientId, batch, g, i, blob);
                    if (error || !path) throw new Error(error || '업로드 실패');
                    photos[g].push(path);
                }
            }
        } catch (e) {
            setBusy(false);
            return setMsg('사진 업로드 실패: ' + (e instanceof Error ? e.message : ''));
        }
        const summary = GROUPS.map((g) => (photos[g.key].length ? `${g.label} ${photos[g.key].length}` : '')).filter(Boolean).join(' · ');
        const { error } = await submitCafeDeployRequest(clientId, { ...form, photos, photo_provided: summary });
        setBusy(false);
        if (error) return setMsg(`접수 실패: ${error.message}`);
        setMsg('접수되었습니다. 담당자 확인 후 세팅해 드립니다.');
        setForm(empty); setFiles({ main: [], real: [], banner: [] });
        reload();
    };

    const inputCls = 'h-10 w-full rounded-md border border-[#cbd5e1] px-3 text-sm outline-none focus:border-[#4338ca]';
    const labelCls = 'mb-1 block text-[13px] font-semibold text-[#334155]';

    return (
        <div className="grid gap-5">
            {/* 접수 폼 */}
            <div className="rounded-xl border border-[#e2e8f0] bg-white p-5">
                <div className="mb-1 text-[15px] font-bold text-[#0f172a]">카페 배포 접수</div>
                <p className="mb-4 mt-0 text-[13px] text-[#64748b]">배포를 원하시는 내용과 사진을 접수해 주세요. 담당자 확인 후 세팅해 드립니다. (금액·정산은 별도 안내)</p>

                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <div className="md:col-span-2">
                        <label className={labelCls}>업체명 *</label>
                        <input className={inputCls} value={form.company_name} onChange={(e) => set('company_name', e.target.value)} placeholder="test" />
                    </div>
                    <div className="md:col-span-2">
                        <label className={labelCls}>플레이스 URL 또는 홈페이지</label>
                        <input className={inputCls} value={form.url} onChange={(e) => set('url', e.target.value)} placeholder="www.cafe.naver.com/..." />
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
                        <input className={inputCls} type="number" min={0} value={form.daily_count ?? ''} onChange={(e) => set('daily_count', e.target.value === '' ? null : Number(e.target.value))} placeholder="0건" />
                    </div>
                    <div>
                        <label className={labelCls}>총 발행건수</label>
                        <input className={inputCls} type="number" min={0} value={form.total_count ?? ''} onChange={(e) => set('total_count', e.target.value === '' ? null : Number(e.target.value))} placeholder="0건" />
                    </div>
                    <div>
                        <label className={labelCls}>상품종류</label>
                        <input className={`${inputCls} bg-[#f8fafc] text-[#64748b]`} value={PRODUCT_FIXED} readOnly disabled />
                    </div>
                    <div className="md:col-span-2">
                        <label className={labelCls}>비고</label>
                        <textarea className="min-h-[72px] w-full rounded-md border border-[#cbd5e1] px-3 py-2 text-sm outline-none focus:border-[#4338ca]" value={form.note} onChange={(e) => set('note', e.target.value)} placeholder="test" />
                    </div>
                </div>

                {/* 사진 전달 — 3종 업로드 */}
                <div className="mt-4">
                    <label className={labelCls}>사진 전달 (업로드 시 자동 압축)</label>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                        {GROUPS.map((g) => (
                            <div key={g.key} className="rounded-lg border border-dashed border-[#cbd5e1] bg-[#f8fafc] p-3">
                                <div className="mb-2 flex items-center justify-between">
                                    <span className="text-[13px] font-semibold text-[#334155]">{g.label}</span>
                                    <label className="cursor-pointer rounded-md bg-[#eef2ff] px-2 py-1 text-xs font-bold text-[#4338ca] hover:bg-[#e0e7ff]">
                                        + 추가
                                        <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => { addFiles(g.key, e.target.files); e.target.value = ''; }} />
                                    </label>
                                </div>
                                {files[g.key].length === 0 ? (
                                    <div className="py-4 text-center text-xs text-[#94a3b8]">사진 없음</div>
                                ) : (
                                    <div className="flex flex-wrap gap-2">
                                        {files[g.key].map((f, i) => (
                                            <div key={i} className="relative">
                                                <img src={URL.createObjectURL(f)} alt="" className="h-14 w-14 rounded object-cover" />
                                                <button type="button" onClick={() => removeFile(g.key, i)} className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-[#dc2626] text-[11px] font-bold text-white">×</button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>

                <div className="mt-4 flex items-center gap-3">
                    <button className="h-10 rounded-md bg-[#4338ca] px-6 text-sm font-bold text-white hover:bg-[#3730a3] disabled:opacity-50" disabled={busy || !clientId} onClick={() => void submit()} type="button">
                        {busy ? '접수 중…' : `접수하기${totalFiles ? ` (사진 ${totalFiles})` : ''}`}
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
                        <table className="w-full min-w-[980px] border-collapse text-[13px]">
                            <thead>
                                <tr className="border-b border-[#e2e8f0] text-left text-[#64748b]">
                                    {['작성일', '업체명', 'URL', '키워드(업종)', '미션 시작일', '일 발행', '총 발행', '사진', '비고', '상태'].map((h) => (
                                        <th key={h} className="whitespace-nowrap px-2 py-2 font-semibold">{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map((r) => {
                                    const paths = r.photos ? [...r.photos.main, ...r.photos.real, ...r.photos.banner] : [];
                                    return (
                                        <tr key={r.id} className="border-b border-[#f1f5f9] align-top text-[#334155]">
                                            <td className="whitespace-nowrap px-2 py-2">{r.created_at.slice(0, 10)}</td>
                                            <td className="whitespace-nowrap px-2 py-2 font-semibold">{r.company_name}</td>
                                            <td className="max-w-[160px] truncate px-2 py-2" title={r.url ?? ''}>{r.url ? <a className="text-[#2563eb] underline" href={r.url} target="_blank" rel="noreferrer">{r.url}</a> : '-'}</td>
                                            <td className="whitespace-nowrap px-2 py-2">{r.keyword ?? '-'}</td>
                                            <td className="whitespace-nowrap px-2 py-2">{r.mission_start ?? '-'}</td>
                                            <td className="px-2 py-2 text-center">{r.daily_count ?? '-'}</td>
                                            <td className="px-2 py-2 text-center">{r.total_count ?? '-'}</td>
                                            <td className="px-2 py-2">
                                                {paths.length === 0 ? <span className="text-[#94a3b8]">-</span> : (
                                                    <div className="flex flex-wrap gap-1">
                                                        {paths.map((p) => (
                                                            <a key={p} href={urls[p] || '#'} target="_blank" rel="noreferrer" title={p.split('/').pop() ?? ''} download>
                                                                {urls[p]
                                                                    ? <img src={urls[p]} alt="" className="h-10 w-10 rounded border border-[#e2e8f0] object-cover hover:opacity-80" />
                                                                    : <span className="flex h-10 w-10 items-center justify-center rounded border border-[#e2e8f0] text-[10px] text-[#94a3b8]">…</span>}
                                                            </a>
                                                        ))}
                                                    </div>
                                                )}
                                            </td>
                                            <td className="max-w-[140px] truncate px-2 py-2" title={r.note ?? ''}>{r.note ?? '-'}</td>
                                            <td className="whitespace-nowrap px-2 py-2">
                                                <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${STATUS_STYLE[r.status] ?? 'bg-[#f1f5f9] text-[#64748b]'}`}>{r.status}</span>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}
