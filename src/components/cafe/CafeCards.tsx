import { createContext, useContext, type CSSProperties } from 'react';
import type { CafeContent } from './cafeContent';

// 카페 카드 9종 — 전부 '히어로 홍보 카드' 통일 템플릿(레퍼런스 스타일). 800×1000 고정, 인라인 스타일(html-to-image 안정).
//   각 카드: 사진 배경(업로드) + 하단 네이비 패널 + 지역/뱃지 + 큰 아웃라인 제목 + 서브 라인 + 전화바.
//   텍스트는 코드 렌더라 한글·전화 100% 정확. 사진만 카드마다 다르고 무드는 전체 동일.

// 카드 배경 사진(dataURL) — CafePage가 카드별로 다른 업로드 사진을 넣음(없으면 AI 배경).
const BgCtx = createContext<string | null>(null);
// (커버 인서트용) 업로드 사진 배열 — 현재 통일 템플릿에선 배경만 쓰지만 하위호환 위해 유지.
const PhotoCtx = createContext<string[]>([]);

export const CARD_W = 800;
export const CARD_H = 1000;
export const CAFE_CARD_LABELS = [
    '커버',
    '상황',
    '경고(피해)',
    '방식',
    '자가점검',
    '시기',
    '서비스',
    'FAQ',
    '약속·연락처',
];
export const CAFE_CARD_COUNT = CAFE_CARD_LABELS.length;

const FONT = "'Pretendard Variable', Pretendard, 'Malgun Gothic', sans-serif";
const NAVY = '#0f2038';
const BLUE = '#1d4ed8';
const INK = '#0b1f38';
const YELLOW = '#ffd60a';

function gridBg(line: string): CSSProperties {
    return {
        backgroundImage: `linear-gradient(${line} 1px, transparent 1px), linear-gradient(90deg, ${line} 1px, transparent 1px)`,
        backgroundSize: '40px 40px',
    };
}

function Brackets({ color }: { color: string }) {
    const L = 44;
    const T = 4;
    const base: CSSProperties = { position: 'absolute', borderColor: color, borderStyle: 'solid' };
    return (
        <>
            <div style={{ ...base, left: 30, top: 30, width: L, height: L, borderWidth: `${T}px 0 0 ${T}px` }} />
            <div style={{ ...base, right: 30, top: 30, width: L, height: L, borderWidth: `${T}px ${T}px 0 0` }} />
            <div style={{ ...base, left: 30, bottom: 30, width: L, height: L, borderWidth: `0 0 ${T}px ${T}px` }} />
            <div style={{ ...base, right: 30, bottom: 30, width: L, height: L, borderWidth: `0 ${T}px ${T}px 0` }} />
        </>
    );
}

// 굵은 아웃라인 히어로 텍스트(레퍼런스 느낌) — 색 채움 + 진한 테두리 + 그림자.
function hero(size: number, strokeW: number, color: string): CSSProperties {
    return {
        fontSize: size,
        fontWeight: 900,
        color,
        lineHeight: 1.05,
        letterSpacing: -1,
        whiteSpace: 'pre-line',
        WebkitTextStroke: `${strokeW}px ${INK}`,
        paintOrder: 'stroke' as CSSProperties['paintOrder'],
        textShadow: '0 5px 14px rgba(0,0,0,0.5)',
    };
}

// 카드별 콘텐츠 매핑 — 큰 제목 + 서브 라인(굵게). 사진은 배경.
function heroSpec(c: CafeContent, index: number): { badge: string; title: string; lines: string[] } {
    const svc = c.leakTypes && c.leakTypes.length ? c.leakTypes : ['욕실누수', '천장누수', '배관교체'];
    switch (index) {
        case 0:
            return { badge: '신속출동', title: `${c.region}\n${c.business}`, lines: [svc[0], c.coverEmphasisHi] };
        case 1:
            return { badge: '지금 혹시', title: '이런 상황\n아니신가요?', lines: c.situations.slice(0, 3) };
        case 2:
            return { badge: 'WARNING', title: '미룰수록 커지는\n누수 피해', lines: c.damages.slice(0, 3).map((d) => `${d.period} · ${d.text}`) };
        case 3:
            return { badge: 'OUR WAY', title: '저희는\n이렇게 다릅니다', lines: c.waySteps.slice(0, 3) };
        case 4:
            return { badge: 'SELF CHECK', title: '이런 경우\n점검이 필요합니다', lines: c.checklist.slice(0, 4) };
        case 5:
            return { badge: 'WHY NOW', title: '빠를수록\n공사는 작아집니다', lines: [`${c.whyEarlyLabel} ${c.whyEarly}`, `${c.whyLateLabel} ${c.whyLate}`] };
        case 6:
            return { badge: 'SERVICE', title: '모든 누수를\n다룹니다', lines: svc.slice(0, 5) };
        case 7:
            return { badge: 'FAQ', title: '자주 묻는\n질문', lines: c.faqs.slice(0, 3).map((f) => f.q) };
        default:
            return { badge: 'PROMISE', title: `${c.business}\n약속드립니다`, lines: c.promises.slice(0, 4) };
    }
}

