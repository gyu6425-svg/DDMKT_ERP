import { createClient } from '@supabase/supabase-js'

// ── 백엔드 전환 스위치 ───────────────────────────────────────────────────────
//   왜: Supabase 클라우드(무료)가 Egress 초과로 402 제한을 맞을 수 있다. 자체호스팅으로
//       옮겨야 하는데, 옮기는 순간 '전원 동시 전환'을 하면 되돌릴 방법이 없다.
//       그래서 ①브라우저 하나만 새 백엔드로 먼저 붙여 검증하고 ②문제 없으면 전체를 돌린다.
//
//   우선순위
//     1) localStorage 오버라이드  — 이 브라우저만. 전환 리허설·긴급 우회용(배포 불필요, 즉시)
//     2) 빌드타임 VITE_ 환경변수  — 전체 사용자. 값 바꾸고 배포하면 모두 전환(약 3분)
//
//   콘솔에서 쓰는 법(관리자):
//     ddmkt.useBackend('https://db.ddmkt.example', 'eyJ...anon key...')   // 이 브라우저만 전환
//     ddmkt.useBackend(null)                                             // 원래대로
//     ddmkt.whichBackend()                                               // 지금 붙어 있는 곳
const OVERRIDE_KEY = 'ddmkt.backend.override'

type Override = { url: string; key: string }

function readOverride(): Override | null {
    try {
        const raw = localStorage.getItem(OVERRIDE_KEY)
        if (!raw) return null
        const o = JSON.parse(raw) as Partial<Override>
        // http(s) 주소 + 키가 둘 다 있어야 인정 — 반쪽짜리 값으로 앱이 죽는 걸 막는다.
        if (!o.url || !o.key || !/^https?:\/\//.test(o.url)) return null
        return { url: o.url, key: o.key }
    } catch {
        return null
    }
}

const envUrl = import.meta.env.VITE_SUPABASE_URL
const envKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
const override = typeof window !== 'undefined' ? readOverride() : null

const supabaseUrl = override?.url || envUrl
const supabasePublishableKey = override?.key || envKey
const fallbackSupabaseUrl = 'https://placeholder.supabase.co'
const fallbackSupabaseKey = 'placeholder-key'

export const hasSupabaseConfig = Boolean(supabaseUrl && supabasePublishableKey)
// 지금 어느 백엔드에 붙어 있는지 — 전환 리허설 때 '진짜 바뀌었는지' 눈으로 확인하는 근거.
export const backendUrl = supabaseUrl || ''
// 고객 agent.env 생성 등, 클라이언트 밖에서 같은 키가 필요한 곳이 쓴다(오버라이드 반영).
export const backendKey = supabasePublishableKey || ''
export const backendIsOverride = Boolean(override)

export const supabase = createClient(
  supabaseUrl || fallbackSupabaseUrl,
  supabasePublishableKey || fallbackSupabaseKey,
)

if (typeof window !== 'undefined') {
    // 오버라이드가 걸려 있으면 조용히 넘어가지 않는다 — 리허설 브라우저인 걸 항상 알 수 있게.
    if (override) {
        console.warn(`[DDMKT] 백엔드 오버라이드 사용 중 → ${override.url} (해제: ddmkt.useBackend(null))`)
    }
    ;(window as unknown as { ddmkt?: Record<string, unknown> }).ddmkt = {
        ...((window as unknown as { ddmkt?: Record<string, unknown> }).ddmkt || {}),
        useBackend(url: string | null, key?: string) {
            if (!url) {
                localStorage.removeItem(OVERRIDE_KEY)
                console.warn('[DDMKT] 오버라이드 해제 — 새로고침하면 원래 백엔드로 돌아갑니다.')
                return
            }
            if (!key) { console.error('[DDMKT] anon key 도 함께 넣어야 합니다.'); return }
            localStorage.setItem(OVERRIDE_KEY, JSON.stringify({ url, key }))
            console.warn(`[DDMKT] 이 브라우저만 ${url} 로 전환 — 새로고침하세요.`)
        },
        whichBackend() {
            return { url: backendUrl, override: backendIsOverride }
        },
    }
}
