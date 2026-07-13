import type { ReactNode } from 'react'
import Header from './Header'
import Sidebar from './Sidebar'
import DevRoleSwitcher from './DevRoleSwitcher'
import ForcePasswordChangeGate from './ForcePasswordChangeGate'
import ReportPublishAlert from './ReportPublishAlert'

type LayoutProps = {
  children: ReactNode
}

function Layout({ children }: LayoutProps) {
  return (
    <div className="grid h-svh overflow-hidden grid-cols-[240px_minmax(0,1fr)] max-[800px]:min-h-svh max-[800px]:grid-cols-1 max-[800px]:overflow-visible">
      <Sidebar />

      <main className="min-h-0 min-w-0 overflow-y-auto p-8 max-[800px]:overflow-visible">
        <Header />
        <ReportPublishAlert />
        {children}
      </main>
      <DevRoleSwitcher />
      <ForcePasswordChangeGate />
    </div>
  )
}

export default Layout
