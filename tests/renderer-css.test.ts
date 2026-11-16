import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'

const rendererDir = new URL('../apps/desktop/src/renderer/src/', import.meta.url)
// Tailwind utility names written as CSS properties (`border-l:` for `border-left:`)
// are silently dropped by the browser.
const property = String.raw`((?:border|scroll-[mp])-[lrtbxyse]|[mp][lrtbxyse]|inset-[xy]|gap-[xy])\s*:`
// CSS strings in TS are minified (`{margin:0;border-left:…}`, `style="…"`), so a
// property follows `{`, `;` or a quote directly. Prettier spaces object literals
// (`{ px: 1 }`), which keeps them out. CSS files put one declaration per line.
const inSource = new RegExp(`[{;"'\`]${property}`, 'g')
const inCss = new RegExp(`(?:^|[{;])\\s*${property}`, 'gm')
const tailwindProperties = (file: string, text: string) =>
  [...text.matchAll(file.endsWith('.css') ? inCss : inSource)].map((match) => match[1])

describe('raw CSS in the renderer', () => {
  it('flags Tailwind utility names but not object literals', () => {
    expect(
      tailwindProperties('a.ts', "'blockquote{border-l:2px solid}hr{border:0;border-t:1px'"),
    ).toEqual(['border-l', 'border-t'])
    expect(tailwindProperties('a.tsx', '<p style="mt:4px" />')).toEqual(['mt'])
    expect(tailwindProperties('a.css', 'p {\n  margin: 0;\n  px: 4px;\n}')).toEqual(['px'])
    expect(tailwindProperties('a.ts', 'const size: { px: number } = { px: 1 }')).toEqual([])
    expect(tailwindProperties('a.tsx', "cn('[--w-bg:#171718] px-2 md:mt-1')")).toEqual([])
  })
  it('uses CSS property names rather than Tailwind utility names', () => {
    const offenders = readdirSync(rendererDir, { recursive: true, encoding: 'utf8' })
      .filter((file) => /\.(tsx?|css)$/.test(file))
      .flatMap((file) =>
        tailwindProperties(file, readFileSync(new URL(file, rendererDir), 'utf8')).map(
          (name) => `${file}: ${name}:`,
        ),
      )
    expect(offenders).toEqual([])
  })
})
