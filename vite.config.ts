import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
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
