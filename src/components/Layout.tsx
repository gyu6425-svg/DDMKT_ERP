import { useEffect, useState, type ReactNode } from 'react'
import Header from './Header'
import Sidebar from './Sidebar'
import DevRoleSwitcher from './DevRoleSwitcher'
import ForcePasswordChangeGate from './ForcePasswordChangeGate'
import { CustomerGuide } from './CustomerGuide'
import { ChargeGuide } from './ChargeGuide'
import ReportPublishAlert from './ReportPublishAlert'
import SignupRequestAlert from './SignupRequestAlert'
import TokenApprovalAlert from './TokenApprovalAlert'
import ReportToast from './ReportToast'

type LayoutProps = {
  children: ReactNode
}

function Layout({ children }: LayoutProps) {
  // 경로 추적 — 누수탐지 ERP(별도 영역)에서는 기자단 알림을 띄우지 않는다.
  const [path, setPath] = useState(() => window.location.pathname)
  useEffect(() => {
    const sync = () => setPath(window.location.pathname)
    window.addEventListener('popstate', sync)
    window.addEventListener('app:navigate', sync)
    return () => {
      window.removeEventListener('popstate', sync)
      window.removeEventListener('app:navigate', sync)
    }
  }, [])
  // 기자단 글 보고 알림 = 상단 배너(ReportPublishAlert) + 실시간 팝업(ReportToast).
  //   누수 ERP 는 기자단과 무관한 영역이라 둘 다 렌더하지 않는다(미렌더 = Realtime 구독도 안 걸림).
  const isLeakErp = path.startsWith('/leak')

  return (
    <div className="grid h-svh overflow-hidden grid-cols-[240px_minmax(0,1fr)] max-[800px]:min-h-svh max-[800px]:grid-cols-1 max-[800px]:overflow-visible">
      <Sidebar />

      <main className="min-h-0 min-w-0 overflow-y-auto p-8 max-[800px]:overflow-visible">
        <Header />
        {!isLeakErp ? <ReportPublishAlert /> : null}
        <SignupRequestAlert />
        <TokenApprovalAlert />
        {children}
      </main>
      <DevRoleSwitcher />
      <ForcePasswordChangeGate />
      <CustomerGuide />
      <ChargeGuide />
      {!isLeakErp ? <ReportToast /> : null}
    </div>
  )
}

export default Layout
