import type { ReactNode } from 'react'
import { useAuth } from '../hooks/useAuth'

type AdminOnlyProps = {
  children: ReactNode
}

function AdminOnly({ children }: AdminOnlyProps) {
  const { isAdmin } = useAuth()

  if (!isAdmin) {
    return null
  }

  return children
}

export default AdminOnly
