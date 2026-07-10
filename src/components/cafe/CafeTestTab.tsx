import { useState } from 'react';
import { generateCafe, generateCafeCard, generateCafeReview, type CafeReviewTone } from '../../api/cafeWriter';
import { buildCafePost, defaultCafeTitle, DEFAULT_CAFE_CONTENT, mergeCafeContent, type CafeContent } from './cafeContent';

// 카페 원고 생성기 [테스트] 탭 — 비용 절감형.
//   · 첫 장만 지역 반영해 GPT로 1회 생성(그 지역용으로 고정 재사용).
//   · 이후 사진들은 사용자가 업로드한 '고정 이미지'를 계속 재사용(비용 0).
//   · 매 글마다 원고(텍스트)만 생성.
//   · 다운로드 시 모든 이미지에 '육안 무변 미세 변형'을 적용 → 매번 고유 해시 → 네이버 중복 업로드 차단 회피.

// mulberry32 시드 난수(변형 재현/독립성).
function rng(seed: number) {
    let a = seed >>> 0;
    return () => {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((res, rej) => {
        const im = new Image();
        im.onload = () => res(im);
        im.onerror = rej;
        im.src = src;
    });
}

// 육안 무변 미세 변형 — 무작위 픽셀 소량 ±1 + JPEG 품질 미세 랜덤 재인코딩. 매 호출 시드가 달라 고유 파일.
async function varyImage(dataUrl: string, seed: number): Promise<string> {
    const img = await loadImage(dataUrl);
    const c = document.createElement('canvas');
    c.width = img.naturalWidth || img.width;
    c.height = img.naturalHeight || img.height;
    const ctx = c.getContext('2d');
    if (!ctx) return dataUrl;
    ctx.drawImage(img, 0, 0, c.width, c.height);
    const r = rng(seed);
    // 무작위 픽셀 ~48개를 ±1 밝기(사실상 안 보임) → 콘텐츠 해시 변경
    for (let k = 0; k < 48; k += 1) {
        const x = Math.floor(r() * c.width);
        const y = Math.floor(r() * c.height);
        const px = ctx.getImageData(x, y, 1, 1);
        const ch = Math.floor(r() * 3);
        px.data[ch] = Math.max(0, Math.min(255, px.data[ch] + (r() < 0.5 ? -1 : 1)));
        ctx.putImageData(px, x, y);
    }
    // JPEG 품질 미세 랜덤(0.90~0.97) 재인코딩 → 바이트/메타 매번 다름
    return c.toDataURL('image/jpeg', 0.9 + r() * 0.07);
}

function download(dataUrl: string, name: string) {
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = name;
    a.click();
}

const TONES: [CafeReviewTone, string][] = [
    ['review', '후기형'],
    ['info', '정보형'],
    ['story', '스토리형'],
    ['talk', '대화형'],
    ['notice', '공지형'],
];

export function CafeTestTab() {
    const [keyword, setKeyword] = useState('과천 누수탐지');
    const [region, setRegion] = useState('과천');
    const [phone, setPhone] = useState(DEFAULT_CAFE_CONTENT.phone);
    const [business, setBusiness] = useState('누수탐지');
    const [tone, setTone] = useState<CafeReviewTone>('review');

    const [firstCard, setFirstCard] = useState<string | null>(null); // 지역 반영 첫 장(GPT 생성 or 업로드)
    const [fixedImages, setFixedImages] = useState<string[]>([]); // 이후 고정 이미지(폴더 업로드)

    const [content, setContent] = useState<CafeContent>(DEFAULT_CAFE_CONTENT);
    const [title, setTitle] = useState(defaultCafeTitle(DEFAULT_CAFE_CONTENT));
    const [reviewBody, setReviewBody] = useState('');
    const [firstBusy, setFirstBusy] = useState(false);
    const [reviewBusy, setReviewBusy] = useState(false);
    const [downloading, setDownloading] = useState(false);
    const [copied, setCopied] = useState(false);
    const [msg, setMsg] = useState('');

    const cards = { ...content, region, phone, business, brand: content.brand };
    const bodyText = reviewBody || buildCafePost(cards, title);
    const allImages = [...(firstCard ? [firstCard] : []), ...fixedImages];
    const totalCount = Math.max(1, allImages.length || 1);

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

    // 첫 장(지역 반영) GPT 1회 생성 — 그 지역용으로 고정 재사용.
    const genFirstCard = async () => {
        if (firstBusy) return;
        setFirstBusy(true);
        setMsg('첫 장(지역 반영) 생성 중… (1~2분)');
        try {
            const img = await generateCafeCard({ region, topic: business, phone, services: '정밀탐지 · 신속공사 · 책임시공' });
            setFirstCard(img);
            setMsg('첫 장 생성 완료 — 이 지역용으로 고정 재사용됩니다.');
        } catch (e) {
            setMsg(e instanceof Error ? e.message : '첫 장 생성 실패');
        } finally {
            setFirstBusy(false);
        }
    };

    // 원고만 생성(저렴) — 이미지 개수만큼 「사진 N」 마커.
    const genReview = async () => {
        if (!keyword.trim() || reviewBusy) return;
        setReviewBusy(true);
        setMsg('원고 생성 중… (1~2분)');
        try {
            const { content: gen } = await generateCafe({ brand: content.brand, business, keyword, phone, region });
            const merged = mergeCafeContent({ ...gen, region, phone, business });
            setContent(merged);
            const rv = await generateCafeReview({
                business,
                content: { ...merged, region, phone, business },
                count: totalCount,
                keyword,
                phone,
                region,
                tone,
            });
            setReviewBody(rv.reviewBody);
            setTitle(rv.title || defaultCafeTitle(merged));
            setMsg('원고 생성 완료 — “다운받기”로 원고 + 이미지(미세 변형)를 저장하세요.');
        } catch (e) {
            setMsg(e instanceof Error ? e.message : '원고 생성 실패');
        } finally {
            setReviewBusy(false);
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

    // 다운로드 — 원고 txt + 각 이미지에 미세 변형(고유 해시) 적용해 저장.
    const downloadAll = async () => {
        if (downloading) return;
        if (!allImages.length) {
            setMsg('이미지가 없습니다. 첫 장 생성 + 고정 이미지 업로드 후 다운로드하세요.');
            return;
        }
        setDownloading(true);
        setMsg('원고 + 이미지(미세 변형) 다운로드 중…');
        try {
            const blob = new Blob([`${title}\n\n${bodyText}`], { type: 'text/plain;charset=utf-8' });
            const turl = URL.createObjectURL(blob);
            download(turl, `${region || '카페'}_원고.txt`);
            URL.revokeObjectURL(turl);
            await new Promise((r) => setTimeout(r, 200));
            const base = Math.floor(Math.random() * 1e9); // 이번 다운로드 고유 시드
            for (let i = 0; i < allImages.length; i += 1) {
                const varied = await varyImage(allImages[i], base + i * 7919 + 1);
                download(varied, `${region || '카페'}_${String(i + 1).padStart(2, '0')}.jpg`);
                await new Promise((r) => setTimeout(r, 250));
            }
            setMsg(`다운로드 완료 — 원고 txt + 이미지 ${allImages.length}장(각각 미세 변형됨, 매번 고유).`);
        } catch (e) {
            setMsg(e instanceof Error ? e.message : '다운로드 실패');
        } finally {
            setDownloading(false);
        }
    };

    const Field = ({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) => (
        <label className="grid gap-1">
            <span className="text-[12px] font-semibold text-[#475569]">{label}</span>
            <input className="h-9 rounded-md border border-[#cbd5e1] bg-white px-2.5 text-sm" onChange={(e) => onChange(e.target.value)} value={value} />
        </label>
    );

    return (
        <div className="grid gap-5">
            <p className="m-0 text-sm text-[#64748b]">
                비용 절감형 — <b>첫 장만 지역 반영해 1회 생성(고정 재사용)</b>, 이후 사진은 업로드한 <b>고정 이미지</b> 재사용. 매 글은 <b>원고만 생성</b>.
                다운로드 시 모든 이미지에 <b>육안 무변 미세 변형</b>을 적용해 <b>네이버 중복 업로드 차단</b>을 회피합니다.
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
                <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button
                        className="h-10 rounded-md bg-[#4338ca] px-5 text-sm font-bold text-white hover:bg-[#3730a3] disabled:opacity-50"
                        disabled={reviewBusy || !keyword.trim()}
                        onClick={() => void genReview()}
                        type="button"
                    >
                        {reviewBusy ? '원고 생성 중…' : '원고 생성'}
                    </button>
                    <button
                        className="h-10 rounded-md border border-[#4338ca] px-5 text-sm font-bold text-[#4338ca] hover:bg-[#eef2ff] disabled:opacity-50"
                        disabled={downloading}
                        onClick={() => void downloadAll()}
                        type="button"
                    >
                        {downloading ? '다운로드 중…' : '다운받기 (원고 txt + 이미지)'}
                    </button>
                    {msg ? <span className="text-[13px] text-[#6366f1]">{msg}</span> : null}
                </div>
            </div>

            {/* 이미지 세트 */}
            <div className="grid gap-3 rounded-xl border border-[#e2e8f0] bg-white p-4 lg:grid-cols-2">
                {/* 첫 장(지역 반영) */}
                <div>
                    <div className="mb-1.5 text-[12px] font-semibold text-[#475569]">첫 장 (지역 반영 · 고정 재사용)</div>
                    <div className="flex items-start gap-2">
                        {firstCard ? (
                            <img alt="" className="h-32 w-32 rounded-md border border-[#e2e8f0] object-cover" src={firstCard} />
                        ) : (
                            <div className="flex h-32 w-32 items-center justify-center rounded-md border-2 border-dashed border-[#cbd5e1] text-[11px] text-[#94a3b8]">
                                첫 장 없음
                            </div>
                        )}
                        <div className="grid gap-1.5">
                            <button
                                className="h-9 rounded-md bg-[#0f766e] px-4 text-[13px] font-bold text-white hover:bg-[#115e59] disabled:opacity-50"
                                disabled={firstBusy}
                                onClick={() => void genFirstCard()}
                                type="button"
                            >
                                {firstBusy ? '생성 중…' : firstCard ? '첫 장 다시 생성' : '첫 장 생성(지역 반영)'}
                            </button>
                            <label className="cursor-pointer rounded-md border border-[#cbd5e1] px-3 py-1.5 text-center text-[12px] font-semibold text-[#475569] hover:bg-[#f1f5f9]">
                                첫 장 직접 업로드
                                <input
                                    accept="image/*"
                                    className="hidden"
                                    onChange={async (e) => {
                                        const arr = await readFiles(e.target.files);
                                        if (arr[0]) setFirstCard(arr[0]);
                                    }}
                                    type="file"
                                />
                            </label>
                        </div>
                    </div>
                </div>

                {/* 이후 고정 이미지 */}
                <div>
                    <div className="mb-1.5 text-[12px] font-semibold text-[#475569]">
                        이후 고정 이미지 <span className="font-normal text-[#94a3b8]">— 폴더의 사진들을 올리면 계속 재사용</span>
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
                    <div className="text-[13px] font-bold text-[#334155]">카페 본문 (복사용)</div>
                    <button className="h-9 rounded-md bg-[#0f766e] px-4 text-sm font-bold text-white hover:bg-[#115e59]" onClick={() => void copyBody()} type="button">
                        {copied ? '복사됨 ✓' : '본문 전체 복사'}
                    </button>
                </div>
                <textarea
                    className="h-[320px] w-full rounded-md border border-[#cbd5e1] bg-white px-3 py-2 text-[13px] leading-6 text-[#0f172a]"
                    onChange={(e) => setReviewBody(e.target.value)}
                    value={bodyText}
                />
                <p className="mt-1.5 text-[12px] text-[#64748b]">
                    본문의 <b>「사진 N」</b> 위치에 위 이미지들을 순서대로 넣으세요. 다운로드된 이미지는 매번 <b>미세 변형</b>돼 있어 같은 사진을 여러 글에 올려도 차단 위험이 낮습니다.
                </p>
            </div>
        </div>
    );
}
