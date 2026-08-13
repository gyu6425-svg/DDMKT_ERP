import { useMemo, useState } from 'react';
import { addToPool, isSoloKw, loadPoolKw, savePoolKw, type KwResult } from '../../api/cafeKwScan';
import { downloadCsv, todayTag } from '../../lib/exportCsv';

// 발굴 적재함 — 모드(정보형·연관형·지역형·키워드형)를 오가며 찾아낸 인기탭 키워드를 한곳에 쌓아 보여준다.
//   ★ 왜(사장님 요청 2026-08-12): 조회를 새로 하면 아래 결과 목록이 그 회차 중심으로 바뀌어,
//     "지금까지 통틀어 뭘 얼마나 찾았나"가 안 보였다. 그걸 위에 고정으로 띄운다.
//   ★ 핵심 기능: 여기서 '지역 없이 잡힌 것'만 골라 지역을 붙여 더 찾는다(목표채우기 = 워커 process_chain).
//     지역이 이미 붙은 키워드는 워커가 또 곱하지 않으므로(_product_place_head) 되먹임 대상에서 뺀다.
//   ★ 지역 칩은 이 패널 전용이다 — 아래 접수 폼의 지역 선택과 따로 고를 수 있어야 한다는 요청.
export const POOL_REGION_KEYS = ['서울', '경기', '인천', '대전', '세종', '충북', '충남', '강원',
    '전북', '전남', '광주', '대구', '경북', '경남', '부산', '울산', '제주'] as const;

