import { useEffect, useRef, useState } from 'react';
import { enqueuePlaceScan, pollPlaceScan, enqueueRegionScan, enqueueListScan, enqueueMenuScan, enqueueRelatedScan, expandRelated, extractMenuKeywords, fetchPlaceReviews, fetchSiteText, relatedStems, searchCachedPopular, getRegionGuTokens, getPopularFromCache, type ExtractedProduct, type KwResult, type RelatedCand } from '../../api/cafeKwScan';
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
    mode: 'region' | 'keyword' | 'related';
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
    const [siteUrl, setSiteUrl] = useState('');             // 홈페이지·네이버 블로그 주소 — 붙여넣기를 대신하는 입력
    const [extracting, setExtracting] = useState('');       // 붙여넣기→키워드 추출 진행상태
    const [kwExpanded, setKwExpanded] = useState(false);
    const [kwErr, setKwErr] = useState('');
    const [kwHidden, setKwHidden] = useState<string[]>([]);
    const [kwPicked, setKwPicked] = useState<KwResult[]>([]);
    const [usedKw, setUsedKw] = useState<Set<string>>(new Set());
    // 정보입력형(플레이스 없는 업체) — 위치 직접입력 + 붙여넣기 추출 결과를 체크박스로 확정.
    //   ★ 자동 채우기를 쓰지 않는 이유: GPT 추출엔 늘 군더더기가 섞이는데, 자동 확정하면
    //     그게 조용히 스캔 비용과 오탐이 된다. 고객이 '내 서비스가 맞는지' 고르는 게 가장 정확하다.
    // 연관 인기글 찾기 — 씨앗어(보홀·하와이 등) → 연관 키워드 → 체크 확정 → 전국 인기탭 판정.
    const [seed, setSeed] = useState('');
    const [cands, setCands] = useState<RelatedCand[] | null>(null);
    const [relPicked, setRelPicked] = useState<Set<string>>(new Set());
    const [relTier, setRelTier] = useState<'seed' | 'near' | 'far'>('near');   // 어디까지 보여줄지
    // 지역형으로 판명된 제품키워드 — 지역을 붙여야 나오는 업종(간병인·입주청소 등).
    const [regionalCands, setRegionalCands] = useState<(KwResult & { sample?: string[] })[]>([]);
    // 캐시 우선 조회 결과 — 스캔 0회로 즉시 나오는 것들.
    const [cachedHits, setCachedHits] = useState<KwResult[] | null>(null);
    const [cachedVia, setCachedVia] = useState<string[]>([]);   // 이 결과를 찾아낸 어간(씨앗어와 다를 수 있다)
    const [addr, setAddr] = useState('');
    const [extracted, setExtracted] = useState<ExtractedProduct[] | null>(null);
    const [picked, setPicked] = useState<Set<string>>(new Set());
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
    // 한 번에 목표 건수만 찾고 멈춘다 — 전수 스캔은 오래 걸리고 차단 예산(CF 300콜/10분)을 태운다.
    //   워커가 target 을 채우면 즉시 종료하므로, 실측상 입주청소 10건은 20콜(전수 265콜 대비 -92%).
    //   부족하면 '+10 더 찾기'로 target 을 올려 이어서 스캔한다(이미 판정된 건 캐시 히트라 즉시 통과).
    const FIRST_TARGET = 30;
    const MORE_STEP = 10;
    const [regionTarget, setRegionTarget] = useState(FIRST_TARGET);
    const runRegion = async (includeDong: boolean, target = FIRST_TARGET) => {
        // 칩이 있으면 칩 전부, 없으면 입력칸(쉼표/줄바꿈)으로. → 여러 키워드 한 번에 조회.
        const kws = [...new Set(keyword.split(/[,\n]/).map((s) => s.trim()).filter(Boolean))];
        if (!kws.length) { setKwErr('키워드를 추가하세요(입력 후 추가). 예: 출장뷔페'); return; }
        if (!regionSel.length) { setKwErr('지역을 선택하세요.'); return; }
        const setLoading = includeDong ? setDongLoading : setKwLoading;
        setKwErr(''); setLoading(true); setScanNote('');
        if (!includeDong && target === FIRST_TARGET) { setKwResult(null); setKwExpanded(false); setKwHidden([]); setDongDone(false); if (!initialPicked?.length) setKwPicked([]); }
        setRegionTarget(target);
        const dedup = (arr: KwResult[]) => {
            const seen = new Set<string>(); const out: KwResult[] = [];
            for (const r of arr) { const nk = (r.keyword || '').replace(/\s/g, ''); if (seen.has(nk)) continue; seen.add(nk); out.push(r); }
            return out.sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0));
        };
        try {
            // '+더 찾기'(target 상향)나 동 확장이면 기존 결과에 이어붙인다.
            const merged: KwResult[] = (includeDong || target > FIRST_TARGET) ? [...(kwResult || [])] : [];
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
                const { id } = await enqueueRegionScan(kw, regionSel.join(','), target, includeDong);
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
        // ⚠️ 조회 실패(429·5xx·네트워크)를 '검색량 0'과 구분한다. 옛 코드는 둘 다 0으로 만들어
        //   실패한 후보가 조용히 목록에서 사라졌고, 같은 텍스트를 두 번 넣으면 결과가 달라졌다.
        //   검색광고 API 는 어떤 문자열에도 최소 10을 돌려주므로 '진짜 0'은 사실상 없다 → 0이면 실패로 본다.
        const scored: { keyword: string; total: number }[] = [];
        let failed = 0;
        for (let i = 0; i < cands.length; i++) {
            setExtracting(`검색량 확인 ${i + 1}/${cands.length}${failed ? ` (실패 ${failed})` : ''}`);
            const c = cands[i];
            try {
                const res = await fetch(`https://ddmkt-erp.pages.dev/api/naver-keywords?q=${encodeURIComponent(c)}`);
                const d = await res.json();
                if (!res.ok || !Array.isArray(d.keywords)) { failed += 1; continue; }   // 429·오류 → 실패로 계수
                const nk = c.replace(/\s/g, '');
                const hit = (d.keywords as { keyword: string; total?: number }[])
                    .find((k) => (k.keyword || '').replace(/\s/g, '') === nk);
                const vol2 = hit?.total ?? 0;
                if (vol2 > 0) scored.push({ keyword: c, total: vol2 });
            } catch { failed += 1; }
        }
        setExtracting('');
        // 상당수가 실패했으면 결과가 불완전하다 — '검색량 없음'처럼 보이게 두지 않는다.
        if (failed > Math.max(3, cands.length * 0.2)) {
            setKwErr(`검색량 조회가 ${failed}/${cands.length}건 실패했습니다(일시 제한). `
                + `결과가 불완전하니 잠시 후 다시 시도하세요.`);
            return null;
        }
        if (failed) setKwErr(`참고: 검색량 조회 ${failed}건 실패 — 그만큼 후보에서 빠졌습니다.`);
        scored.sort((a, b) => b.total - a.total);
        let top = scored.filter((s) => s.total >= 30).slice(0, 15);
        if (!top.length) top = scored.slice(0, 8);   // 다 낮으면 상위 8개라도
        if (!top.length) { setKwErr('검색량 있는 키워드를 찾지 못했습니다 — 다른 텍스트로 시도하세요.'); return null; }
        setVol(top);                                  // 추출된 키워드+검색량 표시(기존 검색량 표 재사용)
        return top;
    };
    // 연관 인기글 ① — 씨앗어에서 연관 키워드를 펼친다(검색광고 연관어, 최대 500).
    const runExpand = async () => {
        const s = seed.trim();
        if (!s) { setKwErr('씨앗 키워드를 입력하세요(예: 보홀).'); return; }
        setKwErr(''); setExtracting('연관어 조회 중…'); setCands(null); setKwResult(null);
        try {
            const list = await expandRelated(s);
            if (!list.length) { setKwErr(`"${s}" 의 연관 키워드를 찾지 못했습니다.`); return; }
            setCands(list);
            // ★ 스캔 전에 캐시부터 본다 — 이미 판정된 인기탭이 1,000건 넘게 쌓여 있어
            //   상당수는 긁지 않고 바로 줄 수 있다(실측: '방문요양' → 53건 즉시).
            //   검색어는 씨앗어 + 연관어 상위 몇 개(부분일치라 '간병인'으로 '수원 간병인'도 잡힌다).
            setExtracting('이미 찾아둔 것 조회 중…');
            const terms = relatedStems(s, list);
            const hits = await searchCachedPopular(terms);
            setCachedVia([...new Set(hits.map((h) => h.via))]);
            setCachedHits(hits.map((h) => ({ cafes: h.cafes, keyword: h.keyword, theme: h.theme ?? undefined, volume: h.volume ?? undefined })));
            // ★ 기본 체크 = '의도어(여행·숙소·패키지·투어…)가 붙은 것'.
            //   실측(2026-08-07, 보홀 70조합 전수): 옛 규칙(검색량순 상위 40)은 정확도 60%였는데
            //   의도어 규칙은 78%다. 지명·상품명 단독은 검색량이 아무리 커도 섹션이 없다
            //   (보홀 49,600 / 필리핀 56,500 / 보홀항공권 32,190 전부 없음).
            //   far 는 무관어가 섞이므로(디트로이트) 자동 체크에서 제외한다.
            setRelPicked(new Set(
                list.filter((x) => x.intent && x.tier !== 'far').slice(0, 45).map((x) => x.kw),
            ));
        } catch (e) {
            setKwErr(e instanceof Error ? e.message : '연관어 조회 실패');
        } finally { setExtracting(''); }
    };
    // 연관 인기글 ② — 체크한 키워드를 지역 없이(전국) 인기탭 판정.
    //   ★ 워커(process_list)의 라이브 상한은 60개다. 61번째부터는 '느려지는' 게 아니라
    //     아예 안 재진다(조용한 절단). 그래서 여기서 미리 자르고 그 사실을 화면에 남긴다.
    const REL_MAX = 200;   // 워커 process_related 의 MAX_A 와 같아야 한다(더 보내면 조용히 잘린다)
    const runRelatedScan = async () => {
        const all = [...relPicked];
        if (!all.length) { setKwErr('스캔할 키워드를 1개 이상 체크하세요.'); return; }
        // 검색량 높은 순으로 상한까지만 — 잘린 건 아래에 명시한다.
        const byVol = new Map((cands || []).map((c) => [c.kw, c.total]));
        const sorted = [...all].sort((a, b) => (byVol.get(b) ?? 0) - (byVol.get(a) ?? 0));
        const list = sorted.slice(0, REL_MAX);
        const cut = sorted.length - list.length;
        setKwErr(''); setKwLoading(true); setScanNote(''); setKwResult(null); setKwHidden([]);
        let lastNote = '';
        try {
            // 전국 판정 + 지역형 찔러보기를 한 번에(process_related). 결과는 kind 로 갈라 온다.
            const { id, error } = await enqueueRelatedScan(seed, list);
            if (error || !id) throw new Error(error?.message || '분석 등록 실패');
            const { result } = await pollPlaceScan(id, {
                timeoutSec: 900, onProgress: (n) => { lastNote = n; setScanNote(n); },
            });
            const far = new Set((cands || []).filter((c) => c.tier === 'far').map((c) => c.kw));
            const farHit = result.filter((r) => far.has(r.keyword)).map((r) => r.keyword);
            const notes = [
                cut > 0 ? `한 번에 ${REL_MAX}개까지만 확인합니다 — 검색량 낮은 ${cut}개는 이번에 못 봤습니다(다시 체크해 재조회하세요).` : '',
                // far = 씨앗어와 문자열로 안 겹치는 층. 실측(2026-08-06) '하와이' far 의 '디트로이트'가
                //   인기탭으로 잡혔는데 내용은 MLB·피자 맛집이었다 — 판정은 맞지만 팔면 안 되는 키워드다.
                farHit.length ? `⚠ ${farHit.join(', ')} 은(는) "${seed.trim()}"과 문자열이 겹치지 않는 후보입니다. 내용이 정말 관련 있는지 확인 후 쓰세요.` : '',
                /상한초과|남은 조합/.test(lastNote) ? lastNote : '',
            ].filter(Boolean);
            if (!result.length) {
                setKwErr([`체크한 ${list.length}개 중 인기탭이 확인된 키워드가 없습니다.`, ...notes].join(' '));
                return;
            }
            // 지역형 후보(kind='regional')는 그대로 발행할 키워드가 아니라 '지역 스캔을 돌릴 제품키워드'다.
            //   따로 빼서 아래에 버튼으로 보여준다.
            const reg = result.filter((r) => (r as KwResult & { kind?: string }).kind === 'regional');
            const nat = result.filter((r) => (r as KwResult & { kind?: string }).kind !== 'regional');
            setRegionalCands(reg as (KwResult & { sample?: string[] })[]);
            if (notes.length) setKwErr(notes.join(' '));
            setKwResult([...nat].sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0)));
            setKeyword(seed.trim());
        } catch (e) {
            setKwErr(e instanceof Error ? e.message : '조회 실패');
        } finally { setKwLoading(false); setScanNote(''); }
    };

    // 플레이스 리뷰 가져오기 — 메뉴판이 없는 업체(약국·학원)는 리뷰가 유일한 제품키워드 원천이다.
    //   실측(2026-08-07): 미미식당 리뷰에서 '가정식 백반'(검색량 2,860·인기탭 O)이 나왔는데 메뉴판엔 없다.
    //   가져온 텍스트는 붙여넣기 칸에 채워 넣고, 이후 흐름(추출 → 체크 → 스캔)은 기존과 동일하다.
    const pullReviews = async () => {
        const u = url.trim() || addr.trim();
        if (!u.includes('naver')) { setKwErr('플레이스 주소를 입력하세요(https://naver.me/… 또는 place.naver.com/…).'); return; }
        setKwErr(''); setExtracting('리뷰 가져오는 중…');
        try {
            const b = await fetchPlaceReviews(u, (n) => setExtracting(n || '리뷰 가져오는 중…'));
            if (!b.text) {
                setKwErr(`${b.name || '이 업체'}는 리뷰가 없습니다 — 소개글을 직접 붙여넣어 주세요.`);
                return;
            }
            setPasteText(b.text);
            if (!addr.trim() && b.addr) setAddr(b.addr);
            const extra = [...b.menu, ...b.reviewMenus].filter(Boolean);
            setKwErr(`${b.name} · 리뷰 ${b.chars.toLocaleString()}자를 가져왔습니다`
                + (extra.length ? ` (메뉴 ${extra.slice(0, 6).join('·')}${extra.length > 6 ? ' 외' : ''})` : '')
                + ` — ‘① 키워드 뽑기’를 눌러 주세요.`);
        } catch (e) {
            setKwErr(e instanceof Error ? e.message : '리뷰 수집 실패');
        } finally { setExtracting(''); }
    };

    // 홈페이지·블로그 주소 → 원문을 붙여넣기 칸에 채운다.
    //   ★ 블로그를 먼저 권한다(실측 2026-08-07 경기간호): 블로그 글 제목 51개가
    //     "수원 의왕 뇌졸중 방문재활"처럼 이미 '지역 × 제품키워드' 꼴이라 우리 스캔 축과 같다.
    //     같은 업체 홈페이지는 2,041자였지만 대부분 메뉴·인사말이었다.
    const pullSite = async () => {
        const u = siteUrl.trim();
        if (!u) { setKwErr('홈페이지 또는 네이버 블로그 주소를 입력하세요.'); return; }
        setKwErr(''); setExtracting('주소에서 글 가져오는 중…');
        try {
            const b = await fetchSiteText(u);
            setPasteText(b.text);
            const what = b.source === 'naver_blog' ? `블로그 글 ${b.posts ?? 0}개` : `페이지 ${b.pages.length}개`;
            setKwErr(`${b.title || u} · ${what} · ${b.chars.toLocaleString()}자를 가져왔습니다 — ‘① 키워드 뽑기’를 눌러 주세요.`);
        } catch (e) {
            setKwErr(e instanceof Error ? e.message : '주소를 읽지 못했습니다');
        } finally { setExtracting(''); }
    };

    // 정보입력형 ① — 붙여넣은 소개/메뉴 → GPT 가 검색 가능한 제품·서비스 키워드로 정리.
    //   결과는 체크박스로만 보여준다(자동 확정 금지). 대표어(core)·메뉴(menu)는 기본 체크, 세부(niche)는 해제.
    const runExtract = async () => {
        const raw = pasteText.trim();
        if (!raw) { setKwErr('업체 정보(소개·메뉴)를 붙여넣으세요.'); return; }
        setKwErr(''); setExtracting('키워드 추출 중…'); setExtracted(null);
        try {
            const { products, biz } = await extractMenuKeywords(raw, keyword.trim());
            setExtracted(products);
            setPicked(new Set(products.filter((x) => x.kind !== 'niche').map((x) => x.kw)));
            if (biz) setKwErr(`업종 인식: ${biz} — 아래에서 스캔할 키워드를 골라 주세요.`);
        } catch (e) {
            setKwErr(e instanceof Error ? e.message : '키워드 추출 실패');
        } finally { setExtracting(''); }
    };
    // 정보입력형 ② — 체크한 키워드 × 위치(직접입력, + 선택 시도)로 인기탭 스캔.
    const runMenuScan = async (target = FIRST_TARGET) => {
        const list = (extracted || []).map((x) => x.kw).filter((k) => picked.has(k));
        if (!list.length) { setKwErr('스캔할 키워드를 1개 이상 체크하세요.'); return; }
        if (!addr.trim() && !regionSel.length) { setKwErr('위치를 입력하거나 시도를 1개 이상 선택하세요.'); return; }
        setKwErr(''); setKwLoading(true); setScanNote(''); setRegionTarget(target);
        try {
            const { id, error } = await enqueueMenuScan(addr, list, { regions: regionSel.join(','), target });
            if (error || !id) throw new Error(error?.message || '분석 등록 실패');
            const { result } = await pollPlaceScan(id, { timeoutSec: 900, onProgress: (note) => setScanNote(note) });
            if (!result.length) { setKwErr(`인기탭 확인된 키워드가 없습니다 — ${addr.trim() || regionSel.join('·')} × "${list.join(', ')}"`); return; }
            setKwResult(result);
            setKeyword(list.join(', '));   // 아래 발행 단계가 쓰는 제품키워드(지역 분리 기준)
        } catch (e) {
            setKwErr(e instanceof Error ? e.message : '조회 실패');
        } finally { setKwLoading(false); setScanNote(''); }
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
            <div className="mb-2 text-[13px] font-bold text-[#075985]">🔍 SEO 키워드 찾기 — {mode === 'region' ? '지역 × 제품키워드' : mode === 'related' ? '연관 인기글 찾기' : '플레이스 인기탭'}</div>

            {/* 연관 인기글 찾기 — 씨앗어 하나에서 연관 키워드를 펼쳐 인기탭을 찾는다.
                기존 3모드는 '한국 행정지역 × 제품'이 전제라 보홀·하와이 같은 해외지명이나
                취미어를 다루지 못했다. 여기선 지역 축 없이 연관어 자체를 판정한다. */}
            {mode === 'related' ? (
                <div className="grid gap-2">
                    <div className="flex flex-wrap gap-2">
                        <input className={`${inputCls} flex-1 min-w-[200px]`} value={seed}
                            onChange={(e) => setSeed(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void runExpand(); } }}
                            placeholder="씨앗 키워드 (예: 보홀 · 하와이 · 골프 · 캠핑)" />
                        <button type="button" onClick={() => void runExpand()} disabled={!!extracting || kwLoading}
                            className="h-10 shrink-0 rounded-md bg-[#6d28d9] px-4 text-sm font-bold text-white disabled:opacity-50">
                            {extracting ? '조회 중…' : '① 연관어 펼치기'}
                        </button>
                    </div>
                    {/* 실측(2026-08-06, 30조합)으로 확인된 패턴 — 미리 알려야 "5만 검색인데 왜 없냐"는 오해가 없다. */}
                    <p className="m-0 text-[11px] text-[#7c3aed]">
                        💡 <b>지명·상품명 단독은 인기글이 거의 없습니다</b>(보홀 49,600 · 필리핀 56,500 · 골프채 15,230 모두 없음).
                        <b>씨앗어 + 의도어</b>(여행·숙소·투어·패키지·맛집·연습장 …) 조합에서 나옵니다.
                    </p>
                    {/* 캐시 우선 — 스캔 없이 이미 확인된 인기탭. 여기서 충분하면 스캔을 안 해도 된다. */}
                    {cachedHits && cachedHits.length ? (
                        <div className="rounded-md border border-[#16a34a] bg-[#f0fdf4] p-2">
                            <div className="mb-1 flex flex-wrap items-center gap-2 text-[12px] font-bold text-[#15803d]">
                                <span>✅ 이미 확인된 인기탭 {cachedHits.length}건 <span className="font-normal">— <b>{cachedVia.join(' · ')}</b> 로 찾은 것입니다</span></span>
                                <button type="button" onClick={() => setKwResult(cachedHits)}
                                    className="rounded bg-[#16a34a] px-2.5 py-0.5 text-[11px] font-bold text-white">
                                    아래 목록으로 가져오기
                                </button>
                            </div>
                            <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
                                {cachedHits.slice(0, 40).map((h) => (
                                    <span key={h.keyword} className="rounded-full border border-[#86efac] bg-white px-2 py-0.5 text-[11px] font-semibold text-[#15803d]">
                                        {h.keyword}<span className="ml-1 font-normal opacity-60">{(h.volume ?? 0).toLocaleString()}</span>
                                    </span>
                                ))}
                            </div>
                            <p className="mb-0 mt-1 text-[11px] text-[#16a34a]">아래 ‘③ 인기탭 찾기’는 <b>아직 안 본 키워드</b>를 새로 확인할 때만 누르세요.</p>
                        </div>
                    ) : null}
                    {cands ? (
                        <div className="rounded-md border border-[#ddd6fe] bg-white p-2">
                            <div className="mb-1.5 flex flex-wrap items-center gap-2 text-[12px] font-bold text-[#6d28d9]">
                                <span>② 스캔할 키워드 확정 ({relPicked.size}/{cands.length})</span>
                                <div className="inline-flex rounded-md border border-[#c4b5fd] p-0.5">
                                    {/* 층 이름에 신뢰도를 담는다 — near/far 는 씨앗에 따라 오염된다.
                                        실측: '골프'(자동차 모델명과 동음이의)의 near 에 수영강습·피트니스가 섞였다. */}
                                    {([['seed', `"${seed.trim()}" 포함 · 확실`], ['near', '연관어 · 확인 필요'], ['far', '전체 · 무관 섞임']] as const).map(([t, lbl]) => (
                                        <button key={t} type="button" onClick={() => setRelTier(t)}
                                            className={`rounded px-2 py-0.5 text-[11px] font-bold ${relTier === t ? 'bg-[#6d28d9] text-white' : 'text-[#6d28d9]'}`}>{lbl}</button>
                                    ))}
                                </div>
                                {/* 보이는 층 안에서 전체 선택/해제 — 후보가 수백 개라 하나씩 못 누른다. */}
                                {(() => {
                                    const shown = cands.filter((x) => (relTier === 'seed' ? x.tier === 'seed' : relTier === 'near' ? x.tier !== 'far' : true)).slice(0, 200);
                                    const allOn = shown.length > 0 && shown.every((x) => relPicked.has(x.kw));
                                    return (
                                        <button type="button"
                                            onClick={() => { const n = new Set(relPicked); shown.forEach((x) => (allOn ? n.delete(x.kw) : n.add(x.kw))); setRelPicked(n); }}
                                            className="rounded border border-[#c4b5fd] px-2 py-0.5 text-[11px] font-bold text-[#6d28d9]">
                                            {allOn ? `보이는 ${shown.length}개 해제` : `보이는 ${shown.length}개 전체 선택`}
                                        </button>
                                    );
                                })()}
                                <span className="font-normal text-[#94a3b8]">◆ = 인기글이 나올 가능성 높음(자동 체크)</span>
                            </div>
                            <div className="flex max-h-64 flex-wrap gap-1.5 overflow-y-auto">
                                {cands
                                    .filter((x) => (relTier === 'seed' ? x.tier === 'seed'
                                        : relTier === 'near' ? x.tier !== 'far' : true))
                                    .slice(0, 200)
                                    .map((x) => (
                                        <label key={x.kw} className={`flex cursor-pointer items-center gap-1 rounded-full border px-2.5 py-1 text-[12px] font-semibold ${relPicked.has(x.kw) ? 'border-[#6d28d9] bg-[#f5f3ff] text-[#5b21b6]' : 'border-[#cbd5e1] bg-white text-[#64748b]'}`}>
                                            <input type="checkbox" className="h-3 w-3 accent-[#6d28d9]" checked={relPicked.has(x.kw)}
                                                onChange={() => { const n = new Set(relPicked); if (n.has(x.kw)) n.delete(x.kw); else n.add(x.kw); setRelPicked(n); }} />
                                            {x.kw}
                                            <span className="text-[10px] font-normal opacity-60">{x.total.toLocaleString()}</span>
                                            {/* 의도어가 붙은 것 = 인기글 섹션이 나오는 부류(실측 정확도 78%). */}
                                            {x.intent ? <span className="text-[10px] text-[#16a34a]" title="여행·숙소·패키지 같은 의도어가 붙어 인기글이 나올 가능성이 높습니다">◆</span> : null}
                                        </label>
                                    ))}
                            </div>
                            <div className="mt-2 flex items-center gap-2">
                                <button type="button" onClick={() => void runRelatedScan()} disabled={kwLoading || !relPicked.size}
                                    className="h-9 shrink-0 rounded-md bg-[#7c3aed] px-4 text-sm font-bold text-white disabled:opacity-50">
                                    {kwLoading ? '찾는 중…' : '③ 인기탭 찾기'}
                                </button>
                                <span className="text-[11px] text-[#64748b]">
                                    {relPicked.size > REL_MAX
                                        ? `⚠ 한 번에 ${REL_MAX}개까지 확인됩니다 — ${relPicked.size - REL_MAX}개는 이번에 안 재집니다.`
                                        : `${relPicked.size}개 확인 · 약 ${Math.max(1, Math.ceil(relPicked.size * 2.5 / 60))}분 소요`}
                                </span>
                            </div>
                        </div>
                    ) : null}

                    {/* 지역형으로 판명된 제품키워드 — 그대로 발행하는 게 아니라 지역을 붙여야 나온다.
                        실측(2026-08-07): 간병인은 지역 없이 0건, 지역을 붙이면 46건. 반대로 창업은 그 반대다.
                        찔러보기가 0이어도 '아님'이 아니라 '미확인'이다(저밀도 업종은 8번으로 안 걸린다). */}
                    {regionalCands.length ? (
                        <div className="rounded-md border border-[#f59e0b] bg-[#fffbeb] p-2">
                            <div className="mb-1 text-[12px] font-bold text-[#b45309]">
                                📍 지역을 붙여야 나오는 키워드 {regionalCands.length}건 — 지역 스캔을 돌리면 전수로 찾습니다
                            </div>
                            {/* 지역 스캔에는 시도 선택이 필요하다 — 연관 모드엔 없으므로 여기서 고르게 한다. */}
                            <div className="mb-1.5 flex flex-wrap items-center gap-1">
                                <span className="mr-1 text-[11px] font-semibold text-[#a16207]">지역 범위</span>
                                {REGION_KEYS.map((r) => (
                                    <button key={r} type="button" onClick={() => toggleRegion(r)}
                                        className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${regionSel.includes(r) ? 'border-[#b45309] bg-[#b45309] text-white' : 'border-[#fde68a] bg-white text-[#a16207]'}`}>{r}</button>
                                ))}
                            </div>
                            <div className="grid gap-1">
                                {regionalCands.map((r) => (
                                    <div key={r.keyword} className="flex flex-wrap items-center gap-2 rounded border border-[#fde68a] bg-white px-2 py-1 text-[12px]">
                                        <b className="text-[#b45309]">{r.keyword}</b>
                                        <span className="text-[#94a3b8]">{r.theme}</span>
                                        {r.sample?.length ? <span className="text-[11px] text-[#64748b]">예: {r.sample.join(' · ')}</span> : null}
                                        <button type="button" disabled={kwLoading || dongLoading}
                                            onClick={() => { setKeyword(r.keyword); void runRegion(false, FIRST_TARGET); }}
                                            className="ml-auto shrink-0 rounded bg-[#b45309] px-2.5 py-1 text-[11px] font-bold text-white disabled:opacity-50">
                                            지역 스캔 →
                                        </button>
                                    </div>
                                ))}
                            </div>
                            <p className="mb-0 mt-1 text-[11px] text-[#a16207]">‘지역 스캔’을 누르면 위에서 고른 시도의 전 지역 × 이 키워드로 전수 확인합니다.</p>
                        </div>
                    ) : null}
                </div>
            ) : null}

            {mode === 'related' ? null : mode === 'region' ? (
                <div className="grid gap-2">
                    <div className="flex flex-wrap gap-2">
                        {REGION_KEYS.map((r) => (
                            <button key={r} type="button" onClick={() => toggleRegion(r)}
                                className={`rounded-full border px-3 py-1 text-sm font-semibold ${regionSel.includes(r) ? 'border-[#4338ca] bg-[#4338ca] text-white' : 'border-[#cbd5e1] bg-white text-[#475569]'}`}>{r}</button>
                        ))}
                    </div>
                    {/* 플레이스가 없는 업체용 경로 — 위치를 직접 적고, 소개/메뉴를 붙여넣어 제품키워드를 만든다.
                        추출 결과는 반드시 체크박스로 확정한다(자동 채우기 금지). */}
                    <details className="rounded-md border border-dashed border-[#c4b5fd] bg-white/60 px-3 py-2">
                        <summary className="cursor-pointer text-[12px] font-bold text-[#6d28d9]">📋 플레이스가 없나요? — 위치 + 업체 정보 붙여넣기로 키워드 찾기</summary>
                        <div className="mt-2 grid gap-2">
                            <input className={inputCls} value={addr} onChange={(e) => setAddr(e.target.value)}
                                placeholder="위치 (예: 전북 군산시 옥도면 선유남길 19-9 — 읍·면·도로명까지 적으면 더 정확)" />
                            {/* 주소 한 줄로 원문을 걷는 경로 — 고객에게 "소개글을 붙여넣으세요"라고 하면 대부분 인사말만 넣는다. */}
                            <div className="flex flex-wrap items-center gap-2">
                                <input className={`${inputCls} min-w-[240px] flex-1`} value={siteUrl} onChange={(e) => setSiteUrl(e.target.value)}
                                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void pullSite(); } }}
                                    placeholder="홈페이지 또는 네이버 블로그 주소 (예: blog.naver.com/gyeonggi22)" />
                                <button type="button" onClick={() => void pullSite()} disabled={!!extracting || kwLoading}
                                    className="h-9 shrink-0 rounded-md border border-[#6d28d9] bg-white px-3 text-sm font-bold text-[#6d28d9] disabled:opacity-50"
                                    title="블로그면 최근 글 제목 50개를, 홈페이지면 본문을 가져와 아래 칸에 채웁니다">
                                    ⬇ 주소로 가져오기
                                </button>
                            </div>
                            <p className="mb-0 -mt-1 text-[11px] text-[#7c3aed]">
                                💡 <b>네이버 블로그가 가장 정확합니다</b> — 글 제목이 이미 ‘지역 + 키워드’ 형태라 그대로 씁니다.
                                홈페이지만 있으면 그 주소를 넣으세요(본문이 이미지·JS로만 된 사이트는 못 읽습니다).
                            </p>
                            <textarea className="w-full rounded-md border border-[#cbd5e1] px-3 py-2 text-sm outline-none focus:border-[#7c3aed]" rows={4}
                                value={pasteText} onChange={(e) => setPasteText(e.target.value)}
                                placeholder="업체 소개글·메뉴·서비스 설명을 그대로 붙여넣으세요(홈페이지 통째로 넣어도 됩니다).&#10;예)&#10;저희는 20년 경력의 누수탐지 전문업체로 아파트 배관 누수, 바닥 난방배관 누수를 정밀 장비로 찾아드립니다." />
                            <div className="flex flex-wrap items-center gap-2">
                                {/* 플레이스가 있으면 리뷰를 자동으로 긁어 위 칸을 채운다 — 메뉴판 없는 업종의 유일한 원천. */}
                                <button type="button" onClick={() => void pullReviews()} disabled={!!extracting || kwLoading}
                                    className="h-9 shrink-0 rounded-md border border-[#6d28d9] bg-white px-3 text-sm font-bold text-[#6d28d9] disabled:opacity-50"
                                    title="플레이스 주소를 넣으면 방문자·블로그 리뷰를 가져와 위 칸에 채웁니다">
                                    ⬇ 플레이스 리뷰 가져오기
                                </button>
                                <button type="button" onClick={() => void runExtract()} disabled={!!extracting || kwLoading} className="h-9 shrink-0 rounded-md bg-[#6d28d9] px-4 text-sm font-bold text-white disabled:opacity-50">{extracting ? '추출 중…' : '① 키워드 뽑기'}</button>
                                <span className="text-[12px] text-[#6d28d9]">{extracting || '리뷰를 가져오거나 직접 붙여넣은 뒤 ①을 누르세요.'}</span>
                            </div>
                            {extracted && (
                                <div className="rounded-md border border-[#ddd6fe] bg-white p-2">
                                    <div className="mb-1 flex items-center gap-2 text-[12px] font-bold text-[#6d28d9]">
                                        <span>② 스캔할 키워드 확정 ({picked.size}/{extracted.length})</span>
                                        <button type="button" className="rounded border border-[#c4b5fd] px-2 py-0.5 text-[11px] font-semibold text-[#6d28d9]"
                                            onClick={() => setPicked(picked.size === extracted.length ? new Set() : new Set(extracted.map((x) => x.kw)))}>
                                            {picked.size === extracted.length ? '전체 해제' : '전체 선택'}
                                        </button>
                                    </div>
                                    <div className="flex flex-wrap gap-1.5">
                                        {extracted.map((x) => (
                                            <label key={x.kw} className={`flex cursor-pointer items-center gap-1 rounded-full border px-2.5 py-1 text-[12px] font-semibold ${picked.has(x.kw) ? 'border-[#6d28d9] bg-[#f5f3ff] text-[#5b21b6]' : 'border-[#cbd5e1] bg-white text-[#64748b]'}`}>
                                                <input type="checkbox" className="h-3 w-3 accent-[#6d28d9]" checked={picked.has(x.kw)}
                                                    onChange={() => { const n = new Set(picked); if (n.has(x.kw)) n.delete(x.kw); else n.add(x.kw); setPicked(n); }} />
                                                {x.kw}
                                                <span className="text-[10px] font-normal opacity-60">{x.kind === 'core' ? '대표' : x.kind === 'niche' ? '세부' : '메뉴'}</span>
                                            </label>
                                        ))}
                                    </div>
                                    <div className="mt-2 flex items-center gap-2">
                                        <button type="button" onClick={() => void runMenuScan()} disabled={kwLoading || !picked.size} className="h-9 shrink-0 rounded-md bg-[#7c3aed] px-4 text-sm font-bold text-white disabled:opacity-50">{kwLoading ? '찾는 중…' : '③ 인기탭 찾기'}</button>
                                        {kwResult && kwResult.length > 0 && (
                                            <button type="button" onClick={() => void runMenuScan(regionTarget + MORE_STEP)} disabled={kwLoading}
                                                className="h-9 shrink-0 rounded-md border border-[#4338ca] bg-white px-3 text-sm font-bold text-[#4338ca] disabled:opacity-50">＋{MORE_STEP} 더 찾기</button>
                                        )}
                                        <span className="text-[11px] text-[#64748b]">
                                            {picked.size > 6
                                                ? `⚠ ${picked.size}개는 조합이 많아 한 번에 다 못 봅니다 — 중요한 것부터 5~6개로 줄이면 빠릅니다.`
                                                : '위치 주변부터 먼저 봅니다. 위 시도를 선택하면 그 지역 전체까지 넓힙니다.'}
                                        </span>
                                    </div>
                                </div>
                            )}
                        </div>
                    </details>
                    <div className="flex flex-wrap gap-2">
                        <input className={`${inputCls} flex-1 min-w-[160px]`} value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="제품 키워드 (예: 입주청소, 출장뷔페 — 여러 개는 쉼표)" />
                        <button type="button" onClick={() => void genRegionKeywords()} disabled={kwLoading || dongLoading} className="h-10 shrink-0 rounded-md bg-[#7c3aed] px-4 text-sm font-bold text-white disabled:opacity-50">{kwLoading ? '생성 중…' : '지역 키워드 생성'}</button>
                        {/* +N 더 찾기 — target 을 올려 이어서 스캔. 이미 판정된 조합은 캐시 히트라 즉시 통과하고
                            새 구간만 라이브로 본다. 한 번에 전수를 돌지 않아 빠르고 차단 예산도 아낀다. */}
                        {kwResult && kwResult.length > 0 && (
                            <button type="button" onClick={() => void runRegion(false, regionTarget + MORE_STEP)} disabled={kwLoading || dongLoading}
                                title="구/시 범위에서 목표를 10개 올려 이어서 스캔합니다(이미 본 건 건너뜀)"
                                className="h-10 shrink-0 rounded-md border border-[#4338ca] bg-white px-3 text-sm font-bold text-[#4338ca] disabled:opacity-50">
                                {kwLoading ? '찾는 중…' : `＋${MORE_STEP} 더 찾기`}
                            </button>
                        )}
                        {kwResult && kwResult.length > 0 && !dongDone && (
                            <button type="button" onClick={() => void runRegion(true, regionTarget)} disabled={kwLoading || dongLoading} title="동(洞) 단위까지 추가로 스캔 — 네일·치과 등 동네업종에서 효과가 큽니다(실측 58~74%)" className="h-10 shrink-0 rounded-md border border-[#7c3aed] bg-white px-4 text-sm font-bold text-[#7c3aed] disabled:opacity-50">{dongLoading ? '동 스캔 중…' : '＋ 더 찾기(동까지)'}</button>
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
                    <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px] font-semibold text-[#6d28d9]">
                        <span>발행할 키워드를 고르세요(복수 선택). 필요없는 건 × 로 제외.</span>
                        {/* 검색량 없는 건(=API 최저값 10) 몇 건인지 먼저 알려 준다 — 자동으로 거르진 않는다. */}
                        {(() => {
                            const zero = fresh.filter((k) => (k.volume ?? 0) <= 10).length;
                            if (!fresh.length) return null;
                            return zero
                                ? <span className="rounded bg-[#fef2f2] px-2 py-0.5 text-[#dc2626]">
                                    {fresh.length}건 중 <b>{zero}건은 검색량 없음</b> — 1위를 해도 유입이 없습니다
                                </span>
                                : <span className="rounded bg-[#f0fdf4] px-2 py-0.5 text-[#15803d]">{fresh.length}건 전부 검색량 있음</span>;
                        })()}
                    </div>
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
                                            {/* ★ 반드시 모바일(m.search). 인기글 섹션은 PC 와 모바일이 다르다
                                                (실측 2026-08-07 '광진 소방업체' 모바일 O · PC X, CF/사무실 IP 동일).
                                                우리 판정·측정이 전부 m.search 기준이라 확인도 모바일이어야 어긋나지 않는다. */}
                                            <a href={`https://m.search.naver.com/search.naver?query=${encodeURIComponent(k.keyword)}`}
                                                target="_blank" rel="noreferrer" title="모바일 검색결과에서 인기글 확인"
                                                className="text-[11px] text-[#0369a1] hover:underline">확인↗</a>
                                            {/* 검색량 10 = 검색광고 API 최저값 = '측정된 검색이 없음'.
                                                인기탭이 있어도 1위를 해도 유입이 0이라 팔 때 주의해야 한다.
                                                실측(2026-08-07) '창업' 지역형 112건이 전부 검색량 10이었다.
                                                자동으로 거르지 않고(저검색 니치를 죽이지 않기 위해) 눈에 띄게만 표시한다. */}
                                            {k.volume != null ? (
                                                (k.volume ?? 0) <= 10
                                                    ? <span className="rounded bg-[#fef2f2] px-1.5 py-0.5 font-semibold text-[#dc2626]" title="검색광고 API 최저값 — 실제로 검색되지 않는 키워드입니다. 1위를 해도 유입이 없습니다.">검색량 없음</span>
                                                    : <span className={(k.volume ?? 0) < 100 ? 'text-[#d97706]' : 'text-[#64748b]'}>검색량 {k.volume.toLocaleString()}</span>
                                            ) : null}
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
                    {/* 결과가 적을수록 더 필요하다 — '10개 이상' 조건을 없앤다(고객ERP 와 동일). */}
                    {mode === 'keyword' && !kwExpanded ? (
                        <button type="button" onClick={() => void runPlaceScan(50)} disabled={kwLoading} className="mt-1.5 w-full rounded-md border border-[#c4b5fd] bg-white py-1.5 text-[12px] font-bold text-[#6d28d9] hover:bg-[#f5f3ff] disabled:opacity-50">
                            {kwLoading ? '전체 스캔 중… (수 분)' : `＋ 더 찾기 — 최대 50개까지 깊이 스캔 (지금 ${kwResult.length}개)`}
                        </button>
                    ) : null}
                </div>
            ) : null}
        </div>
    );
}
