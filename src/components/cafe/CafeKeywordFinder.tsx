import { useEffect, useRef, useState } from 'react';
import { enqueuePlaceScan, pollPlaceScan, enqueueRegionScan, enqueueListScan, enqueueMenuScan, expandRelated, extractMenuKeywords, fetchPlaceReviews, fetchSiteText, relatedStems, searchCachedPopular, getRegionGuTokens, getPopularFromCache, FIRST_TARGET, MORE_STEP, savePendingScan, savePendingProgress, loadPendingScan, clearPendingScan, peekScans, cancelScans, enqueueRecheckScan, getClientBrands, hasClientBrand, subCategories, loadPickedKw, savePickedKw, getProvenProducts, discoverSeeds, enqueueChainScan, SEED_OVERLAP_MIN, type ProvenProduct, type SeedCand, type PendingScan, type ExtractedProduct, type KwResult, type RelatedCand } from '../../api/cafeKwScan';
import { getClientPublishedKeywords } from '../../api/cafeDeployRequests';
import { downloadCsv, todayTag } from '../../lib/exportCsv';
import { addToPool, loadPoolKw, saveLastChain, loadLastChain, isSoloKw } from '../../api/cafeKwScan';
import { CafeKwPool } from './CafeKwPool';

// 목표채우기에서 지역을 안 골랐을 때 쓰는 기본 지역 — 화면에도 이 값을 그대로 적는다.
const CHAIN_DEFAULT_REGIONS = ['서울', '경기', '인천'];

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
    mode: 'region' | 'keyword' | 'related' | 'info';
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
    // 지역이 없는 업체(보홀 다이빙투어·유학원 등) — 국내 지역축을 붙이지 않고 전국으로 판정한다.
    const [noRegion, setNoRegion] = useState(false);
    const [extracting, setExtracting] = useState('');       // 붙여넣기→키워드 추출 진행상태
    const [kwExpanded, setKwExpanded] = useState(false);
    const [kwErr, setKwErr] = useState('');
    const [kwHidden, setKwHidden] = useState<string[]>([]);
    // 담아둔 키워드(보관함) — 조회를 새로 해도 비우지 않고, 새로고침해도 남는다(2026-08-11 사장님 요청).
    //   '창업'으로 뽑고 '프랜차이즈'로 또 뽑고 정보형으로도 뽑아 쌓는 게 정상 사용법이다.
    const [kwPicked, setKwPicked] = useState<KwResult[]>([]);
    const pickedLoadedRef = useRef(false);
    // 발굴 적재함 — 모드를 오가며 찾아낸 인기탭 전부(보관함과 별개). 상단 패널이 이걸 보여준다.
    const [pool, setPool] = useState<KwResult[]>([]);
    useEffect(() => {
        // ⚠️ 진행중 저장분(pending)은 흡수하지 않는다 — PENDING_KEY 에 업체 스코프가 없어
        //   A업체 스캔 직후 B업체로 넘어가면 A의 결과가 B 적재함에 섞인다(독립검증 2026-08-12 지적).
        setPool(loadPoolKw(clientId || 'me'));
    }, [clientId]);
    useEffect(() => {
        pickedLoadedRef.current = false;
        const saved = loadPickedKw(clientId || 'me');
        if (saved.length) setKwPicked(saved);
        pickedLoadedRef.current = true;
    }, [clientId]);
    useEffect(() => {
        if (!pickedLoadedRef.current) return;
        savePickedKw(clientId || 'me', kwPicked);
    }, [kwPicked, clientId]);
    const [usedKw, setUsedKw] = useState<Set<string>>(new Set());
    // 정보입력형(플레이스 없는 업체) — 위치 직접입력 + 붙여넣기 추출 결과를 체크박스로 확정.
    //   ★ 자동 채우기를 쓰지 않는 이유: GPT 추출엔 늘 군더더기가 섞이는데, 자동 확정하면
    //     그게 조용히 스캔 비용과 오탐이 된다. 고객이 '내 서비스가 맞는지' 고르는 게 가장 정확하다.
    // 연관 인기글 찾기 — 씨앗어(보홀·하와이 등) → 연관 키워드 → 체크 확정 → 전국 인기탭 판정.
    const [seed, setSeed] = useState('');
    const [cands, setCands] = useState<RelatedCand[] | null>(null);
    const [relPicked, setRelPicked] = useState<Set<string>>(new Set());
    // 어디까지 보여줄지. ★ 기본을 seed(씨앗어 포함)로 둔다 — near 를 기본으로 뒀더니
    //   '창업'에 취업박람회·블로그·코인노래방·담가화로구이 같은 무관어가 섞여 나왔다(사장님 2026-08-11).
    //   실측(연관어 993개): 씨앗 포함 401 · 미포함 592 — 절반 넘게가 잡음이다.
    //   near 는 '창업박람회'에서 뽑힌 조각 '박람회'로 '취업박람회'까지 끌어올린다. 필요하면 버튼으로 넓힌다.
    const [relTier, setRelTier] = useState<'seed' | 'near' | 'far'>('seed');
    // 씨앗 계열 필터 — 씨앗을 여러 개 넣으면 첫 씨앗이 목록을 뒤덮는다.
    //   실측 2026-08-11(창업+가맹+사업+프렌차이즈): 보이는 338개 중 창업이 263개(78%)라
    //   사장님이 '프렌차이즈·사업은 안 나온다'고 하셨다. 실제로는 있는데 파묻힌 것이었다.
    const [seedFilter, setSeedFilter] = useState('');   // '' = 전체
    const [subFilter, setSubFilter] = useState('');    // 2단 세부 분야('' = 전체)

    // '씨앗으로 끝나는 것만' — 소자본창업·카페창업 처럼 '업종+행위' 형태만 본다.
    //   ★ 기본값을 씨앗별로 데이터가 정한다: 끝나는 게 앞에 붙는 것보다 많으면 켠다.
    //     '창업'은 끝 230 vs 앞 67 이라 켜지고, '보홀'은 보홀여행·보홀호텔처럼 앞이 많아 꺼진다
    //     (여기서 무조건 켜면 여행 씨앗은 후보가 거의 안 남는다).
    const [endsOnly, setEndsOnly] = useState(false);
    // 캐시 우선 조회 결과 — 스캔 0회로 즉시 나오는 것들.
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
    // ── 이미 검증된 제품 ─────────────────────────────────────────────────────
    //   판정이 끝난 것만 세므로 스캔 0콜. 고르면 그 제품의 지역 조합을 캐시에서 바로 꺼낸다.
    //   실측 2026-08-11: 검증된 제품 112종인데 씨앗 '창업'으로 닿는 건 19종뿐이었다.
    const [proven, setProven] = useState<ProvenProduct[] | null>(null);
    const [provenOpen, setProvenOpen] = useState(false);
    const [provenQ, setProvenQ] = useState('');
    const [provenBusy, setProvenBusy] = useState('');
    const openProven = async () => {
        setProvenOpen((o) => !o);
        if (proven) return;
        setProvenBusy('불러오는 중…');
        try { setProven(await getProvenProducts()); } catch { setProven([]); }
        setProvenBusy('');
    };
    // 제품 하나를 고르면 그 제품의 '지역 × 제품' 양성 조합을 캐시에서 꺼내 결과로 올린다(스캔 0콜).
    const pullProven = async (prod: string) => {
        setProvenBusy(`${prod} 불러오는 중…`);
        try {
            const hits = await searchCachedPopular([prod.replace(/\s/g, '')], 500);
            const rows = hits
                .filter((h) => h.keyword.replace(/\s/g, '').endsWith(prod.replace(/\s/g, '')))
                .map((h) => ({ cafes: h.cafes, keyword: h.keyword, theme: h.theme ?? undefined, volume: h.volume ?? undefined }));
            if (!rows.length) { setKwErr(`${prod} — 캐시에서 지역 조합을 찾지 못했습니다.`); return; }
            pushLive(rows);
            setKeyword(prod);
            setKwErr(`${prod} — 이미 확인된 ${rows.length}건을 스캔 없이 불러왔습니다. 더 찾으려면 지역을 고르고 ‘지역 키워드 생성’.`);
        } catch (e) {
            setKwErr(e instanceof Error ? e.message : '불러오기 실패');
        } finally { setProvenBusy(''); }
    };

    // ── 씨앗 발굴기 ──────────────────────────────────────────────────────────
    //   씨앗 하나로는 못 닿는다. 실측 2026-08-11: '창업' 993개 → 씨앗 8개 3,680개(3.7배).
    //   '무인창업' 하나가 767개를 새로 물어왔다. 그걸 사람이 감으로 고르지 말고 실측으로 고른다.
    const [seedCands, setSeedCands] = useState<SeedCand[] | null>(null);
    const [seedPick, setSeedPick] = useState<Set<string>>(new Set());
    const [seedBusy, setSeedBusy] = useState('');
    const runDiscover = async () => {
        const s = seed.trim();
        if (!s) { setKwErr('먼저 씨앗을 하나 넣으세요(예: 창업).'); return; }
        setKwErr(''); setSeedCands(null); setSeedPick(new Set()); setSeedBusy('시작…');
        try {
            const list = await discoverSeeds(s, (n) => setSeedBusy(n));
            setSeedCands(list);
            // 새로 물어오는 게 100개 이상인 것만 기본 체크 — 겹치기만 하는 후보는 스캔만 늘린다.
            // 같은 시장(겹침 기준 통과)이면서 새로 물어오는 게 있는 것만 기본 체크.
            //   겹침이 낮은 건 남의 시장이라(블로그·코인노래방) 스캔만 늘린다.
            setSeedPick(new Set(list.filter((c) => c.overlap >= SEED_OVERLAP_MIN && c.fresh >= 50).map((c) => c.seed)));
        } catch (e) {
            setKwErr(e instanceof Error ? e.message : '씨앗 발굴 실패');
        } finally { setSeedBusy(''); }
    };
    // 목표 채우기 — 지역형 후보들을 순서대로 끝까지 파서 목표 건수를 채운다(워커 process_chain).
    //   ★ 사장님 설계: 첫 키워드에서 30개를 채우면 오히려 좋다 — 제품 우선으로 깊게 판다.
    //     각 키워드의 '단독(지역 없음)' 판정도 맨 앞에서 같이 본다.
    //   regionsOverride: 적재함 패널이 자기 지역 칩으로 돌릴 때 쓴다(아래 지역 선택과 별개).
    // 이미 다 찾은 조합인지 — 같은 묶음을 또 돌리지 않게 버튼 상태로 알린다.
    const sigOf = (kws: string[]) => [...kws].sort().join('|');
    // 발굴 전용 스캔 — 지역을 붙이지 않고 '이 키워드 자체가 인기탭인가'만 본다(워커 process_list).
    //   ★ 왜 chain 이 아닌가(사장님 지적 2026-08-13): 1)연관어 · 2)주소는 '발굴' 단계인데
    //     chain 은 단독 판정이 끝나면 곧바로 지역을 곱해서 발굴 화면에 '수원 OO'가 섞여 나왔다.
    //     지역 확장은 적재함의 '지역 붙여 더 찾기' 한 곳에서만 한다.
    //   ★ 목표는 키워드 수 이상 — 캐시 양성이 목표를 먼저 채우면 라이브를 한 건도 안 본다.
    const runSoloScan = async (keywords: string[]) => {
        const list = [...new Set(keywords.map((k) => k.trim()).filter(Boolean))];
        if (!list.length) { setKwErr('먼저 키워드를 체크하세요.'); return; }
        setKwErr(''); setKwLoading(true); setScanNote('지역 없이 판정 중…'); setRegionTarget(FIRST_TARGET);
        lastScanRef.current = { kind: 'chain', products: list };
        saveLastChain(clientId || 'me', list);
        try {
            const { id, error } = await enqueueListScan(list, list.length + FIRST_TARGET);
            if (error || !id) throw new Error(error?.message || '등록 실패');
            savePendingScan(id, 'list', `지역없이 ${list.length}개 판정`);
            const { result } = await pollPlaceScan(id, { timeoutSec: 1500, onPartial: pushLive, onProgress: (n) => setScanNote(n) });
            pushLive(result);
            setScanDone({ sig: sigOf(list), n: result.length, target: FIRST_TARGET });
            if (!result.length) { setKwErr('이 키워드들은 지역 없이는 인기탭이 없습니다 — 적재함에서 지역을 붙여 보세요.'); return; }
        } catch (e) {
            const m = e instanceof Error ? e.message : '';
            if (/아직 분석 중/.test(m)) setResumeTick((t) => t + 1);
            setKwErr(m || '조회 실패');
        } finally { setKwLoading(false); setScanNote(''); }
    };
    const [scanDone, setScanDone] = useState<{ sig: string; n: number; target: number } | null>(null);
    const runChain = async (products: string[], target = FIRST_TARGET, regionsOverride?: string[]) => {
        if (!products.length) { setKwErr('먼저 키워드가 있어야 합니다.'); return; }
        // ★ 지역을 안 골라도 시작할 수 있다(2026-08-12) — 1단계가 '전 키워드 단독 판정'이라
        //   지역이 개입하지 않는다. 씨앗 200개면 1~2회차가 통째로 단독이라 지역은 그 뒤에나 쓰인다.
        //   그래서 미선택이면 서울·경기·인천으로 간다. 버튼·문구에 그 값을 그대로 적어 둔다(조용한 기본값 금지).
        //   2단계 지역은 적재함 패널에서 칩으로 다시 골라 돌릴 수 있다.
        const sidos = regionsOverride?.length ? regionsOverride : (regionSel.length ? regionSel : CHAIN_DEFAULT_REGIONS);
        setKwErr(''); setKwLoading(true); setScanNote('목표 채우기 시작…'); setRegionTarget(target);
        lastScanRef.current = { kind: 'chain', products };
        saveLastChain(clientId || 'me', products);   // 새로고침해도 ＋더 찾기가 같은 걸 이어서 판다
        // 누적이므로 직전 저장분을 지우지 않는다 — 지우면 이 시점에 새로고침한 사장님이 앞선 결과를 잃는다.
        //   savePendingScan 은 기존 기록 위에 이어 붙인다.
        try {
            const { id, error } = await enqueueChainScan(products, sidos.join(','), target);
            if (error || !id) throw new Error(error?.message || '등록 실패');
            savePendingScan(id, 'chain', `목표 ${target}건 · ${products.slice(0, 3).join(', ')}${products.length > 3 ? ` 외 ${products.length - 3}` : ''}`);
            const { result } = await pollPlaceScan(id, { timeoutSec: 1500, onPartial: pushLive, onProgress: (n) => setScanNote(n) });
            // ⚠️ 여기서 result 로 덮으면 안 된다 — pushLive 가 스캔 내내 쌓아 둔 앞선 조회분이
            //   끝나는 순간 사라진다(실측 2026-08-12: 화면 33개 → 이번 요청 6개로 줄어듦).
            //   '창업으로 뽑고 정보형으로 또 뽑아 쌓는' 것이 정상 사용법이라 누적이 맞다.
            pushLive(result);
            setScanDone({ sig: sigOf(products), n: result.length, target });
            if (!kwResultRef.current.length) { setKwErr('인기탭이 확인된 키워드가 없습니다.'); return; }
        } catch (e) {
            const m = e instanceof Error ? e.message : '';
            if (/아직 분석 중/.test(m)) setResumeTick((t) => t + 1);
            setKwErr(m || '조회 실패');
        } finally { setKwLoading(false); setScanNote(''); }
    };

    const applySeeds = () => {
        const cur = seed.split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
        const next = [...new Set([...cur, ...seedPick])];
        setSeed(next.join(', '));
        setSeedCands(null);
        setKwErr(`씨앗 ${next.length}개로 확장했습니다 — ‘연관어 펼치기’를 눌러 주세요.`);
    };

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
    // 여러 건을 한 번에 담는다 — 확인된 조합이 수십 개라 하나씩 누를 수 없다(사장님 지시 2026-08-11).
    //   이미 담긴 건 건너뛴다(토글이 아니라 '추가'여야 전부 담기가 생각대로 동작한다).
    const addPicks = (rows: KwResult[]) =>
        setKwPicked((prev) => {
            const have = new Set(prev.map((p) => p.keyword));
            return [...prev, ...rows.filter((r) => !have.has(r.keyword))];
        });
    // 발행 전 재확인 — 담아둔 키워드를 팔기 직전에 라이브로 다시 판정한다.
    //   SUB4 실측 2026-08-11: 5~6일 지난 양성 30건 중 3건(10%)이 죽어 있었다.
    //   전부 '섹션없음' — 네이버가 그 키워드에 인기글 섹션을 더 이상 안 주는 경우다.
    const [recheckBusy, setRecheckBusy] = useState('');
    const [recheckDead, setRecheckDead] = useState<string[]>([]);
    const runRecheck = async () => {
        if (!kwPicked.length) return;
        setRecheckBusy('재확인 준비…'); setRecheckDead([]);
        try {
            const kws = kwPicked.map((p) => p.keyword);
            const { id, error } = await enqueueRecheckScan(kws);
            if (error || !id) throw new Error(error?.message || '등록 실패');
            const { result } = await pollPlaceScan(id, {
                timeoutSec: 1500, onProgress: (n) => setRecheckBusy(n),
            });
            const alive = new Set(result.map((r) => r.keyword.replace(/\s/g, '')));
            const dead = kws.filter((k) => !alive.has(k.replace(/\s/g, '')));
            setRecheckDead(dead);
            setKwErr(dead.length
                ? `재확인 완료 — ${kws.length}건 중 ${dead.length}건은 지금 인기탭이 없습니다. 아래에서 빨간 것을 빼주세요.`
                : `재확인 완료 — ${kws.length}건 전부 살아있습니다.`);
        } catch (e) {
            setKwErr(e instanceof Error ? e.message : '재확인 실패');
        } finally { setRecheckBusy(''); }
    };

    // 고객사 상호가 들어간 키워드는 결과에서 미리 거른다(SUB4 발견 2026-08-11:
    //   캐시에 '경기 더반클린'·'안양더반클린' 이 양성으로 있었다). 팔 대상이 아니다 —
    //   그 업체는 이미 자기 이름을 갖고 있고, 다른 업체게는 남의 브랜드다.
    const [brands, setBrands] = useState<string[]>([]);
    useEffect(() => { void getClientBrands().then(setBrands); }, []);

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
        if (target <= 10) { setKwResult(null); setKwExpanded(false); setKwHidden([]); }
        try {
            const { id, error } = await enqueuePlaceScan(u, target, regionSel.length ? regionSel.join(',') : '서울,경기,인천');
            if (error || !id) throw new Error(error?.message || '요청 실패');
            const { result } = await pollPlaceScan(id, { timeoutSec: target > 10 ? 600 : 180, onPartial: pushLive });
            setKwResult(result);
            if (target > 10) setKwExpanded(true);
        } catch (e) {
            // 시간초과면 워커는 계속 돈다 — 이어보기 루프를 다시 태워 자동으로 채운다(새로고침 불필요).
            const m = e instanceof Error ? e.message : '';
            if (/아직 분석 중/.test(m)) setResumeTick((t) => t + 1);
            setKwErr(m || '분석 실패');
        } finally { setKwLoading(false); }
    };

    // 스캔 중단 — 다음 키워드로 안 넘어가고, 아직 워커가 안 집은(queued) 요청은 취소한다.
    //   진행 중(claimed)인 1건은 워커 루프라 중간에 못 끊는다 — 최대 5분 뒤 끝난다.
    const stopRef = useRef(false);
    const liveIdsRef = useRef<number[]>([]);
    const [stopping, setStopping] = useState(false);
    const stopScan = async () => {
        stopRef.current = true;
        setStopping(true);
        const n = await cancelScans(liveIdsRef.current);
        setScanNote(`중단 중… 대기 ${n}건 취소`);
    };

    // ── 실시간 누적 ────────────────────────────────────────────────────────────
    //   워커가 인기탭을 하나 찾을 때마다 화면에 바로 쌓는다(2026-08-10 사장님 요청).
    //   예전엔 회차(최대 5분)가 끝나야 한 번에 나타나서, 그 사이 게이지 숫자만 오르고 결과는 안 보였다.
    //   ref 를 같이 두는 이유: 부분결과가 3초마다 들어오는데 state 는 다음 렌더에야 반영돼
    //   두 번째 부분결과가 첫 번째를 덮어쓴다.
    const kwResultRef = useRef<KwResult[]>([]);
    useEffect(() => { kwResultRef.current = kwResult || []; }, [kwResult]);
    const pushLive = (rows: KwResult[]) => {
        const seen = new Set<string>(); const out: KwResult[] = [];
        for (const r of [...kwResultRef.current, ...rows]) {
            const nk = (r.keyword || '').replace(/\s/g, '');
            if (seen.has(nk)) continue;
            seen.add(nk); out.push(r);
        }
        out.sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0));
        kwResultRef.current = out;
        setKwResult(out);
        savePendingProgress(null, out);   // 도는 요청 목록은 그대로, 결과만 갱신(새로고침 대비)
        // 적재함에도 더한다 — 모드를 바꿔 조회해도 지금까지 찾은 게 상단에 계속 남게.
        setPool(addToPool(clientId || 'me', rows));
    };

    // 지역형 — 선택 시도의 행정구/시 × 제품키워드(들) 인기탭 조회.
    //   기본(includeDong=false): 구/시만 빠르게 → 결과 즉시. '더 찾기(동까지)'(true): 동(洞)까지 추가 스캔해 기존 결과에 합침.
    //   쉼표/줄바꿈으로 여러 개 입력하면 전부 먼저 큐에 넣고(누락 방지) 순차 폴링·누적.
    // 한 번에 목표 건수만 찾고 멈춘다 — 전수 스캔은 오래 걸리고 차단 예산(CF 300콜/10분)을 태운다.
    //   워커가 target 을 채우면 즉시 종료하므로, 실측상 입주청소 10건은 20콜(전수 265콜 대비 -92%).
    //   부족하면 '+10 더 찾기'로 target 을 올려 이어서 스캔한다(이미 판정된 건 캐시 히트라 즉시 통과).
    //   숫자는 cafeKwScan(FIRST_TARGET/MORE_STEP)에서만 정한다 — 두 화면이 갈리지 않게.
    const [regionTarget, setRegionTarget] = useState(FIRST_TARGET);
    // ★ '＋더 찾기'가 어느 경로로 나온 결과인지 알아야 이어서 돌릴 수 있다.
    //   연관형·목표채우기 결과에서 누르면 지역형 경로로 가서 키워드가 없다고 막혔다(2026-08-11).
    const lastScanRef = useRef<{ kind: 'region' | 'chain'; products: string[] } | null>(null);
    const runRegion = async (includeDong: boolean, target = FIRST_TARGET) => {
        // 칩이 있으면 칩 전부, 없으면 입력칸(쉼표/줄바꿈)으로. → 여러 키워드 한 번에 조회.
        const kws = [...new Set(keyword.split(/[,\n]/).map((s) => s.trim()).filter(Boolean))];
        if (!kws.length) { setKwErr('키워드를 추가하세요(입력 후 추가). 예: 출장뷔페'); return; }
        if (!regionSel.length) { setKwErr('지역을 선택하세요.'); return; }
        const setLoading = includeDong ? setDongLoading : setKwLoading;
        setKwErr(''); setLoading(true); setScanNote('');
        // 새 스캔이면 저장해 둔 직전 결과도 버린다 — 안 그러면 옛 결과가 새 조건에 섞인다.
        if (!includeDong && target === FIRST_TARGET) { clearPendingScan(); setKwResult(null); setKwExpanded(false); setKwHidden([]); setDongDone(false); }
        setRegionTarget(target);
        lastScanRef.current = { kind: 'region', products: kws };
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
                // ⚠️ pushLive 를 타야 적재함에도 들어간다 — setKwResult 로만 넣으면 화면엔 보이는데
                //   상단 적재함에는 안 쌓여, '다 쌓아서 지역 붙이기' 흐름에서 이 캐시 양성분이 통째로 샌다.
                if (merged.length) pushLive(dedup(merged));
            } else {
                toScan.push(...kws);   // 동은 조합이 달라 워커에 맡김(내부 배치캐시로 재스캔 빠름)
            }
            // 캐시 없는 키워드는 '전부 먼저 큐 등록' → 순차 폴링.
            const jobs: { kw: string; id: number }[] = [];
            for (const kw of toScan) {
                const { id } = await enqueueRegionScan(kw, regionSel.join(','), target, includeDong);
                if (id) jobs.push({ kw, id });
            }
            liveIdsRef.current = jobs.map((j) => j.id);   // ⏹ 중단이 한 번에 끌 대상
            const failedKws: string[] = [];              // 실패분 — 루프가 끝나면 한 번 더 돌린다
            for (let i = 0; i < jobs.length; i++) {
                if (stopRef.current) break;               // 중단 눌림 — 다음 키워드로 안 넘어간다
                const { kw, id } = jobs[i];
                const tag = jobs.length > 1 ? ` (${i + 1}/${jobs.length})` : '';
                setScanNote(`${kw}${includeDong ? ' 동' : ''} 스캔 시작…${tag}`);
                // 새로고침·이탈해도 이 요청에 다시 붙는다. 지역형도 정보형과 똑같이 오래 걸린다
                //   (실측 2026-08-10 '세무사': 30건을 찾아 정상 종료했는데 화면이 못 주워왔다).
                savePendingScan(id, 'region', `${regionSel.join('·')} × ${kw}`);
                try {
                    const { result } = await pollPlaceScan(id, { timeoutSec: 1500, onPartial: pushLive, onProgress: (note) => setScanNote(`${kw} · ${note}${tag}`) });
                    merged.push(...result);
                    setKwResult(dedup(merged));                 // 끝나는 대로 누적
                    // 여기까지 모은 결과를 남긴다 — 새로고침해도 되살아난다(아직 안 돈 요청 id 도 같이).
                    savePendingProgress(jobs.slice(i + 1).map((j) => j.id), dedup(merged));
                } catch {
                    failedKws.push(kw);   // 이 키워드만 실패 — 나머지 계속, 끝나고 한 번 더 돌린다
                }
            }
            // 실패분만 한 번 더 — 일시 오류였다면 여기서 붙는다(판정된 조합은 캐시라 금방 지나간다).
            for (let i = 0; i < failedKws.length; i++) {
                if (stopRef.current) break;
                const kw = failedKws[i];
                const { id } = await enqueueRegionScan(kw, regionSel.join(','), target, includeDong);
                if (!id) continue;
                liveIdsRef.current = [...liveIdsRef.current, id];
                try {
                    const { result } = await pollPlaceScan(id, {
                        timeoutSec: 1500, onPartial: pushLive,
                        onProgress: (note) => setScanNote(`${kw} · ${note} 재시도 (${i + 1}/${failedKws.length})`),
                    });
                    merged.push(...result);
                    setKwResult(dedup(merged));
                    savePendingProgress([], dedup(merged));
                } catch { /* 두 번 다 실패 — 아래 안내로 알린다 */ }
            }
            // ★ 실시간으로 이미 화면에 쌓인 것(kwResultRef)을 반드시 포함한다 — 폴링이 시간초과로
            //   빠지면 merged 에는 안 들어가 있어서, 여기서 덮어쓰면 찾아 놓은 게 도로 사라진다.
            const final = dedup([...kwResultRef.current, ...merged]);
            savePendingProgress([], final);
            if (!final.length) { setKwErr(`인기탭 확인된 키워드가 없습니다 — ${regionSel.join('·')} × "${kws.join(', ')}"`); return; }
            setKwResult(final);
            if (includeDong) setDongDone(true);
        } catch (e) {
            // 시간초과면 워커는 계속 돈다 — 이어보기 루프를 다시 태워 자동으로 채운다(새로고침 불필요).
            const m = e instanceof Error ? e.message : '';
            if (/아직 분석 중/.test(m)) setResumeTick((t) => t + 1);
            setKwErr(m || '조회 실패');
        } finally {
            setLoading(false); setScanNote(''); setStopping(false);
            stopRef.current = false; liveIdsRef.current = [];
        }
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
            // '끝나는 것만' 기본값을 데이터가 정한다 — 씨앗이 뒤에 붙는 형태가 더 많을 때만 켠다.
            const inSeed = list.filter((x) => x.tier === 'seed');
            setEndsOnly(inSeed.filter((x) => x.endsSeed).length > inSeed.filter((x) => !x.endsSeed).length);
            // ★ 스캔 전에 캐시부터 본다 — 이미 판정된 인기탭이 1,000건 넘게 쌓여 있어
            //   상당수는 긁지 않고 바로 줄 수 있다(실측: '방문요양' → 53건 즉시).
            //   검색어는 씨앗어 + 연관어 상위 몇 개(부분일치라 '간병인'으로 '수원 간병인'도 잡힌다).
            setExtracting('이미 찾아둔 것 조회 중…');
            const terms = relatedStems(s, list);
            const hits = await searchCachedPopular(terms, 200, false);   // cafes 는 안 쓴다
            // 캐시 히트는 바로 적재함에 넣는다 — 따로 패널에 띄우고 '담기'를 누르게 할 이유가 없다.
            //   CF 콜 0회로 얻은 것이라 넣는 데 드는 비용도 없다.
            if (hits.length) {
                setCachedVia([...new Set(hits.map((h) => h.via))]);
                setPool(addToPool(clientId || 'me', hits.map((h) => ({
                    cafes: h.cafes, keyword: h.keyword, theme: h.theme ?? undefined, volume: h.volume ?? undefined,
                }))));
            }
            // ★ 기본 체크 = 씨앗어를 포함한 것(tier==='seed') 전부.
            //   옛 규칙은 '의도어(여행·숙소·패키지…)가 붙은 것'이었는데 여행 전용이었다.
            //   독립검증 실측(2026-08-10, 양성 1,169건 기준):
            //     의도어 규칙   선택 96개 · 정밀도 67% · 재현율  7%   ← 93%를 놓친다
            //     tier==seed   선택 1509개 · 정밀도 60% · 재현율 77%   ← 11배
            //   정밀도 67% 도 보홀 하나가 만든 수치였다(보홀 8/11, 나머지 5개 씨앗 합계 0양성).
            //   원인: 전체 양성 중 의도어를 가진 것이 5.6%뿐이고 그중 40건이 '맛집'이다.
            //   그래서 창업은 '유명맛집·포항두호동맛집'이 체크되고 실제 양성 122건은 0건 선택됐다.
            //   far 는 무관어(하와이→디트로이트)가 섞이므로 여전히 제외한다.
            const ends = inSeed.filter((x) => x.endsSeed);
            const base = ends.length > inSeed.length - ends.length ? ends : inSeed;
            setRelPicked(new Set(base.slice(0, 200).map((x) => x.kw)));
        } catch (e) {
            // 시간초과면 워커는 계속 돈다 — 이어보기 루프를 다시 태워 자동으로 채운다(새로고침 불필요).
            const m = e instanceof Error ? e.message : '';
            if (/아직 분석 중/.test(m)) setResumeTick((t) => t + 1);
            setKwErr(m || '연관어 조회 실패');
        } finally { setExtracting(''); }
    };
    // 연관 인기글 ② — 체크한 키워드를 지역 없이(전국) 인기탭 판정.
    //   ★ 워커(process_list)의 라이브 상한은 60개다. 61번째부터는 '느려지는' 게 아니라
    //     아예 안 재진다(조용한 절단). 그래서 여기서 미리 자르고 그 사실을 화면에 남긴다.
    const REL_MAX = 200;   // 워커 process_related 의 MAX_A 와 같아야 한다(더 보내면 조용히 잘린다)
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

    // 홈페이지·블로그 주소 → 원문을 붙여넣기 칸에 채운다. 줄바꿈/쉼표로 여러 개를 한 번에 넣는다.
    //   ★ 사이트와 블로그를 같이 넣는 게 실제로 제일 낫다(실측 2026-08-07 경기간호):
    //     블로그만 28개 · 홈페이지만 28개인데 둘을 합치면 39개. 겹치는 건 방문간호·방문요양 둘뿐이고
    //     블로그는 증상별(뇌졸중·파킨슨·연하곤란), 홈페이지는 처치별(욕창간호·투약관리)로 갈린다.
    //   ★ 덮어쓰지 않는다 — 직전에 가져온 자동수집분만 걷어내고 다시 붙인다.
    //     (덮어쓰면 블로그 넣고 사이트 넣었을 때 앞엣것이 조용히 사라진다.)
    const autoTextRef = useRef('');
    const [srcParts, setSrcParts] = useState<{ label: string; text: string }[]>([]);  // 원천별 원문(따로 추출해 합치려고 보관)
    const pullSite = async () => {
        const urls = [...new Set(siteUrl.split(/[\n,]/).map((s) => s.trim()).filter(Boolean))];
        if (!urls.length) { setKwErr('홈페이지 또는 네이버 블로그 주소를 입력하세요.'); return; }
        setKwErr('');
        const parts: string[] = [];
        const srcs: { label: string; text: string }[] = [];
        const notes: string[] = [];
        const fails: string[] = [];
        for (let i = 0; i < urls.length; i++) {
            setExtracting(`주소에서 글 가져오는 중… (${i + 1}/${urls.length})`);
            try {
                const b = await fetchSiteText(urls[i]);
                const what = b.source === 'naver_blog' ? `블로그 글 ${b.posts ?? 0}개` : `페이지 ${b.pages.length}장`;
                parts.push(`[출처: ${urls[i]}]\n${b.text}`);
                srcs.push({ label: b.source === 'naver_blog' ? '블로그' : '홈페이지', text: b.text });
                notes.push(`${b.title || urls[i]}(${what}·${b.chars.toLocaleString()}자)`);
            } catch (e) {
                fails.push(`${urls[i]} — ${e instanceof Error ? e.message : '읽기 실패'}`);
            }
        }
        setExtracting('');
        if (!parts.length) { setKwErr(fails.join(' / ') || '주소를 읽지 못했습니다'); return; }
        setSrcParts(srcs);
        const auto = parts.join('\n\n');
        // 수동으로 붙여넣은 내용은 남기고, 직전 자동수집분만 교체한다.
        const manual = (autoTextRef.current ? pasteText.split(autoTextRef.current).join('') : pasteText).trim();
        autoTextRef.current = auto;
        setPasteText(manual ? `${manual}\n\n${auto}` : auto);
        setKwErr(`${notes.join(' + ')} 를 가져왔습니다 — ‘① 키워드 뽑기’를 눌러 주세요.`
            + (fails.length ? ` ⚠️ 실패: ${fails.join(' / ')}` : ''));
    };

    // 정보입력형 ① — 붙여넣은 소개/메뉴 → GPT 가 검색 가능한 제품·서비스 키워드로 정리.
    //   ★ 방침: 뽑을 수 있는 건 최대로 뽑고, 쓸 만한지는 인기탭 스캔이 판정한다.
    //     그래서 세부(niche)까지 전부 기본 체크한다. 스캔이 지역불일치·오탐·검색량없음을 걸러내므로
    //     여기서 미리 빼면 걸러질 일 없는 키워드까지 같이 사라진다(실측: 경기간호 39개 중
    //     파킨슨병 47,080 · 뇌졸중 33,650 이 전부 niche 로 분류돼 있었다).
    //   ★ 원천마다 따로 추출해서 합친다(실측 2026-08-07 경기간호): 통째로 51개 vs 각각 뽑아 합치면 68개.
    //     원문이 길수록 GPT 가 굵은 것 위주로 골라 '고관절골절재활→고관절골절'처럼 세부가 떨어져 나간다.
    const runExtract = async () => {
        const raw = pasteText.trim();
        if (!raw) { setKwErr('업체 정보(소개·메뉴)를 붙여넣으세요.'); return; }
        setKwErr(''); setExtracting('키워드 추출 중…'); setExtracted(null);
        try {
            const manual = (autoTextRef.current ? pasteText.split(autoTextRef.current).join('') : pasteText).trim();
            const lots = [...(manual ? [{ label: '직접입력', text: manual }] : []), ...srcParts];
            const runs = lots.length
                ? await Promise.all(lots.map((s) => extractMenuKeywords(s.text, keyword.trim(), noRegion).catch(() => ({ biz: '', products: [] as ExtractedProduct[] }))))
                : [await extractMenuKeywords(raw, keyword.trim(), noRegion)];
            const seen = new Set<string>();
            const products: ExtractedProduct[] = [];
            for (const r of runs) {
                for (const p of r.products) {
                    const n = p.kw.replace(/\s/g, '');
                    if (seen.has(n)) continue;
                    seen.add(n); products.push(p);
                }
            }
            if (!products.length) { setKwErr('검색 가능한 제품·서비스 키워드를 찾지 못했습니다.'); return; }
            const biz = runs.find((r) => r.biz)?.biz || '';
            setExtracted(products);
            setPicked(new Set(products.map((x) => x.kw)));
            const src = lots.length > 1 ? `원천 ${lots.length}곳(${lots.map((s) => s.label).join(' · ')}) · ` : '';
            if (biz) setKwErr(`${src}업종 인식: ${biz} — 키워드 ${products.length}개를 모두 골라 뒀습니다. 뺄 것만 해제하고 ③을 누르세요.`);
        } catch (e) {
            setKwErr(e instanceof Error ? e.message : '키워드 추출 실패');
        } finally { setExtracting(''); }
    };
    // 정보입력형 ② — 체크한 키워드 × 위치(직접입력, + 선택 시도)로 인기탭 스캔.
    const runMenuScan = async (target = FIRST_TARGET) => {
        const list = (extracted || []).map((x) => x.kw).filter((k) => picked.has(k));
        if (!list.length) { setKwErr('스캔할 키워드를 1개 이상 체크하세요.'); return; }
        // ★ 지역이 없는 업체가 있다 — 보홀 스쿠버다이빙 투어처럼 현지(해외)에서 영업하는 곳은
        //   국내 지역축 자체가 성립하지 않는다("판교 보홀투어"를 검색하는 사람은 없다).
        //   이때는 지역을 곱하지 않고 키워드 그대로 전국 판정한다(list: 라우트 = process_list).
        if (noRegion) {
            setKwErr(''); setKwLoading(true); setScanNote(''); setRegionTarget(target);
            if (target <= FIRST_TARGET) clearPendingScan();   // 새 스캔 — 직전 저장분 버림
            try {
                const { id, error } = await enqueueListScan(list, Math.max(target, list.length));
                if (error || !id) throw new Error(error?.message || '분석 등록 실패');
                savePendingScan(id, 'list', `전국(지역없음) × ${list.join(', ')}`);
                const { result } = await pollPlaceScan(id, { timeoutSec: 600, onPartial: pushLive, onProgress: (note) => setScanNote(note) });
                savePendingProgress([], result);
                if (!result.length) { setKwErr(`인기탭 확인된 키워드가 없습니다 — 전국 기준 "${list.join(', ')}"`); return; }
                setKwResult(result);
                setKeyword(list.join(', '));
            } catch (e) {
                setKwErr(e instanceof Error ? e.message : '조회 실패');
            } finally { setKwLoading(false); setScanNote(''); }
            return;
        }
        if (!addr.trim() && !regionSel.length) { setKwErr('위치를 입력하거나 시도를 고르세요. 지역이 없는 업체면 위의 ‘지역 없음’을 체크하세요.'); return; }
        setKwErr(''); setKwLoading(true); setScanNote(''); setRegionTarget(target);
        if (target <= FIRST_TARGET) clearPendingScan();   // 새 스캔 — 직전 저장분 버림
        try {
            const { id, error } = await enqueueMenuScan(addr, list, { regions: regionSel.join(','), target });
            if (error || !id) throw new Error(error?.message || '분석 등록 실패');
            // 새로고침·이탈해도 이 요청에 다시 붙을 수 있게 남긴다.
            savePendingScan(id, 'menu', `${addr.trim() || regionSel.join('·')} × ${list.join(', ')}`);
            const { result } = await pollPlaceScan(id, { timeoutSec: 1500, onPartial: pushLive, onProgress: (note) => setScanNote(note) });
            savePendingProgress([], result);   // 결과 보관 — 새로고침해도 되살아난다
            if (!result.length) { setKwErr(`인기탭 확인된 키워드가 없습니다 — ${addr.trim() || regionSel.join('·')} × "${list.join(', ')}"`); return; }
            setKwResult(result);
            setKeyword(list.join(', '));   // 아래 발행 단계가 쓰는 제품키워드(지역 분리 기준)
        } catch (e) {
            // 폴링 시간이 다 돼도 워커는 계속 돈다 — 기록을 지우지 않는다(돌아와서 이어본다).
            setKwErr(e instanceof Error ? e.message : '조회 실패');
        } finally { setKwLoading(false); setScanNote(''); }
    };

    // 새로고침/이탈 후 복귀 — 저장해 둔 결과를 먼저 되살리고, 아직 도는 요청에 다시 붙는다.
    //   ★ 결과부터 복원한다: 예전엔 요청 id 만 남겨서 화면에 쌓여 있던 결과가 새로고침에 그대로 사라졌다.
    //     지역형은 요청이 키워드마다 따로라 마지막 1건만 남는 문제도 같이 있었다(이제 ids 전부).
    //   화면을 막지 않는다: 이게 도는 동안 다른 작업을 계속할 수 있다.
    const [pending, setPending] = useState<PendingScan | null>(null);
    const [pendNote, setPendNote] = useState('');
    // ★ 폴링이 시간초과로 빠져도 여기에 다시 붙는다(2026-08-11).
    //   예전엔 이 효과가 '화면을 처음 열 때' 한 번만 돌아서, 25분 폴링이 끝나면
    //   워커는 계속 도는데 화면은 더 이상 안 채워졌다. 사장님이 새로고침을 해야 이어졌다.
    //   이제 시간초과 시 resumeTick 을 올려 같은 루프를 다시 태운다 — 켜두면 끝까지 자동이다.
    const [resumeTick, setResumeTick] = useState(0);
    useEffect(() => {
        const p = loadPendingScan();
        if (!p) return;
        const sortDedup = (arr: KwResult[]) => {
            const seen = new Set<string>(); const out: KwResult[] = [];
            for (const r of arr) { const nk = (r.keyword || '').replace(/\s/g, ''); if (seen.has(nk)) continue; seen.add(nk); out.push(r); }
            return out.sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0));
        };
        let acc = sortDedup(p.result);
        if (acc.length) { setKwResult(acc); setKwErr(`직전 스캔 결과 ${acc.length}건을 되살렸습니다${p.label ? ` — ${p.label}` : ''}.`); }
        if (!p.ids.length) return;   // 도는 건 없음 — 결과만 복원하고 끝
        setPending(p);
        let alive = true;
        void (async () => {
            let ids = p.ids;
            // 끝난 요청 결과는 그때그때 걷어 오고, 남은 게 없을 때까지 20초마다 확인한다.
            for (let i = 0; alive && i < 240; i++) {
                const s = await peekScans(ids);
                if (!alive) return;
                setPendNote(s.note);
                // 이어보기로 회수한 결과도 적재함에 넣는다 — 여기가 새면 새로고침 후 찾은 건 적재함에 안 남는다.
                if (s.result.length) { acc = sortDedup([...acc, ...s.result]); setKwResult(acc); setPool(addToPool(clientId || 'me', s.result)); }
                ids = s.live;
                savePendingProgress(ids, acc);
                if (!ids.length) {
                    setKwErr(`이전 스캔 결과 ${acc.length}건을 불러왔습니다${p.label ? ` — ${p.label}` : ''}.`);
                    setPending(null); return;
                }
                setPending((cur) => (cur ? { ...cur, id: ids[0], ids } : cur));
                await new Promise((r) => setTimeout(r, 20000));
            }
        })();
        return () => { alive = false; };
    }, [resumeTick]);
    // 키워드형 — 추출한 키워드를 지역 없이(전국) 바로 인기탭 판정(워커 process_list).
    const extractAndScan = async () => {
        const top = await extractScored();
        if (!top) return;
        setKwErr(''); setKwLoading(true); setScanNote(''); setKwResult(null); setKwExpanded(false); setKwHidden([]);
        try {
            const { id, error } = await enqueueListScan(top.map((t) => t.keyword));
            if (error || !id) throw new Error(error?.message || '분석 등록 실패');
            const { result } = await pollPlaceScan(id, { timeoutSec: 300, onPartial: pushLive, onProgress: (note) => setScanNote(note) });
            if (!result.length) { setKwErr(`인기탭 확인된 키워드가 없습니다 — 붙여넣은 정보 기준 ${top.length}개 판정`); return; }
            setKwResult(result);
        } catch (e) {
            // 시간초과면 워커는 계속 돈다 — 이어보기 루프를 다시 태워 자동으로 채운다(새로고침 불필요).
            const m = e instanceof Error ? e.message : '';
            if (/아직 분석 중/.test(m)) setResumeTick((t) => t + 1);
            setKwErr(m || '분석 실패');
        } finally { setKwLoading(false); setScanNote(''); }
    };

    // 고객사 상호가 들어간 키워드는 보이지 않게 한다 — 팔 대상이 아니다.
    const visible = (kwResult || []).filter((k) => !kwHidden.includes(k.keyword) && !hasClientBrand(k.keyword, brands));
    // 기존에 했던 것 = 이미 발행/선택(usedKw) + 이번 세션에 고른 것(kwPicked). 둘 다 '이미 함'으로 제외.
    const pickedSet = new Set(kwPicked.map((p) => normKw(p.keyword)));
    const isUsed = (k: KwResult) => usedKw.has(normKw(k.keyword)) || pickedSet.has(normKw(k.keyword));
    const fresh = visible.filter((k) => !isUsed(k));
    const used = visible.filter((k) => isUsed(k));

    return (
        <div className="rounded-xl border-2 border-[#0369a1] bg-[#f0f9ff] p-4">
            <div className="mb-2 text-[13px] font-bold text-[#075985]">🔍 SEO 키워드 찾기 — {mode === 'region' ? '지역 × 제품키워드' : mode === 'related' ? '연관 인기글 찾기' : mode === 'info' ? '정보형 (홈페이지·블로그 주소)' : '플레이스 인기탭'}</div>
            {/* 발굴 적재함 — 모드를 오가며 찾은 것을 한곳에 쌓아 맨 위에 보여준다.
                여기서 '지역 없이 잡힌 것'만 골라, 이 패널의 지역 칩으로 지역까지 더 찾는다(사장님 요청 2026-08-12). */}
            <CafeKwPool who={clientId || 'me'} rows={pool} onChange={setPool} busy={kwLoading || dongLoading}
                onPick={(rows) => addPicks(rows)}
                onRunChain={(kws, regions) => void runChain(kws, regionTarget + MORE_STEP, regions)} />
            {/* 이어보기 배너 — 새로고침·이탈 후 돌아오면 진행 중인 스캔에 다시 붙는다.
                화면을 막지 않는다: 이 배너가 도는 동안 다른 작업을 계속할 수 있다.
                (예전엔 요청 id 를 잃어 워커가 찾아 둔 결과를 못 주워왔고, 같은 스캔을 3번 다시 돌렸다.) */}
            {pending ? (
                <div className="mb-2 flex flex-wrap items-center gap-2 rounded-md border border-[#93c5fd] bg-[#eff6ff] px-3 py-2 text-[12px] text-[#1e40af]">
                    <span className="animate-pulse">⏳</span>
                    <b>이전 스캔이 계속 돌고 있습니다</b>
                    <span className="text-[#3b82f6]">#{pending.id} · {pending.label}</span>
                    {pendNote ? <span className="font-semibold">{pendNote}</span> : null}
                    <span className="text-[11px] text-[#60a5fa]">끝나면 결과가 자동으로 채워집니다 — 그동안 다른 작업 하셔도 됩니다.</span>
                    <button type="button" onClick={() => { clearPendingScan(); setPending(null); }}
                        className="ml-auto rounded border border-[#bfdbfe] bg-white px-2 py-0.5 text-[11px] font-semibold text-[#3b82f6]">
                        그만 보기
                    </button>
                </div>
            ) : null}

            {/* 연관 인기글 찾기 — 씨앗어 하나에서 연관 키워드를 펼쳐 인기탭을 찾는다.
                기존 3모드는 '한국 행정지역 × 제품'이 전제라 보홀·하와이 같은 해외지명이나
                취미어를 다루지 못했다. 여기선 지역 축 없이 연관어 자체를 판정한다. */}
            {mode === 'related' || mode === 'info' ? (
                <div className="grid gap-2">
                    {/* 정보형 안의 1번 방법 — 대표 단어(씨앗)에서 연관어를 펼쳐 인기탭을 찾는다. */}
                    <div className="flex items-center gap-2">
                        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#6d28d9] text-[13px] font-bold text-white">1</span>
                        <b className="text-[13px] text-[#5b21b6]">연관어로 찾기</b>
                        <span className="text-[11px] text-[#94a3b8]">대표 단어 → 연관어 펼치기 → 인기탭 찾기 · 찾은 건 위 적재함에 쌓입니다</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <input className={`${inputCls} flex-1 min-w-[200px]`} value={seed}
                            onChange={(e) => setSeed(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void runExpand(); } }}
                            placeholder="씨앗 키워드 — 쉼표로 여러 개 (예: 창업, 프랜차이즈, 가맹)" />
                        {/* 씨앗 발굴 — 씨앗 하나로는 못 닿는다. 실측: '창업' 993 → 씨앗 8개 3,680(3.7배). */}
                        <button type="button" onClick={() => void runDiscover()} disabled={!!seedBusy || !!extracting || kwLoading}
                            className="h-10 shrink-0 rounded-md border border-[#6d28d9] bg-white px-3 text-sm font-bold text-[#6d28d9] disabled:opacity-50"
                            title="이 씨앗에서 출발해 '씨앗으로 쓸 만한 다른 키워드'를 찾아 줍니다. 인기탭 스캔은 안 합니다.">
                            {seedBusy ? '발굴 중…' : '🔎 씨앗 발굴'}
                        </button>
                        <button type="button" onClick={() => void runExpand()} disabled={!!extracting || kwLoading}
                            className="h-10 shrink-0 rounded-md bg-[#6d28d9] px-4 text-sm font-bold text-white disabled:opacity-50">
                            {extracting ? '조회 중…' : '① 연관어 펼치기'}
                        </button>
                    </div>
                    {/* cache hits went straight into the pool -- show where they came from. */}
                    {cachedVia.length ? (
                        <p className="m-0 text-[11px] font-semibold text-[#15803d]">
                            ✅ 이미 확인된 인기탭을 <b>{cachedVia.join(' · ')}</b> 로 찾아 위 적재함에 담았습니다 — 스캔 없이 바로 쓰실 수 있습니다.
                        </p>
                    ) : null}
                    {seedBusy ? <p className="m-0 text-[11px] font-semibold text-[#6d28d9]">🔎 {seedBusy} <span className="font-normal text-[#94a3b8]">— 검색광고 API라 인기탭 차단 예산과 무관합니다.</span></p> : null}
                    {/* (2026-08-13) 여기 있던 '발행할 지역' 칩 제거 — 정보형 블록에 같은 칩이,
                        위쪽 발굴 적재함에도 전용 칩이 있어 셋이 겹쳤다. 지역은 2단계에서만 쓰인다. */}
                    {/* 발굴 결과 — '새로 물어오는 개수'는 실제로 조회해서 잰 값이다(추측 아님). */}
                    {seedCands?.length ? (
                        <div className="rounded-md border border-[#c4b5fd] bg-[#faf5ff] p-2">
                            <div className="mb-1.5 flex flex-wrap items-center gap-2 text-[12px] font-bold text-[#6d28d9]">
                                <span>씨앗 후보 {seedCands.length}개 — 선택 {seedPick.size}개</span>
                                <span className="font-normal text-[#94a3b8]">신규 = 이 씨앗을 더하면 새로 들어오는 연관어 수(실측)</span>
                                <button type="button" onClick={applySeeds} disabled={!seedPick.size}
                                    className="ml-auto rounded bg-[#6d28d9] px-3 py-1 text-[11px] font-bold text-white disabled:opacity-50">
                                    선택한 {seedPick.size}개를 씨앗에 추가 →
                                </button>
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                                {seedCands.map((c) => {
                                    const on = seedPick.has(c.seed);
                                    return (
                                        <button key={c.seed} type="button"
                                            onClick={() => { const n = new Set(seedPick); if (on) n.delete(c.seed); else n.add(c.seed); setSeedPick(n); }}
                                            className={`rounded-full border px-2.5 py-1 text-[12px] font-semibold ${on ? 'border-[#6d28d9] bg-[#6d28d9] text-white' : 'border-[#ddd6fe] bg-white text-[#5b21b6]'}`}>
                                            {c.kind === 'other' ? '' : '↳ '}{on ? '✓ ' : '+ '}{c.seed}
                                            <span className={`ml-1 text-[10px] font-bold ${on ? 'text-[#ddd6fe]' : 'text-[#16a34a]'}`}>신규 {c.fresh.toLocaleString()}</span>
                                            {/* 캐시에서 이미 지역형으로 검증된 제품 = 수확이 보장된 씨앗 */}
                                            {c.proven ? <span className={`ml-1 text-[10px] ${on ? 'text-[#ddd6fe]' : 'text-[#b45309]'}`}>✔검증 {c.proven}지역</span> : null}
                                            {c.overlap < SEED_OVERLAP_MIN ? <span className={`ml-1 text-[10px] ${on ? 'text-[#fecaca]' : 'text-[#dc2626]'}`}>⚠다른 시장</span> : null}
                                        </button>
                                    );
                                })}
                            </div>
                            <p className="m-0 mt-1 text-[11px] text-[#a78bfa]">
                                맨 위는 <b>‘창업 → 프랜차이즈’ 처럼 결이 다른 형제 단어</b>입니다. ↳ 는 씨앗이 든 변형(무인창업 등)이고요.
                                ✔검증 = 캐시에 이미 지역형 인기탭이 쌓여 있는 것(수확 보장). ⚠다른 시장 = 새 키워드는 많이 물어오지만 우리 업종이 아닙니다(블로그·코인노래방 류).
                            </p>
                        </div>
                    ) : null}
                    {/* 이미 검증된 제품 — 판정이 끝난 것만 세므로 스캔 0콜. 고르면 캐시에서 바로 꺼낸다.
                        실측 2026-08-11: 검증 제품 112종인데 씨앗 '창업'으로 닿는 건 19종뿐이었다. */}
                    <div className="rounded-md border border-[#bbf7d0] bg-[#f0fdf4] p-2">
                        <button type="button" onClick={() => void openProven()}
                            className="flex w-full items-center gap-2 text-[12px] font-bold text-[#15803d]">
                            <span className={`text-[9px] transition-transform ${provenOpen ? 'rotate-90' : ''}`}>▶</span>
                            ✔ 이미 검증된 제품{proven ? ` ${proven.length}종` : ''} — 스캔 없이 바로 꺼내기
                            <span className="font-normal text-[#86efac]">{provenBusy || '판정이 끝나 캐시에 쌓인 것들입니다(CF 0콜)'}</span>
                        </button>
                        {provenOpen ? (
                            <div className="mt-2">
                                <input className={`${inputCls} mb-1.5 h-8 text-[12px]`} value={provenQ}
                                    onChange={(e) => setProvenQ(e.target.value)} placeholder="제품 검색 (예: 창업 · 청소 · 누수)" />
                                <div className="flex max-h-44 flex-wrap gap-1.5 overflow-y-auto">
                                    {(proven ?? [])
                                        .filter((p) => !provenQ.trim() || p.product.includes(provenQ.trim()))
                                        .slice(0, 120)
                                        .map((p) => (
                                            <button key={p.product} type="button" onClick={() => void pullProven(p.product)}
                                                disabled={!!provenBusy}
                                                className="rounded-full border border-[#bbf7d0] bg-white px-2.5 py-1 text-[12px] font-semibold text-[#15803d] disabled:opacity-50">
                                                {p.product}
                                                <span className="ml-1 text-[10px] font-bold text-[#16a34a]">{p.regions}지역</span>
                                            </button>
                                        ))}
                                    {proven && !proven.length ? <span className="text-[11px] text-[#86efac]">아직 없습니다.</span> : null}
                                </div>
                            </div>
                        ) : null}
                    </div>
                    {/* 실측(2026-08-06, 30조합)으로 확인된 패턴 — 미리 알려야 "5만 검색인데 왜 없냐"는 오해가 없다. */}
                    <p className="m-0 text-[11px] text-[#7c3aed]">
                        💡 <b>지명·상품명 단독은 인기글이 거의 없습니다</b>(보홀 49,600 · 필리핀 56,500 · 골프채 15,230 모두 없음).
                        <b>씨앗어 + 의도어</b>(여행·숙소·투어·패키지·맛집·연습장 …) 조합에서 나옵니다.
                    </p>
                    {/* (removed 2026-08-13) cached-hit panel: expand now pushes cache hits
                        straight into the discovery pool above. Same as the customer ERP screen. */}
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
                                {/* 분야 · 세부 드롭다운 — 계열만으로는 454개라 너무 광범위하다(사장님 요청 2026-08-11).
                                    세부는 사전이 아니라 실제 후보에서 뽑는다 — 업종마다 다르고, 미리 짜면 그 순간 추측이다. */}
                                {(() => {
                                    const base = cands.filter((x) => (relTier === 'seed' ? x.tier === 'seed' : relTier === 'near' ? x.tier !== 'far' : true))
                                        .filter((x) => !endsOnly || x.endsSeed);
                                    const fam = new Map<string, number>();
                                    for (const x of base) { const k = x.seedOf || '기타'; fam.set(k, (fam.get(k) ?? 0) + 1); }
                                    const inFam = base.filter((x) => !seedFilter || (x.seedOf || '기타') === seedFilter).filter((x) => !subFilter || x.kw.replace(/\s/g, '').includes(subFilter));
                                    const pool = new Set(cands.map((x) => x.kw.replace(/\s/g, '')));
                                    const subs = seedFilter ? subCategories(inFam.map((x) => x.kw), seedFilter, pool) : [];
                                    const sel = 'h-7 rounded border border-[#c4b5fd] bg-white px-1.5 text-[11px] font-bold text-[#6d28d9]';
                                    return (
                                        <span className="inline-flex flex-wrap items-center gap-1">
                                            <select className={sel} value={seedFilter} onChange={(e) => { setSeedFilter(e.target.value); setSubFilter(''); }}>
                                                <option value="">분야 전체 ({base.length})</option>
                                                {[...fam.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => (
                                                    <option key={k} value={k}>{k} ({n})</option>
                                                ))}
                                            </select>
                                            <select className={sel} value={subFilter} disabled={!subs.length}
                                                onChange={(e) => setSubFilter(e.target.value)}>
                                                <option value="">{subs.length ? `세부 전체 (${inFam.length})` : '세부 — 분야 먼저'}</option>
                                                {subs.map((sc) => <option key={sc.label} value={sc.label}>{sc.label} ({sc.count})</option>)}
                                            </select>
                                        </span>
                                    );
                                })()}
                                {/* '~~씨앗' 형태만 — 소자본창업·카페창업 같은 '업종+행위'만 남긴다.
                                    씨앗이 앞에 오는 형태(창업박람회·창업대출)는 정보성이라 결이 다르다. */}
                                <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-[#c4b5fd] px-2 py-0.5 text-[11px] font-bold text-[#6d28d9]">
                                    <input type="checkbox" className="h-3 w-3 accent-[#6d28d9]" checked={endsOnly}
                                        onChange={(e) => setEndsOnly(e.target.checked)} />
                                    “{seed.trim().split(',')[0].trim()}”으로 끝나는 것만
                                </label>
                                {/* 보이는 층 안에서 전체 선택/해제 — 후보가 수백 개라 하나씩 못 누른다. */}
                                {(() => {
                                    const shown = cands.filter((x) => (relTier === 'seed' ? x.tier === 'seed' : relTier === 'near' ? x.tier !== 'far' : true))
                                        .filter((x) => !endsOnly || x.endsSeed)
                                        .filter((x) => !seedFilter || (x.seedOf || '기타') === seedFilter).filter((x) => !subFilter || x.kw.replace(/\s/g, '').includes(subFilter)).slice(0, 200);
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
                                    .filter((x) => !endsOnly || x.endsSeed)
                                    .filter((x) => !seedFilter || (x.seedOf || '기타') === seedFilter).filter((x) => !subFilter || x.kw.replace(/\s/g, '').includes(subFilter))
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
                                {/* ★ 체크한 순서대로 하나씩 끝까지 파고 30건 채우면 멈춘다(process_chain).
                                    각 키워드마다 단독 판정 → 선택한 지역 전수. 사장님 설계 2026-08-11.
                                    예전엔 process_related(전국 판정 + 지역 4~14곳 찔러보기)로 후보만 내고
                                    그 다음에 다시 전수를 돌려야 해서 두 번 눌렀다. */}
                                {/* 지역 미선택이어도 막지 않는다 — 1단계가 전 키워드 단독 판정이라 지역이 안 쓰인다.
                                    2단계에 쓸 지역만 표시해 두고, 필요하면 적재함 패널에서 다시 골라 돌린다. */}
                                {(() => {
                                    const sel = (cands || []).filter((c) => relPicked.has(c.kw)).map((c) => c.kw);
                                    const done = !!scanDone && scanDone.sig === sigOf(sel) && sel.length > 0;
                                    return (
                                        <button type="button" disabled={kwLoading || !relPicked.size}
                                            onClick={() => void runSoloScan(sel)}
                                            className={`h-9 shrink-0 rounded-md px-4 text-sm font-bold text-white disabled:opacity-50 ${done ? 'bg-[#16a34a]' : 'bg-[#7c3aed]'}`}
                                            title={done
                                                ? '이 조합은 이미 다 봤습니다. 더 필요하면 눌러 목표를 올려 이어서 찾습니다.'
                                                : '① 체크한 키워드를 지역 없이 전부 판정 → ② 그 뒤 지역 전수.'}>
                                            {kwLoading ? '찾는 중…'
                                                : !relPicked.size ? '↑ 키워드를 체크하세요'
                                                    : done ? `✓ 찾았습니다 — ${scanDone!.n}건 적재함에 · 다시 찾기`
                                                        : `③ 인기탭 찾기 (지역 없이 ${sel.length}개)`}
                                        </button>
                                    );
                                })()}
                                <span className="text-[11px] text-[#64748b]">
                                    여기서는 <b>지역 없이</b>만 봅니다 — 지역 붙이기는 맨 위 적재함에서.
                                </span>
                                <span className="text-[11px] text-[#64748b]">
                                    {relPicked.size > REL_MAX
                                        ? `⚠ 한 번에 ${REL_MAX}개까지 확인됩니다 — ${relPicked.size - REL_MAX}개는 이번에 안 재집니다.`
                                        : `${relPicked.size}개 확인 · 약 ${Math.max(1, Math.ceil(relPicked.size * 2.5 / 60))}분 소요`}
                                </span>
                            </div>
                        </div>
                    ) : null}

                    {/* (삭제 2026-08-12) '지역을 붙여야 나오는 키워드' 패널 — regionalCands 는 setter 없는
                        useState 라 영원히 [] 였다. 92줄 전체가 도달 불가 코드였다(독립검증 확인).
                        같은 일은 이제 발굴 적재함의 '지역 붙여 더 찾기'가 한다. */}
                </div>
            ) : null}

            {mode === 'related' ? null : mode === 'info' ? (
                /* 정보형 — 플레이스가 없는 업체. 홈페이지·블로그 주소(또는 붙여넣기)에서
                   제품키워드를 만들고, 직접 적은 위치를 축으로 인기탭을 찾는다.
                   ★ 지역형 안에 끼워 두면 '지역형인데 왜 주소를 넣지?'가 된다 — 별도 모드로 둔다. */
                <div className="grid gap-2">
                    {/* 정보형 안의 2번 방법 — 주소에서 원문을 걷어 키워드를 뽑는다. 1번과 같은 적재함에 쌓인다. */}
                    <div className="flex items-center gap-2">
                        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#6d28d9] text-[13px] font-bold text-white">2</span>
                        <b className="text-[13px] text-[#5b21b6]">주소로 찾기</b>
                        <span className="text-[11px] text-[#94a3b8]">홈페이지·블로그 주소 → 키워드 뽑기 → 인기탭 찾기 · 찾은 건 위 적재함에 더 쌓입니다</span>
                    </div>
                    {/* 지역 없는 업체 — 현지(해외)에서 영업하는 곳은 국내 지역축이 성립하지 않는다.
                        보홀 스쿠버다이빙 투어에 '판교 보홀투어'를 붙일 수는 없다. */}
                    <label className="flex w-fit cursor-pointer items-center gap-2 rounded-md border border-[#fbbf24] bg-[#fffbeb] px-3 py-1.5 text-[12px] font-semibold text-[#b45309]">
                        <input type="checkbox" className="h-3.5 w-3.5 accent-[#b45309]" checked={noRegion}
                            onChange={(e) => setNoRegion(e.target.checked)} />
                        🌏 지역 없음 — 전국/해외로 판정 (보홀 다이빙투어·유학원처럼 국내 지역이 없는 업체)
                    </label>
                    {/* 시도 선택 — 없으면 자기 주소 주변만 본다. 고르면 그 시도 전체까지 넓힌다. */}
                    <div className={`flex flex-wrap gap-2 ${noRegion ? 'pointer-events-none opacity-40' : ''}`}>
                        {REGION_KEYS.map((r) => (
                            <button key={r} type="button" onClick={() => toggleRegion(r)}
                                className={`rounded-full border px-3 py-1 text-sm font-semibold ${regionSel.includes(r) ? 'border-[#4338ca] bg-[#4338ca] text-white' : 'border-[#cbd5e1] bg-white text-[#475569]'}`}>{r}</button>
                        ))}
                        <span className="self-center text-[11px] text-[#64748b]">선택 안 하면 아래 위치 주변만 봅니다</span>
                    </div>
                    <div className="rounded-md border border-dashed border-[#c4b5fd] bg-white/60 px-3 py-2">
                        <div className="text-[12px] font-bold text-[#6d28d9]">🌐 홈페이지·블로그 주소 → 키워드 → 인기탭</div>
                        <div className="mt-2 grid gap-2">
                            <input className={`${inputCls} ${noRegion ? 'pointer-events-none opacity-40' : ''}`} value={addr} onChange={(e) => setAddr(e.target.value)}
                                placeholder={noRegion ? '지역 없음 — 위치를 적지 않습니다' : "위치 (예: 전북 군산시 옥도면 선유남길 19-9 — 읍·면·도로명까지 적으면 더 정확)"} />
                            {/* 주소 한 줄로 원문을 걷는 경로 — 고객에게 "소개글을 붙여넣으세요"라고 하면 대부분 인사말만 넣는다. */}
                            <div className="flex flex-wrap items-center gap-2">
                                <textarea className="min-h-[38px] w-full min-w-[240px] flex-1 rounded-md border border-[#cbd5e1] px-3 py-2 text-sm outline-none focus:border-[#7c3aed]" rows={2}
                                    value={siteUrl} onChange={(e) => setSiteUrl(e.target.value)}
                                    placeholder={'홈페이지·네이버 블로그 주소 — 여러 개면 줄바꿈으로 (둘 다 넣는 게 가장 좋습니다)\nblog.naver.com/gyeonggi22\ngyeongginurse.co.kr'} />
                                <button type="button" onClick={() => void pullSite()} disabled={!!extracting || kwLoading}
                                    className="h-9 shrink-0 rounded-md border border-[#6d28d9] bg-white px-3 text-sm font-bold text-[#6d28d9] disabled:opacity-50"
                                    title="블로그면 글 제목 전량을, 홈페이지면 하위 페이지까지 가져와 아래 칸에 합쳐 넣습니다">
                                    ⬇ 주소로 가져오기
                                </button>
                            </div>
                            <p className="mb-0 -mt-1 text-[11px] text-[#7c3aed]">
                                💡 <b>사이트와 블로그를 같이 넣으세요</b> — 실측상 블로그만 28개 · 홈페이지만 28개인데
                                둘을 합치면 <b>39개</b>가 나옵니다(블로그=증상별, 홈페이지=처치별로 갈립니다).
                                블로그 쪽이 더 정확하니 하나만 있다면 블로그를 넣으세요.
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
                    </div>
                </div>
            ) : mode === 'region' ? (
                <div className="grid gap-2">
                    <div className="flex flex-wrap gap-2">
                        {REGION_KEYS.map((r) => (
                            <button key={r} type="button" onClick={() => toggleRegion(r)}
                                className={`rounded-full border px-3 py-1 text-sm font-semibold ${regionSel.includes(r) ? 'border-[#4338ca] bg-[#4338ca] text-white' : 'border-[#cbd5e1] bg-white text-[#475569]'}`}>{r}</button>
                        ))}
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <input className={`${inputCls} flex-1 min-w-[160px]`} value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="제품 키워드 (예: 입주청소, 출장뷔페 — 여러 개는 쉼표)" />
                        {/* 목표 채우기 — 연관형에만 있던 흐름을 이쪽(제품 키워드 직접 입력)에도 붙인다(사장님 2026-08-12).
                            ① 지역 없이 그대로 판정(공장청소) → ② 그 뒤 지역 전수(수원 공장청소…) → 30건 채우면 멈춤 → ＋10.
                            '지역 키워드 생성'(region: 경로)은 단독 판정이 없어 전국형을 통째로 놓쳤다. */}
                        <button type="button"
                            onClick={() => void runChain(keyword.split(',').map((k) => k.trim()).filter(Boolean))}
                            disabled={kwLoading || dongLoading || !keyword.trim()}
                            className="h-10 shrink-0 rounded-md bg-[#16a34a] px-4 text-sm font-bold text-white disabled:opacity-50"
                            title={`① 지역 없이 먼저 → ② 그 뒤 ${(regionSel.length ? regionSel : CHAIN_DEFAULT_REGIONS).join('·')} 전수. 30건 채우면 멈추고 ＋10으로 이어서.`}>
                            {kwLoading ? '찾는 중…' : `🎯 인기탭 찾기 (${FIRST_TARGET}건)`}
                        </button>
                        <button type="button" onClick={() => void genRegionKeywords()} disabled={kwLoading || dongLoading} className="h-10 shrink-0 rounded-md border border-[#c4b5fd] bg-white px-4 text-sm font-bold text-[#6d28d9] disabled:opacity-50" title="지역 × 제품키워드 조합만 만듭니다(단독 판정 없음). 예전 방식.">{kwLoading ? '생성 중…' : '지역 키워드 생성'}</button>
                        {/* +N 더 찾기 — target 을 올려 이어서 스캔. 이미 판정된 조합은 캐시 히트라 즉시 통과하고
                            새 구간만 라이브로 본다. 한 번에 전수를 돌지 않아 빠르고 차단 예산도 아낀다. */}
                        {kwResult && kwResult.length > 0 && (
                            <button type="button" onClick={() => {
                                const t = regionTarget + MORE_STEP;
                                const ls = lastScanRef.current;
                                if (ls?.kind === 'chain') { void runChain(ls.products, t); return; }
                                // 새로고침으로 메모리 기록이 비면 저장분 → 적재함 순으로 되짚는다.
                                //   (안 그러면 지역형 경로로 빠져 '제품 키워드를 추가하세요'로 조용히 막힌다)
                                const saved = loadLastChain(clientId || 'me');
                                if (saved.length) { void runChain(saved, t); return; }
                                const solo = pool.filter((k) => isSoloKw(k.keyword)).map((k) => k.keyword);
                                if (solo.length) { void runChain(solo, t); return; }
                                void runRegion(false, t);
                            }} disabled={kwLoading || dongLoading}
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
                            <span className="flex shrink-0 items-center gap-2">
                                {pct !== null ? <span>{pct}%</span> : null}
                                {/* 중단 — 지금 도는 1건은 끝나지만(워커 루프라 중간에 못 끊는다) 대기분은 즉시 취소된다. */}
                                <button type="button" onClick={() => void stopScan()} disabled={stopping}
                                    className="rounded border border-[#fca5a5] bg-white px-2 py-0.5 text-[11px] font-bold text-[#dc2626] hover:bg-[#fef2f2] disabled:opacity-50"
                                    title="대기 중인 키워드를 취소합니다. 지금 처리 중인 1건은 끝까지 갑니다.">
                                    {stopping ? '중단 중…' : '⏹ 중단'}
                                </button>
                            </span>
                        </div>
                        <div className="h-2.5 w-full overflow-hidden rounded-full bg-[#e9d5ff]">
                            <div className={`h-full rounded-full bg-[#7c3aed] ${pct === null ? 'animate-pulse' : 'transition-all duration-500'}`} style={{ width: `${pct ?? 25}%` }} />
                        </div>
                        {/* 찾는 즉시 아래 목록에 쌓인다 — 끝날 때까지 기다리지 않아도 된다. */}
                        <div className="mt-1.5 text-[11px] text-[#7c3aed]">
                            {kwResult?.length
                                ? <>✔ 지금까지 <b>{kwResult.length}개</b> 찾았습니다 — 아래에 실시간으로 쌓입니다. 스캔 중에도 골라 두셔도 됩니다.</>
                                : '찾는 즉시 아래에 하나씩 쌓입니다.'}
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
                    <div className="mb-1.5 flex flex-wrap items-center gap-2 text-[11px] font-semibold text-[#4338ca]">
                        <span>담아둔 키워드 {kwPicked.length}개 — 다시 조회해도 지워지지 않습니다</span>
                        <button type="button"
                            onClick={() => downloadCsv(`담은키워드_${todayTag()}`, ['키워드', '검색량', '테마'],
                                kwPicked.map((p) => [p.keyword, p.volume ?? '', p.theme ?? '']))}
                            className="rounded border border-[#c7d2fe] bg-white px-2 py-0.5 text-[11px] font-bold text-[#4338ca]">⬇ 엑셀로 받기</button>
                        {/* 발행 전 재확인 — 5~6일 지난 양성의 10%가 죽어 있다(SUB4 실측). 30건이면 30콜. */}
                        <button type="button" onClick={() => void runRecheck()} disabled={!!recheckBusy}
                            className="rounded border border-[#16a34a] bg-white px-2 py-0.5 text-[11px] font-bold text-[#16a34a] disabled:opacity-50"
                            title="지금도 인기탭이 있는지 라이브로 다시 봅니다. 팔기 직전에 한 번 눌러 주세요.">
                            {recheckBusy ? '확인 중…' : '✅ 발행 전 재확인'}
                        </button>
                        <button type="button"
                            onClick={() => { if (confirm(`담아둔 ${kwPicked.length}개를 모두 비웁니다. 계속할까요?`)) setKwPicked([]); }}
                            className="rounded border border-[#fca5a5] bg-white px-2 py-0.5 text-[11px] font-bold text-[#dc2626]">전부 비우기</button>
                        {recheckDead.length ? (
                            <button type="button"
                                onClick={() => { setKwPicked((prev) => prev.filter((p) => !recheckDead.includes(p.keyword))); setRecheckDead([]); }}
                                className="rounded bg-[#dc2626] px-2 py-0.5 text-[11px] font-bold text-white">
                                안 되는 {recheckDead.length}건 빼기
                            </button>
                        ) : null}
                        <span className="font-normal text-[#818cf8]">
                            {recheckBusy ? `🔎 ${recheckBusy}` : '다른 조건으로 계속 조회해 쌓으세요 — 30일 보관.'}
                        </span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                        {kwPicked.map((p) => (
                            <span key={p.keyword} className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[12px] font-semibold ring-1 ${recheckDead.includes(p.keyword) ? 'bg-[#fef2f2] text-[#dc2626] ring-[#fca5a5] line-through' : 'bg-white text-[#3730a3] ring-[#c7d2fe]'}`}>
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
                    {/* 찾은 것에 지역 붙이기 — "단독으로 되는 걸 찾았으면 지역까지 파 달라"(사장님 2026-08-12).
                        ⚠️ 지역이 이미 붙은 결과(수원 ○○)는 대상이 아니다 — 워커가 지역을 또 곱하지 않고
                          (_product_place_head 로 '수원 안양 ○○' 방지) 단독만 보는데 그건 이미 캐시라 아무 일도 안 난다.
                          그래서 '지역 없는 단독 히트'만 골라 되먹인다. 없으면 버튼 자체를 띄우지 않는다. */}
                    {(() => {
                        const soloHits = visible.filter((k) => !k.keyword.includes(' '));
                        if (!soloHits.length || !regionSel.length) return null;
                        return (
                            <div className="mb-1.5 flex flex-wrap items-center gap-2 rounded-md border border-[#16a34a] bg-[#f0fdf4] px-2 py-1.5">
                                <span className="text-[12px] font-bold text-[#15803d]">📍 지역 없이 잡힌 {soloHits.length}개에 지역 붙여 더 찾기</span>
                                <span className="text-[11px] text-[#4d7c0f]">{soloHits.slice(0, 3).map((k) => k.keyword).join(' · ')}{soloHits.length > 3 ? ` 외 ${soloHits.length - 3}` : ''} × {regionSel.join('·')} 전 지역</span>
                                <button type="button" disabled={kwLoading || dongLoading}
                                    onClick={() => void runChain(soloHits.map((k) => k.keyword), regionTarget + MORE_STEP)}
                                    className="ml-auto shrink-0 rounded bg-[#16a34a] px-3 py-1 text-[11px] font-bold text-white disabled:opacity-50">
                                    {kwLoading ? '찾는 중…' : '지역까지 찾기 →'}
                                </button>
                            </div>
                        );
                    })()}
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
