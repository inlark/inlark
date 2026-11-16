import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'

const rendererDir = new URL('../apps/desktop/src/renderer/src/', import.meta.url)
// Tailwind utility names written as CSS properties (`border-l:` for `border-left:`)
// are silently dropped by the browser.
const tailwindProperty =
  /[{;]\s*((?:border|scroll-[mp])-[lrtbxyse]|[mp][lrtbxyse]|inset-[xy]|gap-[xy])\s*:/g

describe('raw CSS in the renderer', () => {
  it('uses CSS property names rather than Tailwind utility names', () => {
    const offenders = readdirSync(rendererDir, { recursive: true, encoding: 'utf8' })
      .filter((file) => /\.(tsx?|css)$/.test(file))
      .flatMap((file) =>
        [...readFileSync(new URL(file, rendererDir), 'utf8').matchAll(tailwindProperty)].map(
          (match) => `${file}: ${match[1]}:`,
        ),
      )
    expect(offenders).toEqual([])
  })
})
