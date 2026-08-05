import type { ReactNode } from 'react'
import Header from './Header'
import Sidebar from './Sidebar'
import DevRoleSwitcher from './DevRoleSwitcher'
import ForcePasswordChangeGate from './ForcePasswordChangeGate'
import ReportPublishAlert from './ReportPublishAlert'
import SignupRequestAlert from './SignupRequestAlert'
import ReportToast from './ReportToast'

type LayoutProps = {
  children: ReactNode
  /** 별도 영역(누수탐지 ERP 등) — 회사 ERP 사이드바를 숨기고 본문만 전폭으로 쓴다. */
  hideSidebar?: boolean
}

// ⚠️ Tailwind 는 동적 클래스를 정적 스캔하지 못한다 — 완성된 클래스 문자열로 분기할 것.
const GRID_WITH_SIDEBAR =
  'grid h-svh overflow-hidden grid-cols-[240px_minmax(0,1fr)] max-[800px]:min-h-svh max-[800px]:grid-cols-1 max-[800px]:overflow-visible'
const GRID_FULL =
  'grid h-svh overflow-hidden grid-cols-1 max-[800px]:min-h-svh max-[800px]:overflow-visible'

function Layout({ children, hideSidebar = false }: LayoutProps) {
  return (
    <div className={hideSidebar ? GRID_FULL : GRID_WITH_SIDEBAR}>
      {hideSidebar ? null : <Sidebar />}

      <main className="min-h-0 min-w-0 overflow-y-auto p-8 max-[800px]:overflow-visible">
        <Header />
        {hideSidebar ? null : (
          <>
            <ReportPublishAlert />
            <SignupRequestAlert />
          </>
        )}
        {children}
      </main>
      <DevRoleSwitcher />
      <ForcePasswordChangeGate />
      <ReportToast />
    </div>
  )
}

export default Layout
