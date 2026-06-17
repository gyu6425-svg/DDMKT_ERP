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
    proxy: {
      '/api': 'http://127.0.0.1:8787',
    },
  },
})
