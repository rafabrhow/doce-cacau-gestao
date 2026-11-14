import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import mkcert from 'vite-plugin-mkcert'

export default defineConfig({
  plugins: [
    react(),
    mkcert({
      hosts: ['localhost', '127.0.0.1', '192.168.1.5'],
    }),
  ],
  server: {
    proxy: { '/api': { target: 'http://127.0.0.1:8787', changeOrigin: true } },
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
  },
})
