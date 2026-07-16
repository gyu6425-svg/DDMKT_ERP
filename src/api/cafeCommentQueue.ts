import { supabase } from '../lib/supabase';

// 카페 댓글 자동화 대기열 — 웹 '댓글 예약' → cafe_comment_queue 적재.
//   로컬 데몬(crawler/cafe_cmt/comment_listener.py)이 폴링해 대상 글에 댓글을 작성.
//   발행(cafePublishQueue)과 동형이나 이미지 없이 텍스트만.

export type CommentJob = {
    id: string;
    article_url: string;
    body: string;
    status: 'pending' | 'processing' | 'done' | 'fail';
    posted_url: string | null;
    reason: string | null;
    created_at: string;
    done_at: string | null;
};

// 댓글 예약 등록 — 대상 글 주소 + 댓글 본문을 큐에 insert.
export async function createCommentJob(input: { articleUrl: string; body: string }) {
    const jobId = crypto.randomUUID();
    const articleUrl = input.articleUrl.trim();
    const body = input.body.trim();
    if (!articleUrl || !body) {
        return { error: { message: '글 주소와 댓글 내용을 모두 입력하세요.' }, jobId: null };
    }
    const { error } = await supabase.from('cafe_comment_queue').insert({
        id: jobId,
        article_url: articleUrl,
        body,
        status: 'pending',
    });
    if (error) return { error: error as { message: string }, jobId: null };
    return { error: null, jobId };
}

// 댓글 큐 현황(내부) — 최근순.
export async function listCommentJobs(limit = 20) {
    const { data, error } = await supabase
        .from('cafe_comment_queue')
        .select('id,article_url,body,status,posted_url,reason,created_at,done_at')
        .order('created_at', { ascending: false })
        .limit(limit);
    return { data: (data ?? []) as CommentJob[], error };
}
