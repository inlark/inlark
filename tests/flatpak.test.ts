import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

describe('Flatpak release preparation', () => {
  let directory: string
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'inlark-flatpak-'))
  })
  afterEach(() => rmSync(directory, { recursive: true, force: true }))

  function prepare(version = '0.3.0') {
    const archive = join(directory, `Inlark-${version}-x64.tar.gz`)
    writeFileSync(archive, 'the packaged release')
    const output = join(directory, 'output')
    execFileSync(process.execPath, ['scripts/prepare-flatpak.mjs', version, archive, output], {
      env: { ...process.env, RELEASE_DATE: '2026-10-03' },
    })
    return { archive, output }
  }

  it('pins the published archive and tests identical bytes locally', () => {
    const { archive, output } = prepare()
    const published = JSON.parse(
      readFileSync(join(output, 'flathub/com.inlark.Inlark.json'), 'utf8'),
    )
    const local = JSON.parse(readFileSync(join(output, 'local/com.inlark.Inlark.json'), 'utf8'))
    const source = published.modules[0].sources[0]
    expect(source.url).toBe(
      'https://github.com/inlark/inlark/releases/download/v0.3.0/Inlark-0.3.0-x64.tar.gz',
    )
    expect(source.sha256).toBe(createHash('sha256').update(readFileSync(archive)).digest('hex'))
    expect(source.path).toBeUndefined()
    expect(resolve(output, 'local', local.modules[0].sources[0].path)).toBe(archive)
    local.modules[0].sources[0] = source
    expect(local).toEqual(published)
    const metadata = readFileSync(join(output, 'flathub/com.inlark.Inlark.metainfo.xml'), 'utf8')
    expect(metadata).toContain('<release version="0.3.0" date="2026-10-03">')
    expect(metadata).toContain('/v0.3.0/.github/assets/inbox-dark.png')
    expect(metadata).not.toMatch(/@VERSION@|@DATE@/)
    expect(readFileSync(join(output, 'flathub/com.inlark.Inlark.png'))).toEqual(
      readFileSync('apps/desktop/resources/icon.png'),
    )
  })

  it('can prepare a prerelease bundle without targeting the stable Flathub channel', () => {
    const { output } = prepare('0.3.0-beta.1')
    expect(readFileSync(join(output, 'flathub/com.inlark.Inlark.json'), 'utf8')).toContain(
      '/v0.3.0-beta.1/Inlark-0.3.0-beta.1-x64.tar.gz',
    )
    const result = spawnSync('bash', ['scripts/publish-flathub.sh'], {
      env: { ...process.env, GH_TOKEN: 'test', RELEASE_TAG: 'v0.3.0-beta.1' },
      encoding: 'utf8',
    })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Only stable releases')
  })

  it('rejects mismatched archive versions before producing a manifest', () => {
    const archive = join(directory, 'Inlark-0.2.0-x64.tar.gz')
    writeFileSync(archive, 'old release')
    const result = spawnSync(
      process.execPath,
      ['scripts/prepare-flatpak.mjs', '0.3.0', archive, join(directory, 'output')],
      { encoding: 'utf8' },
    )
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Expected archive named Inlark-0.3.0-x64.tar.gz')
  })

  it('skips older release reruns before touching the Flathub repository', () => {
    const { output } = prepare()
    const calls = join(directory, 'calls')
    writeFileSync(
      join(directory, 'gh'),
      '#!/bin/sh\nprintf "%s\\n" "$*" >> "$CALLS"\nprintf "%s\\n" v0.4.0\n',
      { mode: 0o700 },
    )
    const result = spawnSync('bash', ['scripts/publish-flathub.sh', join(output, 'flathub')], {
      env: {
        ...process.env,
        PATH: `${directory}:${process.env.PATH}`,
        GH_TOKEN: 'test',
        RELEASE_TAG: 'v0.3.0',
        CALLS: calls,
      },
      encoding: 'utf8',
    })
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Skipping v0.3.0: the latest stable release is v0.4.0')
    expect(readFileSync(calls, 'utf8')).toBe(
      'api repos/inlark/inlark/releases/latest --jq .tag_name\n',
    )
  })
})
