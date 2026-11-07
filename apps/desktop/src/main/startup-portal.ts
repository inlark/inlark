import { randomUUID } from 'node:crypto'

/** Keep one session-bus connection for the full portal request/Response lifecycle. */
export async function requestBackground(enabled: boolean): Promise<boolean> {
  const { sessionBus, Message, MessageType, Variant } = await import('dbus-next')
  const bus = sessionBus()
  const destination = 'org.freedesktop.portal.Desktop'
  const token = 'inlark_' + randomUUID().replaceAll('-', '')
  let requestPath: string | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await new Promise<boolean>((resolve, reject) => {
      const fail = () =>
        reject(
          new Error(
            'The desktop could not grant startup permission. Check your desktop’s background app settings and try again.',
          ),
        )
      bus.on('error', fail)
      const run = async () => {
        // dbus-next exposes its unique connection name at runtime.
        const name = (bus as typeof bus & { name: string }).name
        requestPath =
          '/org/freedesktop/portal/desktop/request/' +
          name.slice(1).replaceAll('.', '_') +
          '/' +
          token
        bus.on('message', (message) => {
          if (
            message.type !== MessageType.SIGNAL ||
            message.path !== requestPath ||
            message.interface !== 'org.freedesktop.portal.Request' ||
            message.member !== 'Response'
          )
            return
          const [code, results] = message.body
          if (code !== 0) {
            reject(new Error('Startup permission was not granted.'))
            return
          }
          resolve(results.autostart?.value === true)
        })
        await bus.call(
          new Message({
            destination: 'org.freedesktop.DBus',
            path: '/org/freedesktop/DBus',
            interface: 'org.freedesktop.DBus',
            member: 'AddMatch',
            signature: 's',
            body: [
              "type='signal',sender='org.freedesktop.portal.Desktop',interface='org.freedesktop.portal.Request',member='Response',path='" +
                requestPath +
                "'",
            ],
          }),
        )
        await bus.call(
          new Message({
            destination,
            path: '/org/freedesktop/portal/desktop',
            interface: 'org.freedesktop.portal.Background',
            member: 'RequestBackground',
            signature: 'sa{sv}',
            body: [
              '',
              {
                handle_token: new Variant('s', token),
                reason: new Variant(
                  's',
                  'Check for new email and show notifications after you sign in.',
                ),
                autostart: new Variant('b', enabled),
                commandline: new Variant('as', ['inlark', '--autostart']),
              },
            ],
          }),
        )
      }
      timer = setTimeout(() => {
        if (requestPath) {
          try {
            bus.send(
              new Message({
                destination,
                path: requestPath,
                interface: 'org.freedesktop.portal.Request',
                member: 'Close',
              }),
            )
          } catch {
            /* The bus may already have disconnected. */
          }
        }
        fail()
      }, 120_000)
      bus.once('connect', () => {
        void run().catch(fail)
      })
    })
  } finally {
    clearTimeout(timer)
    bus.disconnect()
  }
}
