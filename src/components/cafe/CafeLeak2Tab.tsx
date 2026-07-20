import { useEffect, useState } from 'react';
import { generateCafeCard, generateCafeReview, type CafeReviewTone } from '../../api/cafeWriter';
import { defaultCafeTitle, DEFAULT_CAFE_CONTENT, mergeCafeContent } from './cafeContent';
import { logApiUsage } from '../../api/apiUsage';
import { computeRecordCostUsd } from '../../lib/apiPricing';
import { useAuth } from '../../hooks/useAuth';
import { getCachedCard, setCachedCard, delCachedCard } from './cardCache';
import { downloadCafeZip } from './cafeExport';
import { saveHistory } from './cafeHistory';

// 카페 원고 [누수탐지2] 탭 — 실제 카페 글 구조 재현:
//   ① 카페 프로세스 이미지(AI 히어로 배너) → ② 긴 이미지(업로드) → ③ 일반 사진(업로드) → ④ 본문(하단, 「사진」 마커 없음, [출처] 마무리)
//   기존 누수탐지 소재/프롬프트 재사용(문체·업종). 자동발행 대비: 이미지 순서 = 게시 순서.

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

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
    return (
        <label className="grid gap-1">
            <span className="text-[12px] font-semibold text-[#475569]">{label}</span>
            <input className="h-9 rounded-md border border-[#cbd5e1] bg-white px-2.5 text-sm" onChange={(e) => onChange(e.target.value)} value={value} />
        </label>
    );
}

const stripMarkers = (s: string) => s.replace(/「사진\s*\d+」/g, '').replace(/\n{3,}/g, '\n\n').trim();

