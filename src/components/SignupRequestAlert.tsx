import { useEffect, useState } from 'react'
import { useAuth } from '../hooks/useAuth'
import { listPendingSignups } from '../api/signup'
import { SIGNUP_ENABLED } from '../lib/authConfig'

// 고객·기자단 가입 요청(승인 대기) 알림 — 관리자에게 화면 상단 배너로 상시 표시.
//   가입(이메일/카카오 온보딩)으로 생긴 비활성 프로필(is_active=false) 수. 0건이면 숨김.
//   기자단 글 보고 알림(ReportPublishAlert)과 같은 톤, 색만 주황으로 구분.
export default function SignupRequestAlert() {
  const { isAdmin } = useAuth()
  const [count, setCount] = useState(0)

  useEffect(() => {
    if (!SIGNUP_ENABLED || !isAdmin) return
    // 에러 시 이전 값 유지(일시적 실패로 배너가 잘못 사라지지 않게 = 누락 방지).
    const load = () => {
      void listPendingSignups().then(({ data, error }) => { if (!error) setCount(data.length) })
    }
    load()
    const id = window.setInterval(load, 60000) // 폴링 60초
    const onFocus = () => load()
    const onVis = () => { if (document.visibilityState === 'visible') load() }
    window.addEventListener('app:navigate', load)
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVis)
    return () => {
      window.clearInterval(id)
      window.removeEventListener('app:navigate', load)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [isAdmin])

  // 닫기 없이 — 대기 건 있으면 항상 표시, 다 승인/반려하면 자동으로 사라짐.
  if (!SIGNUP_ENABLED || !isAdmin || count === 0) return null

  const go = () => {
    window.history.pushState(null, '', '/admin?tab=signups')
    window.dispatchEvent(new Event('app:navigate'))
  }

  return (
    <div className="mb-5 flex items-center gap-3 rounded-2xl border-2 border-[#ea580c] bg-[#fff7ed] px-5 py-4 shadow-sm">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#ea580c] text-2xl">🙋</span>
      <div className="min-w-0 flex-1">
        <div className="text-lg font-extrabold text-[#c2410c]">가입 요청 알림</div>
        <div className="mt-0.5 text-sm font-semibold text-[#9a3412]">
          고객·기자단 가입 승인 대기 <b>{count}</b>건 — 지금 확인해 주세요.
        </div>
      </div>
      <button
        className="h-11 shrink-0 rounded-xl bg-[#ea580c] px-6 text-sm font-bold text-white hover:bg-[#c2410c]"
        onClick={go}
        type="button"
      >
        확인하러 가기
      </button>
    </div>
  )
}
