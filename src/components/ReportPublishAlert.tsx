import { useEffect, useState } from 'react'
import { useAuth } from '../hooks/useAuth'
import { getReports } from '../api/blogPostReports'
import { supabase } from '../lib/supabase'

// 기자단 발행 보고 알림 — 벨(우측 상단) 안이 아니라 화면 상단에 '크게' 상시 표시.
//   대상: 김종인·김다영·송민경·장규진 계정만. 승인 대기(pending, 새 글 보고)만 카운트 — 0건이면 배너 숨김.
const REPORT_ALERT_EMAILS = ['rlawhddls@ddmkt.com', 'cleokim77@ddmkt.com', 'ming99@ddmkt.com', 'gyu6425@gmail.com'] // 김종인·김다영·송민경·장규진

export default function ReportPublishAlert() {
  const { profile } = useAuth()
  const email = (profile?.email || '').toLowerCase()
  const eligible = REPORT_ALERT_EMAILS.includes(email)

  const [pending, setPending] = useState(0) // 승인 대기(새 글 보고)

  useEffect(() => {
    if (!eligible) return
    const load = () => {
      // 에러 시 이전 값 유지(일시적 네트워크/RLS 실패로 배너가 잘못 사라지지 않게 = 누락 방지).
      void getReports('pending').then(({ data, error }) => {
        if (!error) setPending(data.length)
      })
    }
    load()
    // ① 실시간 — 기자단이 글 보고(insert)하는 즉시 반영. (Supabase Realtime, blog_post_reports 발행 필요: SQL 안내)
    const channel = supabase
      .channel('report-alert')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'blog_post_reports' }, () => load())
      .subscribe()
    // ② 폴링(10초) — 실시간이 끊겨도 절대 누락 없게 하는 안전망.
    const id = window.setInterval(load, 10000)
    // ③ 탭 복귀·포커스 시 즉시 갱신(백그라운드 있던 사이 온 보고도 놓치지 않게).
    const onFocus = () => load()
    const onVis = () => {
      if (document.visibilityState === 'visible') load()
    }
    window.addEventListener('app:navigate', load)
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVis)
    return () => {
      void supabase.removeChannel(channel)
      window.clearInterval(id)
      window.removeEventListener('app:navigate', load)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [eligible])

  // 절대 누락 방지: 닫기(dismiss) 없이 — 승인 대기가 있으면 항상 표시, 다 처리하면 자동으로 사라짐.
  if (!eligible || pending === 0) return null

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
          승인 대기 {pending}건 — 지금 처리해 주세요.
        </div>
      </div>
      <button
        className="h-11 shrink-0 rounded-xl bg-[#16a34a] px-6 text-sm font-bold text-white hover:bg-[#15803d]"
        onClick={go}
        type="button"
      >
        확인하러 가기
      </button>
    </div>
  )
}
