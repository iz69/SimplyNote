import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig(({ mode }) => {

  const env = loadEnv(mode, process.cwd(), '')
  const hostName = env.VITE_HOST_NAME || 'localhost'

  const basePath = env.VITE_BASE_PATH || '/'

  return {
//    base: '/',
    base: basePath,
    publicDir: 'public',
    plugins: [react()],

    build: {
      outDir: 'dist',
      emptyOutDir: true,
      rollupOptions: {
        input: {
          main: resolve(__dirname, 'index.html'),
        }
      }
    },

    server: {
      host: '0.0.0.0',
      port: 5173,
      allowedHosts: ['*'],
      hmr: {
        host: hostName,
        protocol: 'wss',
      }
    }
  }
})

