import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { defaultSettings } from '@inlark/core'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const page = read('../apps/marketing/src/pages/privacy.astro')

/*
 * The privacy page states facts about the code. These are reminders, not proof: they compare the
 * page's wording with the source it describes, so a change to either one stops here until the
 * other is looked at. They cannot notice a new recipient added somewhere else.
 */
describe('the privacy page’s wording against the source it describes', () => {
  it('names each service the code is known to contact', () => {
    const contacted: [file: string, host: string, named: string][] = [
      ['../apps/desktop/src/main/sender-avatar.ts', 'gravatar.com', 'Gravatar'],
      ['../apps/desktop/src/main/sender-avatar.ts', 'twenty-icons.com', 'Twenty Icons'],
      ['../apps/desktop/src/main/sender-avatar.ts', 'icons.duckduckgo.com', 'DuckDuckGo'],
      ['../packages/core/src/discovery.ts', 'autoconfig.thunderbird.net', 'Thunderbird'],
      ['../apps/desktop/src/main/updates.ts', 'api.github.com', 'GitHub'],
      ['../apps/desktop/src/main/microsoft-auth.ts', 'login.microsoftonline.com', 'Microsoft'],
      ['../packages/core/src/google.ts', 'authuser', 'Google'],
      ['../apps/marketing/worker/routes.ts', 'tally.so', 'Tally'],
      ['../apps/marketing/worker/routes.ts', 'buymeacoffee.com', 'Buy Me a Coffee'],
    ]
    for (const [file, mark, named] of contacted) {
      expect(read(file), `${file} still has ${mark}`).toContain(mark)
      expect(page, `the page names ${named}`).toContain(named)
    }
  })

  it('describes remote images as they are by default', () => {
    expect(defaultSettings.remoteImages).toBe(true)
    expect(page).toContain('On by default')
    expect(page).toContain('Load remote images')
    // Neither file that makes these requests names such a header. A reminder only: it would
    // not notice one set through a variable.
    for (const file of ['public-fetch.ts', 'remote-image.ts'])
      expect(read('../apps/desktop/src/main/' + file)).not.toMatch(
        /['"]?(cookie|referer)['"]?\s*:/i,
      )
    expect(page).toContain('no cookies and no referrer')
  })

  it('gives the updater’s interval and the builds that skip it', () => {
    const updates = read('../apps/desktop/src/main/updates.ts')
    expect(updates).toMatch(/CHECK_INTERVAL\s*=\s*6\s*\*\s*60\s*\*\s*60\s*\*\s*1000/)
    expect(page).toContain('every six hours')
    expect(updates).toMatch(/!app\.isPackaged\s*\|\|\s*process\.env\.FLATPAK_ID/)
    // The Nix package starts the app through Electron itself, which is what "not packaged" means.
    expect(read('../nix/package.nix')).toMatch(/electron[\w.]*\}\/bin\/electron/)
    expect(page).toContain('The Flatpak and Nix builds don’t check')
  })

  it('says where spell-check dictionaries come from while nothing changes that', () => {
    expect(read('../apps/desktop/src/main/index.ts')).toMatch(/spellcheck:\s*true/)
    // Wherever in the main process it would be called from.
    const sources = readdirSync(new URL('../apps/desktop/src/main/', import.meta.url), {
      recursive: true,
      encoding: 'utf8',
    }).filter((name) => name.endsWith('.ts'))
    expect(sources.length).toBeGreaterThan(10)
    for (const name of sources)
      expect(read('../apps/desktop/src/main/' + name), name).not.toMatch(
        /\.setSpellCheckerDictionaryDownloadURL\(/,
      )
    expect(page).toContain('downloads its dictionary from Google’s servers')
  })

  it('is linked from every page’s footer', () => {
    expect(read('../apps/marketing/src/data/links.ts')).toMatch(/privacy:\s*'\/privacy'/)
    expect(read('../apps/marketing/src/components/Footer.astro')).toContain('links.privacy')
  })
})
