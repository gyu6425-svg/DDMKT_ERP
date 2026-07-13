import { useMemo, useRef, useState, type CSSProperties } from 'react';
import { toPng } from 'html-to-image';
import { zipSync } from 'fflate';

// 더맨시스템(경비·보안) 카페 카드 — HTML/CSS 템플릿. 배경 사진만 넣으면 지역·문구는 코드로 렌더 → PNG.
//   OpenAI 재호출 없이 텍스트만 바꿔 무한 생성(비용 0). 한글은 Pretendard로 100% 선명.
const CARD = 1080; // 1080×1080 정사각
const FONT = "'Pretendard Variable', Pretendard, 'Malgun Gothic', sans-serif";
const NAVY = '#0c1626';
const GOLD = '#c8a24a';
const BLUE = '#4c8dff';

// ── 데이터 모델 ────────────────────────────────────────────────
type Feature = { label: string };
type SubPhoto = { label: string; src: string | null };

type ThemanData = {
    company: string; // 더맨시스템
    region: string; // 구로
    // 표지
    coverKicker: string; // "{region} 지식산업센터 경비업체" (region 은 자동 치환)
    coverTitle: string; // 입주사별 출입관리가\n중요한 이유
    features: Feature[]; // 하단 3개
    coverPhoto: string | null; // 우측 인물(경비원) 사진
    // 2번 카드(보안구역)
    c2TitlePre: string; // 한 건물이어도
    c2TitleHi: string; // 보안구역
    c2TitlePost: string; // 은 다릅니다
    c2Body: string; // 본문(줄바꿈 포함)
    c2Emphasis: string; // 파란 강조 문장
    c2Photo: string | null; // 우측 건물 사진
    subPhotos: SubPhoto[]; // 사무실/연구실/제조공간
    c2Footer: string; // 하단 안내
};

const DEFAULTS: ThemanData = {
    company: '더맨시스템',
    region: '구로',
    coverKicker: '{region} 지식산업센터 경비업체',
    coverTitle: '입주사별 출입관리가\n중요한 이유',
    features: [{ label: '출입 통제' }, { label: '방문객 관리' }, { label: '실시간 모니터링' }],
    coverPhoto: null,
    c2TitlePre: '한 건물이어도',
    c2TitleHi: '보안구역',
    c2TitlePost: '은 다릅니다',
    c2Body: '지식산업센터에는\n사무실, 연구실, 제조공간 등\n\n서로 다른 형태의 기업이\n함께 입주해 있습니다.\n\n같은 건물 안에서도\n보호해야 할 공간과 정보가 다르기 때문에',
    c2Emphasis: '입주사별 기준을 구분해야 합니다.',
    c2Photo: null,
    subPhotos: [
        { label: '사무실', src: null },
        { label: '연구실', src: null },
        { label: '제조공간', src: null },
    ],
    c2Footer: '더맨시스템은 각 공간의 특성과 보안 요구사항을 고려한\n입주사별 출입관리 솔루션을 제공합니다.',
};

// {region} 치환.
const withRegion = (s: string, region: string) => s.replace(/\{region\}/g, region || '');

// 로고(텍스트) — 실제 로고 업로드 없을 때 대체. ㈜THE MAN SYSTEM 느낌.
function Logo() {
    return (
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, fontFamily: FONT }}>
            <span style={{ fontSize: 26, fontWeight: 800, color: '#e8edf5' }}>㈜THE</span>
            <span style={{ fontSize: 30, fontWeight: 900, color: BLUE, letterSpacing: 1 }}>MAN</span>
            <span style={{ fontSize: 15, fontWeight: 700, letterSpacing: 6, color: '#9fb0c6' }}>SYSTEM</span>
        </div>
    );
}

// 사진 배경 + 좌측 어둠 그라디언트(텍스트 가독). 사진 없으면 네이비.
function PhotoBg({ src, from = '52%' }: { src: string | null; from?: string }) {
    return (
        <>
            <div style={{ position: 'absolute', inset: 0, background: NAVY }} />
            {src ? (
                <img
                    src={src}
                    style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
                />
            ) : null}
            <div
                style={{
                    position: 'absolute',
                    inset: 0,
                    background: `linear-gradient(90deg, ${NAVY} ${src ? '38%' : '100%'}, rgba(12,22,38,0.72) ${from}, rgba(12,22,38,0.15) 100%)`,
                }}
            />
        </>
    );
}

