import { createContext } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import type { Profile } from '../types'

export type AuthContextValue = {
  isAdmin: boolean
  loading: boolean
  profile: Profile | null
  session: Session | null
  signOut: () => Promise<void>
  user: User | null
}

export const AuthContext = createContext<AuthContextValue | null>(null)
