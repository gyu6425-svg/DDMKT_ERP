import { useState } from 'react'
import { AUTH_DISABLED } from '../lib/authConfig'
import { updatePassword } from '../api/auth'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'

// 첫 로그인 강제 비밀번호 변경 — profiles.must_change_password=true 인 계정은
//   변경 완료 전까지 이 화면을 벗어날 수 없다(초기 비번=아이디 → 반드시 교체).
export default function ForcePasswordChangeGate() {
  const { profile, user } = useAuth()
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [msg, setMsg] = useState('')
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)

  // 로그인 꺼짐(개발) / 미로그인 / 변경 불필요 / 이미 완료 → 표시 안 함.
  if (AUTH_DISABLED || !user || done || !profile?.must_change_password) return null

  const submit = async () => {
    setMsg('')
    if (pw.length < 6) return setMsg('비밀번호는 6자 이상이어야 합니다.')
    if (pw !== pw2) return setMsg('비밀번호가 일치하지 않습니다.')
    setSaving(true)
    const { error } = await updatePassword(pw)
    if (error) {
      setSaving(false)
      return setMsg('변경 실패: ' + error.message)
    }
    // 변경 완료 플래그 저장 → 다음부터 이 창 안 뜸.
    if (profile?.id) {
      await supabase.from('profiles').update({ must_change_password: false }).eq('id', profile.id)
    }
    setSaving(false)
    setDone(true)
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4">
      <div className="w-[min(400px,94vw)] rounded-2xl bg-white p-6">
        <h3 className="m-0 text-lg font-bold text-[#0f172a]">비밀번호 변경 필요</h3>
        <p className="mt-1 text-sm text-[#64748b]">
          첫 로그인입니다. 초기 비밀번호(아이디와 동일)를 새 비밀번호로 변경해야 계속할 수 있습니다.
        </p>
        <div className="mt-4 grid gap-2">
          <input
            autoComplete="new-password"
            className="h-10 rounded-md border border-[#cbd5e1] px-3 text-sm"
            onChange={(e) => setPw(e.target.value)}
            placeholder="새 비밀번호(6자 이상)"
            type="password"
            value={pw}
          />
          <input
            autoComplete="new-password"
            className="h-10 rounded-md border border-[#cbd5e1] px-3 text-sm"
            onChange={(e) => setPw2(e.target.value)}
            placeholder="새 비밀번호 확인"
            type="password"
            value={pw2}
          />
          {msg ? <p className="m-0 text-xs text-[#b45309]">{msg}</p> : null}
        </div>
        <button
          className="mt-4 w-full rounded-md bg-[#1e40af] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-60"
          disabled={saving}
          onClick={() => void submit()}
          type="button"
        >
          {saving ? '변경 중…' : '변경하고 시작하기'}
        </button>
      </div>
    </div>
  )
}
