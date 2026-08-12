import { useState } from 'react';
import { generateBlog } from '../../api/aiBlog';
import { computeRecordCostUsd, extractTokenBreakdown, formatKrw, formatUsd } from '../../lib/apiPricing';
import {
    parseCaseStudySections, assembleCaseStudyBody,
    parseFreeformSections, assembleFreeformBody,
    type SpecRow, type BodySection, type CaseStudyForm as CSForm,
} from './caseStudyAssembler';

// 범용 현장/사례 원고 폼 — 업종 무관. 본문은 "섹션 자유 리스트"(텍스트=AI산문+사진 / 표=행 그대로).
//   AI가 섹션 산문 생성 → 조립기가 소제목·표·보일러플레이트·「사진 N」 마커로 스티칭.
//   ⚠️ 지금은 "원고 써지는 것까지". 이미지 R2 업로드→발행(임시저장 큐)은 다음 단계(이미지는 장수만 마커에 반영).

const inputCls = 'h-10 rounded-lg border border-[#cbd5e1] bg-white px-3 text-sm w-full';
const areaCls = 'min-h-[70px] rounded-lg border border-[#cbd5e1] bg-white px-3 py-2 text-sm w-full resize-y';
const card = 'rounded-xl border border-[#e2e8f0] bg-white p-4';
const label = 'grid gap-1 text-xs font-semibold text-[#475569]';

function fileToDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload = () => {
            URL.revokeObjectURL(url);
            const max = 1600; const scale = Math.min(1, max / Math.max(img.width, img.height));
            const w = Math.round(img.width * scale); const h = Math.round(img.height * scale);
            const c = document.createElement('canvas'); c.width = w; c.height = h;
            const ctx = c.getContext('2d'); if (!ctx) { reject(new Error('canvas')); return; }
            ctx.drawImage(img, 0, 0, w, h); resolve(c.toDataURL('image/jpeg', 0.9));
        };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('img')); };
        img.src = url;
    });
}

