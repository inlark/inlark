import type { App } from 'electron'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

type IdentityApp = Pick<App, 'setName' | 'getPath' | 'setPath'> & {
  once(event: 'ready', listener: () => void): unknown
}

export function configureAppIdentity(
  app: IdentityApp,
  dataDirectory = process.env.INLARK_DATA_DIR,
) {
  // Electron 44 captures this name for OS credential storage before ready. Preserve it so
  // saved account passwords remain readable, then use the lowercase name for native UI.
  // https://github.com/electron/electron/blob/v44.4.5/shell/browser/electron_browser_main_parts.cc
  app.setName('Inlark')
  const userData = dataDirectory || join(app.getPath('appData'), 'Inlark')
  mkdirSync(userData, { recursive: true, mode: 0o700 })
  app.setPath('userData', userData)
  app.setPath('sessionData', userData)
  app.once('ready', () => app.setName('inlark'))
}
