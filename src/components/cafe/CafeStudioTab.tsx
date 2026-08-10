import { useEffect, useState } from 'react';
import { checkPopular } from '../../api/cafeWriter';
import { queueNusu2, nusu2Health, fetchDongs } from '../../api/nusu2Bridge';
import { REGION_GROUPS, type RegionSet } from './regions';

// 발행 스튜디오 (신규 · 격리 탭) — 두 종류의 "타겟 축"을 인기탭 기반으로 발굴한다.
//   ● 지역형: {지역} {키워드} 인기탭 조회(누수탐지·입주청소 등 지역 업종)
//   ● 키워드형: seed 키워드의 연관키워드(naver-keywords, 검색량순) → 인기탭 조회(향수 등 온라인판매)
// 인기탭 조회는 순수 키워드라 두 모드 동일 메커니즘(cafe-popular-check). 통과 타겟만 발행 단계로.
// ⚠️ 인기탭 조회=네이버라 sub2(개발PC)에선 차단될 수 있음 — 실제는 배포/업체 PC에서 동작.

type Mode = 'region' | 'keyword';
type Status = '대기' | '검사중' | '통과' | '없음' | '오류';
type Granularity = 'si' | 'sigu' | 'sigudong';
type Target = { label: string; level?: '시' | '구' | '동'; volume?: number; comp?: string; status: Status; reason?: string };

const KW_API = 'https://ddmkt-erp.pages.dev/api/naver-keywords';

