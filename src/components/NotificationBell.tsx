import { useState } from 'react'
import { useErpData } from '../context/ErpDataContext'
import { useAuth } from '../hooks/useAuth'

// 계약 미완료(처리 대기) 알림 벨 — 고객사 관리를 담당하는 내부(관리자·매니저)에게만.
//   계약을 따서 '계약 미완료'로 들어온 건 수를 벨 배지로 표시, 클릭 시 목록.
const TERMINAL = ['계약완료', '계약종료', '종료', '임시']

export default function NotificationBell() {
  const { clients } = useErpData()
  const { isAdmin, role } = useAuth()
  const [open, setOpen] = useState(false)
  const isInternal = isAdmin || role === 'manager'
  if (!isInternal) return null

  const pending = clients.filter((c) => c.status && !TERMINAL.includes(c.status))
  const count = pending.length

  const go = (path: string) => {
    if (window.location.pathname + window.location.search !== path) {
      window.history.pushState(null, '', path)
      window.dispatchEvent(new Event('app:navigate'))
    }
    setOpen(false)
  }

  return (
    <div className="relative">
      <button
        aria-label="알림"
        className="relative flex h-9 w-9 items-center justify-center rounded-lg border border-[#e2e8f0] bg-white hover:bg-[#f8fafc]"
        onClick={() => setOpen((o) => !o)}
        type="button"
      >
        <svg className="h-5 w-5 text-[#475569]" fill="none" viewBox="0 0 24 24">
          <path
            d="M6 8a6 6 0 1112 0c0 5 2 6 2 6H4s2-1 2-6M9 20a3 3 0 006 0"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.8"
          />
        </svg>
        {count > 0 ? (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#dc2626] px-1 text-[10px] font-bold text-white">
            {count > 99 ? '99+' : count}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 z-50 mt-1 w-72 rounded-lg border border-[#e2e8f0] bg-white shadow-lg">
          <div className="flex items-center justify-between border-b border-[#f1f5f9] px-3 py-2">
            <span className="text-sm font-bold text-[#0f172a]">계약 미완료 알림</span>
            <span className="rounded-full bg-[#fee2e2] px-2 py-0.5 text-[11px] font-bold text-[#dc2626]">
              {count}
            </span>
          </div>
          {count ? (
            <div className="grid max-h-[50vh] gap-0.5 overflow-y-auto p-1">
              {pending.slice(0, 30).map((c) => (
                <button
                  className="rounded-md px-2 py-1.5 text-left hover:bg-[#f8fafc]"
                  key={c.id}
                  onClick={() => go('/clients')}
                  type="button"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-semibold text-[#334155]">
                      {c.company || '(업체명 없음)'}
                    </span>
                    <span className="shrink-0 rounded bg-[#eef2ff] px-1.5 py-0.5 text-[10px] font-bold text-[#4338ca]">
                      {c.status}
                    </span>
                  </div>
                  <div className="text-[11px] text-[#94a3b8]">
                    {c.manager || '담당 미지정'}
                    {c.created_at ? ` · ${c.created_at.slice(0, 10)}` : ''}
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="px-3 py-6 text-center text-xs text-[#94a3b8]">새 알림이 없습니다.</div>
          )}
          <button
            className="w-full border-t border-[#f1f5f9] px-3 py-2 text-center text-xs font-semibold text-[#1e40af] hover:bg-[#f8fafc]"
            onClick={() => go('/clients')}
            type="button"
          >
            고객사 관리로 이동 →
          </button>
        </div>
      ) : null}
    </div>
  )
}
