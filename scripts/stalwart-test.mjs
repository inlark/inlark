import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
const runtime = process.env.CONTAINER_RUNTIME || 'podman'
const name = 'inlark-test-' + randomUUID().slice(0, 8)
const port = process.env.STALWART_TEST_PORT || '18081'
// IMAP/SMTP listeners, published on consecutive ports after the HTTP port.
const mailPorts = { imaps: 993, imap: 143, submissions: 465, submission: 587 }
const published = Object.fromEntries(
  Object.entries(mailPorts).map(([name], i) => [name, String(Number(port) + 1 + i)]),
)
// Test-only certificate for localhost/127.0.0.1, signed by tests/fixtures/tls/ca.crt.
const tls = fileURLToPath(new URL('../tests/fixtures/tls/', import.meta.url))
const url = 'http://127.0.0.1:' + port
const password = randomUUID()
const run = (args, extra = {}) => {
  const result = spawnSync(runtime, args, { encoding: 'utf8', ...extra })
  if (result.status) throw new Error(result.stderr || 'Container command failed')
  return result.stdout.trim()
}
try {
  run([
    'run',
    '-d',
    '--name',
    name,
    '--label',
    'app.inlark.test=true',
    '-p',
    '127.0.0.1:' + port + ':8080',
    ...Object.entries(mailPorts).flatMap(([name, inner]) => [
      '-p',
      '127.0.0.1:' + published[name] + ':' + inner,
    ]),
    '-e',
    'STALWART_PUBLIC_URL=' + url,
    '-e',
    'STALWART_RECOVERY_ADMIN=admin:' + password,
    'docker.io/stalwartlabs/stalwart:v0.16.23',
  ])
  const auth = 'Basic ' + Buffer.from('admin:' + password).toString('base64')
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(url + '/jmap/session', { headers: { Authorization: auth } })
      if (r.ok) break
    } catch {}
    await new Promise((r) => setTimeout(r, 500))
  }
  const response = await fetch(url + '/jmap/', {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      using: ['urn:ietf:params:jmap:core', 'urn:stalwart:jmap'],
      methodCalls: [
        [
          'x:Bootstrap/set',
          {
            update: {
              singleton: {
                serverHostname: 'mail.inlark.test',
                defaultDomain: 'inlark.test',
                requestTlsCertificate: false,
                generateDkimKeys: false,
              },
            },
          },
          'setup',
        ],
      ],
    }),
  })
  const body = await response.json(),
    account = body.methodResponses?.[0]?.[1]?.updated?.singleton
  if (!account?.secret)
    throw new Error('Stalwart bootstrap failed. No account secret was returned.')
  // Serve a certificate the tests trust explicitly, and add the STARTTLS listeners.
  const adminCall = (methodCalls) =>
    fetch(url + '/jmap/', {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        using: ['urn:ietf:params:jmap:core', 'urn:stalwart:jmap'],
        methodCalls,
      }),
    }).then((r) => r.json())
  run(['restart', name])
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(url + '/jmap/session', { headers: { Authorization: auth } })
      if (r.ok) break
    } catch {}
    await new Promise((r) => setTimeout(r, 500))
  }
  const configured = await adminCall([
    [
      'x:Certificate/set',
      {
        create: {
          test: {
            certificate: { '@type': 'Text', value: readFileSync(tls + 'server.crt', 'utf8') },
            privateKey: { '@type': 'Text', secret: readFileSync(tls + 'server.key', 'utf8') },
          },
        },
      },
      'certificate',
    ],
    [
      'x:NetworkListener/set',
      {
        create: {
          imap: {
            name: 'imap',
            bind: { '[::]:143': true },
            protocol: 'imap',
            useTls: true,
            tlsImplicit: false,
          },
          submission: {
            name: 'submission',
            bind: { '[::]:587': true },
            protocol: 'smtp',
            useTls: true,
            tlsImplicit: false,
          },
        },
      },
      'listeners',
    ],
  ])
  for (const [, result] of configured.methodResponses || [])
    if (!result?.created || result.notCreated)
      throw new Error('Stalwart TLS configuration failed: ' + JSON.stringify(result))
  run(['restart', name])
  const login = 'Basic ' + Buffer.from(account.username + ':' + account.secret).toString('base64')
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(url + '/jmap/session', { headers: { Authorization: login } })
      if (r.ok) break
    } catch {}
    await new Promise((r) => setTimeout(r, 500))
  }
  const tests = spawnSync('pnpm', ['test:integration'], {
    stdio: 'inherit',
    env: {
      ...process.env,
      STALWART_TEST_CONTAINER: name,
      STALWART_TEST_RUNTIME: runtime,
      STALWART_TEST_URL: url,
      STALWART_TEST_USERNAME: account.username,
      STALWART_TEST_PASSWORD: account.secret,
      STALWART_TEST_IMAPS_PORT: published.imaps,
      STALWART_TEST_IMAP_PORT: published.imap,
      STALWART_TEST_SUBMISSIONS_PORT: published.submissions,
      STALWART_TEST_SUBMISSION_PORT: published.submission,
      STALWART_TEST_CA: tls + 'ca.crt',
    },
  })
  process.exitCode = tests.status || 0
} finally {
  // This exact container and its anonymous volumes belong only to this invocation.
  spawnSync(runtime, ['rm', '-f', '-v', name], { stdio: 'ignore' })
}