// 얇은 금색 라인.
const goldLine: CSSProperties = { width: 64, height: 3, background: GOLD, borderRadius: 2 };

// 하단 기능 아이콘(간단 SVG).
function FeatureIcon({ i }: { i: number }) {
    const common = { width: 34, height: 34, stroke: '#dfe6f0', strokeWidth: 1.8, fill: 'none' } as const;
    if (i === 0)
        return (
            <svg viewBox="0 0 24 24" {...common}>
                <rect x="3" y="6" width="18" height="12" rx="2" />
                <path d="M3 10h18" />
                <circle cx="8" cy="14" r="1.4" fill="#dfe6f0" stroke="none" />
            </svg>
        );
    if (i === 1)
        return (
            <svg viewBox="0 0 24 24" {...common}>
                <circle cx="10" cy="8" r="3.2" />
                <path d="M4 19c0-3.3 2.7-5 6-5 1.2 0 2.3.2 3.2.7" />
                <path d="M15 16.5l1.8 1.8L20 15" />
            </svg>
        );
    return (
        <svg viewBox="0 0 24 24" {...common}>
            <path d="M12 3l7 3v5c0 4.4-3 7.6-7 9-4-1.4-7-4.6-7-9V6l7-3z" />
            <path d="M9 12l2 2 4-4" />
        </svg>
    );
}

