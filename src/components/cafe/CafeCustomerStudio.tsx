import { useEffect, useState } from 'react';
import { generateCafe, generateCafeReview } from '../../api/cafeWriter';
import { createCustomerPublishJob, listMyCafeJobs } from '../../api/cafePublishQueue';
import { getCafeAccounts } from '../../api/cafeAccounts';
import { CafeCustomerRequest } from './CafeCustomerRequest';

type MyJob = { id: string; title: string; status: string; posted_url: string | null; reason: string | null; created_at: string };

// 파일 → dataURL. 큰 이미지는 브라우저 메모리·업로드 부담 → 긴 변 1600px 로 축소.
function fileToDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload = () => {
            URL.revokeObjectURL(url);
            const max = 1600;
            const scale = Math.min(1, max / Math.max(img.width, img.height));
            const w = Math.round(img.width * scale);
            const h = Math.round(img.height * scale);
            const canvas = document.createElement('canvas');
            canvas.width = w; canvas.height = h;
            const ctx = canvas.getContext('2d');
            if (!ctx) { reject(new Error('canvas')); return; }
            ctx.drawImage(img, 0, 0, w, h);
            resolve(canvas.toDataURL('image/jpeg', 0.9));
        };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('이미지를 읽지 못했습니다.')); };
        img.src = url;
    });
}

const STATUS_KO: Record<string, string> = {
    pending: '대기', processing: '작성 중', posted: '게시됨(확인중)', done: '완료', fail: '실패',
};

// 고객 셀프 카페 발행 스튜디오 (고객 ERP > 카페 > "카페 자동화 발행" 탭)
//   흐름: 승인 확인 → 키워드/주제 입력 → [원고 자동생성](CF) → 제목·본문 편집 → [발행하기].
//   발행 = createCustomerPublishJob → 큐 → 고객 PC 에이전트가 자기 카페에 게시.
//   company/board 는 서버(cafe_accounts + RLS)가 강제, 위조 불가.
//
//   ⚠️ 내일 이어서 할 것(TODO):
//     - 이미지 카드 자동생성(generateCafeCard) + 미리보기·순서. 지금은 텍스트 발행(images:[]).
//     - 발행 현황 목록(내 큐 상태: pending/posted/done) 표시.
//     - 톤/글자수/분량 옵션 노출, 원고 형식검사(마커) — 이미지 붙일 때 필요.
//     - 내부 CafeStudioTab 자산(고정 배너·실사) 재사용 여부 결정.

type Tone = 'review' | 'info' | 'story' | 'talk';
const TONES: { key: Tone; name: string }[] = [
    { key: 'review', name: '후기형' },
    { key: 'info', name: '정보형' },
    { key: 'story', name: '스토리형' },
    { key: 'talk', name: '대화형' },
];

