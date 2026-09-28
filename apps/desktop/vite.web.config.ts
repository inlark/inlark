import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { SenderAvatarResolver } from './src/main/sender-avatar'

const avatars = new SenderAvatarResolver()

export default defineConfig({
  root: 'src/renderer',
  resolve: { alias: { '@': fileURLToPath(new URL('./src/renderer/src', import.meta.url)) } },
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'demo-sender-avatars',
      configureServer(server) {
        server.middlewares.use('/__demo/avatar', async (request, response) => {
          if (request.method !== 'GET') {
            response.statusCode = 405
            response.end()
            return
          }
          const email = new URL(request.url || '/', 'http://localhost').searchParams.get('email')
          if (!email || email.length > 320 || !/^[^@\s]+@[^@\s]+$/.test(email)) {
            response.statusCode = 400
            response.end()
            return
          }
          try {
            const image = await avatars.get(email)
            response.setHeader('Content-Type', 'application/json; charset=utf-8')
            response.setHeader('Cache-Control', 'private, max-age=900')
            response.end(JSON.stringify({ image }))
          } catch {
            response.statusCode = 500
            response.end()
          }
        })
      },
    },
  ],
  server: { port: 5173, fs: { allow: [fileURLToPath(new URL('../..', import.meta.url))] } },
})
