import type { ReactNode } from 'react'
import { useEffect } from 'react'
import { useAuth } from '../hooks/useAuth'

type ProtectedRouteProps = {
  children: ReactNode
}

function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { loading, user } = useAuth()

  useEffect(() => {
    if (!loading && !user) {
      window.location.href = '/login'
    }
  }, [loading, user])

  if (loading) {
    return <div className="p-8">Loading...</div>
  }

  if (!user) {
    return null
  }

  return children
}

export default ProtectedRoute