export function CafeCustomerStudio({ clientId }: { clientId: string | null }) {
    const [board, setBoard] = useState<string | null>(null);
    const [brandDefault, setBrandDefault] = useState('');
    const [approved, setApproved] = useState<boolean | null>(null);

    // 입력
    const [keyword, setKeyword] = useState('');
    const [region, setRegion] = useState('');
    const [brand, setBrand] = useState('');
    const [business, setBusiness] = useState('');
    const [tone, setTone] = useState<Tone>('review');
    const [tags, setTags] = useState('');

    // 생성 결과(편집 가능)
    const [title, setTitle] = useState('');
    const [body, setBody] = useState('');
    const [images, setImages] = useState<string[]>([]);   // 첨부 사진 dataURL(상단에 순서대로 게시)

    const [genBusy, setGenBusy] = useState(false);
    const [pubBusy, setPubBusy] = useState(false);
    const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

    // 발행 현황(내 큐 — RLS 로 본인 것만)
    const [jobs, setJobs] = useState<MyJob[]>([]);
    async function loadJobs() {
        const { data } = await listMyCafeJobs(10);
        setJobs(data as MyJob[]);
    }
    useEffect(() => {
        void loadJobs();
        const t = setInterval(() => { void loadJobs(); }, 15000);   // 현황 실시간 갱신(대기→작성중→완료)
        return () => clearInterval(t);
    }, []);

    async function addFiles(files: FileList | null) {
        if (!files || !files.length) return;
        const arr = Array.from(files).slice(0, 10);
        try {
            const urls = await Promise.all(arr.map(fileToDataUrl));
            setImages((prev) => [...prev, ...urls].slice(0, 10));
        } catch (e) {
            setMsg({ ok: false, text: (e as Error).message || '사진을 불러오지 못했습니다.' });
        }
    }

    useEffect(() => {
        let alive = true;
        void getCafeAccounts().then(({ data }) => {
            if (!alive) return;
            // 승인(발행 가능) 계정 = active && publish_enabled!==false (RLS 로 본인 것만 조회됨).
            const enabled = data.find((x) => x.active && (x as { publish_enabled?: boolean }).publish_enabled !== false);
            setBoard(enabled?.board_name ?? null);
            setBrandDefault(enabled?.display_name ?? '');
            if (!brand && enabled?.display_name) setBrand(enabled.display_name);
            setApproved(!!enabled);
        });
        return () => { alive = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [clientId]);

    async function generate() {
        if (!keyword.trim()) {
            setMsg({ ok: false, text: '주제(키워드)를 입력해 주세요. 예) 광교동 입주청소' });
            return;
        }
        setGenBusy(true);
        setMsg(null);
        try {
            // 1) 카드 소재(구조화 원고) 생성 → 2) 그 소재로 후기 본문 생성(layout:'bottom' = 사진 마커 없는 순수 본문).
            const g = await generateCafe({
                keyword: keyword.trim(),
                region: region.trim() || undefined,
                brand: brand.trim() || brandDefault || undefined,
                business: business.trim() || undefined,
            });
            const rv = await generateCafeReview({
                keyword: keyword.trim(),
                region: region.trim() || undefined,
                brand: brand.trim() || brandDefault || undefined,
                business: business.trim() || undefined,
                content: g.content,
                tone,
                count: 6,
                layout: 'bottom',
            });
            setTitle(rv.title || '');
            setBody(rv.reviewBody || '');
            setMsg({ ok: true, text: '원고를 생성했습니다. 내용을 확인·수정한 뒤 발행하세요.' });
        } catch (e) {
            setMsg({ ok: false, text: (e as Error).message || '원고 생성에 실패했습니다.' });
        } finally {
            setGenBusy(false);
        }
    }

    async function publish() {
        if (!title.trim() || !body.trim()) {
            setMsg({ ok: false, text: '제목과 본문이 필요합니다. 먼저 원고를 생성하거나 입력하세요.' });
            return;
        }
        setPubBusy(true);
        setMsg(null);
        const tagList = tags.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 10);
        const { error, jobId } = await createCustomerPublishJob({
            title: title.trim(),
            body,
            images,   // 첨부 사진(상단에 순서대로). 없으면 텍스트만.
            tags: tagList,
        });
        setPubBusy(false);
        if (error) {
            setMsg({ ok: false, text: (error as { message?: string }).message || '발행 등록에 실패했습니다.' });
            return;
        }
        setMsg({ ok: true, text: `발행 등록 완료 — 대기열에 담겼습니다. 잠시 후 카페에 게시됩니다. (#${(jobId || '').slice(0, 8)})` });
        setTitle('');
        setBody('');
        setTags('');
        setImages([]);
        void loadJobs();
    }

    // 미승인(또는 아직 카페계정 없음) → 승인 요청 폼.
    if (approved === false) {
        return <CafeCustomerRequest clientId={clientId} />;
    }

    const inputCls = 'h-10 rounded-lg border border-[#cbd5e1] bg-white px-3 text-sm';

    // 발행 프로그램(에이전트) 미가동 추정 — 대기 글이 3분 넘게 시작 안 되면 경고.
    //   (브릿지 직접 확인은 배포 https→http localhost 혼합콘텐츠로 막혀 부정확 → 큐 진행으로 판단)
    const now = Date.now();
    const stuck = jobs.some((j) => j.status === 'pending' && now - new Date(j.created_at).getTime() > 3 * 60 * 1000);

    return (
        <div className="grid gap-4">
            <div className="rounded-lg bg-[#eff6ff] px-4 py-3 text-sm text-[#1e40af]">
                발행 대상 게시판: <b>{board ?? '(확인 중)'}</b>
                <span className="ml-2 text-[#64748b]">— 발행하면 본인 카페의 이 게시판에 자동 게시됩니다.</span>
            </div>

            {stuck ? (
                <div className="rounded-lg border border-[#fca5a5] bg-[#fef2f2] px-4 py-3 text-sm text-[#b91c1c]">
                    ⚠️ 대기 중인 글이 게시되지 않고 있습니다. 내 PC의 <b>발행 프로그램(DDMKT-Agent)</b>이 실행 중인지 확인해 주세요.
                    <span className="ml-1 text-[#7f1d1d]">(프로그램을 켜면 대기 중인 글부터 순서대로 자동 게시됩니다.)</span>
                </div>
            ) : null}

            {/* 입력 */}
            <div className="rounded-xl border border-[#e2e8f0] bg-white p-4">
                <div className="mb-3 text-[13px] font-bold text-[#334155]">1. 주제 입력 후 원고 자동생성</div>
                <div className="grid gap-3 sm:grid-cols-2">
                    <label className="grid gap-1 text-xs font-semibold text-[#475569]">
                        주제 · 키워드 (필수)
                        <input className={inputCls} onChange={(e) => setKeyword(e.target.value)} placeholder="예) 광교동 입주청소" value={keyword} />
                    </label>
                    <label className="grid gap-1 text-xs font-semibold text-[#475569]">
                        지역 (선택)
                        <input className={inputCls} onChange={(e) => setRegion(e.target.value)} placeholder="예) 수원 광교동" value={region} />
                    </label>
                    <label className="grid gap-1 text-xs font-semibold text-[#475569]">
                        업체명
                        <input className={inputCls} onChange={(e) => setBrand(e.target.value)} placeholder={brandDefault || '업체명'} value={brand} />
                    </label>
                    <label className="grid gap-1 text-xs font-semibold text-[#475569]">
                        업종 (선택)
                        <input className={inputCls} onChange={(e) => setBusiness(e.target.value)} placeholder="예) 입주청소" value={business} />
                    </label>
                    <label className="grid gap-1 text-xs font-semibold text-[#475569]">
                        말투
                        <select className={inputCls} onChange={(e) => setTone(e.target.value as Tone)} value={tone}>
                            {TONES.map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}
                        </select>
                    </label>
                </div>
                <button
                    className="mt-3 h-10 rounded-lg bg-[#4338ca] px-5 text-sm font-bold text-white hover:bg-[#3730a3] disabled:opacity-50"
                    disabled={genBusy}
                    onClick={generate}
                    type="button"
                >
                    {genBusy ? '원고 생성 중… (최대 1~2분)' : '원고 자동생성'}
                </button>
            </div>

            {/* 편집 */}
            <div className="rounded-xl border border-[#e2e8f0] bg-white p-4">
                <div className="mb-3 text-[13px] font-bold text-[#334155]">2. 확인·수정 후 발행</div>
                <label className="grid gap-1 text-xs font-semibold text-[#475569]">
                    제목
                    <input className={inputCls} maxLength={100} onChange={(e) => setTitle(e.target.value)} placeholder="원고 생성 시 자동 입력됩니다" value={title} />
                </label>
                <label className="mt-3 grid gap-1 text-xs font-semibold text-[#475569]">
                    본문
                    <textarea className="min-h-[260px] rounded-lg border border-[#cbd5e1] bg-white px-3 py-2 text-sm font-normal leading-relaxed" onChange={(e) => setBody(e.target.value)} placeholder="원고 생성 시 자동 입력됩니다. 직접 수정할 수 있습니다." value={body} />
                </label>
                <label className="mt-3 grid gap-1 text-xs font-semibold text-[#475569]">
                    태그 (선택, 쉼표로 구분 · 최대 10개)
                    <input className={inputCls} onChange={(e) => setTags(e.target.value)} placeholder="예) 광교동청소, 입주청소, 이사청소" value={tags} />
                </label>

                {/* 사진 첨부(선택) — 본문 위에 순서대로 게시. 최대 10장 */}
                <div className="mt-3 grid gap-1 text-xs font-semibold text-[#475569]">
                    사진 (선택 · 최대 10장 · 본문 위에 순서대로 게시)
                    <div className="flex flex-wrap items-center gap-2">
                        <label className="inline-flex h-9 cursor-pointer items-center rounded-lg border border-[#cbd5e1] bg-white px-3 text-sm font-normal text-[#334155] hover:bg-[#f8fafc]">
                            사진 추가
                            <input accept="image/*" className="hidden" multiple onChange={(e) => { void addFiles(e.target.files); e.target.value = ''; }} type="file" />
                        </label>
                        {images.length ? <span className="text-[12px] font-normal text-[#64748b]">{images.length}장 첨부됨</span> : null}
                    </div>
                    {images.length ? (
                        <div className="mt-1 flex flex-wrap gap-2">
                            {images.map((src, i) => (
                                <div className="relative" key={i}>
                                    <img alt={`첨부 ${i + 1}`} className="h-16 w-16 rounded-md border border-[#e2e8f0] object-cover" src={src} />
                                    <button
                                        className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-[#dc2626] text-[11px] font-bold text-white"
                                        onClick={() => setImages((prev) => prev.filter((_, j) => j !== i))}
                                        title="삭제"
                                        type="button"
                                    >×</button>
                                </div>
                            ))}
                        </div>
                    ) : null}
                </div>

                {msg ? (
                    <div className={`mt-3 rounded-lg px-4 py-3 text-sm ${msg.ok ? 'bg-[#ecfdf5] text-[#047857]' : 'bg-[#fef2f2] text-[#b91c1c]'}`}>
                        {msg.text}
                    </div>
                ) : null}

                <div className="mt-3 flex items-center gap-3">
                    <button
                        className="h-10 rounded-lg bg-[#0f766e] px-5 text-sm font-bold text-white hover:bg-[#115e59] disabled:opacity-50"
                        disabled={pubBusy || genBusy}
                        onClick={publish}
                        type="button"
                    >
                        {pubBusy ? '등록 중…' : '발행하기'}
                    </button>
                    <span className="text-xs text-[#94a3b8]">등록 후 내 PC의 발행 프로그램이 순서대로 카페에 올립니다(즉시 게시 아님).</span>
                </div>
            </div>

            {/* 발행 현황 */}
            <div className="rounded-xl border border-[#e2e8f0] bg-white p-4">
                <div className="mb-2 flex items-center justify-between">
                    <div className="text-[13px] font-bold text-[#334155]">발행 현황</div>
                    <button className="text-xs font-semibold text-[#4338ca] hover:underline" onClick={() => void loadJobs()} type="button">새로고침</button>
                </div>
                {jobs.length ? (
                    <div className="divide-y divide-[#f1f5f9]">
                        {jobs.map((j) => {
                            const st = STATUS_KO[j.status] ?? j.status;
                            const color = j.status === 'done' ? 'text-[#166534]' : j.status === 'fail' ? 'text-[#991b1b]' : 'text-[#64748b]';
                            return (
                                <div className="flex items-center justify-between gap-3 py-1.5 text-[12px]" key={j.id}>
                                    <span className="min-w-0 flex-1 truncate text-[#334155]">{j.title}</span>
                                    {j.posted_url ? (
                                        <a className="shrink-0 text-[#2563eb] hover:underline" href={j.posted_url} rel="noreferrer" target="_blank">게시글 보기</a>
                                    ) : null}
                                    <span className={`shrink-0 font-semibold ${color}`}>{st}</span>
                                </div>
                            );
                        })}
                    </div>
                ) : (
                    <div className="py-4 text-center text-[12px] text-[#94a3b8]">아직 발행 내역이 없습니다.</div>
                )}
            </div>
        </div>
    );
}
