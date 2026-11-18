import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { handle, uninstallSurvey } from '../apps/marketing/worker/routes'

const location = async (path: string) =>
  (await handle(new Request('https://inlark.com' + path)))?.headers.get('Location')

describe('uninstall survey redirect', () => {
  it('sends inlark.com/uninstall to the survey, without a permanent redirect', async () => {
    for (const path of ['/uninstall', '/uninstall/']) {
      const response = await handle(new Request('https://inlark.com' + path))
      expect(response?.status).toBe(302)
      expect(response?.headers.get('Location')).toBe(uninstallSurvey)
    }
    expect(uninstallSurvey).toMatch(/^https:\/\//)
  })

  it('passes on the version the uninstaller reports', async () => {
    expect(await location('/uninstall?version=0.4.0')).toBe(uninstallSurvey + '?version=0.4.0')
    expect(await location('/uninstall?version=0.4.0-beta.1')).toBe(
      uninstallSurvey + '?version=0.4.0-beta.1',
    )
  })

  it('drops anything that is not a version', async () => {
    for (const version of [
      '',
      'latest',
      '1.2',
      '0.4.0<script>',
      '0.4.0&x=1',
      '1.0.0-' + 'a'.repeat(64),
    ]) {
      expect(await location('/uninstall?version=' + encodeURIComponent(version))).toBe(
        uninstallSurvey,
      )
    }
    expect(await location('/uninstall?other=1')).toBe(uninstallSurvey)
  })

  it('leaves other paths and methods to the static site', async () => {
    expect(await handle(new Request('https://inlark.com/uninstalled'))).toBeNull()
    expect(await handle(new Request('https://inlark.com/uninstall', { method: 'POST' }))).toBeNull()
  })
})

describe('Windows uninstaller', () => {
  const config = readFileSync('apps/desktop/electron-builder.yml', 'utf8')
  const include = /^nsis:\n {2}include: (.+)$/m.exec(config)?.[1]
  const script = readFileSync('apps/desktop/' + include, 'utf8')
  const hook = /^!macro customUnInstall\n([\s\S]*?)^!macroend/m.exec(script)?.[1] ?? ''

  /** Each line of the hook, without comments, with the `${if}` conditions around it. */
  const lines = (() => {
    const open: string[] = []
    return hook.split('\n').map((raw) => {
      const line = raw.replace(/#.*/, '').trim()
      if (/^\$\{endIf\}$/i.test(line)) open.pop()
      const entry = { line, within: [...open] }
      if (/^\$\{if(Not)?\}/i.test(line)) open.push(line)
      return entry
    })
  })()
  const launches = lines.filter(({ line }) => /Exec/i.test(line))

  it('opens a page that leads to the survey with the installed version', async () => {
    expect(launches).toHaveLength(1)
    const url = /^ExecShell "open" "([^"]+)"$/.exec(launches[0].line)?.[1]
    expect(url).toBe('https://inlark.com/uninstall?version=${VERSION}')
    const page = new URL(url!.replace('${VERSION}', '0.4.0'))
    expect(await location(page.pathname + page.search)).toBe(uninstallSurvey + '?version=0.4.0')
  })

  it('skips the survey when updating and when the uninstaller was started with /S', () => {
    expect(launches[0].within).toEqual(['${ifNot} ${isUpdated}', '${if} ${Errors}'])
    // The error flag has to come from looking for /S right before it's checked.
    const check = lines.findIndex(({ line }) => line === '${if} ${Errors}')
    expect(lines.slice(check - 3, check).map(({ line }) => line)).toEqual([
      '${GetParameters} $R0',
      'ClearErrors',
      '${GetOptions} $R0 "/S" $R1',
    ])
  })
})
