import { useEffect, useMemo, useState } from 'react';
import { editCafeImage, generateCafe, generateCafeCard, generateCafeReview, type CafeReviewTone } from '../api/cafeWriter';
import { deleteCafeOutput, getCafeOutputs, saveCafeOutput, type CafeOutput } from '../api/cafeOutputs';
import {
    buildCafePost,
    defaultCafeTitle,
    DEFAULT_CAFE_CONTENT,
    mergeCafeContent,
    type CafeContent,
} from '../components/cafe/cafeContent';
import { CafeTestTab } from '../components/cafe/CafeTestTab';
import { CafeSavedTab } from '../components/cafe/CafeSavedTab';
import { CafeThemanTab } from '../components/cafe/CafeThemanTab';
import { CafeBannerTab } from '../components/cafe/CafeBannerTab';
import { CafeLeak2Tab } from '../components/cafe/CafeLeak2Tab';

// 카페 원고 자동생성기 — 키워드 → OpenAI 원고 생성 + 원고의 「사진 N」 주제로 GPT 카드 이미지 생성.

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

    // 원본 글자 교체(실험) — 완성 카드 이미지 업로드 → 텍스트만 AI 교체
    const [editImage, setEditImage] = useState<string | null>(null);
    const [editResult, setEditResult] = useState<string | null>(null);
    const [editServices, setEditServices] = useState('욕실누수 · 누수탐지 · 배관교체');
    const [editBusy, setEditBusy] = useState(false);
    const readFile = (f: File) =>
        new Promise<string>((res, rej) => {
            const r = new FileReader();
            r.onload = () => res(String(r.result));
            r.onerror = rej;
            r.readAsDataURL(f);
        });
    const onPickEditImage = async (files: FileList | null) => {
        if (!files || !files[0]) return;
        setEditImage(await readFile(files[0]));
        setEditResult(null);
    };
    const onEdit = async () => {
        if (!editImage || editBusy) return;
        setEditBusy(true);
        setMsg('원본 이미지 글자 교체 중… (최대 1~2분)');
        try {
            const out = await editCafeImage({ image: editImage, keyword, phone, region, services: editServices });
            setEditResult(out);
            setMsg('글자 교체 완료 — 한글이 깨졌으면 다시 시도하거나 문구를 조정하세요.');
        } catch (e) {
            setMsg(e instanceof Error ? e.message : '편집 실패');
        } finally {
            setEditBusy(false);
        }
    };
    const downloadEdit = () => {
        if (!editResult) return;
        const a = document.createElement('a');
        a.href = editResult;
        a.download = `${region || '카페'}_글자교체.png`;
        a.click();
    };
    const [cardCount, setCardCount] = useState(3); // 뽑을 카드 장수(1~9)
    const [genImages, setGenImages] = useState<string[]>([]); // GPT로 생성된 카드 이미지들
    // 초판·테스트는 비활성(유지만), 기본은 테스트2. 저장=생성 히스토리.
    const [activeTab, setActiveTab] = useState<'draft' | 'test' | 'test2' | 'leak2' | 'theman' | 'theman2' | 'banner' | 'saved'>('banner');
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
    // 글자 수 = 문단바꿈(줄바꿈)과 「사진 N」 마커 제외한 순수 글자.
    const charCount = bodyText.replace(/「사진\s*\d+」/g, '').replace(/[\r\n]/g, '').length;

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
            const r = await generateCafeReview({ brand, branch, business, content: cards, count: cardCount, keyword, phone, region, tone });
            setReviewBody(r.reviewBody);
            if (r.title) setTitle(r.title);
            setMsg('후기 본문 생성 완료 — 카페 글쓰기에 복사해 쓰세요.');
        } catch (e) {
            setMsg(e instanceof Error ? e.message : '후기 생성 실패');
        } finally {
            setReviewBusy(false);
        }
    };


    // 한번에 생성 — 원고(소재)+후기 원고(그대로) 생성 후, 원고의 「사진 N」 주제로 GPT 카드 이미지를 장수만큼 생성.
    const onGenerateAll = async () => {
        if (!keyword.trim() || allBusy) return;
        setAllBusy(true);
        setGenImages([]);
        try {
            setMsg('① 원고 소재 생성 중…');
            const { content: gen } = await generateCafe({ brand, branch, business, keyword, phone, region });
            const merged = mergeCafeContent({ ...gen, ...fixed });
            setContent(merged);
            setTitle(defaultCafeTitle(merged));
            const mergedCards = { ...merged, ...fixed };

            setMsg('② 후기 원고 생성 중…');
            const rv = await generateCafeReview({ brand, branch, business, content: mergedCards, count: cardCount, keyword, phone, region, tone });
            setReviewBody(rv.reviewBody);
            if (rv.title) setTitle(rv.title);
            const topics = rv.topics && rv.topics.length ? rv.topics : [];

            const services = (merged.leakTypes || []).slice(0, 3).join(' · ') || '누수탐지 · 공압검사 · 배관교체';
            const imgs: string[] = [];
            for (let i = 0; i < cardCount; i += 1) {
                setMsg(`③ 카드 이미지 생성 중… (${i + 1}/${cardCount}) — 장당 1~2분`);
                const topic = topics[i] || business;
                const { imageDataUrl: img } = await generateCafeCard({ phone, refs: photos, region, services, topic });
                imgs.push(img);
                setGenImages([...imgs]); // 한 장씩 화면에 표시
            }
            setMsg(`완료! 카드 ${cardCount}장 + 원고. “다운받기”로 저장하세요.`);
        } catch (e) {
            setMsg(e instanceof Error ? e.message : '생성 실패 (로컬은 api:dev 필요)');
        } finally {
            setAllBusy(false);
        }
    };

    const downloadImg = (i: number) => {
        const src = genImages[i];
        if (!src) return;
        const a = document.createElement('a');
        a.href = src;
        a.download = `${region || '카페'}_${String(i + 1).padStart(2, '0')}.png`;
        a.click();
    };

    // 원고(txt) + 생성된 카드 이미지(png) 다운로드.
    const downloadAll = async () => {
        if (downloading) return;
        setDownloading(true);
        setMsg('원고 + 카드 이미지 다운로드 중…');
        try {
            const txt = `${title}\n\n${bodyText}`;
            const blob = new Blob([txt], { type: 'text/plain;charset=utf-8' });
            const turl = URL.createObjectURL(blob);
            const ta = document.createElement('a');
            ta.href = turl;
            ta.download = `${region || '카페'}_원고.txt`;
            ta.click();
            URL.revokeObjectURL(turl);
            await new Promise((r) => setTimeout(r, 200));
            for (let i = 0; i < genImages.length; i += 1) {
                downloadImg(i);
                await new Promise((r) => setTimeout(r, 250));
            }
            setMsg(`다운로드 완료 — 원고 txt 1개 + 카드 ${genImages.length}장.`);
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
            </div>

            {/* 탭: 초판·테스트는 비활성(유지만) · 테스트2(진행) · 저장(생성 히스토리) */}
            <div className="flex gap-1 border-b border-[#e2e8f0]">
                {([
                    ['draft', '초판', true],
                    ['test', '테스트', true],
                    ['test2', '누수탐지', true],
                    ['leak2', '누수탐지2', true],
                    ['banner', '더맨시스템', false],
                    ['theman2', '더맨시스템2', false],
                    ['saved', '저장', false],
                ] as [typeof activeTab, string, boolean][]).map(([k, label, disabled]) => (
                    <button
                        className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold ${
                            disabled
                                ? 'cursor-not-allowed border-transparent text-[#cbd5e1]'
                                : activeTab === k
                                  ? 'border-[#4338ca] text-[#4338ca]'
                                  : 'border-transparent text-[#94a3b8] hover:text-[#475569]'
                        }`}
                        disabled={disabled}
                        key={k}
                        onClick={() => !disabled && setActiveTab(k)}
                        title={disabled ? '비활성화됨(유지만)' : undefined}
                        type="button"
                    >
                        {label}
                        {disabled ? ' (비활성)' : ''}
                    </button>
                ))}
            </div>

            {activeTab === 'theman' ? <CafeThemanTab /> : activeTab === 'leak2' ? <CafeLeak2Tab /> : activeTab === 'theman2' ? <CafeBannerTab /> : activeTab === 'banner' ? <CafeBannerTab /> : activeTab === 'saved' ? <CafeSavedTab /> : activeTab === 'test' ? <CafeTestTab /> : activeTab === 'test2' ? <CafeTestTab cardMode="hero" /> : (
            <>
            <p className="m-0 text-sm text-[#64748b]">
                키워드와 현장 사진을 넣으면 레퍼런스와 동일한 홍보 카드(사진 콜라주 + 지역·업종·서비스·전화)를 원하는 장수만큼 만들고,
                카페용 후기 원고(2000~2500자)도 함께 뽑아 다운로드합니다. 텍스트는 정확히 렌더돼 한글·전화가 깨지지 않습니다.
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
                        현장 사진 <span className="font-normal text-[#94a3b8]">— 카드 상단에 콜라주로 들어갑니다(3장이면 3분할, 1장이면 1장). 없으면 AI 배경 사용.</span>
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
                    {msg ? <span className="text-[13px] text-[#6366f1]">{msg}</span> : null}
                </div>
            </div>

            {/* 원본 이미지 글자 교체 (실험) — 완성 카드 업로드 → 텍스트만 AI 교체 */}
            <div className="rounded-xl border border-[#fde68a] bg-[#fffbeb] p-4">
                <div className="mb-2 text-[13px] font-bold text-[#92400e]">
                    원본 이미지 글자 교체 (실험) <span className="font-normal text-[#b45309]">— 완성된 카드 이미지를 올리면 위 “지역·키워드·전화·서비스”로 글자만 바꿔줍니다 (한글이 깨질 수 있음)</span>
                </div>
                <div className="flex flex-wrap items-start gap-3">
                    {/* 원본 업로드/미리보기 */}
                    <div>
                        {editImage ? (
                            <img alt="" className="h-40 w-40 rounded-md border border-[#e2e8f0] object-cover" src={editImage} />
                        ) : (
                            <label className="flex h-40 w-40 cursor-pointer items-center justify-center rounded-md border-2 border-dashed border-[#fcd34d] text-[12px] font-semibold text-[#b45309] hover:bg-[#fef3c7]">
                                + 원본 카드
                                <input accept="image/*" className="hidden" onChange={(e) => void onPickEditImage(e.target.files)} type="file" />
                            </label>
                        )}
                    </div>
                    {/* 결과 */}
                    {editResult ? (
                        <div>
                            <img alt="" className="h-40 w-40 rounded-md border-2 border-[#16a34a] object-cover" src={editResult} />
                            <div className="mt-1 text-[10px] font-semibold text-[#15803d]">교체 결과</div>
                        </div>
                    ) : null}
                    {/* 컨트롤 */}
                    <div className="grid min-w-[240px] flex-1 content-start gap-2">
                        <label className="grid gap-1">
                            <span className="text-[12px] font-semibold text-[#475569]">서비스 태그(하단)</span>
                            <input
                                className="h-9 rounded-md border border-[#cbd5e1] bg-white px-2.5 text-sm"
                                onChange={(e) => setEditServices(e.target.value)}
                                value={editServices}
                            />
                        </label>
                        <div className="flex flex-wrap gap-2">
                            <button
                                className="h-10 rounded-md bg-[#b45309] px-5 text-sm font-bold text-white hover:bg-[#92400e] disabled:opacity-50"
                                disabled={!editImage || editBusy}
                                onClick={() => void onEdit()}
                                type="button"
                            >
                                {editBusy ? '교체 중…' : 'AI로 글자 교체'}
                            </button>
                            {editImage ? (
                                <button
                                    className="h-10 rounded-md border border-[#cbd5e1] px-4 text-sm font-semibold text-[#475569] hover:bg-[#f1f5f9]"
                                    onClick={() => {
                                        setEditImage(null);
                                        setEditResult(null);
                                    }}
                                    type="button"
                                >
                                    원본 지우기
                                </button>
                            ) : null}
                            {editResult ? (
                                <button
                                    className="h-10 rounded-md bg-[#16a34a] px-5 text-sm font-bold text-white hover:bg-[#15803d]"
                                    onClick={downloadEdit}
                                    type="button"
                                >
                                    결과 다운로드
                                </button>
                            ) : null}
                        </div>
                        <p className="text-[11px] text-[#b45309]">
                            위 입력칸의 <b>지역({region})·키워드({keyword})·전화({phone})</b> 로 교체합니다. 결과가 마음에 안 들면 다시 시도하세요.
                        </p>
                    </div>
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
                        카페 본문 (복사용) <span className="font-semibold text-[#7c3aed]">({charCount.toLocaleString()}자)</span>
                        {reviewBody ? <span className="ml-1 rounded bg-[#dcfce7] px-1.5 py-0.5 text-[10px] font-bold text-[#15803d]">AI 후기</span> : null}
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

            {/* 생성된 카드 이미지 */}
            <div>
                <div className="mb-2 text-[13px] font-bold text-[#334155]">
                    카드 이미지 {genImages.length ? `(${genImages.length}장)` : ''}
                    {allBusy ? <span className="ml-2 font-normal text-[#7c3aed]">생성 중…</span> : null}
                </div>
                {genImages.length ? (
                    <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
                        {genImages.map((src, i) => (
                            <div className="grid gap-1.5" key={i}>
                                <div className="flex items-center justify-between">
                                    <span className="text-[12px] font-semibold text-[#475569]">사진 {i + 1}</span>
                                    <button
                                        className="rounded border border-[#cbd5e1] px-2 py-0.5 text-[11px] font-semibold text-[#475569] hover:bg-[#f1f5f9]"
                                        onClick={() => downloadImg(i)}
                                        type="button"
                                    >
                                        PNG
                                    </button>
                                </div>
                                <img alt="" className="w-full rounded-lg border border-[#e2e8f0] shadow-sm" src={src} />
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="rounded-xl border border-dashed border-[#cbd5e1] bg-[#f8fafc] px-6 py-12 text-center text-sm text-[#94a3b8]">
                        “한번에 생성”을 누르면 원고의 「사진 N」에 맞춰 카드 이미지가 여기에 한 장씩 나타납니다.
                    </div>
                )}
            </div>
            </>
            )}
        </section>
    );
}

export default CafePage;
