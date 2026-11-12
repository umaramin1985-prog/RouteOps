import fs from 'node:fs'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const apiTarget =
  process.env.VITE_API_TARGET ||
  (fs.existsSync('/.dockerenv') ? 'http://backend:8000' : 'http://127.0.0.1:8000')

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // Need this for docker
    port: 5173,
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, '')
      }
    }
  }
})
