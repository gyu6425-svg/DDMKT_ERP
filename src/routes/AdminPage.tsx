import { useEffect, useState } from 'react'
import ApiUsagePanel from '../components/ApiUsagePanel'
import AdminUsersPanel from '../components/AdminUsersPanel'
import PendingSignupsPanel from '../components/PendingSignupsPanel'
import CafeDeployAdminPanel from '../components/CafeDeployAdminPanel'
import OrgTreePanel from '../components/OrgTreePanel'
import TokenChargePanel from '../components/TokenChargePanel'
import { useAuth } from '../hooks/useAuth'
import { canManagePermissions, canSeeAdminPage } from '../lib/permissions'
import { SIGNUP_ENABLED } from '../lib/authConfig'

function AdminPage() {
    const { isAdmin, profile } = useAuth()
    const canUsers = canManagePermissions(profile?.email) // 사원 관리 = 김종인(대표)만
    type AdminTab = 'users' | 'signups' | 'api' | 'cafe' | 'deploy' | 'orgs' | 'tokens'
    const tabFromUrl = () => (new URLSearchParams(window.location.search).get('tab') || '') as AdminTab
    const [tab, setTab] = useState<AdminTab>(() => tabFromUrl() || (canUsers ? 'users' : 'api'))
    // 사이드바 하위메뉴(/admin?tab=)로 진입 시 탭 동기화.
    useEffect(() => {
        const sync = () => { const t = tabFromUrl(); if (t) setTab(t) }
        window.addEventListener('popstate', sync)
        window.addEventListener('app:navigate', sync)
        return () => { window.removeEventListener('popstate', sync); window.removeEventListener('app:navigate', sync) }
    }, [])

    if (!isAdmin && !canSeeAdminPage(profile?.email)) {
        return (
            <section className="min-h-[320px] rounded-[8px] border border-[#e5e7eb] bg-white p-12">
                <h2 className="m-0 text-[24px] font-semibold text-[#111111]">접근 권한이 없습니다</h2>
                <p className="mt-4 mb-0 text-[16px] font-medium text-[#555555]">
                    관리자 계정으로 로그인해야 볼 수 있는 페이지입니다.
                </p>
            </section>
        )
    }

    const active =
        tab === 'users' && canUsers
            ? 'users'
            : tab === 'signups' && SIGNUP_ENABLED
              ? 'signups'
              : tab === 'cafe'
                ? 'cafe'
                : tab === 'deploy'
                  ? 'deploy'
                  : tab === 'orgs'
                    ? 'orgs'
                    : tab === 'tokens'
                      ? 'tokens'
                      : 'api'

    return (
        <section className="min-h-[320px] rounded-[8px] border border-[#e5e7eb] bg-white p-8">
            {/* 섹션 제목 — 탭 네비게이션은 사이드바 '관리자 페이지' 하위메뉴로 이동 */}
            <div className="mb-5 border-b border-[#e2e8f0] pb-3 text-[18px] font-bold text-[#111111]">
                {active === 'users' ? '사원 관리'
                    : active === 'signups' ? '가입 승인'
                    : active === 'cafe' ? '카페 원고 생성기'
                    : active === 'deploy' ? '카페 접수'
                    : active === 'orgs' ? '조직 관리'
                    : active === 'tokens' ? '토큰 구매'
                    : 'API 사용량'}
            </div>

            {active === 'users' ? (
                <AdminUsersPanel />
            ) : active === 'signups' ? (
                <PendingSignupsPanel />
            ) : active === 'cafe' ? (
                <ApiUsagePanel scope="cafe" />
            ) : active === 'deploy' ? (
                <CafeDeployAdminPanel />
            ) : active === 'orgs' ? (
                <OrgTreePanel />
            ) : active === 'tokens' ? (
                <TokenChargePanel />
            ) : (
                <ApiUsagePanel />
            )}
        </section>
    )
}

export default AdminPage
