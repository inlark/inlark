import { afterEach, expect, it } from 'vitest'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { once } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { requestBackground } from '../apps/desktop/src/main/startup-portal'

// Exercise real D-Bus serialization, match registration and an immediate portal
// response on a private bus. Never talk to the user's desktop permission service.
const require = createRequire(new URL('../apps/desktop/package.json', import.meta.url))
const { sessionBus, Message, Variant } = require('dbus-next')
const originalAddress = process.env.DBUS_SESSION_BUS_ADDRESS
const cleanup: (() => void | Promise<void>)[] = []
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn()
  if (originalAddress === undefined) delete process.env.DBUS_SESSION_BUS_ADDRESS
  else process.env.DBUS_SESSION_BUS_ADDRESS = originalAddress
})

it.skipIf(process.platform !== 'linux')(
  'waits for the Flatpak portal Response and honors grant, refusal and disabling',
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'inlark-dbus-'))
    cleanup.push(() => rm(directory, { recursive: true, force: true }))
    const config = join(directory, 'bus.conf')
    // Nix's dbus-daemon looks for session.conf under /etc, which is absent
    // in the build sandbox. Keep this bus independent of host configuration
    // and service activation directories on every Linux distribution.
    await writeFile(
      config,
      `<busconfig>
        <type>session</type>
        <listen>unix:tmpdir=/tmp</listen>
        <auth>EXTERNAL</auth>
        <policy context="default">
          <allow send_destination="*"/>
          <allow receive_sender="*"/>
          <allow own="*"/>
        </policy>
      </busconfig>`,
    )
    const daemon = spawn(
      'dbus-daemon',
      ['--config-file=' + config, '--nofork', '--print-address=1'],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    )
    cleanup.push(() => {
      daemon.kill()
    })
    let stderr = ''
    daemon.stderr.on('data', (chunk) => (stderr += chunk.toString()))
    const address = await new Promise<string>((resolve, reject) => {
      daemon.once('error', reject)
      daemon.stdout.once('data', (chunk) => resolve(chunk.toString().trim()))
      daemon.once('exit', (code) => reject(new Error(`Private D-Bus exited: ${code}\n${stderr}`)))
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
