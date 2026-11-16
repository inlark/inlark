import { describe, expect, it } from 'vitest'
import { settingsSchema, defaultSettings } from '../packages/core/src'
import {
  contrast,
  darkBackground,
  darkForeground,
  imageStats,
  imageTreatment,
  oklab,
  parseColor,
  recolorPixels,
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
