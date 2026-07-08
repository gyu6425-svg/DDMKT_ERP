import { useState } from 'react'
import { supabase } from '../lib/supabase'

// 계정 발급 모달 — 관리자만. 서버(Edge Function)가 실제 생성.
//   mode='customer'(고객 ERP·업체 연결) | 'reporter'(기자단 ERP·업체 연결 없음).
//   아이디(이메일 앞부분) 또는 이메일 입력 → 초기 비번=아이디, 첫 로그인 시 변경.
export default function CustomerAccountModal({
  clientId,
  companyName,
  mode = 'customer',
  onClose,
  onIssued,
}: {
  clientId?: string
  companyName: string
  mode?: 'customer' | 'reporter'
  onClose: () => void
  onIssued?: (info: { profileId: string | null; email: string; name: string }) => void
}) {
  const isReporter = mode === 'reporter'
  const [login, setLogin] = useState('')
  // 기자단은 담당자(사람) 이름을 직접 입력 → 업체명으로 채우지 않음. 고객은 업체명 기본값.
  const [name, setName] = useState(isReporter ? '' : companyName || '')
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState<{ email: string; password: string } | null>(null)
  const [err, setErr] = useState('')

  const submit = async () => {
    setErr('')
    if (!login.trim()) return setErr('이메일 또는 아이디를 입력하세요.')
    if (isReporter && !name.trim()) return setErr('기자단 이름을 입력하세요.')
    setSaving(true)
    try {
      // Supabase Edge Function 호출(세션 JWT 자동 포함) — 서버가 관리자 검증 후 계정 생성.
      //   함수 배포 이름이 'clever-processor'(대시보드 자동 생성명)이라 그 이름으로 호출.
      const body = isReporter
        ? { login: login.trim(), name: name.trim(), role: 'reporter' }
        : { login: login.trim(), clientId, name: name.trim() }
      const { data, error } = await supabase.functions.invoke('clever-processor', { body })
      setSaving(false)
      if (error) return setErr('발급 실패: ' + (error.message || '서버 오류'))
      if (data?.error) return setErr(data.error)
      if (data?.ok) {
        onIssued?.({ profileId: data.profileId ?? null, email: data.email, name: name.trim() })
        return setResult({ email: data.email, password: data.password })
      }
      setErr('알 수 없는 응답')
    } catch {
      setSaving(false)
      setErr('발급 요청 실패(네트워크).')
    }
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-[min(420px,94vw)] rounded-2xl bg-white p-6">
        <h3 className="m-0 text-lg font-bold text-[#0f172a]">
          {isReporter ? '기자단 ERP 계정 발급' : '고객 ERP 계정 발급'}
        </h3>
        <p className="mt-1 text-sm text-[#64748b]">
          {isReporter ? (
            <>
              {companyName ? (
                <>
                  <b>{companyName}</b> 블로그 담당 기자단 계정을 만듭니다. 발급하면 이 블로그에 자동 배정됩니다.
                </>
              ) : (
                <>기자단 전용 열람 계정(기자단 ERP)을 만듭니다. 발급 후 담당 블로그를 지정하세요.</>
              )}
            </>
          ) : (
            <>
              <b>{companyName}</b> 업체 전용 열람 계정(고객 ERP)을 만듭니다.
            </>
          )}
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
                {isReporter ? '기자단 이름' : '표시 이름(선택)'}
                <input
                  className="mt-1 h-10 w-full rounded-md border border-[#cbd5e1] px-3 text-sm"
                  onChange={(e) => setName(e.target.value)}
                  placeholder={isReporter ? '담당자를 입력하세요' : '고객 담당자명 등'}
                  value={name}
                />
              </label>
              <p className="m-0 text-[11px] text-[#94a3b8]">
                초기 비밀번호 = 아이디(이메일 앞부분).{' '}
                {isReporter ? '본인 담당 블로그만 열람 가능(수정 불가).' : '이 업체 데이터만 열람 가능(수정 불가).'}
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
