import type { Session, User } from '@supabase/supabase-js'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { getSession, signOut as signOutRequest } from '../api/auth'
import { AUTH_DISABLED } from '../lib/authConfig'
import { supabase } from '../lib/supabase'
import type { Profile, UserRole } from '../types'
import {
  canDo,
  canEdit as canEditGrant,
  canManageSheet as canManageSheetGrant,
  presetByKey,
  readRoleSim,
  writeRoleSim,
  type Duty,
  type Grant,
} from '../lib/permissions'
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
  // 개발용 역할 시뮬레이터 — auth 켜기 전까지 각 역할로 UI 게이팅 테스트.
  const [simKey, setSimKeyState] = useState<string | null>(readRoleSim)
  const setSimKey = useCallback((key: string | null) => {
    setSimKeyState(key)
    writeRoleSim(key)
  }, [])

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
    getSession().then(async ({ data }) => {
      // 임시: 인증 끔 — 세션 없으면 익명으로 자동 로그인(RLS 통과용).
      if (AUTH_DISABLED && !data.session) {
        const { data: anon } = await supabase.auth.signInAnonymously()
        void syncSession(anon.session)
        return
      }
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

  // 권한 grant — 개발중(AUTH_DISABLED)엔 시뮬레이터, 실제론 profile(role/duties/sheet_categories) 기준.
  const grant: Grant = useMemo(() => {
    if (AUTH_DISABLED) {
      const p = presetByKey(simKey)
      return p
        ? { role: p.role, duties: p.duties, sheetCategories: p.sheetCategories }
        : { role: 'admin', duties: [], sheetCategories: [] } // 기본=슈퍼 어드민(전권)
    }
    return {
      role: (isAdmin ? 'admin' : (profile?.role as UserRole)) ?? 'viewer',
      duties: (profile?.duties as Duty[] | undefined) ?? [],
      sheetCategories: profile?.sheet_categories ?? [],
    }
  }, [simKey, isAdmin, profile])

  const value = useMemo(
    () => ({
      isAdmin: grant.role === 'admin',
      loading,
      profile,
      session,
      signOut,
      user: session?.user ?? null,
      role: grant.role,
      grant,
      can: (duty: Duty) => canDo(grant, duty),
      canManageSheet: (category: string) => canManageSheetGrant(grant, category),
      canEdit: canEditGrant(grant),
      simKey,
      setSimKey,
    }),
    [grant, loading, profile, session, signOut, simKey, setSimKey],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
