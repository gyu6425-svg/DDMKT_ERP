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
    type CafeDamage,
    type CafeFaq,
} from '../components/cafe/cafeContent';
import { CafeCard, CAFE_CARD_LABELS, CARD_H, CARD_W } from '../components/cafe/CafeCards';

// 카페 원고 자동생성기 — 키워드 → Claude(OpenAI) 원고 생성 → 9장 카드 템플릿 렌더 → PNG 다운로드.
//   AI 이미지가 아니라 HTML/CSS 템플릿 캡처라 한글·전화번호·FAQ가 100% 정확.

const PREVIEW_SCALE = 0.36;

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

// 여러 줄(줄바꿈 = 항목) 배열 편집
function ListArea({ label, items, onChange, hint }: { label: string; items: string[]; onChange: (v: string[]) => void; hint?: string }) {
    return (
        <label className="grid gap-1 sm:col-span-2">
            <span className="text-[12px] font-semibold text-[#475569]">
                {label} {hint ? <span className="font-normal text-[#94a3b8]">— {hint}</span> : null}
            </span>
            <textarea
                className="min-h-[92px] rounded-md border border-[#cbd5e1] bg-white px-2.5 py-2 text-sm leading-6"
                onChange={(e) => onChange(e.target.value.split('\n').map((s) => s.trim()).filter(Boolean))}
                value={items.join('\n')}
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
    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState('');
    const [downloading, setDownloading] = useState(false);
    const [copied, setCopied] = useState(false);
    const [reviewBody, setReviewBody] = useState(''); // AI 후기 본문(있으면 이걸 씀, 없으면 기본 조립)
    const [reviewBusy, setReviewBusy] = useState(false);
    const [tone, setTone] = useState<CafeReviewTone>('review'); // 원고 톤(기본 후기형)
    const [bgImage, setBgImage] = useState<string | null>(null); // AI 생성 무드 배경(9장 공유)
    const [bgBusy, setBgBusy] = useState(false);
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

    const set = <K extends keyof CafeContent>(k: K, v: CafeContent[K]) => setContent((c) => ({ ...c, [k]: v }));

    // 고정 정보(브랜드/지점/전화/지역)를 콘텐츠에 항상 주입 — 생성 결과에 관계없이 정확.
    const fixed = useMemo(
        () => ({ brand, branch, phone, region }),
        [brand, branch, phone, region],
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

    const onGenerate = async () => {
        if (!keyword.trim() || busy) return;
        setBusy(true);
        setMsg('원고 생성 중… (최대 1~2분)');
        try {
            const { content: gen } = await generateCafe({ brand, branch, business, keyword, phone, region });
            const merged = mergeCafeContent({ ...gen, ...fixed });
            setContent(merged);
            setTitle(defaultCafeTitle(merged));
            setReviewBody(''); // 카드 내용이 바뀌었으니 후기 본문은 다시 생성하도록 초기화
            if (gen.region && !region) setRegion(gen.region);
            setMsg('원고 생성 완료 — 문구 수정 후 “AI 후기 본문 생성”으로 카페 글을, “전체 9장”으로 카드를 받으세요.');
        } catch (e) {
            setMsg(e instanceof Error ? e.message : '생성 실패');
        } finally {
            setBusy(false);
        }
    };

    // AI 무드 배경 생성 — 텍스트 없는 실사 느낌 배경(9장 공유). 배너 생성기의 backgroundOnly 파이프라인 재사용.
    const onGenerateBg = async () => {
        if (bgBusy) return;
        setBgBusy(true);
        setMsg('AI 배경 생성 중… (최대 1~2분)');
        try {
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
                rawText: `${business} 홍보 카드 배경 이미지. 욕실·배관 누수 공사 현장의 사실적인 실사 느낌, 파란 물 튀김(스플래시) 효과와 깊이감, 차분하고 전문적인 무드. 상단과 하단을 어둡게 처리해 흰 텍스트가 잘 얹히도록. 글자·텍스트·로고·워터마크 없음.`,
            });
            setBgImage(r.imageDataUrl);
            setMsg('AI 배경 생성 완료 — 9장 카드에 적용됐습니다. 마음에 안 들면 다시 생성하세요.');
        } catch (e) {
            setMsg(e instanceof Error ? e.message : 'AI 배경 생성 실패 (로컬은 api:dev 필요)');
        } finally {
            setBgBusy(false);
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

    const downloadAll = async () => {
        if (downloading) return;
        setDownloading(true);
        setMsg('9장 이미지 생성 중…');
        try {
            // 폰트 임베드 CSS는 한 번만 계산해 재사용(9장 각각 2MB 폰트 인라인 방지 → 빠름).
            const first = cardRefs.current.find(Boolean);
            const fontEmbedCSS = first ? await getFontEmbedCSS(first) : undefined;
            for (let i = 0; i < CAFE_CARD_LABELS.length; i += 1) {
                await downloadOne(i, fontEmbedCSS);
                await new Promise((r) => setTimeout(r, 250)); // 브라우저 다운로드 큐 여유
            }
            setMsg('9장 다운로드 완료.');
        } catch (e) {
            setMsg(e instanceof Error ? e.message : '이미지 생성 실패');
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
                <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button
                        className="h-10 rounded-md bg-[#4338ca] px-5 text-sm font-bold text-white hover:bg-[#3730a3] disabled:opacity-50"
                        disabled={busy || !keyword.trim()}
                        onClick={() => void onGenerate()}
                        type="button"
                    >
                        {busy ? '생성 중…' : '원고 생성'}
                    </button>
                    <button
                        className="h-10 rounded-md border border-[#4338ca] px-5 text-sm font-bold text-[#4338ca] hover:bg-[#eef2ff] disabled:opacity-50"
                        disabled={downloading}
                        onClick={() => void downloadAll()}
                        type="button"
                    >
                        {downloading ? '이미지 생성 중…' : '전체 9장 다운로드'}
                    </button>
                    <button
                        className="h-10 rounded-md bg-[#0f2947] px-4 text-sm font-bold text-white hover:bg-[#0b1f38] disabled:opacity-50"
                        disabled={bgBusy}
                        onClick={() => void onGenerateBg()}
                        type="button"
                    >
                        {bgBusy ? 'AI 배경 생성 중…' : bgImage ? 'AI 배경 다시 생성' : 'AI 배경 생성(고퀄)'}
                    </button>
                    {bgImage ? (
                        <button
                            className="h-10 rounded-md border border-[#cbd5e1] px-4 text-sm font-semibold text-[#475569] hover:bg-[#f1f5f9]"
                            onClick={() => setBgImage(null)}
                            type="button"
                        >
                            배경 제거
                        </button>
                    ) : null}
                    <button
                        className="h-10 rounded-md bg-[#0f766e] px-5 text-sm font-bold text-white hover:bg-[#115e59] disabled:opacity-50"
                        disabled={saving}
                        onClick={() => void onSave()}
                        type="button"
                    >
                        {saving ? '저장 중…' : '저장'}
                    </button>
                    <button
                        className="h-10 rounded-md border border-[#cbd5e1] px-4 text-sm font-semibold text-[#475569] hover:bg-[#f1f5f9]"
                        onClick={() => setContent(DEFAULT_CAFE_CONTENT)}
                        type="button"
                    >
                        예시로 초기화
                    </button>
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
                {/* 원고 톤 선택 (기본 후기형) — 'AI 후기 본문 생성'에 반영 */}
                <div className="mb-2 flex flex-wrap items-center gap-1.5">
                    <span className="mr-1 text-[12px] font-semibold text-[#475569]">문체</span>
                    {([
                        ['review', '후기형'],
                        ['info', '정보형'],
                        ['story', '스토리형'],
                        ['talk', '대화형'],
                        ['notice', '공지형'],
                    ] as [CafeReviewTone, string][]).map(([k, label]) => (
                        <button
                            key={k}
                            className={`rounded-full px-3 py-1 text-[12px] font-semibold ${
                                tone === k ? 'bg-[#7c3aed] text-white' : 'border border-[#cbd5e1] text-[#475569] hover:bg-[#f1f5f9]'
                            }`}
                            onClick={() => setTone(k)}
                            type="button"
                        >
                            {label}
                        </button>
                    ))}
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

            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto]">
                {/* 원고 수정 */}
                <div className="grid content-start gap-4 rounded-xl border border-[#e2e8f0] bg-white p-4">
                    <div className="text-[13px] font-bold text-[#334155]">원고 수정 — 카드에 즉시 반영됩니다</div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <Field label="커버 소제목" value={cards.coverSub} onChange={(v) => set('coverSub', v)} wide />
                        <Field label="커버 큰제목(공백=줄바꿈)" value={cards.coverTitle} onChange={(v) => set('coverTitle', v)} />
                        <Field label="커버 강조문구" value={cards.coverEmphasisHi} onChange={(v) => set('coverEmphasisHi', v)} />
                        <ListArea label="① 이런 상황(3개)" items={cards.situations} onChange={(v) => set('situations', v)} hint="한 줄에 하나" />
                        <Field label="상황 경고문" value={cards.situationWarn} onChange={(v) => set('situationWarn', v)} wide />
                        <ListArea
                            label="② 피해(기간 || 내용, 3줄)"
                            items={cards.damages.map((d) => `${d.period} || ${d.text}`)}
                            onChange={(v) =>
                                set(
                                    'damages',
                                    v.map((line): CafeDamage => {
                                        const [period, text] = line.split('||').map((s) => s.trim());
                                        return { period: period || '', text: text || '' };
                                    }),
                                )
                            }
                            hint="예: 하루 || 피해 범위가 커집니다"
                        />
                        <Field label="② 강조1" value={cards.damagePunch1} onChange={(v) => set('damagePunch1', v)} />
                        <Field label="② 강조2" value={cards.damagePunch2} onChange={(v) => set('damagePunch2', v)} />
                        <ListArea label="③ 진단 원칙(3개)" items={cards.waySteps} onChange={(v) => set('waySteps', v)} hint="한 줄에 하나" />
                        <ListArea label="④ 자가점검(7개)" items={cards.checklist} onChange={(v) => set('checklist', v)} hint="한 줄에 하나" />
                        <Field label="⑤ 초기 발견 결과" value={cards.whyEarly} onChange={(v) => set('whyEarly', v)} wide />
                        <Field label="⑤ 방치 결과" value={cards.whyLate} onChange={(v) => set('whyLate', v)} wide />
                        <ListArea label="⑥ 건물 유형" items={cards.buildingTypes} onChange={(v) => set('buildingTypes', v)} hint="한 줄에 하나" />
                        <ListArea label="⑥ 누수 종류" items={cards.leakTypes} onChange={(v) => set('leakTypes', v)} hint="한 줄에 하나" />
                        <ListArea
                            label="⑦ FAQ(질문 || 답변, 4줄)"
                            items={cards.faqs.map((f) => `${f.q} || ${f.a}`)}
                            onChange={(v) =>
                                set(
                                    'faqs',
                                    v.map((line): CafeFaq => {
                                        const idx = line.indexOf('||');
                                        return idx < 0
                                            ? { q: line.trim(), a: '' }
                                            : { q: line.slice(0, idx).trim(), a: line.slice(idx + 2).trim() };
                                    }),
                                )
                            }
                            hint="예: 공사를 꼭 해야 하나요? || 아닙니다. 필요한 경우에만…"
                        />
                        <ListArea label="⑨ 약속(5개)" items={cards.promises} onChange={(v) => set('promises', v)} hint="한 줄에 하나" />
                    </div>
                </div>

                {/* 미리보기 (스케일 축소, 캡처는 원본 800×1000) */}
                <div className="grid gap-4">
                    {CAFE_CARD_LABELS.map((label, i) => (
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
                                        <CafeCard content={cards} index={i} bgImage={bgImage} />
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
