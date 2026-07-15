import { useEffect, useState } from 'react';
import { generateCafeCard, generateCafeReview, type CafeReviewTone } from '../../api/cafeWriter';
import { defaultCafeTitle, DEFAULT_CAFE_CONTENT, mergeCafeContent } from './cafeContent';
import { logApiUsage } from '../../api/apiUsage';
import { computeRecordCostUsd } from '../../lib/apiPricing';
import { useAuth } from '../../hooks/useAuth';
import { getCachedCard, setCachedCard, delCachedCard } from './cardCache';
import { downloadCafeZip } from './cafeExport';
import { saveHistory } from './cafeHistory';

// 카페 원고 생성기 [테스트(배너)] 탭 — 누수탐지 시스템의 독립 복제(기존 탭과 분리, 자유 실험용).
//   · 원고(부제목+내용, 「사진 N」 마커) + AI 배너 N장(1~9)을 함께 생성.
//   · 배너 배치 = 첫 장 + 마지막 장은 AI 배너, 중간 배너는 저장 이미지 사이에 균등 삽입. N=1이면 첫·마지막 북엔드.
//   · 중간 사진 = 저장 세트(manifest) + 업로드. 캐시는 'banner|i|...' 네임스페이스로 기존 탭과 분리(비용 0 재사용).

const TONES: [CafeReviewTone, string][] = [
    ['review', '후기형'],
    ['info', '정보형'],
    ['story', '스토리형'],
    ['talk', '대화형'],
    ['notice', '공지형'],
];

const MAX_BANNERS = 9;

// 화질별 배너 1장 예상 비용(square, ₩1,500/$ 기준). low=$0.01·medium=$0.04·high=$0.16.
const QUALITY_OPTS: [('low' | 'medium' | 'high'), string, number][] = [
    ['low', '저화질', 15],
    ['medium', '중화질', 60],
    ['high', '고화질', 240],
];

// 배너 N장 + 고정 이미지 M장 → 최종 이미지 순서. 첫·마지막은 배너, 중간 배너는 고정 사이 균등 삽입.
//   N=0 → 고정만. N=1 → [b0, ...고정, b0](북엔드). N≥2 → [b0, ...(고정에 중간배너 삽입)..., b_last].
function buildImageOrder(banners: string[], fixed: string[]): string[] {
    if (!banners.length) return [...fixed];
    if (banners.length === 1) return [banners[0], ...fixed, banners[0]];
    const first = banners[0];
    const last = banners[banners.length - 1];
    const mids = banners.slice(1, -1); // 중간 배너
    // 고정 이미지를 (중간배너 수 + 1) 덩어리로 균등 분배 → 덩어리 사이에 중간배너 삽입.
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
            <input
                className="h-9 rounded-md border border-[#cbd5e1] bg-white px-2.5 text-sm"
                onChange={(e) => onChange(e.target.value)}
                value={value}
            />
        </label>
    );
}

