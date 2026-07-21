import { useState } from 'react';
import { checkPopular, generateCafeReview, generateSecurityBanner } from '../../api/cafeWriter';
import { createPublishJob, listPublishedPairs } from '../../api/cafePublishQueue';
import { COMPANIES, type CompanyKey } from './companies';
import { REGION_GROUPS, type RegionSet } from './regions';
import { buildImageOrder } from './imageOrder';

// 자동발행 패널 — 키워드 하나를 넣고 "{지역} {키워드}"로 인기글 뜨는 지역을 찾아(무료 스캔),
//   통과 지역만 원고+배너 생성 후 큐에 적재(유료). 스캔과 발행은 반드시 별도 버튼(비용 분리).
//   업체별 설정(게시판·링크·태그·중간이미지)은 companies.ts 에서 온다.

const MAX_GEN_ATTEMPTS = 3; // 원고가 형식검사(check.ok)를 통과할 때까지 최대 재생성

// region = 표기용(제목·태그·dedup, 예 '광진구'). 발행엔 이 값만 쓴다.
type Pair = { region: string; keyword: string };
// scans = 인기글 검사에 시도할 변형들(예 ['광진','광진구']) — 하나라도 뜨면 통과.
type ScanRow = Pair & { scans: string[]; status: '대기' | '검사중' | '통과' | '없음' | '오류'; reason?: string };
type GenRow = Pair & { status: string; url?: string; jobId?: string; reason?: string };
type Phase = 'idle' | 'scanning' | 'scanned' | 'generating' | 'done';

async function loadFixed(dir: string): Promise<string[]> {
    try {
        const r = await fetch(`/images/${dir}/manifest.json`);
        if (!r.ok) return [];
        const list = await r.json();
        return Array.isArray(list) ? (list as string[]) : [];
    } catch {
        return [];
    }
}

// 「사진 N」 마커 개수 = 이미지 수인지 등 발행기 호환 최소 점검(생성 후 본문을 신뢰하지 않는다).
const IMG_LINE = /^\s*[「[]?\s*사진\s*(\d+)\s*[」\]]?\s*$/;
function markerProblems(body: string, imageCount: number): string[] {
    const out: string[] = [];
    const nums = body.split(/\r?\n/).map((l) => IMG_LINE.exec(l)).filter(Boolean).map((m) => Number(m![1]));
    if (nums.length !== imageCount) out.push(`마커 ${nums.length}≠이미지 ${imageCount}`);
    if (new Set(nums).size !== nums.length) out.push('마커 중복');
    if (nums.some((n) => n < 1 || n > imageCount)) out.push('범위 밖 마커');
    return out;
}

