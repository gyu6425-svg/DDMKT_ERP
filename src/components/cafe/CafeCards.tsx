import { createContext, useContext, type CSSProperties, type ReactNode } from 'react';
import type { CafeContent } from './cafeContent';

// AI로 생성한 '무드 배경' 이미지(dataURL) — 있으면 9장 카드가 공유해 고퀄리티 배경으로 사용(카드색은 틴트로 유지).
const BgCtx = createContext<string | null>(null);

// 카페 카드 9종 템플릿 — 예시(엘르홈 스타일)와 동일 구조. 800×1000 고정, 인라인 스타일로 렌더(html-to-image 캡처 안정).
//   AI 이미지가 아니라 코드 렌더라 한글·전화번호·FAQ가 100% 정확. Pretendard 폰트 사용.

export const CARD_W = 800;
export const CARD_H = 1000;
export const CAFE_CARD_LABELS = [
    '커버',
    'CHECK 01 · 상황',
    'CHECK 02 · 경고',
    'CHECK 03 · 방식',
    'CHECK 04 · 자가점검',
    'CHECK 05 · 시기',
    'CHECK 06 · 서비스',
    'CHECK 07 · FAQ',
    '약속 · 연락처',
];
export const CAFE_CARD_COUNT = CAFE_CARD_LABELS.length;

const FONT = "'Pretendard Variable', Pretendard, 'Malgun Gothic', sans-serif";

// 팔레트(카드별)
const NAVY = '#16273f';
const SKY = '#6fb2d8';
const BLUE = '#2c597d';
const RED = '#c0392b';
const TEAL = '#2b6d81';
const ORANGE = '#c1801f';
const LIGHT = '#eef1f6';
const INK = '#1b2b45';

// 은은한 그리드 배경(예시의 청사진 느낌).
function gridBg(line: string): CSSProperties {
    return {
        backgroundImage: `linear-gradient(${line} 1px, transparent 1px), linear-gradient(90deg, ${line} 1px, transparent 1px)`,
        backgroundSize: '40px 40px',
    };
}

// 4모서리 ㄱ자 브래킷.
function Brackets({ color }: { color: string }) {
    const L = 46;
    const T = 4;
    const base: CSSProperties = { position: 'absolute', borderColor: color, borderStyle: 'solid' };
    return (
        <>
            <div style={{ ...base, left: 40, top: 40, width: L, height: L, borderWidth: `${T}px 0 0 ${T}px` }} />
            <div style={{ ...base, right: 40, top: 40, width: L, height: L, borderWidth: `${T}px ${T}px 0 0` }} />
            <div style={{ ...base, left: 40, bottom: 40, width: L, height: L, borderWidth: `0 0 ${T}px ${T}px` }} />
            <div style={{ ...base, right: 40, bottom: 40, width: L, height: L, borderWidth: `0 ${T}px ${T}px 0` }} />
        </>
    );
}

// 상단 중앙 뱃지(영문 라벨).
function TopBadge({ text, bg, fg }: { text: string; bg: string; fg: string }) {
    return (
        <div
            style={{
                position: 'absolute',
                top: 44,
                left: '50%',
                transform: 'translateX(-50%)',
                background: bg,
                color: fg,
                fontSize: 20,
                fontWeight: 800,
                letterSpacing: 6,
                padding: '10px 26px',
                borderRadius: 4,
                whiteSpace: 'nowrap',
            }}
        >
            {text}
        </div>
    );
}

// CHECK 0X 라벨 + 라인
function CheckLabel({ n, color, line }: { n: string; color: string; line: string }) {
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 22 }}>
            <span style={{ color, fontSize: 20, fontWeight: 800, letterSpacing: 4, whiteSpace: 'nowrap' }}>
                CHECK {n}
            </span>
            <span style={{ flex: 1, height: 1, background: line }} />
        </div>
    );
}

// 큰 제목(2줄까지)
function Title({ text, color }: { text: string; color: string }) {
    return (
        <div style={{ color, fontSize: 52, fontWeight: 800, lineHeight: 1.25, whiteSpace: 'pre-line', letterSpacing: -1 }}>
            {text}
        </div>
    );
}