function HeroCard({ c, index }: { c: CafeContent; index: number }) {
    const photo = useContext(BgCtx);
    const spec = heroSpec(c, index);
    return (
        <div style={{ position: 'relative', width: CARD_W, height: CARD_H, background: NAVY, fontFamily: FONT, overflow: 'hidden' }}>
            {/* 사진 배경(상단 크게) */}
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 480, overflow: 'hidden' }}>
                {photo ? (
                    <img alt="" src={photo} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                    <div style={{ width: '100%', height: '100%', background: BLUE, ...gridBg('rgba(255,255,255,0.07)') }} />
                )}
                <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(9,20,35,0.28) 0%, transparent 42%, rgba(9,20,35,0.9) 100%)' }} />
                {/* 상단 지역 뱃지 */}
                <div style={{ position: 'absolute', top: 34, left: 40, display: 'flex', gap: 10 }}>
                    <span style={{ background: BLUE, color: '#fff', fontSize: 24, fontWeight: 800, padding: '10px 18px', borderRadius: 8, boxShadow: '0 4px 12px rgba(0,0,0,0.4)' }}>
                        ◉ {c.region}
                    </span>
                </div>
            </div>

            {/* 하단 네이비 패널 */}
            <div
                style={{
                    position: 'absolute',
                    left: 0,
                    right: 0,
                    top: 424,
                    bottom: 0,
                    background: 'linear-gradient(180deg, #17325c 0%, #0d1c33 100%)',
                    borderTopLeftRadius: 40,
                    borderTopRightRadius: 40,
                    padding: '0 46px',
                    boxShadow: '0 -12px 30px rgba(0,0,0,0.35)',
                }}
            >
                {/* 뱃지(패널 상단 겹침) */}
                <div style={{ position: 'absolute', top: -28, left: 46 }}>
                    <span style={{ background: YELLOW, color: INK, fontSize: 22, fontWeight: 900, padding: '11px 20px', borderRadius: 10, boxShadow: '0 6px 14px rgba(0,0,0,0.4)', letterSpacing: 1 }}>
                        {spec.badge}
                    </span>
                </div>

                {/* 큰 아웃라인 제목 */}
                <div style={{ marginTop: 62 }}>
                    <div style={hero(74, 8, YELLOW)}>{spec.title}</div>
                </div>

                {/* 서브 라인(굵게) */}
                <div style={{ marginTop: 22, display: 'grid', gap: 12 }}>
                    {spec.lines.filter(Boolean).map((t, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, color: '#eef4fb', fontSize: 29, fontWeight: 800, lineHeight: 1.25, textShadow: '0 2px 6px rgba(0,0,0,0.4)' }}>
                            <span style={{ color: YELLOW, flexShrink: 0 }}>›</span>
                            <span>{t}</span>
                        </div>
                    ))}
                </div>

                {/* 전화 바 */}
                <div style={{ position: 'absolute', left: 46, right: 46, bottom: 54, display: 'flex', alignItems: 'center', gap: 16 }}>
                    <span style={{ width: 60, height: 60, borderRadius: '50%', background: BLUE, color: '#fff', fontSize: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        ☎
                    </span>
                    <span style={{ color: YELLOW, fontSize: 56, fontWeight: 900, letterSpacing: 1, textShadow: '0 3px 8px rgba(0,0,0,0.5)' }}>{c.phone}</span>
                </div>
            </div>

            <Brackets color="rgba(255,255,255,0.8)" />
        </div>
    );
}

// index(0~8)로 카드 하나 렌더. bgImage=이 카드 배경 사진, photos=업로드 배열(하위호환).
export function CafeCard({
    content,
    index,
    bgImage,
    photos = [],
}: {
    content: CafeContent;
    index: number;
    bgImage?: string | null;
    photos?: string[];
}) {
    return (
        <BgCtx.Provider value={bgImage ?? null}>
            <PhotoCtx.Provider value={photos}>
                <HeroCard c={content} index={index} />
            </PhotoCtx.Provider>
        </BgCtx.Provider>
    );
}
