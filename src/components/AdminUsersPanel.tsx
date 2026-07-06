import { useEffect, useState } from 'react'
import { getProfiles, updateProfile } from '../api/profiles'
import { DUTIES, DUTY_LABELS, type Duty } from '../lib/permissions'
import type { Profile, UserRole } from '../types'

const ROLES: { value: UserRole; label: string }[] = [
  { value: 'admin', label: '관리자' },
  { value: 'manager', label: '매니저' },
  { value: 'sales', label: '사원' },
  { value: 'viewer', label: '고객(열람)' },
]
const DUTY_LIST = Object.values(DUTIES) as Duty[]
const SHEET_CATS = ['플레이스', '인스타', '카페', '쇼핑', '파워링크', '영상', '블로그']

// 계정 권한 편집 — 대표(김종인)만 접근(AdminPage에서 게이트). 역할·담당(duty)·담당 시트·활성.
export default function AdminUsersPanel() {
  const [rows, setRows] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [savingId, setSavingId] = useState<string | null>(null)
  const [msg, setMsg] = useState('')

  const load = async () => {
    setLoading(true)
    const { data, error } = await getProfiles()
    setLoading(false)
    if (error) setErr(error.message)
    else setRows(data)
  }
  useEffect(() => {
    void load()
  }, [])

  const patchLocal = (id: string, patch: Partial<Profile>) =>
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)))

  const toggleInArray = (arr: string[] | null | undefined, v: string) => {
    const s = new Set(arr ?? [])
    s.has(v) ? s.delete(v) : s.add(v)
    return [...s]
  }

  const save = async (p: Profile) => {
    setSavingId(p.id)
    setMsg('')
    const { error } = await updateProfile(p.id, {
      role: p.role,
      duties: p.duties ?? [],
      sheet_categories: p.sheet_categories ?? [],
      is_active: p.is_active,
    })
    setSavingId(null)
    if (error) setErr('저장 실패: ' + error.message)
    else setMsg(`${p.name || p.email} 권한 저장됨`)
  }

  if (loading) return <p className="text-sm text-[#64748b]">불러오는 중…</p>
  if (err)
    return (
      <p className="text-sm text-[#dc2626]">
        {err}
        <br />
        (관리자 profiles 접근 RLS가 적용됐는지 확인 필요 — docs/admin-profiles-rls.sql)
      </p>
    )

  return (
    <div className="grid gap-3">
      <div className="flex items-center gap-2">
        <h3 className="m-0 text-lg font-bold text-[#0f172a]">계정 권한 관리</h3>
        <span className="text-xs text-[#94a3b8]">역할·담당 업무·담당 시트를 바꾸고 저장</span>
        {msg ? <span className="ml-auto text-xs font-semibold text-[#059669]">{msg}</span> : null}
      </div>
      <div className="grid gap-2">
        {rows.map((p) => {
          const showDuties = p.role === 'manager' || p.role === 'sales'
          const showSheets = showDuties && (p.duties ?? []).includes(DUTIES.SHEET_MANAGE)
          return (
            <div className="rounded-lg border border-[#e2e8f0] bg-white p-3" key={p.id}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-bold text-[#0f172a]">{p.name || '(이름 없음)'}</span>
                <span className="text-xs text-[#94a3b8]">{p.email}</span>
                <select
                  className="ml-auto h-8 rounded-md border border-[#cbd5e1] px-2 text-sm"
                  onChange={(e) => patchLocal(p.id, { role: e.target.value as UserRole })}
                  value={p.role}
                >
                  {ROLES.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
                <label className="flex items-center gap-1 text-xs">
                  <input
                    checked={!!p.is_active}
                    onChange={(e) => patchLocal(p.id, { is_active: e.target.checked })}
                    type="checkbox"
                  />
                  활성
                </label>
                <button
                  className="rounded-md bg-[#1e40af] px-3 py-1.5 text-xs font-bold text-white disabled:opacity-60"
                  disabled={savingId === p.id}
                  onClick={() => void save(p)}
                  type="button"
                >
                  {savingId === p.id ? '저장 중…' : '저장'}
                </button>
              </div>

              {showDuties ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {DUTY_LIST.map((d) => {
                    const on = (p.duties ?? []).includes(d)
                    return (
                      <button
                        className={`rounded border px-2 py-0.5 text-[11px] font-semibold ${
                          on
                            ? 'border-[#1e40af] bg-[#1e40af] text-white'
                            : 'border-[#cbd5e1] bg-white text-[#475569]'
                        }`}
                        key={d}
                        onClick={() => patchLocal(p.id, { duties: toggleInArray(p.duties, d) })}
                        type="button"
                      >
                        {DUTY_LABELS[d]}
                      </button>
                    )
                  })}
                </div>
              ) : null}

              {showSheets ? (
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] text-[#94a3b8]">담당 시트:</span>
                  {SHEET_CATS.map((cat) => {
                    const on = (p.sheet_categories ?? []).includes(cat)
                    return (
                      <button
                        className={`rounded-full border px-2 py-0.5 text-[11px] ${
                          on
                            ? 'border-[#7c3aed] bg-[#f5f3ff] font-bold text-[#7c3aed]'
                            : 'border-[#cbd5e1] bg-white text-[#94a3b8]'
                        }`}
                        key={cat}
                        onClick={() =>
                          patchLocal(p.id, { sheet_categories: toggleInArray(p.sheet_categories, cat) })
                        }
                        type="button"
                      >
                        {cat}
                      </button>
                    )
                  })}
                  <span className="text-[10px] text-[#cbd5e1]">(비우면 담당 시트 없음)</span>
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}
