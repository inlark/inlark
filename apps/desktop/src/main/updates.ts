import { app, autoUpdater as nativeAutoUpdater, net } from 'electron'
import electronUpdater, { type AppUpdater } from 'electron-updater'
import type { UpdateStatus } from '@inlark/core'

const { autoUpdater } = electronUpdater as { autoUpdater: AppUpdater }
const CHECK_INTERVAL = 6 * 60 * 60 * 1000
const RELEASE_URL = 'https://api.github.com/repos/inlark/inlark/releases/latest'

function newerRelease(tag: string, current: string): boolean {
  const parse = (value: string) => /^v?(\d+)\.(\d+)\.(\d+)(-.+)?$/.exec(value)
  const next = parse(tag)
  const installed = parse(current)
  if (!next || !installed) return false
  for (let i = 1; i <= 3; i++) {
    const difference = Number(next[i]) - Number(installed[i])
    if (difference) return difference > 0
  }
  return !next[4] && !!installed[4]
}

export class UpdateManager {
  private status: UpdateStatus = { phase: 'idle' }
  private checking = false
  private failure: Promise<void> | undefined
  private pendingMacVersion: string | undefined

  constructor(private readonly publish: (status: UpdateStatus) => void) {}

  getStatus = (): UpdateStatus => this.status

  private setStatus(status: UpdateStatus) {
    this.status = status
    this.publish(status)
  }

  start() {
    if (!app.isPackaged) return
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.autoRunAppAfterInstall = false
    autoUpdater.on('update-available', ({ version }) => {
      this.setStatus({ phase: 'downloading', version, percent: 0 })
    })
    autoUpdater.on('download-progress', ({ percent }) => {
      if (this.status.phase === 'downloading')
        this.setStatus({ ...this.status, percent: Math.max(0, Math.min(100, Math.round(percent))) })
    })
    autoUpdater.on('update-downloaded', ({ version }) => {
      if (process.platform === 'darwin') {
        // MacUpdater emits before Squirrel has verified and staged the ZIP.
        this.pendingMacVersion = version
      } else this.setStatus({ phase: 'ready', version })
    })
    if (process.platform === 'darwin')
      nativeAutoUpdater.on('update-downloaded', () => {
        if (this.pendingMacVersion && this.status.phase === 'downloading')
          this.setStatus({ phase: 'ready', version: this.pendingMacVersion })
      })
    autoUpdater.on('update-not-available', () => {
      if (this.status.phase !== 'ready') this.setStatus({ phase: 'idle' })
    })
    autoUpdater.on('update-cancelled', () => void this.handleFailure())
    autoUpdater.on('error', () => void this.handleFailure())
    setTimeout(() => void this.check(), 15_000).unref()
    setInterval(() => void this.check(), CHECK_INTERVAL).unref()
  }

  private async check() {
    if (this.checking || this.status.phase === 'ready') return
    this.checking = true
    try {
      await autoUpdater.checkForUpdates()
    } catch {
      await this.handleFailure()
    } finally {
      this.checking = false
    }
  }

  private handleFailure(): Promise<void> {
    if (this.failure) return this.failure
    this.failure = this.showManualFallback().finally(() => {
      this.failure = undefined
    })
    return this.failure
  }

  private async showManualFallback() {
    if (
      this.status.phase === 'downloading' ||
      this.status.phase === 'ready' ||
      this.status.phase === 'manual'
    ) {
      this.setStatus({ phase: 'manual', version: this.status.version })
      return
    }
    // An updater error can happen before it emits update-available (for example, a
    // release missing metadata). Check the public release separately before notifying.
    try {
      const response = await net.fetch(RELEASE_URL, {
        headers: { Accept: 'application/vnd.github+json' },
        signal: AbortSignal.timeout(8_000),
      })
      if (!response.ok) return
      const release = (await response.json()) as { tag_name?: unknown }
      if (typeof release.tag_name === 'string' && newerRelease(release.tag_name, app.getVersion()))
        this.setStatus({ phase: 'manual', version: release.tag_name.replace(/^v/, '') })
    } catch {
      // No reliable version to show while offline. The next scheduled check can retry.
    }
  }
}
