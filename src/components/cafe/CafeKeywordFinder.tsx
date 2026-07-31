import { useEffect, useState } from 'react';
import { enqueuePlaceScan, pollPlaceScan, getRegionDongs, type KwResult } from '../../api/cafeKwScan';
import { getClientPublishedKeywords } from '../../api/cafeDeployRequests';

// 공용 '인기탭 키워드 찾기' — 접수(CafeDeployIntake)와 동일 UX.
//   지역형: 시도 선택 + 제품키워드 → 검색량 조회 / 고정 동마스터로 동×키워드 생성.
//   키워드형: 플레이스 주소 → 검색량 조회 / SUB4 워커 정확 인기탭 분석(최대 50, 큐 처리).
//   선택(복수·× 제외·이미 발행분 중복제외) → onPick 으로 상위(발행 스튜디오)에 전달.
export function CafeKeywordFinder({
    clientId,
    mode,
    onPick,
}: {
    clientId: string | null;
    mode: 'region' | 'keyword';
    onPick: (keywords: string[], productKeyword: string) => void;
}) {
    const REGION_KEYS = ['서울', '경기', '인천'] as const;
    const [keyword, setKeyword] = useState('');   // 지역형=제품키워드 / 키워드형=참고
    const [url, setUrl] = useState('');            // 키워드형 플레이스 주소
    const [regionSel, setRegionSel] = useState<string[]>([]);
    const inputCls = 'h-10 w-full rounded-md border border-[#cbd5e1] px-3 text-sm outline-none focus:border-[#4338ca]';

    // 검색량(연관어) 조회
    const [vol, setVol] = useState<{ keyword: string; total: number }[] | null>(null);
    const [volLoading, setVolLoading] = useState(false);
    // 정확 인기탭 / 지역 키워드 결과
    const [kwResult, setKwResult] = useState<KwResult[] | null>(null);
    const [kwLoading, setKwLoading] = useState(false);
    const [kwExpanded, setKwExpanded] = useState(false);
    const [kwErr, setKwErr] = useState('');
    const [kwHidden, setKwHidden] = useState<string[]>([]);
    const [kwPicked, setKwPicked] = useState<KwResult[]>([]);
    const [usedKw, setUsedKw] = useState<Set<string>>(new Set());
    const normKw = (s: string) => (s || '').trim().replace(/\s+/g, ' ');

    useEffect(() => { onPick(kwPicked.map((k) => k.keyword), keyword.trim()); }, [kwPicked, keyword, onPick]);
    useEffect(() => {
        let alive = true;
        void (async () => {
            const pub = clientId ? await getClientPublishedKeywords(clientId) : [];
            if (alive) setUsedKw(new Set(pub.map(normKw).filter(Boolean)));
        })();
        return () => { alive = false; };
    }, [clientId]);

    const togglePick = (k: KwResult) =>
        setKwPicked((prev) => (prev.some((p) => p.keyword === k.keyword) ? prev.filter((p) => p.keyword !== k.keyword) : [...prev, k]));
    const hideKw = (kw: string) => {
        setKwHidden((prev) => (prev.includes(kw) ? prev : [...prev, kw]));
        setKwPicked((prev) => prev.filter((p) => p.keyword !== kw));
    };
    const toggleRegion = (r: string) => setRegionSel((cur) => (cur.includes(r) ? cur.filter((x) => x !== r) : [...cur, r]));

    const lookupVolume = async () => {
        let api: string;
        if (mode === 'keyword') {
            const u = url.trim();
            if (!u) { setKwErr('플레이스 주소를 입력하세요.'); return; }
            api = `https://ddmkt-erp.pages.dev/api/place-keywords?url=${encodeURIComponent(u)}`;
        } else {
            const q = keyword.trim();
            if (!q) { setKwErr('제품 키워드를 입력하세요. 예: 입주청소'); return; }
            api = `https://ddmkt-erp.pages.dev/api/naver-keywords?q=${encodeURIComponent(q)}`;
        }
        setKwErr(''); setVolLoading(true); setVol(null);
        try {
            const d = await (await fetch(api)).json();
            setVol((d.keywords || []).slice(0, 20).map((k: { keyword: string; total?: number }) => ({ keyword: k.keyword, total: k.total ?? 0 })));
        } catch (e) {
            setKwErr(e instanceof Error ? e.message : '조회 실패');
        } finally { setVolLoading(false); }
    };

    // 키워드형 — SUB4 워커 정확 인기탭 분석(최대 target). '더 보기' 로 50까지.
    const runPlaceScan = async (target = 10) => {
        const u = url.trim();
        if (!u) { setKwErr('플레이스 주소를 입력하세요.'); return; }
        setKwErr(''); setKwLoading(true);
        if (target <= 10) { setKwResult(null); setKwExpanded(false); setKwHidden([]); setKwPicked([]); }
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

    // 지역형 — 고정 동마스터에서 선택 시도의 동 × 제품키워드 생성.
    const genRegionKeywords = async () => {
        const kw = keyword.trim();
        if (!kw) { setKwErr('제품 키워드를 입력하세요. 예: 입주청소'); return; }
        if (!regionSel.length) { setKwErr('지역(서울/경기/인천)을 선택하세요.'); return; }
        setKwErr(''); setKwLoading(true); setKwResult(null); setKwExpanded(false); setKwHidden([]); setKwPicked([]);
        try {
            const dongs = await getRegionDongs(regionSel);
            const seen = new Set<string>();
            const list: KwResult[] = [];
            for (const d of dongs) {
                const k = `${d.dong} ${kw}`;
                if (seen.has(k)) continue;
                seen.add(k);
                list.push({ keyword: k, theme: `${d.sido} ${d.gu}`, cafes: [] });
            }
            if (!list.length) throw new Error('해당 지역 동 데이터가 없습니다.');
            setKwResult(list);
        } catch (e) {
            setKwErr(e instanceof Error ? e.message : '생성 실패');
        } finally { setKwLoading(false); }
    };

    const visible = (kwResult || []).filter((k) => !kwHidden.includes(k.keyword));
    const fresh = visible.filter((k) => !usedKw.has(normKw(k.keyword)));
    const used = visible.filter((k) => usedKw.has(normKw(k.keyword)));

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
                    <div className="flex flex-wrap gap-2">
                        <input className={`${inputCls} flex-1 min-w-[160px]`} value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="제품 키워드 (예: 입주청소)" />
                        <button type="button" onClick={() => void lookupVolume()} disabled={volLoading} className="h-10 shrink-0 rounded-md bg-[#0369a1] px-4 text-sm font-bold text-white disabled:opacity-50">{volLoading ? '조회 중…' : '검색량 조회'}</button>
                        <button type="button" onClick={() => void genRegionKeywords()} disabled={kwLoading} className="h-10 shrink-0 rounded-md bg-[#7c3aed] px-4 text-sm font-bold text-white disabled:opacity-50">{kwLoading ? '생성 중…' : '지역 키워드 생성'}</button>
                    </div>
                </div>
            ) : (
                <div className="flex flex-wrap gap-2">
                    <input className={`${inputCls} flex-1 min-w-[200px]`} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="플레이스 주소 (https://naver.me/… )" />
                    <button type="button" onClick={() => void lookupVolume()} disabled={volLoading} className="h-10 shrink-0 rounded-md bg-[#0369a1] px-4 text-sm font-bold text-white disabled:opacity-50">{volLoading ? '조회 중…' : '인기글 조회'}</button>
                    <button type="button" onClick={() => void runPlaceScan()} disabled={kwLoading} className="h-10 shrink-0 rounded-md bg-[#7c3aed] px-4 text-sm font-bold text-white disabled:opacity-50">{kwLoading ? '분석 중…' : '정확 인기탭 분석'}</button>
                </div>
            )}
            {kwErr ? <p className="mb-0 mt-1 text-[12px] text-[#dc2626]">{kwErr}</p> : null}

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
                            <div className="mb-1 text-[10px] font-semibold text-[#94a3b8]">이미 발행한 키워드 {used.length}개 — 중복 제외</div>
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
