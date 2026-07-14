import type { Session, User } from '@supabase/supabase-js'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
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
  const [pending, setPending] = useState(false) // 프로필 비활성(회원가입 승인 대기)
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

    // 프로필은 활성 여부와 무관하게 읽는다(RLS 'profiles self read'로 본인 행 열람 가능).
    //   비활성(is_active=false) = 회원가입 후 승인 대기 → grant/역할엔 쓰지 않고 pending 으로만 표시.
    const { data: profileRow } = await supabase
      .from('profiles')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle<Profile>()
    const profileData = profileRow?.is_active ? profileRow : null
    setPending(!!profileRow && !profileRow.is_active)

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

  // 마지막으로 프로필을 로드한 유저 id — 포커스 복귀 시 반복 발생하는 auth 이벤트에서 재조회 여부 판단.
  const lastUserId = useRef<string | null>(null)

  const syncSession = useCallback(async (nextSession: Session | null) => {
    lastUserId.current = nextSession?.user?.id ?? null
    setSession(nextSession)

    if (nextSession?.user) {
      await loadProfile(nextSession.user)
    } else {
      setProfile(null)
      setIsAdmin(false)
      setPending(false)
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
      // 로그인 켜짐: 남아있는 익명 세션은 폐기(권한 없는 상태로 갇히는 것 방지) → 로그인 화면.
      if (!AUTH_DISABLED && data.session?.user?.is_anonymous) {
        await signOutRequest()
        void syncSession(null)
        return
      }
      void syncSession(data.session)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      const uid = nextSession?.user?.id ?? null
      // 탭 포커스 복귀 시 Supabase가 TOKEN_REFRESHED/SIGNED_IN 을 반복 발생 → 같은 유저면
      //   프로필 재조회를 건너뛰고 세션 토큰만 갱신(재조회로 인한 화면 초기화 방지).
      if (uid && uid === lastUserId.current) {
        setSession(nextSession)
        return
      }
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
      pending,
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
    [grant, loading, profile, pending, session, signOut, simKey, setSimKey],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
