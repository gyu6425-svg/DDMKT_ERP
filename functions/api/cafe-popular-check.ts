// 카페 인기글 검사(배포 CF) — PC 통합검색(search.naver.com) 리뷰 부트스트랩 방식.
//   고객 지역형 스캔(src/api/cafeWriter.checkPopular)이 이 엔드포인트를 부른다.
//   ★ Cloudflare(CF) 경유 = sub2 로컬 IP 가 아닌 CF IP 로 네이버 조회 → main 크롤러 IP 충돌 회피.
//   로직은 로컬 dev(scripts/openai-card-image-api.mjs)와 동일 모듈(functions/lib/cafePopular.mjs) 사용.
import { hasPopularPc } from '../lib/cafePopular.mjs';

type FunctionContext = { request: Request };

function jsonResponse(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        status,
    });
}

export async function onRequestPost({ request }: FunctionContext) {
    let keyword = '';
    try {
        const body = (await request.json()) as { keyword?: string };
        keyword = String(body?.keyword || '').trim();
    } catch {
        // 본문 파싱 실패 → 아래 keyword 빈값으로 처리
    }
    if (!keyword) return jsonResponse({ message: 'keyword 가 필요합니다.' }, 400);
    try {
        const { hasPopular, reason } = await hasPopularPc(keyword);
        return jsonResponse({ keyword, hasPopular, reason });
    } catch (e) {
        // 호출부(checkPopular)는 res.ok 를 기대하므로, 실패도 200 으로 돌려 '없음' 취급되게 한다.
        return jsonResponse({ keyword, hasPopular: false, reason: 'serp_fetch_failed', message: String((e as Error)?.message || e) });
    }
}
