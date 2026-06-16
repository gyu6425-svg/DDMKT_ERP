import type { ReactNode } from 'react'
import Header from './Header'
import Sidebar from './Sidebar'

type LayoutProps = {
  children: ReactNode
}

function Layout({ children }: LayoutProps) {
  return (
    <div className="grid min-h-svh grid-cols-[240px_minmax(0,1fr)] max-[800px]:grid-cols-1">
      <Sidebar />

      <main className="min-w-0 p-8">
        <Header />
        {children}
      </main>
    </div>
  )
}

export default Layout