// ── 표지 카드 ────────────────────────────────────────────────
function CoverCard({ d }: { d: ThemanData }) {
    return (
        <div style={{ position: 'relative', width: CARD, height: CARD, overflow: 'hidden', fontFamily: FONT }}>
            <PhotoBg src={d.coverPhoto} />
            {/* 로고 */}
            <div style={{ position: 'absolute', top: 60, left: 64 }}>
                <Logo />
            </div>
            {/* 좌측 카피 */}
            <div style={{ position: 'absolute', top: 210, left: 64, right: 420 }}>
                <div style={{ ...goldLine, marginBottom: 22 }} />
                <div style={{ fontSize: 30, fontWeight: 700, color: '#cdd7e6', letterSpacing: -0.5, marginBottom: 26 }}>
                    {withRegion(d.coverKicker, d.region)}
                </div>
                <div
                    style={{
                        fontSize: 78,
                        fontWeight: 900,
                        color: '#f4f8ff',
                        lineHeight: 1.16,
                        letterSpacing: -2,
                        whiteSpace: 'pre-line',
                        textShadow: '0 4px 18px rgba(0,0,0,0.5)',
                    }}
                >
                    {d.coverTitle}
                </div>
            </div>
            {/* 회사명 */}
            <div style={{ position: 'absolute', bottom: 210, left: 64 }}>
                <div style={{ ...goldLine, marginBottom: 16 }} />
                <div style={{ fontSize: 40, fontWeight: 800, color: '#eef3fb', letterSpacing: -1 }}>{d.company}</div>
            </div>
            {/* 하단 3기능 */}
            <div style={{ position: 'absolute', bottom: 70, left: 64, right: 64, display: 'flex', alignItems: 'center', gap: 30 }}>
                {d.features.map((f, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 30 }}>
                        {i > 0 ? <div style={{ width: 1, height: 34, background: 'rgba(200,162,74,0.5)' }} /> : null}
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
                            <FeatureIcon i={i} />
                            <span style={{ fontSize: 21, fontWeight: 700, color: '#e4ebf5' }}>{f.label}</span>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

// ── 2번 카드(보안구역) ───────────────────────────────────────
function SecurityCard({ d }: { d: ThemanData }) {
    return (
        <div style={{ position: 'relative', width: CARD, height: CARD, overflow: 'hidden', fontFamily: FONT }}>
            <PhotoBg src={d.c2Photo} from="48%" />
            <div style={{ position: 'absolute', top: 56, left: 64 }}>
                <Logo />
            </div>
            {/* 제목 */}
            <div style={{ position: 'absolute', top: 150, left: 64, right: 380 }}>
                <div style={{ fontSize: 62, fontWeight: 900, color: '#f4f8ff', lineHeight: 1.18, letterSpacing: -1.5 }}>
                    {d.c2TitlePre}
                    <br />
                    <span style={{ color: BLUE }}>{d.c2TitleHi}</span>
                    {d.c2TitlePost}
                </div>
            </div>
            {/* 본문 */}
            <div
                style={{
                    position: 'absolute',
                    top: 320,
                    left: 64,
                    right: 380,
                    fontSize: 27,
                    fontWeight: 500,
                    color: '#d5deec',
                    lineHeight: 1.5,
                    letterSpacing: -0.5,
                    whiteSpace: 'pre-line',
                }}
            >
                {d.c2Body}
            </div>
            {/* 파란 강조 */}
            <div style={{ position: 'absolute', top: 636, left: 64, right: 380 }}>
                <span style={{ fontSize: 30, fontWeight: 800, color: BLUE, letterSpacing: -0.5 }}>{d.c2Emphasis}</span>
            </div>
            {/* 하단 서브 사진 3장 */}
            <div style={{ position: 'absolute', bottom: 128, left: 64, right: 64, display: 'flex', gap: 16 }}>
                {d.subPhotos.map((p, i) => (
                    <div key={i} style={{ flex: 1 }}>
                        <div
                            style={{
                                position: 'relative',
                                height: 150,
                                borderRadius: 12,
                                overflow: 'hidden',
                                border: '1px solid rgba(200,162,74,0.4)',
                                background: '#16233a',
                            }}
                        >
                            {p.src ? (
                                <img src={p.src} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                            ) : null}
                            <div
                                style={{
                                    position: 'absolute',
                                    left: 0,
                                    bottom: 0,
                                    width: '100%',
                                    padding: '6px 0',
                                    textAlign: 'center',
                                    fontSize: 19,
                                    fontWeight: 800,
                                    color: '#fff',
                                    background: 'linear-gradient(transparent, rgba(9,16,28,0.9))',
                                }}
                            >
                                {p.label}
                            </div>
                        </div>
                    </div>
                ))}
            </div>
            {/* 푸터 */}
            <div style={{ position: 'absolute', bottom: 44, left: 64, right: 64, display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <svg viewBox="0 0 24 24" width={26} height={26} fill="none" stroke={GOLD} strokeWidth={1.8} style={{ flexShrink: 0, marginTop: 2 }}>
                    <path d="M12 3l7 3v5c0 4.4-3 7.6-7 9-4-1.4-7-4.6-7-9V6l7-3z" />
                    <path d="M9 12l2 2 4-4" />
                </svg>
                <div style={{ fontSize: 20, fontWeight: 500, color: '#c3cdda', lineHeight: 1.45, whiteSpace: 'pre-line' }}>
                    {d.c2Footer}
                </div>
            </div>
        </div>
    );
}

// ── 탭 ──────────────────────────────────────────────────────
const CARD_DEFS = [
    { key: 'cover', label: '표지', render: (d: ThemanData) => <CoverCard d={d} /> },
    { key: 'security', label: '보안구역', render: (d: ThemanData) => <SecurityCard d={d} /> },
] as const;

const readFile = (f: File): Promise<string> =>
    new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result));
        r.onerror = rej;
        r.readAsDataURL(f);
    });

export function CafeThemanTab() {
    const [d, setD] = useState<ThemanData>(DEFAULTS);
    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState('');
    const cardRefs = useRef<(HTMLDivElement | null)[]>([]);

    const set = <K extends keyof ThemanData>(k: K, v: ThemanData[K]) => setD((p) => ({ ...p, [k]: v }));

    // 미리보기는 scale로 줄여 보여주므로, 캡처 시엔 transform 제거해 원본 1080×1080으로 뽑는다.
    const exportNode = async (node: HTMLElement): Promise<string> =>
        toPng(node, {
            cacheBust: true,
            height: CARD,
            pixelRatio: 1,
            style: { transform: 'none', transformOrigin: 'top left' },
            width: CARD,
        });

    const downloadOne = async (i: number) => {
        const node = cardRefs.current[i];
        if (!node) return;
        setBusy(true);
        try {
            const url = await exportNode(node);
            const a = document.createElement('a');
            a.download = `${d.company}_${d.region}_${CARD_DEFS[i].label}.png`;
            a.href = url;
            a.click();
            setMsg(`${CARD_DEFS[i].label} 다운로드 완료`);
        } catch (e) {
            setMsg(e instanceof Error ? e.message : '내보내기 실패');
        } finally {
            setBusy(false);
        }
    };

    const downloadZip = async () => {
        setBusy(true);
        setMsg('이미지 생성 중…');
        try {
            const files: Record<string, Uint8Array> = {};
            for (let i = 0; i < CARD_DEFS.length; i += 1) {
                const node = cardRefs.current[i];
                if (!node) continue;
                const url = await exportNode(node);
                const bin = Uint8Array.from(atob(url.split(',')[1]), (ch) => ch.charCodeAt(0));
                files[`${String(i + 1).padStart(2, '0')}_${CARD_DEFS[i].label}.png`] = bin;
            }
            const zip = zipSync(files, { level: 0 });
            const blob = new Blob([zip], { type: 'application/zip' });
            const a = document.createElement('a');
            a.download = `${d.company}_${d.region}_카드.zip`;
            a.href = URL.createObjectURL(blob);
            a.click();
            URL.revokeObjectURL(a.href);
            setMsg(`ZIP 다운로드 완료 (${CARD_DEFS.length}장)`);
        } catch (e) {
            setMsg(e instanceof Error ? e.message : 'ZIP 실패');
        } finally {
            setBusy(false);
        }
    };

    // 미리보기 스케일(1080 → 표시폭).
    const previewW = 300;
    const scale = previewW / CARD;
    const inputCls = 'h-9 w-full rounded-md border border-[#cbd5e1] bg-white px-2 text-sm';
    const areaCls = 'w-full rounded-md border border-[#cbd5e1] bg-white px-2 py-1.5 text-sm';

    const uploadTo = async (k: 'coverPhoto' | 'c2Photo', file?: File | null) => {
        if (file) set(k, await readFile(file));
    };
    const uploadSub = async (idx: number, file?: File | null) => {
        if (!file) return;
        const src = await readFile(file);
        setD((p) => ({ ...p, subPhotos: p.subPhotos.map((s, i) => (i === idx ? { ...s, src } : s)) }));
    };

    const cards = useMemo(() => CARD_DEFS.map((c) => c.render(d)), [d]);

    return (
        <div className="grid gap-4">
            <div className="rounded-lg border border-[#e2e8f0] bg-[#f8fafc] px-4 py-3 text-sm text-[#475569]">
                <b className="text-[#0f172a]">더맨시스템 — 텍스트만 바꾸는 무비용 카드.</b> 배경 사진은 한 번만 넣으면 재사용하고,
                지역·문구만 바꿔 PNG로 뽑습니다(OpenAI 재호출 없음 · 비용 0 · 한글 선명).
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
                {/* 입력 */}
                <div className="grid gap-3">
                    <div className="grid grid-cols-2 gap-2">
                        <label className="grid gap-1 text-xs font-semibold text-[#475569]">
                            지역명
                            <input className={inputCls} onChange={(e) => set('region', e.target.value)} value={d.region} />
                        </label>
                        <label className="grid gap-1 text-xs font-semibold text-[#475569]">
                            회사명
                            <input className={inputCls} onChange={(e) => set('company', e.target.value)} value={d.company} />
                        </label>
                    </div>

                    <div className="rounded-lg border border-[#e2e8f0] p-3">
                        <div className="mb-2 text-xs font-bold text-[#1e40af]">표지 카드</div>
                        <label className="mb-2 grid gap-1 text-xs font-semibold text-[#475569]">
                            소제목 (지역은 {'{region}'} 으로)
                            <input className={inputCls} onChange={(e) => set('coverKicker', e.target.value)} value={d.coverKicker} />
                        </label>
                        <label className="mb-2 grid gap-1 text-xs font-semibold text-[#475569]">
                            큰 제목 (줄바꿈 가능)
                            <textarea className={areaCls} onChange={(e) => set('coverTitle', e.target.value)} rows={2} value={d.coverTitle} />
                        </label>
                        <div className="grid grid-cols-3 gap-1.5">
                            {d.features.map((f, i) => (
                                <input
                                    key={i}
                                    className={inputCls}
                                    onChange={(e) =>
                                        set('features', d.features.map((x, j) => (j === i ? { label: e.target.value } : x)))
                                    }
                                    value={f.label}
                                />
                            ))}
                        </div>
                        <label className="mt-2 grid gap-1 text-xs font-semibold text-[#475569]">
                            배경 사진(경비원)
                            <input accept="image/*" onChange={(e) => void uploadTo('coverPhoto', e.target.files?.[0])} type="file" />
                        </label>
                    </div>

                    <div className="rounded-lg border border-[#e2e8f0] p-3">
                        <div className="mb-2 text-xs font-bold text-[#1e40af]">보안구역 카드</div>
                        <div className="mb-2 grid grid-cols-3 gap-1.5">
                            <input className={inputCls} onChange={(e) => set('c2TitlePre', e.target.value)} placeholder="앞" value={d.c2TitlePre} />
                            <input className={inputCls} onChange={(e) => set('c2TitleHi', e.target.value)} placeholder="강조(파랑)" value={d.c2TitleHi} />
                            <input className={inputCls} onChange={(e) => set('c2TitlePost', e.target.value)} placeholder="뒤" value={d.c2TitlePost} />
                        </div>
                        <label className="mb-2 grid gap-1 text-xs font-semibold text-[#475569]">
                            본문 (줄바꿈 가능)
                            <textarea className={areaCls} onChange={(e) => set('c2Body', e.target.value)} rows={5} value={d.c2Body} />
                        </label>
                        <label className="mb-2 grid gap-1 text-xs font-semibold text-[#475569]">
                            파란 강조 문장
                            <input className={inputCls} onChange={(e) => set('c2Emphasis', e.target.value)} value={d.c2Emphasis} />
                        </label>
                        <label className="mb-2 grid gap-1 text-xs font-semibold text-[#475569]">
                            하단 안내 (줄바꿈 가능)
                            <textarea className={areaCls} onChange={(e) => set('c2Footer', e.target.value)} rows={2} value={d.c2Footer} />
                        </label>
                        <label className="mb-2 grid gap-1 text-xs font-semibold text-[#475569]">
                            배경 사진(건물)
                            <input accept="image/*" onChange={(e) => void uploadTo('c2Photo', e.target.files?.[0])} type="file" />
                        </label>
                        <div className="grid grid-cols-3 gap-1.5">
                            {d.subPhotos.map((p, i) => (
                                <div key={i} className="grid gap-1">
                                    <input
                                        className={inputCls}
                                        onChange={(e) =>
                                            setD((prev) => ({
                                                ...prev,
                                                subPhotos: prev.subPhotos.map((s, j) => (j === i ? { ...s, label: e.target.value } : s)),
                                            }))
                                        }
                                        value={p.label}
                                    />
                                    <input accept="image/*" className="text-[10px]" onChange={(e) => void uploadSub(i, e.target.files?.[0])} type="file" />
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                {/* 미리보기 */}
                <div className="grid gap-3">
                    {CARD_DEFS.map((c, i) => (
                        <div key={c.key} className="grid gap-1">
                            <div className="flex items-center justify-between">
                                <span className="text-xs font-bold text-[#334155]">{c.label}</span>
                                <button
                                    className="rounded-md border border-[#cbd5e1] px-2 py-1 text-[11px] font-semibold text-[#475569] hover:bg-[#f1f5f9] disabled:opacity-50"
                                    disabled={busy}
                                    onClick={() => void downloadOne(i)}
                                    type="button"
                                >
                                    PNG
                                </button>
                            </div>
                            {/* 스케일 미리보기 컨테이너 */}
                            <div style={{ width: previewW, height: previewW, overflow: 'hidden', borderRadius: 8, border: '1px solid #e2e8f0' }}>
                                <div
                                    ref={(el) => {
                                        cardRefs.current[i] = el;
                                    }}
                                    style={{ width: CARD, height: CARD, transform: `scale(${scale})`, transformOrigin: 'top left' }}
                                >
                                    {cards[i]}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            <div className="flex items-center gap-2">
                <button
                    className="rounded-md bg-[#1e40af] px-5 py-2.5 text-sm font-bold text-white hover:bg-[#1e3a8a] disabled:opacity-50"
                    disabled={busy}
                    onClick={() => void downloadZip()}
                    type="button"
                >
                    {busy ? '생성 중…' : '전체 ZIP 다운로드'}
                </button>
                {msg ? <span className="text-xs text-[#64748b]">{msg}</span> : null}
            </div>
        </div>
    );
}
