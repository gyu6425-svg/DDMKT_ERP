import { useEffect, useState } from 'react';
import { generateCafeReview, generateSecurityBanner, type CafeReviewTone } from '../../api/cafeWriter';
import { defaultCafeTitle, DEFAULT_CAFE_CONTENT, mergeCafeContent } from './cafeContent';
import { logApiUsage } from '../../api/apiUsage';
import { computeRecordCostUsd } from '../../lib/apiPricing';
import { useAuth } from '../../hooks/useAuth';
import { getCachedCard, setCachedCard, delCachedCard } from './cardCache';
import { downloadCafeZip } from './cafeExport';
import { saveHistory } from './cafeHistory';
import { SecItemsEditor, resolveSecItems, EMPTY_SEC_ITEMS, type SecItem } from './SecItemsEditor';

// 더맨시스템2 탭 — 블루 보안배너(더맨2 방식) + 원고 + 2~7 저장이미지 + 생성 시 ZIP까지.
//   배너 = generateSecurityBanner(style:'blue') · 원고 = 키워드 기반 후기. 1·8=배너(북엔드), 2~7=고정이미지(속성변형).

const TONES: [CafeReviewTone, string][] = [
    ['review', '후기형'],
    ['info', '정보형'],
    ['story', '스토리형'],
    ['talk', '대화형'],
    ['notice', '공지형'],
];
const QUALITY_OPTS: [('low' | 'medium' | 'high'), string, number][] = [
    ['low', '저화질', 25],
    ['medium', '중화질', 60],
    ['high', '고화질', 240],
];

// 배너 N장 + 고정 M장 → 1·마지막=배너, 중간은 고정(누수탐지 동일 규칙). N=1 → [b, ...fixed, b].
function buildImageOrder(banners: string[], fixed: string[]): string[] {
    if (!banners.length) return [...fixed];
    if (banners.length === 1) return [banners[0], ...fixed, banners[0]];
    const first = banners[0];
    const last = banners[banners.length - 1];
    const mids = banners.slice(1, -1);
    const groups = mids.length + 1;
    const chunks: string[][] = Array.from({ length: groups }, () => []);
    fixed.forEach((img, i) => chunks[i % groups].push(img));
    const middle: string[] = [];
    chunks.forEach((chunk, i) => {
        middle.push(...chunk);
        if (i < mids.length) middle.push(mids[i]);
    });
    return [first, ...middle, last];
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
    return (
        <label className="grid gap-1">
            <span className="text-[12px] font-semibold text-[#475569]">{label}</span>
            <input className="h-9 rounded-md border border-[#cbd5e1] bg-white px-2.5 text-sm" onChange={(e) => onChange(e.target.value)} value={value} />
        </label>
    );
}

