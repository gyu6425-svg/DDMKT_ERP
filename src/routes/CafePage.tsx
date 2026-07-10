import { useEffect, useMemo, useRef, useState } from 'react';
import { getFontEmbedCSS, toPng } from 'html-to-image';
import { generateCafe, generateCafeReview, type CafeReviewTone } from '../api/cafeWriter';
import { generateAiCardImage } from '../api/aiCardImage';
import type { BannerForm, BannerSize } from '../routes/BannerGeneratorPage';
import { deleteCafeOutput, getCafeOutputs, saveCafeOutput, type CafeOutput } from '../api/cafeOutputs';
import {
    buildCafePost,
    defaultCafeTitle,
    DEFAULT_CAFE_CONTENT,
    mergeCafeContent,
    type CafeContent,
} from '../components/cafe/cafeContent';
import { CafeCard, CAFE_CARD_LABELS, CARD_H, CARD_W } from '../components/cafe/CafeCards';

// 카페 원고 자동생성기 — 키워드 → Claude(OpenAI) 원고 생성 → 9장 카드 템플릿 렌더 → PNG 다운로드.
//   AI 이미지가 아니라 HTML/CSS 템플릿 캡처라 한글·전화번호·FAQ가 100% 정확.

const PREVIEW_SCALE = 0.27;

// 공통 입력 필드
function Field({ label, value, onChange, wide }: { label: string; value: string; onChange: (v: string) => void; wide?: boolean }) {
    return (
        <label className={`grid gap-1 ${wide ? 'sm:col-span-2' : ''}`}>
            <span className="text-[12px] font-semibold text-[#475569]">{label}</span>
            <input
                className="h-9 rounded-md border border-[#cbd5e1] bg-white px-2.5 text-sm"
                onChange={(e) => onChange(e.target.value)}
                value={value}
            />
        </label>
    );
}

