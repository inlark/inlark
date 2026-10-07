import { readFileSync } from 'node:fs'

const { version } = JSON.parse(
  readFileSync(new URL('../apps/desktop/package.json', import.meta.url), 'utf8'),
)
const tag = process.argv[2]
if (tag !== `v${version}`) {
  console.error(
    `Expected tag v${version}, got ${tag ?? '(missing)'}. Commit the desktop package version before tagging a release.`,
  )
  process.exit(1)
}