export function AutoPublishPanel({ company }: { company: CompanyKey }) {
    const cfg = COMPANIES[company];
    const [keywords, setKeywords] = useState<string[]>(['', '', '']);   // 최대 3개
    const [regionSet, setRegionSet] = useState<RegionSet>('서울');
    const [count, setCount] = useState(2);

    const [phase, setPhase] = useState<Phase>('idle');
    const [scan, setScan] = useState<ScanRow[]>([]);
    const [passed, setPassed] = useState<Pair[]>([]);
    const [gen, setGen] = useState<GenRow[]>([]);
    const [report, setReport] = useState<{ queued: number; failed: number; skipped: number } | null>(null);
    const [msg, setMsg] = useState('');
    const [abort, setAbort] = useState(false);

    const kws = keywords.map((k) => k.trim()).filter(Boolean);
    const scanned = scan.filter((r) => r.status !== '대기' && r.status !== '검사중').length;
    const setKw = (i: number, v: string) => setKeywords((prev) => prev.map((k, j) => (j === i ? v : k)));

    // ── 1) 지역 스캔 (무료) — 지역 × 키워드 조합 ──
    const runScan = async () => {
        if (!kws.length) return setMsg('키워드를 1개 이상 입력하세요');
        setMsg('');
        setPhase('scanning');
        setAbort(false);
        setReport(null);
        setGen([]);

        // 중복 제외(fail-closed) — 조회 실패 시 발행 위험이 있으므로 중단
        const { pairs, error } = await listPublishedPairs(company);
        if (error) {
            setPhase('idle');
            return setMsg(`중복 확인 실패 — 스캔 중단(${error.message})`);
        }
        // 지역 우선(서울부터 훑기) × 키워드. 이미 발행한 쌍(표기 지역+키워드)은 제외.
        const rows: ScanRow[] = [];
        for (const rg of REGION_GROUPS[regionSet]) {
            for (const keyword of kws) {
                if (!pairs.has(`${rg.label}|${keyword}`)) rows.push({ region: rg.label, scans: rg.scans, keyword, status: '대기' });
            }
        }
        setScan(rows);
        const hit: Pair[] = [];
        for (let i = 0; i < rows.length; i += 1) {
            if (abort) break;
            rows[i] = { ...rows[i], status: '검사중' };
            setScan([...rows]);
            // 변형들(예 '광진','광진구') 중 하나라도 인기글이 뜨면 통과. 발행은 region(표기)로 1회만.
            let ok = false;
            let lastReason = '';
            try {
                for (const scan of rows[i].scans) {
                    if (abort) break;
                    const { hasPopular, reason } = await checkPopular(`${scan} ${rows[i].keyword}`);
                    lastReason = reason;
                    if (hasPopular) { ok = true; break; }
                }
                rows[i] = { ...rows[i], status: ok ? '통과' : '없음', reason: lastReason };
                if (ok) hit.push({ region: rows[i].region, keyword: rows[i].keyword });
            } catch (e) {
                rows[i] = { ...rows[i], status: '오류', reason: e instanceof Error ? e.message : '' };
            }
            setScan([...rows]);
            setPassed([...hit]);
            if (hit.length >= count) break; // 목표 채우면 조기 종료
        }
        setPassed(hit);
        setPhase('scanned');
        setMsg(hit.length >= count ? `${count}건 목표 달성` : `${count}건 요청 → ${hit.length}건 가능(후보 소진)`);
    };

    // ── 2) 생성 + 발행 (유료) ──
    const runPublish = async () => {
        if (!passed.length) return;
        setPhase('generating');
        setAbort(false);
        const fixed = await loadFixed(cfg.fixedDir);
        const photoCount = fixed.length ? Math.max(1, Math.min(9, fixed.length + 2)) : 9;
        const rows: GenRow[] = passed.map((p) => ({ ...p, status: '대기' }));
        setGen([...rows]);
        let queued = 0;
        let failed = 0;
        let skipped = 0;

        for (let i = 0; i < rows.length; i += 1) {
            if (abort) break;
            const region = rows[i].region;
            const kw = rows[i].keyword;
            const fullKw = `${region} ${kw}`;

            // 원고 — 형식검사 통과까지 최대 3회
            let body: string | null = null;
            let title = '';
            rows[i] = { ...rows[i], status: '원고 생성중…' };
            setGen([...rows]);
            for (let a = 0; a < MAX_GEN_ATTEMPTS; a += 1) {
                try {
                    const rv = await generateCafeReview({
                        brand: cfg.brand, business: cfg.business, content: {}, count: photoCount,
                        facts: cfg.facts, keyword: fullKw, phone: '', region, tone: 'info', variant: 'info-guide',
                    });
                    if (rv.check?.ok) { body = rv.reviewBody; title = rv.title; break; }
                    rows[i] = { ...rows[i], status: `원고 재생성(${a + 1}/${MAX_GEN_ATTEMPTS})` };
                    setGen([...rows]);
                } catch (e) {
                    rows[i] = { ...rows[i], status: '원고 실패', reason: e instanceof Error ? e.message : '' };
                }
            }
            if (!body) {
                rows[i] = { ...rows[i], status: '건너뜀(원고 형식)' };
                setGen([...rows]); skipped += 1; continue;
            }

            // 배너 — 고정 배너 이미지가 있으면 그걸 쓰고(AI 생성·비용 없음), 없으면 AI 생성
            let banner: string;
            if (cfg.bannerImage) {
                banner = cfg.bannerImage;   // 발행 시 varyImage 로 미세변형됨(중복 회피)
            } else {
                rows[i] = { ...rows[i], status: '배너 생성중…' };
                setGen([...rows]);
                try {
                    const b = await generateSecurityBanner({
                        region, secType: cfg.secType, titleLines: cfg.titleLines, style: 'blue', quality: 'low',
                    });
                    banner = b.imageDataUrl;
                } catch {
                    rows[i] = { ...rows[i], status: '건너뜀(배너)' };
                    setGen([...rows]); skipped += 1; continue;
                }
            }

            const images = buildImageOrder([banner], fixed);
            const bad = markerProblems(body, images.length);
            if (bad.length) {
                rows[i] = { ...rows[i], status: `건너뜀(형식: ${bad.join(',')})` };
                setGen([...rows]); skipped += 1; continue;
            }

            // 큐 적재
            rows[i] = { ...rows[i], status: '큐 등록중…' };
            setGen([...rows]);
            const { error, jobId } = await createPublishJob({
                board: cfg.board, body: cfg.footer ? `${body}\n\n${cfg.footer}` : body,
                images, links: cfg.links, tags: cfg.tags(region, kw), title,
                company, region, keyword: kw,
            });
            if (error) {
                rows[i] = { ...rows[i], status: '큐 실패' }; failed += 1;
            } else {
                rows[i] = { ...rows[i], status: '큐 등록 완료', jobId: jobId ?? undefined }; queued += 1;
            }
            setGen([...rows]);
        }
        setReport({ queued, failed, skipped });
        setPhase('done');
    };

    return (
        <div className="rounded-xl border-2 border-[#4338ca] bg-[#eef2ff] p-4">
            <div className="mb-3 text-[13px] font-bold text-[#3730a3]">자동발행 — 지역 스캔 → 통과 지역만 발행</div>

            <div className="grid gap-1">
                <span className="text-[12px] font-semibold text-[#475569]">키워드 (최대 3개 · 예: 소방점검)</span>
                <div className="grid grid-cols-3 gap-2">
                    {[0, 1, 2].map((i) => (
                        <input
                            className="h-9 rounded-md border border-[#cbd5e1] bg-white px-2.5 text-sm"
                            key={i}
                            onChange={(e) => setKw(i, e.target.value)}
                            placeholder={i === 0 ? '키워드 1' : `키워드 ${i + 1} (선택)`}
                            value={keywords[i]}
                        />
                    ))}
                </div>
            </div>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
                <label className="grid gap-1">
                    <span className="text-[12px] font-semibold text-[#475569]">지역</span>
                    <select className="h-9 rounded-md border border-[#cbd5e1] bg-white px-2 text-sm" onChange={(e) => setRegionSet(e.target.value as RegionSet)} value={regionSet}>
                        {(['서울', '경기', '인천', '전체'] as RegionSet[]).map((g) => (
                            <option key={g} value={g}>{g} ({REGION_GROUPS[g].length})</option>
                        ))}
                    </select>
                </label>
                <label className="grid gap-1">
                    <span className="text-[12px] font-semibold text-[#475569]">발행 건수</span>
                    <input className="h-9 rounded-md border border-[#cbd5e1] bg-white px-2.5 text-sm" max={20} min={1} onChange={(e) => setCount(Math.max(1, Math.min(20, Number(e.target.value) || 1)))} type="number" value={count} />
                </label>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
                <button className="h-10 rounded-md bg-[#4338ca] px-5 text-sm font-bold text-white hover:bg-[#3730a3] disabled:opacity-50" disabled={phase === 'scanning' || phase === 'generating' || !kws.length} onClick={() => void runScan()} type="button">
                    {phase === 'scanning' ? `스캔 중… (${scanned}/${scan.length} · 통과 ${passed.length})` : '지역 스캔 (무료)'}
                </button>
                {phase === 'scanned' && passed.length > 0 ? (
                    <button className="h-10 rounded-md bg-[#0f766e] px-5 text-sm font-bold text-white hover:bg-[#115e59]" onClick={() => void runPublish()} type="button">
                        {passed.length}건 생성·발행 (유료)
                    </button>
                ) : null}
                {(phase === 'scanning' || phase === 'generating') ? (
                    <button className="h-10 rounded-md border border-[#dc2626] px-4 text-sm font-semibold text-[#dc2626] hover:bg-[#fef2f2]" onClick={() => setAbort(true)} type="button">중단</button>
                ) : null}
                {msg ? <span className="text-[13px] text-[#4338ca]">{msg}</span> : null}
            </div>

            <div className="mt-2 text-[11px] text-[#94a3b8]">
                ※ 인기글 결과는 시점에 따라 달라질 수 있습니다. · 발행 등록 = 큐 적재이며 즉시 게시가 아닙니다(로컬 발행기가 간격을 두고 순차 게시).
            </div>

            {/* 스캔 결과 */}
            {scan.length > 0 ? (
                <div className="mt-3 max-h-[220px] overflow-y-auto rounded-lg border border-[#e2e8f0] bg-white p-2">
                    <div className="flex flex-wrap gap-1.5">
                        {scan.map((r) => (
                            <span
                                className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                                    r.status === '통과' ? 'bg-[#1e5bd8] text-white'
                                        : r.status === '검사중' ? 'bg-[#fef9c3] text-[#854d0e]'
                                            : r.status === '오류' ? 'bg-[#fee2e2] text-[#991b1b]'
                                                : r.status === '없음' ? 'bg-[#f1f5f9] text-[#94a3b8]'
                                                    : 'bg-[#f8fafc] text-[#cbd5e1]'
                                }`}
                                key={`${r.region}|${r.keyword}`}
                                title={r.reason}
                            >
                                {r.status === '통과' ? '✓ ' : ''}{r.region} {r.keyword}
                            </span>
                        ))}
                    </div>
                </div>
            ) : null}

            {/* 발행 진행 */}
            {gen.length > 0 ? (
                <div className="mt-3 rounded-lg border border-[#e2e8f0] bg-white p-3">
                    {gen.map((r) => (
                        <div className="flex items-center justify-between border-b border-[#f1f5f9] py-1 text-[12px] last:border-0" key={`${r.region}|${r.keyword}`}>
                            <span className="font-semibold text-[#334155]">{r.region} {r.keyword}</span>
                            <span className={r.status.includes('완료') ? 'text-[#166534]' : r.status.includes('실패') || r.status.includes('건너뜀') ? 'text-[#991b1b]' : 'text-[#64748b]'}>
                                {r.status}
                            </span>
                        </div>
                    ))}
                    {report ? (
                        <div className="mt-2 text-[12px] font-semibold text-[#3730a3]">
                            결과 — 큐 등록 {report.queued} · 실패 {report.failed} · 건너뜀 {report.skipped}
                        </div>
                    ) : null}
                </div>
            ) : null}
        </div>
    );
}