function CafePage() {
    const [keyword, setKeyword] = useState('과천 누수탐지');
    const [brand, setBrand] = useState(DEFAULT_CAFE_CONTENT.brand);
    const [branch, setBranch] = useState(DEFAULT_CAFE_CONTENT.branch);
    const [region, setRegion] = useState('과천');
    const [phone, setPhone] = useState(DEFAULT_CAFE_CONTENT.phone);
    const [business, setBusiness] = useState('누수탐지');

    const [content, setContent] = useState<CafeContent>(DEFAULT_CAFE_CONTENT);
    const [title, setTitle] = useState(defaultCafeTitle(DEFAULT_CAFE_CONTENT));
    const [msg, setMsg] = useState('');
    const [downloading, setDownloading] = useState(false);
    const [copied, setCopied] = useState(false);
    const [reviewBody, setReviewBody] = useState(''); // AI 후기 본문(있으면 이걸 씀, 없으면 기본 조립)
    const [reviewBusy, setReviewBusy] = useState(false);
    const [tone, setTone] = useState<CafeReviewTone>('review'); // 원고 톤(기본 후기형)
    const [bgImage, setBgImage] = useState<string | null>(null); // AI 생성 무드 배경(9장 공유)
    const [photos, setPhotos] = useState<string[]>([]); // 업로드한 현장 사진(커버 메인+01/02 인서트)
    const [allBusy, setAllBusy] = useState(false); // 한번에 생성 진행 중

    const addPhotos = async (files: FileList | null) => {
        if (!files) return;
        const read = (f: File) =>
            new Promise<string>((res, rej) => {
                const r = new FileReader();
                r.onload = () => res(String(r.result));
                r.onerror = rej;
                r.readAsDataURL(f);
            });
        const arr = await Promise.all(Array.from(files).slice(0, 6).map(read));
        setPhotos((prev) => [...prev, ...arr].slice(0, 6));
    };
    const removePhoto = (i: number) => setPhotos((prev) => prev.filter((_, idx) => idx !== i));
    const [includeImage, setIncludeImage] = useState(true); // 한번에 생성 시 AI 이미지 포함(유료)
    const [cardCount, setCardCount] = useState(9); // 뽑을 카드 장수(1~9)
    const [saved, setSaved] = useState<CafeOutput[]>([]); // 저장 갤러리
    const [saving, setSaving] = useState(false);

    const loadSaved = () => void getCafeOutputs(30).then(({ data }) => setSaved(data));
    useEffect(() => {
        loadSaved();
    }, []);

    const onSave = async () => {
        if (saving) return;
        setSaving(true);
        setMsg('저장 중…');
        const operator = window.localStorage.getItem('operator_name');
        const { error } = await saveCafeOutput({
            bg_image: bgImage,
            content: { ...content, brand, branch, phone, region },
            keyword,
            operator_name: operator,
            region,
            review_body: reviewBody || null,
            title,
            tone,
        });
        setSaving(false);
        if (error) {
            setMsg('저장 실패 — cafe_outputs 테이블이 필요합니다(docs/cafe-outputs-table.sql 실행).');
            return;
        }
        setMsg('저장됨 — 아래 갤러리에서 다시 불러올 수 있습니다.');
        loadSaved();
    };

    const restore = (o: CafeOutput) => {
        if (o.content) setContent(o.content);
        if (o.title) setTitle(o.title);
        setReviewBody(o.review_body || '');
        setBgImage(o.bg_image || null);
        if (o.region) setRegion(o.region);
        if (o.keyword) setKeyword(o.keyword);
        if (o.tone) setTone(o.tone as CafeReviewTone);
        setMsg('불러왔습니다.');
    };

    const remove = async (id: string) => {
        await deleteCafeOutput(id);
        loadSaved();
    };

    const cardRefs = useRef<Array<HTMLDivElement | null>>([]);


    // 고정 정보(브랜드/지점/전화/지역)를 콘텐츠에 항상 주입 — 생성 결과에 관계없이 정확.
    const fixed = useMemo(
        () => ({ brand, branch, phone, region, business }),
        [brand, branch, phone, region, business],
    );
    const cards = useMemo<CafeContent>(() => ({ ...content, ...fixed }), [content, fixed]);
    // 카드 문구로 기본 조립한 본문(후기 미생성 시 폴백).
    const postText = useMemo(() => buildCafePost(cards, title), [cards, title]);
    // 실제 표시/복사 본문 = AI 후기(있으면) 우선, 없으면 기본 조립.
    const bodyText = reviewBody || postText;

    const copyBody = async () => {
        try {
            await navigator.clipboard.writeText(bodyText);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
        } catch {
            setMsg('복사 실패 — 본문 영역을 직접 선택해 복사하세요.');
        }
    };

    // AI 후기성 본문 생성 — 현재 카드 콘텐츠를 소재로 후기/경험 형식 글 작성.
    const onGenerateReview = async () => {
        if (reviewBusy) return;
        setReviewBusy(true);
        setMsg('후기 본문 생성 중… (최대 1~2분)');
        try {
            const r = await generateCafeReview({ brand, branch, business, content: cards, keyword, phone, region, tone });
            setReviewBody(r.reviewBody);
            if (r.title) setTitle(r.title);
            setMsg('후기 본문 생성 완료 — 카페 글쓰기에 복사해 쓰세요.');
        } catch (e) {
            setMsg(e instanceof Error ? e.message : '후기 생성 실패');
        } finally {
            setReviewBusy(false);
        }
    };


    // AI 무드 배경 생성(재사용) — 텍스트 없는 실사 느낌 배경 dataURL 반환. 배너 생성기 backgroundOnly 파이프라인.
    const generateBgImage = async (): Promise<string> => {
        const bannerSize: BannerSize = { height: 1080, id: 'square', label: '1080 x 1080', name: '정사각형', width: 1080 };
        const form: BannerForm = {
            title: '',
            subtitle: '',
            emphasis: '',
            badge: '',
            cta: '',
            backgroundColor: '#0f2947',
            accentColor: '#3b82f6',
            textColor: '#ffffff',
            layoutVariant: 'photo',
        };
        const r = await generateAiCardImage({
            backgroundOnly: true,
            bannerSize,
            form,
            imageQuality: 'medium',
            provider: 'openai',
            rawText: `한국 ${business} 실제 현장 홍보 카드의 사진 배경. 욕실/주택 배관 누수 탐지·수리 현장을 다큐멘터리 실사 사진처럼: 회색 PVC 배관, 벽·바닥 타일, 노후 배관 교체 장면, 전문 누수탐지 장비 느낌, 은은한 파란 물방울·물 튀김. 어둡고 묵직한 남색(네이비) 톤에 선명한 파란 포인트, 현장감·신뢰감. 상단과 하단은 어둡게 비워 흰 텍스트가 얹히도록 여백 확보. 글자·문자·숫자·로고·워터마크 절대 없음.`,
        });
        return r.imageDataUrl;
    };

    // 한번에 생성 — 원고(카드) → 후기 본문 → (선택)AI 배경 을 순차로.
    const onGenerateAll = async () => {
        if (!keyword.trim() || allBusy) return;
        setAllBusy(true);
        try {
            setMsg('① 원고(카드) 생성 중…');
            const { content: gen } = await generateCafe({ brand, branch, business, keyword, phone, region });
            const merged = mergeCafeContent({ ...gen, ...fixed });
            setContent(merged);
            setTitle(defaultCafeTitle(merged));
            if (gen.region && !region) setRegion(gen.region);
            const mergedCards = { ...merged, ...fixed };

            setMsg('② 후기 본문 생성 중…');
            const rv = await generateCafeReview({ brand, branch, business, content: mergedCards, keyword, phone, region, tone });
            setReviewBody(rv.reviewBody);
            if (rv.title) setTitle(rv.title);

            if (includeImage) {
                setMsg('③ AI 배경 생성 중… (이미지 1장)');
                setBgImage(await generateBgImage());
            }
            setMsg('완료! “전체 9장 다운로드” + “본문 전체 복사”로 사용하세요.');
        } catch (e) {
            setMsg(e instanceof Error ? e.message : '생성 실패 (로컬은 api:dev 필요)');
        } finally {
            setAllBusy(false);
        }
    };

    const downloadOne = async (i: number, fontEmbedCSS?: string) => {
        const node = cardRefs.current[i];
        if (!node) return;
        const dataUrl = await toPng(node, { pixelRatio: 2, cacheBust: true, fontEmbedCSS, width: CARD_W, height: CARD_H });
        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = `${region || '카페'}_${String(i + 1).padStart(2, '0')}.png`;
        a.click();
    };

    // 원고(txt) 1개 + 카드 이미지(png) 9개 = 총 10개 파일 다운로드.
    const downloadAll = async () => {
        if (downloading) return;
        setDownloading(true);
        setMsg('원고 + 이미지 9장 다운로드 중…');
        try {
            // 1) 원고 txt (제목 + 카페 본문)
            const txt = `${title}\n\n${bodyText}`;
            const blob = new Blob([txt], { type: 'text/plain;charset=utf-8' });
            const turl = URL.createObjectURL(blob);
            const ta = document.createElement('a');
            ta.href = turl;
            ta.download = `${region || '카페'}_원고.txt`;
            ta.click();
            URL.revokeObjectURL(turl);
            await new Promise((r) => setTimeout(r, 200));
            // 2) 카드 이미지 9장 png (폰트 임베드 CSS는 한 번만 계산해 재사용)
            const first = cardRefs.current.find(Boolean);
            const fontEmbedCSS = first ? await getFontEmbedCSS(first) : undefined;
            for (let i = 0; i < cardCount; i += 1) {
                await downloadOne(i, fontEmbedCSS);
                await new Promise((r) => setTimeout(r, 250)); // 브라우저 다운로드 큐 여유
            }
            setMsg('다운로드 완료 — 원고 txt 1개 + 이미지 9장(총 10개).');
        } catch (e) {
            setMsg(e instanceof Error ? e.message : '다운로드 실패');
        } finally {
            setDownloading(false);
        }
    };

    return (
        <section className="grid gap-5">
            <div className="flex flex-wrap items-center gap-2">
                <h2 className="m-0 text-[22px] font-semibold text-[#0f172a]">카페 원고 자동생성기</h2>
                <span className="rounded-full bg-[#e0e7ff] px-2.5 py-1 text-xs font-bold text-[#4338ca]">9장 카드뉴스</span>
            </div>
            <p className="m-0 text-sm text-[#64748b]">
                키워드를 넣으면 원고를 생성하고, 예시와 동일한 9장 카드(커버·CHECK 01~07·약속)로 만들어 PNG로 저장합니다.
                텍스트는 템플릿에 정확히 렌더됩니다(전화·FAQ 깨짐 없음).
            </p>

            {/* 입력 */}
            <div className="rounded-xl border border-[#e2e8f0] bg-white p-4">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <Field label="키워드(주제)" value={keyword} onChange={setKeyword} />
                    <Field label="지역명" value={region} onChange={setRegion} />
                    <Field label="업종" value={business} onChange={setBusiness} />
                    <Field label="업체명(브랜드)" value={brand} onChange={setBrand} />
                    <Field label="지점(푸터 표기)" value={branch} onChange={setBranch} />
                    <Field label="전화번호" value={phone} onChange={setPhone} />
                </div>

                {/* 현장 사진 업로드 — 레퍼런스처럼 합성(첫 사진=메인, 2·3번째=01/02 인서트) */}
                <div className="mt-3">
                    <div className="mb-1.5 text-[12px] font-semibold text-[#475569]">
                        현장 사진 <span className="font-normal text-[#94a3b8]">— 첫 사진=커버 메인, 2·3번째=01/02 인서트 (없으면 AI 배경 사용)</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        {photos.map((p, i) => (
                            <div className="relative" key={i}>
                                <img alt="" className="h-16 w-16 rounded-md border border-[#e2e8f0] object-cover" src={p} />
                                <span className="absolute bottom-0 left-0 rounded-tr bg-black/60 px-1 text-[9px] font-bold text-white">
                                    {i === 0 ? '메인' : `0${i}`}
                                </span>
                                <button
                                    className="absolute -right-1.5 -top-1.5 rounded-full bg-[#dc2626] px-1.5 text-[11px] font-bold text-white"
                                    onClick={() => removePhoto(i)}
                                    type="button"
                                >
                                    ✕
                                </button>
                            </div>
                        ))}
                        {photos.length < 6 ? (
                            <label className="flex h-16 w-16 cursor-pointer items-center justify-center rounded-md border-2 border-dashed border-[#cbd5e1] text-[11px] font-semibold text-[#94a3b8] hover:bg-[#f8fafc]">
                                + 사진
                                <input accept="image/*" className="hidden" multiple onChange={(e) => void addPhotos(e.target.files)} type="file" />
                            </label>
                        ) : null}
                    </div>
                </div>

                {/* 원고 문체 — 생성 전에 선택(한번에 생성에 반영) */}
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                    <span className="mr-1 text-[12px] font-semibold text-[#475569]">문체</span>
                    {([
                        ['review', '후기형'],
                        ['info', '정보형'],
                        ['story', '스토리형'],
                        ['talk', '대화형'],
                        ['notice', '공지형'],
                    ] as [CafeReviewTone, string][]).map(([k, label]) => (
                        <button
                            className={`rounded-full px-3 py-1 text-[12px] font-semibold ${
                                tone === k ? 'bg-[#7c3aed] text-white' : 'border border-[#cbd5e1] text-[#475569] hover:bg-[#f1f5f9]'
                            }`}
                            key={k}
                            onClick={() => setTone(k)}
                            type="button"
                        >
                            {label}
                        </button>
                    ))}
                    <span className="ml-4 mr-1 text-[12px] font-semibold text-[#475569]">장수</span>
                    <select
                        className="h-8 rounded-md border border-[#cbd5e1] bg-white px-2 text-[13px] font-semibold text-[#334155]"
                        onChange={(e) => setCardCount(Number(e.target.value))}
                        value={cardCount}
                    >
                        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
                            <option key={n} value={n}>
                                {n}장
                            </option>
                        ))}
                    </select>
                </div>

                {/* 버튼 3개: 한번에 생성 · 다운받기 · 저장 */}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button
                        className="h-11 rounded-md bg-[#4338ca] px-6 text-[15px] font-bold text-white hover:bg-[#3730a3] disabled:opacity-50"
                        disabled={allBusy || !keyword.trim()}
                        onClick={() => void onGenerateAll()}
                        type="button"
                    >
                        {allBusy ? '생성 중…' : '한번에 생성'}
                    </button>
                    <button
                        className="h-11 rounded-md border border-[#4338ca] px-5 text-sm font-bold text-[#4338ca] hover:bg-[#eef2ff] disabled:opacity-50"
                        disabled={downloading}
                        onClick={() => void downloadAll()}
                        type="button"
                    >
                        {downloading ? '다운로드 중…' : '다운받기 (원고 txt + 이미지 9장)'}
                    </button>
                    <button
                        className="h-11 rounded-md bg-[#0f766e] px-5 text-sm font-bold text-white hover:bg-[#115e59] disabled:opacity-50"
                        disabled={saving}
                        onClick={() => void onSave()}
                        type="button"
                    >
                        {saving ? '저장 중…' : '저장'}
                    </button>
                    <label className="flex items-center gap-1.5 text-[13px] font-semibold text-[#475569]">
                        <input checked={includeImage} onChange={(e) => setIncludeImage(e.target.checked)} type="checkbox" />
                        AI 이미지 포함 <span className="font-normal text-[#94a3b8]">(유료·1장)</span>
                    </label>
                    {msg ? <span className="text-[13px] text-[#6366f1]">{msg}</span> : null}
                </div>
            </div>

            {/* 저장 갤러리 — 저장한 작업을 다시 불러오기 */}
            {saved.length ? (
                <div className="rounded-xl border border-[#e2e8f0] bg-white p-4">
                    <div className="mb-2 text-[13px] font-bold text-[#334155]">저장한 작업 ({saved.length})</div>
                    <div className="flex flex-wrap gap-2">
                        {saved.map((o) => (
                            <div key={o.id} className="flex items-center gap-1.5 rounded-lg border border-[#e2e8f0] bg-[#f8fafc] py-1 pl-2.5 pr-1.5">
                                <button
                                    className="text-left text-[12px] font-semibold text-[#0f172a] hover:text-[#4338ca]"
                                    onClick={() => restore(o)}
                                    title="이 작업 불러오기"
                                    type="button"
                                >
                                    {o.region || o.keyword || '작업'}
                                    <span className="ml-1 font-normal text-[#94a3b8]">{(o.created_at || '').slice(5, 10)}</span>
                                </button>
                                <button
                                    className="rounded px-1 text-[12px] text-[#cbd5e1] hover:text-[#dc2626]"
                                    onClick={() => void remove(o.id)}
                                    title="삭제"
                                    type="button"
                                >
                                    ✕
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            ) : null}

            {/* 카페 본문 (복사용) — 카페 글쓰기에 붙여넣고 「사진 N」 위치에 해당 PNG를 넣으면 됨 */}
            <div className="rounded-xl border border-[#e2e8f0] bg-white p-4">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <div className="text-[13px] font-bold text-[#334155]">
                        카페 본문 (복사용) {reviewBody ? <span className="ml-1 rounded bg-[#dcfce7] px-1.5 py-0.5 text-[10px] font-bold text-[#15803d]">AI 후기</span> : null}
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <button
                            className="h-9 rounded-md bg-[#7c3aed] px-4 text-sm font-bold text-white hover:bg-[#6d28d9] disabled:opacity-50"
                            disabled={reviewBusy}
                            onClick={() => void onGenerateReview()}
                            type="button"
                        >
                            {reviewBusy ? '후기 작성 중…' : 'AI 후기 본문 생성'}
                        </button>
                        {reviewBody ? (
                            <button
                                className="h-9 rounded-md border border-[#cbd5e1] px-3 text-sm font-semibold text-[#475569] hover:bg-[#f1f5f9]"
                                onClick={() => setReviewBody('')}
                                type="button"
                            >
                                기본 조립으로
                            </button>
                        ) : null}
                        <button
                            className="h-9 rounded-md bg-[#0f766e] px-4 text-sm font-bold text-white hover:bg-[#115e59]"
                            onClick={() => void copyBody()}
                            type="button"
                        >
                            {copied ? '복사됨 ✓' : '본문 전체 복사'}
                        </button>
                    </div>
                </div>
                <label className="mb-2 grid gap-1">
                    <span className="text-[12px] font-semibold text-[#475569]">제목</span>
                    <input
                        className="h-9 rounded-md border border-[#cbd5e1] bg-white px-2.5 text-sm"
                        onChange={(e) => setTitle(e.target.value)}
                        value={title}
                    />
                </label>
                <textarea
                    className="h-[340px] w-full rounded-md border border-[#cbd5e1] bg-white px-3 py-2 text-[13px] leading-6 text-[#0f172a]"
                    onChange={(e) => setReviewBody(e.target.value)}
                    value={bodyText}
                />
                <p className="mt-1.5 text-[12px] text-[#64748b]">
                    <b>AI 후기 본문 생성</b>을 누르면 카드 내용을 바탕으로 후기·경험 형식 글이 작성됩니다(직접 수정 가능). 카페 글쓰기에 붙여넣은 뒤 본문의 <b>「사진 N」</b> 위치에 <b>N번 PNG</b>를 순서대로 삽입하세요.
                </p>
            </div>

            <div>
                {/* 미리보기 (스케일 축소, 캡처는 원본 800×1000) */}
                <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
                    {CAFE_CARD_LABELS.slice(0, cardCount).map((label, i) => (
                        <div key={i} className="grid gap-1.5">
                            <div className="flex items-center justify-between">
                                <span className="text-[12px] font-semibold text-[#475569]">
                                    {String(i + 1).padStart(2, '0')}. {label}
                                </span>
                                <button
                                    className="rounded border border-[#cbd5e1] px-2 py-0.5 text-[11px] font-semibold text-[#475569] hover:bg-[#f1f5f9]"
                                    onClick={() => void downloadOne(i)}
                                    type="button"
                                >
                                    PNG
                                </button>
                            </div>
                            <div
                                className="overflow-hidden rounded-lg border border-[#e2e8f0] shadow-sm"
                                style={{ width: CARD_W * PREVIEW_SCALE, height: CARD_H * PREVIEW_SCALE }}
                            >
                                <div style={{ transform: `scale(${PREVIEW_SCALE})`, transformOrigin: 'top left' }}>
                                    <div ref={(el) => { cardRefs.current[i] = el; }}>
                                        {/* 업로드 사진은 카드가 index별 콜라주로 사용, 없으면 AI 배경 폴백 */}
                                        <CafeCard bgImage={bgImage} content={cards} index={i} photos={photos} />
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
}

export default CafePage;
