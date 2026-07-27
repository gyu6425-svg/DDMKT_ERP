import { useEffect, useState } from 'react';
import {
    cafeTodayKST,
    setCafeKeywordManual,
    setCafeMeasurements,
    type CafeMeasurement,
    type CafeRankPost,
} from '../../../api/cafeRank';
import { searchCafeRankPC } from '../../../api/cafeRankSearch';

// 카페 순위 재검색 셀 — 블로그 PostSearchCell 과 동일 UX(키워드 수정 + 재검색). 카페는 순위 1종(인기글).
//   전역 쿨다운: 여러 행/사용자가 동시에 눌러도 네이버 차단 예방(블로그와 별도 타이머).
const COOLDOWN_MS = 6000;
let _coolUntil = 0;
const _coolSubs = new Set<() => void>();
function startCooldown(): void {
    _coolUntil = Date.now() + COOLDOWN_MS;
    _coolSubs.forEach((f) => f());
}
function useCooldownLeft(): number {
    const [, force] = useState(0);
    useEffect(() => {
        const f = () => force((n) => n + 1);
        _coolSubs.add(f);
        return () => { _coolSubs.delete(f); };
    }, []);
    const left = Math.max(0, Math.ceil((_coolUntil - Date.now()) / 1000));
    useEffect(() => {
        if (left <= 0) return;
        const iv = setInterval(() => force((n) => n + 1), 500);
        return () => clearInterval(iv);
    }, [left <= 0]);
    return left;
}

export function CafeSearchCell({
    post,
    external = false,
    onSaved,
}: {
    post: CafeRankPost;
    external?: boolean;
    onSaved: () => Promise<void> | void;
}) {
    const effectiveKw = post.keyword_manual || post.keyword || '';
    const [val, setVal] = useState(effectiveKw);
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState('');
    const coolLeft = useCooldownLeft();
    const cooling = coolLeft > 0;

    useEffect(() => { setVal(effectiveKw); }, [effectiveKw]);

    if (external) {
        return <span className="text-[12px] text-[#475569]">{effectiveKw || '—'}</span>;
    }

    // 재검색 = (수정한) 키워드 저장 후 즉시 측정 → 오늘자 순위 갱신. 측정불가 키워드를 다른 키워드로 바꿔 재측정할 때 씀.
    const reSearch = async () => {
        const kw = val.trim();
        if (!kw || busy || cooling) return;
        setBusy(true); setErr('');
        try {
            const prevEffective = post.keyword_manual || post.keyword || '';
            if (kw !== prevEffective) await setCafeKeywordManual(post.id, kw); // 바뀌었으면 저장
            const r = await searchCafeRankPC(kw, post.cafe_name, post.article_id, post.club_id);
            const today = cafeTodayKST();
            // 키워드가 바뀌면 이전 이력은 버림(다른 키워드 순위와 delta 비교 방지).
            const base = kw !== prevEffective ? [] : (post.measurements || []).filter((m) => m.date !== today);
            const next: CafeMeasurement[] = [...base, { date: today, ti: r.ti, ti_status: r.ti_status }];
            const { error } = await setCafeMeasurements(post.id, next);
            if (error) throw new Error(error.message);
            await onSaved();
        } catch (e) {
            setErr(e instanceof Error ? e.message : '재검색 실패');
        } finally {
            setBusy(false);
            startCooldown();
        }
    };

    return (
        <div className="min-w-[190px]">
            <div className="flex gap-1">
                <input
                    aria-label="측정 키워드"
                    className="h-8 w-full min-w-0 rounded border border-[#cbd5e1] bg-white px-2 text-[12px]"
                    onChange={(e) => setVal(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && void reSearch()}
                    placeholder="측정 키워드"
                    value={val}
                />
                <button
                    className="flex h-8 shrink-0 items-center justify-center whitespace-nowrap rounded-md bg-[#0f766e] px-3 text-[12px] font-semibold text-white disabled:opacity-50"
                    disabled={busy || cooling || !val.trim()}
                    onClick={() => void reSearch()}
                    title="이 키워드로 즉시 재측정해 순위를 갱신(키워드가 바뀌면 저장도 함께). PC 리스너 필요"
                    type="button"
                >
                    {busy ? '측정 중…' : cooling ? `${coolLeft}s` : '재검색'}
                </button>
            </div>
            {post.keyword_manual ? (
                <div className="mt-0.5 text-[11px] font-semibold text-[#7c3aed]">수동 #{post.keyword_manual}</div>
            ) : null}
            {err ? <div className="mt-0.5 text-[10px] text-[#dc2626]">{err}</div> : null}
        </div>
    );
}
