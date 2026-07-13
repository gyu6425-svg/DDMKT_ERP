import { useEffect, useState } from 'react';
import { zipSync, strToU8 } from 'fflate';
import { generateCafe, generateCafeCard, generateCafeReview, type CafeReviewTone } from '../../api/cafeWriter';
import { defaultCafeTitle, DEFAULT_CAFE_CONTENT, mergeCafeContent, type CafeContent } from './cafeContent';

// 카페 원고 생성기 [테스트] 탭 — 비용 절감형.
//   · "생성" 버튼 하나로 원고(후기형) + 첫 장(지역 반영 GPT 카드)를 함께 생성.
//   · 2~8번은 기본 내장 고정 세트 재사용(비용 0). 첫 장은 1번(상단)·마지막(하단)에 재사용.
//   · "다운받기"는 생성 완료 후 활성화 → ZIP(원고.txt + 사진1~N)으로 한 번에 저장.
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

// data:...;base64,xxxx → Uint8Array (zip 바이트).
function dataUrlToU8(dataUrl: string): Uint8Array {
    const b64 = dataUrl.split(',')[1] || '';
    const bin = atob(b64);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) u[i] = bin.charCodeAt(i);
    return u;
}

function downloadBlob(blob: Blob, name: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
}

const TONES: [CafeReviewTone, string][] = [
    ['review', '후기형'],
    ['info', '정보형'],
    ['story', '스토리형'],
    ['talk', '대화형'],
    ['notice', '공지형'],
];

// 입력 필드 — 모듈 최상위에 둬야 함(컴포넌트 내부에 두면 매 렌더 리마운트 → 타이핑 시 포커스 풀림).
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

