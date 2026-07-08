import { useEffect, useState } from 'react';
import {
    extractBlogId,
    extractLogNo,
    todayKST,
    updatePostKeyword,
    updatePostMeasurements,
    type BlogAccount,
    type BlogMeasurement,
    type BlogPost,
} from '../../../api/blogRank';
import { searchRankPC } from '../../../api/rankSearch';

// 전역 쿨다운 — 검색/수정(저장)/재검색을 누르면 잠깐 텀(여러 명이 동시에 써도 네이버 차단 예방).
//   모든 글 행(PostSearchCell)이 공유 → 한 번 측정하면 전체에서 COOLDOWN 동안 다음 측정 막힘.
const COOLDOWN_MS = 6000;
let _coolUntil = 0;
const _coolSubs = new Set<() => void>();
function startMeasureCooldown(): void {
    _coolUntil = Date.now() + COOLDOWN_MS;
    _coolSubs.forEach((f) => f());
}
function useCooldownLeft(): number {
    const [, force] = useState(0);
    useEffect(() => {
        const f = () => force((n) => n + 1);
        _coolSubs.add(f);
        const iv = setInterval(f, 500);
        return () => {
            _coolSubs.delete(f);
            clearInterval(iv);
        };
    }, []);
    return Math.max(0, Math.ceil((_coolUntil - Date.now()) / 1000));
}

