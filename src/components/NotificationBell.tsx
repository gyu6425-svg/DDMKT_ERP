import { useEffect, useRef, useState } from 'react'
import { useErpData } from '../context/ErpDataContext'
import { useAuth } from '../hooks/useAuth'
import { getClientContracts, type ClientContract } from '../api/clientContracts'
import { getReports } from '../api/blogPostReports'
import { canSeeContractPending, canSeeNewContract, SHEET_CATEGORIES } from '../lib/permissions'
import { SIDEBAR_CATEGORIES } from './categoryRank/categories'
import { resolveScope } from './categoryRank/ContractSheetTab'

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
  const [reportPending, setReportPending] = useState(0) // 기자단 발행 보고 승인 대기 수
  const [readSet, setReadSet] = useState<Set<string>>(loadRead)
  const boxRef = useRef<HTMLDivElement>(null)

  const seePending = canSeeContractPending(profile?.email)
  const seeNewContract = canSeeNewContract(profile?.email)
  const myCats = SHEET_CATEGORIES.filter((c) => canManageSheet(c))
  const seeReports = role === 'admin' || canManageSheet('블로그') // 관리자(장규진 등)·블로그 담당(김다영)이 기자단 보고 알림 수신
  // 외부(고객·기자단)는 내부 알림 벨 미노출.
  const eligible =
    role !== 'viewer' && role !== 'reporter' && (seePending || seeNewContract || myCats.length > 0 || seeReports)

  useEffect(() => {
    if (!eligible) return
    const load = () => {
      if (myCats.length > 0) void getClientContracts().then(({ data }) => setContracts(data))
      if (seeReports) void getReports('pending').then(({ data }) => setReportPending(data.length))
    }
    load()
    window.addEventListener('app:navigate', load)
    return () => window.removeEventListener('app:navigate', load)
  }, [eligible, myCats.length, seeReports])

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
  // 신규 계약 = 고객사 관리에서 계약완료 처리돼 계약 관리 '신규 등록 건'으로 간 건(승인 전).
  const newContracts = (
    seeNewContract
      ? allClients.filter((c) => c.status === '계약완료' && c.contract_approved === false)
      : []
  ).filter((c) => !readSet.has('n:' + c.id))
  // 세부유형(subtype)별로 묶음 — 플레이스처럼 하위(?sub) 드롭다운이 있는 카테고리는
  //   해당 세부유형 시트로 정확히 이동해야 '관리 시트'가 열림.
  const bySub = new Map<string, { cat: string; subtype: string; n: number }>()
  for (const ct of sheetPending) {
    const key = ct.category + '|||' + ct.subtype
    const cur = bySub.get(key) ?? { cat: ct.category, n: 0, subtype: ct.subtype }
    cur.n += 1
    bySub.set(key, cur)
  }
  const count = pendingClients.length + sheetPending.length + newContracts.length + (seeReports ? reportPending : 0)

  const go = (path: string) => {
    if (window.location.pathname + window.location.search !== path) {
      window.history.pushState(null, '', path)
      window.dispatchEvent(new Event('app:navigate'))
    }
    setOpen(false)
  }
  // 카테고리+세부유형 → 그 세부유형 시트 경로(?sub= 또는 전용 pathname) + 관리 시트/신규 탭 딥링크.
  const sheetHref = (cat: string, subtype: string) => {
    const scat = SIDEBAR_CATEGORIES.find((c) => c.label === cat)
    const sub =
      scat?.subs.find((s) => resolveScope(s.href)?.subtype === subtype) ??
      // 컨테이너 자식(예: '상위노출 보장형 · 영수증 리뷰')은 접두 세부유형 시트로.
      scat?.subs.find((s) => {
        const st = resolveScope(s.href)?.subtype
        return !!st && subtype.startsWith(st)
      })
    const base = sub?.href ?? scat?.dashHref ?? '/dashboard'
    return base + (base.includes('?') ? '&' : '?') + 'tab=sheet&pending=1'
  }
  // 현재 보이는 알림을 모두 읽음 처리(지움).
  const markAllRead = () => {
    const next = new Set(readSet)
    pendingClients.forEach((c) => next.add('p:' + c.id))
    newContracts.forEach((c) => next.add('n:' + c.id))
    sheetPending.forEach((ct) => next.add('s:' + ct.id))
    setReadSet(next)
    saveRead(next)
  }
  // 특정 알림 키만 읽음 처리(클릭 시 그 알림만 사라지게).
  const markRead = (keys: string[]) => {
    const next = new Set(readSet)
    keys.forEach((k) => next.add(k))
    setReadSet(next)
    saveRead(next)
  }
  // 계약 미완료 알림 클릭 — 그 업체명으로 고객사 관리 검색 이동 + 이 알림 제거.
  const openPendingClient = (c: { id: string; company: string | null }) => {
    markRead(['p:' + c.id])
    go('/clients?q=' + encodeURIComponent(c.company || ''))
  }
  // 신규 계약 알림 클릭 — 계약 관리(신규 등록 건)에서 그 업체 검색 + 이 알림 제거.
  const openNewContract = (c: { id: string; company: string | null }) => {
    markRead(['n:' + c.id])
    go('/contracts?q=' + encodeURIComponent(c.company || ''))
  }
  // 시트 승인 대기 알림 클릭 — 그 세부유형 시트로 이동 + 그 그룹 알림 제거.
  const openSheetGroup = (cat: string, subtype: string) => {
    markRead(sheetPending.filter((ct) => ct.category === cat && ct.subtype === subtype).map((ct) => 's:' + ct.id))
    go(sheetHref(cat, subtype))
  }
  // 기자단 발행 보고 알림 클릭 — 블로그 대시보드 '기자단 당일 업로드건' KPI(승인 모달)로 이동.
  const openReports = () => go('/blog-dash?reports=1')

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

          {/* ③ 기자단 발행 보고(승인 대기) — 블로그 담당(김다영 등)만 */}
          {seeReports && reportPending > 0 ? (
            <div className="border-b border-[#f1f5f9] p-1">
              <div className="px-2 py-1 text-[11px] font-bold text-[#16a34a]">기자단 발행 보고</div>
              <button
                className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-[#f8fafc]"
                onClick={openReports}
                type="button"
              >
                <span className="font-semibold text-[#334155]">기자단 당일 업로드건</span>
                <span className="ml-2 shrink-0 rounded-full bg-[#dcfce7] px-2 py-0.5 text-[11px] font-bold text-[#16a34a]">
                  {reportPending}건 승인 대기
                </span>
              </button>
            </div>
          ) : null}

          {/* ② 시트 승인 대기 */}
          {myCats.length && bySub.size ? (
            <div className="border-b border-[#f1f5f9] p-1">
              <div className="px-2 py-1 text-[11px] font-bold text-[#7c3aed]">시트 승인 대기</div>
              {[...bySub.values()].map(({ cat, subtype, n }) => (
                <button
                  className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-[#f8fafc]"
                  key={cat + '|||' + subtype}
                  onClick={() => openSheetGroup(cat, subtype)}
                  type="button"
                >
                  <span className="font-semibold text-[#334155]">
                    {cat} · {subtype} 시트
                  </span>
                  <span className="ml-2 shrink-0 rounded-full bg-[#f5f3ff] px-2 py-0.5 text-[11px] font-bold text-[#7c3aed]">
                    {n}건 승인 대기
                  </span>
                </button>
              ))}
            </div>
          ) : null}

          {/* ⓪ 신규 계약(계약완료 → 계약 관리 신규 등록 건) — 송민경·김종인 */}
          {seeNewContract && newContracts.length ? (
            <div className="border-b border-[#f1f5f9] p-1">
              <div className="px-2 py-1 text-[11px] font-bold text-[#1e40af]">신규 계약 (승인 필요)</div>
              <div className="grid max-h-[40vh] gap-0.5 overflow-y-auto">
                {newContracts.slice(0, 30).map((c) => (
                  <button
                    className="rounded-md px-2 py-1.5 text-left hover:bg-[#f8fafc]"
                    key={c.id}
                    onClick={() => openNewContract(c)}
                    type="button"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-semibold text-[#334155]">
                        {c.company || '(업체명 없음)'}
                      </span>
                      <span className="shrink-0 rounded bg-[#dbeafe] px-1.5 py-0.5 text-[10px] font-bold text-[#1e40af]">
                        신규 등록 건
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

          {/* ① 계약 미완료 */}
          {seePending && pendingClients.length ? (
            <div className="p-1">
              <div className="px-2 py-1 text-[11px] font-bold text-[#dc2626]">계약 미완료</div>
              <div className="grid max-h-[40vh] gap-0.5 overflow-y-auto">
                {pendingClients.slice(0, 30).map((c) => (
                  <button
                    className="rounded-md px-2 py-1.5 text-left hover:bg-[#f8fafc]"
                    key={c.id}
                    onClick={() => openPendingClient(c)}
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
