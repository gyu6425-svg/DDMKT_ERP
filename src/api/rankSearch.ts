// 순위 즉시검색 — 서버리스 /api/rank 호출(서버가 네이버 측정, 브라우저 CORS 우회).
export type RankSearchResult = {
    keyword: string;
    blogId: string;
    ti: number;
    ti_status: 'ok' | 'out' | 'fail';
    bl: number;
    bl_status: 'ok' | 'out' | 'fail';
};

function getUrl(): string {
    // DEV 는 로컬 API 서버(:8787) 직접 호출, PROD 는 동일 출처 함수.
    if (import.meta.env.DEV) {
        return 'http://127.0.0.1:8787/api/rank';
    }
    return '/api/rank';
}

export async function searchRank(
    keyword: string,
    blogId: string,
    logNo = '',
    signal?: AbortSignal,
): Promise<RankSearchResult> {
    const res = await fetch(getUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword, blogId, logNo }),
        signal,
    });
    const text = await res.text();
    let data: RankSearchResult & { error?: string };
    try {
        data = JSON.parse(text);
    } catch {
        throw new Error('서버 응답 파싱 실패');
    }
    if (!res.ok) {
        throw new Error(data.error || '검색 실패');
    }
    return data;
}
