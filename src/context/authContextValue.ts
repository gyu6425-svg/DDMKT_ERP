import { createContext } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import type { Profile, UserRole } from '../types'
import type { Duty, Grant } from '../lib/permissions'

export type AuthContextValue = {
  isAdmin: boolean
  loading: boolean
  profile: Profile | null
  session: Session | null
  signOut: () => Promise<void>
  user: User | null
  // 권한 — 역할 등급 + 업무별 액션(duty) + 담당 시트.
  role: UserRole
  grant: Grant
  can: (duty: Duty) => boolean // 특정 액션 권한
  canManageSheet: (category: string) => boolean // 카테고리 시트 승인/진행 관리
  canEdit: boolean // 수정 가능(뷰어=false)
  // 개발용 역할 시뮬레이터(AUTH_DISABLED 동안만).
  simKey: string | null
  setSimKey: (key: string | null) => void
}

export const AuthContext = createContext<AuthContextValue | null>(null)
