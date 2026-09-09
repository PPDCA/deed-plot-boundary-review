import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    // Needed so the dev server accepts requests arriving with a tunnel
    // hostname (e.g. *.trycloudflare.com) instead of localhost.
    allowedHosts: true,
    proxy: {
      '/api': 'http://127.0.0.1:8000',
    },
  },
})
