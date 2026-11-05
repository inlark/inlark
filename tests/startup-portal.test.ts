import { afterEach, expect, it } from 'vitest'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { once } from 'node:events'
import { requestBackground } from '../apps/desktop/src/main/startup-portal'

// Exercise real D-Bus serialization, match registration and an immediate portal
// response on a private bus. Never talk to the user's desktop permission service.
const require = createRequire(new URL('../apps/desktop/package.json', import.meta.url))
const { sessionBus, Message, MessageType, Variant } = require('dbus-next')
const originalAddress = process.env.DBUS_SESSION_BUS_ADDRESS
const cleanup: (() => void)[] = []
afterEach(() => {
  cleanup
    .splice(0)
    .reverse()
    .forEach((fn) => fn())
  if (originalAddress === undefined) delete process.env.DBUS_SESSION_BUS_ADDRESS
  else process.env.DBUS_SESSION_BUS_ADDRESS = originalAddress
})

it.skipIf(process.platform !== 'linux')(
  'waits for the Flatpak portal Response and honors grant, refusal and disabling',
  async () => {
    const daemon = spawn('dbus-daemon', ['--session', '--nofork', '--print-address=1'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    cleanup.push(() => daemon.kill())
    const address = await new Promise<string>((resolve, reject) => {
      daemon.once('error', reject)
      daemon.stdout.once('data', (chunk) => resolve(chunk.toString().trim()))
      daemon.once('exit', (code) => reject(new Error('Private D-Bus exited: ' + code)))
    })
    process.env.DBUS_SESSION_BUS_ADDRESS = address
    const service = sessionBus()
    cleanup.push(() => service.disconnect())
    await once(service, 'connect')
    await service.requestName('org.freedesktop.portal.Desktop', 0)
    let granted = true
    let seen: unknown
    service.addMethodHandler(
      (message: {
        type: number
        interface: string
        member: string
        sender: string
        body: [string, Record<string, { value: unknown }>]
      }) => {
        if (
          message.interface !== 'org.freedesktop.portal.Background' ||
          message.member !== 'RequestBackground'
        )
          return false
        const options = message.body[1]
        seen = options
        const requestPath =
          '/org/freedesktop/portal/desktop/request/' +
          message.sender.slice(1).replaceAll('.', '_') +
          '/' +
          options.handle_token.value
        service.send(Message.newMethodReturn(message, 'o', [requestPath]))
        // The response can arrive before the method's await resumes.
        service.send(
          Message.newSignal(requestPath, 'org.freedesktop.portal.Request', 'Response', 'ua{sv}', [
            granted ? 0 : 1,
            { autostart: new Variant('b', granted && options.autostart.value) },
          ]),
        )
        return true
      },
    )
    expect(await requestBackground(true)).toBe(true)
    expect(seen).toMatchObject({
      autostart: { value: true },
      commandline: { value: ['inlark', '--autostart'] },
    })
    expect(await requestBackground(false)).toBe(false)
    granted = false
    await expect(requestBackground(true)).rejects.toThrow('permission was not granted')
  },
)
