const repoPath = 'inlark/inlark'
const repo = 'https://github.com/' + repoPath

export const links = {
  repo,
  repoPath,
  releases: repo + '/releases/latest',
  license: repo + '/blob/main/LICENSE',
  readme: repo + '#readme',
  issues: repo + '/issues',
  download: '/download',
  /** Redirects to the support page; see `worker/routes.ts`. */
  support: '/support',
  privacy: '/privacy',
  imprint: '/imprint',
}

export { version } from '../../../desktop/package.json'
