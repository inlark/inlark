import { handle } from './routes'

interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> }
  /** Optional token that raises GitHub's rate limit. Set with `wrangler secret put GITHUB_TOKEN`. */
  GITHUB_TOKEN?: string
}

// Static files are served before the Worker runs, so it only sees requests nothing else matched.
export default {
  async fetch(request: Request, env: Env) {
    return (await handle(request, env.GITHUB_TOKEN)) ?? env.ASSETS.fetch(request)
  },
}