// 하단 푸터(업체명 + 페이지)
function Footer({ brand, page, color }: { brand: string; page?: string; color: string }) {
    return (
        <div
            style={{
                position: 'absolute',
                left: 64,
                right: 64,
                bottom: 66,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                color,
                fontSize: 18,
                fontWeight: 600,
                letterSpacing: 1,
            }}
        >
            <span>{brand}</span>
            {page ? <span style={{ letterSpacing: 3 }}>{page}</span> : <span />}
        </div>
    );
}

// 카드 공통 프레임
function Frame({
    bg,
    grid,
    bracket,
    children,
}: {
    bg: string;
    grid?: string;
    bracket: string;
    children: ReactNode;
}) {
    const bgImage = useContext(BgCtx);
    return (
        <div
            style={{
                position: 'relative',
                width: CARD_W,
                height: CARD_H,
                background: bg,
                ...(grid && !bgImage ? gridBg(grid) : {}),
                fontFamily: FONT,
                overflow: 'hidden',
                boxSizing: 'border-box',
            }}
        >
            {/* AI 무드 배경(있을 때) — 사진 + 카드색 틴트 오버레이로 텍스트 가독성 유지. 텍스트/브래킷은 이 위에 렌더. */}
            {bgImage ? (
                <>
                    <img
                        alt=""
                        src={bgImage}
                        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                    <div style={{ position: 'absolute', inset: 0, background: bg, opacity: 0.8 }} />
                    <div
                        style={{
                            position: 'absolute',
                            inset: 0,
                            background: `linear-gradient(180deg, ${bg}cc 0%, transparent 30%, transparent 70%, ${bg}cc 100%)`,
                        }}
                    />
                </>
            ) : null}
            <Brackets color={bracket} />
            {children}
        </div>
    );
}

const body = (top: number): CSSProperties => ({ position: 'absolute', left: 64, right: 64, top });

// 굵은 아웃라인(외곽선) 히어로 텍스트 — 예시의 흰 글자+진한 테두리+그림자.
const hero = (size: number, strokeW: number): CSSProperties => ({
    fontSize: size,
    fontWeight: 900,
    color: '#ffffff',
    lineHeight: 1.02,
    letterSpacing: -2,
    whiteSpace: 'pre-line',
    WebkitTextStroke: `${strokeW}px #0a1f3c`,
    paintOrder: 'stroke' as CSSProperties['paintOrder'],
    textShadow: '0 6px 16px rgba(0,0,0,0.55)',
});

