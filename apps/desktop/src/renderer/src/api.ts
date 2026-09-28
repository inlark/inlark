import type { DesktopMailAPI } from '@inlark/core'
import { demoAPI } from './demo'
declare global {
  interface Window {
    mail?: DesktopMailAPI
  }
}
export const isDemo =
  new URLSearchParams(location.search).has('demo') ||
  (!window.mail && location.protocol !== 'inlark:')
const unavailable = new Proxy({} as DesktopMailAPI, {
  get: (_target, method) =>
    method === 'onEvent'
      ? () => () => {}
      : async () => {
          throw new Error(
            'The desktop connection could not start. Restart Inlark or reinstall the application.',
          )
        },
})
export const api: DesktopMailAPI = isDemo ? demoAPI : window.mail || unavailable
