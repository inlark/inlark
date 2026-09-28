import { defineConfig } from 'astro/config'
import react from '@astrojs/react'
import tailwindcss from '@tailwindcss/vite'
import { handle } from './worker/routes.ts'

/** Serves the Worker's routes during `astro dev`, so the download page behaves as it does live. */
const workerRoutes = {
  name: 'inlark:worker-routes',
  configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      try {
        const url = new URL(req.url ?? '/', `http://${req.headers.host}`)
        const response = await handle(new Request(url), process.env.GITHUB_TOKEN)
        if (!response) return next()
        res.writeHead(response.status, Object.fromEntries(response.headers))
        res.end(Buffer.from(await response.arrayBuffer()))
      } catch (error) {
        next(error)
      }
    })
  },
}

export default defineConfig({
  integrations: [react()],
  vite: {
    plugins: [tailwindcss(), workerRoutes],
  },
})