// ── 1) 커버(히어로 홍보) — AI 실사 배경 위 굵은 텍스트·지역뱃지·전화바·서비스태그 ──
function Cover({ c }: { c: CafeContent }) {
    const bgImage = useContext(BgCtx);
    const tags = [c.leakTypes[0] || '욕실누수', '누수탐지', '배관교체'];
    return (
        <div style={{ position: 'relative', width: CARD_W, height: CARD_H, background: NAVY, fontFamily: FONT, overflow: 'hidden' }}>
            {/* 배경 — AI 실사 이미지(있으면 크게), 없으면 청사진 그리드 */}
            {bgImage ? (
                <img alt="" src={bgImage} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
                <div style={{ position: 'absolute', inset: 0, ...gridBg('rgba(255,255,255,0.06)') }} />
            )}
            {/* 가독성 그라디언트 — 좌측·하단을 진하게 */}
            <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(9,20,35,0.55) 0%, rgba(9,20,35,0.12) 34%, rgba(9,20,35,0.30) 58%, rgba(9,20,35,0.94) 100%)' }} />
            <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(90deg, rgba(9,20,35,0.72) 0%, rgba(9,20,35,0.15) 52%, transparent 78%)' }} />
            <Brackets color="#ffffff" />

            {/* 지역 뱃지 + 배지 */}
            <div style={{ position: 'absolute', top: 66, left: 64, right: 64, display: 'flex', gap: 10, alignItems: 'center' }}>
                <span style={{ background: '#1d4ed8', color: '#fff', fontSize: 24, fontWeight: 800, padding: '10px 18px', borderRadius: 6 }}>
                    ◉ {c.region}
                </span>
                <span style={{ background: 'rgba(255,255,255,0.16)', color: '#dbeafe', fontSize: 18, fontWeight: 700, padding: '10px 16px', borderRadius: 6, letterSpacing: 3 }}>
                    {c.coverBadge}
                </span>
            </div>

            {/* 히어로 타이틀 */}
            <div style={{ position: 'absolute', left: 60, right: 60, top: 372 }}>
                <div style={hero(94, 9)}>{c.coverTitle.replace(/\s+/, '\n')}</div>
                <div style={{ display: 'inline-block', marginTop: 26, background: '#1d4ed8', color: '#fff', fontSize: 34, fontWeight: 800, padding: '14px 24px', boxShadow: '0 6px 14px rgba(0,0,0,0.35)' }}>
                    {c.coverEmphasisHi}
                </div>
                <div style={{ marginTop: 22, display: 'flex', alignItems: 'center', gap: 10, color: '#eaf1f8', fontSize: 26, fontWeight: 700, textShadow: '0 2px 6px rgba(0,0,0,0.6)' }}>
                    <span style={{ color: '#38bdf8', fontSize: 30 }}>✓</span> 정확한 장비 탐지로 원인 해결
                </div>
            </div>

            {/* 전화 바 */}
            <div style={{ position: 'absolute', left: 54, right: 54, bottom: 148, display: 'flex', alignItems: 'center', gap: 18, background: '#0b1f38', border: '2px solid rgba(255,255,255,0.16)', borderRadius: 16, padding: '16px 26px', boxShadow: '0 10px 24px rgba(0,0,0,0.4)' }}>
                <span style={{ width: 58, height: 58, borderRadius: '50%', background: '#1d4ed8', color: '#fff', fontSize: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>☎</span>
                <span style={{ color: '#ffd60a', fontSize: 54, fontWeight: 900, letterSpacing: 1 }}>{c.phone}</span>
            </div>

            {/* 서비스 태그 */}
            <div style={{ position: 'absolute', left: 54, right: 54, bottom: 72, display: 'flex', gap: 12, justifyContent: 'center' }}>
                {tags.map((t, i) => (
                    <span key={i} style={{ background: 'rgba(255,255,255,0.94)', color: INK, fontSize: 24, fontWeight: 800, padding: '12px 22px', borderRadius: 30 }}>
                        ◆ {t}
                    </span>
                ))}
            </div>
        </div>
    );
}

// 흰 박스(아이콘 + 텍스트) 리스트 아이템
function WhiteRow({ icon, text }: { icon?: string; text: string }) {
    return (
        <div
            style={{
                background: '#fff',
                borderRadius: 6,
                padding: '26px 28px',
                display: 'flex',
                alignItems: 'center',
                gap: 16,
                color: INK,
                fontSize: 27,
                fontWeight: 700,
                boxShadow: '0 6px 16px rgba(0,0,0,0.12)',
            }}
        >
            {icon ? <span style={{ fontSize: 28 }}>{icon}</span> : null}
            <span>{text}</span>
        </div>
    );
}

// ── 2) CHECK 01 — 이런 상황 아니신가요? ───────────────────────
function Card01({ c }: { c: CafeContent }) {
    const icons = ['💧', '📈', '📞'];
    return (
        <Frame bg={BLUE} grid="rgba(255,255,255,0.05)" bracket="#ffffff">
            <TopBadge text="지금 혹시" bg="#fff" fg={INK} />
            <div style={body(150)}>
                <CheckLabel n="01" color="#cfe0ee" line="rgba(255,255,255,0.35)" />
                <Title text={'이런 상황\n아니신가요?'} color="#fff" />
                <div style={{ width: 90, height: 6, background: SKY, margin: '24px 0 40px' }} />
                <div style={{ display: 'grid', gap: 22 }}>
                    {c.situations.map((s, i) => (
                        <WhiteRow key={i} icon={icons[i]} text={s} />
                    ))}
                </div>
                <div
                    style={{
                        background: RED,
                        color: '#fff',
                        fontSize: 26,
                        fontWeight: 800,
                        padding: '22px 26px',
                        marginTop: 46,
                    }}
                >
                    {c.situationWarn}
                </div>
            </div>
            <Footer brand={`${c.brand} ${c.branch}`} page="01 / 07" color="rgba(255,255,255,0.7)" />
        </Frame>
    );
}

// ── 3) CHECK 02 — 미룰수록 커지는 누수 피해 ────────────────────
function Card02({ c }: { c: CafeContent }) {
    return (
        <Frame bg={RED} grid="rgba(255,255,255,0.06)" bracket="#ffffff">
            <TopBadge text="WARNING" bg={INK} fg="#fff" />
            <div style={body(150)}>
                <CheckLabel n="02" color="#ffdcd6" line="rgba(255,255,255,0.4)" />
                <Title text={'미룰수록 커지는\n누수 피해'} color="#fff" />
                <div style={{ width: 90, height: 6, background: '#fff', margin: '24px 0 36px' }} />
                <div style={{ display: 'grid', gap: 20 }}>
                    {c.damages.map((d, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
                            <span
                                style={{
                                    background: '#fff',
                                    color: RED,
                                    fontSize: 26,
                                    fontWeight: 800,
                                    padding: '14px 0',
                                    width: 150,
                                    textAlign: 'center',
                                    flexShrink: 0,
                                }}
                            >
                                {d.period}
                            </span>
                            <span style={{ color: '#fff', fontSize: 22, fontWeight: 800 }}>▶</span>
                            <span style={{ color: '#fff', fontSize: 26, fontWeight: 700 }}>{d.text}</span>
                        </div>
                    ))}
                </div>
                <div style={{ color: '#fff', fontSize: 62, fontWeight: 800, lineHeight: 1.2, marginTop: 46, letterSpacing: -1 }}>
                    {c.damagePunch1}
                    <br />
                    {c.damagePunch2}
                </div>
            </div>
            <Footer brand={`${c.brand} ${c.branch}`} page="02 / 07" color="rgba(255,255,255,0.8)" />
        </Frame>
    );
}

// ── 4) CHECK 03 — 무조건 철거부터? 저희는 다릅니다 ──────────────
function Card03({ c }: { c: CafeContent }) {
    return (
        <Frame bg={TEAL} grid="rgba(255,255,255,0.05)" bracket="#ffffff">
            <TopBadge text="OUR WAY" bg="#fff" fg={INK} />
            <div style={body(150)}>
                <CheckLabel n="03" color="#cfe6ec" line="rgba(255,255,255,0.35)" />
                <Title text={'무조건 철거부터?\n저희는 다릅니다'} color="#fff" />
                <div style={{ color: '#e6f1f4', fontSize: 23, fontWeight: 500, lineHeight: 1.6, margin: '30px 0 34px' }}>
                    {c.wayIntroPre}{' '}
                    <span style={{ background: 'rgba(255,255,255,0.22)', fontWeight: 700, padding: '1px 4px' }}>
                        {c.wayIntroHi}
                    </span>
                    {c.wayIntroPost}
                </div>
                <div style={{ display: 'grid', gap: 20 }}>
                    {c.waySteps.map((s, i) => (
                        <div
                            key={i}
                            style={{
                                background: '#fff',
                                borderBottom: `5px solid ${INK}`,
                                padding: '24px 26px',
                                display: 'flex',
                                gap: 16,
                                color: INK,
                                fontSize: 26,
                                fontWeight: 700,
                            }}
                        >
                            <span style={{ color: TEAL, fontWeight: 800 }}>{i + 1}</span>
                            <span>{s}</span>
                        </div>
                    ))}
                </div>
                <div style={{ display: 'inline-block', background: INK, color: '#fff', fontSize: 24, fontWeight: 800, padding: '16px 24px', marginTop: 34 }}>
                    {c.wayFooter}
                </div>
            </div>
            <Footer brand={`${c.brand} ${c.branch}`} page="03 / 07" color="rgba(255,255,255,0.7)" />
        </Frame>
    );
}

// ── 5) CHECK 04 — 이런 경우 바로 점검이 필요합니다 ──────────────
function Card04({ c }: { c: CafeContent }) {
    return (
        <Frame bg={NAVY} grid="rgba(255,255,255,0.045)" bracket="#ffffff">
            <TopBadge text="SELF CHECK" bg="#fff" fg={INK} />
            <div style={body(150)}>
                <CheckLabel n="04" color="#cfe0ee" line="rgba(255,255,255,0.3)" />
                <Title text={'이런 경우 바로\n점검이 필요합니다'} color="#fff" />
                <div style={{ width: 90, height: 6, background: SKY, margin: '24px 0 34px' }} />
                <div style={{ display: 'grid', gap: 0 }}>
                    {c.checklist.map((s, i) => (
                        <div
                            key={i}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 18,
                                padding: '20px 0',
                                borderBottom: i < c.checklist.length - 1 ? '1px dashed rgba(255,255,255,0.2)' : 'none',
                                color: '#eaf1f8',
                                fontSize: 26,
                                fontWeight: 600,
                            }}
                        >
                            <span
                                style={{
                                    width: 34,
                                    height: 34,
                                    border: `2px solid ${SKY}`,
                                    borderRadius: 4,
                                    color: SKY,
                                    fontSize: 22,
                                    fontWeight: 800,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    flexShrink: 0,
                                }}
                            >
                                ✓
                            </span>
                            {s}
                        </div>
                    ))}
                </div>
            </div>
            <Footer brand={`${c.brand} ${c.branch}`} page="04 / 07" color="rgba(255,255,255,0.6)" />
        </Frame>
    );
}

