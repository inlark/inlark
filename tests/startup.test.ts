import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  StartupManager,
  desktopExec,
  startInTray,
  type StartupOptions,
} from '../apps/desktop/src/main/startup'

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})
async function fixture(
  platform: NodeJS.Platform = 'linux',
  overrides: Partial<StartupOptions> = {},
) {
  const home = await mkdtemp(join(tmpdir(), 'inlark-startup-'))
  directories.push(home)
  let data: unknown
  const store = {
    read: async <T>(_name: string, fallback: T): Promise<T> =>
      data ? (structuredClone(data) as T) : fallback,
    write: vi.fn(async (_name: string, value: unknown) => {
      data = structuredClone(value)
    }),
  }
  let login = {
    openAtLogin: false,
    executableWillLaunchAtLogin: false,
    wasOpenedAtLogin: false,
    status: 'not-registered',
  }
  const options: StartupOptions = {
    app: {
      isPackaged: true,
      getLoginItemSettings: vi.fn(() => login as Electron.LoginItemSettings),
      setLoginItemSettings: vi.fn((next) => {
        login = {
          ...login,
          openAtLogin: !!next.openAtLogin,
          executableWillLaunchAtLogin: !!next.openAtLogin,
          status: next.openAtLogin ? 'enabled' : 'not-registered',
        }
      }),
    },
    store,
    platform,
    home,
    env: {},
    execPath: '/opt/inlark/inlark',
    disabled: false,
    askMac: vi.fn(async () => true),
    requestBackground: vi.fn(async (enabled) => enabled),
    ...overrides,
  }
  const manager = new StartupManager(options)
  await manager.load()
  return {
    manager,
    options,
    home,
    entry: join(home, '.config/autostart/inlark.desktop'),
    reload: async () => {
      const next = new StartupManager(options)
      await next.load()
      return next
    },
    setLogin: (value: Partial<typeof login>) => {
      login = { ...login, ...value }
    },
  }
}

