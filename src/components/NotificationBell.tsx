import { useEffect, useRef, useState } from 'react'
import { useErpData } from '../context/ErpDataContext'
import { useAuth } from '../hooks/useAuth'
import { getClientContracts, type ClientContract } from '../api/clientContracts'
import { canSeeContractPending, SHEET_CATEGORIES } from '../lib/permissions'
import { SIDEBAR_CATEGORIES } from './categoryRank/categories'

// 알림 벨 — ① 계약 미완료(송민경·김종인·조재현·장규진만), ② 시트 승인 대기(담당 카테고리).
//   [읽음]으로 현재 알림을 지울 수 있음(localStorage 기록). 새 항목은 다시 뜬다.
const TERMINAL = ['계약완료', '계약종료', '종료', '임시']
const READ_KEY = 'erp_notif_read'
const loadRead = (): Set<string> => {
  try {
    return new Set(JSON.parse(localStorage.getItem(READ_KEY) || '[]') as string[])
  } catch {
    return new Set()
  }
}
const saveRead = (s: Set<string>) => {
  try {
    localStorage.setItem(READ_KEY, JSON.stringify([...s]))
  } catch {
    /* ignore */
  }
}

export default function NotificationBell() {
  const { allClients } = useErpData()
  const { profile, role, canManageSheet } = useAuth()
  const [open, setOpen] = useState(false)
  const [contracts, setContracts] = useState<ClientContract[]>([])
  const [readSet, setReadSet] = useState<Set<string>>(loadRead)
  const boxRef = useRef<HTMLDivElement>(null)

  const seePending = canSeeContractPending(profile?.email)
  const myCats = SHEET_CATEGORIES.filter((c) => canManageSheet(c))
  const eligible = role !== 'viewer' && (seePending || myCats.length > 0)

  useEffect(() => {
    if (!eligible || myCats.length === 0) return
    const load = () => void getClientContracts().then(({ data }) => setContracts(data))
    load()
    window.addEventListener('app:navigate', load)
    return () => window.removeEventListener('app:navigate', load)
  }, [eligible, myCats.length])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  if (!eligible) return null

  // 읽음 처리 안 된 것만.
  const pendingClients = (
    seePending ? allClients.filter((c) => c.status && !TERMINAL.includes(c.status)) : []
  ).filter((c) => !readSet.has('p:' + c.id))
  const sheetPending = contracts.filter(
    (ct) => !ct.sheet_approved && canManageSheet(ct.category) && !readSet.has('s:' + ct.id),
  )
  const byCat = new Map<string, number>()
  for (const ct of sheetPending) byCat.set(ct.category, (byCat.get(ct.category) ?? 0) + 1)
  const count = pendingClients.length + sheetPending.length

  const go = (path: string) => {
    if (window.location.pathname + window.location.search !== path) {
      window.history.pushState(null, '', path)
      window.dispatchEvent(new Event('app:navigate'))
    }
    setOpen(false)
  }
  const sheetHref = (cat: string) => {
    const scat = SIDEBAR_CATEGORIES.find((c) => c.label === cat)
    return (scat?.dashHref ?? '/dashboard') + '?tab=sheet&pending=1'
  }
  // 현재 보이는 알림을 모두 읽음 처리(지움).
  const markAllRead = () => {
    const next = new Set(readSet)
    pendingClients.forEach((c) => next.add('p:' + c.id))
    sheetPending.forEach((ct) => next.add('s:' + ct.id))
    setReadSet(next)
    saveRead(next)
  }

  return (
    <div className="relative" ref={boxRef}>
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
            <span className="text-sm font-bold text-[#0f172a]">알림 {count > 0 ? `(${count})` : ''}</span>
            {count > 0 ? (
              <button
                className="rounded-md border border-[#cbd5e1] px-2 py-0.5 text-[11px] font-semibold text-[#64748b] hover:bg-[#f1f5f9]"
                onClick={markAllRead}
                type="button"
              >
                읽음
              </button>
            ) : null}
          </div>

          {/* ② 시트 승인 대기 */}
          {myCats.length && byCat.size ? (
            <div className="border-b border-[#f1f5f9] p-1">
              <div className="px-2 py-1 text-[11px] font-bold text-[#7c3aed]">시트 승인 대기</div>
              {[...byCat.entries()].map(([cat, n]) => (
                <button
                  className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-[#f8fafc]"
                  key={cat}
                  onClick={() => go(sheetHref(cat))}
                  type="button"
                >
                  <span className="font-semibold text-[#334155]">{cat} 시트</span>
                  <span className="rounded-full bg-[#f5f3ff] px-2 py-0.5 text-[11px] font-bold text-[#7c3aed]">
                    {n}건 승인 대기
                  </span>
                </button>
              ))}
            </div>
          ) : null}

          {/* ① 계약 미완료 */}
          {seePending && pendingClients.length ? (
            <div className="p-1">
              <div className="px-2 py-1 text-[11px] font-bold text-[#dc2626]">계약 미완료</div>
              <div className="grid max-h-[40vh] gap-0.5 overflow-y-auto">
                {pendingClients.slice(0, 30).map((c) => (
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
            </div>
          ) : null}

          {count === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-[#94a3b8]">새 알림이 없습니다.</div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
