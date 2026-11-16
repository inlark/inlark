import { describe, expect, it } from 'vitest'
import { settingsSchema, defaultSettings } from '../packages/core/src'
import {
  contrast,
  darkBackground,
  darkenFrame,
  darkForeground,
  imageStats,
  imageTreatment,
  oklab,
  parseColor,
  prepareDarkImage,
  recolorPixels,
  type DarkImage,
  type Rgb,
} from '../apps/desktop/src/renderer/src/email-dark'

const hex = (value: string): Rgb => {
  const color = parseColor(value)
  if (!color) throw new Error('Not a colour: ' + value)
  return { r: color.r, g: color.g, b: color.b }
}
const surface = hex('#1e1e20')
const white = hex('#ffffff')
const chroma = (color: Rgb) => Math.hypot(oklab(color).a, oklab(color).b)

/** Pixels for a small image: `paint` returns RGBA for each position. */
function pixels(width: number, height: number, paint: (x: number, y: number) => number[]) {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) data.set(paint(x, y), (y * width + x) * 4)
  return data
}

describe('email dark colours: backgrounds', () => {
  it('turns white paper into the dark surface', () => {
    expect(darkBackground(white, surface)).toEqual(surface)
  })
  it('keeps the order of light greys, so a wrapper still differs from its card', () => {
    const wrapper = darkBackground(hex('#f4f4f5'), surface)
    expect(oklab(wrapper).L).toBeGreaterThan(oklab(surface).L)
    expect(oklab(wrapper).L).toBeLessThan(0.35)
  })
  it('keeps the hue of pastel backgrounds', () => {
    const paid = darkBackground(hex('#dcfce7'), surface)
    expect(oklab(paid).L).toBeLessThan(0.3)
    expect(paid.g).toBeGreaterThan(paid.r)
    expect(paid.g).toBeGreaterThan(paid.b)
  })
  it.each(['#2563eb', '#f97316', '#5b4cdb', '#ffff00', '#0b0b0f', '#1f2937'])(
    'leaves brand, highlight and dark backgrounds as sent: %s',
    (color) => {
      expect(darkBackground(hex(color), surface)).toEqual(hex(color))
    },
  )
})

describe('email dark colours: text and borders', () => {
  it('makes black text on white about as strong as the app’s own text', () => {
    const text = darkForeground(hex('#000000'), white, surface, 'text')
    expect(contrast(text, surface)).toBeGreaterThan(12)
    expect(contrast(text, surface)).toBeLessThan(15)
  })
  it('keeps the hierarchy between body text and quieter grey text', () => {
    const body = darkForeground(hex('#333333'), white, surface, 'text')
    const quiet = darkForeground(hex('#777777'), white, surface, 'text')
    expect(contrast(body, surface)).toBeGreaterThan(contrast(quiet, surface))
  })
  it('never lets faint footer text drop below a readable contrast', () => {
    for (const color of ['#999999', '#b0b0b0', '#cccccc'])
      expect(contrast(darkForeground(hex(color), white, surface, 'text'), surface)).toBeGreaterThan(
        2.99,
      )
  })
  it('keeps text that was readable at 4.5:1 at least that readable', () => {
    const grey = hex('#6b7280')
    expect(contrast(grey, white)).toBeGreaterThan(4.5)
    expect(contrast(darkForeground(grey, white, surface, 'text'), surface)).toBeGreaterThan(4.49)
  })
  it('keeps hidden preview text hidden', () => {
    expect(darkForeground(white, white, surface, 'text')).toEqual(surface)
  })
  it('keeps the hue of coloured text', () => {
    const red = darkForeground(hex('#c00000'), white, surface, 'text')
    expect(red.r).toBeGreaterThan(red.g * 1.5)
    expect(contrast(red, surface)).toBeGreaterThan(4.49)
  })
  it('keeps dividers subtle but visible', () => {
    const divider = darkForeground(hex('#e5e7eb'), white, surface, 'border')
    expect(oklab(divider).L).toBeGreaterThan(oklab(surface).L)
    expect(contrast(divider, surface)).toBeLessThan(1.6)
  })
})