// ── 6) CHECK 05 — 발견이 빠를수록 공사는 작아집니다 ─────────────
function Card05({ c }: { c: CafeContent }) {
    return (
        <Frame bg={ORANGE} grid="rgba(255,255,255,0.06)" bracket="#ffffff">
            <TopBadge text="WHY NOW" bg="#fff" fg={INK} />
            <div style={body(150)}>
                <CheckLabel n="05" color="#f4e2c4" line="rgba(255,255,255,0.4)" />
                <Title text={'발견이 빠를수록\n공사는 작아집니다'} color="#fff" />
                <div style={{ color: '#f7ecd9', fontSize: 23, fontWeight: 500, lineHeight: 1.6, margin: '30px 0 38px' }}>
                    {c.whyIntroPre}{' '}
                    <span style={{ background: 'rgba(255,255,255,0.28)', color: INK, fontWeight: 700, padding: '1px 5px' }}>
                        {c.whyIntroHi}
                    </span>
                    {c.whyIntroPost}
                </div>
                <div style={{ display: 'flex', gap: 22 }}>
                    <div style={{ flex: 1, background: '#fff', padding: '28px 26px' }}>
                        <div style={{ color: '#2f7fb0', fontSize: 22, fontWeight: 800, marginBottom: 14 }}>{c.whyEarlyLabel}</div>
                        <div style={{ color: INK, fontSize: 28, fontWeight: 800, lineHeight: 1.4 }}>{c.whyEarly}</div>
                    </div>
                    <div style={{ flex: 1, background: '#2a2016', padding: '28px 26px' }}>
                        <div style={{ color: '#e59a6b', fontSize: 22, fontWeight: 800, marginBottom: 14 }}>{c.whyLateLabel}</div>
                        <div style={{ color: '#fff', fontSize: 28, fontWeight: 800, lineHeight: 1.4 }}>{c.whyLate}</div>
                    </div>
                </div>
            </div>
            <Footer brand={`${c.brand} ${c.branch}`} page="05 / 07" color="rgba(255,255,255,0.75)" />
        </Frame>
    );
}

