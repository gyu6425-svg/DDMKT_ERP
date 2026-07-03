import fs from 'node:fs'
import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// 배포마다 바뀌는 빌드 식별자 — Cloudflare Pages는 커밋 SHA, 로컬은 타임스탬프.
//   앱에 __APP_VERSION__ 로 주입 + dist/version.json 에 기록 → 앱이 주기적으로 대조해 새 배포 감지(배너).
const BUILD_ID = process.env.CF_PAGES_COMMIT_SHA || String(Date.now())

// 빌드 후 dist/version.json 생성(항상 최신 배포 버전을 담음).
function writeVersionJson() {
  return {
    name: 'write-version-json',
    apply: 'build' as const,
    closeBundle() {
      try {
        const out = path.resolve(process.cwd(), 'dist', 'version.json')
        fs.mkdirSync(path.dirname(out), { recursive: true })
        fs.writeFileSync(out, JSON.stringify({ version: BUILD_ID }))
      } catch {
        // 무시 — 버전 파일 생성 실패해도 앱 빌드/동작에는 영향 없음.
      }
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(BUILD_ID),
  },
  plugins: [react(), tailwindcss(), writeVersionJson()],
  // onnxruntime-web(@imgly/background-removal 내부 의존)을 esbuild 사전번들링에서 제외.
  // Windows에서 사전번들링 중 자식 프로세스 spawn(EPERM)으로 실패하는 문제를 회피한다.
  optimizeDeps: {
    exclude: ['@imgly/background-removal', 'onnxruntime-web'],
  },
  server: {
    // crawler/(파이썬·카카오 자동화 Chrome 프로필)는 감시 제외 — 잠긴 파일(Cookies 등) EBUSY 크래시 방지.
    watch: {
      ignored: ['**/crawler/**'],
    },
    proxy: {
      '/api': {
        changeOrigin: true,
        // 이미지 생성은 1~2분 이상 걸릴 수 있어 프록시가 중간에 연결을 끊지 않도록 넉넉히.
        proxyTimeout: 600000,
        target: 'http://127.0.0.1:8787',
        timeout: 600000,
      },
    },
  },
})