describe('email dark colours: images', () => {
  const transparentLogo = pixels(40, 20, (x, y) =>
    x > 8 && x < 32 && y > 6 && y < 14 ? [10, 10, 10, 255] : [0, 0, 0, 0],
  )
  const whiteLogo = pixels(40, 20, (x, y) =>
    x > 8 && x < 32 && y > 6 && y < 14 ? [255, 255, 255, 255] : [0, 0, 0, 0],
  )
  const boxedLogo = pixels(40, 20, (x, y) =>
    x > 8 && x < 14 && y > 6 && y < 14
      ? [208, 2, 27, 255]
      : x > 16 && x < 32 && y > 6 && y < 14
        ? [17, 17, 17, 255]
        : [255, 255, 255, 255],
  )
  const photo = pixels(40, 20, (x, y) => [80 + x * 3, 120 + y * 4, 200 - x * 2, 255])

  it('lightens dark logos on transparency, leaves light ones alone', () => {
    expect(imageTreatment(imageStats(transparentLogo, 40, 20))).toBe('lighten')
    expect(imageTreatment(imageStats(whiteLogo, 40, 20))).toBe('keep')
  })
  it('inverts flat graphics on a white box, but never photos', () => {
    expect(imageTreatment(imageStats(boxedLogo, 40, 20))).toBe('invert')
    expect(imageTreatment(imageStats(photo, 40, 20))).toBe('keep')
  })
  it('keeps the hue of brand colours while the box turns dark and the ink light', () => {
    const data = new Uint8ClampedArray([208, 2, 27, 255, 255, 255, 255, 255, 17, 17, 17, 255])
    recolorPixels(data, 'invert', surface)
    const [red, box, ink] = [0, 4, 8].map((i) => ({ r: data[i], g: data[i + 1], b: data[i + 2] }))
    expect(red.r).toBeGreaterThan(red.g * 2)
    expect(chroma(red)).toBeGreaterThan(0.1)
    expect(contrast(box, surface)).toBeLessThan(1.1)
    expect(contrast(ink, surface)).toBeGreaterThan(7)
  })
  it('lightens only the dark ink of a transparent logo', () => {
    const data = new Uint8ClampedArray([0, 0, 0, 255, 59, 130, 246, 255, 0, 0, 0, 0])
    recolorPixels(data, 'lighten', surface)
    expect(oklab({ r: data[0], g: data[1], b: data[2] }).L).toBeGreaterThan(0.9)
    expect([data[4], data[5], data[6]]).toEqual([59, 130, 246])
    expect([...data.slice(8)]).toEqual([0, 0, 0, 0])
  })
})

describe('email dark colours: parsing and settings', () => {
  it('reads computed colours and theme tokens', () => {
    expect(parseColor('rgb(1, 2, 3)')).toEqual({ r: 1, g: 2, b: 3, a: 1 })
    expect(parseColor('rgba(1, 2, 3, 0.5)')).toEqual({ r: 1, g: 2, b: 3, a: 0.5 })
    expect(parseColor('#1e1e20')).toEqual({ r: 30, g: 30, b: 32, a: 1 })
    expect(parseColor('#fff')).toEqual({ r: 255, g: 255, b: 255, a: 1 })
    expect(parseColor('oklch(0.5 0.1 200)')).toBeNull()
  })
  it('keeps the white background unless dark colours are chosen', () => {
    expect(defaultSettings.messageColors).toBeUndefined()
    expect(settingsSchema.safeParse({ ...defaultSettings, messageColors: 'dark' }).success).toBe(
      true,
    )
    expect(settingsSchema.safeParse({ ...defaultSettings, messageColors: 'blue' }).success).toBe(
      false,
    )
  })
})

