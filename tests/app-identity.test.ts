import { afterEach, describe, expect, it } from 'vitest'
import { EventEmitter } from 'node:events'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { configureAppIdentity } from '../apps/desktop/src/main/app-identity'

const directories: string[] = []
async function directory() {
  const path = await mkdtemp(join(tmpdir(), 'inlark-identity-'))
  directories.push(path)
  return path
}
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

function electronApp(appData: string) {
  const events = new EventEmitter()
  const paths = new Map<string, string>([
    ['appData', appData],
    ['userData', join(appData, 'inlark')],
    ['sessionData', join(appData, 'inlark')],
  ])
  let name = 'inlark'
  return {
    events,
    getName: () => name,
    setName: (value: string) => {
      name = value
    },
    getPath: (key: string) => {
      const path = paths.get(key)
      if (!path) throw new Error('Unexpected path: ' + key)
      return path
    },
    setPath: (key: string, value: string) => {
      if (!existsSync(value)) throw new Error('Directory must exist before setPath.')
      paths.set(key, value)
    },
    once: (event: 'ready', listener: () => void) => events.once(event, listener),
  }
}

describe('app identity compatibility', () => {
  it.each(['.config', 'AppData/Roaming', 'Library/Application Support'])(
    'keeps existing data under %s and the startup credential identity after rebranding',
    async (parent) => {
      const appData = join(await directory(), parent)
      const profile = join(appData, 'Inlark')
      await mkdir(join(profile, 'mail'), { recursive: true })
      const draft = JSON.stringify({ subject: 'Saved draft', body: 'Keep this message.' })
      const session = 'existing-session-state'
      await writeFile(join(profile, 'mail', 'draft.json'), draft)
      await writeFile(join(profile, 'Local State'), session)
      const app = electronApp(appData)

      configureAppIdentity(app, '')
      expect(app.getName()).toBe('Inlark')
      app.events.emit('ready')

      expect(app.getName()).toBe('inlark')
      expect(app.getPath('userData')).toBe(profile)
      expect(app.getPath('sessionData')).toBe(profile)
      expect(await readFile(join(app.getPath('userData'), 'mail', 'draft.json'), 'utf8')).toBe(
        draft,
      )
      expect(await readFile(join(app.getPath('sessionData'), 'Local State'), 'utf8')).toBe(session)
      expect(await readdir(appData)).toEqual(['Inlark'])
    },
  )

  it('creates and uses an explicit data directory for both app and session storage', async () => {
    const root = await directory()
    const app = electronApp(join(root, 'default'))
    const override = join(root, 'custom-profile')

    configureAppIdentity(app, override)
    app.events.emit('ready')

    expect(app.getName()).toBe('inlark')
    expect(app.getPath('userData')).toBe(override)
    expect(app.getPath('sessionData')).toBe(override)
    expect(existsSync(override)).toBe(true)
    expect(existsSync(join(root, 'default'))).toBe(false)
  })
})
