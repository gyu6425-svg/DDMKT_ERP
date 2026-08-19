// Supabase Edge Function — 고객/기자단 계정 발급 + 셀프 회원가입/승인.
//   서비스롤 키는 Supabase가 이 함수에 자동 주입(SUPABASE_SERVICE_ROLE_KEY) → 브라우저 노출 없음.
//   배포: Supabase 대시보드 → Edge Functions → create-customer(배포명 clever-processor) → 이 코드 붙여넣고 Deploy.
//
//   action 별 동작:
//     signup          (공개)   회원가입 신청 = auth 유저 + 비활성(is_active=false) profiles 생성. 관리자 승인 전엔 데이터 접근 불가.
//                              inviteCode 를 주면 resolve_invite 로 검증해 소속 대행사를 profiles 에 보관한다(승인 때 확정).
//     list_pending    (관리자) 승인 대기(비활성) 계정 목록.
//     approve_signup  (관리자) 승인 = is_active=true (+ 고객이면 client_id 연결, 초대 코드 가입이면 대행사 하위로 붙임).
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
    const inviteRaw = String(body.inviteCode || '').trim()
    if (!loginRaw || !password) return json({ error: '아이디와 비밀번호를 입력하세요.' }, 400)
    if (password.length < 6) return json({ error: '비밀번호는 6자 이상이어야 합니다.' }, 400)
    if (!name) return json({ error: '이름을 입력하세요.' }, 400)
    if (role === 'viewer' && !company) return json({ error: '업체명을 입력하세요.' }, 400)
    const isAgency = role === 'viewer' && (body.isAgency === true || body.isAgency === 'true')

    // 초대 코드 — 대행사 하위 업체 가입. 계정을 만들기 **전에** 검증한다.
    //   나중에 검증하면 코드가 틀렸을 때 이미 만든 auth 유저를 지워야 하고, 지우다 실패하면 고아가 남는다.
    //   agency_invites 는 RLS로 내부 전용이라 공개 조회가 불가 → resolve_invite(security definer) 로 물어본다.
    let inviteCode: string | null = null
    let inviteAgency: string | null = null
    let inviteAgencyName = ''
    if (role === 'viewer' && inviteRaw) {
      if (isAgency) return json({ error: '대행사는 초대 코드로 가입할 수 없습니다 — 둘 중 하나만 선택하세요.' }, 400)
      const rv = await fetch(`${URL}/rest/v1/rpc/resolve_invite`, {
        method: 'POST', headers: svcJson, body: JSON.stringify({ p_code: inviteRaw }),
      })
      const rvBody = await rv.json().catch(() => null)
      if (!rv.ok) {
        return json({ error: (rvBody?.message || '초대 코드를 확인할 수 없습니다.').slice(0, 200) }, 400)
      }
      if (!rvBody?.agency_client_id) return json({ error: '초대 코드가 올바르지 않습니다.' }, 400)
      inviteCode = String(rvBody.code)
      inviteAgency = String(rvBody.agency_client_id)
      inviteAgencyName = String(rvBody.agency || '')
    }

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
      is_agency: isAgency,
      // 원문(코드)과 해석결과(대행사 id)를 둘 다 남긴다 — 코드가 나중에 폐기돼도 부모를 찾을 수 있고,
      // 분쟁 때 "무슨 코드로 들어왔나"도 볼 수 있다.
      signup_invite_code: inviteCode,
      signup_agency_client_id: inviteAgency,
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
    return json({ ok: true, pending: true, email, agency: inviteAgencyName || null })
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
        `${URL}/rest/v1/profiles?select=id,name,email,role,phone,signup_company,signup_biz_no,is_agency,signup_invite_code,signup_agency_client_id,created_at&is_active=eq.false&order=created_at.desc`,
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
      await fetch(
        `${URL}/rest/v1/profiles?select=id,role,is_active,is_agency,signup_invite_code,signup_agency_client_id&id=eq.${profileId}`,
        { headers: svc },
      )
    ).json()
    const p = prow?.[0]
    if (!p) return json({ error: '계정을 찾을 수 없습니다.' }, 404)
    if (p.role === 'viewer' && !clientId) return json({ error: '고객 계정은 업체 연결이 필요합니다.' }, 400)

    // 대행사 하위로 붙이기 — 초대 코드로 가입한 고객. **활성화보다 먼저** 한다.
    //   먼저 활성화해 버리면 소속 확정이 실패했을 때(예: 고른 업체가 이미 다른 대행사 소속)
    //   직거래 고객으로 살아 있게 되어, 대행사 화면에서 자기 하위가 통째로 안 보이는 사고가 난다.
    if (p.role === 'viewer' && clientId && p.signup_agency_client_id) {
      const at = await fetch(`${URL}/rest/v1/rpc/agency_attach_child`, {
        method: 'POST',
        headers: svcJson,
        body: JSON.stringify({
          p_client_id: clientId,
          p_agency_client_id: p.signup_agency_client_id,
          p_code: p.signup_invite_code || null,
        }),
      })
      if (!at.ok) {
        // 본문은 한 번만 읽을 수 있다 — text 로 받고 JSON 이면 message 만 뽑는다.
        const raw = await at.text()
        let detail = raw.slice(0, 200)
        try { detail = JSON.parse(raw)?.message || detail } catch { /* 무시 */ }
        return json({ error: '대행사 소속 연결 실패: ' + detail }, 400)
      }
    }

    const patch = { is_active: true, client_id: p.role === 'viewer' ? clientId : null }
    const up = await fetch(`${URL}/rest/v1/profiles?id=eq.${profileId}`, {
      method: 'PATCH',
      headers: svcJson,
      body: JSON.stringify(patch),
    })
    if (!up.ok) return json({ error: '승인 실패: ' + (await up.text()).slice(0, 200) }, 500)
    // 대행사 여부를 연결된 거래처(client)에 전파 — 카페 배포 단가(대행사 35,000) 판단 기준.
    if (p.role === 'viewer' && clientId && p.is_agency) {
      await fetch(`${URL}/rest/v1/clients?id=eq.${clientId}`, {
        method: 'PATCH', headers: svcJson, body: JSON.stringify({ is_agency: true }),
      })
    }
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
  // 관리자가 비밀번호를 직접 지정하면 그 값(6자+)을 사용하고 강제 변경 없이 바로 쓰게 한다.
  //   비워두면 기존 동작(초기 비번=아이디 · 첫 로그인 시 변경).
  const customPw = String(body.password || '').trim()
  if (customPw && customPw.length < 6) return json({ error: '비밀번호는 6자 이상이어야 합니다.' }, 400)
  const password = customPw || email.split('@')[0]
  const mustChange = customPw ? false : true

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
    must_change_password: mustChange,
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