function ImageSlot({ list, setList, labelText, hint, max = 9999 }: {
    list: string[]; setList: (u: (p: string[]) => string[]) => void; labelText: string; hint?: string; max?: number;
}) {
    const add = async (files: FileList | null) => {
        if (!files?.length) return;
        try {
            const urls = await Promise.all(Array.from(files).slice(0, max).map(fileToDataUrl));
            setList((p) => [...p, ...urls].slice(-max));
        } catch { /* 무시 */ }
    };
    return (
        <div className={label}>
            {labelText} {hint ? <span className="font-normal text-[#94a3b8]">{hint}</span> : null}
            <label className="inline-flex h-9 w-fit cursor-pointer items-center rounded-lg border border-[#cbd5e1] bg-white px-3 text-sm font-normal text-[#334155] hover:bg-[#f8fafc]">
                사진 추가
                <input accept="image/*" className="hidden" multiple type="file"
                    onChange={(e) => { void add(e.target.files); e.target.value = ''; }} />
            </label>
            {list.length ? (
                <div className="mt-1 flex flex-wrap gap-2">
                    {list.map((src, i) => (
                        <div className="relative" key={i}>
                            <img alt={`${labelText} ${i + 1}`} className="h-14 w-14 rounded-md border border-[#e2e8f0] object-cover" src={src} />
                            <button type="button" onClick={() => setList((p) => p.filter((_, j) => j !== i))}
                                className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-[#dc2626] text-[11px] font-bold text-white">×</button>
                        </div>
                    ))}
                </div>
            ) : <span className="text-[11px] font-normal text-[#cbd5e1]">아직 없음</span>}
        </div>
    );
}

const emptyRow = (): SpecRow => ({ item: '', spec: '', qty: '', note: '' });
type SectionState = {
    type: 'text' | 'table';
    title: string; subtitle: string;
    photos: string[]; notes: string;   // text
    rows: SpecRow[]; tsv: string;       // table
};
const textSection = (title = '', subtitle = ''): SectionState => ({ type: 'text', title, subtitle, photos: [], notes: '', rows: [], tsv: '' });
const tableSection = (): SectionState => ({ type: 'table', title: '설치 제품 리스트', subtitle: '', photos: [], notes: '', rows: [emptyRow()], tsv: '' });

export default function CaseStudyForm() {
    // 업체 고정
    const [boilerplate, setBoilerplate] = useState('');
    const [phone, setPhone] = useState('');
    const [address, setAddress] = useState('');
    const [masthead, setMasthead] = useState<string[]>([]);
    const [mapImg, setMapImg] = useState<string[]>([]);

    // 입력 모드
    const [mode, setMode] = useState<'auto' | 'freeform' | 'detail'>('auto');
    const [brief, setBrief] = useState('');

    // 자동(키워드 pool) 모드
    const [subKeywords, setSubKeywords] = useState('');   // 보조키워드 pool(줄/쉼표 구분 지역 등)
    const [autoCount, setAutoCount] = useState(5);
    const [autoResults, setAutoResults] = useState<Array<{ keyword: string; body: string }>>([]);

    // 키워드
    const [keyword, setKeyword] = useState('');
    const [keyword2, setKeyword2] = useState('');
    const [keywordCount, setKeywordCount] = useState(6);

    // 도입
    const [subjectType, setSubjectType] = useState('');
    const [introHook, setIntroHook] = useState('');
    const [overview, setOverview] = useState('');

    // 본문 섹션 (자유)
    const [sections, setSections] = useState<SectionState[]>([textSection('현장 소개'), textSection('작업 내용')]);

    // 마무리
    const [takeaway, setTakeaway] = useState('');

    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState('');
    const [result, setResult] = useState('');

    const patchSec = (i: number, patch: Partial<SectionState>) => setSections((p) => p.map((s, j) => (j === i ? { ...s, ...patch } : s)));
    const moveSec = (i: number, dir: -1 | 1) => setSections((p) => {
        const j = i + dir; if (j < 0 || j >= p.length) return p;
        const n = [...p]; [n[i], n[j]] = [n[j], n[i]]; return n;
    });
    const patchRow = (si: number, ri: number, patch: Partial<SpecRow>) =>
        setSections((p) => p.map((s, j) => (j === si ? { ...s, rows: s.rows.map((r, k) => (k === ri ? { ...r, ...patch } : r)) } : s)));
    const applyTsv = (si: number) => setSections((p) => p.map((s, j) => {
        if (j !== si) return s;
        const parsed = s.tsv.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
            const c = l.split(/\t|\s{2,}|\s*\|\s*/);
            return { item: c[0] || '', spec: c[1] || '', qty: c[2] || '', note: c[3] || '' } as SpecRow;
        });
        return parsed.length ? { ...s, rows: parsed, tsv: '' } : s;
    }));

    // 이번 원고 원가(gpt-5-mini 단가) 문자열.
    const costText = (usage: unknown) => {
        const u = (usage ?? null) as Parameters<typeof extractTokenBreakdown>[0];
        const b = extractTokenBreakdown(u);
        const usd = computeRecordCostUsd({ model: 'gpt-5-mini', provider: 'openai', usage_raw: u });
        return `이번 원고 ${formatKrw(usd)} (${formatUsd(usd)}) · 토큰 ${b.total.toLocaleString('ko-KR')}`;
    };

    // 자동(pool) — 큰키워드 × 보조키워드 교차로 N건 자동생성(키워드만으로 AI가 사례 구성).
    async function generateAuto() {
        if (!keyword.trim()) { setMsg('큰 키워드를 입력하세요.'); return; }
        const pool = subKeywords.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
        setBusy(true); setAutoResults([]);
        const out: Array<{ keyword: string; body: string }> = [];
        let totalUsd = 0;
        try {
            for (let i = 0; i < Math.max(1, autoCount); i += 1) {
                const sub = pool.length ? pool[i % pool.length] : '';
                const kw = (sub ? `${sub} ${keyword}` : keyword).trim();
                setMsg(`자동 생성 중… ${i + 1}/${autoCount} — ${kw}`);
                const r = await generateBlog({ topic: kw, mode: 'caseStudy', caseStudy: { keyword: kw, keywordCount, subjectType, freeform: true, brief: '' } });
                const parsed = parseFreeformSections(r.text);
                const { body } = assembleFreeformBody(parsed, { mastheadCount: masthead.length, mapCount: mapImg.length, boilerplate, phone, address });
                out.push({ keyword: kw, body });
                const u = (r.usage ?? null) as Parameters<typeof extractTokenBreakdown>[0];
                totalUsd += computeRecordCostUsd({ model: 'gpt-5-mini', provider: 'openai', usage_raw: u });
                setAutoResults([...out]);
            }
            setMsg(`자동 생성 완료 — ${out.length}건 · 합계 ${formatKrw(totalUsd)} (${formatUsd(totalUsd)}) · 건당 평균 ${formatKrw(totalUsd / Math.max(1, out.length))}`);
        } catch (e) {
            setMsg(e instanceof Error ? e.message : '자동 생성 실패');
        } finally {
            setBusy(false);
        }
    }

    async function generate() {
        if (!keyword.trim()) { setMsg('주 키워드를 입력하세요.'); return; }
        if (mode === 'freeform' && !brief.trim()) { setMsg('내용을 입력하세요.'); return; }
        setBusy(true); setMsg('원고 생성 중…');
        try {
            if (mode === 'freeform') {
                const r = await generateBlog({
                    topic: keyword, mode: 'caseStudy',
                    caseStudy: { keyword, keyword2, keywordCount, subjectType, freeform: true, brief },
                });
                const parsed = parseFreeformSections(r.text);
                const { body, markerCount } = assembleFreeformBody(parsed, {
                    mastheadCount: masthead.length, mapCount: mapImg.length, boilerplate, phone, address,
                });
                setResult(body);
                setMsg(`원고 생성 완료 — 소제목 ${parsed.sections.length}개 · 마커 ${markerCount}개(마스트헤드+지도) · ${costText(r.usage)}`);
                return;
            }
            const textSecs = sections.filter((s) => s.type === 'text');
            const r = await generateBlog({
                topic: keyword, mode: 'caseStudy',
                caseStudy: {
                    keyword, keyword2, keywordCount, subjectType, introHook, overview,
                    sections: textSecs.map((s) => ({ title: s.title, notes: s.notes })),
                    takeaway,
                },
            });
            const parsed = parseCaseStudySections(r.text);
            const bodySections: BodySection[] = sections.map((s) =>
                s.type === 'text'
                    ? { type: 'text', title: s.title, subtitle: s.subtitle, photoCount: s.photos.length }
                    : { type: 'table', title: s.title, subtitle: s.subtitle, rows: s.rows });
            const form: CSForm = { sections: bodySections, mastheadCount: masthead.length, mapCount: mapImg.length, boilerplate, phone, address };
            const { body, markerCount } = assembleCaseStudyBody(parsed, form);
            setResult(body);
            const imgTotal = masthead.length + sections.reduce((s, x) => s + x.photos.length, 0) + mapImg.length;
            setMsg(`원고 생성 완료 — 마커 ${markerCount}개 · 첨부 ${imgTotal}장 ${markerCount === imgTotal ? '(일치 ✓)' : '(⚠)'} · ${costText(r.usage)}`);
        } catch (e) {
            setMsg(e instanceof Error ? e.message : '생성 실패');
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className="grid gap-4">
            <div className="rounded-lg bg-[#eff6ff] px-4 py-3 text-sm text-[#1e40af]">
                📋 <b>현장/사례 원고 (범용)</b> — 업종 무관. <b>최소 입력</b>(주 키워드 · 대상/유형 · 섹션 소제목)만 하면 <b>나머지 상세는 AI가 알아서</b> 씁니다(팩트훅·개요·섹션 내용은 비워도 됨). 검증된 노출형 구조(인사말X·키워드·소제목·「사진」·업체소개·전화·지도)로 조립. <span className="text-[#64748b]">지금은 원고 생성까지 · 이미지 발행은 다음 단계.</span>
            </div>
            {msg ? <div className="rounded-lg bg-[#f0fdf4] px-4 py-2.5 text-sm font-semibold text-[#166534]">{msg}</div> : null}

            <div className="flex items-center gap-2">
                <span className="text-[12px] font-semibold text-[#64748b]">입력 방식</span>
                <button type="button" onClick={() => setMode('auto')} className={`rounded-full px-4 py-1.5 text-[13px] font-bold ${mode === 'auto' ? 'bg-[#0369a1] text-white' : 'bg-white text-[#475569] ring-1 ring-[#cbd5e1]'}`}>자동 (키워드 교차)</button>
                <button type="button" onClick={() => setMode('freeform')} className={`rounded-full px-4 py-1.5 text-[13px] font-bold ${mode === 'freeform' ? 'bg-[#0369a1] text-white' : 'bg-white text-[#475569] ring-1 ring-[#cbd5e1]'}`}>간편 (내용 한 곳에)</button>
                <button type="button" onClick={() => setMode('detail')} className={`rounded-full px-4 py-1.5 text-[13px] font-bold ${mode === 'detail' ? 'bg-[#0369a1] text-white' : 'bg-white text-[#475569] ring-1 ring-[#cbd5e1]'}`}>상세 (섹션별)</button>
            </div>

            {/* 업체 고정 */}
            <div className={card}>
                <div className="mb-3 text-[13px] font-bold text-[#334155]">업체 고정정보 <span className="font-normal text-[#94a3b8]">— 매 글 동일(하단에 그대로)</span></div>
                <div className="grid gap-3">
                    <label className={label}>업체 소개(보일러플레이트) <span className="font-normal text-[#94a3b8]">— 그대로 삽입, AI 안 건드림</span>
                        <textarea className={areaCls} value={boilerplate} onChange={(e) => setBoilerplate(e.target.value)} placeholder="예) OO은 상담 후 현장에 맞춰 진행하며, 전국 출장·A/S까지 연결합니다." />
                    </label>
                    <div className="grid gap-3 sm:grid-cols-2">
                        <label className={label}>대표 전화<input className={inputCls} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="예) 010-0000-0000" /></label>
                        <label className={label}>회사 주소(지도 아래)<input className={inputCls} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="예) 서울 강남구 …" /></label>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                        <ImageSlot list={masthead} setList={setMasthead} labelText="상단 배너(마스트헤드)" hint="(맨 위 · 1장)" max={1} />
                        <ImageSlot list={mapImg} setList={setMapImg} labelText="회사 위치 지도(정적 이미지)" hint="(맨 아래 · 1장)" max={1} />
                    </div>
                </div>
            </div>

            {/* 키워드 */}
            <div className={card}>
                <div className="mb-3 text-[13px] font-bold text-[#334155]">키워드 (지역+카테고리)</div>
                <div className="grid gap-3 sm:grid-cols-3">
                    <label className={label}>주 키워드 *<input className={inputCls} value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="예) 강남 누수탐지" /></label>
                    <label className={label}>보조 키워드<input className={inputCls} value={keyword2} onChange={(e) => setKeyword2(e.target.value)} placeholder="예) 강남 누수" /></label>
                    <label className={label}>반복 횟수<input className={inputCls} type="number" min={3} max={12} value={keywordCount} onChange={(e) => setKeywordCount(Math.min(12, Math.max(3, Number(e.target.value) || 6)))} /></label>
                </div>
            </div>

            {mode === 'auto' ? (
                <div className={card}>
                    <div className="mb-3 flex items-center gap-2">
                        <span className="text-[13px] font-bold text-[#334155]">자동 발행 (키워드 교차)</span>
                        <span className="text-[11px] font-normal text-[#94a3b8]">— 큰키워드 × 보조키워드로 N건 자동생성 (키워드만으로 AI가 사례 구성)</span>
                    </div>
                    <div className="grid gap-3">
                        <label className={label}>대상/현장 유형 <span className="font-normal text-[#94a3b8]">(선택)</span><input className={inputCls} value={subjectType} onChange={(e) => setSubjectType(e.target.value)} placeholder="예) 아파트 누수" /></label>
                        <label className={label}>보조 키워드 (지역 등) <span className="font-normal text-[#94a3b8]">— 한 줄에 하나(또는 쉼표). 큰키워드 앞에 붙어 교차 → 예: "안양 " + "누수탐지"</span>
                            <textarea className="min-h-[90px] w-full resize-y rounded-lg border border-[#cbd5e1] bg-white px-3 py-2 text-sm" value={subKeywords} onChange={(e) => setSubKeywords(e.target.value)} placeholder={'안양\n강남\n수원\n분당'} />
                        </label>
                        <div className="flex flex-wrap items-center gap-2">
                            <label className="text-xs font-semibold text-[#475569]">생성 건수</label>
                            <input className="h-9 w-20 rounded border border-[#cbd5e1] px-2 text-sm" type="number" min={1} max={30} value={autoCount} onChange={(e) => setAutoCount(Math.min(30, Math.max(1, Number(e.target.value) || 1)))} />
                            <span className="text-[11px] text-[#94a3b8]">보조키워드를 순서대로 돌려가며 조합 (건당 ≈ 수원)</span>
                        </div>
                        <button type="button" onClick={() => void generateAuto()} disabled={busy}
                            className="h-11 w-full rounded-lg bg-[#ea580c] text-sm font-bold text-white hover:bg-[#c2410c] disabled:opacity-50">
                            {busy ? '자동 생성 중…' : `✨ ${autoCount}건 자동생성`}
                        </button>
                    </div>
                    {autoResults.length ? (
                        <div className="mt-3 grid gap-2">
                            {autoResults.map((res, i) => (
                                <details key={i} className="rounded-lg border border-[#e2e8f0] bg-[#f8fafc] p-2">
                                    <summary className="cursor-pointer text-[12.5px] font-bold text-[#334155]">{i + 1}. {res.keyword} <span className="font-normal text-[#94a3b8]">— {res.body.length}자</span></summary>
                                    <textarea readOnly className="mt-2 min-h-[220px] w-full resize-y whitespace-pre-wrap rounded border border-[#e2e8f0] bg-white px-2 py-1.5 text-[13px] leading-relaxed text-[#1f2937]" value={res.body} />
                                </details>
                            ))}
                        </div>
                    ) : null}
                </div>
            ) : null}

            {mode === 'freeform' ? (
                <div className={card}>
                    <div className="mb-3 flex items-center gap-2">
                        <span className="text-[13px] font-bold text-[#334155]">간편 입력</span>
                        <span className="text-[11px] font-normal text-[#94a3b8]">— 대상/유형 + 내용만 적으면 AI가 소제목까지 구조화</span>
                    </div>
                    <div className="grid gap-3">
                        <label className={label}>대상/현장 유형<input className={inputCls} value={subjectType} onChange={(e) => setSubjectType(e.target.value)} placeholder="예) 아파트 화장실 누수" /></label>
                        <label className={label}>내용 전부 <span className="font-normal text-[#94a3b8]">(현장 상황·과정·한 것 등 자유롭게 · 소제목은 AI가 나눔)</span>
                            <textarea className="min-h-[200px] w-full resize-y rounded-lg border border-[#cbd5e1] bg-white px-3 py-2 text-sm" value={brief} onChange={(e) => setBrief(e.target.value)} placeholder="예) 아래층 천장에 물자국이 번져 접수. 화장실 배관 누수 의심. 청음·열화상으로 위치 특정 후 바닥 일부만 개봉해 이음부 교체. 방수 마감까지 하루. …" />
                        </label>
                    </div>
                </div>
            ) : null}

            {mode === 'detail' ? (<>
            {/* 도입 */}
            <div className={card}>
                <div className="mb-3 text-[13px] font-bold text-[#334155]">도입</div>
                <div className="grid gap-3">
                    <label className={label}>대상/현장 유형<input className={inputCls} value={subjectType} onChange={(e) => setSubjectType(e.target.value)} placeholder="예) 아파트 화장실 누수 / 마라탕 전문점 주방 등" /></label>
                    <label className={label}>도입 팩트 훅 seed <span className="font-normal text-[#94a3b8]">(선택 · 비우면 AI가 작성)</span><input className={inputCls} value={introHook} onChange={(e) => setIntroHook(e.target.value)} placeholder="예) 누수는 눈에 보일 땐 이미 아래층까지 번진 경우가 많다" /></label>
                    <label className={label}>현장/대상 개요·상황 <span className="font-normal text-[#94a3b8]">(선택 · 비우면 AI가 작성)</span><textarea className={areaCls} value={overview} onChange={(e) => setOverview(e.target.value)} placeholder="예) 아래층 천장 얼룩으로 접수, 화장실 배관 의심 (안 써도 됨)" /></label>
                </div>
            </div>

            {/* 본문 섹션 (자유) */}
            <div className={card}>
                <div className="mb-3 flex items-center gap-2">
                    <span className="text-[13px] font-bold text-[#334155]">본문 섹션</span>
                    <span className="text-[11px] font-normal text-[#94a3b8]">업종에 맞게 자유롭게 · 순서=글 순서</span>
                    <span className="ml-auto flex gap-2">
                        <button type="button" onClick={() => setSections((p) => [...p, textSection()])} className="h-8 rounded-md bg-[#eef2ff] px-3 text-xs font-bold text-[#4338ca]">＋ 텍스트 섹션</button>
                        <button type="button" onClick={() => setSections((p) => [...p, tableSection()])} className="h-8 rounded-md bg-[#fef3c7] px-3 text-xs font-bold text-[#b45309]">＋ 표 섹션</button>
                    </span>
                </div>
                <div className="grid gap-3">
                    {sections.map((s, i) => (
                        <div key={i} className="rounded-lg border border-[#e2e8f0] bg-[#f8fafc] p-3">
                            <div className="mb-2 flex items-center gap-2">
                                <span className={`rounded px-2 py-0.5 text-[11px] font-bold ${s.type === 'text' ? 'bg-[#eef2ff] text-[#4338ca]' : 'bg-[#fef3c7] text-[#b45309]'}`}>{i + 1} · {s.type === 'text' ? '텍스트' : '표'}</span>
                                <button type="button" onClick={() => moveSec(i, -1)} disabled={i === 0} className="text-[13px] text-[#64748b] disabled:opacity-30">▲</button>
                                <button type="button" onClick={() => moveSec(i, 1)} disabled={i === sections.length - 1} className="text-[13px] text-[#64748b] disabled:opacity-30">▼</button>
                                <button type="button" onClick={() => setSections((p) => p.filter((_, j) => j !== i))} className="ml-auto text-[12px] font-bold text-[#dc2626]">삭제</button>
                            </div>
                            <div className="grid gap-2 sm:grid-cols-2">
                                <label className={label}>소제목<input className={inputCls} value={s.title} onChange={(e) => patchSec(i, { title: e.target.value })} placeholder="예) 탐지 과정 / BEFORE / 1. 세척" /></label>
                                <label className={label}>부제 (소제목 | ___)<input className={inputCls} value={s.subtitle} onChange={(e) => patchSec(i, { subtitle: e.target.value })} placeholder="예) 비파괴 장비로 위치 특정" /></label>
                            </div>
                            {s.type === 'text' ? (
                                <>
                                    <div className="mt-2"><ImageSlot list={s.photos} setList={(u) => patchSec(i, { photos: u(s.photos) })} labelText="섹션 사진" /></div>
                                    <label className={`${label} mt-2`}>내용 메모 <span className="font-normal text-[#94a3b8]">(선택 · 비우면 소제목·키워드로 AI가 작성)</span>
                                        <textarea className={areaCls} value={s.notes} onChange={(e) => patchSec(i, { notes: e.target.value })} placeholder="안 써도 됨. 넣으면 그 내용대로. 예) 청음·열화상으로 배관 위치 특정, 바닥 일부만 개봉 등" />
                                    </label>
                                </>
                            ) : (
                                <div className="mt-2 grid gap-2">
                                    <div className="grid grid-cols-[1fr_1fr_60px_1fr_26px] gap-1.5 text-[11px] font-bold text-[#64748b]"><span>품목</span><span>규격</span><span>수량</span><span>비고</span><span /></div>
                                    {s.rows.map((r, ri) => (
                                        <div key={ri} className="grid grid-cols-[1fr_1fr_60px_1fr_26px] gap-1.5">
                                            <input className="h-8 rounded border border-[#cbd5e1] px-2 text-sm" value={r.item} onChange={(e) => patchRow(i, ri, { item: e.target.value })} placeholder="품목" />
                                            <input className="h-8 rounded border border-[#cbd5e1] px-2 text-sm" value={r.spec} onChange={(e) => patchRow(i, ri, { spec: e.target.value })} placeholder="규격" />
                                            <input className="h-8 rounded border border-[#cbd5e1] px-2 text-sm" value={r.qty} onChange={(e) => patchRow(i, ri, { qty: e.target.value })} placeholder="수량" />
                                            <input className="h-8 rounded border border-[#cbd5e1] px-2 text-sm" value={r.note} onChange={(e) => patchRow(i, ri, { note: e.target.value })} placeholder="비고" />
                                            <button type="button" onClick={() => setSections((p) => p.map((x, j) => (j === i ? { ...x, rows: x.rows.filter((_, k) => k !== ri) } : x)))} className="h-8 rounded bg-[#f1f5f9] text-[13px] font-bold text-[#64748b]">×</button>
                                        </div>
                                    ))}
                                    <button type="button" onClick={() => patchSec(i, { rows: [...s.rows, emptyRow()] })} className="h-8 w-fit rounded-md bg-[#eef2ff] px-3 text-xs font-bold text-[#4338ca]">＋ 행</button>
                                    <details>
                                        <summary className="cursor-pointer text-[12px] font-semibold text-[#64748b]">붙여넣기(탭/파이프 구분)로 여러 행</summary>
                                        <textarea className={`${areaCls} mt-1`} value={s.tsv} onChange={(e) => patchSec(i, { tsv: e.target.value })} placeholder={'품목\t규격\t수량\t비고'} />
                                        <button type="button" onClick={() => applyTsv(i)} disabled={!s.tsv.trim()} className="mt-1 h-8 rounded bg-[#4338ca] px-3 text-xs font-bold text-white disabled:opacity-50">표에 반영</button>
                                    </details>
                                </div>
                            )}
                        </div>
                    ))}
                    {sections.length === 0 ? <div className="text-[12px] text-[#94a3b8]">섹션을 추가하세요.</div> : null}
                </div>
            </div>

            {/* 마무리 */}
            <div className={card}>
                <div className="mb-2 text-[13px] font-bold text-[#334155]">마무리</div>
                <label className={label}>마무리 한 줄(seed)<input className={inputCls} value={takeaway} onChange={(e) => setTakeaway(e.target.value)} placeholder="예) 누수는 위치를 정확히 잡는 것이 절반입니다" /></label>
            </div>
            </>) : null}

            {mode !== 'auto' ? (<>
            <button type="button" onClick={() => void generate()} disabled={busy}
                className="h-12 w-full rounded-lg bg-[#ea580c] text-sm font-bold text-white hover:bg-[#c2410c] disabled:opacity-50">
                {busy ? '원고 생성 중…' : '✨ 원고 생성'}
            </button>

            <div className={card}>
                <div className="mb-2 text-[13px] font-bold text-[#334155]">생성된 원고 <span className="font-normal text-[#94a3b8]">(편집 가능 · 「사진 N」=이미지 위치 · "부제목 :"=소제목)</span></div>
                <textarea className="min-h-[360px] w-full resize-y whitespace-pre-wrap rounded-md border border-[#e2e8f0] bg-[#f8fafc] px-3 py-2 text-sm leading-relaxed text-[#1f2937]"
                    value={result} onChange={(e) => setResult(e.target.value)} placeholder="위 정보를 채우고 ‘원고 생성’을 누르면 조립된 원고가 여기에 표시됩니다." />
            </div>
            </>) : null}
        </div>
    );
}
