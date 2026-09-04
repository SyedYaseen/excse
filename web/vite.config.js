import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Build output goes to the repo-root `dist/`, which is what the Rust server
// serves (and what the Dockerfile copies into the runtime image).
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
  server: {
    host: true,
    proxy: {
      '/api': 'http://127.0.0.1:3005',
    },
  },
})
