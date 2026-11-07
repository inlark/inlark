import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import type { App } from 'electron'
import type { StartupPreferences, StartupStatus } from '@inlark/core'

export const startupArgument = '--autostart'
interface Store {
  read<T>(name: string, fallback: T): Promise<T>
  write(name: string, value: unknown): Promise<void>
}
interface SavedStartup {
  initialized: boolean
  enabled: boolean
  startMinimized: boolean
}
export interface StartupOptions {
  app: Pick<App, 'isPackaged' | 'getLoginItemSettings' | 'setLoginItemSettings'>
  store: Store
  platform: NodeJS.Platform
  env: NodeJS.ProcessEnv
  execPath: string
  home: string
  disabled: boolean
  installed?: boolean
  askMac: () => Promise<boolean>
  requestBackground: (enabled: boolean) => Promise<boolean>
}

/** Desktop Exec quoting has two escaping layers, and percent introduces field codes. */
export function desktopExec(path: string): string {
  if (/[\r\n\0=]/.test(path)) throw new Error('This application path cannot be used for startup.')
  return (
    '"' +
    path
      .replace(/%/g, '%%')
      .replace(/[\\"`$]/g, (c) => '\\' + c)
      .replace(/\\/g, '\\\\') +
    '"'
  )
}

export function startInTray(options: {
  automatic: boolean
  startMinimized: boolean
  trayAvailable: boolean
  hasMailto: boolean
}): boolean {
  return options.automatic && options.startMinimized && options.trayAvailable && !options.hasMailto
}

export class StartupManager {
  private saved: SavedStartup = { initialized: false, enabled: false, startMinimized: true }
  private error?: string
  private queue = Promise.resolve()
  constructor(private options: StartupOptions) {}
  private get flatpak() {
    return !!this.options.env.FLATPAK_ID
  }
  private get supported() {
    return (
      (this.options.installed ?? this.options.app.isPackaged) &&
      !this.options.disabled &&
      ['linux', 'darwin', 'win32'].includes(this.options.platform)
    )
  }
  private get entry() {
    const config = this.options.env.XDG_CONFIG_HOME
    return join(
      config && isAbsolute(config) ? config : join(this.options.home, '.config'),
      'autostart',
      'inlark.desktop',
    )
  }
  private get executable() {
    // AppImage's process.execPath points inside a temporary mount. Nix's store path is
    // versioned; use the installed profile command so upgrades keep working.
    return (
      this.options.env.APPIMAGE ||
      (this.options.execPath.startsWith('/nix/store/') ? 'inlark' : this.options.execPath)
    )
  }
  async load() {
    try {
      const saved = await this.options.store.read('startup', this.saved)
      if (
        !saved ||
        typeof saved.initialized !== 'boolean' ||
        typeof saved.enabled !== 'boolean' ||
        typeof saved.startMinimized !== 'boolean'
      )
        throw new Error('Invalid startup preferences.')
      this.saved = saved
    } catch {
      this.saved.initialized = true
      this.error = 'Could not read startup preferences. Choose your startup settings again.'
    }
  }
  get startMinimized() {
    return this.saved.startMinimized !== false
  }
  wasOpenedAtLogin(args: string[]) {
    return (
      args.includes(startupArgument) ||
      (this.options.platform === 'darwin' &&
        this.options.app.getLoginItemSettings().wasOpenedAtLogin)
    )
  }
  async status(): Promise<StartupStatus> {
    let enabled = this.saved.enabled,
      requiresApproval = false
    if (this.supported) {
      if (this.options.platform === 'darwin') {
        const login = this.options.app.getLoginItemSettings()
        requiresApproval = login.status === 'requires-approval'
        enabled = login.openAtLogin || requiresApproval
      } else if (this.options.platform === 'win32') {
        const login = this.options.app.getLoginItemSettings({
          path: this.options.execPath,
          args: [startupArgument],
        })
        enabled = login.openAtLogin && login.executableWillLaunchAtLogin
      } else if (!this.flatpak) {
        try {
          const entry = await readFile(this.entry, 'utf8')
          enabled =
            !/^Hidden\s*=\s*true\s*$/im.test(entry) &&
            /^Exec=/m.test(entry) &&
            !/^X-GNOME-Autostart-enabled\s*=\s*false\s*$/im.test(entry)
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
            this.error = 'Could not read startup settings. Check access to your autostart folder.'
          enabled = false
        }
      }
    }
    return {
      supported: this.supported,
      enabled: this.supported && enabled,
      startMinimized: this.startMinimized,
      requiresApproval,
      error: this.error,
    }
  }
  async initialize() {
    if (!this.supported || this.saved.initialized) return
    // Record the first-run decision even on cancellation/failure; never prompt repeatedly
    // or re-enable an item the user later disabled in their operating system.
    this.saved.initialized = true
    try {
      await this.options.store.write('startup', this.saved)
      const existing = await this.status()
      const enable =
        existing.enabled || this.options.platform !== 'darwin' || (await this.options.askMac())
      await this.set({ enabled: enable })
    } catch {
      this.error = 'Could not enable startup. You can try again in Settings.'
    }
  }
  set(preferences: StartupPreferences): Promise<StartupStatus> {
    const operation = this.queue.then(async () => {
      if (!this.supported) throw new Error('Startup is available in the installed desktop app.')
      const next = { ...this.saved, ...preferences, initialized: true }
      if (preferences.enabled !== undefined) {
        if (this.options.platform === 'linux') {
          if (this.flatpak) {
            next.enabled = await this.options.requestBackground(next.enabled)
            if (preferences.enabled !== next.enabled)
              throw new Error('Startup permission was not granted. You can try again in Settings.')
          } else if (next.enabled) {
            await mkdir(join(this.entry, '..'), { recursive: true })
            const temporary = this.entry + '.tmp'
            try {
              await writeFile(
                temporary,
                '[Desktop Entry]\nType=Application\nName=inlark\nExec=' +
                  desktopExec(this.executable) +
                  ' ' +
                  startupArgument +
                  '\nTerminal=false\n',
                { mode: 0o600 },
              )
              await rename(temporary, this.entry)
            } finally {
              await rm(temporary, { force: true })
            }
          } else {
            // Override any system-wide entry as required by the XDG autostart spec.
            await mkdir(join(this.entry, '..'), { recursive: true })
            await writeFile(
              this.entry,
              '[Desktop Entry]\nType=Application\nName=inlark\nHidden=true\n',
              { mode: 0o600 },
            )
          }
        } else {
          this.options.app.setLoginItemSettings({
            openAtLogin: next.enabled,
            ...(this.options.platform === 'win32'
              ? { path: this.options.execPath, args: [startupArgument], enabled: next.enabled }
              : {}),
          })
        }
      }
      await this.options.store.write('startup', next)
      this.saved = next
      this.error = undefined
      const status = await this.status()
      if (preferences.enabled === true && !status.enabled)
        throw new Error(
          'Startup could not be enabled. Check your operating system’s login item settings.',
        )
      return status
    })
    this.queue = operation.then(
      () => {},
      () => {},
    )
    return operation
  }
}
