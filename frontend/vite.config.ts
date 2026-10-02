import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// docker-compose.yml (dev profile) sets API_PROXY_TARGET=http://backend:8000.
const backend = process.env.API_PROXY_TARGET ?? 'http://localhost:8000'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: backend, changeOrigin: true },
      '/healthz': { target: backend, changeOrigin: true },
    },
  },
  build: {
    // FastAPI serves the SPA from backend/static (TRD §2: one container, no CORS).
    outDir: '../backend/static',
    emptyOutDir: true,
  },
})
