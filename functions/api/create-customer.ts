// Cloudflare Pages Function — 고객 ERP(viewer) 계정 발급.
//   서비스키는 서버(이 함수)에만 있고 브라우저엔 노출되지 않는다.
//   호출자가 admin인지 검증한 뒤에만 계정 생성/역할 배정.
//   필요한 환경변수(Cloudflare Pages > Settings > Environment variables):
//     SUPABASE_URL, SUPABASE_SERVICE_KEY
type Env = { SUPABASE_URL?: string; SUPABASE_SERVICE_KEY?: string }

const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } })

export async function onRequestPost(context: { request: Request; env: Env }) {
  const { request, env } = context
  const URL = (env.SUPABASE_URL || 'https://ofjewtehrxdsgoiprymu.supabase.co').replace(/\/$/, '')
  const SERVICE = env.SUPABASE_SERVICE_KEY
  if (!SERVICE) return json({ error: '서버에 SUPABASE_SERVICE_KEY가 설정되지 않았습니다.' }, 500)

  const svc = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` }
  const svcJson = { ...svc, 'Content-Type': 'application/json' }

  // 1) 호출자(관리자) 검증 — JWT로 본인 확인 후 profiles.role=admin 인지 확인.
  const authz = request.headers.get('Authorization') || ''
  if (!authz) return json({ error: '로그인이 필요합니다.' }, 401)
  const meRes = await fetch(`${URL}/auth/v1/user`, { headers: { apikey: SERVICE, Authorization: authz } })
  if (!meRes.ok) return json({ error: '세션 확인 실패(다시 로그인).' }, 401)
  const me = (await meRes.json()) as { id?: string }
  if (!me?.id) return json({ error: '사용자 확인 실패.' }, 401)
  const profRes = await fetch(`${URL}/rest/v1/profiles?select=role&user_id=eq.${me.id}`, { headers: svc })
  const prof = (await profRes.json()) as Array<{ role?: string }>
  if ((prof?.[0]?.role || '') !== 'admin') return json({ error: '관리자만 고객 계정을 발급할 수 있습니다.' }, 403)

  // 2) 입력 — login(이메일 또는 아이디) + clientId(업체) + name(선택).
  const body = (await request.json().catch(() => ({}))) as { login?: string; clientId?: string; name?: string }
  const loginRaw = (body.login || '').trim()
  const clientId = (body.clientId || '').trim()
  if (!loginRaw || !clientId) return json({ error: '이메일(또는 아이디)과 업체가 필요합니다.' }, 400)
  const email = loginRaw.includes('@') ? loginRaw.toLowerCase() : `${loginRaw.toLowerCase()}@ddmkt.com`
  const password = email.split('@')[0] // 초기 비번 = 아이디(이메일 앞부분)

  // 3) auth 유저 생성 또는 비번 재설정.
  let uid: string | undefined
  const listRes = await fetch(`${URL}/auth/v1/admin/users?per_page=200`, { headers: svc })
  const list = (await listRes.json()) as { users?: Array<{ id: string; email?: string }> }
  const found = (list.users || []).find((u) => (u.email || '').toLowerCase() === email)
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
    uid = ((await cr.json()) as { id: string }).id
  }

  // 4) profiles upsert — viewer + 업체 연결 + 첫 로그인 비번변경.
  const exRes = await fetch(`${URL}/rest/v1/profiles?select=id&user_id=eq.${uid}`, { headers: svc })
  const ex = (await exRes.json()) as Array<{ id: string }>
  const pbody = {
    user_id: uid,
    email,
    name: (body.name || '').trim() || email.split('@')[0],
    role: 'viewer',
    is_active: true,
    duties: [],
    sheet_categories: [],
    client_id: clientId,
    must_change_password: true,
  }
  const pRes = await fetch(
    ex?.length ? `${URL}/rest/v1/profiles?user_id=eq.${uid}` : `${URL}/rest/v1/profiles`,
    { method: ex?.length ? 'PATCH' : 'POST', headers: { ...svcJson, Prefer: 'return=minimal' }, body: JSON.stringify(pbody) },
  )
  if (!pRes.ok) return json({ error: '권한 배정 실패: ' + (await pRes.text()).slice(0, 200) }, 500)

  return json({ ok: true, email, password })
}
