import { createContext, useContext, type CSSProperties } from 'react';
import type { CafeContent } from './cafeContent';

// 카페 카드 9종 — 레퍼런스(상계동) 레이아웃 정밀 복제. 1080×1080 정사각, 인라인 스타일(html-to-image 안정).
//   구조: 상단 = 업로드 사진 콜라주(1~3장) · 하단 = 네이비 패널(신속출동 뱃지 + 지역 + 업종 큰 아웃라인
//   + 서비스 알약 + 탐지부터 공사까지 + 전화). 9장 동일 레이아웃, 카드마다 다른 사진/헤드라인.
//   텍스트는 코드 렌더라 한글·전화 100% 정확.

const PhotoCtx = createContext<string[]>([]); // 업로드 사진 배열
const BgCtx = createContext<string | null>(null); // 사진 없을 때 AI 배경 폴백

export const CARD_W = 1080;
export const CARD_H = 1080;
export const CAFE_CARD_LABELS = ['커버', '상황', '경고', '방식', '점검', '시기', '서비스', 'FAQ', '약속'];
export const CAFE_CARD_COUNT = CAFE_CARD_LABELS.length;

const FONT = "'Pretendard Variable', Pretendard, 'Malgun Gothic', sans-serif";
const INK = '#0a1b33';
const YELLOW = '#ffd60a';
const BLUE = '#1d4ed8';
const PHOTO_H = 440;

function gridBg(line: string): CSSProperties {
    return {
        backgroundImage: `linear-gradient(${line} 1px, transparent 1px), linear-gradient(90deg, ${line} 1px, transparent 1px)`,
        backgroundSize: '48px 48px',
    };
}

// 굵은 아웃라인 텍스트 — 색 채움 + 진한 테두리(뒤) + 그림자.
function outlined(size: number, color: string, strokeW: number): CSSProperties {
    return {
        fontSize: size,
        fontWeight: 900,
        color,
        lineHeight: 1.04,
        letterSpacing: -1,
        whiteSpace: 'pre-line',
        WebkitTextStroke: `${strokeW}px ${INK}`,
        paintOrder: 'stroke' as CSSProperties['paintOrder'],
        textShadow: '0 5px 14px rgba(0,0,0,0.45)',
    };
}

// 헤드라인 길이에 따라 크기 조절(가장 긴 줄 기준).
function headlineSize(text: string): number {
    const longest = Math.max(...text.split('\n').map((s) => s.length));
    if (longest <= 4) return 132;
    if (longest <= 6) return 104;
    if (longest <= 8) return 86;
    return 72;
}

// 카드 공통 텍스트 — 모든 카드가 레퍼런스와 동일: 지역 + 업종 + 서비스. 사진만 카드마다 다름.
function heroSpec(c: CafeContent) {
    const svc = c.leakTypes && c.leakTypes.length ? c.leakTypes : ['외부 누수', '욕실 배관 누수'];
    return {
        topLine: c.region, // 과천
        big: c.business, // 누수탐지
        pill: svc.slice(0, 2).join(' · '), // 외부 누수 · 욕실 배관 누수
    };
}

function HeroCard({ c, index }: { c: CafeContent; index: number }) {
    const photos = useContext(PhotoCtx);
    const bg = useContext(BgCtx);
    const spec = heroSpec(c);
    // 콜라주 — 업로드 사진을 카드 index만큼 회전해 최대 3장(카드마다 다른 조합).
    const n = photos.length;
    const collage = n
        ? Array.from({ length: Math.min(3, n) }, (_, k) => photos[(index + k) % n])
        : [];
    return (
        <div style={{ position: 'relative', width: CARD_W, height: CARD_H, background: INK, fontFamily: FONT, overflow: 'hidden' }}>
            {/* 상단 사진 콜라주 */}
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: PHOTO_H, display: 'flex', gap: 4, background: '#0a1526' }}>
                {collage.length ? (
                    collage.map((p, i) => (
                        <div key={i} style={{ flex: 1, overflow: 'hidden' }}>
                            <img alt="" src={p} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        </div>
                    ))
                ) : bg ? (
                    <img alt="" src={bg} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                    <div style={{ flex: 1, background: BLUE, ...gridBg('rgba(255,255,255,0.07)') }} />
                )}
            </div>

            {/* 하단 네이비 패널 */}
            <div
                style={{
                    position: 'absolute',
                    left: 0,
                    right: 0,
                    top: PHOTO_H - 34,
                    bottom: 0,
                    background: 'linear-gradient(180deg, #1b3a68 0%, #0c1c34 100%)',
                    borderTopLeftRadius: 54,
                    borderTopRightRadius: 54,
                    padding: '0 56px',
                    boxShadow: '0 -14px 34px rgba(0,0,0,0.4)',
                }}
            >
                {/* 신속출동 뱃지(패널 상단 겹침) */}
                <div style={{ position: 'absolute', top: -40, left: 54, transform: 'rotate(-7deg)' }}>
                    <span
                        style={{
                            display: 'inline-block',
                            background: YELLOW,
                            color: INK,
                            fontSize: 30,
                            fontWeight: 900,
                            padding: '16px 26px',
                            borderRadius: 14,
                            border: '4px solid #fff',
                            boxShadow: '0 8px 18px rgba(0,0,0,0.4)',
                            letterSpacing: 1,
                        }}
                    >
                        신속출동
                    </span>
                </div>

                {/* 지역(작게) */}
                <div style={{ ...outlined(spec.topLine.length > 5 ? 60 : 72, '#ffffff', 7), marginTop: 78 }}>{spec.topLine}</div>
                {/* 업종(크게) */}
                <div style={{ ...outlined(headlineSize(spec.big), YELLOW, 10), marginTop: 8 }}>{spec.big}</div>

                {/* 전화 */}
                <div style={{ position: 'absolute', left: 56, right: 56, bottom: 64, display: 'flex', alignItems: 'center', gap: 20 }}>
                    <span style={{ width: 74, height: 74, borderRadius: '50%', background: BLUE, color: '#fff', fontSize: 38, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        ☎
                    </span>
                    <span style={{ ...outlined(72, '#ffffff', 6), letterSpacing: 1 }}>{c.phone}</span>
                </div>
            </div>
        </div>
    );
}

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