/** Just enough of an email frame for `darkenFrame`: computed colours and inline style attributes. */
interface FakeComputed {
  background?: string
  image?: string
  color?: string
  border?: string
}
class FakeElement {
  parentElement: FakeElement | null = null
  children: FakeElement[] = []
  private attributes = new Map<string, string>()
  private inline = new Map<string, string>()
  readonly style = {
    setProperty: (name: string, value: string, priority = '') => {
      this.inline.set(name, value)
      this.attributes.set(
        'style',
        [...this.inline]
          .map(([key, val]) => `${key}: ${val}${priority ? ' !' + priority : ''}`)
          .join('; '),
      )
    },
  }
  constructor(
    readonly tagName: string,
    readonly computed: FakeComputed = {},
    attributes: Record<string, string> = {},
  ) {
    for (const [name, value] of Object.entries(attributes)) this.attributes.set(name, value)
  }
  getAttribute(name: string) {
    return this.attributes.get(name) ?? null
  }
  setAttribute(name: string, value: string) {
    this.attributes.set(name, value)
    if (name === 'style') this.inline.clear()
  }
  removeAttribute(name: string) {
    this.attributes.delete(name)
    if (name === 'style') this.inline.clear()
  }
  /** What the conversion wrote for a property, if anything. */
  written(name: string) {
    return this.inline.get(name)
  }
  append(...children: FakeElement[]) {
    for (const child of children) {
      child.parentElement = this
      this.children.push(child)
    }
    return this
  }
  getElementsByTagName() {
    const all: FakeElement[] = []
    const walk = (element: FakeElement) =>
      element.children.forEach((child) => {
        all.push(child)
        walk(child)
      })
    walk(this)
    return all
  }
}
/** The frame as inlark writes it: white paper with dark grey text on `<html>`. */
function frame(...content: FakeElement[]) {
  const body = new FakeElement('BODY').append(...content)
  const html = new FakeElement('HTML', { background: 'rgb(255, 255, 255)' }).append(body)
  const colorOf = (element: FakeElement | null): string =>
    element ? (element.computed.color ?? colorOf(element.parentElement)) : 'rgb(36, 38, 43)'
  const getComputedStyle = (element: FakeElement) => ({
    backgroundColor: element.computed.background ?? 'rgba(0, 0, 0, 0)',
    backgroundImage: element.computed.image ?? 'none',
    color: colorOf(element),
    getPropertyValue: (name: string) => {
      const border = element.computed.border
      if (name.endsWith('-width')) return border ? '1px' : '0px'
      if (name.endsWith('-style')) return border ? 'solid' : 'none'
      return border ?? colorOf(element)
    },
  })
  return {
    html,
    doc: { documentElement: html, body, defaultView: { getComputedStyle } } as unknown as Document,
  }
}
const written = (element: FakeElement, name: string) => {
  const value = element.written(name)
  return value ? hex(value) : undefined
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('email dark colours: converting a frame', () => {
  it('darkens paper, text and borders, then restores every attribute exactly', () => {
    const quote = new FakeElement('SPAN')
    const paragraph = new FakeElement(
      'P',
      { color: 'rgb(0, 0, 0)', border: 'rgb(229, 231, 235)' },
      { style: 'color:#000;border:1px solid #e5e7eb' },
    ).append(quote)
    const { html, doc } = frame(paragraph)
    const restore = darkenFrame(doc, surface)
    expect(written(html, 'background-color')).toEqual(surface)
    expect(contrast(written(paragraph, 'color')!, surface)).toBeGreaterThan(12)
    expect(oklab(written(paragraph, 'border-top-color')!).L).toBeGreaterThan(oklab(surface).L)
    restore()
    expect(paragraph.getAttribute('style')).toBe('color:#000;border:1px solid #e5e7eb')
    expect(html.getAttribute('style')).toBeNull()
    expect(quote.getAttribute('style')).toBeNull()
  })
  it('keeps a highlight and the text on it as sent', () => {
    const highlight = new FakeElement('SPAN', { background: 'rgb(255, 255, 0)' })
    const { doc } = frame(new FakeElement('P', { color: 'rgb(0, 0, 0)' }).append(highlight))
    darkenFrame(doc, surface)
    expect(highlight.written('background-color')).toBeUndefined()
    // Pinned, so it doesn't inherit the light text colour of the paragraph around it.
    expect(highlight.written('color')).toBe('rgb(0, 0, 0)')
  })
  it('keeps a gradient that would end up half dark and half light, with its text', () => {
    const banner = new FakeElement('DIV', {
      image: 'linear-gradient(rgb(255, 255, 255), rgb(37, 99, 235))',
      color: 'rgb(0, 0, 0)',
    })
    const { doc } = frame(banner)
    darkenFrame(doc, surface)
    expect(banner.written('background-image')).toBeUndefined()
    expect(banner.written('color')).toBe('rgb(0, 0, 0)')
  })
  it('darkens light gradients stop by stop and lightens the text on them', () => {
    const banner = new FakeElement('DIV', {
      image: 'linear-gradient(rgb(238, 242, 255) 0%, rgb(255, 255, 255) 100%)',
      color: 'rgb(55, 48, 163)',
    })
    const { doc } = frame(banner)
    darkenFrame(doc, surface)
    const stops = banner
      .written('background-image')!
      .match(/rgb\([^)]*\)/g)!
      .map(hex)
    expect(stops).toHaveLength(2)
    for (const stop of stops) expect(oklab(stop).L).toBeLessThan(0.35)
    expect(banner.written('background-image')).toContain('0%')
    for (const stop of stops)
      expect(contrast(written(banner, 'color')!, stop)).toBeGreaterThan(4.49)
  })
  it('leaves an area alone when its background colour can’t be read', () => {
    const card = new FakeElement('DIV', {
      background: 'color(srgb 0.05 0.05 0.05)',
      color: 'rgb(255, 255, 255)',
    })
    const { doc } = frame(card)
    darkenFrame(doc, surface)
    expect(card.written('background-color')).toBeUndefined()
    // Not mistaken for white text hidden on white paper.
    expect(card.written('color')).toBe('rgb(255, 255, 255)')
  })
  it('swaps a late image in only while the dark colours are still shown', async () => {
    const late = (name: string) => {
      const src = 'data:image/png;base64,' + name
      let finish!: (image: DarkImage) => void
      const prepared = prepareDarkImage(src, surface, () => new Promise((done) => (finish = done)))
      const image = new FakeElement('IMG', {}, { src })
      const restore = darkenFrame(frame(image).doc, surface)
      return { src, image, restore, prepared, finish: () => finish({ src: src + '-dark' }) }
    }
    const shown = late('shown')
    shown.finish()
    await shown.prepared
    await settle()
    expect(shown.image.getAttribute('src')).toBe(shown.src + '-dark')
    expect(shown.image.getAttribute('srcset')).toBe(shown.src + '-dark 1x')
    shown.restore()
    expect(shown.image.getAttribute('src')).toBe(shown.src)
    expect(shown.image.getAttribute('srcset')).toBeNull()

    const switchedBack = late('switched-back')
    switchedBack.restore()
    switchedBack.finish()
    await switchedBack.prepared
    await settle()
    expect(switchedBack.image.getAttribute('src')).toBe(switchedBack.src)
    expect(switchedBack.image.getAttribute('srcset')).toBeNull()
  })
})