describe('startup registration', () => {
  it('defaults Linux to startup in the tray and preserves preferences after restart', async () => {
    const f = await fixture()
    await f.manager.initialize()
    expect(await readFile(f.entry, 'utf8')).toContain('Exec="/opt/inlark/inlark" --autostart')
    expect(await f.manager.status()).toMatchObject({ enabled: true, startMinimized: true })
    await f.manager.set({ startMinimized: false })
    await f.manager.set({ enabled: false })
    expect(await readFile(f.entry, 'utf8')).toContain('Hidden=true')
    const next = await f.reload()
    await next.initialize()
    expect(await next.status()).toMatchObject({ enabled: false, startMinimized: false })
  })
  it('does not overwrite a Linux entry disabled through the desktop after initialization', async () => {
    const f = await fixture()
    await f.manager.initialize()
    await writeFile(f.entry, '[Desktop Entry]\nExec=inlark --autostart\nHidden=true\n')
    const next = await f.reload()
    await next.initialize()
    expect((await next.status()).enabled).toBe(false)
    await next.set({ startMinimized: false })
    expect((await next.status()).enabled).toBe(false)
  })
  it('uses XDG_CONFIG_HOME and the durable AppImage path', async () => {
    const f = await fixture()
    const config = join(f.home, 'custom-config')
    f.options.env = { XDG_CONFIG_HOME: config, APPIMAGE: '/home/me/Mail Client.AppImage' }
    await f.manager.initialize()
    expect(await readFile(join(config, 'autostart/inlark.desktop'), 'utf8')).toContain(
      'Exec="/home/me/Mail Client.AppImage" --autostart',
    )
  })
  it('uses the Nix profile command instead of a versioned store path', async () => {
    const f = await fixture('linux', { execPath: '/nix/store/version-inlark/bin/inlark' })
    await f.manager.initialize()
    expect(await readFile(f.entry, 'utf8')).toContain('Exec="inlark" --autostart')
  })
  it('does not register development, smoke or demo runs', async () => {
    for (const disabled of [true, false]) {
      const f = await fixture('win32', { disabled })
      f.options.app.isPackaged = false
      await f.manager.initialize()
      expect(f.options.app.setLoginItemSettings).not.toHaveBeenCalled()
      expect((await f.manager.status()).supported).toBe(false)
    }
    const f = await fixture('linux', { disabled: true })
    await f.manager.initialize()
    expect(f.options.store.write).not.toHaveBeenCalled()
  })
  it('registers Windows with an automatic-launch marker and honors OS disabling', async () => {
    const f = await fixture('win32')
    await f.manager.initialize()
    expect(f.options.app.setLoginItemSettings).toHaveBeenCalledWith({
      openAtLogin: true,
      enabled: true,
      path: '/opt/inlark/inlark',
      args: ['--autostart'],
    })
    f.setLogin({ executableWillLaunchAtLogin: false })
    const next = await f.reload()
    await next.initialize()
    expect((await next.status()).enabled).toBe(false)
    expect(f.options.app.setLoginItemSettings).toHaveBeenCalledTimes(1)
  })
  it('asks once on macOS and remembers a declined invitation', async () => {
    const f = await fixture('darwin', { askMac: vi.fn(async () => false) })
    await f.manager.initialize()
    expect((await f.manager.status()).enabled).toBe(false)
    const next = await f.reload()
    await next.initialize()
    expect(f.options.askMac).toHaveBeenCalledTimes(1)
    await next.set({ enabled: true })
    expect((await next.status()).enabled).toBe(true)
  })
  it('surfaces macOS approval and detects a login launch without CLI arguments', async () => {
    const f = await fixture('darwin')
    await f.manager.initialize()
    f.setLogin({ openAtLogin: false, status: 'requires-approval', wasOpenedAtLogin: true })
    expect(await f.manager.status()).toMatchObject({ enabled: true, requiresApproval: true })
    expect(f.manager.wasOpenedAtLogin([])).toBe(true)
  })
  it('uses the Flatpak permission portal and does not retry a refusal automatically', async () => {
    const f = await fixture('linux', {
      env: { FLATPAK_ID: 'com.inlark.Inlark' },
      requestBackground: vi.fn(async () => false),
    })
    await f.manager.initialize()
    expect(f.options.requestBackground).toHaveBeenCalledWith(true)
    expect(await f.manager.status()).toMatchObject({ enabled: false, error: expect.any(String) })
    await expect(readFile(f.entry)).rejects.toMatchObject({ code: 'ENOENT' })
    const next = await f.reload()
    await next.initialize()
    expect(f.options.requestBackground).toHaveBeenCalledTimes(1)
    f.options.requestBackground = vi.fn(async (enabled) => enabled)
    expect(await next.set({ enabled: true })).toMatchObject({ enabled: true })
    expect(await next.set({ enabled: false })).toMatchObject({ enabled: false })
  })
  it('keeps mail usable when startup preferences are unreadable', async () => {
    const f = await fixture('win32')
    f.options.store.read = vi.fn(async () => {
      throw new Error('Corrupt file')
    })
    const next = await f.reload()
    await next.initialize()
    expect(await next.status()).toMatchObject({
      enabled: false,
      error: expect.stringContaining('read startup preferences'),
    })
    expect(f.options.app.setLoginItemSettings).not.toHaveBeenCalled()
    expect(await next.set({ enabled: true })).toMatchObject({ enabled: true, error: undefined })
  })
  it('recognizes an installed Nix wrapper despite Electron reporting an unpackaged runtime', async () => {
    const f = await fixture('linux', {
      installed: true,
      execPath: '/nix/store/electron/bin/electron',
    })
    f.options.app.isPackaged = false
    await f.manager.initialize()
    expect((await f.manager.status()).enabled).toBe(true)
  })
  it('recovers from registration failures without blocking subsequent settings saves', async () => {
    const f = await fixture('linux', { env: { XDG_CONFIG_HOME: '/dev/null/config' } })
    await f.manager.initialize()
    expect(await f.manager.status()).toMatchObject({ enabled: false, error: expect.any(String) })
    f.options.env = {}
    expect(await f.manager.set({ enabled: true })).toMatchObject({
      enabled: true,
      error: undefined,
    })
  })
})

describe('launch behavior', () => {
  const automatic = { automatic: true, startMinimized: true, trayAvailable: true, hasMailto: false }
  it('hides only automatic launches with a usable tray', () => {
    expect(startInTray(automatic)).toBe(true)
    for (const patch of [
      { automatic: false },
      { startMinimized: false },
      { trayAvailable: false },
      { hasMailto: true },
    ])
      expect(startInTray({ ...automatic, ...patch })).toBe(false)
  })
  it('quotes desktop paths without exposing shell syntax or desktop field codes', () => {
    expect(desktopExec('/tmp/100% "mail" $x`a`\\b')).toBe(
      '"/tmp/100%% \\\\"mail\\\\" \\\\$x\\\\`a\\\\`\\\\\\\\b"',
    )
    expect(() => desktopExec('/tmp/mail\nExec=evil')).toThrow()
  })
})
