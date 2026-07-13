import { useState } from 'react'
import ApiUsagePanel from '../components/ApiUsagePanel'
import AdminUsersPanel from '../components/AdminUsersPanel'
import { useAuth } from '../hooks/useAuth'
import { canManagePermissions } from '../lib/permissions'

function AdminPage() {
    const { isAdmin, profile } = useAuth()
    const canUsers = canManagePermissions(profile?.email) // 사원 관리 = 김종인(대표)만
    const [tab, setTab] = useState<'users' | 'api' | 'cafe'>(canUsers ? 'users' : 'api')

    if (!isAdmin) {
        return (
            <section className="min-h-[320px] rounded-[8px] border border-[#e5e7eb] bg-white p-12">
                <h2 className="m-0 text-[24px] font-semibold text-[#111111]">접근 권한이 없습니다</h2>
                <p className="mt-4 mb-0 text-[16px] font-medium text-[#555555]">
                    관리자 계정으로 로그인해야 볼 수 있는 페이지입니다.
                </p>
            </section>
        )
    }

    const active = tab === 'users' && canUsers ? 'users' : tab === 'cafe' ? 'cafe' : 'api'

    return (
        <section className="min-h-[320px] rounded-[8px] border border-[#e5e7eb] bg-white p-8">
            {/* 상단 탭 — 사원 관리(대표만) + API 사용량 */}
            <div className="mb-5 flex gap-1 border-b border-[#e2e8f0]">
                {canUsers ? (
                    <button
                        className={`-mb-px border-b-2 px-4 py-2 text-sm font-bold ${
                            active === 'users'
                                ? 'border-[#1e40af] text-[#1e40af]'
                                : 'border-transparent text-[#94a3b8] hover:text-[#475569]'
                        }`}
                        onClick={() => setTab('users')}
                        type="button"
                    >
                        사원 관리
                    </button>
                ) : null}
                <button
                    className={`-mb-px border-b-2 px-4 py-2 text-sm font-bold ${
                        active === 'api'
                            ? 'border-[#1e40af] text-[#1e40af]'
                            : 'border-transparent text-[#94a3b8] hover:text-[#475569]'
                    }`}
                    onClick={() => setTab('api')}
                    type="button"
                >
                    API 사용량
                </button>
                <button
                    className={`-mb-px border-b-2 px-4 py-2 text-sm font-bold ${
                        active === 'cafe'
                            ? 'border-[#1e40af] text-[#1e40af]'
                            : 'border-transparent text-[#94a3b8] hover:text-[#475569]'
                    }`}
                    onClick={() => setTab('cafe')}
                    type="button"
                >
                    카페 원고 생성기
                </button>
            </div>

            {active === 'users' ? (
                <AdminUsersPanel />
            ) : active === 'cafe' ? (
                <ApiUsagePanel scope="cafe" />
            ) : (
                <ApiUsagePanel />
            )}
        </section>
    )
}

export default AdminPage
