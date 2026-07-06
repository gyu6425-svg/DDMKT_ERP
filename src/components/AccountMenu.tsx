import { useState } from 'react'
import { AUTH_DISABLED } from '../lib/authConfig'
import { updatePassword } from '../api/auth'
import { useAuth } from '../hooks/useAuth'

const ROLE_LABEL: Record<string, string> = {
  admin: '관리자',
  manager: '매니저',
  sales: '사원',
  viewer: '열람전용',
}

// 헤더 계정 메뉴 — 이름/역할 표시 + 비밀번호 변경 + 로그아웃.
export default function AccountMenu() {
  const { profile, role, signOut } = useAuth()
  const [open, setOpen] = useState(false)
  const [pwOpen, setPwOpen] = useState(false)
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [msg, setMsg] = useState('')
  const [saving, setSaving] = useState(false)

  // 로그인이 꺼진 개발 상태에선 계정 메뉴 숨김(익명).
  if (AUTH_DISABLED) return null

  const submitPw = async () => {
    setMsg('')
    if (pw.length < 6) return setMsg('비밀번호는 6자 이상이어야 합니다.')
    if (pw !== pw2) return setMsg('비밀번호가 일치하지 않습니다.')
    setSaving(true)
    const { error } = await updatePassword(pw)
    setSaving(false)
    if (error) return setMsg('변경 실패: ' + error.message)
    setMsg('변경되었습니다. 다음 로그인부터 새 비밀번호를 사용하세요.')
    setPw('')
    setPw2('')
  }

  return (
    <div className="relative">
      <button
        className="flex items-center gap-2 rounded-lg border border-[#e2e8f0] bg-white px-3 py-1.5 text-sm font-semibold text-[#334155] hover:bg-[#f8fafc]"
        onClick={() => setOpen((o) => !o)}
        type="button"
      >
        <span>{profile?.name ?? '계정'}</span>
        <span className="rounded bg-[#eef2ff] px-1.5 py-0.5 text-[11px] font-bold text-[#4338ca]">
          {ROLE_LABEL[role] ?? role}
        </span>
        <span className="text-[#94a3b8]">▾</span>
      </button>
      {open ? (
        <div className="absolute right-0 z-50 mt-1 w-56 rounded-lg border border-[#e2e8f0] bg-white p-1 shadow-lg">
          <div className="px-3 py-2 text-[11px] text-[#94a3b8]">{profile?.email}</div>
          <button
            className="w-full rounded-md px-3 py-2 text-left text-sm hover:bg-[#f1f5f9]"
            onClick={() => {
              setPwOpen(true)
              setOpen(false)
            }}
            type="button"
          >
            비밀번호 변경
          </button>
          <button
            className="w-full rounded-md px-3 py-2 text-left text-sm text-[#dc2626] hover:bg-[#fef2f2]"
            onClick={() => void signOut()}
            type="button"
          >
            로그아웃
          </button>
        </div>
      ) : null}

      {pwOpen ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
          onMouseDown={(e) => e.target === e.currentTarget && setPwOpen(false)}
        >
          <div className="w-[min(360px,94vw)] rounded-2xl bg-white p-6">
            <h3 className="m-0 mb-3 text-lg font-bold">비밀번호 변경</h3>
            <div className="grid gap-2">
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
            <div className="mt-4 flex justify-end gap-2">
              <button
                className="rounded-md border border-[#cbd5e1] px-4 py-2 text-sm font-semibold text-[#64748b]"
                onClick={() => setPwOpen(false)}
                type="button"
              >
                닫기
              </button>
              <button
                className="rounded-md bg-[#1e40af] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                disabled={saving}
                onClick={() => void submitPw()}
                type="button"
              >
                {saving ? '변경 중…' : '변경'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