export function CafeStudioTab() {
    const [mode, setMode] = useState<Mode>('keyword');
    const [seed, setSeed] = useState('');          // 키워드형 seed(예: 향수) / 지역형 결합 키워드(예: 누수탐지)
    const [regionSet, setRegionSet] = useState<RegionSet>('서울');
    const [granularity, setGranularity] = useState<Granularity>('sigu');  // 지역형 계층: 시 / 시+구 / 시+구+동
    const [minVol, setMinVol] = useState(0);       // 키워드형 최소 검색량 필터
    const [count, setCount] = useState(5);         // 발행 건수
    const [targets, setTargets] = useState<Target[]>([]);
    const [busy, setBusy] = useState(false);
    const [abort, setAbort] = useState(false);
    const [msg, setMsg] = useState('');
    // 발행 대상(지역형 nusu2) — 브릿지로 큐 적재
    const [company, setCompany] = useState('leak');
    const [board, setBoard] = useState('누수');
    const [bridgeUp, setBridgeUp] = useState<boolean | null>(null);
    useEffect(() => { void nusu2Health().then(setBridgeUp); }, []);

    const probeOf = (label: string) => (mode === 'region' ? `${label} ${seed}`.trim() : label);
    const passed = targets.filter((t) => t.status === '통과');

    // ── 키워드형: seed → 연관키워드 확장(검색량순) ──
    const expandKeywords = async () => {
        if (!seed.trim()) return setMsg('seed 키워드를 입력하세요 (예: 향수)');
        setBusy(true); setMsg(''); setTargets([]);
        try {
            const res = await fetch(`${KW_API}?q=${encodeURIComponent(seed.trim())}`);
            const data = await res.json();
            if (!res.ok) throw new Error((data && data.error) || `오류 ${res.status}`);
            const rows = ((data && data.keywords) || []) as Array<{ keyword: string; total: number; comp: string }>;
            const core = seed.replace(/\s/g, '').slice(0, 2);
            const on = rows.filter((r) => r.keyword && r.keyword.includes(core));
            const list: Target[] = (on.length ? on : rows)
                .filter((r) => (r.total || 0) >= minVol)
                .slice(0, 50)
                .map((r) => ({ label: r.keyword, volume: r.total, comp: r.comp, status: '대기' }));
            setTargets(list);
            setMsg(`연관키워드 ${list.length}개 (검색량순) — "인기탭 스캔"으로 필터`);
        } catch (e) {
            setMsg(`확장 실패: ${e instanceof Error ? e.message : String(e)}`);
        } finally {
            setBusy(false);
        }
    };

    // ── 지역형: 지역셋 → 계층 후보(시 / 시+구 / 시+구+동) ──
    //   시 먼저, (서울 자치구는) 구 형태, 필요시 동까지. 스캔이 각 레벨 인기탭을 확인해 통과 레벨을 보여준다.
    const buildRegionTargets = async () => {
        if (!seed.trim()) return setMsg('결합 키워드를 입력하세요 (예: 누수탐지)');
        setBusy(true); setMsg('후보 생성 중…');
        const out: Target[] = [];
        for (const r of REGION_GROUPS[regionSet]) {
            out.push({ label: r.label, level: '시', status: '대기' });
            if (granularity !== 'si') {
                const { dongs, gu } = await fetchDongs(r.label);
                for (const g of gu) if (g !== r.label) out.push({ label: g, level: '구', status: '대기' });
                if (granularity === 'sigudong') for (const d of dongs) out.push({ label: d, level: '동', status: '대기' });
            }
        }
        const seen = new Set<string>();
        const dedup = out.filter((t) => (seen.has(t.label) ? false : (seen.add(t.label), true)));
        setTargets(dedup);
        setBusy(false);
        setMsg(`후보 ${dedup.length}개 (시/구/동) — "인기탭 스캔"으로 통과 레벨 확인`);
    };

    // ── 인기탭 스캔 (두 모드 공통) ──
    //   차단 회피: 키워드 사이 지터 딜레이(≈2~4s) + 6건마다 긴 휴식 + '차단' 감지 시 스캔 중단(백오프).
    //   ('blocked' 는 '없음'과 구분 — 차단을 '없음'으로 오보하면 그 지역/키워드를 영영 버리게 됨)
    const runScan = async () => {
        if (!targets.length) return;
        setBusy(true); setAbort(false);
        const rows = [...targets];
        let done = 0;
        let blockedStop = false;
        for (let i = 0; i < rows.length; i += 1) {
            if (abort) break;
            rows[i] = { ...rows[i], status: '검사중' };
            setTargets([...rows]);
            try {
                const { hasPopular, reason } = await checkPopular(probeOf(rows[i].label));
                if (reason === 'blocked' || reason === 'crawler_busy') {
                    rows[i] = { ...rows[i], status: '오류', reason: reason === 'crawler_busy' ? '크롤러 활성(같은망) — 스캔 보류. 크롤 유휴시간에 다시' : '네이버 차단 감지 — 스캔 중단(잠시 후 재시도)' };
                    setTargets([...rows]);
                    blockedStop = true;
                    break;
                }
                rows[i] = { ...rows[i], status: hasPopular ? '통과' : '없음', reason };
            } catch (e) {
                rows[i] = { ...rows[i], status: '오류', reason: e instanceof Error ? e.message : '' };
            }
            setTargets([...rows]);
            done += 1;
            // 다음 키워드까지 지터 딜레이(차단 회피). 6건마다 긴 휴식.
            if (i < rows.length - 1 && !abort) {
                const rest = done % 6 === 0 ? 30000 + Math.random() * 15000 : 1500 + Math.random() * 2000;
                setMsg(`스캔 중… ${done}/${rows.length}${done % 6 === 0 ? ' (차단회피 휴식)' : ''}`);
                await new Promise((res) => setTimeout(res, rest));
            }
        }
        setBusy(false);
        const pass = rows.filter((r) => r.status === '통과').length;
        setMsg(blockedStop ? `네이버 차단 감지 — ${done}건까지 스캔 후 중단(통과 ${pass}). 잠시 후 재시도하세요` : `인기탭 통과 ${pass} / ${rows.length}`);
    };

    // ── 발행 (지역형 nusu2 브릿지) ── 키워드형은 업체별 생성기 필요(추후)
    const publish = async () => {
        if (mode !== 'region') return setMsg('키워드형 발행은 업체별 생성기 연결 후 지원 예정(현재는 타겟 발굴까지)');
        const pick = passed.slice(0, count);
        if (!pick.length) return setMsg('통과 타겟이 없습니다');
        if (!(await nusu2Health())) { setBridgeUp(false); return setMsg('브릿지(8788) 꺼짐 — run_nusu2_api.bat 실행'); }
        setBusy(true); setAbort(false);
        const rows = [...targets];
        let queued = 0;
        for (const t of pick) {
            if (abort) break;
            const idx = rows.findIndex((r) => r.label === t.label);
            rows[idx] = { ...rows[idx], reason: 'nusu2 생성·큐 등록중…' };
            setTargets([...rows]);
            try {
                const r = await queueNusu2({ region: t.label, kind: 'nusu', company, board });
                rows[idx] = { ...rows[idx], reason: `큐 등록 ✓ ${r.title}` };
                queued += 1;
            } catch (e) {
                rows[idx] = { ...rows[idx], reason: `실패: ${e instanceof Error ? e.message : ''}` };
            }
            setTargets([...rows]);
        }
        setBusy(false);
        setMsg(`발행 큐 적재 ${queued}건`);
    };

    return (
        <div className="grid gap-4">
            <div className="rounded-xl border-2 border-[#7c3aed] bg-[#faf5ff] p-4">
                <div className="mb-2 flex items-center gap-2 text-[13px] font-bold text-[#6d28d9]">
                    🎯 발행 스튜디오 <span className="rounded bg-[#7c3aed] px-1.5 py-0.5 text-[10px] text-white">신규</span>
                    <span className="text-[11px] font-normal text-[#94a3b8]">인기탭 기반 타겟 발굴 → 발행</span>
                </div>

                {/* 모드 토글 */}
                <div className="mb-3 inline-flex overflow-hidden rounded-md border border-[#c4b5fd]">
                    {(['keyword', 'region'] as Mode[]).map((m) => (
                        <button
                            className={`px-3 py-1.5 text-[12px] font-semibold ${mode === m ? 'bg-[#7c3aed] text-white' : 'bg-white text-[#6d28d9]'}`}
                            key={m}
                            onClick={() => { setMode(m); setTargets([]); setMsg(''); }}
                            type="button"
                        >
                            {m === 'keyword' ? '키워드형 (온라인판매·향수 등)' : '지역형 (누수·청소 등)'}
                        </button>
                    ))}
                </div>

                {/* 입력 */}
                <div className="grid gap-2 sm:grid-cols-2">
                    <label className="grid gap-1">
                        <span className="text-[12px] font-semibold text-[#475569]">{mode === 'keyword' ? 'seed 키워드 (예: 향수)' : '결합 키워드 (예: 누수탐지)'}</span>
                        <input className="h-9 rounded-md border border-[#cbd5e1] bg-white px-2.5 text-sm" onChange={(e) => setSeed(e.target.value)} placeholder={mode === 'keyword' ? '향수' : '누수탐지'} value={seed} />
                    </label>
                    {mode === 'region' ? (
                        <label className="grid gap-1">
                            <span className="text-[12px] font-semibold text-[#475569]">지역셋</span>
                            <select className="h-9 rounded-md border border-[#cbd5e1] bg-white px-2 text-sm" onChange={(e) => setRegionSet(e.target.value as RegionSet)} value={regionSet}>
                                {(['서울', '경기', '인천', '전체'] as RegionSet[]).map((g) => <option key={g} value={g}>{g} ({REGION_GROUPS[g].length})</option>)}
                            </select>
                        </label>
                    ) : (
                        <label className="grid gap-1">
                            <span className="text-[12px] font-semibold text-[#475569]">최소 검색량</span>
                            <input className="h-9 rounded-md border border-[#cbd5e1] bg-white px-2.5 text-sm" min={0} onChange={(e) => setMinVol(Math.max(0, Number(e.target.value) || 0))} type="number" value={minVol} />
                        </label>
                    )}
                </div>

                {/* 액션 */}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                    {mode === 'keyword' ? (
                        <button className="h-9 rounded-md bg-[#0369a1] px-4 text-sm font-bold text-white hover:bg-[#075985] disabled:opacity-50" disabled={busy} onClick={() => void expandKeywords()} type="button">🔍 연관키워드 확장</button>
                    ) : (
                        <>
                            <select className="h-9 rounded-md border border-[#cbd5e1] bg-white px-2 text-[13px]" onChange={(e) => setGranularity(e.target.value as Granularity)} value={granularity}>
                                <option value="si">시 단위</option>
                                <option value="sigu">시 + 구</option>
                                <option value="sigudong">시 + 구 + 동</option>
                            </select>
                            <button className="h-9 rounded-md bg-[#0369a1] px-4 text-sm font-bold text-white hover:bg-[#075985] disabled:opacity-50" disabled={busy} onClick={() => void buildRegionTargets()} type="button">지역 후보 생성</button>
                        </>
                    )}
                    {targets.length ? <button className="h-9 rounded-md bg-[#7c3aed] px-4 text-sm font-bold text-white hover:bg-[#6d28d9] disabled:opacity-50" disabled={busy} onClick={() => void runScan()} type="button">인기탭 스캔</button> : null}
                    {busy ? <button className="h-9 rounded-md border border-[#dc2626] px-3 text-sm font-semibold text-[#dc2626]" onClick={() => setAbort(true)} type="button">중단</button> : null}
                    {msg ? <span className="text-[12px] text-[#6d28d9]">{msg}</span> : null}
                </div>
                <div className="mt-2 text-[11px] text-[#a78bfa]">※ 인기탭 조회 = 네이버 검색. sub2(개발PC)에선 차단될 수 있고, 실제 발행/업체 PC에서 동작합니다.</div>
            </div>

            {/* 타겟 목록 */}
            {targets.length ? (
                <div className="rounded-lg border border-[#e2e8f0] bg-white p-2">
                    <div className="mb-1 flex items-center justify-between px-1 text-[12px] text-[#64748b]">
                        <span>타겟 {targets.length} · 통과 {passed.length}</span>
                        <span>{mode === 'keyword' ? '검색량 · 경쟁도 · 인기탭' : '인기탭'}</span>
                    </div>
                    <div className="max-h-[300px] overflow-y-auto">
                        {targets.map((t) => (
                            <div className="flex items-center justify-between border-b border-[#f1f5f9] px-1 py-1 text-[12px] last:border-0" key={t.label}>
                                <span className="flex items-center gap-1.5 font-semibold text-[#334155]">
                                    {t.level ? <span className={`rounded px-1 py-0.5 text-[10px] ${t.level === '시' ? 'bg-[#dbeafe] text-[#1e40af]' : t.level === '구' ? 'bg-[#e0e7ff] text-[#4338ca]' : 'bg-[#ede9fe] text-[#6d28d9]'}`}>{t.level}</span> : null}
                                    {t.status === '통과' ? '✓ ' : ''}{t.label}
                                </span>
                                <span className="flex items-center gap-2">
                                    {t.volume != null ? <span className="text-[#64748b]">월 {t.volume.toLocaleString()}</span> : null}
                                    {t.comp ? <span className="text-[#94a3b8]">경쟁 {t.comp}</span> : null}
                                    <span className={t.status === '통과' ? 'font-bold text-[#1d4ed8]' : t.status === '검사중' ? 'text-[#854d0e]' : t.status === '오류' ? 'text-[#991b1b]' : 'text-[#cbd5e1]'}>{t.reason && t.reason.startsWith('큐') ? t.reason : t.status}</span>
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            ) : null}

            {/* 발행 (지역형) */}
            {passed.length ? (
                <div className="rounded-lg border-2 border-[#0f766e] bg-[#f0fdfa] p-3">
                    <div className="mb-2 text-[13px] font-bold text-[#0f766e]">발행 — 통과 타겟 {passed.length}개 중 상위 {count}건</div>
                    <div className="flex flex-wrap items-end gap-2">
                        <label className="grid gap-1">
                            <span className="text-[11px] text-[#475569]">company</span>
                            <input className="h-8 w-28 rounded border border-[#cbd5e1] px-2 text-sm" onChange={(e) => setCompany(e.target.value)} value={company} />
                        </label>
                        <label className="grid gap-1">
                            <span className="text-[11px] text-[#475569]">게시판(board)</span>
                            <input className="h-8 w-40 rounded border border-[#cbd5e1] px-2 text-sm" onChange={(e) => setBoard(e.target.value)} value={board} />
                        </label>
                        <label className="grid gap-1">
                            <span className="text-[11px] text-[#475569]">건수</span>
                            <input className="h-8 w-16 rounded border border-[#cbd5e1] px-2 text-sm" min={1} onChange={(e) => setCount(Math.max(1, Number(e.target.value) || 1))} type="number" value={count} />
                        </label>
                        <button className="h-9 rounded-md bg-[#0f766e] px-4 text-sm font-bold text-white hover:bg-[#115e59] disabled:opacity-50" disabled={busy || mode !== 'region' || bridgeUp === false} onClick={() => void publish()} type="button">nusu2 발행</button>
                        {bridgeUp === false ? <span className="text-[12px] text-[#dc2626]">브릿지(8788) 꺼짐</span> : bridgeUp ? <span className="text-[12px] text-[#0f766e]">브릿지 ✓</span> : null}
                    </div>
                    {mode === 'keyword' ? <div className="mt-2 text-[11px] text-[#b45309]">키워드형 발행은 업체별 생성기(자산·프롬프트) 연결 후 지원 — 현재는 타겟 발굴까지.</div> : null}
                </div>
            ) : null}
        </div>
    );
}
