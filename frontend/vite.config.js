import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  base: './',
  plugins: [react()],
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

