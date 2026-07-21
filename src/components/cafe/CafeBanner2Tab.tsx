import { useEffect, useState } from 'react';
import { generateCafeReview, generateSecurityBanner, type CafeReviewTone } from '../../api/cafeWriter';
import { defaultCafeTitle, DEFAULT_CAFE_CONTENT, mergeCafeContent } from './cafeContent';
import { logApiUsage } from '../../api/apiUsage';
import { computeRecordCostUsd } from '../../lib/apiPricing';
import { useAuth } from '../../hooks/useAuth';
import { getCachedCard, setCachedCard, delCachedCard } from './cardCache';
import { downloadCafeZip } from './cafeExport';
import { createPublishJob } from '../../api/cafePublishQueue';
import { saveHistory } from './cafeHistory';
import { SecItemsEditor, resolveSecItems, EMPTY_SEC_ITEMS, type SecItem } from './SecItemsEditor';
import { COMPANIES, type CompanyKey } from './companies';
import { buildImageOrder } from './imageOrder';
import { AutoPublishPanel } from './AutoPublishPanel';

// 발행 전 최소 점검 — 상세 규칙은 서버(functions/lib/cafeInfoGuide.mjs validateInfoBody)가 판정하고
//   여기서는 그 결과 + 생성 후 본문을 손댄 경우를 대비해 마커 개수만 다시 센다.
//   발행기는 「사진 N」을 줄 전체로만 인식하고, 범위 밖 번호는 조용히 버린다.
const IMG_LINE = /^\s*[「[]?\s*사진\s*(\d+)\s*[」\]]?\s*$/;
function checkBeforePublish(body: string, imageCount: number): string[] {
    const out: string[] = [];
    const nums = body.split(/\r?\n/).map((l) => IMG_LINE.exec(l)).filter(Boolean).map((m) => Number(m![1]));
    if (nums.length !== imageCount) out.push(`사진 마커 ${nums.length}개 ≠ 이미지 ${imageCount}장`);
    if (new Set(nums).size !== nums.length) out.push('사진 번호 중복');
    if (nums.some((n) => n < 1 || n > imageCount)) out.push('범위를 벗어난 사진 번호');
    if (/[「[]\s*사진\s*\d+\s*[」\]]/.test(body.split(/\r?\n/).filter((l) => !IMG_LINE.test(l)).join('\n'))) {
        out.push('문장 안에 섞인 사진 마커');
    }
    return out;
}

// 더맨시스템2 / 3(abModel) 탭 — 블루 보안배너(더맨2 방식) + 원고 + 2~7 저장이미지 + 생성 시 ZIP까지.
//   배너 = generateSecurityBanner(style:'blue') · 원고 = 키워드 기반 후기. 1·8=배너(북엔드), 2~7=고정이미지(속성변형).
//   중간 이미지 세트: 더맨2 = cafe-fixed(공유) · 더맨3 = theman(보안 전용).

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

