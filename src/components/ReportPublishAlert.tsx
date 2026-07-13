import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../hooks/useAuth'
import { getReports } from '../api/blogPostReports'

// 기자단 발행 보고 알림 — 벨(우측 상단) 안이 아니라 화면 상단에 '크게' 상시 표시.
//   대상: 김종인·김다영·송민경 3개 계정만. 승인 대기(pending)+발행 대기(confirmed) 합계.
const REPORT_ALERT_EMAILS = ['rlawhddls@ddmkt.com', 'cleokim77@ddmkt.com', 'ming99@ddmkt.com'] // 김종인·김다영·송민경

export default function ReportPublishAlert() {
  const { profile } = useAuth()
  const email = (profile?.email || '').toLowerCase()
  const eligible = REPORT_ALERT_EMAILS.includes(email)

  const [pending, setPending] = useState(0)
  const [confirmed, setConfirmed] = useState(0)
  const [dismissed, setDismissed] = useState(false)
  const prevTotal = useRef(0)

  useEffect(() => {
    if (!eligible) return
    const load = () => {
      void getReports('pending').then(({ data }) => setPending(data.length))
      void getReports('confirmed').then(({ data }) => setConfirmed(data.length))
    }
    load()
    const id = window.setInterval(load, 60000) // 1분마다 갱신
    window.addEventListener('app:navigate', load)
    return () => {
      window.clearInterval(id)
      window.removeEventListener('app:navigate', load)
    }
  }, [eligible])

  const total = pending + confirmed
  // 새 항목이 늘면 다시 표시(닫아뒀어도).
  useEffect(() => {
    if (total > prevTotal.current) setDismissed(false)
    prevTotal.current = total
  }, [total])

  if (!eligible || dismissed || total === 0) return null

  const go = () => {
    window.history.pushState(null, '', '/blog-dash?reports=1')
    window.dispatchEvent(new Event('app:navigate'))
  }

  return (
    <div className="mb-5 flex items-center gap-3 rounded-2xl border-2 border-[#16a34a] bg-[#f0fdf4] px-5 py-4 shadow-sm">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#16a34a] text-2xl">🔔</span>
      <div className="min-w-0 flex-1">
        <div className="text-lg font-extrabold text-[#15803d]">기자단 발행 보고 알림</div>
        <div className="mt-0.5 text-sm font-semibold text-[#166534]">
          {pending > 0 ? `승인 대기 ${pending}건` : ''}
          {pending > 0 && confirmed > 0 ? ' · ' : ''}
          {confirmed > 0 ? `발행 대기 ${confirmed}건` : ''} — 지금 처리해 주세요.
        </div>
      </div>
      <button
        className="h-11 shrink-0 rounded-xl bg-[#16a34a] px-6 text-sm font-bold text-white hover:bg-[#15803d]"
        onClick={go}
        type="button"
      >
        확인하러 가기
      </button>
      <button
        aria-label="닫기"
        className="h-11 w-11 shrink-0 rounded-xl border border-[#bbf7d0] text-xl font-bold text-[#16a34a] hover:bg-[#dcfce7]"
        onClick={() => setDismissed(true)}
        title="닫기(새 보고가 오면 다시 표시)"
        type="button"
      >
        ×
      </button>
    </div>
  )
}
