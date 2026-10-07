import assert from 'node:assert/strict'
import { Worker } from 'node:worker_threads'
import { readdir, readFile, writeFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
// Electron's Node mode also accepts a directory inside a packaged app.asar.
const directory = process.env.INLARK_CRYPTO_WORKER_DIRECTORY
  ? pathToFileURL(resolve(process.env.INLARK_CRYPTO_WORKER_DIRECTORY) + sep)
  : new URL('../apps/desktop/out/main/', import.meta.url)
const entry = (await readdir(directory)).find((name) => /^crypto-worker-.*\.js$/.test(name))
assert.ok(entry, 'Build the desktop before checking the packaged crypto worker.')
const worker = new Worker(new URL(entry, directory)),
  pending = new Map()
let next = 1
worker.on('message', ({ id, result, error }) => {
  const call = pending.get(id)
  if (!call) return
  pending.delete(id)
  clearTimeout(call.timer)
  if (error) call.reject(new Error(error))
  else call.resolve(result)
})
worker.on('error', (error) => {
  for (const call of pending.values()) {
    clearTimeout(call.timer)
    call.reject(error)
  }
  pending.clear()
})
const request = (method, ...args) =>
  new Promise((resolve, reject) => {
    const id = next++,
      timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error('Crypto worker timed out.'))
      }, 30000)
    pending.set(id, { resolve, reject, timer })
    worker.postMessage({ id, method, args })
  })
try {
  const key = await request('generate', 'Packaged fixture', 'packaged@encryption.test')
  await request('load', [key])
  const encrypted = await request(
    'encrypt',
    new TextEncoder().encode('Packaged private content'),
    [key.publicKey],
    key.fingerprint,
  )
  const result = await request('decrypt', encrypted, [key.publicKey])
  assert.equal(Buffer.from(result.data).toString(), 'Packaged private content')
  assert.equal(result.signatures[0].valid, true)
  if (process.argv.includes('--gnupg')) {
    const home = await mkdtemp(join(tmpdir(), 'inlark-interop-'))
    const fixture = (name) =>
      readFile(new URL('../tests/fixtures/openpgp/' + name, import.meta.url))
    const gpg = (args, input) => {
      const result = spawnSync(
        'gpg',
        ['--homedir', home, '--batch', '--yes', '--no-tty', '--pinentry-mode', 'loopback', ...args],
        { input, maxBuffer: 16 * 1024 * 1024 },
      )
      assert.equal(result.status, 0, result.stderr?.toString() || result.error?.message)
      return result
    }
    try {
      const alice = await request(
        'importPrivate',
        (await fixture('alice-private.asc')).toString(),
        'alice@encryption.test',
      )
      const bob = await request(
        'importPrivate',
        (await fixture('bob-private.asc')).toString(),
        'bob@encryption.test',
      )
      await request('load', [alice, bob])
      gpg(['--import'], await fixture('bob-private.asc'))
      gpg(['--import'], await fixture('alice-public.asc'))
      const entity = await fixture('entity.mime')
      for (const hidden of [false, true]) {
        const output = await request(
          'encrypt',
          entity,
          [alice.publicKey, bob.publicKey],
          alice.fingerprint,
          hidden,
        )
        const decrypted = gpg(['--status-fd', '2', '--decrypt'], output)
        assert.deepEqual(decrypted.stdout, entity)
        assert.match(decrypted.stderr.toString(), new RegExp('VALIDSIG ' + alice.fingerprint, 'i'))
      }
      const signature = await request('sign', entity, alice.fingerprint)
      await writeFile(join(home, 'message.mime'), entity)
      await writeFile(join(home, 'signature.asc'), signature)
      const verified = gpg([
        '--status-fd',
        '2',
        '--verify',
        join(home, 'signature.asc'),
        join(home, 'message.mime'),
      ])
      assert.match(verified.stderr.toString(), new RegExp('VALIDSIG ' + alice.fingerprint, 'i'))
      const backup = await request('backup', alice.fingerprint, 'synthetic-backup-password')
      gpg(['--passphrase', 'synthetic-backup-password', '--import'], backup)
      console.log(
        'Independent GnuPG: signed encryption, hidden recipients, detached signatures and protected key import passed.',
      )
    } finally {
      spawnSync('gpgconf', ['--homedir', home, '--kill', 'gpg-agent'])
      await rm(home, { recursive: true, force: true })
    }
  }
  await request('lock')
  await assert.rejects(request('decrypt', encrypted, [key.publicKey]), /No private key/)
  console.log(
    'Packaged crypto worker: generation, encryption, signing, decryption and locking passed.',
  )
} finally {
  await worker.terminate()
}
