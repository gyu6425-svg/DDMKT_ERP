// Supabase Edge Function — 고객 ERP(viewer) 계정 발급.
//   서비스롤 키는 Supabase가 이 함수에 자동 주입(SUPABASE_SERVICE_ROLE_KEY) → 브라우저 노출 없음.
//   호출자가 admin인지 검증한 뒤에만 계정 생성/역할 배정.
//   배포: Supabase 대시보드 → Edge Functions → create-customer → 이 코드 붙여넣고 Deploy.
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req: Request) => {
  const json = (obj: unknown, status = 200) =>
    new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  const URL = (Deno.env.get('SUPABASE_URL') || '').replace(/\/$/, '')
  const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  if (!URL || !SERVICE) return json({ error: '서버 환경변수 없음' }, 500)
  const svc = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` }
  const svcJson = { ...svc, 'Content-Type': 'application/json' }

  // 1) 호출자(관리자) 검증.
  const authz = req.headers.get('Authorization') || ''
  if (!authz) return json({ error: '로그인이 필요합니다.' }, 401)
  const meRes = await fetch(`${URL}/auth/v1/user`, { headers: { apikey: SERVICE, Authorization: authz } })
  if (!meRes.ok) return json({ error: '세션 확인 실패(다시 로그인).' }, 401)
  const me = await meRes.json()
  if (!me?.id) return json({ error: '사용자 확인 실패.' }, 401)
  const prof = await (
    await fetch(`${URL}/rest/v1/profiles?select=role&user_id=eq.${me.id}`, { headers: svc })
  ).json()
  if ((prof?.[0]?.role || '') !== 'admin') return json({ error: '관리자만 고객 계정을 발급할 수 있습니다.' }, 403)

  // 2) 입력.
  const body = await req.json().catch(() => ({}))

  // 2-a) 기자단 계정 삭제(admin만) — auth 유저 + profiles 삭제 → 로그인 불가 + RLS로 즉시 데이터 차단.
  if (String(body.action || '') === 'delete_reporter') {
    const profileId = String(body.profileId || '').trim()
    if (!profileId) return json({ error: 'profileId가 필요합니다.' }, 400)
    const prow = await (
      await fetch(`${URL}/rest/v1/profiles?select=id,user_id,role&id=eq.${profileId}`, { headers: svc })
    ).json()
    const p = prow?.[0]
    if (!p) return json({ error: '계정을 찾을 수 없습니다.' }, 404)
    if ((p.role || '') !== 'reporter') return json({ error: '기자단 계정만 삭제할 수 있습니다.' }, 400)
    // profiles 먼저 삭제(FK on delete set null → 담당 블로그·보고 자동 해제).
    await fetch(`${URL}/rest/v1/profiles?id=eq.${profileId}`, { method: 'DELETE', headers: svcJson })
    // auth 유저 삭제 → 재로그인 불가.
    if (p.user_id) {
      await fetch(`${URL}/auth/v1/admin/users/${p.user_id}`, { method: 'DELETE', headers: svc })
    }
    return json({ ok: true, deleted: profileId })
  }

  const loginRaw = String(body.login || '').trim()
  const clientId = String(body.clientId || '').trim()
  // role: 'viewer'(고객, 업체 연결 필요) | 'reporter'(기자단, 업체 연결 없음). 기본 viewer.
  const wantRole = String(body.role || 'viewer').trim() === 'reporter' ? 'reporter' : 'viewer'
  if (!loginRaw) return json({ error: '이메일(또는 아이디)이 필요합니다.' }, 400)
  if (wantRole === 'viewer' && !clientId) return json({ error: '고객 계정은 업체가 필요합니다.' }, 400)
  const email = loginRaw.includes('@') ? loginRaw.toLowerCase() : `${loginRaw.toLowerCase()}@ddmkt.com`
  const password = email.split('@')[0]

  // 3) auth 유저 생성 또는 비번 재설정.
  let uid: string | undefined
  const list = await (await fetch(`${URL}/auth/v1/admin/users?per_page=200`, { headers: svc })).json()
  const found = (list.users || []).find((u: { email?: string }) => (u.email || '').toLowerCase() === email)
  if (found) {
    uid = found.id
    await fetch(`${URL}/auth/v1/admin/users/${uid}`, {
      method: 'PUT',
      headers: svcJson,
      body: JSON.stringify({ password, email_confirm: true }),
    })
  } else {
    const cr = await fetch(`${URL}/auth/v1/admin/users`, {
      method: 'POST',
      headers: svcJson,
      body: JSON.stringify({ email, password, email_confirm: true }),
    })
    if (!cr.ok) return json({ error: '계정 생성 실패: ' + (await cr.text()).slice(0, 200) }, 500)
    uid = (await cr.json()).id
  }

  // 4) profiles upsert — viewer(업체 연결) 또는 reporter(연결 없음, 담당 블로그로 스코프) + 첫 로그인 비번변경.
  const ex = await (await fetch(`${URL}/rest/v1/profiles?select=id&user_id=eq.${uid}`, { headers: svc })).json()
  const pbody = {
    user_id: uid,
    email,
    name: String(body.name || '').trim() || email.split('@')[0],
    role: wantRole,
    is_active: true,
    duties: [],
    sheet_categories: [],
    client_id: wantRole === 'viewer' ? clientId : null,
    must_change_password: true,
  }
  const pRes = await fetch(
    ex?.length ? `${URL}/rest/v1/profiles?user_id=eq.${uid}` : `${URL}/rest/v1/profiles`,
    { method: ex?.length ? 'PATCH' : 'POST', headers: { ...svcJson, Prefer: 'return=representation' }, body: JSON.stringify(pbody) },
  )
  if (!pRes.ok) return json({ error: '권한 배정 실패: ' + (await pRes.text()).slice(0, 200) }, 500)
  // 생성/갱신된 profiles.id 반환 → 기자단이면 프론트가 이 id로 blog_accounts.reporter_id 배정.
  const prow = await pRes.json().catch(() => null)
  const profileId = Array.isArray(prow) ? prow[0]?.id : prow?.id

  return json({ ok: true, email, password, profileId, role: wantRole })
})
