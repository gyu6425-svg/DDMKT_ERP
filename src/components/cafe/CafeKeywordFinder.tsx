import { useEffect, useRef, useState } from 'react';
import { enqueuePlaceScan, pollPlaceScan, enqueueRegionScan, enqueueListScan, getRegionGuTokens, getPopularFromCache, type KwResult } from '../../api/cafeKwScan';
import { getClientPublishedKeywords } from '../../api/cafeDeployRequests';

type PickSeed = { keyword: string; volume?: number | null; theme?: string | null };

// 공용 '인기탭 키워드 찾기' — 접수(CafeDeployIntake)와 동일 UX.
//   지역형: 시도 선택 + 제품키워드 → 검색량 조회 / 고정 동마스터로 동×키워드 생성.
//   키워드형: 플레이스 주소 → 검색량 조회 / SUB4 워커 정확 인기탭 분석(최대 50, 큐 처리).
//   선택(복수·× 제외·이미 발행분 중복제외) → onPick 으로 상위(발행 스튜디오)에 전달.
export function CafeKeywordFinder({
    clientId,
    mode,
    onPick,
    initialPicked,
    extraUsed,
    goalCount,
}: {
    clientId: string | null;
    mode: 'region' | 'keyword';
    onPick: (keywords: string[], productKeyword: string) => void;
    initialPicked?: PickSeed[];      // 접수 때 고른 키워드 — 최초 1회 선택칩으로 시딩
    extraUsed?: string[];            // 재조회 결과에서 추가로 제외할 키워드(접수 선택분 등)
    goalCount?: number;              // 계약 목표 건수 — "앞으로 N개 더" 안내
}) {
    const REGION_KEYS = ['서울', '경기', '인천', '대전', '세종', '충북', '충남', '강원', '전북', '전남', '광주', '대구', '경북', '경남', '부산', '울산', '제주'] as const;
    const [keyword, setKeyword] = useState('');   // 지역형=제품키워드 / 키워드형=참고
    const [url, setUrl] = useState('');            // 키워드형 플레이스 주소
    const [regionSel, setRegionSel] = useState<string[]>([]);
    const inputCls = 'h-10 w-full rounded-md border border-[#cbd5e1] px-3 text-sm outline-none focus:border-[#4338ca]';

    // 검색량(연관어) 리스트 — 붙여넣기 추출 결과 표시용
    const [vol, setVol] = useState<{ keyword: string; total: number }[] | null>(null);
    // 정확 인기탭 / 지역 키워드 결과
    const [kwResult, setKwResult] = useState<KwResult[] | null>(null);
    const [kwLoading, setKwLoading] = useState(false);
    const [scanNote, setScanNote] = useState('');   // 지역 스캔 진행상태(배너·게이지바) — "진행 x/total · 인기탭 n"
    const [dongLoading, setDongLoading] = useState(false);  // '더 찾기(동까지)' 진행
    const [dongDone, setDongDone] = useState(false);        // 이번 결과에 동 스캔까지 마쳤는지
    const [pasteText, setPasteText] = useState('');         // 플레이스에 메뉴/정보 없을 때 직접 붙여넣는 정보·메뉴
    const [extracting, setExtracting] = useState('');       // 붙여넣기→키워드 추출 진행상태
    const [kwExpanded, setKwExpanded] = useState(false);
    const [kwErr, setKwErr] = useState('');
    const [kwHidden, setKwHidden] = useState<string[]>([]);
    const [kwPicked, setKwPicked] = useState<KwResult[]>([]);
    const [usedKw, setUsedKw] = useState<Set<string>>(new Set());
    const normKw = (s: string) => (s || '').trim().replace(/\s+/g, ' ');

    useEffect(() => { onPick(kwPicked.map((k) => k.keyword), keyword.trim()); }, [kwPicked, keyword, onPick]);
    // 접수 선택 키워드 시딩 — 최초 1회만(이후엔 사용자가 자유롭게 가감). 값이 처음 들어올 때 채운다.
    const seededRef = useRef(false);
    useEffect(() => {
        if (seededRef.current || !initialPicked?.length) return;
        seededRef.current = true;
        setKwPicked(initialPicked.map((p) => ({ keyword: p.keyword, volume: p.volume ?? undefined, theme: p.theme ?? undefined, cafes: [] })));
    }, [initialPicked]);
    const extraKey = (extraUsed ?? []).join('|');
    useEffect(() => {
        let alive = true;
        void (async () => {
            const pub = clientId ? await getClientPublishedKeywords(clientId) : [];
            if (alive) setUsedKw(new Set([...pub, ...(extraUsed ?? [])].map(normKw).filter(Boolean)));
        })();
        return () => { alive = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [clientId, extraKey]);

    const togglePick = (k: KwResult) =>
        setKwPicked((prev) => (prev.some((p) => p.keyword === k.keyword) ? prev.filter((p) => p.keyword !== k.keyword) : [...prev, k]));
    const hideKw = (kw: string) => {
        setKwHidden((prev) => (prev.includes(kw) ? prev : [...prev, kw]));
        setKwPicked((prev) => prev.filter((p) => p.keyword !== kw));
    };
    const toggleRegion = (r: string) => setRegionSel((cur) => (cur.includes(r) ? cur.filter((x) => x !== r) : [...cur, r]));

    // 키워드형 — SUB4 워커 정확 인기탭 분석(최대 target). '더 보기' 로 50까지.
    const runPlaceScan = async (target = 10) => {
        const u = url.trim();
        if (!u) { setKwErr('플레이스 주소를 입력하세요.'); return; }
        setKwErr(''); setKwLoading(true);
        // 스튜디오 top-up(접수 선택분 시딩)에선 재조회해도 기존 선택 유지 — 그 위에 더 고른다.
        if (target <= 10) { setKwResult(null); setKwExpanded(false); setKwHidden([]); if (!initialPicked?.length) setKwPicked([]); }
        try {
            const { id, error } = await enqueuePlaceScan(u, target, regionSel.length ? regionSel.join(',') : '서울,경기,인천');
            if (error || !id) throw new Error(error?.message || '요청 실패');
            const { result } = await pollPlaceScan(id, { timeoutSec: target > 10 ? 600 : 180 });
            setKwResult(result);
            if (target > 10) setKwExpanded(true);
        } catch (e) {
            setKwErr(e instanceof Error ? e.message : '분석 실패');
        } finally { setKwLoading(false); }
    };

    // 지역형 — 선택 시도의 행정구/시 × 제품키워드(들) 인기탭 조회.
    //   기본(includeDong=false): 구/시만 빠르게 → 결과 즉시. '더 찾기(동까지)'(true): 동(洞)까지 추가 스캔해 기존 결과에 합침.
    //   쉼표/줄바꿈으로 여러 개 입력하면 전부 먼저 큐에 넣고(누락 방지) 순차 폴링·누적.
    const runRegion = async (includeDong: boolean) => {
        // 칩이 있으면 칩 전부, 없으면 입력칸(쉼표/줄바꿈)으로. → 여러 키워드 한 번에 조회.
        const kws = [...new Set(keyword.split(/[,\n]/).map((s) => s.trim()).filter(Boolean))];
        if (!kws.length) { setKwErr('키워드를 추가하세요(입력 후 추가). 예: 출장뷔페'); return; }
        if (!regionSel.length) { setKwErr('지역을 선택하세요.'); return; }
        const setLoading = includeDong ? setDongLoading : setKwLoading;
        setKwErr(''); setLoading(true); setScanNote('');
        if (!includeDong) { setKwResult(null); setKwExpanded(false); setKwHidden([]); setDongDone(false); if (!initialPicked?.length) setKwPicked([]); }
        const dedup = (arr: KwResult[]) => {
            const seen = new Set<string>(); const out: KwResult[] = [];
            for (const r of arr) { const nk = (r.keyword || '').replace(/\s/g, ''); if (seen.has(nk)) continue; seen.add(nk); out.push(r); }
            return out.sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0));
        };
        try {
            const merged: KwResult[] = includeDong ? [...(kwResult || [])] : [];
            const toScan: string[] = [];
            if (!includeDong) {
                // 구/시 캐시 먼저(즉시). 캐시 없는 것만 라이브 스캔 대상으로.
                const gus = await getRegionGuTokens(regionSel);
                for (const kw of kws) {
                    const combos = [...new Set(gus.map((g) => `${g.token} ${kw}`))];
                    const cached = await getPopularFromCache(combos);
                    if (cached.length) merged.push(...cached);   // 캐시 양성은 즉시 표시(UX)
                    toScan.push(kw);   // ★ 항상 워커로 전수 재검증 — 캐시 양성 몇 개만 믿고 멈추면 prescan 음성·미스캔분 누락(워커 내부 배치캐시로 이미 판정된 건 즉시)
                }
                if (merged.length) setKwResult(dedup(merged));   // 캐시분 먼저 즉시(워커 완료 시 전체로 교체)
            } else {
                toScan.push(...kws);   // 동은 조합이 달라 워커에 맡김(내부 배치캐시로 재스캔 빠름)
            }
            // 캐시 없는 키워드는 '전부 먼저 큐 등록' → 순차 폴링.
            const jobs: { kw: string; id: number }[] = [];
            for (const kw of toScan) {
                const { id } = await enqueueRegionScan(kw, regionSel.join(','), 300, includeDong);
                if (id) jobs.push({ kw, id });
            }
            for (let i = 0; i < jobs.length; i++) {
                const { kw, id } = jobs[i];
                const tag = jobs.length > 1 ? ` (${i + 1}/${jobs.length})` : '';
                setScanNote(`${kw}${includeDong ? ' 동' : ''} 스캔 시작…${tag}`);
                try {
                    const { result } = await pollPlaceScan(id, { timeoutSec: 900, onProgress: (note) => setScanNote(`${kw} · ${note}${tag}`) });
                    merged.push(...result);
                    setKwResult(dedup(merged));                 // 끝나는 대로 누적
                } catch { /* 이 키워드만 실패 — 나머지 계속 */ }
            }
            const final = dedup(merged);
            if (!final.length) { setKwErr(`인기탭 확인된 키워드가 없습니다 — ${regionSel.join('·')} × "${kws.join(', ')}"`); return; }
            setKwResult(final);
            if (includeDong) setDongDone(true);
        } catch (e) {
            setKwErr(e instanceof Error ? e.message : '조회 실패');
        } finally { setLoading(false); setScanNote(''); }
    };
    const genRegionKeywords = () => runRegion(false);

    // 붙여넣은 정보/메뉴 텍스트 → 제품키워드 추출(검색량 자동 선별). 플레이스에 메뉴·정보가 없을 때 대신 사용.
    //   ① 텍스트에서 한글 후보 조각 추출(이모지·가격·괄호·비한글 제거) → ② 각 후보 검색량 조회 →
    //   ③ 검색량 있는 상위만 제품키워드 칸에 채움. 이후 지역 선택 → '지역 키워드 생성'으로 인기탭 스캔.
    const STOP_TERMS = new Set(['메뉴', '가격', '정보', '추천', '예약', '문의', '전화', '영업', '시간', '주차', '위치', '안내', '상담', '방문', '전문', '서비스', '이벤트', '할인', '특가', '세트', '코스', '기본', '인분', '매장', '대표', '소개', '오늘', '신규', '최고', '최신', '명품', '프리미엄', '무료', '견적', '후기', '리뷰', '문의사항']);
    // 붙여넣은 텍스트 → 검색량 있는 상위 키워드(공통 코어). null=실패(에러 세팅됨).
    const extractScored = async (): Promise<{ keyword: string; total: number }[] | null> => {
        const raw = pasteText.trim();
        if (!raw) { setKwErr('정보/메뉴 텍스트를 붙여넣으세요.'); return null; }
        setKwErr(''); setExtracting('후보 추출 중…'); setVol(null);
        // ① 후보 추출 — 줄/구분자로 조각, 이모지·괄호·비한글 제거. 조각 전체 + 개별 토큰 모두 후보.
        const segs = raw.replace(/[\u{1F000}-\u{1FAFF}☀-➿]/gu, ' ').split(/[\n,·/|、:;()\[\]{}]+|\s{2,}/);
        const cand = new Set<string>();
        for (let s of segs) {
            s = s.replace(/\([^)]*\)/g, ' ').replace(/[^가-힣\s]/g, ' ').trim();
            for (const piece of [s, ...s.split(/\s+/)]) {
                const t = piece.trim();
                if (t.length >= 2 && t.length <= 12 && /[가-힣]/.test(t) && !STOP_TERMS.has(t)) cand.add(t);
            }
            if (cand.size >= 60) break;
        }
        const cands = [...cand].slice(0, 30);   // 검색량 조회 폭주 방지(상한)
        if (!cands.length) { setKwErr('추출된 후보가 없습니다 — 메뉴/서비스명을 줄 단위로 붙여넣어 주세요.'); setExtracting(''); return null; }
        // ② 각 후보 검색량 조회(공식 검색광고 API) → ③ 검색량 있는 것만.
        const scored: { keyword: string; total: number }[] = [];
        for (let i = 0; i < cands.length; i++) {
            setExtracting(`검색량 확인 ${i + 1}/${cands.length}`);
            const c = cands[i];
            try {
                const d = await (await fetch(`https://ddmkt-erp.pages.dev/api/naver-keywords?q=${encodeURIComponent(c)}`)).json();
                const nk = c.replace(/\s/g, '');
                const hit = (d.keywords || []).find((k: { keyword: string; total?: number }) => (k.keyword || '').replace(/\s/g, '') === nk);
                const vol2 = hit?.total ?? 0;
                if (vol2 > 0) scored.push({ keyword: c, total: vol2 });
            } catch { /* 이 후보만 건너뜀 */ }
        }
        setExtracting('');
        scored.sort((a, b) => b.total - a.total);
        let top = scored.filter((s) => s.total >= 30).slice(0, 15);
        if (!top.length) top = scored.slice(0, 8);   // 다 낮으면 상위 8개라도
        if (!top.length) { setKwErr('검색량 있는 키워드를 찾지 못했습니다 — 다른 텍스트로 시도하세요.'); return null; }
        setVol(top);                                  // 추출된 키워드+검색량 표시(기존 검색량 표 재사용)
        return top;
    };
    // 지역형 — 추출한 키워드를 제품키워드 칸에 채움(이후 지역 선택 → '지역 키워드 생성').
    const extractKeywords = async () => {
        const top = await extractScored();
        if (top) setKeyword(top.map((t) => t.keyword).join(', '));
    };
    // 키워드형 — 추출한 키워드를 지역 없이(전국) 바로 인기탭 판정(워커 process_list).
    const extractAndScan = async () => {
        const top = await extractScored();
        if (!top) return;
        setKwErr(''); setKwLoading(true); setScanNote(''); setKwResult(null); setKwExpanded(false); setKwHidden([]); if (!initialPicked?.length) setKwPicked([]);
        try {
            const { id, error } = await enqueueListScan(top.map((t) => t.keyword));
            if (error || !id) throw new Error(error?.message || '분석 등록 실패');
            const { result } = await pollPlaceScan(id, { timeoutSec: 300, onProgress: (note) => setScanNote(note) });
            if (!result.length) { setKwErr(`인기탭 확인된 키워드가 없습니다 — 붙여넣은 정보 기준 ${top.length}개 판정`); return; }
            setKwResult(result);
        } catch (e) {
            setKwErr(e instanceof Error ? e.message : '분석 실패');
        } finally { setKwLoading(false); setScanNote(''); }
    };

    const visible = (kwResult || []).filter((k) => !kwHidden.includes(k.keyword));
    // 기존에 했던 것 = 이미 발행/선택(usedKw) + 이번 세션에 고른 것(kwPicked). 둘 다 '이미 함'으로 제외.
    const pickedSet = new Set(kwPicked.map((p) => normKw(p.keyword)));
    const isUsed = (k: KwResult) => usedKw.has(normKw(k.keyword)) || pickedSet.has(normKw(k.keyword));
    const fresh = visible.filter((k) => !isUsed(k));
    const used = visible.filter((k) => isUsed(k));

    return (
        <div className="rounded-xl border-2 border-[#0369a1] bg-[#f0f9ff] p-4">
            <div className="mb-2 text-[13px] font-bold text-[#075985]">🔍 SEO 키워드 찾기 — {mode === 'region' ? '지역 × 제품키워드' : '플레이스 인기탭'}</div>

            {mode === 'region' ? (
                <div className="grid gap-2">
                    <div className="flex flex-wrap gap-2">
                        {REGION_KEYS.map((r) => (
                            <button key={r} type="button" onClick={() => toggleRegion(r)}
                                className={`rounded-full border px-3 py-1 text-sm font-semibold ${regionSel.includes(r) ? 'border-[#4338ca] bg-[#4338ca] text-white' : 'border-[#cbd5e1] bg-white text-[#475569]'}`}>{r}</button>
                        ))}
                    </div>
                    <details className="rounded-md border border-dashed border-[#c4b5fd] bg-white/60 px-3 py-2">
                        <summary className="cursor-pointer text-[12px] font-bold text-[#6d28d9]">📋 정보/메뉴 붙여넣기 — 플레이스에 메뉴·정보가 없을 때 (여기서 제품키워드 자동 추출)</summary>
                        <div className="mt-2 grid gap-2">
                            <textarea className="w-full rounded-md border border-[#cbd5e1] px-3 py-2 text-sm outline-none focus:border-[#7c3aed]" rows={4}
                                value={pasteText} onChange={(e) => setPasteText(e.target.value)}
                                placeholder="플레이스 '정보'·'메뉴'·홈 소개글을 그대로 붙여넣으세요. 줄 단위로 넣으면 더 정확합니다.&#10;예)&#10;입주청소&#10;이사청소&#10;준공청소&#10;상가/사무실 청소" />
                            <div className="flex items-center gap-2">
                                <button type="button" onClick={() => void extractKeywords()} disabled={!!extracting} className="h-9 shrink-0 rounded-md bg-[#6d28d9] px-4 text-sm font-bold text-white disabled:opacity-50">{extracting ? '추출 중…' : '① 키워드 뽑기'}</button>
                                <span className="text-[12px] text-[#6d28d9]">{extracting || '검색량 있는 키워드만 골라 아래 제품키워드 칸에 자동으로 채웁니다.'}</span>
                            </div>
                        </div>
                    </details>
                    <div className="flex flex-wrap gap-2">
                        <input className={`${inputCls} flex-1 min-w-[160px]`} value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="제품 키워드 (예: 입주청소, 출장뷔페 — 여러 개는 쉼표)" />
                        <button type="button" onClick={() => void genRegionKeywords()} disabled={kwLoading || dongLoading} className="h-10 shrink-0 rounded-md bg-[#7c3aed] px-4 text-sm font-bold text-white disabled:opacity-50">{kwLoading ? '생성 중…' : '지역 키워드 생성'}</button>
                        {kwResult && kwResult.length > 0 && !dongDone && (
                            <button type="button" onClick={() => void runRegion(true)} disabled={kwLoading || dongLoading} title="동(洞) 단위까지 추가로 스캔 — 검색량 있는 동만" className="h-10 shrink-0 rounded-md border border-[#7c3aed] bg-white px-4 text-sm font-bold text-[#7c3aed] disabled:opacity-50">{dongLoading ? '동 스캔 중…' : '＋ 더 찾기(동까지)'}</button>
                        )}
                    </div>
                </div>
            ) : (
                <div className="grid gap-2">
                    <div className="flex flex-wrap gap-2">
                        <input className={`${inputCls} flex-1 min-w-[200px]`} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="플레이스 주소 (https://naver.me/… )" />
                        <button type="button" onClick={() => void runPlaceScan()} disabled={kwLoading} className="h-10 shrink-0 rounded-md bg-[#7c3aed] px-4 text-sm font-bold text-white disabled:opacity-50">{kwLoading ? '분석 중…' : '정확 인기탭 분석'}</button>
                    </div>
                    <details open className="rounded-md border border-dashed border-[#c4b5fd] bg-[#faf5ff] px-3 py-2">
                        <summary className="cursor-pointer text-[12px] font-bold text-[#6d28d9]">📋 정보/메뉴 붙여넣기 — 플레이스에 메뉴·정보가 없어 분석이 안 될 때 (여기 붙여넣고 아래 버튼)</summary>
                        <div className="mt-2 grid gap-2">
                            <textarea className="w-full rounded-md border border-[#cbd5e1] px-3 py-2 text-sm outline-none focus:border-[#7c3aed]" rows={4}
                                value={pasteText} onChange={(e) => setPasteText(e.target.value)}
                                placeholder="플레이스 '정보'·'메뉴'·홈 소개글을 그대로 붙여넣으세요. 줄 단위로 넣으면 더 정확합니다.&#10;예)&#10;고체향수&#10;니치향수&#10;시향 클래스" />
                            <div className="flex items-center gap-2">
                                <button type="button" onClick={() => void extractAndScan()} disabled={!!extracting || kwLoading} className="h-9 shrink-0 rounded-md bg-[#6d28d9] px-4 text-sm font-bold text-white disabled:opacity-50">{extracting ? '추출 중…' : kwLoading ? '분석 중…' : '정보로 인기탭 분석'}</button>
                                <span className="text-[12px] text-[#6d28d9]">{extracting || scanNote || '검색량 있는 키워드만 골라 지역 없이(전국) 인기탭을 바로 판정합니다.'}</span>
                            </div>
                        </div>
                    </details>
                </div>
            )}
            {kwErr ? <p className="mb-0 mt-1 text-[12px] text-[#dc2626]">{kwErr}</p> : null}
            {scanNote ? (() => {
                const m = scanNote.match(/(\d+)\/(\d+)/);
                const pct = m ? Math.min(100, Math.round((Number(m[1]) / Math.max(1, Number(m[2]))) * 100)) : null;
                return (
                    <div className="mt-2 rounded-lg border border-[#c4b5fd] bg-[#f5f3ff] p-3">
                        <div className="mb-1.5 flex items-center justify-between text-[12px] font-bold text-[#6d28d9]">
                            <span>🔍 지역 인기탭 조회 중… <span className="font-normal text-[#64748b]">{scanNote}</span></span>
                            {pct !== null ? <span>{pct}%</span> : null}
                        </div>
                        <div className="h-2.5 w-full overflow-hidden rounded-full bg-[#e9d5ff]">
                            <div className={`h-full rounded-full bg-[#7c3aed] ${pct === null ? 'animate-pulse' : 'transition-all duration-500'}`} style={{ width: `${pct ?? 25}%` }} />
                        </div>
                    </div>
                );
            })() : null}

            {/* 검색량(연관어) 리스트 — 참고용, 클릭 시 제품키워드로 채움 */}
            {vol ? (
                <div className="mt-2 max-h-40 overflow-y-auto rounded-lg border border-[#bae6fd] bg-white p-1 text-[13px]">
                    {vol.length ? vol.map((v) => (
                        <button key={v.keyword} type="button" onClick={() => setKeyword(v.keyword)} className="flex w-full items-center justify-between rounded px-2 py-1 text-left hover:bg-[#f0f9ff]">
                            <span className="font-medium text-[#0f172a]">{v.keyword}</span>
                            <span className="text-[12px] text-[#64748b]">월 {v.total.toLocaleString()}</span>
                        </button>
                    )) : <div className="px-2 py-1 text-[#94a3b8]">결과 없음</div>}
                </div>
            ) : null}

            {/* 목표 대비 선택 현황 — 계약 목표가 있으면 "앞으로 N개 더" 안내 */}
            {goalCount ? (
                <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-[#bfdbfe] bg-white px-3 py-2 text-[12px]">
                    <span className="font-bold text-[#075985]">선택 {kwPicked.length}개 / 목표 {goalCount}건</span>
                    {kwPicked.length < goalCount
                        ? <span className="font-semibold text-[#c2410c]">앞으로 {goalCount - kwPicked.length}개 더 선택 (정확 인기탭 재조회 시 이미 선택한 건 제외됩니다)</span>
                        : <span className="font-semibold text-[#166534]">목표 건수 달성 ✓</span>}
                </div>
            ) : null}

            {/* 선택 패널 */}
            {kwPicked.length ? (
                <div className="mt-2 rounded-lg border border-[#c7d2fe] bg-[#eef2ff] p-2">
                    <div className="mb-1 text-[11px] font-semibold text-[#4338ca]">선택한 발행 키워드 {kwPicked.length}개</div>
                    <div className="flex flex-wrap gap-1.5">
                        {kwPicked.map((p) => (
                            <span key={p.keyword} className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-1 text-[12px] font-semibold text-[#3730a3] ring-1 ring-[#c7d2fe]">
                                {p.keyword}
                                <button type="button" onClick={() => togglePick(p)} className="text-[#818cf8] hover:text-[#4338ca]">×</button>
                            </span>
                        ))}
                    </div>
                </div>
            ) : null}
            {kwResult ? (
                <div className="mt-2 rounded-lg border border-[#ddd6fe] bg-[#faf5ff] p-2">
                    <div className="mb-1 text-[11px] font-semibold text-[#6d28d9]">발행할 키워드를 고르세요(복수 선택). 필요없는 건 × 로 제외.</div>
                    {fresh.length === 0 ? (
                        <div className="py-2 text-center text-[12px] text-[#94a3b8]">{used.length ? '새 키워드 없음(모두 이미 발행).' : '키워드가 없습니다.'}</div>
                    ) : (
                        <div className="grid max-h-72 gap-1.5 overflow-y-auto">
                            {fresh.map((k) => {
                                const picked = kwPicked.some((p) => p.keyword === k.keyword);
                                return (
                                    <div key={k.keyword} className={`rounded border p-2 ${picked ? 'border-[#4338ca] bg-[#eef2ff] ring-1 ring-[#4338ca]' : 'border-[#eef0f2] bg-white'}`}>
                                        <div className="flex items-center gap-2 text-[12px]">
                                            <label className="flex cursor-pointer items-center gap-1.5 font-bold text-[#4338ca]">
                                                <input type="checkbox" checked={picked} onChange={() => togglePick(k)} className="h-3.5 w-3.5 accent-[#4338ca]" />
                                                {k.keyword}
                                            </label>
                                            {k.volume != null ? <span className="text-[#64748b]">검색량 {k.volume.toLocaleString()}</span> : null}
                                            {k.theme ? <span className="rounded-full bg-[#ede9fe] px-2 py-0.5 text-[10px] text-[#6d28d9]">{k.theme}</span> : null}
                                            <button type="button" onClick={() => hideKw(k.keyword)} className="ml-auto flex h-5 w-5 items-center justify-center rounded-full text-[13px] text-[#cbd5e1] hover:bg-[#fee2e2] hover:text-[#dc2626]">×</button>
                                        </div>
                                        {k.cafes?.length ? (
                                            <div className="mt-1 flex flex-wrap gap-1 text-[11px] text-[#64748b]">
                                                {k.cafes.slice(0, 5).map((c, j) => <span key={j} className="rounded bg-[#f1f5f9] px-1.5 py-0.5">{c.rank}위 {c.who}</span>)}
                                            </div>
                                        ) : null}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                    {used.length ? (
                        <div className="mt-1.5 rounded border border-dashed border-[#e2e8f0] bg-white/60 p-1.5">
                            <div className="mb-1 text-[10px] font-semibold text-[#94a3b8]">이미 선택·발행한 키워드 {used.length}개 — 중복 제외</div>
                            <div className="flex flex-wrap gap-1">{used.map((k) => <span key={k.keyword} className="rounded bg-[#f1f5f9] px-1.5 py-0.5 text-[10px] text-[#94a3b8] line-through">{k.keyword}</span>)}</div>
                        </div>
                    ) : null}
                    {mode === 'keyword' && kwResult.length >= 10 && !kwExpanded ? (
                        <button type="button" onClick={() => void runPlaceScan(50)} disabled={kwLoading} className="mt-1.5 w-full rounded-md border border-[#c4b5fd] bg-white py-1.5 text-[12px] font-bold text-[#6d28d9] hover:bg-[#f5f3ff] disabled:opacity-50">
                            {kwLoading ? '전체 스캔 중… (수 분)' : '더 보기 — 인기탭 최대 50개 스캔'}
                        </button>
                    ) : null}
                </div>
            ) : null}
        </div>
    );
}
