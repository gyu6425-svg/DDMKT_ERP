// 이미지 스토어(R2) — 카페 배너·실사사진을 Cloudflare R2 로 서빙/업로드해 Supabase Egress 를 없앤다.
//   R2 = 다운로드(egress) 무료 + CF CDN 캐시. GET 은 공개(긴 캐시), PUT 은 로그인 사용자만.
//   URL: /api/img/<bucket>/<path...>   (bucket = cafe-images | deploy-intake, R2 키 = "<bucket>/<path>")
//   바인딩(대시보드 설정 필요): IMG_BUCKET(R2). 폴백용 env: SUPABASE_URL, SUPABASE_SERVICE_KEY.
//   폴백: R2 에 아직 없는 옛 이미지는 Supabase 서명URL 로 302 (마이그레이션 완료 후 제거 가능).
type R2Obj = { body: ReadableStream; httpEtag: string; writeHttpMetadata: (h: Headers) => void };
type R2Bucket = {
    get: (k: string) => Promise<R2Obj | null>;
    put: (k: string, v: ArrayBuffer | ReadableStream, o?: { httpMetadata?: { contentType?: string } }) => Promise<unknown>;
};
type Env = {
    IMG_BUCKET: R2Bucket;
    SUPABASE_URL?: string;
    SUPABASE_SERVICE_KEY?: string;
    SUPABASE_ANON_KEY?: string;
};
type Ctx = { request: Request; env: Env; params: { path?: string | string[] } };

const ALLOW = new Set(['cafe-images', 'deploy-intake']);
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,PUT,OPTIONS', 'Access-Control-Allow-Headers': 'authorization, content-type, x-content-type' };

function keyOf(params: { path?: string | string[] }): string {
    const p = params.path;
    return Array.isArray(p) ? p.join('/') : String(p || '');
}

export function onRequestOptions() {
    return new Response(null, { status: 204, headers: cors });
}

// 서빙 — R2 우선, 없으면 Supabase 서명URL 로 폴백(옛 이미지).
export async function onRequestGet({ params, env }: Ctx) {
    const key = keyOf(params);
    if (!key) return new Response('missing key', { status: 400, headers: cors });
    const obj = await env.IMG_BUCKET.get(key);
    if (obj) {
        const headers = new Headers(cors);
        obj.writeHttpMetadata(headers);
        // ★ immutable 은 '이 URL 의 내용은 절대 안 바뀐다'는 약속이다. 발행용 생성 이미지는 이름이
        //   매번 달라 참이지만, 스튜디오 설정 이미지는 예전에 kind_idx.jpg 라는 고정 이름을 썼다.
        //   그래서 새 배너를 덮어써도 브라우저·CDN 이 1년 동안 옛 이미지를 계속 내줬다
        //   (2026-08-11 SUB2 신고). 지금은 업로드마다 고유 이름을 쓰지만, 이미 저장된 옛 고정이름
        //   파일들이 남아 있으므로 이 경로만 짧게 잡고 ETag 로 재검증한다(304 라 비용 거의 0).
        const mutable = key.includes('/studio-settings/');
        headers.set('Cache-Control', mutable
            ? 'public, max-age=300, must-revalidate'
            : 'public, max-age=31536000, immutable');
        headers.set('ETag', obj.httpEtag);
        return new Response(obj.body, { headers });
    }
    // 폴백: "<bucket>/<path>" → Supabase 서명URL 302 (마이그레이션 중 옛 이미지)
    const slash = key.indexOf('/');
    const bucket = slash > 0 ? key.slice(0, slash) : '';
    const path = slash > 0 ? key.slice(slash + 1) : '';
    if (ALLOW.has(bucket) && env.SUPABASE_URL && env.SUPABASE_SERVICE_KEY) {
        try {
            const r = await fetch(`${env.SUPABASE_URL}/storage/v1/object/sign/${bucket}/${path}`, {
                method: 'POST',
                headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ expiresIn: 3600 }),
            });
            if (r.ok) {
                const d = (await r.json()) as { signedURL?: string };
                if (d.signedURL) return Response.redirect(`${env.SUPABASE_URL}/storage/v1${d.signedURL}`, 302);
            }
        } catch { /* 폴백 실패 → 404 */ }
    }
    return new Response('not found', { status: 404, headers: cors });
}

// 업로드 — 로그인 사용자만(Supabase 토큰 검증). body = 이미지 바이트.
export async function onRequestPut({ request, params, env }: Ctx) {
    const key = keyOf(params);
    const slash = key.indexOf('/');
    const bucket = slash > 0 ? key.slice(0, slash) : '';
    if (!ALLOW.has(bucket)) return new Response('bad bucket', { status: 400, headers: cors });
    // 인증 — Authorization: Bearer <supabase access token> 검증. apikey 는 anon 없으면 service_key 로 대체.
    const auth = request.headers.get('authorization') || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    const apikey = env.SUPABASE_ANON_KEY || env.SUPABASE_SERVICE_KEY;
    if (!token || !env.SUPABASE_URL || !apikey) return new Response('unauthorized', { status: 401, headers: cors });
    const who = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey, Authorization: `Bearer ${token}` } });
    if (!who.ok) return new Response('unauthorized', { status: 401, headers: cors });
    const contentType = request.headers.get('x-content-type') || request.headers.get('content-type') || 'image/jpeg';
    const buf = await request.arrayBuffer();
    if (!buf.byteLength) return new Response('empty', { status: 400, headers: cors });
    await env.IMG_BUCKET.put(key, buf, { httpMetadata: { contentType } });
    // 저장된 바이트 수를 돌려준다 — 호출부가 보낸 크기와 대조해 '올라간 척'을 걸러낸다(SUB2 요청).
    return new Response(JSON.stringify({ ok: true, key, size: buf.byteLength }),
        { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } });
}
