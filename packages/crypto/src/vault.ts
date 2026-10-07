import { createCipheriv, createDecipheriv, randomBytes, randomUUID, scrypt } from 'node:crypto'
import { mkdir, open, rename, rm, link } from 'node:fs/promises'
import { dirname } from 'node:path'
import { z } from 'zod'

const encoded = z
  .string()
  .max(180_000_000)
  .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/)
const boxSchema = z.object({ nonce: encoded, tag: encoded, data: encoded }).strict()
type Box = z.infer<typeof boxSchema>
const headerSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('password'), salt: encoded, key: boxSchema }).strict(),
  z.object({ mode: z.literal('os'), key: encoded }).strict(),
])
const schema = z
  .object({
    version: z.literal(1),
    id: z.string().uuid(),
    protection: headerSchema,
    records: z.record(z.string().min(1).max(4096), boxSchema),
  })
  .strict()
type Document = z.infer<typeof schema>
export interface SecureStorage {
  available(): boolean
  wrap(value: string): string
  unwrap(value: string): string
}
const aad = (vaultId: string, record: string) =>
  Buffer.from(JSON.stringify(['inlark-vault', 1, vaultId, record]))
const bytes = (text: string, size?: number) => {
  const value = Buffer.from(text, 'base64')
  if (value.toString('base64') !== text || (size !== undefined && value.length !== size))
    throw new Error('Invalid vault data. Your files have been preserved.')
  return value
}
export function seal(key: Uint8Array, plaintext: Uint8Array, identity: Uint8Array): Box {
  const nonce = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, nonce, { authTagLength: 16 })
  cipher.setAAD(identity)
  return {
    nonce: nonce.toString('base64'),
    data: Buffer.concat([cipher.update(plaintext), cipher.final()]).toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  }
}
export function unseal(key: Uint8Array, box: Box, identity: Uint8Array): Buffer {
  const decipher = createDecipheriv('aes-256-gcm', key, bytes(box.nonce, 12), { authTagLength: 16 })
  decipher.setAAD(identity)
  decipher.setAuthTag(bytes(box.tag, 16))
  // No plaintext is returned until final() authenticates the complete record.
  const partial = decipher.update(bytes(box.data))
  try {
    return Buffer.concat([partial, decipher.final()])
  } finally {
    partial.fill(0)
  }
}
async function derive(password: string, salt: Buffer): Promise<Buffer> {
  if (!password || password.length > 4096) throw new Error('Enter a vault password.')
  return new Promise((resolve, reject) =>
    scrypt(
      password,
      salt,
      32,
      { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 },
      (error, key) => (error ? reject(error) : resolve(key)),
    ),
  )
}