export function CafeTestTab() {
    const [keyword, setKeyword] = useState('잠실동 누수탐지');
    const [region, setRegion] = useState('잠실동'); // 동 — 큰 타이틀
    const [district, setDistrict] = useState('송파구'); // 구/시 — 상단 작은 배지
    const [phone, setPhone] = useState(DEFAULT_CAFE_CONTENT.phone);
    const [business, setBusiness] = useState('누수탐지');
    const [tone, setTone] = useState<CafeReviewTone>('review');

    const [firstCard, setFirstCard] = useState<string | null>(null); // 지역 반영 첫 장(GPT 생성) — 1·9번 재사용
    const [fixedImages, setFixedImages] = useState<string[]>([]); // 2~8번 고정 이미지(기본 내장 세트 + 업로드)

    // 기본 고정 세트(2~8번) — public/images/cafe-fixed/manifest.json 을 로드. 없으면 빈 채로 시작.
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

    const [content, setContent] = useState<CafeContent>(DEFAULT_CAFE_CONTENT);
    const [title, setTitle] = useState(defaultCafeTitle(DEFAULT_CAFE_CONTENT));
    const [reviewBody, setReviewBody] = useState('');
    const [generating, setGenerating] = useState(false);
    const [downloading, setDownloading] = useState(false);
    const [copied, setCopied] = useState(false);
    const [msg, setMsg] = useState('');

    const bodyText = reviewBody;
    // 글자 수 = 문단바꿈(줄바꿈)과 「사진 N」 마커 제외한 순수 글자.
    const charCount = bodyText.replace(/「사진\s*\d+」/g, '').replace(/[\r\n]/g, '').length;
    // 순서: 1번 = 첫 카드(지역), 2~8번 = 고정 이미지, 마지막 = 첫 카드 다시(하단 북엔드).
    const allImages = firstCard ? [firstCard, ...fixedImages, firstCard] : [...fixedImages];
    // 「사진 N」 마커 개수 = 최종 이미지 수(첫장 상·하단 + 고정). 첫장은 생성 시 항상 만들어지므로 +2.
    const imageCount = fixedImages.length + 2;
    const ready = !!firstCard && !!reviewBody; // 다운로드 활성 조건

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

    // 통합 생성 — 원고(후기형) + 첫 장(지역 반영 GPT 카드)를 함께 생성.
    const generate = async () => {
        if (!keyword.trim() || generating) return;
        setGenerating(true);
        setMsg('원고 + 첫 장 이미지 생성 중… (1~2분)');
        try {
            await Promise.all([
                // ① 원고(소재 → 후기형 본문)
                (async () => {
                    const { content: gen } = await generateCafe({ brand: content.brand, business, keyword, phone, region });
                    const merged = mergeCafeContent({ ...gen, region, phone, business });
                    setContent(merged);
                    const rv = await generateCafeReview({
                        business,
                        content: { ...merged, region, phone, business },
                        count: imageCount,
                        keyword,
                        phone,
                        region,
                        tone,
                    });
                    setReviewBody(rv.reviewBody);
                    setTitle(rv.title || defaultCafeTitle(merged));
                })(),
                // ② 첫 장(지역 반영) GPT 카드 — 1·9번에 재사용
                (async () => {
                    const img = await generateCafeCard({ region, district, topic: business, phone });
                    setFirstCard(img);
                })(),
            ]);
            setMsg('생성 완료 — “다운받기(ZIP)”로 원고 + 사진을 한 번에 저장하세요.');
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

    // 다운로드 — 원고.txt + 사진1~N(각 미세 변형)을 ZIP 하나로 저장.
    const downloadZip = async () => {
        if (downloading || !ready) return;
        setDownloading(true);
        setMsg('ZIP 생성 중… (원고 + 사진)');
        try {
            const files: Record<string, Uint8Array> = {};
            files['원고.txt'] = strToU8(`${title}\n\n${bodyText}`);
            const base = Math.floor(Math.random() * 1e9); // 이번 다운로드 고유 시드
            for (let i = 0; i < allImages.length; i += 1) {
                const varied = await varyImage(allImages[i], base + i * 7919 + 1);
                files[`사진${i + 1}.jpg`] = dataUrlToU8(varied);
            }
            // 이미 압축된 jpg → 무압축(STORE, level 0)로 빠르게 묶음.
            const zipped = zipSync(files, { level: 0 });
            downloadBlob(new Blob([zipped], { type: 'application/zip' }), `${region || '카페'}_카페세트.zip`);
            setMsg(`ZIP 다운로드 완료 — 원고.txt + 사진 ${allImages.length}장(각각 미세 변형).`);
        } catch (e) {
            setMsg(e instanceof Error ? e.message : '다운로드 실패');
        } finally {
            setDownloading(false);
        }
    };

    return (
        <div className="grid gap-5">
            <p className="m-0 text-sm text-[#64748b]">
                <b>“생성”</b> 한 번으로 <b>원고(후기형)</b> + <b>첫 장(지역 반영 AI 카드)</b>를 함께 만듭니다. 2~8번은 <b>기본 내장 고정 세트</b> 재사용(비용 0).
                다 나오면 <b>“다운받기(ZIP)”</b>가 활성화 → <b>원고.txt + 사진1~{imageCount}</b>을 ZIP 하나로 저장(모든 이미지 <b>미세 변형</b>으로 중복 차단 회피).
            </p>

            {/* 입력 */}
            <div className="rounded-xl border border-[#e2e8f0] bg-white p-4">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <Field label="키워드(주제)" value={keyword} onChange={setKeyword} />
                    <Field label="구/시 (예: 송파구)" value={district} onChange={setDistrict} />
                    <Field label="동/지역 (예: 잠실동)" value={region} onChange={setRegion} />
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
                        className="h-10 rounded-md bg-[#4338ca] px-6 text-sm font-bold text-white hover:bg-[#3730a3] disabled:opacity-50"
                        disabled={generating || !keyword.trim()}
                        onClick={() => void generate()}
                        type="button"
                    >
                        {generating ? '생성 중… (원고 + 첫 장)' : '생성'}
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
                {/* 첫 장(지역 반영) — 미리보기(생성 결과) */}
                <div>
                    <div className="mb-1.5 text-[12px] font-semibold text-[#475569]">첫 장 = 1·마지막 (지역 반영 · 상단·하단 북엔드)</div>
                    {firstCard ? (
                        <img alt="" className="h-32 w-32 rounded-md border border-[#e2e8f0] object-cover" src={firstCard} />
                    ) : (
                        <div className="flex h-32 w-32 items-center justify-center rounded-md border-2 border-dashed border-[#cbd5e1] text-[11px] text-[#94a3b8]">
                            “생성” 시 자동 생성
                        </div>
                    )}
                </div>

                {/* 이후 고정 이미지 */}
                <div>
                    <div className="mb-1.5 text-[12px] font-semibold text-[#475569]">
                        2~8번 고정 세트 <span className="font-normal text-[#94a3b8]">— 기본 내장(자동 로드). 필요시 추가/삭제</span>
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
                    placeholder="위 “생성” 버튼을 누르면 선택한 문체(기본: 후기형)의 본문이 여기에 표시됩니다."
                    value={bodyText}
                />
                <p className="mt-1.5 text-[12px] text-[#64748b]">
                    ZIP 안의 <b>원고.txt</b>를 카페 글쓰기에 붙여넣고, 본문의 <b>「사진 N」</b> 위치에 <b>사진N</b>을 순서대로 넣으세요. 다운로드 이미지는 매번 <b>미세 변형</b>돼 중복 차단 위험이 낮습니다.
                </p>
            </div>
        </div>
    );
}
