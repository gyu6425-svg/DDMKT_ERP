import type { ReactNode } from 'react'
import { useEffect } from 'react'
import { AUTH_DISABLED } from '../lib/authConfig'
import { useAuth } from '../hooks/useAuth'

type ProtectedRouteProps = {
  children: ReactNode
}

function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { loading, user } = useAuth()

  useEffect(() => {
    // 임시: 인증 끔 — 로그인 화면으로 보내지 않음(익명 세션은 AuthContext 가 자동 발급).
    if (!AUTH_DISABLED && !loading && !user) {
      window.location.href = '/login'
    }
  }, [loading, user])

  if (loading) {
    return <div className="p-8">Loading...</div>
  }

  if (!AUTH_DISABLED && !user) {
    return null
  }

  return children
}

export default ProtectedRoute
