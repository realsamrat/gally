import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The public demo site (`npm run dev:site`, `npm run build:site`). Its photos are the fixtures in
// public/ (`npm run fixtures`), served as static files.
export default defineConfig({
  root: 'site',
  publicDir: '../public',
  plugins: [react()],
  server: { port: 4318 },
  preview: { port: 4318 },
  build: { outDir: '../site-dist', emptyOutDir: true, target: 'es2022' },
})
