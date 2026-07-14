// Supabase Edge Function — 고객/기자단 계정 발급 + 셀프 회원가입/승인.
//   서비스롤 키는 Supabase가 이 함수에 자동 주입(SUPABASE_SERVICE_ROLE_KEY) → 브라우저 노출 없음.
//   배포: Supabase 대시보드 → Edge Functions → create-customer(배포명 clever-processor) → 이 코드 붙여넣고 Deploy.
//
//   action 별 동작:
//     signup          (공개)   회원가입 신청 = auth 유저 + 비활성(is_active=false) profiles 생성. 관리자 승인 전엔 데이터 접근 불가.
//     list_pending    (관리자) 승인 대기(비활성) 계정 목록.
//     approve_signup  (관리자) 승인 = is_active=true (+ 고객이면 client_id 연결).
//     reject_signup   (관리자) 거절 = 비활성 계정 삭제(auth+profiles).
//     delete_reporter (관리자) 기자단 계정 삭제.
//     (기본)          (관리자) 계정 발급(고객 viewer / 기자단 reporter).
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

  const body = await req.json().catch(() => ({}))
  const action = String(body.action || '').trim()

  const emailOf = (loginRaw: string) =>
    loginRaw.includes('@') ? loginRaw.toLowerCase() : `${loginRaw.toLowerCase()}@ddmkt.com`
  const findUser = async (email: string) => {
    const list = await (await fetch(`${URL}/auth/v1/admin/users?per_page=200`, { headers: svc })).json()
    return (list.users || []).find((u: { email?: string; id?: string }) => (u.email || '').toLowerCase() === email)
  }

  // ── (공개) 회원가입 신청 — 관리자 검증 없이 비활성 계정 생성 ─────────────────
  if (action === 'signup') {
    const loginRaw = String(body.login || '').trim()
    const password = String(body.password || '')
    const name = String(body.name || '').trim()
    const role = String(body.role || 'viewer').trim() === 'reporter' ? 'reporter' : 'viewer'
    const company = String(body.company || '').trim()
    const bizNo = String(body.bizNo || '').trim()
    const phone = String(body.phone || '').trim()
    if (!loginRaw || !password) return json({ error: '아이디와 비밀번호를 입력하세요.' }, 400)
    if (password.length < 6) return json({ error: '비밀번호는 6자 이상이어야 합니다.' }, 400)
    if (!name) return json({ error: '이름을 입력하세요.' }, 400)
    if (role === 'viewer' && !company) return json({ error: '업체명을 입력하세요.' }, 400)
    const email = emailOf(loginRaw)
    if (await findUser(email)) return json({ error: '이미 사용 중인 아이디입니다.' }, 409)

    const cr = await fetch(`${URL}/auth/v1/admin/users`, {
      method: 'POST',
      headers: svcJson,
      body: JSON.stringify({ email, password, email_confirm: true }),
    })
    if (!cr.ok) return json({ error: '가입 실패: ' + (await cr.text()).slice(0, 200) }, 500)
    const uid = (await cr.json()).id
    const pbody = {
      user_id: uid,
      email,
      name,
      role,
      is_active: false, // 승인 대기
      duties: [],
      sheet_categories: [],
      client_id: null,
      must_change_password: false, // 본인이 비번을 정했으므로 강제 변경 없음
      phone: phone || null,
      signup_company: role === 'viewer' ? company : null,
      signup_biz_no: role === 'viewer' ? bizNo || null : null,
    }
    const pRes = await fetch(`${URL}/rest/v1/profiles`, {
      method: 'POST',
      headers: svcJson,
      body: JSON.stringify(pbody),
    })
    if (!pRes.ok) {
      // 롤백: 프로필 생성 실패 시 auth 유저 삭제(고아 계정 방지).
      await fetch(`${URL}/auth/v1/admin/users/${uid}`, { method: 'DELETE', headers: svc })
      return json({ error: '가입 처리 실패: ' + (await pRes.text()).slice(0, 200) }, 500)
    }
    return json({ ok: true, pending: true, email })
  }

  // ── 이하 관리자 전용 — 호출자(관리자) 검증 ─────────────────────────────────
  const authz = req.headers.get('Authorization') || ''
  if (!authz) return json({ error: '로그인이 필요합니다.' }, 401)
  const meRes = await fetch(`${URL}/auth/v1/user`, { headers: { apikey: SERVICE, Authorization: authz } })
  if (!meRes.ok) return json({ error: '세션 확인 실패(다시 로그인).' }, 401)
  const me = await meRes.json()
  if (!me?.id) return json({ error: '사용자 확인 실패.' }, 401)
  const prof = await (
    await fetch(`${URL}/rest/v1/profiles?select=role&user_id=eq.${me.id}`, { headers: svc })
  ).json()
  if ((prof?.[0]?.role || '') !== 'admin') return json({ error: '관리자만 계정을 관리할 수 있습니다.' }, 403)

  // 승인 대기(비활성) 계정 목록.
  if (action === 'list_pending') {
    const rows = await (
      await fetch(
        `${URL}/rest/v1/profiles?select=id,name,email,role,phone,signup_company,signup_biz_no,created_at&is_active=eq.false&order=created_at.desc`,
        { headers: svc },
      )
    ).json()
    return json({ ok: true, pending: Array.isArray(rows) ? rows : [] })
  }

  // 승인 — 비활성 → 활성(+고객이면 업체 연결).
  if (action === 'approve_signup') {
    const profileId = String(body.profileId || '').trim()
    const clientId = String(body.clientId || '').trim()
    if (!profileId) return json({ error: 'profileId가 필요합니다.' }, 400)
    const prow = await (
      await fetch(`${URL}/rest/v1/profiles?select=id,role,is_active&id=eq.${profileId}`, { headers: svc })
    ).json()
    const p = prow?.[0]
    if (!p) return json({ error: '계정을 찾을 수 없습니다.' }, 404)
    if (p.role === 'viewer' && !clientId) return json({ error: '고객 계정은 업체 연결이 필요합니다.' }, 400)
    const patch = { is_active: true, client_id: p.role === 'viewer' ? clientId : null }
    const up = await fetch(`${URL}/rest/v1/profiles?id=eq.${profileId}`, {
      method: 'PATCH',
      headers: svcJson,
      body: JSON.stringify(patch),
    })
    if (!up.ok) return json({ error: '승인 실패: ' + (await up.text()).slice(0, 200) }, 500)
    return json({ ok: true, approved: profileId, role: p.role })
  }

  // 거절 — 비활성 계정만 삭제(auth+profiles). 활성 계정은 실수 삭제 방지로 거부.
  if (action === 'reject_signup') {
    const profileId = String(body.profileId || '').trim()
    if (!profileId) return json({ error: 'profileId가 필요합니다.' }, 400)
    const prow = await (
      await fetch(`${URL}/rest/v1/profiles?select=id,user_id,is_active&id=eq.${profileId}`, { headers: svc })
    ).json()
    const p = prow?.[0]
    if (!p) return json({ error: '계정을 찾을 수 없습니다.' }, 404)
    if (p.is_active) return json({ error: '이미 활성화된 계정은 거절할 수 없습니다.' }, 400)
    await fetch(`${URL}/rest/v1/profiles?id=eq.${profileId}`, { method: 'DELETE', headers: svcJson })
    if (p.user_id) await fetch(`${URL}/auth/v1/admin/users/${p.user_id}`, { method: 'DELETE', headers: svc })
    return json({ ok: true, rejected: profileId })
  }

  // 기자단 계정 삭제(admin만) — auth 유저 + profiles 삭제.
  if (action === 'delete_reporter') {
    const profileId = String(body.profileId || '').trim()
    if (!profileId) return json({ error: 'profileId가 필요합니다.' }, 400)
    const prow = await (
      await fetch(`${URL}/rest/v1/profiles?select=id,user_id,role&id=eq.${profileId}`, { headers: svc })
    ).json()
    const p = prow?.[0]
    if (!p) return json({ error: '계정을 찾을 수 없습니다.' }, 404)
    if ((p.role || '') !== 'reporter') return json({ error: '기자단 계정만 삭제할 수 있습니다.' }, 400)
    await fetch(`${URL}/rest/v1/profiles?id=eq.${profileId}`, { method: 'DELETE', headers: svcJson })
    if (p.user_id) {
      await fetch(`${URL}/auth/v1/admin/users/${p.user_id}`, { method: 'DELETE', headers: svc })
    }
    return json({ ok: true, deleted: profileId })
  }

  // ── (기본) 관리자 계정 발급 ────────────────────────────────────────────────
  const loginRaw = String(body.login || '').trim()
  const clientId = String(body.clientId || '').trim()
  const wantRole = String(body.role || 'viewer').trim() === 'reporter' ? 'reporter' : 'viewer'
  if (!loginRaw) return json({ error: '이메일(또는 아이디)이 필요합니다.' }, 400)
  if (wantRole === 'viewer' && !clientId) return json({ error: '고객 계정은 업체가 필요합니다.' }, 400)
  const email = emailOf(loginRaw)
  const password = email.split('@')[0]

  let uid: string | undefined
  const found = await findUser(email)
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
  const prow = await pRes.json().catch(() => null)
  const profileId = Array.isArray(prow) ? prow[0]?.id : prow?.id

  return json({ ok: true, email, password, profileId, role: wantRole })
})
