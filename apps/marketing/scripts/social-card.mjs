// Renders src/pages/social-card.astro to public/social-card.png with a headless Chromium.
// Run after `astro build`; set CHROMIUM when the browser isn't on the PATH as `chromium`.
import { execFile } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const root = fileURLToPath(new URL('..', import.meta.url))
const types = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
}

// Serves the build output, which uses root-relative asset paths.
const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
  const file = join(root, 'dist', extname(path) ? path : join(path, 'index.html'))
  try {
    const body = readFileSync(file)
    res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream' })
    res.end(body)
  } catch {
    res.writeHead(404).end()
  }
})
await new Promise((resolve) => server.listen(0, 'localhost', resolve))
const profile = mkdtempSync(join(tmpdir(), 'inlark-card-'))

try {
  await promisify(execFile)(process.env.CHROMIUM ?? 'chromium', [
    '--headless',
    '--user-data-dir=' + profile,
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    '--force-prefers-color-scheme=dark',
    '--window-size=1200,630',
    '--virtual-time-budget=4000',
    '--screenshot=' + join(root, 'public/social-card.png'),
    `http://localhost:${server.address().port}/social-card/`,
  ])
} finally {
  server.close()
  rmSync(profile, { recursive: true, force: true })
}