export function CafeBannerTab() {
    const [keyword, setKeyword] = useState('잠실동 누수탐지');
    const [region, setRegion] = useState('잠실동');
    const [district, setDistrict] = useState('송파구');
    const [phone, setPhone] = useState(DEFAULT_CAFE_CONTENT.phone);
    const [business, setBusiness] = useState('누수탐지');
    const [tone, setTone] = useState<CafeReviewTone>('review');
    const [bannerCount, setBannerCount] = useState(1); // 생성할 AI 배너 장수(1~9). 지금 기본 1장.
    const [quality, setQuality] = useState<'low' | 'medium' | 'high'>('low'); // 이미지 화질(비용). 기본 저화질(50원 밑).

    const [banners, setBanners] = useState<string[]>([]); // 생성된 AI 배너들
    const [fixedImages, setFixedImages] = useState<string[]>([]); // 중간 저장 이미지(세트 + 업로드)

    // 기본 고정 세트 — public/images/cafe-fixed/manifest.json (누수탐지와 동일 소스). 없으면 빈 채로 시작.
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

    // 배너 캐시 키 — 기존 탭('default'/'hero')과 분리된 'banner' 네임스페이스 + 배너 인덱스.
    const bannerKey = (i: number) => `banner|${i}|${region}|${district}|${business}|${phone}`;
    // 조건이 바뀌면 캐시에서 배너들을 자동 로드(있으면 미리보기 + 생성 시 재사용).
    useEffect(() => {
        let alive = true;
        void Promise.all(
            Array.from({ length: bannerCount }, (_, i) => getCachedCard(bannerKey(i))),
        ).then((imgs) => {
            if (!alive) return;
            setBanners(imgs.filter((x): x is string => !!x));
        });
        return () => {
            alive = false;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [region, district, business, phone, bannerCount]);

    const [title, setTitle] = useState(defaultCafeTitle(DEFAULT_CAFE_CONTENT));
    const [reviewBody, setReviewBody] = useState('');
    const [generating, setGenerating] = useState(false);
    const [downloading, setDownloading] = useState(false);
    const [copied, setCopied] = useState(false);
    const [msg, setMsg] = useState('');
    const { profile } = useAuth();

    const bodyText = reviewBody;
    const charCount = bodyText.replace(/「사진\s*\d+」/g, '').replace(/[\r\n]/g, '').length;
    const allImages = buildImageOrder(banners, fixedImages);
    // 최종 이미지 수(원고 「사진 N」 마커 수) — 배너 생성 전에도 정확히 예측(N=1은 북엔드 +2, N≥2는 +N).
    const expectedImageCount = fixedImages.length + (bannerCount === 1 ? 2 : bannerCount);
    const imageCount = banners.length ? allImages.length : expectedImageCount; // 표시용(생성 후엔 실제 수)
    const ready = banners.length >= bannerCount && !!reviewBody; // 다운로드 활성 조건

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
        setMsg(`원고 + AI 배너 ${bannerCount}장 생성 중… (1~2분)`);
        const operatorName = (typeof localStorage !== 'undefined' && localStorage.getItem('erp_operator_name')) || null;
        const email = profile?.email ?? null;
        const logText = (usage: { total_tokens?: number } | null | undefined, ms: number, ok: boolean, err?: string) =>
            void logApiUsage({
                cost_usd: ok ? computeRecordCostUsd({ model: 'gpt-5.5', provider: 'openai', usage_raw: usage ?? null }) : null,
                elapsed_ms: ms,
                error_message: err ?? null,
                model: 'cafe-post',
                operator_name: operatorName,
                provider: 'openai',
                status: ok ? 'success' : 'error',
                total_tokens: usage?.total_tokens ?? null,
                usage_raw: (usage as never) ?? null,
                user_email: email,
            });

        // 배너: 캐시에 있으면 재사용(비용 0), 없으면 생성 후 캐시 저장. 인덱스별 독립 캐시.
        const genBanner = async (i: number): Promise<string> => {
            const cached = await getCachedCard(bannerKey(i));
            if (cached) return cached;
            const t = Date.now();
            const { imageDataUrl: img, usage: cardUsage } = await generateCafeCard({ region, topic: business, phone, mode: 'hero', quality });
            await setCachedCard(bannerKey(i), img);
            void logApiUsage({
                banner_size: 'square',
                // 실비용 = 이미지 output 토큰(결정론적) + 배너 요청 텍스트 토큰(usage). 둘 다 정확 반영.
                cost_usd: computeRecordCostUsd({ banner_size: 'square', image_quality: quality, provider: 'openai', usage_raw: cardUsage }),
                elapsed_ms: Date.now() - t,
                image_quality: quality,
                model: 'cafe-card',
                operator_name: operatorName,
                provider: 'openai',
                status: 'success',
                usage_raw: cardUsage,
                user_email: email,
            });
            return img;
        };

        let capReview = '';
        let capTitle = title;
        let capBanners: string[] = [];
        try {
            const [reviewR, bannersR] = await Promise.allSettled([
                (async () => {
                    const merged = mergeCafeContent({ region, phone, business });
                    const t = Date.now();
                    const rv = await generateCafeReview({
                        business,
                        content: merged,
                        count: expectedImageCount,
                        keyword,
                        phone,
                        region,
                        tone,
                    });
                    logText(rv.usage, Date.now() - t, true);
                    capReview = rv.reviewBody;
                    capTitle = rv.title || defaultCafeTitle(merged);
                    setReviewBody(rv.reviewBody);
                    setTitle(rv.title || defaultCafeTitle(merged));
                })(),
                (async () => {
                    // 배너 N장 — 인덱스별 병렬 생성/재사용.
                    const imgs = await Promise.all(Array.from({ length: bannerCount }, (_, i) => genBanner(i)));
                    capBanners = imgs;
                    setBanners(imgs);
                })(),
            ]);
            if (reviewR.status === 'rejected') throw reviewR.reason;
            const imageFailed = bannersR.status === 'rejected';

            let saved = true;
            try {
                await saveHistory({
                    at: Date.now(),
                    bannerCount,
                    business,
                    cardMode: 'banner',
                    district,
                    firstCard: capBanners[0] ?? null,
                    fixedImages,
                    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                    keyword,
                    phone,
                    region,
                    reviewBody: capReview,
                    title: capTitle,
                    tone,
                });
                window.dispatchEvent(new Event('cafe:history-saved'));
            } catch (se) {
                saved = false;
                console.warn('[cafe] 히스토리 저장 실패', se);
            }
            const savedNote = saved ? '· 저장됨' : '· ⚠️ 저장 실패(다른 탭 닫고 새로고침)';
            if (imageFailed) {
                setMsg(`원고 생성 완료 ${savedNote} — 배너 생성 실패(다시 시도). “다운받기(ZIP)”로 원고 저장.`);
            } else {
                // 생성 한 번에 파일(ZIP)까지 자동 생성 — 원고.txt + 사진(1·8 배너·2~7 미세변형).
                try {
                    setDownloading(true);
                    const order = buildImageOrder(capBanners, fixedImages);
                    const n = await downloadCafeZip({ bodyText: capReview, images: order, region, title: capTitle });
                    setMsg(`생성 완료 ${savedNote} — 배너+원고 + ZIP 자동 다운로드(사진 ${n}장, 각 미세 변형).`);
                } catch {
                    setMsg(`생성 완료 ${savedNote} — ZIP 자동생성 실패, 아래 “다운받기(ZIP)”를 눌러주세요.`);
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
            await navigator.clipboard.writeText(`${title}\n\n${bodyText}`);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
        } catch {
            setMsg('복사 실패 — 본문을 직접 선택해 복사하세요.');
        }
    };

    const downloadZip = async () => {
        if (downloading || !ready) return;
        setDownloading(true);
        setMsg('ZIP 생성 중… (원고 + 사진)');
        try {
            const n = await downloadCafeZip({ bodyText, images: allImages, region, title });
            setMsg(`ZIP 다운로드 완료 — 원고.txt + 사진 ${n}장(각각 미세 변형).`);
        } catch (e) {
            setMsg(e instanceof Error ? e.message : '다운로드 실패');
        } finally {
            setDownloading(false);
        }
    };

    return (
        <div className="grid gap-5">
            <p className="m-0 text-sm text-[#64748b]">
                <b>“생성”</b> 한 번으로 <b>원고(부제목+내용)</b> + <b>AI 배너 {bannerCount}장</b>을 만듭니다. 배너는
                <b> 첫 장·마지막 장</b>(N≥2면 중간에도 삽입), 나머지는 <b>저장 이미지</b> 재사용(비용 0). 다 나오면
                <b> “다운받기(ZIP)”</b> → <b>원고.txt + 사진 {imageCount || '…'}</b> 저장(모든 이미지 <b>미세 변형</b>).
            </p>

            {/* 입력 */}
            <div className="rounded-xl border border-[#e2e8f0] bg-white p-4">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <Field label="키워드(주제)" value={keyword} onChange={setKeyword} />
                    <Field label="지역명 (예: 잠실동)" value={region} onChange={setRegion} />
                    <Field label="구/시 (예: 송파구)" value={district} onChange={setDistrict} />
                    <Field label="업종" value={business} onChange={setBusiness} />
                    <Field label="전화번호" value={phone} onChange={setPhone} />
                    <label className="grid gap-1">
                        <span className="text-[12px] font-semibold text-[#475569]">
                            AI 배너 수 <span className="font-normal text-[#94a3b8]">(1~{MAX_BANNERS})</span>
                        </span>
                        <input
                            className="h-9 rounded-md border border-[#cbd5e1] bg-white px-2.5 text-sm"
                            inputMode="numeric"
                            onChange={(e) => {
                                const n = Math.max(1, Math.min(MAX_BANNERS, Number(e.target.value.replace(/[^\d]/g, '')) || 1));
                                setBannerCount(n);
                            }}
                            value={bannerCount}
                        />
                    </label>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                    <span className="mr-1 text-[12px] font-semibold text-[#475569]">문체</span>
                    {TONES.map(([k, label]) => (
                        <button
                            className={`rounded-full px-3 py-1 text-[12px] font-semibold ${tone === k ? 'bg-[#7c3aed] text-white' : 'border border-[#cbd5e1] text-[#475569] hover:bg-[#f1f5f9]'}`}
                            key={k}
                            onClick={() => setTone(k)}
                            type="button"
                        >
                            {label}
                        </button>
                    ))}
                </div>
                {/* 화질(비용) — 배너만 해당. 기본 저화질(≈15원/장, 50원 밑). */}
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                    <span className="mr-1 text-[12px] font-semibold text-[#475569]">배너 화질</span>
                    {QUALITY_OPTS.map(([k, label, won]) => (
                        <button
                            className={`rounded-full px-3 py-1 text-[12px] font-semibold ${quality === k ? 'bg-[#0f766e] text-white' : 'border border-[#cbd5e1] text-[#475569] hover:bg-[#f1f5f9]'}`}
                            key={k}
                            onClick={() => setQuality(k)}
                            type="button"
                        >
                            {label} ~{won}원
                        </button>
                    ))}
                    <span className="ml-1 text-[12px] font-semibold text-[#0f766e]">
                        예상 이미지 비용 ≈ {(bannerCount * (QUALITY_OPTS.find((o) => o[0] === quality)?.[2] ?? 0)).toLocaleString()}원
                        <span className="font-normal text-[#94a3b8]"> (배너 {bannerCount}장 · 재사용 시 0원)</span>
                    </span>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button
                        className="h-10 rounded-md bg-[#4338ca] px-6 text-sm font-bold text-white hover:bg-[#3730a3] disabled:opacity-50"
                        disabled={generating || !keyword.trim()}
                        onClick={() => void generate()}
                        type="button"
                    >
                        {generating ? `생성 중… (원고 + 배너 ${bannerCount})` : '생성'}
                    </button>
                    <button
                        className="h-10 rounded-md border border-[#4338ca] px-5 text-sm font-bold text-[#4338ca] hover:bg-[#eef2ff] disabled:cursor-not-allowed disabled:opacity-40"
                        disabled={downloading || !ready}
                        onClick={() => void downloadZip()}
                        type="button"
                    >
                        {downloading ? 'ZIP 생성 중…' : '다운받기 (ZIP)'}
                    </button>
                    {msg ? <span className="text-[13px] text-[#6366f1]">{msg}</span> : null}
                </div>
            </div>

            {/* 이미지 세트 */}
            <div className="grid gap-3 rounded-xl border border-[#e2e8f0] bg-white p-4 lg:grid-cols-2">
                {/* AI 배너들 */}
                <div>
                    <div className="mb-1.5 text-[12px] font-semibold text-[#475569]">
                        AI 배너 {bannerCount}장 <span className="font-normal text-[#94a3b8]">— 첫·마지막(+중간). 같은 조건이면 재사용(0원)</span>
                    </div>
                    <div className="flex flex-wrap items-start gap-2">
                        {banners.length ? (
                            banners.map((b, i) => (
                                <img alt="" className="h-24 w-24 rounded-md border border-[#e2e8f0] object-cover" key={i} src={b} />
                            ))
                        ) : (
                            <div className="flex h-24 w-24 items-center justify-center rounded-md border-2 border-dashed border-[#cbd5e1] text-[11px] text-[#94a3b8]">
                                “생성” 시 자동 생성
                            </div>
                        )}
                        {banners.length ? (
                            <button
                                className="self-center rounded-md border border-[#cbd5e1] px-2.5 py-1 text-[11px] font-semibold text-[#475569] hover:bg-[#f1f5f9]"
                                onClick={() => {
                                    void Promise.all(Array.from({ length: MAX_BANNERS }, (_, i) => delCachedCard(bannerKey(i))));
                                    setBanners([]);
                                    setMsg('다음 “생성” 때 배너를 새로 뽑습니다(이미지 비용 발생).');
                                }}
                                title="같은 조건이라도 배너를 새 이미지로 다시 생성"
                                type="button"
                            >
                                배너 새로
                            </button>
                        ) : null}
                    </div>
                </div>

                {/* 중간 저장 이미지 */}
                <div>
                    <div className="mb-1.5 text-[12px] font-semibold text-[#475569]">
                        중간 저장 이미지 <span className="font-normal text-[#94a3b8]">— 기본 내장(자동 로드). 필요시 추가/삭제</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        {fixedImages.map((p, i) => (
                            <div className="relative" key={i}>
                                <img alt="" className="h-16 w-16 rounded-md border border-[#e2e8f0] object-cover" src={p} />
                                <button
                                    className="absolute -right-1.5 -top-1.5 rounded-full bg-[#dc2626] px-1.5 text-[11px] font-bold text-white"
                                    onClick={() => setFixedImages((prev) => prev.filter((_, idx) => idx !== i))}
                                    type="button"
                                >
                                    ✕
                                </button>
                            </div>
                        ))}
                        <label className="flex h-16 w-16 cursor-pointer items-center justify-center rounded-md border-2 border-dashed border-[#cbd5e1] text-[11px] font-semibold text-[#94a3b8] hover:bg-[#f8fafc]">
                            + 사진
                            <input
                                accept="image/*"
                                className="hidden"
                                multiple
                                onChange={async (e) => {
                                    const arr = await readFiles(e.target.files);
                                    setFixedImages((prev) => [...prev, ...arr]);
                                }}
                                type="file"
                            />
                        </label>
                    </div>
                </div>
            </div>

            {/* 원고(복사용) */}
            <div className="rounded-xl border border-[#e2e8f0] bg-white p-4">
                <div className="mb-2 flex items-center justify-between">
                    <div className="text-[13px] font-bold text-[#334155]">
                        카페 본문 (복사용) <span className="font-semibold text-[#7c3aed]">({charCount.toLocaleString()}자)</span>
                    </div>
                    <button className="h-9 rounded-md bg-[#0f766e] px-4 text-sm font-bold text-white hover:bg-[#115e59]" onClick={() => void copyBody()} type="button">
                        {copied ? '복사됨 ✓' : '본문 전체 복사'}
                    </button>
                </div>
                <textarea
                    className="h-[320px] w-full rounded-md border border-[#cbd5e1] bg-white px-3 py-2 text-[13px] leading-6 text-[#0f172a]"
                    onChange={(e) => setReviewBody(e.target.value)}
                    placeholder="위 “생성” 버튼을 누르면 선택한 문체의 본문(부제목+내용)이 여기에 표시됩니다."
                    value={bodyText}
                />
                <p className="mt-1.5 text-[12px] text-[#64748b]">
                    ZIP 안의 <b>원고.txt</b>를 카페 글쓰기에 붙여넣고, 본문의 <b>「사진 N」</b> 위치에 <b>사진N</b>을 순서대로 넣으세요.
                </p>
            </div>
        </div>
    );
}
