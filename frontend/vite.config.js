import { execSync } from 'node:child_process'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

function resolveAppRelease() {
  if (process.env.VITE_APP_RELEASE) {
    return process.env.VITE_APP_RELEASE
  }
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim()
  } catch {
    return 'dev'
  }
}

const appRelease = resolveAppRelease()

// https://vitejs.dev/config/
export default defineConfig({
  base: './',
  plugins: [react()],
  define: {
    'import.meta.env.VITE_APP_RELEASE': JSON.stringify(appRelease),
  },
  build: {
    sourcemap: 'hidden',
  },
  optimizeDeps: {
    // Only scan src/ for deps; prevents Vite from crawling ios/android build output
    entries: ['src/**/*.{js,jsx,ts,tsx}'],
  },
  server: {
    port: 5173,
    host: true, // Listen on all interfaces so mobile devices can reach the dev server
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      }
    }
  }
})