export function CafeBanner2Tab() {
    const { profile } = useAuth();
    // 원고
    const [keyword, setKeyword] = useState('일산 회사 보안');
    const [region, setRegion] = useState('일산');
    const [business, setBusiness] = useState('보안');
    const [phone, setPhone] = useState(DEFAULT_CAFE_CONTENT.phone);
    const [tone, setTone] = useState<CafeReviewTone>('review');
    // 블루 배너(더맨2)
    const [secType, setSecType] = useState('회사 보안');
    const [l1, setL1] = useState('건물의');
    const [l2, setL2] = useState('안전을');
    const [l3, setL3] = useState('책임지는');
    const [quality, setQuality] = useState<'low' | 'medium' | 'high'>('low');
    const [manualOn, setManualOn] = useState(false);
    const [manualItems, setManualItems] = useState<SecItem[]>(EMPTY_SEC_ITEMS);

    const [banner, setBanner] = useState<string | null>(null);
    const [fixedImages, setFixedImages] = useState<string[]>([]);
    const [title, setTitle] = useState(defaultCafeTitle(DEFAULT_CAFE_CONTENT));
    const [reviewBody, setReviewBody] = useState('');
    const [generating, setGenerating] = useState(false);
    const [downloading, setDownloading] = useState(false);
    const [copied, setCopied] = useState(false);
    const [msg, setMsg] = useState('');

    const bannerKey = () => `banner2|${region}|${secType}|${l1}|${l2}|${l3}|${quality}`;
    useEffect(() => {
        let alive = true;
        void getCachedCard(bannerKey()).then((img) => alive && img && setBanner(img));
        return () => {
            alive = false;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [region, secType, l1, l2, l3, quality]);

    // 2~7 중간 저장 이미지 — 기본 내장 세트 자동 로드.
    useEffect(() => {
        let alive = true;
        void fetch('/images/cafe-fixed/manifest.json')
            .then((r) => (r.ok ? r.json() : []))
            .then((list) => alive && Array.isArray(list) && list.length && setFixedImages(list as string[]))
            .catch(() => undefined);
        return () => {
            alive = false;
        };
    }, []);

    const allImages = buildImageOrder(banner ? [banner] : [], fixedImages);
    const ready = !!banner && !!reviewBody;

    const readFiles = (files: FileList | null): Promise<string[]> =>
        Promise.all(
            Array.from(files || []).map(
                (f) =>
                    new Promise<string>((res, rej) => {
                        const rd = new FileReader();
                        rd.onload = () => res(String(rd.result));
                        rd.onerror = rej;
                        rd.readAsDataURL(f);
                    }),
            ),
        );

    const generate = async () => {
        if (!keyword.trim() || generating) return;
        const titleLines = [l1, l2, l3].map((s) => s.trim()).filter(Boolean);
        if (!region.trim() || !secType.trim() || !titleLines.length) return setMsg('지역·보안종류·제목(1줄 이상) 입력');
        setGenerating(true);
        setMsg('블루 배너 + 원고 생성 중… (1~2분)');
        const operatorName = (typeof localStorage !== 'undefined' && localStorage.getItem('erp_operator_name')) || null;
        const email = profile?.email ?? null;
        let capBanner: string | null = banner;
        let capReview = '';
        let capTitle = title;
        try {
            const merged = mergeCafeContent({ region, phone, business });
            const [bannerR, reviewR] = await Promise.allSettled([
                (async () => {
                    const cached = await getCachedCard(bannerKey());
                    if (cached) return cached;
                    const t = Date.now();
                    const r = await generateSecurityBanner({ items: resolveSecItems(manualOn, manualItems), quality, region, secType, style: 'blue', titleLines });
                    await setCachedCard(bannerKey(), r.imageDataUrl);
                    const textCost = r.textUsage ? computeRecordCostUsd({ model: 'gpt-5.5', provider: 'openai', usage_raw: r.textUsage }) : 0;
                    const imageCost = computeRecordCostUsd({ banner_size: 'square', image_quality: quality, provider: 'openai', usage_raw: r.imageUsage });
                    if (r.textUsage) void logApiUsage({ cost_usd: textCost, elapsed_ms: Date.now() - t, model: 'sec-items', operator_name: operatorName, provider: 'openai', status: 'success', usage_raw: r.textUsage as never, user_email: email });
                    void logApiUsage({ banner_size: 'square', cost_usd: imageCost, elapsed_ms: Date.now() - t, image_quality: quality, model: 'sec-card2', operator_name: operatorName, provider: 'openai', status: 'success', usage_raw: r.imageUsage as never, user_email: email });
                    return r.imageDataUrl;
                })(),
                (async () => {
                    const t = Date.now();
                    const rv = await generateCafeReview({ business, content: merged, keyword, phone, region, tone });
                    void logApiUsage({ cost_usd: computeRecordCostUsd({ model: 'gpt-5-mini', provider: 'openai', usage_raw: rv.usage ?? null }), elapsed_ms: Date.now() - t, model: 'cafe-post', operator_name: operatorName, provider: 'openai', status: 'success', total_tokens: rv.usage?.total_tokens ?? null, usage_raw: (rv.usage as never) ?? null, user_email: email });
                    return rv;
                })(),
            ]);
            if (bannerR.status === 'fulfilled') {
                capBanner = bannerR.value;
                setBanner(bannerR.value);
            }
            if (reviewR.status === 'fulfilled') {
                capReview = reviewR.value.reviewBody;
                capTitle = reviewR.value.title || defaultCafeTitle(merged);
                setReviewBody(capReview);
                setTitle(capTitle);
            }
            if (reviewR.status === 'rejected') throw reviewR.reason;
            try {
                await saveHistory({ at: Date.now(), bannerCount: 1, business, cardMode: 'banner', district: region, firstCard: capBanner, fixedImages, id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, keyword, phone, region, reviewBody: capReview, title: capTitle, tone });
                window.dispatchEvent(new Event('cafe:history-saved'));
            } catch {
                /* 히스토리 저장 실패는 무시 */
            }
            if (bannerR.status === 'rejected') {
                setMsg('원고 생성 완료 · 배너 실패(다시 시도) — “다운받기(ZIP)”로 원고 저장.');
            } else {
                try {
                    setDownloading(true);
                    const order = buildImageOrder(capBanner ? [capBanner] : [], fixedImages);
                    const n = await downloadCafeZip({ bodyText: capReview, images: order, region, title: capTitle });
                    setMsg(`생성 완료 — 블루 배너 + 원고 + ZIP 자동 다운로드(사진 ${n}장, 각 미세 변형).`);
                } catch {
                    setMsg('생성 완료 — ZIP 자동생성 실패, “다운받기(ZIP)”를 눌러주세요.');
                } finally {
                    setDownloading(false);
                }
            }
        } catch (e) {
            setMsg(e instanceof Error ? e.message : '생성 실패');
        } finally {
            setGenerating(false);
        }
    };

    const copyBody = async () => {
        try {
            await navigator.clipboard.writeText(`${title}\n\n${reviewBody}`);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
        } catch {
            setMsg('복사 실패');
        }
    };
    const downloadZip = async () => {
        if (downloading || !ready) return;
        setDownloading(true);
        setMsg('ZIP 생성 중…');
        try {
            const n = await downloadCafeZip({ bodyText: reviewBody, images: allImages, region, title });
            setMsg(`ZIP 완료 — 원고.txt + 사진 ${n}장.`);
        } catch (e) {
            setMsg(e instanceof Error ? e.message : '다운로드 실패');
        } finally {
            setDownloading(false);
        }
    };

    return (
        <div className="grid gap-5">
            <p className="m-0 text-sm text-[#64748b]">
                <b>더맨2 블루 보안배너</b> + <b>원고</b> 한 번에. 1·8=블루 배너(북엔드), 2~7=저장이미지(속성 변형). <b>생성</b> 시 <b>ZIP까지</b> 자동.
            </p>

            {/* 원고 입력 */}
            <div className="rounded-xl border border-[#e2e8f0] bg-white p-4">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <Field label="키워드(원고 주제)" value={keyword} onChange={setKeyword} />
                    <Field label="지역명" value={region} onChange={setRegion} />
                    <Field label="업종" value={business} onChange={setBusiness} />
                    <Field label="전화번호" value={phone} onChange={setPhone} />
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                    <span className="mr-1 text-[12px] font-semibold text-[#475569]">문체</span>
                    {TONES.map(([k, label]) => (
                        <button className={`rounded-full px-3 py-1 text-[12px] font-semibold ${tone === k ? 'bg-[#7c3aed] text-white' : 'border border-[#cbd5e1] text-[#475569] hover:bg-[#f1f5f9]'}`} key={k} onClick={() => setTone(k)} type="button">
                            {label}
                        </button>
                    ))}
                </div>
            </div>

            {/* 블루 배너 입력 */}
            <div className="rounded-xl border-2 border-[#1e5bd8] bg-[#eff6ff] p-4">
                <div className="mb-2 text-[12px] font-semibold text-[#1e5bd8]">블루 보안배너 (1·8번 · 더맨2 방식)</div>
                <Field label="보안 종류 (예: 회사 보안 / 야외행사 / 공사장)" value={secType} onChange={setSecType} />
                <div className="mt-3">
                    <span className="text-[12px] font-semibold text-[#475569]">제목 (3줄)</span>
                    <div className="mt-1 grid grid-cols-3 gap-2">
                        <input className="h-9 rounded-md border border-[#cbd5e1] bg-white px-2.5 text-sm" onChange={(e) => setL1(e.target.value)} placeholder="1줄" value={l1} />
                        <input className="h-9 rounded-md border border-[#cbd5e1] bg-white px-2.5 text-sm" onChange={(e) => setL2(e.target.value)} placeholder="2줄" value={l2} />
                        <input className="h-9 rounded-md border border-[#cbd5e1] bg-white px-2.5 text-sm" onChange={(e) => setL3(e.target.value)} placeholder="3줄" value={l3} />
                    </div>
                </div>
                <SecItemsEditor accent="#1e5bd8" enabled={manualOn} items={manualItems} setEnabled={setManualOn} setItems={setManualItems} />
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                    <span className="mr-1 text-[12px] font-semibold text-[#475569]">배너 화질</span>
                    {QUALITY_OPTS.map(([k, label, won]) => (
                        <button className={`rounded-full px-3 py-1 text-[12px] font-semibold ${quality === k ? 'bg-[#1e5bd8] text-white' : 'border border-[#cbd5e1] text-[#475569] hover:bg-[#f1f5f9]'}`} key={k} onClick={() => setQuality(k)} type="button">
                            {label} ~{won}원
                        </button>
                    ))}
                </div>
            </div>

            {/* 실행 */}
            <div className="flex flex-wrap items-center gap-2">
                <button className="h-10 rounded-md bg-[#4338ca] px-6 text-sm font-bold text-white hover:bg-[#3730a3] disabled:opacity-50" disabled={generating || !keyword.trim()} onClick={() => void generate()} type="button">
                    {generating ? '생성 중… (배너 + 원고)' : '생성 (배너 + 원고 → ZIP)'}
                </button>
                <button className="h-10 rounded-md border border-[#4338ca] px-5 text-sm font-bold text-[#4338ca] hover:bg-[#eef2ff] disabled:cursor-not-allowed disabled:opacity-40" disabled={downloading || !ready} onClick={() => void downloadZip()} type="button">
                    {downloading ? 'ZIP 생성 중…' : '다운받기 (ZIP)'}
                </button>
                {msg ? <span className="text-[13px] text-[#6366f1]">{msg}</span> : null}
            </div>

            {/* 이미지 */}
            <div className="grid gap-3 rounded-xl border border-[#e2e8f0] bg-white p-4 lg:grid-cols-2">
                <div>
                    <div className="mb-1.5 text-[12px] font-semibold text-[#475569]">블루 배너 (1·8번) <span className="font-normal text-[#94a3b8]">— 같은 조건 재사용(0원)</span></div>
                    <div className="flex items-center gap-2">
                        {banner ? (
                            <>
                                <img alt="" className="h-24 w-24 rounded-md border border-[#e2e8f0] object-cover" src={banner} />
                                <button className="rounded-md border border-[#cbd5e1] px-2.5 py-1 text-[11px] font-semibold text-[#475569] hover:bg-[#f1f5f9]" onClick={() => { void delCachedCard(bannerKey()); setBanner(null); }} type="button">배너 새로</button>
                            </>
                        ) : (
                            <div className="flex h-24 w-24 items-center justify-center rounded-md border-2 border-dashed border-[#cbd5e1] text-[11px] text-[#94a3b8]">“생성” 시 자동</div>
                        )}
                    </div>
                </div>
                <div>
                    <div className="mb-1.5 text-[12px] font-semibold text-[#475569]">중간 저장 이미지 (2~7) <span className="font-normal text-[#94a3b8]">— 기본 내장·추가/삭제</span></div>
                    <div className="flex flex-wrap items-center gap-2">
                        {fixedImages.map((p, i) => (
                            <div className="relative" key={i}>
                                <img alt="" className="h-16 w-16 rounded-md border border-[#e2e8f0] object-cover" src={p} />
                                <button className="absolute -right-1.5 -top-1.5 rounded-full bg-[#dc2626] px-1.5 text-[11px] font-bold text-white" onClick={() => setFixedImages((prev) => prev.filter((_, idx) => idx !== i))} type="button">✕</button>
                            </div>
                        ))}
                        <label className="flex h-16 w-16 cursor-pointer items-center justify-center rounded-md border-2 border-dashed border-[#cbd5e1] text-[11px] font-semibold text-[#94a3b8] hover:bg-[#f8fafc]">
                            + 사진
                            <input accept="image/*" className="hidden" multiple onChange={async (e) => { const arr = await readFiles(e.target.files); setFixedImages((prev) => [...prev, ...arr]); }} type="file" />
                        </label>
                    </div>
                </div>
            </div>

            {/* 원고 */}
            <div className="rounded-xl border border-[#e2e8f0] bg-white p-4">
                <div className="mb-2 flex items-center justify-between">
                    <div className="text-[13px] font-bold text-[#334155]">카페 본문 (복사용)</div>
                    <button className="h-9 rounded-md bg-[#0f766e] px-4 text-sm font-bold text-white hover:bg-[#115e59]" onClick={() => void copyBody()} type="button">{copied ? '복사됨 ✓' : '본문 전체 복사'}</button>
                </div>
                <textarea className="h-[320px] w-full rounded-md border border-[#cbd5e1] bg-white px-3 py-2 text-[13px] leading-6 text-[#0f172a]" onChange={(e) => setReviewBody(e.target.value)} placeholder="“생성” 시 후기 본문이 여기에 표시됩니다." value={reviewBody} />
            </div>
        </div>
    );
}
