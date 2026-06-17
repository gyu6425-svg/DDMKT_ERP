import type { Session, User } from '@supabase/supabase-js'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { getSession, signOut as signOutRequest } from '../api/auth'
import { supabase } from '../lib/supabase'
import type { Profile } from '../types'
import { AuthContext } from './authContextValue'

type AuthProviderProps = {
  children: ReactNode
}

function isAdminRole(role: string) {
  return ['admin', '관리자'].includes(role.trim().toLowerCase())
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [loading, setLoading] = useState(true)
  const [isAdmin, setIsAdmin] = useState(false)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [session, setSession] = useState<Session | null>(null)

  const loadProfile = useCallback(async (user: User) => {
    const userId = user.id
    const roles = [
      user.app_metadata?.role,
      user.user_metadata?.role,
    ].filter((role): role is string => typeof role === 'string')

    const { data: profileData } = await supabase
      .from('profiles')
      .select('*')
      .eq('user_id', userId)
      .eq('is_active', true)
      .maybeSingle<Profile>()

    if (profileData?.role) {
      roles.push(profileData.role)
    }

    if (profileData?.id) {
      const { data: salespersonByProfileId } = await supabase
        .from('sales_people')
        .select('role')
        .eq('profile_id', profileData.id)
        .maybeSingle<{ role: string | null }>()

      if (salespersonByProfileId?.role) {
        roles.push(salespersonByProfileId.role)
      }
    }

    const { data: salespersonById } = await supabase
      .from('sales_people')
      .select('role')
      .eq('id', userId)
      .maybeSingle<{ role: string | null }>()

    if (salespersonById?.role) {
      roles.push(salespersonById.role)
    }

    if (user.email) {
      const { data: salespersonByEmail } = await supabase
        .from('sales_people')
        .select('role')
        .eq('email', user.email)
        .maybeSingle<{ role: string | null }>()

      if (salespersonByEmail?.role) {
        roles.push(salespersonByEmail.role)
      }
    }

    setProfile(profileData ?? null)
    setIsAdmin(roles.some(isAdminRole))
  }, [])

  const syncSession = useCallback(async (nextSession: Session | null) => {
    setSession(nextSession)

    if (nextSession?.user) {
      await loadProfile(nextSession.user)
    } else {
      setProfile(null)
      setIsAdmin(false)
    }

    setLoading(false)
  }, [loadProfile])

  const signOut = useCallback(async () => {
    await signOutRequest()
    setSession(null)
    setProfile(null)
    setIsAdmin(false)
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
      isAdmin,
      loading,
      profile,
      session,
      signOut,
      user: session?.user ?? null,
    }),
    [isAdmin, loading, profile, session, signOut],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
