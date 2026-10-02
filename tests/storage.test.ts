import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { JsonStore } from '../apps/desktop/src/main/storage'

const fs = vi.hoisted(() => ({ open: vi.fn(), rename: vi.fn(), rm: vi.fn() }))
vi.mock('node:fs/promises', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs/promises')>()),
  ...fs,
}))

const directory = join('mail', 'storage')
const target = join(directory, 'drafts.json')
const file = {
  writeFile: vi.fn(),
  sync: vi.fn(),
  close: vi.fn(),
}
const dir = { sync: vi.fn(), close: vi.fn() }

beforeEach(() => {
  vi.resetAllMocks()
  file.writeFile.mockResolvedValue(undefined)
  file.sync.mockResolvedValue(undefined)
  file.close.mockResolvedValue(undefined)
  dir.sync.mockResolvedValue(undefined)
  dir.close.mockResolvedValue(undefined)
  fs.open.mockImplementation(async (path) => (path === directory ? dir : file))
  fs.rename.mockResolvedValue(undefined)
  fs.rm.mockResolvedValue(undefined)
})
afterEach(() => {
  vi.unstubAllGlobals()
})

function platform(value: NodeJS.Platform) {
  vi.stubGlobal('process', Object.create(process, { platform: { value } }))
}

describe('JsonStore atomic writes', () => {
  it('saves on Windows without opening or syncing a directory handle', async () => {
    platform('win32')
    const error = Object.assign(new Error('EPERM: operation not permitted, fsync'), {
      code: 'EPERM',
    })
    dir.sync.mockRejectedValue(error)

    await expect(new JsonStore(directory).write('drafts', ['draft'])).resolves.toBeUndefined()

    expect(fs.open).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/\.tmp$/), 'wx', 0o600)
    expect(file.writeFile).toHaveBeenCalledWith(JSON.stringify({ version: 1, data: ['draft'] }))
    expect(file.sync).toHaveBeenCalledOnce()
    expect(file.close).toHaveBeenCalledOnce()
    expect(file.sync.mock.invocationCallOrder[0]).toBeLessThan(
      file.close.mock.invocationCallOrder[0]!,
    )
    expect(file.close.mock.invocationCallOrder[0]).toBeLessThan(
      fs.rename.mock.invocationCallOrder[0]!,
    )
    expect(fs.rename).toHaveBeenCalledExactlyOnceWith(fs.open.mock.calls[0]![0], target)
    expect(dir.sync).not.toHaveBeenCalled()
    expect(fs.rm).not.toHaveBeenCalled()
  })

  it.each(['linux', 'darwin'] as const)(
    'syncs the parent directory after renaming on %s',
    async (os) => {
      platform(os)

      await new JsonStore(directory).write('drafts', [])

      expect(file.sync).toHaveBeenCalledOnce()
      expect(fs.open).toHaveBeenCalledWith(directory, 'r')
      expect(dir.sync).toHaveBeenCalledOnce()
      expect(dir.close).toHaveBeenCalledOnce()
      expect(fs.rename.mock.invocationCallOrder[0]).toBeLessThan(
        dir.sync.mock.invocationCallOrder[0]!,
      )
      expect(dir.sync.mock.invocationCallOrder[0]).toBeLessThan(
        dir.close.mock.invocationCallOrder[0]!,
      )
    },
  )

  it('propagates file sync failures on Windows and removes the temporary file', async () => {
    platform('win32')
    const error = Object.assign(new Error('File sync failed'), { code: 'EPERM' })
    file.sync.mockRejectedValueOnce(error)

    await expect(new JsonStore(directory).write('drafts', [])).rejects.toBe(error)

    expect(file.close).toHaveBeenCalledOnce()
    expect(fs.rename).not.toHaveBeenCalled()
    expect(fs.rm).toHaveBeenCalledExactlyOnceWith(fs.open.mock.calls[0]![0], { force: true })
  })

  it('propagates directory sync failures on Linux and closes the handle', async () => {
    platform('linux')
    const error = Object.assign(new Error('Directory sync failed'), { code: 'EPERM' })
    dir.sync.mockRejectedValueOnce(error)

    await expect(new JsonStore(directory).write('drafts', [])).rejects.toBe(error)

    expect(dir.close).toHaveBeenCalledOnce()
  })
})