export function CafeKwPool({
    who,
    rows,
    onChange,
    onRunChain,
    busy = false,
    onPick,
    isUsed,
}: {
    who: string;                                     // 업체 키(client_id) — 업체별로 따로 쌓는다
    rows: KwResult[];                                // 적재함 내용(부모가 들고 있어야 스캔 결과와 동기화된다)
    onChange: (next: KwResult[]) => void;
    onRunChain: (keywords: string[], regions: string[]) => void;
    busy?: boolean;
    onPick?: (rows: KwResult[]) => void;             // 보관함(발행 대상)으로 담기
    // 이미 발행·선택한 키워드 — 아래 결과 목록을 없앴으므로 중복 방지 표시를 여기로 옮겼다.
    isUsed?: (kw: string) => boolean;
}) {
    const [open, setOpen] = useState(true);
    const [sel, setSel] = useState<Set<string>>(new Set());
    const [regions, setRegions] = useState<string[]>(['서울', '경기', '인천']);
    const [soloOnly, setSoloOnly] = useState(true);

    const solo = useMemo(() => rows.filter((r) => isSoloKw(r.keyword)), [rows]);
    const withRegion = rows.length - solo.length;
    const view = soloOnly ? solo : rows;
    // 되먹임 대상 = 고른 것 중 단독만. 아무것도 안 골랐으면 단독 전체.
    const targets = useMemo(() => {
        const picked = solo.filter((r) => sel.has(r.keyword));
        return (picked.length ? picked : solo).map((r) => r.keyword);
    }, [solo, sel]);

    const toggle = (kw: string) => setSel((prev) => {
        const n = new Set(prev);
        if (n.has(kw)) n.delete(kw); else n.add(kw);
        return n;
    });
    const toggleRegion = (r: string) => setRegions((prev) => (prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]));
    const clearAll = () => {
        if (!window.confirm(`적재함 ${rows.length}개를 모두 비웁니다. 계속할까요?\n(판정 결과는 서버에 남아 있어 다시 조회하면 즉시 나옵니다)`)) return;
        savePoolKw(who, []);
        onChange([]);
        setSel(new Set());
    };

    if (!rows.length) return null;

    return (
        <div className="mb-3 rounded-xl border-2 border-[#7c3aed] bg-[#faf5ff] p-3">
            <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => setOpen((v) => !v)} className="flex items-center gap-1.5 text-[13px] font-bold text-[#6d28d9]">
                    <span className={`text-[10px] transition-transform ${open ? 'rotate-90' : ''}`}>▶</span>
                    📦 발굴 적재함 {rows.length}개
                </button>
                <span className="rounded-full bg-[#ede9fe] px-2 py-0.5 text-[11px] font-bold text-[#6d28d9]">지역 없이 {solo.length}</span>
                {withRegion ? <span className="rounded-full bg-[#f1f5f9] px-2 py-0.5 text-[11px] font-semibold text-[#64748b]">지역형 {withRegion}</span> : null}
                {/* 상한에 닿으면 조용히 자르지 않고 알린다 — 검색량 낮은 것부터 밀려난다(독립검증 지적 2026-08-12). */}
                {rows.length >= 600 ? (
                    <span className="rounded bg-[#fef2f2] px-2 py-0.5 text-[11px] font-bold text-[#dc2626]"
                        title="브라우저 저장 한도 방어로 600개까지만 남깁니다. 검색량이 낮은 것부터 밀려납니다 — 쓸 것은 미리 보관함에 담아 두세요.">
                        ⚠ 상한 600 도달 — 검색량 낮은 것부터 밀려납니다
                    </span>
                ) : null}
                <span className="text-[11px] text-[#94a3b8]">모드를 바꿔 조회해도 계속 쌓입니다 · 업체별 30일 보관</span>
                <span className="ml-auto flex items-center gap-1.5">
                    {onPick ? (
                        <button type="button" onClick={() => onPick(view.filter((r) => (!sel.size || sel.has(r.keyword)) && !(isUsed?.(r.keyword))))}
                            className="rounded border border-[#4338ca] bg-white px-2 py-1 text-[11px] font-bold text-[#4338ca] hover:bg-[#eef2ff]">
                            {sel.size ? `고른 ${sel.size}개 담기` : `보이는 ${view.length}개 담기`}
                        </button>
                    ) : null}
                    <button type="button"
                        onClick={() => downloadCsv(`발굴적재함_${todayTag()}`, ['키워드', '검색량', '테마'], rows.map((r) => [r.keyword, r.volume ?? '', r.theme ?? '']))}
                        className="rounded border border-[#16a34a] bg-white px-2 py-1 text-[11px] font-bold text-[#15803d] hover:bg-[#f0fdf4]">⬇ 엑셀</button>
                    <button type="button" onClick={clearAll}
                        className="rounded border border-[#fca5a5] bg-white px-2 py-1 text-[11px] font-bold text-[#dc2626] hover:bg-[#fef2f2]">비우기</button>
                </span>
            </div>

            {open ? (
                <>
                    {/* 지역 붙여 더 찾기 — 이 패널 전용 지역 칩으로 목표채우기(chain)를 돌린다. */}
                    <div className="mt-2 rounded-lg border border-[#16a34a] bg-[#f0fdf4] p-2">
                        <div className="flex flex-wrap items-center gap-2">
                            <span className="text-[12px] font-bold text-[#15803d]">📍 지역 붙여 더 찾기</span>
                            <span className="text-[11px] text-[#4d7c0f]">
                                지역 없이 잡힌 것에만 지역을 붙입니다 — 대상 <b>{targets.length}개</b>
                                {sel.size ? ' (아래에서 고른 것)' : ' (지역 없이 잡힌 것 전부)'}
                            </span>
                            <button type="button" disabled={busy || !targets.length || !regions.length}
                                onClick={() => onRunChain(targets, regions)}
                                className="ml-auto shrink-0 rounded bg-[#16a34a] px-3 py-1.5 text-[12px] font-bold text-white disabled:opacity-50">
                                {busy ? '찾는 중…' : !regions.length ? '↑ 지역을 고르세요' : `지역까지 찾기 (${targets.length}개) →`}
                            </button>
                        </div>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1">
                            <span className="mr-1 text-[11px] font-semibold text-[#4d7c0f]">지역</span>
                            {POOL_REGION_KEYS.map((r) => (
                                <button key={r} type="button" onClick={() => toggleRegion(r)}
                                    className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${regions.includes(r)
                                        ? 'border-[#15803d] bg-[#15803d] text-white' : 'border-[#bbf7d0] bg-white text-[#15803d]'}`}>{r}</button>
                            ))}
                            {regions.length ? (
                                <button type="button" onClick={() => setRegions([])} className="ml-1 text-[11px] text-[#94a3b8] hover:text-[#dc2626]">전부 해제</button>
                            ) : null}
                        </div>
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                        <label className="flex cursor-pointer items-center gap-1.5 font-semibold text-[#6d28d9]">
                            <input type="checkbox" className="h-3.5 w-3.5 accent-[#6d28d9]" checked={soloOnly} onChange={(e) => setSoloOnly(e.target.checked)} />
                            지역 없이 잡힌 것만 보기
                        </label>
                        <button type="button" onClick={() => setSel(sel.size === view.length ? new Set() : new Set(view.map((r) => r.keyword)))}
                            className="rounded border border-[#c4b5fd] bg-white px-2 py-0.5 font-bold text-[#6d28d9]">
                            {sel.size === view.length ? '전체 해제' : `전체 선택 (${sel.size}/${view.length})`}
                        </button>
                    </div>

                    <div className="mt-1.5 flex max-h-56 flex-wrap gap-1.5 overflow-y-auto">
                        {view.map((r) => {
                            const on = sel.has(r.keyword);
                            const used = !!isUsed?.(r.keyword);
                            return (
                                <label key={r.keyword}
                                    title={(r.cafes ?? []).slice(0, 5).map((c) => `${c.rank}위 ${c.who}`).join(' · ') || undefined}
                                    className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-semibold ${used
                                        ? 'border-[#e2e8f0] bg-[#f8fafc] text-[#94a3b8] line-through'
                                        : on ? 'border-[#6d28d9] bg-[#ede9fe] text-[#5b21b6]' : 'border-[#e2e8f0] bg-white text-[#475569]'}`}>
                                    <input type="checkbox" className="h-3 w-3 accent-[#6d28d9]" checked={on} onChange={() => toggle(r.keyword)} disabled={used} />
                                    {r.keyword}
                                    {/* ★ 반드시 모바일(m.search) — 인기글 섹션은 PC 와 모바일이 다르다. */}
                                    <a href={`https://m.search.naver.com/search.naver?query=${encodeURIComponent(r.keyword)}`}
                                        target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
                                        title={`모바일 검색결과 열기 — ${r.keyword}`}
                                        className="text-[10px] font-normal text-[#0369a1] hover:underline">확인↗</a>
                                    {/* 검색량 10 = 검색광고 API 최저값 = 사실상 검색 없음. 거르진 않고 눈에만 띄게. */}
                                    <span className={`text-[10px] font-normal ${(r.volume ?? 0) <= 10 ? 'text-[#dc2626]' : 'text-[#94a3b8]'}`}>
                                        {(r.volume ?? 0) <= 10 ? '검색량 없음' : (r.volume ?? 0).toLocaleString()}
                                    </span>
                                </label>
                            );
                        })}
                    </div>
                </>
            ) : null}
        </div>
    );
}

// 부모가 쓰기 쉬우라고 같이 내보낸다 — 스캔 결과를 적재함에 더하고 최신 목록을 돌려준다.
export { addToPool, loadPoolKw };