/** One atomically replaced, authenticated snapshot. Missing or unreadable storage never recreates it. */
export class Vault {
  private document?: Document
  private key?: Buffer
  private queue = Promise.resolve()
  constructor(
    readonly path: string,
    private secure?: SecureStorage,
  ) {}
  get exists() {
    return !!this.document
  }
  get unlocked() {
    return !!this.key
  }
  get mode() {
    return this.document?.protection.mode
  }
  async init() {
    try {
      const file = await open(this.path, 'r')
      try {
        if ((await file.stat()).size > 256 * 1024 * 1024)
          throw new Error('Vault exceeds the supported size.')
        this.document = schema.parse(JSON.parse(await file.readFile('utf8')))
      } finally {
        await file.close()
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw new Error('Could not read the encryption vault. Your files have been preserved.')
    }
  }
  async create(password?: string) {
    // Explicit creation only. Exclusive file creation prevents racing an existing vault.
    if (this.exists) throw new Error('An encryption vault already exists. Unlock it instead.')
    const key = randomBytes(32),
      id = randomUUID()
    let protection: Document['protection']
    try {
      if (this.secure?.available())
        protection = { mode: 'os', key: this.secure.wrap(key.toString('base64')) }
      else {
        if (!password || password.length < 10)
          throw new Error(
            'Use a vault password of at least 10 characters when secure OS storage is unavailable.',
          )
        const salt = randomBytes(32),
          wrapping = await derive(password, salt)
        try {
          protection = {
            mode: 'password',
            salt: salt.toString('base64'),
            key: seal(wrapping, key, aad(id, 'vault-key')),
          }
        } finally {
          wrapping.fill(0)
        }
      }
      const doc: Document = {
        version: 1,
        id,
        protection,
        records: { check: seal(key, Buffer.from('inlark vault'), aad(id, 'check')) },
      }
      await mkdir(dirname(this.path), { recursive: true, mode: 0o700 })
      const temporary = this.path + '.' + randomUUID() + '.tmp'
      try {
        const file = await open(temporary, 'wx', 0o600)
        try {
          await file.writeFile(JSON.stringify(doc))
          await file.sync()
        } finally {
          await file.close()
        }
        await link(temporary, this.path)
        if (process.platform !== 'win32') {
          const directory = await open(dirname(this.path), 'r')
          try {
            await directory.sync()
          } finally {
            await directory.close()
          }
        }
      } finally {
        await rm(temporary, { force: true })
      }
      this.document = doc
      this.key = key
    } catch (error) {
      key.fill(0)
      throw error
    }
  }
  async unlock(password?: string) {
    if (!this.document) throw new Error('Set up encryption first.')
    if (this.key) return
    const doc = this.document
    let key: Buffer | undefined
    try {
      if (doc.protection.mode === 'os') {
        if (!this.secure?.available())
          throw new Error('Unlock your OS keyring. The existing vault cannot be replaced.')
        key = bytes(this.secure.unwrap(doc.protection.key), 32)
      } else {
        const wrapping = await derive(password || '', bytes(doc.protection.salt, 32))
        try {
          key = unseal(wrapping, doc.protection.key, aad(doc.id, 'vault-key'))
        } finally {
          wrapping.fill(0)
        }
      }
      if (
        key.length !== 32 ||
        !doc.records.check ||
        unseal(key, doc.records.check, aad(doc.id, 'check')).toString() !== 'inlark vault'
      )
        throw new Error('Invalid vault.')
      // Authenticate every record before accepting an unlock, including historical private keys.
      for (const [id, box] of Object.entries(doc.records)) unseal(key, box, aad(doc.id, id)).fill(0)
      this.key = key
    } catch (error) {
      key?.fill(0)
      if (doc.protection.mode === 'os') throw error
      throw new Error(
        'The password is incorrect or the vault was damaged. Your files have been preserved.',
      )
    }
  }
  async lock() {
    await this.queue
    this.key?.fill(0)
    this.key = undefined
  }
  ids(prefix: string) {
    return Object.keys(this.document?.records ?? {}).filter((id) => id.startsWith(prefix))
  }
  read(id: string): Buffer | undefined {
    if (!this.key || !this.document) throw new Error('Unlock the encryption vault first.')
    const box = this.document.records[id]
    return box ? unseal(this.key, box, aad(this.document.id, id)) : undefined
  }
  json<T>(id: string): T | undefined {
    const data = this.read(id)
    if (!data) return
    try {
      return JSON.parse(data.toString()) as T
    } finally {
      data.fill(0)
    }
  }
  put(id: string, value: Uint8Array | undefined) {
    return this.putMany([[id, value]])
  }
  putJSON(id: string, value: unknown) {
    return this.put(id, Buffer.from(JSON.stringify(value)))
  }
  putMany(values: [string, Uint8Array | undefined][]): Promise<void> {
    if (!this.key || !this.document)
      return Promise.reject(new Error('Unlock the encryption vault first.'))
    const encrypted = values.map(([id, data]) => {
      if (!id || id === 'check' || id.length > 4096) throw new Error('Invalid vault record.')
      return [id, data ? seal(this.key!, data, aad(this.document!.id, id)) : undefined] as const
    })
    const operation = this.queue.then(async () => {
      if (!this.document || !this.key) throw new Error('The vault is locked.')
      const doc = structuredClone(this.document)
      for (const [id, box] of encrypted) {
        if (box) doc.records[id] = box
        else delete doc.records[id]
      }
      const serialized = JSON.stringify(doc)
      if (Buffer.byteLength(serialized) > 256 * 1024 * 1024)
        throw new Error('The encryption vault is full. Your existing data has been preserved.')
      const temporary = this.path + '.' + randomUUID() + '.tmp'
      try {
        const file = await open(temporary, 'wx', 0o600)
        try {
          await file.writeFile(serialized)
          await file.sync()
        } finally {
          await file.close()
        }
        await rename(temporary, this.path)
        this.document = doc
        if (process.platform !== 'win32') {
          const directory = await open(dirname(this.path), 'r')
          try {
            await directory.sync()
          } finally {
            await directory.close()
          }
        }
      } finally {
        await rm(temporary, { force: true })
      }
    })
    this.queue = operation.catch(() => {})
    return operation
  }
}
