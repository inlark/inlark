import { chmod, mkdir, readFile, open, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { safeStorage } from 'electron'

export class JsonStore {
  private queue = Promise.resolve()
  constructor(readonly directory: string) {}
  async init() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    await chmod(this.directory, 0o700)
  }
  private path(name: string) {
    if (!/^[a-z0-9-]+$/.test(name)) throw new Error('Invalid storage key.')
    return join(this.directory, name + '.json')
  }
  /**
   * Reads a versioned envelope. Older versions pass through `migrate`; the original file is
   * copied to `<name>.v<version>.backup.json` before the migrated data atomically replaces it.
   * Unknown, newer, or malformed files fail closed and are never modified.
   */
  async read<T>(
    name: string,
    fallback: T,
    options: { version?: number; migrate?: (data: unknown, version: number) => T } = {},
  ): Promise<T> {
    const current = options.version ?? 1
    let value: { version: unknown; data: unknown }
    let text: string
    try {
      text = await readFile(this.path(name), 'utf8')
      value = JSON.parse(text)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback
      throw new Error('Could not read local ' + name + ' data. Your files have been preserved.')
    }
    if (value?.version === current) return value.data as T
    const version = value?.version
    if (
      !options.migrate ||
      typeof version !== 'number' ||
      !Number.isInteger(version) ||
      version < 1 ||
      version > current
    )
      throw new Error(
        'Could not read local ' +
          name +
          ' data: unsupported data version. Your files have been preserved.',
      )
    let migrated: T
    try {
      migrated = options.migrate(value.data, version)
    } catch {
      throw new Error('Could not upgrade local ' + name + ' data. Your files have been preserved.')
    }
    // The backup must be durable before the original is replaced.
    const backup = await open(
      join(this.directory, name + '.v' + version + '.backup.json'),
      'w',
      0o600,
    )
    try {
      await backup.writeFile(text)
      await backup.sync()
    } finally {
      await backup.close()
    }
    await this.write(name, migrated, current)
    return migrated
  }
  write(name: string, data: unknown, version = 1): Promise<void> {
    const serialized = JSON.stringify({ version, data })
    const operation = this.queue.then(async () => {
      const target = this.path(name),
        temporary = target + '.' + randomUUID() + '.tmp'
      try {
        const file = await open(temporary, 'wx', 0o600)
        try {
          await file.writeFile(serialized)
          await file.sync()
        } finally {
          await file.close()
        }
        await rename(temporary, target)
        // Windows cannot fsync directory handles; the file itself is already synced above.
        if (process.platform !== 'win32') {
          const dir = await open(this.directory, 'r')
          try {
            await dir.sync()
          } finally {
            await dir.close()
          }
        }
      } catch (error) {
        await rm(temporary, { force: true })
        throw error
      }
    })
    this.queue = operation.catch(() => {})
    return operation
  }
}
export function secureStorageAvailable(): boolean {
  return (
    safeStorage.isEncryptionAvailable() &&
    (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text')
  )
}
export function encryptSecret(value: string): string {
  if (!secureStorageAvailable())
    throw new Error(
      'Secure credential storage is unavailable. Use session-only login or enable a Secret Service provider.',
    )
  return safeStorage.encryptString(value).toString('base64')
}
export function decryptSecret(value: string): string {
  if (!secureStorageAvailable())
    throw new Error('Unlock your OS keyring to reconnect this account.')
  return safeStorage.decryptString(Buffer.from(value, 'base64'))
}
