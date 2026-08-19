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
    // 이전(컷오버) 기간 전용 — 두 번째로 허용할 백엔드. 둘 중 아무 토큰이나 통과시킨다.
    SUPABASE_URL_ALT?: string;
    SUPABASE_SERVICE_KEY?: string;
    SUPABASE_ANON_KEY?: string;
};
type Ctx = { request: Request; env: Env; params: { path?: string | string[] } };

// ⚠️ 여기 이름들은 **R2 버킷이 아니라 키 접두어**다. R2 바인딩은 IMG_BUCKET 하나뿐이고
//    실제 키는 "<prefix>/<path>" 로 저장된다. 그래서 접두어 추가는 인프라 작업이 아니라 이 줄 하나다.
//    · cafe-images   카페 배너·실사·스튜디오 설정
//    · deploy-intake 고객 배포 접수 첨부
//    · blog-studio   블로그 스튜디오 설정 이미지(2026-08-11 추가, SUB1 요청).
//      카페와 섞지 않는다 — 나중에 카페 이미지를 일괄 정리·마이그레이션할 때 블로그 자산이 딸려가지 않게.
//    · blog-save     블로그 저장/발행 작업 이미지(2026-08-12, Supabase→R2 전환).
//      웹 createSaveJob 이 PUT, SUB1 리스너가 GET 한다. 둘의 프리픽스가 같아야 한다.
const ALLOW = new Set(['cafe-images', 'deploy-intake', 'blog-studio', 'blog-save']);
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
        // 이 응답이 어디서 나왔는지 — Supabase 원본을 지워도 되는지 판단하는 유일한 근거다.
        //   200 이라는 사실만으로는 알 수 없다(아래 폴백도 200 을 준다).
        headers.set('x-img-src', 'r2');
        return new Response(obj.body, { headers });
    }
    // 폴백 — R2 에 아직 없는 옛 이미지. ★ 302 로 넘기지 않고 여기서 받아 R2 에 채운 뒤 직접 준다(자가 치유).
    //   왜(실측 2026-08-12): R2 이관 뒤에도 Supabase Egress 가 536%(26.8GB/5GB)였다.
    //   스튜디오 이미지 표본 20개 중 7개(35%)가 R2 에 없어 302 로 Supabase 를 타고 있었다.
    //   302 는 '볼 때마다' Supabase egress 다 — 같은 이미지를 100번 보면 100번 나간다.
    //   여기서 한 번만 받아 R2 에 넣으면 그다음부터는 영원히 R2 다(이관 스크립트를 따로 돌릴 필요도 없다).
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
                if (d.signedURL) {
                    const src = await fetch(`${env.SUPABASE_URL}/storage/v1${d.signedURL}`);
                    if (src.ok) {
                        const buf = await src.arrayBuffer();
                        const ct = src.headers.get('content-type') || 'image/jpeg';
                        // R2 적재 실패해도 이미지는 내준다 — 사용자에게 깨진 이미지를 보이면 안 된다.
                        let healed = true;
                        try { await env.IMG_BUCKET.put(key, buf, { httpMetadata: { contentType: ct } }); }
                        catch { healed = false; /* 다음 요청에 재시도 */ }
                        const headers = new Headers(cors);
                        headers.set('Content-Type', ct);
                        // supabase-heal = 이번에 R2 로 옮겼다 / supabase-miss = R2 적재 실패(원본 지우면 안 된다)
                        headers.set('x-img-src', healed ? 'supabase-heal' : 'supabase-miss');
                        headers.set('Cache-Control', key.includes('/studio-settings/')
                            ? 'public, max-age=300, must-revalidate'
                            : 'public, max-age=31536000, immutable');
                        return new Response(buf, { headers });
                    }
                    // 바이트를 못 받으면 옛 동작(302)으로라도 보여준다.
                    return Response.redirect(`${env.SUPABASE_URL}/storage/v1${d.signedURL}`, 302);
                }
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
    // ★ 백엔드가 둘일 수 있는 기간(자체호스팅 이전) — 어느 쪽 토큰이든 통과시킨다.
    //   안 그러면 컷오버 순간, 아직 재로그인하지 않은 사람은 이미지 업로드가 막힌다.
    //   (실측 2026-08-19 리허설: 자체호스팅 토큰인데 함수는 클라우드로 검증해 401)
    //   ALT 는 apikey 를 안 붙인다 — 백엔드가 다르면 anon key 도 다르기 때문.
    const bases: { url: string; key?: string }[] = [{ url: env.SUPABASE_URL, key: apikey }];
    if (env.SUPABASE_URL_ALT) bases.push({ url: env.SUPABASE_URL_ALT.replace(/\/$/, '') });
    let ok = false;
    for (const b of bases) {
        const h: Record<string, string> = { Authorization: `Bearer ${token}` };
        if (b.key) h.apikey = b.key;
        try {
            const r = await fetch(`${b.url}/auth/v1/user`, { headers: h });
            if (r.ok) { ok = true; break; }
        } catch { /* 다음 후보로 */ }
    }
    if (!ok) return new Response('unauthorized', { status: 401, headers: cors });
    const contentType = request.headers.get('x-content-type') || request.headers.get('content-type') || 'image/jpeg';
    const buf = await request.arrayBuffer();
    if (!buf.byteLength) return new Response('empty', { status: 400, headers: cors });
    await env.IMG_BUCKET.put(key, buf, { httpMetadata: { contentType } });
    // 저장된 바이트 수를 돌려준다 — 호출부가 보낸 크기와 대조해 '올라간 척'을 걸러낸다(SUB2 요청).
    return new Response(JSON.stringify({ ok: true, key, size: buf.byteLength }),
        { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } });
}
