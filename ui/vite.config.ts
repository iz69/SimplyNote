import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
/*
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: 'dist',
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: ['localhost', '127.0.0.1', 'tgn.dohne-ray.ts.net'],
  },
})
*/

export default defineConfig(({ mode }) => {

//  const basePath = process.env.VITE_BASE_PATH || '/'
  const basePath = '/'

  return {
    base: basePath.endsWith('/') ? basePath : `${basePath}/`,
    plugins: [react()],
    build: {
      outDir: 'dist',
    },
    server: {
      host: '0.0.0.0',
      port: 5173,
      allowedHosts: ['localhost', '127.0.0.1', 'tgn.dohne-ray.ts.net'],
      hmr: {
        host: 'tgn.dohne-ray.ts.net',
        protocol: 'wss',
        path: basePath,
      },
      proxy: {
        [`${basePath}api`]: {
          target: 'http://simplynote:8000',
          changeOrigin: true,
          rewrite: (path) => path.replace(new RegExp(`^${basePath}api`), ''),
        },
      },
    },
  }
})
