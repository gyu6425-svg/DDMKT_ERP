import { useState } from 'react'
import { supabase } from '../lib/supabase'

// 고객 ERP(viewer) 계정 발급 모달 — 관리자만. 서버(Cloudflare Function)가 실제 생성.
//   아이디(이메일 앞부분) 또는 이메일 입력 → 초기 비번=아이디, 첫 로그인 시 변경.
export default function CustomerAccountModal({
  clientId,
  companyName,
  onClose,
}: {
  clientId: string
  companyName: string
  onClose: () => void
}) {
  const [login, setLogin] = useState('')
  const [name, setName] = useState(companyName || '')
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState<{ email: string; password: string } | null>(null)
  const [err, setErr] = useState('')

  const submit = async () => {
    setErr('')
    if (!login.trim()) return setErr('이메일 또는 아이디를 입력하세요.')
    setSaving(true)
    try {
      const { data } = await supabase.auth.getSession()
      const token = data.session?.access_token
      if (!token) {
        setSaving(false)
        return setErr('로그인 세션이 없습니다. 다시 로그인하세요.')
      }
      const res = await fetch('/api/create-customer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ login: login.trim(), clientId, name: name.trim() }),
      })
      const j = await res.json()
      setSaving(false)
      if (!res.ok || j.error) return setErr(j.error || '발급 실패')
      setResult({ email: j.email, password: j.password })
    } catch (e) {
      setSaving(false)
      setErr('발급 요청 실패(네트워크). 배포 환경에서 시도하세요.')
    }
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-[min(420px,94vw)] rounded-2xl bg-white p-6">
        <h3 className="m-0 text-lg font-bold text-[#0f172a]">고객 ERP 계정 발급</h3>
        <p className="mt-1 text-sm text-[#64748b]">
          <b>{companyName}</b> 업체 전용 열람 계정(고객 ERP)을 만듭니다.
        </p>

        {result ? (
          <div className="mt-4 grid gap-2 rounded-lg border border-[#bbf7d0] bg-[#f0fdf4] p-3 text-sm">
            <div className="font-bold text-[#059669]">발급 완료 — 아래 정보를 고객에게 전달하세요</div>
            <div>
              접속: <b>https://ddmkt-erp.pages.dev/</b>
            </div>
            <div>
              아이디(이메일): <b>{result.email}</b>
            </div>
            <div>
              초기 비밀번호: <b>{result.password}</b>
            </div>
            <div className="text-xs text-[#64748b]">첫 로그인 시 비밀번호를 변경하게 됩니다.</div>
            <button
              className="mt-1 rounded-md bg-[#1e40af] px-4 py-2 text-sm font-semibold text-white"
              onClick={onClose}
              type="button"
            >
              닫기
            </button>
          </div>
        ) : (
          <>
            <div className="mt-4 grid gap-2">
              <label className="text-xs font-semibold text-[#475569]">
                아이디 또는 이메일
                <input
                  className="mt-1 h-10 w-full rounded-md border border-[#cbd5e1] px-3 text-sm"
                  onChange={(e) => setLogin(e.target.value)}
                  placeholder="예: dog6425@naver.com 또는 abc (→ abc@ddmkt.com)"
                  value={login}
                />
              </label>
              <label className="text-xs font-semibold text-[#475569]">
                표시 이름(선택)
                <input
                  className="mt-1 h-10 w-full rounded-md border border-[#cbd5e1] px-3 text-sm"
                  onChange={(e) => setName(e.target.value)}
                  placeholder="고객 담당자명 등"
                  value={name}
                />
              </label>
              <p className="m-0 text-[11px] text-[#94a3b8]">
                초기 비밀번호 = 아이디(이메일 앞부분). 이 업체 데이터만 열람 가능(수정 불가).
              </p>
              {err ? <p className="m-0 text-xs text-[#dc2626]">{err}</p> : null}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                className="rounded-md border border-[#cbd5e1] px-4 py-2 text-sm font-semibold text-[#64748b]"
                onClick={onClose}
                type="button"
              >
                취소
              </button>
              <button
                className="rounded-md bg-[#1e40af] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                disabled={saving}
                onClick={() => void submit()}
                type="button"
              >
                {saving ? '발급 중…' : '계정 발급'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
