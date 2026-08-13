import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'

// 기자단 글 보고 '실시간 팝업(토스트)' — 기자단이 글을 보고(insert)하는 즉시 화면 우측 하단에
//   팝업으로 뜬다. 브라우저 알림 권한을 허용하면 OS 레벨 알림(백그라운드 탭이어도 뜸)도 함께 발생.
//   상단 배너(ReportPublishAlert)·벨(NotificationBell)과 별개의 '순간 팝업형' 알림이다.
//
// [동작 원리]
//   ① Supabase Realtime — blog_post_reports 테이블의 INSERT 이벤트를 구독. 기자단이 보고하면
//      DB에 row가 insert 되고, 그 즉시 postgres_changes 콜백이 payload.new(보고 내용)를 받아 팝업.
//      ※ Realtime 발행 필요: alter publication supabase_realtime add table public.blog_post_reports;
//   ② Web Notifications API — Notification.requestPermission()으로 권한을 받아두면, 팝업과 함께
//      new Notification(...)으로 OS 알림을 띄운다(다른 탭/최소화 상태에서도 보임).
//   ③ 12초 후 자동 사라짐 + 개별 닫기(✕).
// 알림 대상 — 예전엔 이메일 4개를 코드에 박아 뒀다.
//   그래서 새 담당자가 와도 코드를 고치기 전엔 알림이 안 갔다(사장님 신고 2026-08-13:
//   '크롬 알림이 나만 뜨고 다른 계정은 안 뜬다'). 역할로 판단한다 — 내부 직원 전원.
//   고객(viewer)·기자단(reporter)은 제외한다: 남의 보고 건수가 보이면 안 된다.
const STAFF_ROLES = ['admin', 'manager', 'sales']

type Toast = { id: string; title: string; kind: string; type: string }

export default function ReportToast() {
  const { profile, role } = useAuth()
  const eligible = STAFF_ROLES.includes(String(role || profile?.role || ''))
  const [toasts, setToasts] = useState<Toast[]>([])
  const timers = useRef<Record<string, number>>({})

  useEffect(() => {
    if (!eligible) return
    // 브라우저 알림 권한 최초 1회 요청 — 허용 시 OS 알림도 함께 뜬다(거부해도 화면 팝업은 정상 동작).
    if ('Notification' in window && Notification.permission === 'default') {
      void Notification.requestPermission()
    }
    // 알림 테스트 — 계정마다 '내 브라우저에 진짜 뜨는지'를 스스로 확인할 수 있어야 한다.
    //   벨 메뉴의 '알림 테스트'가 이 이벤트를 쏜다. 화면 팝업 + OS 알림 둘 다 같은 경로로 띄운다.
    const onTest = () => {
      const t: Toast = { id: `test-${Date.now()}`, title: '테스트 알림', kind: '테스트', type: '테스트' }
      setToasts((prev) => [t, ...prev].slice(0, 5))
      if ('Notification' in window && Notification.permission === 'granted') {
        try { new Notification('테스트 알림', { body: '이 알림이 보이면 정상입니다.' }) } catch { /* SW 없는 브라우저 */ }
      } else if ('Notification' in window) {
        void Notification.requestPermission()
      }
      timers.current[t.id] = window.setTimeout(() => {
        setToasts((prev) => prev.filter((x) => x.id !== t.id))
      }, 12000)
    }
    window.addEventListener('app:test-alert', onTest)
    const channel = supabase
      .channel('report-toast')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'blog_post_reports' },
        (payload) => {
          const r = payload.new as {
            id?: string
            title?: string | null
            blog_kind?: string | null
            report_type?: string | null
            status?: string | null
          }
          if (r.status && r.status !== 'pending') return // 승인 대기 보고만 팝업
          const t: Toast = {
            id: r.id || String(payload.commit_timestamp),
            title: r.title || '(제목 없음)',
            kind: r.blog_kind || '브랜드 블로그',
            type: r.report_type === 'publish' ? '발행' : '저장',
          }
          setToasts((prev) => [t, ...prev.filter((x) => x.id !== t.id)].slice(0, 5))
          if ('Notification' in window && Notification.permission === 'granted') {
            try {
              new Notification(`기자단 글 보고 · ${t.type}`, { body: `${t.kind} · ${t.title}` })
            } catch {
              /* 일부 브라우저는 SW 없이는 예외 — 화면 팝업으로 충분 */
            }
          }
          timers.current[t.id] = window.setTimeout(() => {
            setToasts((prev) => prev.filter((x) => x.id !== t.id))
          }, 12000)
        },
      )
      .subscribe()
    const captured = timers.current
    return () => {
      window.removeEventListener('app:test-alert', onTest)
      void supabase.removeChannel(channel)
      Object.values(captured).forEach((id) => window.clearTimeout(id))
    }
  }, [eligible])

  const dismiss = (id: string) => setToasts((prev) => prev.filter((x) => x.id !== id))
  const go = () => {
    window.history.pushState(null, '', '/blog-dash?reports=1')
    window.dispatchEvent(new Event('app:navigate'))
    setToasts([])
  }

  if (!eligible || toasts.length === 0) return null

  return (
    <div className="fixed bottom-5 right-5 z-[100] flex w-[min(360px,92vw)] flex-col gap-2">
      {toasts.map((t) => (
        <div
          className="rounded-xl border-2 border-[#16a34a] bg-white p-4 shadow-lg transition"
          key={t.id}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-xl">🔔</span>
              <span className="font-extrabold text-[#15803d]">기자단 글 보고 · {t.type}</span>
            </div>
            <button
              aria-label="닫기"
              className="text-[#94a3b8] hover:text-[#475569]"
              onClick={() => dismiss(t.id)}
              type="button"
            >
              ✕
            </button>
          </div>
          <div className="mt-1.5 text-sm font-semibold text-[#334155]">{t.kind}</div>
          <div className="truncate text-[13px] text-[#64748b]" title={t.title}>
            {t.title}
          </div>
          <button
            className="mt-2 w-full rounded-lg bg-[#16a34a] py-1.5 text-sm font-bold text-white hover:bg-[#15803d]"
            onClick={go}
            type="button"
          >
            승인하러 가기
          </button>
        </div>
      ))}
    </div>
  )
}
