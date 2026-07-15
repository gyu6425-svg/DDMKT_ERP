import { useState } from 'react';
import { generateSecurityBanner } from '../../api/cafeWriter';
import { logApiUsage } from '../../api/apiUsage';
import { computeRecordCostUsd, USD_TO_KRW } from '../../lib/apiPricing';
import { useAuth } from '../../hooks/useAuth';

// 더맨시스템2 — 보안 배너(파란 레퍼런스 스타일). 지역·보안종류·제목3줄 → 하단 3개 자동(프리셋/AI) + 저화질 이미지 1장.
//   방식은 더맨시스템(초록)과 동일, 스타일만 파란 무드(누수탐지 배너 느낌). 전화번호 없음. 이미지만.

const QUALITY_OPTS: [('low' | 'medium' | 'high'), string, number][] = [
    ['low', '저화질', 15],
    ['medium', '중화질', 60],
    ['high', '고화질', 240],
];

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

export function CafeTheman2Tab() {
    const { profile } = useAuth();
    const [region, setRegion] = useState('일산');
    const [secType, setSecType] = useState('회사 보안');
    const [l1, setL1] = useState('건물의');
    const [l2, setL2] = useState('안전을');
    const [l3, setL3] = useState('책임지는');
    const [quality, setQuality] = useState<'low' | 'medium' | 'high'>('low');
    const [img, setImg] = useState<string | null>(null);
    const [items, setItems] = useState<{ title: string; subtitle: string; icon: string }[]>([]);
    const [source, setSource] = useState<'preset' | 'ai' | null>(null);
    const [cost, setCost] = useState<{ krw: number; text: number; image: number } | null>(null);
    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState('');

    const generate = async () => {
        if (busy) return;
        const titleLines = [l1, l2, l3].map((s) => s.trim()).filter(Boolean);
        if (!region.trim() || !secType.trim() || !titleLines.length) {
            setMsg('지역·보안종류·제목(최소 1줄)을 입력하세요.');
            return;
        }
        setBusy(true);
        setMsg('파란 스타일 보안 배너 생성 중… (약 30초~1분)');
        const operatorName = (typeof localStorage !== 'undefined' && localStorage.getItem('erp_operator_name')) || null;
        const email = profile?.email ?? null;
        const t = Date.now();
        try {
            const r = await generateSecurityBanner({ quality, region, secType, style: 'blue', titleLines });
            setImg(r.imageDataUrl);
            setItems(r.items);
            setSource(r.source);
            const textCost = r.textUsage ? computeRecordCostUsd({ model: 'gpt-5.5', provider: 'openai', usage_raw: r.textUsage }) : 0;
            const imageCost = computeRecordCostUsd({ banner_size: 'square', image_quality: quality, provider: 'openai', usage_raw: r.imageUsage });
            const krw = Math.round((textCost + imageCost) * USD_TO_KRW);
            setCost({ image: imageCost, krw, text: textCost });
            if (r.textUsage) {
                void logApiUsage({
                    cost_usd: textCost, elapsed_ms: Date.now() - t, model: 'sec-items', operator_name: operatorName,
                    provider: 'openai', status: 'success', usage_raw: r.textUsage as never, user_email: email,
                });
            }
            void logApiUsage({
                banner_size: 'square', cost_usd: imageCost, elapsed_ms: Date.now() - t, image_quality: quality,
                model: 'sec-card2', operator_name: operatorName, provider: 'openai', status: 'success',
                usage_raw: r.imageUsage as never, user_email: email,
            });
            setMsg(`완성 — 하단 3개 ${r.source === 'preset' ? '프리셋(추가 0원)' : 'AI 자동생성'} · 총 ${krw}원`);
        } catch (e) {
            setMsg(e instanceof Error ? e.message : '생성 실패');
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="grid gap-5">
            <p className="m-0 text-sm text-[#64748b]">
                <b>더맨시스템2 (파란 스타일)</b> — 지역·보안종류·제목만 넣으면 <b>하단 3개 + 아이콘 자동</b>. 누수탐지 배너 느낌의
                파란 레이아웃(큰 제목 · 신뢰 3항목 패널 · 하단 파란 띠). 전화번호 없음 · 이미지 1장.
            </p>

            <div className="rounded-xl border-2 border-[#1e5bd8] bg-[#eff6ff] p-4">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Field label="지역명 (예: 일산)" value={region} onChange={setRegion} />
                    <Field label="보안 종류 (예: 회사 보안 / 야외행사 / 공사장)" value={secType} onChange={setSecType} />
                </div>
                <div className="mt-3">
                    <span className="text-[12px] font-semibold text-[#475569]">제목 (3줄 · 큰 글씨)</span>
                    <div className="mt-1 grid grid-cols-3 gap-2">
                        <input className="h-9 rounded-md border border-[#cbd5e1] bg-white px-2.5 text-sm" onChange={(e) => setL1(e.target.value)} placeholder="1줄" value={l1} />
                        <input className="h-9 rounded-md border border-[#cbd5e1] bg-white px-2.5 text-sm" onChange={(e) => setL2(e.target.value)} placeholder="2줄" value={l2} />
                        <input className="h-9 rounded-md border border-[#cbd5e1] bg-white px-2.5 text-sm" onChange={(e) => setL3(e.target.value)} placeholder="3줄" value={l3} />
                    </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                    <span className="mr-1 text-[12px] font-semibold text-[#475569]">화질</span>
                    {QUALITY_OPTS.map(([k, label, won]) => (
                        <button
                            className={`rounded-full px-3 py-1 text-[12px] font-semibold ${quality === k ? 'bg-[#1e5bd8] text-white' : 'border border-[#cbd5e1] text-[#475569] hover:bg-[#f1f5f9]'}`}
                            key={k}
                            onClick={() => setQuality(k)}
                            type="button"
                        >
                            {label} ~{won}원
                        </button>
                    ))}
                    <span className="ml-1 text-[11px] text-[#94a3b8]">권장: 저화질(글자 안 깨짐 · 최저가)</span>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button
                        className="h-10 rounded-md bg-[#1e5bd8] px-6 text-sm font-bold text-white hover:bg-[#1a4fbf] disabled:opacity-50"
                        disabled={busy}
                        onClick={() => void generate()}
                        type="button"
                    >
                        {busy ? '보안 배너 생성 중…' : '보안 배너 생성 (파란 스타일)'}
                    </button>
                    {msg ? <span className="text-[13px] text-[#1e5bd8]">{msg}</span> : null}
                </div>

                {img ? (
                    <div className="mt-4 flex flex-wrap items-start gap-4">
                        <img alt="보안 배너(파란)" className="w-64 rounded-lg border border-[#cbd5e1]" src={img} />
                        <div className="grid gap-2 text-[13px]">
                            <div className="font-bold text-[#334155]">
                                하단 3개 항목 <span className="font-semibold text-[#1e5bd8]">({source === 'preset' ? '프리셋 · 추가 0원' : 'AI 자동생성'})</span>
                            </div>
                            <ul className="m-0 grid list-none gap-1 p-0">
                                {items.map((it, i) => (
                                    <li className="text-[#475569]" key={i}>
                                        <b>{it.title}</b> · {it.subtitle} <span className="text-[#94a3b8]">[{it.icon}]</span>
                                    </li>
                                ))}
                            </ul>
                            {cost ? (
                                <div className="mt-1 rounded-md bg-white px-3 py-2 text-[12px] text-[#334155]">
                                    <div className="font-bold text-[#1e5bd8]">이번 생성 정확 비용: {cost.krw}원</div>
                                    <div className="text-[#64748b]">
                                        이미지 {Math.round(cost.image * USD_TO_KRW)}원
                                        {cost.text > 0 ? ` + 하단3개 AI ${Math.round(cost.text * USD_TO_KRW)}원` : ' + 하단3개 0원(프리셋)'}
                                    </div>
                                </div>
                            ) : null}
                            <a className="text-[12px] font-semibold text-[#4338ca] underline" download={`더맨시스템2_${region}.png`} href={img}>
                                PNG 다운로드
                            </a>
                        </div>
                    </div>
                ) : null}
            </div>
        </div>
    );
}
