import { useState } from 'react'
import { AUTH_DISABLED } from '../lib/authConfig'
import { ROLE_PRESETS } from '../lib/permissions'
import { useAuth } from '../hooks/useAuth'

// 개발용 역할 시뮬레이터 — 로그인(AUTH_DISABLED) 켜기 전까지 각 역할로 UI 권한을 미리 테스트.
//   실제 로그인 활성화(AUTH_DISABLED=false) 시 자동으로 사라진다.
export default function DevRoleSwitcher() {
  const { simKey, setSimKey, role } = useAuth()
  const [open, setOpen] = useState(false)
  if (!AUTH_DISABLED) return null

  const current = ROLE_PRESETS.find((p) => p.key === simKey)

  return (
    <div className="fixed bottom-3 left-3 z-[100] text-xs">
      {open ? (
        <div className="w-64 rounded-lg border border-[#f59e0b] bg-white p-2 shadow-lg">
          <div className="mb-1 flex items-center justify-between">
            <span className="font-bold text-[#b45309]">역할 시뮬레이터(개발)</span>
            <button className="text-[#94a3b8] hover:text-[#dc2626]" onClick={() => setOpen(false)} type="button">
              ✕
            </button>
          </div>
          <div className="grid max-h-[50vh] gap-1 overflow-y-auto">
            {ROLE_PRESETS.map((p) => (
              <button
                className={`rounded border px-2 py-1 text-left ${
                  simKey === p.key
                    ? 'border-[#1e40af] bg-[#eff6ff] font-bold text-[#1e40af]'
                    : 'border-[#e2e8f0] hover:bg-[#f8fafc]'
                }`}
                key={p.key}
                onClick={() => setSimKey(p.key)}
                type="button"
              >
                <span className="block">{p.label}</span>
                <span className="block text-[10px] text-[#94a3b8]">
                  {p.role}
                  {p.duties.length ? ` · ${p.duties.length}권한` : ' · 전권'}
                  {p.sheetCategories.length ? ` · [${p.sheetCategories.join(',')}]` : ''}
                </span>
              </button>
            ))}
            <button
              className="mt-1 rounded border border-[#cbd5e1] px-2 py-1 text-center text-[#64748b] hover:bg-[#f1f5f9]"
              onClick={() => setSimKey(null)}
              type="button"
            >
              기본(슈퍼 어드민)으로
            </button>
          </div>
        </div>
      ) : (
        <button
          className="rounded-full border border-[#f59e0b] bg-[#fffbeb] px-3 py-1.5 font-bold text-[#b45309] shadow hover:bg-[#fef3c7]"
          onClick={() => setOpen(true)}
          title="개발용 역할 전환 — 로그인 켜면 사라짐"
          type="button"
        >
          🔑 {current ? current.label.split(' ·')[0] : `역할: ${role}`}
        </button>
      )}
    </div>
  )
}