// abModel=true(더맨시스템3)면 카드 모델 A/B 토글(gpt-5.5/mini) 노출. 기본 false(더맨시스템2)는 기존과 100% 동일.
//   company: 업체 설정(게시판·링크·태그·중간이미지 폴더). 기본 'theman' → 더맨 동작 그대로.
export function CafeBanner2Tab({ abModel = false, company = 'theman' }: { abModel?: boolean; company?: CompanyKey } = {}) {
    const cfg = COMPANIES[company];
    const { profile } = useAuth();
    // 원고
    const [keyword, setKeyword] = useState(`일산 ${cfg.secType}`);
    const [region, setRegion] = useState('일산');
    const [business, setBusiness] = useState(cfg.business);
    const [phone, setPhone] = useState(DEFAULT_CAFE_CONTENT.phone);
    // 더맨3(abModel)은 정보형만 쓴다(사용자 요청 2026-07-20) → 문체 선택 없이 'info' 고정.
    const [tone, setTone] = useState<CafeReviewTone>(abModel ? 'info' : 'review');
    // 블루 배너(더맨2)
    const [secType, setSecType] = useState(cfg.secType);
    const [l1, setL1] = useState(cfg.titleLines[0]);
    const [l2, setL2] = useState(cfg.titleLines[1]);
    const [l3, setL3] = useState(cfg.titleLines[2]);
    const [quality, setQuality] = useState<'low' | 'medium' | 'high'>('low');
    const [cardModel, setCardModel] = useState<'gpt-5.5' | 'gpt-5-mini'>('gpt-5-mini'); // 오케스트레이션 모델(A/B). 기본 mini(비용 절감).
    const [manualOn, setManualOn] = useState(false);
    const [manualItems, setManualItems] = useState<SecItem[]>(EMPTY_SEC_ITEMS);

    const [banner, setBanner] = useState<string | null>(null);
    const [fixedImages, setFixedImages] = useState<string[]>([]);
    const [title, setTitle] = useState(defaultCafeTitle(DEFAULT_CAFE_CONTENT));
    const [reviewBody, setReviewBody] = useState('');
    const [generating, setGenerating] = useState(false);
    const [downloading, setDownloading] = useState(false);
    const [publishing, setPublishing] = useState(false);
    const [check, setCheck] = useState<{ ok: boolean; problems: string[] } | null>(null); // 서버 형식검사 결과
    const [copied, setCopied] = useState(false);
    const [msg, setMsg] = useState('');

    // A/B(더맨3)일 때만 모델을 키에 포함 → gpt-5.5/mini 캐시 분리. 더맨2는 기존 키 유지(캐시 보존).
    const bannerKey = () => `banner2|${region}|${secType}|${l1}|${l2}|${l3}|${quality}${abModel ? `|${cardModel}` : ''}`;
    useEffect(() => {
        let alive = true;
        void getCachedCard(bannerKey()).then((img) => alive && img && setBanner(img));
        return () => {
            alive = false;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [region, secType, l1, l2, l3, quality, cardModel]);

    // 2~7 중간 저장 이미지 — 기본 내장 세트 자동 로드.
    //   더맨3(abModel)만 보안 전용 세트(cafe-sec-fixed)를 쓴다. cafe-fixed 는 누수탐지·더맨2·배너/테스트 탭이
    //   공유하는 세트라, 여기서 같이 갈아끼우면 누수탐지 글에 경비원 사진이 붙는다.
    useEffect(() => {
        let alive = true;
        const dir = abModel ? cfg.fixedDir : 'cafe-fixed';
        void fetch(`/images/${dir}/manifest.json`)
            .then((r) => (r.ok ? r.json() : []))
            .then((list) => {
                if (!alive) return;
                if (Array.isArray(list) && list.length) setFixedImages(list as string[]);
                // 전용 세트가 아직 없으면 공유 세트로 대체하지 않는다 — 조용히 엉뚱한 사진이 붙는 편이 더 위험.
                else if (abModel) setMsg(`중간 이미지 없음 — public/images/${dir}/ 에 사진과 manifest.json 을 넣으세요`);
            })
            .catch(() => undefined);
        return () => {
            alive = false;
        };
    }, [abModel, cfg.fixedDir]);

    const allImages = buildImageOrder(banner ? [banner] : [], fixedImages);
    // 서버가 마커 개수를 1~9로 제한하므로 여기서 미리 맞춘다. 중간이미지 로드 전(빈 배열)에 생성을 누르면
    //   2장짜리 원고가 나오므로, 그 경우엔 기본 9로 둔다.
    const photoCount = fixedImages.length ? Math.max(1, Math.min(9, fixedImages.length + 2)) : 9;
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
                    // 고정 배너 이미지가 설정된 업체(설고점 등)는 AI 배너 생성을 건너뛴다.
                    if (cfg.bannerImage) return cfg.bannerImage;
                    const cached = await getCachedCard(bannerKey());
                    if (cached) return cached;
                    const t = Date.now();
                    const r = await generateSecurityBanner({ items: resolveSecItems(manualOn, manualItems), model: abModel ? cardModel : undefined, quality, region, secType, style: 'blue', titleLines });
                    await setCachedCard(bannerKey(), r.imageDataUrl);
                    // 실제 사용 모델을 비용/라벨에 반영 → 대시보드가 gpt-5.5 vs mini 절감을 구분.
                    const isMini = r.model === 'gpt-5-mini';
                    const textLabel = isMini ? 'sec-items-mini' : 'sec-items';
                    const cardLabel = isMini ? 'sec-card2-mini' : 'sec-card2';
                    const textCost = r.textUsage ? computeRecordCostUsd({ model: r.model, provider: 'openai', usage_raw: r.textUsage }) : 0;
                    const imageCost = computeRecordCostUsd({ banner_size: 'square', image_quality: quality, model: r.model, provider: 'openai', usage_raw: r.imageUsage });
                    if (r.textUsage) void logApiUsage({ cost_usd: textCost, elapsed_ms: Date.now() - t, model: textLabel, operator_name: operatorName, provider: 'openai', status: 'success', usage_raw: r.textUsage as never, user_email: email });
                    void logApiUsage({ banner_size: 'square', cost_usd: imageCost, elapsed_ms: Date.now() - t, image_quality: quality, model: cardLabel, operator_name: operatorName, provider: 'openai', status: 'success', usage_raw: r.imageUsage as never, user_email: email });
                    return r.imageDataUrl;
                })(),
                (async () => {
                    const t = Date.now();
                    // 더맨(보안) 원고 — 누수탐지 소재(content) 대신 빈 소재 + 더맨 브랜드/업종으로 생성(누수 내용 유입 차단).
                    // count 는 실제 발행 장수와 반드시 같아야 한다. 어긋나면 발행기가 범위 밖 「사진 N」을
                    //   조용히 버려서 사진이 무증상으로 사라진다(publish_cafe.py 의 1<=n<=len(images) 검사).
                    const rv = await generateCafeReview({
                        brand: cfg.brand, business, content: {}, count: photoCount, keyword, phone, region, tone,
                        ...(abModel ? { facts: cfg.facts, variant: 'info-guide' as const } : {}),
                    });
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
                setCheck((reviewR.value as { check?: { ok: boolean; problems: string[] } }).check ?? null);
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

    // 카페 발행 대기열 등록 — 이미지(게시 순서) + 본문을 cafe_publish_queue 에 적재(로컬 발행기가 처리).
    //   발행기는 「사진 N」·"부제목 :" 두 마커만 해석하고 나머지 줄은 글자 그대로 타이핑하므로,
    //   형식이 깨진 원고는 마커가 본문에 노출된 채 게시된다 → 등록 전에 막는다.
    const publishCafe = async () => {
        if (publishing || !ready) return;
        const bad = checkBeforePublish(reviewBody, allImages.length);
        if (bad.length) {
            setMsg(`발행 보류 — 원고 형식 문제: ${bad.join(' / ')}. “생성”을 다시 눌러주세요.`);
            return;
        }
        setPublishing(true);
        setMsg('카페 발행 대기열 등록 중… (이미지 업로드)');
        try {
            const { error, jobId } = await createPublishJob({
                board: cfg.board, body: cfg.footer ? `${reviewBody}\n\n${cfg.footer}` : reviewBody,
                images: allImages, links: cfg.links,
                tags: cfg.tags(region, secType), title,
            });
            if (error) throw error;
            setMsg(`카페 발행 등록 완료 (#${jobId?.slice(0, 8)}) — 로컬 발행기가 순서대로 게시합니다.`);
        } catch (e) {
            setMsg(e instanceof Error ? e.message : '카페 발행 등록 실패');
        } finally {
            setPublishing(false);
        }
    };

    return (
        <div className="grid gap-5">
            {/* 자동발행 — 키워드+지역 스캔 → 통과 지역 일괄 발행(더맨3/설고 등 abModel 탭만) */}
            {abModel ? <AutoPublishPanel company={company} /> : null}

            <p className="m-0 text-sm text-[#64748b]">
                <b>수동 1건</b> — 아래에서 키워드·지역을 직접 넣고 생성·발행할 수도 있습니다(단건 테스트용).
            </p>

            {/* 원고 입력 — 자동발행은 키워드·지역이 자동으로 채워지므로 기본 접힘(수동 조정 시 펼침) */}
            <details className="rounded-xl border border-[#e2e8f0] bg-white p-4">
                <summary className="cursor-pointer text-[12px] font-semibold text-[#475569]">원고 입력 <span className="font-normal text-[#94a3b8]">(펼치기 — 키워드·지역·업종·전화·문체)</span></summary>
                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <Field label="키워드(원고 주제)" value={keyword} onChange={setKeyword} />
                    <Field label="지역명" value={region} onChange={setRegion} />
                    <Field label="업종" value={business} onChange={setBusiness} />
                    <Field label="전화번호" value={phone} onChange={setPhone} />
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                    <span className="mr-1 text-[12px] font-semibold text-[#475569]">문체</span>
                    {abModel ? (
                        <span className="rounded-full bg-[#7c3aed] px-3 py-1 text-[12px] font-semibold text-white">정보형</span>
                    ) : TONES.map(([k, label]) => (
                        <button className={`rounded-full px-3 py-1 text-[12px] font-semibold ${tone === k ? 'bg-[#7c3aed] text-white' : 'border border-[#cbd5e1] text-[#475569] hover:bg-[#f1f5f9]'}`} key={k} onClick={() => setTone(k)} type="button">
                            {label}
                        </button>
                    ))}
                </div>
            </details>

            {/* 블루 배너 입력 — 자동발행은 내용만 바뀌므로 기본 접힘(필요할 때만 펼침) */}
            <details className="rounded-xl border-2 border-[#1e5bd8] bg-[#eff6ff] p-4">
                <summary className="cursor-pointer text-[12px] font-semibold text-[#1e5bd8]">블루 보안배너 설정 <span className="font-normal text-[#94a3b8]">(펼치기 — 보안종류·제목·화질)</span></summary>
                <div className="mt-3">
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
                {abModel ? (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <span className="mr-1 text-[12px] font-semibold text-[#475569]">카드 모델</span>
                        {(['gpt-5.5', 'gpt-5-mini'] as const).map((m) => (
                            <button
                                className={`rounded-full px-3 py-1 text-[12px] font-semibold ${cardModel === m ? 'bg-[#0ea5e9] text-white' : 'border border-[#cbd5e1] text-[#475569] hover:bg-[#f1f5f9]'}`}
                                key={m}
                                onClick={() => setCardModel(m)}
                                type="button"
                            >
                                {m === 'gpt-5-mini' ? 'mini (실험·저비용)' : 'gpt-5.5 (기본)'}
                            </button>
                        ))}
                        <span className="ml-1 text-[11px] text-[#94a3b8]">모델 바꿔 각각 생성 → 미리보기·비용 비교(캐시 분리)</span>
                    </div>
                ) : null}
                </div>
            </details>

            {/* 실행 */}
            <div className="flex flex-wrap items-center gap-2">
                <button className="h-10 rounded-md bg-[#4338ca] px-6 text-sm font-bold text-white hover:bg-[#3730a3] disabled:opacity-50" disabled={generating || !keyword.trim()} onClick={() => void generate()} type="button">
                    {generating ? '생성 중… (배너 + 원고)' : '생성 (배너 + 원고 → ZIP)'}
                </button>
                <button className="h-10 rounded-md border border-[#4338ca] px-5 text-sm font-bold text-[#4338ca] hover:bg-[#eef2ff] disabled:cursor-not-allowed disabled:opacity-40" disabled={downloading || !ready} onClick={() => void downloadZip()} type="button">
                    {downloading ? 'ZIP 생성 중…' : '다운받기 (ZIP)'}
                </button>
                {abModel ? (
                    <button className="h-10 rounded-md bg-[#0f766e] px-5 text-sm font-bold text-white hover:bg-[#115e59] disabled:cursor-not-allowed disabled:opacity-40" disabled={publishing || !ready} onClick={() => void publishCafe()} type="button">
                        {publishing ? '발행 등록 중…' : '카페 발행'}
                    </button>
                ) : null}
                {msg ? <span className="text-[13px] text-[#6366f1]">{msg}</span> : null}
            </div>

            {/* 형식검사 — 발행기가 해석 못 하는 원고를 미리 알려준다(발행하면 마커가 글자로 노출됨) */}
            {check && !check.ok ? (
                <div className="rounded-lg border border-[#f59e0b] bg-[#fffbeb] p-3 text-[12px] text-[#92400e]">
                    <b>원고 형식 경고</b> — {check.problems.join(' · ')}
                    <div className="mt-1 text-[11px]">그대로 발행하면 마커가 본문에 글자로 노출되거나 사진이 빠질 수 있습니다. “생성”을 다시 눌러보세요.</div>
                </div>
            ) : null}

            {/* 이미지 — 자동발행은 고정 세트를 쓰므로 기본 접힘 */}
            <details className="rounded-xl border border-[#e2e8f0] bg-white p-4">
                <summary className="cursor-pointer text-[12px] font-semibold text-[#475569]">배너·중간 이미지 <span className="font-normal text-[#94a3b8]">(펼치기 — 미리보기·사진 추가/삭제)</span></summary>
                <div className="mt-3 grid gap-3 lg:grid-cols-2">
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
            </details>

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
