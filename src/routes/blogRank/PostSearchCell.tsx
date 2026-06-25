import { useState } from 'react';
import {
    extractBlogId,
    extractLogNo,
    todayKST,
    updatePostKeyword,
    updatePostMeasurements,
    type BlogAccount,
    type BlogMeasurement,
    type BlogPost,
} from '../../api/blogRank';
import { searchRankPC, type RankSearchResult } from '../../api/rankSearch';
import { fmtRank } from './helpers';

export function PostSearchCell({
    account,
    post,
    onSaved,
}: {
    account: BlogAccount | null;
    post: BlogPost;
    onSaved: () => Promise<void>;
}) {
    const [kw, setKw] = useState('');
    const [busy, setBusy] = useState(false);
    const [res, setRes] = useState<RankSearchResult | null>(null);
    const [err, setErr] = useState('');
    // 자동키워드 수동 수정
    const effectiveKw = post.keyword_manual || post.keyword || '';
    const [editing, setEditing] = useState(false);
    const [editVal, setEditVal] = useState(effectiveKw);
    const [saving, setSaving] = useState(false);

    if (!account) {
        return <span className="text-xs text-[#94a3b8]">—</span>;
    }
    const blogId = account.blog_id || extractBlogId(account.blog_url);

    const run = async () => {
        const q = kw.trim();
        if (!q || !blogId) {
            return;
        }
        setBusy(true);
        setErr('');
        try {
            // 이 '글' 단위로 측정(블로그탭은 logNo 매칭) — 6월글이면 6월글 순위, 5월글이면 5월글 순위.
            setRes(await searchRankPC(q, blogId, extractLogNo(post.post_url || '')));
        } catch (e) {
            setErr(e instanceof Error ? e.message : '검색 실패');
            setRes(null);
        } finally {
            setBusy(false);
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
        setSaving(false);
        setEditing(false);
        await onSaved();
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
                        disabled={saving}
                        onClick={() => void saveKeyword()}
                        type="button"
                    >
                        {saving ? '측정 중…' : '저장'}
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
                        disabled={busy || !kw.trim()}
                        onClick={() => void run()}
                        title="이 글이 입력 키워드로 몇 위인지 즉시 검색(통합탭·블로그탭 모두 '이 글' 기준)"
                        type="button"
                    >
                        {busy ? '…' : '검색'}
                    </button>
                    <button
                        className="flex h-11 shrink-0 items-center justify-center whitespace-nowrap rounded-md bg-[#7c3aed] px-4 text-sm font-semibold text-white"
                        onClick={() => {
                            setEditVal(effectiveKw);
                            setEditing(true);
                        }}
                        title="이 글의 자동키워드를 직접 수정(다음 자동 측정도 이 값으로 유지)"
                        type="button"
                    >
                        수정
                    </button>
                </div>
            )}
            {post.keyword_manual ? (
                <div className="mt-1 text-[12px] font-semibold text-[#7c3aed]">수동 키워드 #{post.keyword_manual}</div>
            ) : null}
            {res ? (
                <div className="mt-1 text-[11px] font-semibold text-[#0f172a]">
                    <span className="text-[#94a3b8]">#{res.keyword}</span> · 통합{' '}
                    <span className="text-[#059669]">{fmtRank(res.ti, res.ti_status)}</span>
                    <span className="text-[9px] font-normal text-[#94a3b8]">(이 글)</span> · 블로그탭{' '}
                    <span className="text-[#1e40af]">{fmtRank(res.bl, res.bl_status)}</span>
                    <span className="text-[9px] font-normal text-[#94a3b8]">(이 글)</span>
                </div>
            ) : err ? (
                <div className="mt-1 text-[10px] text-[#dc2626]">{err}</div>
            ) : null}
        </div>
    );
}
