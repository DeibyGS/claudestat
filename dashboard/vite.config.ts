import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    // En dev, proxy /stream y /sessions al daemon
    proxy: {
      '/stream':   'http://localhost:7337',
      '/sessions': 'http://localhost:7337',
      '/intelligence': 'http://localhost:7337',
      '/health':   'http://localhost:7337',
      '/event':    'http://localhost:7337',
    }
  }
})