// 태그 칩
function Tag({ text, bg, fg }: { text: string; bg: string; fg: string }) {
    return (
        <span style={{ background: bg, color: fg, fontSize: 25, fontWeight: 700, padding: '16px 24px', borderRadius: 4 }}>
            {text}
        </span>
    );
}

// ── 7) CHECK 06 — 건물부터 배관까지 ──────────────────────────
function Card06({ c }: { c: CafeContent }) {
    return (
        <Frame bg={BLUE} grid="rgba(255,255,255,0.05)" bracket="#ffffff">
            <TopBadge text="SERVICE" bg="#fff" fg={INK} />
            <div style={body(150)}>
                <CheckLabel n="06" color="#cfe0ee" line="rgba(255,255,255,0.35)" />
                <Title text={'건물부터 배관까지\n모든 누수를 다룹니다'} color="#fff" />
                <div style={{ width: 90, height: 6, background: SKY, margin: '24px 0 40px' }} />
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginBottom: 20 }}>
                    {c.buildingTypes.map((t, i) => (
                        <Tag key={i} text={t} bg="#fff" fg={INK} />
                    ))}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
                    {c.leakTypes.map((t, i) => (
                        <Tag key={i} text={t} bg="#1d3a55" fg="#dbe8f2" />
                    ))}
                </div>
                <div style={{ display: 'inline-block', background: INK, color: '#fff', fontSize: 24, fontWeight: 800, padding: '18px 26px', marginTop: 54 }}>
                    {c.serviceFooter}
                </div>
            </div>
            <Footer brand={`${c.brand} ${c.branch}`} page="06 / 07" color="rgba(255,255,255,0.7)" />
        </Frame>
    );
}