export function CafeLeak2Tab() {
    const { profile } = useAuth();
    const [keyword, setKeyword] = useState('잠실동 누수탐지');
    const [region, setRegion] = useState('잠실동');
    const [business, setBusiness] = useState('누수탐지');
    const [phone, setPhone] = useState(DEFAULT_CAFE_CONTENT.phone);
    const [tone, setTone] = useState<CafeReviewTone>('review');
    const [quality, setQuality] = useState<'low' | 'medium' | 'high'>('low');

    const [banner, setBanner] = useState<string | null>(null); // 카페 프로세스(히어로) 이미지
    const [longImages, setLongImages] = useState<string[]>([]); // 긴 이미지(현장 세로 사진)
    const [fixedImages, setFixedImages] = useState<string[]>([]); // 중간 저장 이미지(사진 2~7 · 프리셋 재사용)
    const [photos, setPhotos] = useState<string[]>([]); // 일반 사진(추가 업로드)
    const [title, setTitle] = useState(defaultCafeTitle(DEFAULT_CAFE_CONTENT));
    const [body, setBody] = useState('');
    const [generating, setGenerating] = useState(false);
    const [downloading, setDownloading] = useState(false);
    const [copied, setCopied] = useState(false);
    const [msg, setMsg] = useState('');

    // 프로세스 배너 캐시(조건 동일 시 재사용 0원)
    const bannerKey = () => `leak2|${region}|${business}|${phone}`;
    useEffect(() => {
        let alive = true;
        void getCachedCard(bannerKey()).then((img) => alive && img && setBanner(img));
        return () => {
            alive = false;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [region, business, phone]);

    // 중간 저장 이미지(사진 2~7) — 기본 내장 세트 자동 로드(누수탐지와 동일 소스). 없으면 빈 채로.
    useEffect(() => {
        let alive = true;
        void fetch('/images/cafe-fixed/manifest.json')
            .then((r) => (r.ok ? r.json() : []))
            .then((list) => {
                if (alive && Array.isArray(list) && list.length) setFixedImages(list as string[]);
            })
            .catch(() => undefined);
        return () => {
            alive = false;
        };
    }, []);

    // 게시 순서 = 프로세스 배너 → 긴 이미지 → 중간 저장(사진 2~7) → 일반 사진 (ZIP 순번이 곧 게시 순서)
    const orderedImages = [banner, ...longImages, ...fixedImages, ...photos].filter((x): x is string => !!x);
    const sourceLine = `[출처] ${business} | ${keyword}`;
    const bodyForCopy = (() => {
        const b = stripMarkers(body);
        return b.includes('[출처]') ? b : `${b}\n\n${sourceLine}`;
    })();
    const ready = !!banner && !!body;

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
        setGenerating(true);
        setMsg('프로세스 배너 + 본문 생성 중… (1~2분)');
        const operatorName = (typeof localStorage !== 'undefined' && localStorage.getItem('erp_operator_name')) || null;
        const email = profile?.email ?? null;
        try {
            const merged = mergeCafeContent({ region, phone, business });
            const [bannerR, reviewR] = await Promise.allSettled([
                (async () => {
                    const cached = await getCachedCard(bannerKey());
                    if (cached) return cached;
                    const t = Date.now();
                    const { imageDataUrl: img, usage } = await generateCafeCard({ region, topic: business, phone, mode: 'hero', quality });
                    await setCachedCard(bannerKey(), img);
                    void logApiUsage({
                        banner_size: 'square',
                        cost_usd: computeRecordCostUsd({ banner_size: 'square', image_quality: quality, provider: 'openai', usage_raw: usage }),
                        elapsed_ms: Date.now() - t,
                        image_quality: quality,
                        model: 'cafe-card',
                        operator_name: operatorName,
                        provider: 'openai',
                        status: 'success',
                        usage_raw: usage,
                        user_email: email,
                    });
                    return img;
                })(),
                (async () => {
                    const t = Date.now();
                    const rv = await generateCafeReview({ business, content: merged, keyword, layout: 'bottom', phone, region, tone });
                    void logApiUsage({
                        cost_usd: computeRecordCostUsd({ model: 'gpt-5-mini', provider: 'openai', usage_raw: rv.usage ?? null }),
                        elapsed_ms: Date.now() - t,
                        model: 'cafe-post',
                        operator_name: operatorName,
                        provider: 'openai',
                        status: 'success',
                        total_tokens: rv.usage?.total_tokens ?? null,
                        usage_raw: (rv.usage as never) ?? null,
                        user_email: email,
                    });
                    return rv;
                })(),
            ]);
            if (bannerR.status === 'fulfilled') setBanner(bannerR.value);
            if (reviewR.status === 'fulfilled') {
                setBody(reviewR.value.reviewBody);
                setTitle(reviewR.value.title || defaultCafeTitle(merged));
            }
            if (reviewR.status === 'rejected') throw reviewR.reason;
            let saved = true;
            try {
                await saveHistory({
                    at: Date.now(),
                    bannerCount: 1,
                    business,
                    cardMode: 'banner',
                    district: region,
                    firstCard: bannerR.status === 'fulfilled' ? bannerR.value : null,
                    fixedImages: [...longImages, ...fixedImages, ...photos],
                    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                    keyword,
                    phone,
                    region,
                    reviewBody: reviewR.status === 'fulfilled' ? reviewR.value.reviewBody : '',
                    title: reviewR.status === 'fulfilled' ? reviewR.value.title : title,
                    tone,
                });
                window.dispatchEvent(new Event('cafe:history-saved'));
            } catch {
                saved = false;
            }
            setMsg(`생성 완료 ${saved ? '· 저장됨' : '· ⚠️ 저장 실패'} — 긴 이미지·일반 사진 업로드 후 “다운받기(ZIP)”`);
        } catch (e) {
            setMsg(e instanceof Error ? e.message : '생성 실패');
        } finally {
            setGenerating(false);
        }
    };

    const copyBody = async () => {
        try {
            await navigator.clipboard.writeText(`${title}\n\n${bodyForCopy}`);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
        } catch {
            setMsg('복사 실패 — 본문을 직접 선택해 복사하세요.');
        }
    };

    const downloadZip = async () => {
        if (downloading || !ready) return;
        setDownloading(true);
        setMsg('ZIP 생성 중… (이미지 순서 = 게시 순서)');
        try {
            const n = await downloadCafeZip({ bodyText: bodyForCopy, images: orderedImages, region, title });
            setMsg(`ZIP 완료 — 사진 ${n}장(게시 순서대로 사진1~) + 원고.txt. 카페에 사진 순서대로 넣고 본문 붙여넣기.`);
        } catch (e) {
            setMsg(e instanceof Error ? e.message : '다운로드 실패');
        } finally {
            setDownloading(false);
        }
    };

    const ZoneImgs = ({ imgs, onDel }: { imgs: string[]; onDel: (i: number) => void }) =>
        imgs.map((p, i) => (
            <div className="relative" key={i}>
                <img alt="" className="h-16 w-16 rounded-md border border-[#e2e8f0] object-cover" src={p} />
                <button className="absolute -right-1.5 -top-1.5 rounded-full bg-[#dc2626] px-1.5 text-[11px] font-bold text-white" onClick={() => onDel(i)} type="button">
                    ✕
                </button>
            </div>
        ));

    return (
        <div className="grid gap-5">
            <p className="m-0 text-sm text-[#64748b]">
                실제 카페 글 구조 재현 — <b>프로세스 배너</b>(AI) → <b>긴 이미지</b>(업로드) → <b>일반 사진</b>(업로드) → <b>본문</b>(하단, 마커 없음, <b>[출처]</b> 마무리).
                이미지 <b>순서 = 게시 순서</b>(자동발행 대비).
            </p>

            {/* 입력 */}
            <div className="rounded-xl border border-[#e2e8f0] bg-white p-4">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <Field label="키워드(주제)" value={keyword} onChange={setKeyword} />
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
                    <span className="ml-3 mr-1 text-[12px] font-semibold text-[#475569]">배너 화질</span>
                    {QUALITY_OPTS.map(([k, label, won]) => (
                        <button className={`rounded-full px-3 py-1 text-[12px] font-semibold ${quality === k ? 'bg-[#0f766e] text-white' : 'border border-[#cbd5e1] text-[#475569] hover:bg-[#f1f5f9]'}`} key={k} onClick={() => setQuality(k)} type="button">
                            {label} ~{won}원
                        </button>
                    ))}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button className="h-10 rounded-md bg-[#4338ca] px-6 text-sm font-bold text-white hover:bg-[#3730a3] disabled:opacity-50" disabled={generating || !keyword.trim()} onClick={() => void generate()} type="button">
                        {generating ? '생성 중… (배너 + 본문)' : '생성 (배너 + 본문)'}
                    </button>
                    <button className="h-10 rounded-md border border-[#4338ca] px-5 text-sm font-bold text-[#4338ca] hover:bg-[#eef2ff] disabled:cursor-not-allowed disabled:opacity-40" disabled={downloading || !ready} onClick={() => void downloadZip()} type="button">
                        {downloading ? 'ZIP 생성 중…' : '다운받기 (ZIP)'}
                    </button>
                    {msg ? <span className="text-[13px] text-[#6366f1]">{msg}</span> : null}
                </div>
            </div>

            {/* 이미지 세트 — 순서: 프로세스 배너 → 긴 이미지 → 일반 사진 */}
            <div className="grid gap-3 rounded-xl border border-[#e2e8f0] bg-white p-4">
                <div>
                    <div className="mb-1.5 text-[12px] font-semibold text-[#475569]">① 프로세스 배너 (AI · 맨 위) <span className="font-normal text-[#94a3b8]">— 같은 조건이면 재사용(0원)</span></div>
                    <div className="flex items-center gap-2">
                        {banner ? (
                            <>
                                <img alt="" className="h-24 w-24 rounded-md border border-[#e2e8f0] object-cover" src={banner} />
                                <button className="rounded-md border border-[#cbd5e1] px-2.5 py-1 text-[11px] font-semibold text-[#475569] hover:bg-[#f1f5f9]" onClick={() => { void delCachedCard(bannerKey()); setBanner(null); setMsg('다음 “생성” 때 배너 새로(비용 발생).'); }} type="button">
                                    배너 새로
                                </button>
                            </>
                        ) : (
                            <div className="flex h-24 w-24 items-center justify-center rounded-md border-2 border-dashed border-[#cbd5e1] text-[11px] text-[#94a3b8]">“생성” 시 자동</div>
                        )}
                    </div>
                </div>
                <div className="grid gap-3 lg:grid-cols-2">
                    <div>
                        <div className="mb-1.5 text-[12px] font-semibold text-[#475569]">② 긴 이미지 <span className="font-normal text-[#94a3b8]">— 세로로 긴 현장 사진(순서대로)</span></div>
                        <div className="flex flex-wrap items-center gap-2">
                            <ZoneImgs imgs={longImages} onDel={(i) => setLongImages((p) => p.filter((_, j) => j !== i))} />
                            <label className="flex h-16 w-16 cursor-pointer items-center justify-center rounded-md border-2 border-dashed border-[#cbd5e1] text-[11px] font-semibold text-[#94a3b8] hover:bg-[#f8fafc]">
                                + 긴 이미지
                                <input accept="image/*" className="hidden" multiple onChange={async (e) => { const arr = await readFiles(e.target.files); setLongImages((p) => [...p, ...arr]); }} type="file" />
                            </label>
                        </div>
                    </div>
                    <div>
                        <div className="mb-1.5 text-[12px] font-semibold text-[#475569]">③ 중간 저장 이미지 (사진 2~7) <span className="font-normal text-[#94a3b8]">— 기본 내장(자동 로드)·재사용</span></div>
                        <div className="flex flex-wrap items-center gap-2">
                            <ZoneImgs imgs={fixedImages} onDel={(i) => setFixedImages((p) => p.filter((_, j) => j !== i))} />
                            <label className="flex h-16 w-16 cursor-pointer items-center justify-center rounded-md border-2 border-dashed border-[#cbd5e1] text-[11px] font-semibold text-[#94a3b8] hover:bg-[#f8fafc]">
                                + 사진
                                <input accept="image/*" className="hidden" multiple onChange={async (e) => { const arr = await readFiles(e.target.files); setFixedImages((p) => [...p, ...arr]); }} type="file" />
                            </label>
                        </div>
                    </div>
                </div>
                <div>
                    <div className="mb-1.5 text-[12px] font-semibold text-[#475569]">④ 일반 사진 <span className="font-normal text-[#94a3b8]">— 추가 현장 사진(맨 뒤, 순서대로)</span></div>
                    <div className="flex flex-wrap items-center gap-2">
                        <ZoneImgs imgs={photos} onDel={(i) => setPhotos((p) => p.filter((_, j) => j !== i))} />
                        <label className="flex h-16 w-16 cursor-pointer items-center justify-center rounded-md border-2 border-dashed border-[#cbd5e1] text-[11px] font-semibold text-[#94a3b8] hover:bg-[#f8fafc]">
                            + 사진
                            <input accept="image/*" className="hidden" multiple onChange={async (e) => { const arr = await readFiles(e.target.files); setPhotos((p) => [...p, ...arr]); }} type="file" />
                        </label>
                    </div>
                </div>
                <div className="text-[11px] text-[#94a3b8]">게시 순서: 프로세스 배너 → 긴 이미지({longImages.length}) → 사진 2~7({fixedImages.length}) → 일반 사진({photos.length}) · 총 {orderedImages.length}장</div>
            </div>

            {/* 본문 */}
            <div className="rounded-xl border border-[#e2e8f0] bg-white p-4">
                <div className="mb-2 flex items-center justify-between">
                    <div className="text-[13px] font-bold text-[#334155]">카페 본문 (하단 · 복사용)</div>
                    <button className="h-9 rounded-md bg-[#0f766e] px-4 text-sm font-bold text-white hover:bg-[#115e59]" onClick={() => void copyBody()} type="button">
                        {copied ? '복사됨 ✓' : '본문 전체 복사'}
                    </button>
                </div>
                <textarea className="h-[320px] w-full rounded-md border border-[#cbd5e1] bg-white px-3 py-2 text-[13px] leading-6 text-[#0f172a]" onChange={(e) => setBody(e.target.value)} placeholder="“생성” 시 후기 본문이 여기에 표시됩니다(마커 없음, 끝에 [출처])." value={body} />
                <p className="mt-1.5 text-[12px] text-[#64748b]">카페 글쓰기에 <b>이미지들을 위 순서대로 먼저</b> 넣고, 이 본문을 <b>맨 아래</b>에 붙여넣으세요. (자동발행 시 이 순서 그대로 게시)</p>
            </div>
        </div>
    );
}
