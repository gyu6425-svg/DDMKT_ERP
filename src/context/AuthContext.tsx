import type { Session } from '@supabase/supabase-js'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { getSession, signOut as signOutRequest } from '../api/auth'
import { supabase } from '../lib/supabase'
import type { Profile } from '../types'
import { AuthContext } from './authContextValue'

type AuthProviderProps = {
  children: ReactNode
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [loading, setLoading] = useState(true)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [session, setSession] = useState<Session | null>(null)

  const loadProfile = useCallback(async (userId: string) => {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('user_id', userId)
      .eq('is_active', true)
      .maybeSingle<Profile>()

    setProfile(data ?? null)
  }, [])

  const syncSession = useCallback(async (nextSession: Session | null) => {
    setSession(nextSession)

    if (nextSession?.user) {
      await loadProfile(nextSession.user.id)
    } else {
      setProfile(null)
    }

    setLoading(false)
  }, [loadProfile])

  const signOut = useCallback(async () => {
    await signOutRequest()
    setSession(null)
    setProfile(null)
    window.location.href = '/login'
  }, [])

  useEffect(() => {
    getSession().then(({ data }) => {
      void syncSession(data.session)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      void syncSession(nextSession)
    })

    return () => {
      subscription.unsubscribe()
    }
  }, [syncSession])

  const value = useMemo(
    () => ({
      isAdmin: profile?.role === 'admin',
      loading,
      profile,
      session,
      signOut,
      user: session?.user ?? null,
    }),
    [loading, profile, session, signOut],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