// ── 8) CHECK 07 — FAQ ───────────────────────────────────────
function Card07({ c }: { c: CafeContent }) {
    return (
        <Frame bg={LIGHT} grid="rgba(27,43,69,0.05)" bracket={INK}>
            <TopBadge text="FAQ" bg={INK} fg="#fff" />
            <div style={body(150)}>
                <CheckLabel n="07" color="#6b7b93" line="rgba(27,43,69,0.2)" />
                <Title text={'가장 많이\n물어보시는 질문'} color={INK} />
                <div style={{ width: 90, height: 6, background: RED, margin: '24px 0 32px' }} />
                <div style={{ display: 'grid', gap: 24 }}>
                    {c.faqs.map((f, i) => (
                        <div key={i} style={{ borderBottom: '1px dashed rgba(27,43,69,0.18)', paddingBottom: 22 }}>
                            <div style={{ color: INK, fontSize: 26, fontWeight: 800, marginBottom: 10 }}>
                                <span style={{ color: INK }}>Q.</span> {f.q}
                            </div>
                            <div style={{ color: '#3d4a5e', fontSize: 23, fontWeight: 500, lineHeight: 1.5 }}>
                                <span style={{ color: RED, fontWeight: 800 }}>A.</span> {f.a}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
            <Footer brand={`${c.brand} ${c.branch}`} page="07 / 07" color="#6b7b93" />
        </Frame>
    );
}

// ── 9) 약속 + 연락처 ─────────────────────────────────────────
function Promise({ c }: { c: CafeContent }) {
    return (
        <Frame bg={NAVY} grid="rgba(255,255,255,0.045)" bracket="#ffffff">
            <TopBadge text="PROMISE" bg="#fff" fg={INK} />
            <div style={body(150)}>
                <div style={{ color: '#dfe8f2', fontSize: 26, fontWeight: 700, letterSpacing: 1, borderBottom: '1px solid rgba(255,255,255,0.25)', paddingBottom: 22, marginBottom: 8 }}>
                    {c.brand} {c.branch}이 약속드립니다
                </div>
                <div style={{ display: 'grid', gap: 0 }}>
                    {c.promises.map((p, i) => (
                        <div
                            key={i}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 18,
                                padding: '22px 0',
                                borderBottom: '1px dashed rgba(255,255,255,0.16)',
                                color: '#eaf1f8',
                                fontSize: 27,
                                fontWeight: 700,
                            }}
                        >
                            <span style={{ background: '#fff', color: NAVY, width: 36, height: 36, borderRadius: 4, fontSize: 22, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                {i + 1}
                            </span>
                            {p}
                        </div>
                    ))}
                </div>
                <div style={{ textAlign: 'center', color: '#e7edf5', fontSize: 25, fontWeight: 500, lineHeight: 1.6, margin: '40px 0 0' }}>
                    {c.promiseClose1}
                    <br />
                    {c.promiseClose2}
                </div>
            </div>
            <div style={{ position: 'absolute', left: 80, right: 80, bottom: 70, border: '2px dashed rgba(255,255,255,0.4)', padding: '26px 0', textAlign: 'center' }}>
                <div style={{ color: '#fff', fontSize: 24, fontWeight: 700, letterSpacing: 2 }}>
                    24시간 <span style={{ color: SKY }}>상담문의</span>
                </div>
                <div style={{ color: '#fff', fontSize: 54, fontWeight: 800, letterSpacing: 1, marginTop: 8 }}>{c.phone}</div>
            </div>
        </Frame>
    );
}

// index(0~8)로 카드 하나 렌더. bgImage 주면 9장 공유 무드 배경 적용.
export function CafeCard({ content, index, bgImage }: { content: CafeContent; index: number; bgImage?: string | null }) {
    const one = () => {
        switch (index) {
            case 0:
                return <Cover c={content} />;
            case 1:
                return <Card01 c={content} />;
            case 2:
                return <Card02 c={content} />;
            case 3:
                return <Card03 c={content} />;
            case 4:
                return <Card04 c={content} />;
            case 5:
                return <Card05 c={content} />;
            case 6:
                return <Card06 c={content} />;
            case 7:
                return <Card07 c={content} />;
            default:
                return <Promise c={content} />;
        }
    };
    return <BgCtx.Provider value={bgImage ?? null}>{one()}</BgCtx.Provider>;
}
