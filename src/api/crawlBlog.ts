// 서버리스 크롤 트리거 — 블로그 1개의 RSS 동기화 + ti/bl 측정 + 기록(터미널 없이).
export type CrawlResult = {
    blogAccountId: string;
    blogId: string;
    postsMeasured: number;
    keywordsMeasured: number;
    errors: string[];
};

function getUrl(): string {
    if (import.meta.env.DEV) {
        return 'http://127.0.0.1:8787/api/crawl-blog';
    }
    return '/api/crawl-blog';
}

export async function crawlBlog(blogAccountId: string): Promise<CrawlResult> {
    const res = await fetch(getUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blogAccountId }),
    });
    const text = await res.text();
    let data: CrawlResult & { error?: string };
    try {
        data = JSON.parse(text);
    } catch {
        throw new Error('서버 응답 파싱 실패');
    }
    if (!res.ok) {
        throw new Error(data.error || '측정 실패');
    }
    return data;
}