export function PostSearchCell({
    account,
    post,
    onSaved,
    hideEdit = false,
}: {
    account: BlogAccount | null;
    post: BlogPost;
    onSaved: () => Promise<void>;
    hideEdit?: boolean; // 기자단/고객 뷰(읽기 전용) — '수정' 버튼 숨김
}) {
    const [kw, setKw] = useState('');
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState('');
    // 자동키워드 수동 수정
    const effectiveKw = post.keyword_manual || post.keyword || '';
    const [editing, setEditing] = useState(false);
    const [editVal, setEditVal] = useState(effectiveKw);
    const [saving, setSaving] = useState(false);
    const coolLeft = useCooldownLeft(); // 전역 쿨다운 남은 초(>0이면 측정 버튼 잠금)
    const cooling = coolLeft > 0;

    if (!account) {
        return <span className="text-xs text-[#94a3b8]">—</span>;
    }
    const blogId = account.blog_id || extractBlogId(account.blog_url);

    // 검색 = 입력 키워드로 이 글을 측정해 '우측 통합탭/블로그탭(저장값)'에 바로 반영.
    //   (키워드 자체는 저장 안 함 — 그건 '수정'. 다음 자동 크롤은 기존 키워드로 측정.)
    const run = async () => {
        const q = kw.trim();
        if (!q || !blogId) {
            return;
        }
        setBusy(true);
        setErr('');
        try {
            // 이 '글' 단위로 측정(블로그탭은 logNo 매칭).
            const r = await searchRankPC(q, blogId, extractLogNo(post.post_url || ''));
            const today = todayKST();
            const next: BlogMeasurement[] = [
                ...post.measurements.filter((m) => m.date !== today),
                { date: today, ti: r.ti, ti_status: r.ti_status, bl: r.bl, bl_status: r.bl_status },
            ];
            await updatePostMeasurements(post.id, next);
            await onSaved(); // 우측 순위(저장값) 즉시 갱신
        } catch (e) {
            setErr(e instanceof Error ? e.message : '검색 실패');
        } finally {
            setBusy(false);
            startMeasureCooldown();
        }
    };

    const saveKeyword = async () => {
        setSaving(true);
        setErr('');
        // 1) 키워드 먼저 무조건 저장(측정 실패해도 저장은 유지).
        const { error } = await updatePostKeyword(post.id, editVal);
        if (error) {
            setErr(error.message || '키워드 저장 실패');
            setSaving(false);
            return; // 저장 실패 시 편집창 유지
        }
        // 2) 저장된 실효 키워드로 즉시 재측정해 통합탭/블로그탭 반영.
        const effective = editVal.trim() || post.keyword || '';
        const prevEffective = post.keyword_manual || post.keyword || '';
        const keywordChanged = effective !== prevEffective;
        const today = todayKST();
        // 키워드가 바뀌면 이전 키워드의 측정 이력은 버린다(서로 다른 키워드 순위로 delta 비교되는 오류 방지).
        let next: BlogMeasurement[] = keywordChanged
            ? []
            : post.measurements.filter((m) => m.date !== today);
        let measured = false;
        if (effective && blogId) {
            try {
                const r = await searchRankPC(effective, blogId, extractLogNo(post.post_url || ''));
                next = [
                    ...next,
                    { date: today, ti: r.ti, ti_status: r.ti_status, bl: r.bl, bl_status: r.bl_status },
                ];
                measured = true;
            } catch (e) {
                setErr(`키워드 저장됨 · 측정 실패: ${e instanceof Error ? e.message : ''}`);
            }
        }
        // 측정 성공했거나(레코드 추가) 키워드가 바뀌어 이력을 비웠으면 measurements 영속화.
        if (measured || keywordChanged) {
            await updatePostMeasurements(post.id, next);
        }
        startMeasureCooldown();
        setSaving(false);
        setEditing(false);
        await onSaved();
    };

    // 재검색 = 현재 저장된 키워드로 다시 측정해 '옆 순위(저장값)'를 갱신(키워드는 그대로). 옛 크롤값이 낡았을 때 새로고침.
    const reSearch = async () => {
        const effective = effectiveKw;
        if (!effective || !blogId) {
            return;
        }
        setBusy(true);
        setErr('');
        try {
            const r = await searchRankPC(effective, blogId, extractLogNo(post.post_url || ''));
            const today = todayKST();
            const next: BlogMeasurement[] = [
                ...post.measurements.filter((m) => m.date !== today),
                { date: today, ti: r.ti, ti_status: r.ti_status, bl: r.bl, bl_status: r.bl_status },
            ];
            await updatePostMeasurements(post.id, next);
            await onSaved(); // 옆 순위(저장값) 갱신
        } catch (e) {
            setErr(e instanceof Error ? e.message : '재검색 실패');
        } finally {
            setBusy(false);
            startMeasureCooldown();
        }
    };

    return (
        <div className="min-w-[300px]">
            {editing ? (
                <div className="flex gap-1">
                    <input
                        aria-label="자동키워드 수정"
                        autoFocus
                        className="h-11 w-full min-w-0 rounded-md border border-[#a78bfa] bg-white px-2.5 text-sm"
                        onChange={(e) => setEditVal(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && void saveKeyword()}
                        placeholder="자동키워드 직접 입력"
                        value={editVal}
                    />
                    <button
                        className="flex h-11 shrink-0 items-center justify-center whitespace-nowrap rounded-md bg-[#7c3aed] px-4 text-sm font-semibold text-white disabled:opacity-50"
                        disabled={saving || cooling}
                        onClick={() => void saveKeyword()}
                        type="button"
                    >
                        {saving ? '측정 중…' : cooling ? `${coolLeft}s` : '저장'}
                    </button>
                    <button
                        className="flex h-11 shrink-0 items-center justify-center whitespace-nowrap rounded-md border border-[#cbd5e1] bg-white px-3 text-sm font-semibold text-[#475569]"
                        onClick={() => {
                            setEditing(false);
                            setEditVal(effectiveKw);
                        }}
                        type="button"
                    >
                        취소
                    </button>
                </div>
            ) : (
                <div className="flex gap-1">
                    <input
                        aria-label="키워드 직접 검색"
                        className="h-11 w-full min-w-0 rounded-md border border-[#cbd5e1] bg-white px-2.5 text-sm"
                        onChange={(e) => setKw(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && void run()}
                        placeholder="키워드 직접 검색"
                        value={kw}
                    />
                    <button
                        className="flex h-11 shrink-0 items-center justify-center whitespace-nowrap rounded-md bg-[#1e40af] px-4 text-sm font-semibold text-white disabled:opacity-50"
                        disabled={busy || cooling || !kw.trim()}
                        onClick={() => void run()}
                        title="이 글이 입력 키워드로 몇 위인지 즉시 검색(통합탭·블로그탭 모두 '이 글' 기준)"
                        type="button"
                    >
                        {busy ? '…' : cooling ? `${coolLeft}s` : '검색'}
                    </button>
                    {!hideEdit ? (
                        <button
                            className="flex h-11 shrink-0 items-center justify-center whitespace-nowrap rounded-md bg-[#7c3aed] px-4 text-sm font-semibold text-white"
                            onClick={() => {
                                setEditVal(effectiveKw);
                                setEditing(true);
                            }}
                            title="이 글의 자동키워드를 직접 수정(다음 자동 측정도 이 값으로 유지) — 우측 순위 즉시 반영"
                            type="button"
                        >
                            수정
                        </button>
                    ) : null}
                    <button
                        className="flex h-11 shrink-0 items-center justify-center whitespace-nowrap rounded-md bg-[#0f766e] px-4 text-sm font-semibold text-white disabled:opacity-50"
                        disabled={busy || cooling || !effectiveKw}
                        onClick={() => void reSearch()}
                        title="현재 (수동) 키워드로 다시 측정해 우측 순위(저장값)를 바로 갱신"
                        type="button"
                    >
                        {busy ? '…' : cooling ? `${coolLeft}s` : '재검색'}
                    </button>
                </div>
            )}
            {post.keyword_manual ? (
                <div className="mt-1 text-[12px] font-semibold text-[#7c3aed]">수동 키워드 #{post.keyword_manual}</div>
            ) : null}
            {err ? <div className="mt-1 text-[10px] text-[#dc2626]">{err}</div> : null}
        </div>
    );
}
