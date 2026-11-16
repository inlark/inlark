/**
 * Dark colours for designed email.
 *
 * Light paper becomes a dark surface, text and borders keep the contrast their sender gave them,
 * and logos drawn for white paper are lightened without changing their hue. Dark and strongly
 * coloured areas (brand buttons, highlights, emails that are already dark) stay as sent. Only the
 * copy rendered in the reader changes, and `darkenFrame` returns how to put it back.
 */

export type Rgb = { r: number; g: number; b: number }
type Rgba = Rgb & { a: number }
type Lab = { L: number; a: number; b: number }

const toLinear = (channel: number) => {
  const c = channel / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}
const fromLinear = (value: number) =>
  Math.round(
    Math.max(
      0,
      Math.min(1, value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055),
    ) * 255,
  )

/** OKLab keeps hue steady while lightness changes, unlike HSL. */
export function oklab({ r, g, b }: Rgb): Lab {
  const [lr, lg, lb] = [toLinear(r), toLinear(g), toLinear(b)]
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb)
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb)
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb)
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  }
}
const linearFromOklab = ({ L, a, b }: Lab) => {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
}
/** Back to sRGB, giving up chroma until the colour fits so its hue and lightness survive. */
export function fromOklab({ L, a, b }: Lab): Rgb {
  for (let i = 0; i < 40; i++, a *= 0.88, b *= 0.88) {
    const linear = linearFromOklab({ L, a, b })
    if (linear.every((v) => v >= -1e-4 && v <= 1 + 1e-4))
      return { r: fromLinear(linear[0]), g: fromLinear(linear[1]), b: fromLinear(linear[2]) }
  }
  const [r, g, bl] = linearFromOklab({ L, a: 0, b: 0 })
  return { r: fromLinear(r), g: fromLinear(g), b: fromLinear(bl) }
}

/** WCAG relative luminance. */
export const luminance = ({ r, g, b }: Rgb) =>
  0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b)
/** WCAG contrast ratio, from 1 to 21. */
export function contrast(x: Rgb, y: Rgb) {
  const a = luminance(x),
    b = luminance(y)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}
/**
 * The same hue and chroma, at the lightness whose luminance is at least (or at most) `target`.
 * The bound really holds after rounding to whole channels, so contrast floors are never missed.
 */
function withLuminance(color: Rgb, target: number, side: 'atLeast' | 'atMost'): Rgb {
  const { a, b } = oklab(color)
  let low = 0,
    high = 1
  for (let i = 0; i < 24; i++) {
    const L = (low + high) / 2
    if (luminance(fromOklab({ L, a, b })) < target) low = L
    else high = L
  }
  let L = side === 'atLeast' ? high : low
  for (let i = 0; i < 50; i++) {
    const result = fromOklab({ L, a, b })
    const y = luminance(result)
    if (side === 'atLeast' ? y >= target : y <= target) return result
    L = side === 'atLeast' ? Math.min(1, L + 0.002) : Math.max(0, L - 0.002)
  }
  return fromOklab({ L, a, b })
}

/** Reads computed colours (`rgb()`/`rgba()`) and theme tokens (`#rrggbb`). Anything else is left alone. */
export function parseColor(value: string): Rgba | null {
  const hex = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(value.trim())
  if (hex) {
    const digits = hex[1].length === 3 ? [...hex[1]].map((d) => d + d).join('') : hex[1]
    const n = parseInt(digits, 16)
    return { r: n >> 16, g: (n >> 8) & 255, b: n & 255, a: 1 }
  }
  const match = /^rgba?\(([^)]+)\)$/i.exec(value.trim())
  if (!match) return null
  const parts = match[1]
    .split(/[\s,/]+/)
    .filter(Boolean)
    .map(Number)
  if (parts.length < 3 || parts.some(Number.isNaN)) return null
  return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 }
}
const resolvedColors = new Map<string, Rgba | null>()
let colorProbe: CanvasRenderingContext2D | null | undefined
/**
 * Like `parseColor`, but also understands what the browser keeps in other notations, such as
 * `color(srgb …)` or `oklch(…)`, by painting it. Without a browser those stay unreadable.
 */
function readColor(value: string): Rgba | null {
  const parsed = parseColor(value)
  if (parsed || typeof document === 'undefined' || typeof CSS === 'undefined') return parsed
  if (resolvedColors.has(value)) return resolvedColors.get(value)!
  let resolved: Rgba | null = null
  if (CSS.supports('color', value)) {
    colorProbe ??= document.createElement('canvas').getContext('2d', { willReadFrequently: true })
    if (colorProbe) {
      colorProbe.clearRect(0, 0, 1, 1)
      colorProbe.fillStyle = value
      colorProbe.fillRect(0, 0, 1, 1)
      const [r, g, b, a] = colorProbe.getImageData(0, 0, 1, 1).data
      resolved = { r, g, b, a: a / 255 }
    }
  }
  if (resolvedColors.size > 256) resolvedColors.clear()
  resolvedColors.set(value, resolved)
  return resolved
}
/** Every colour in a computed gradient, in order. */
const colorTokens =
  /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\([^()]*\)|#[\da-f]{3,8}\b|\b(?:transparent|currentcolor)\b/gi
const over = (top: Rgba, under: Rgb): Rgb =>
  top.a >= 1
    ? { r: top.r, g: top.g, b: top.b }
    : {
        r: top.r * top.a + under.r * (1 - top.a),
        g: top.g * top.a + under.g * (1 - top.a),
        b: top.b * top.a + under.b * (1 - top.a),
      }
const css = ({ r, g, b }: Rgb) => `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`
const same = (x: Rgb, y: Rgb) => Math.abs(x.r - y.r) + Math.abs(x.g - y.g) + Math.abs(x.b - y.b) < 3

const white: Rgb = { r: 255, g: 255, b: 255 }
/** Backgrounds lighter than this OKLab lightness count as paper and turn dark. */
const paperLightness = 0.5
/** Black on white (21:1) becomes about 14:1, like the app's own text, rather than glaring. */
const contrastScale = Math.log(14) / Math.log(21)

/** Light backgrounds turn dark with the same hue; white becomes `base`. */
export function darkBackground(color: Rgb, base: Rgb): Rgb {
  const lab = oklab(color)
  const chroma = Math.hypot(lab.a, lab.b)
  // Dark colours, brand colours and highlighter yellow already work on a dark page.
  if (lab.L <= paperLightness || chroma > 0.15 || (chroma > 0.08 && lab.L < 0.93)) return color
  if (lab.L > 0.999 && chroma < 0.002) return base
  const floor = oklab(base).L
  const L = floor + ((1 - lab.L) / (1 - paperLightness)) * (paperLightness - floor)
  // Darker tints carry the same chroma more strongly, so pastels are muted to match.
  const keep = Math.min(1, (1.6 * L) / lab.L)
  return fromOklab({ L, a: lab.a * keep, b: lab.b * keep })
}

/**
 * Text and borders keep the contrast the sender gave them against their background, measured
 * again against the darkened one. Text never drops below a readable 3:1, or below 4.5:1 where
 * the sender had at least that.
 */
export function darkForeground(color: Rgb, before: Rgb, after: Rgb, kind: 'text' | 'border'): Rgb {
  return darkForegroundOver(color, [[before, after]], kind)
}
/**
 * The same over several backgrounds at once, such as the stops of a gradient: the text keeps the
 * contrast it had with each of them, so no part of the gradient becomes harder to read.
 */
export function darkForegroundOver(
  color: Rgb,
  backgrounds: [before: Rgb, after: Rgb][],
  kind: 'text' | 'border',
): Rgb {
  const originals = backgrounds.map(([before]) => contrast(color, before))
  // Text hidden against its own background, such as an inbox preview line, stays hidden.
  if (kind === 'text' && Math.max(...originals) < 1.25) return backgrounds[0][1]
  const y = luminance(color)
  // How light and how dark the colour may be while keeping its contrast with every background.
  let atLeast = 0,
    atMost = 1
  backgrounds.forEach(([, after], index) => {
    const original = originals[index]
    let target = original ** contrastScale
    if (kind === 'text') target = Math.max(target, Math.min(original, 4.5), 3)
    const yAfter = luminance(after)
    atLeast = Math.max(atLeast, target * (yAfter + 0.05) - 0.05)
    atMost = Math.min(atMost, (yAfter + 0.05) / target - 0.05)
  })
  const fits = (lighter: boolean) => (lighter ? atLeast <= 1 : atMost >= 0)
  const worst = (extreme: Rgb) =>
    Math.min(...backgrounds.map(([, after]) => contrast(extreme, after)))
  // Dark text on paper that turned dark becomes light text, and the other way round...
  const yBefore = luminance(backgrounds[0][0])
  const mirrored = luminance(backgrounds[0][1]) < yBefore ? y <= yBefore : y > yBefore
  // ...unless that can't reach the contrast, like white text on a grey button that only got a
  // little darker. Then the text stays on the sender's side, as close to its own colour as it can.
  const lighter = fits(mirrored)
    ? mirrored
    : fits(!mirrored)
      ? !mirrored
      : worst(white) >= worst({ r: 0, g: 0, b: 0 })
  const goal =
    lighter === mirrored
      ? lighter
        ? atLeast
        : atMost
      : lighter
        ? Math.max(y, atLeast)
        : Math.min(y, atMost)
  // Staying on the sender's side with enough contrast already: the colour stays exactly as sent.
  if (goal === y) return color
  return withLuminance(color, Math.max(0, Math.min(1, goal)), lighter ? 'atLeast' : 'atMost')
}

export interface ImageStats {
  /** Share of transparent pixels. */
  clear: number
  /** Shares of visible pixels that are dark, or neither dark nor near white. */
  dark: number
  mid: number
  /** Share of the visible outer edge that is near white. */
  edgeLight: number
}
export function imageStats(data: Uint8ClampedArray, width: number, height: number): ImageStats {
  let pixels = 0,
    clear = 0,
    visible = 0,
    dark = 0,
    mid = 0,
    edge = 0,
    edgeLight = 0
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      pixels++
      if (data[i + 3] < 32) {
        clear++
        continue
      }
      const { L } = oklab({ r: data[i], g: data[i + 1], b: data[i + 2] })
      visible++
      if (L < 0.5) dark++
      else if (L < 0.9) mid++
      if (x < 2 || y < 2 || x >= width - 2 || y >= height - 2) {
        edge++
        if (L > 0.93) edgeLight++
      }
    }
  return {
    clear: pixels ? clear / pixels : 0,
    dark: visible ? dark / visible : 0,
    mid: visible ? mid / visible : 0,
    edgeLight: edge ? edgeLight / edge : 0,
  }
}
export type ImageTreatment = 'keep' | 'lighten' | 'invert'
/** Logos drawn for white paper are the classic dark mode failure; photos are left alone. */
export function imageTreatment(stats: ImageStats): ImageTreatment {
  // Transparent logos and icons: dark ink would vanish on a dark page.
  if (stats.clear > 0.15) return stats.dark > 0.08 ? 'lighten' : 'keep'
  // Flat graphics on a white box, such as logos saved as JPEG: dark box, light ink.
  if (stats.edgeLight > 0.85 && stats.mid < 0.15) return 'invert'
  return 'keep'
}
/**
 * Changes only each pixel's lightness, so a red brand mark stays red. CSS filters can't do this:
 * `invert() hue-rotate()` turns dark red into pink.
 */
export function recolorPixels(
  data: Uint8ClampedArray,
  treatment: Exclude<ImageTreatment, 'keep'>,
  base: Rgb,
) {
  const floor = oklab(base).L
  const curve =
    treatment === 'lighten'
      ? (L: number) => (L < 0.5 ? 0.92 - L * 0.84 : L)
      : (L: number) => 0.92 - L * (0.92 - floor)
  const cache = new Map<number, Rgb>()
  for (let i = 0; i < data.length; i += 4) {
    if (!data[i + 3]) continue
    const key = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2]
    let color = cache.get(key)
    if (!color) {
      const lab = oklab({ r: data[i], g: data[i + 1], b: data[i + 2] })
      color = fromOklab({ L: curve(lab.L), a: lab.a, b: lab.b })
      cache.set(key, color)
    }
    data[i] = color.r
    data[i + 1] = color.g
    data[i + 2] = color.b
  }
}

/** `density` above 1 means `src` was drawn larger than the image's own size, for sharp vectors. */
export type DarkImage = { src?: string; density?: number; rounded?: boolean } | null
/** Recoloured images by base colour and source. Logos repeat across messages from one sender. */
const darkImages = new Map<string, DarkImage>()
const preparing = new Map<string, Promise<void>>()
const imageCacheSize = 48
/** Larger sources and images are photos and banners in practice; they are never recoloured. */
const maxImageSource = 400_000
const maxImagePixels = 1_000_000
/** Recolouring touches every pixel on the renderer thread; logos are far smaller than this. */
const maxRecolorPixels = 400_000
/** Distinct images recoloured per email. Logos and icons are few; the rest keep their colours. */
const imageBudget = 16
const imageKey = (src: string, base: Rgb) => css(base) + ' ' + src
const canRecolor = (src: string | null): src is string =>
  !!src && /^(data|blob):/.test(src) && src.length <= maxImageSource

async function recolorImage(src: string, base: Rgb): Promise<DarkImage> {
  const image = new Image()
  image.src = src
  await image.decode()
  const { naturalWidth: width, naturalHeight: height } = image
  if (width * height < 64 || width * height > maxImagePixels) return null
  // Classify a small copy; recolour at full size only when it is needed.
  const scale = Math.min(1, 128 / Math.max(width, height))
  const sample = document.createElement('canvas')
  sample.width = Math.max(1, Math.round(width * scale))
  sample.height = Math.max(1, Math.round(height * scale))
  const sampleContext = sample.getContext('2d', { willReadFrequently: true })
  if (!sampleContext) return null
  sampleContext.drawImage(image, 0, 0, sample.width, sample.height)
  const stats = imageStats(
    sampleContext.getImageData(0, 0, sample.width, sample.height).data,
    sample.width,
    sample.height,
  )
  const treatment = imageTreatment(stats)
  if (treatment === 'keep') return stats.edgeLight > 0.85 ? { rounded: true } : null
  // Recolouring runs on the renderer thread, so only logo-sized images are worth the wait.
  if (width * height > maxRecolorPixels) return null
  // Vector logos are drawn at three times their size so they stay sharp on high-density screens.
  const density =
    /^data:image\/svg\+xml/i.test(src) && width * height * 9 <= maxRecolorPixels ? 3 : 1
  const canvas = document.createElement('canvas')
  canvas.width = width * density
  canvas.height = height * density
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return null
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height)
  recolorPixels(pixels.data, treatment, base)
  context.putImageData(pixels, 0, 0)
  return { src: canvas.toDataURL('image/png'), density }
}

/**
 * Works out an image's dark version ahead of time, so it can be swapped in without a flash.
 * `recolor` is replaceable so tests can control when the work finishes.
 */
export function prepareDarkImage(
  src: string | null,
  base: Rgb,
  recolor: (src: string, base: Rgb) => Promise<DarkImage> = recolorImage,
): Promise<void> {
  if (!canRecolor(src)) return Promise.resolve()
  const key = imageKey(src, base)
  if (darkImages.has(key)) return Promise.resolve()
  const running = preparing.get(key)
  if (running) return running
  const job = recolor(src, base)
    .catch(() => null)
    .then((result) => {
      darkImages.set(key, result)
      if (darkImages.size > imageCacheSize) darkImages.delete(darkImages.keys().next().value!)
      preparing.delete(key)
    })
  preparing.set(key, job)
  return job
}

/**
 * Prepares an email's images one at a time, at most `imageBudget` of them, and stops as soon as
 * the email is gone or back in its own colours. Images past the budget simply keep their colours.
 */
export async function prepareDarkImages(
  sources: (string | null)[],
  base: Rgb,
  isWanted: () => boolean,
) {
  const unique = [...new Set(sources.filter(canRecolor))].slice(0, imageBudget)
  for (const src of unique) {
    if (!isWanted()) return
    await prepareDarkImage(src, base)
  }
}

/** Emails with more elements than this keep their original colours; reading them would be slow. */
export const darkElementLimit = 8000

interface Snapshot {
  background: string
  image: string
  color: string
  borders: { side: string; width: number; style: string; color: string }[]
}
interface Region {
  before: Rgb
  after: Rgb
  /** A converted gradient's stops, before and after, so text stays readable across all of it. */
  stops?: [before: Rgb, after: Rgb][]
  /** Text here was designed for a picture behind it, so nothing inside changes. */
  keep: boolean
}
type Styled = Element & ElementCSSInlineStyle
const sides = ['top', 'right', 'bottom', 'left']
const average = (colors: Rgb[]): Rgb => {
  const mean = (channel: keyof Rgb) =>
    colors.reduce((sum, color) => sum + color[channel], 0) / colors.length
  return { r: mean('r'), g: mean('g'), b: mean('b') }
}

type BackgroundPlan =
  | { keep: true; color?: string }
  | {
      keep: false
      before: Rgb
      after: Rgb
      stops?: [before: Rgb, after: Rgb][]
      color?: string
      image?: string
    }

/**
 * What one element's own background becomes. Some areas are kept exactly as sent: a picture
 * behind the text, a colour the reader can't read, or a gradient that would end up half dark and
 * half light, where no single text colour reads well across it. Kept areas are given the solid
 * paper they were designed on, so their see-through parts don't show the darkened page.
 */
function planBackground(style: Snapshot, parent: Region, base: Rgb): BackgroundPlan {
  const background = readColor(style.background)
  // The paper behind this element is changing colour.
  const repainted = !same(parent.before, parent.after)
  const backing = background && background.a > 0 ? over(background, parent.before) : parent.before
  const keep = (): BackgroundPlan => ({
    keep: true,
    color: repainted && background ? css(backing) : undefined,
  })
  // Remote background images never load in the reader, so only embedded ones are pictures.
  if (/url\(\s*["']?(data|blob):/i.test(style.image)) return keep()
  // A colour the reader can't read can't be matched either; it stays exactly as sent.
  if (!background) return { keep: true }
  let before = parent.before
  let after = parent.after
  let stops = parent.stops
  let color: string | undefined
  if (background.a > 0) {
    stops = undefined
    before = backing
    after = darkBackground(before, base)
    // A see-through colour would otherwise mix with the new paper behind it.
    if (!same(before, after) || (background.a < 1 && repainted)) color = css(after)
  }
  if (!/gradient\(/i.test(style.image)) return { keep: false, before, after, stops, color }
  const tokens = style.image.match(colorTokens) ?? []
  const colors = tokens.map((token) => (/^currentcolor$/i.test(token) ? null : readColor(token)))
  if (!colors.length || colors.some((stop) => !stop)) return keep()
  const original = colors.map((stop) => over(stop!, backing))
  const mapped = original.map((stop) => darkBackground(stop, base))
  const changed = original.filter((stop, index) => !same(stop, mapped[index])).length
  if (changed && changed < original.length) return keep()
  if (!changed)
    // The gradient stays, so see-through stops must keep showing the paper they were designed
    // on, whether that paper is this element's own colour or the page's.
    return {
      keep: false,
      before: average(original),
      after: average(original),
      color: repainted || color ? css(backing) : undefined,
    }
  let index = 0
  return {
    keep: false,
    before: average(original),
    after: average(mapped),
    stops: original.map((stop, at) => [stop, mapped[at]]),
    color,
    image: style.image.replace(colorTokens, () => css(mapped[index++])),
  }
}

/**
 * Darkens a designed email that is already laid out in `doc`, returning a function that restores
 * it exactly. Every computed colour is read before anything is written, so inherited colours are
 * never converted twice.
 */
export function darkenFrame(doc: Document, base: Rgb): () => void {
  const styles = new Map<Styled, string | null>()
  const sources = new Map<HTMLImageElement, { src: string | null; srcset: string | null }>()
  let active = true
  const restore = () => {
    active = false
    for (const [element, style] of styles)
      if (style === null) element.removeAttribute('style')
      else element.setAttribute('style', style)
    for (const [image, original] of sources) {
      // Dropping both before restoring makes Chromium forget the recoloured copy's density;
      // otherwise the original keeps being drawn at a third of its size.
      image.removeAttribute('srcset')
      image.removeAttribute('src')
      if (original.src !== null) image.setAttribute('src', original.src)
      if (original.srcset !== null) image.setAttribute('srcset', original.srcset)
    }
    styles.clear()
    sources.clear()
  }
  const set = (element: Styled, property: string, value: string) => {
    if (!styles.has(element)) styles.set(element, element.getAttribute('style'))
    element.style.setProperty(property, value, 'important')
  }
  const swap = (image: HTMLImageElement, src: string | null) => {
    const key = src && imageKey(src, base)
    const dark = key ? darkImages.get(key) : null
    if (!dark) return
    if (dark.rounded) set(image, 'border-radius', '4px')
    if (dark.src) {
      if (!sources.has(image)) sources.set(image, { src, srcset: image.getAttribute('srcset') })
      // The density keeps a sharper copy at the size the original was laid out at.
      image.setAttribute('srcset', dark.src + ' ' + (dark.density ?? 1) + 'x')
      image.setAttribute('src', dark.src)
    }
  }
  const later: [HTMLImageElement, string][] = []
  try {
    const computed = doc.defaultView?.getComputedStyle.bind(doc.defaultView) ?? getComputedStyle
    // Document order, so every parent is handled before its children.
    const elements = [doc.documentElement, doc.body, ...doc.body.getElementsByTagName('*')].filter(
      (element): element is Styled => 'style' in element,
    )
    const snapshot = new Map<Styled, Snapshot>()
    for (const element of elements) {
      const style = computed(element)
      snapshot.set(element, {
        background: style.backgroundColor,
        image: style.backgroundImage,
        color: style.color,
        borders: sides.map((side) => ({
          side,
          width: parseFloat(style.getPropertyValue(`border-${side}-width`)) || 0,
          style: style.getPropertyValue(`border-${side}-style`),
          color: style.getPropertyValue(`border-${side}-color`),
        })),
      })
    }
    // Backgrounds, top down: each element's effective background before and after.
    const paper: Region = { before: white, after: base, keep: false }
    const regions = new Map<Element, Region>()
    for (const element of elements) {
      const style = snapshot.get(element)!
      const parent = (element.parentElement && regions.get(element.parentElement)) || paper
      const region = { ...parent }
      if (!parent.keep) {
        const plan = planBackground(style, parent, base)
        if (plan.color) set(element, 'background-color', plan.color)
        if (plan.keep) region.keep = true
        else {
          if (plan.image) set(element, 'background-image', plan.image)
          region.before = plan.before
          region.after = plan.after
          region.stops = plan.stops
        }
      }
      regions.set(element, region)
    }
    // Text, borders and images, only where the background underneath changed.
    for (const element of elements) {
      const style = snapshot.get(element)!
      const region = regions.get(element)!
      if (region.keep || same(region.before, region.after)) {
        // A highlight, a brand button or an already dark email keeps its own text colour rather
        // than inheriting the converted one from around it.
        set(element, 'color', style.color)
        continue
      }
      // Against every stop of a converted gradient, otherwise against the one background.
      const backgrounds = region.stops ?? [[region.before, region.after]]
      const color = readColor(style.color)
      if (color)
        set(
          element,
          'color',
          css(darkForegroundOver(over(color, region.before), backgrounds, 'text')),
        )
      for (const border of style.borders) {
        const borderColor = readColor(border.color)
        if (border.width > 0 && !['none', 'hidden'].includes(border.style) && borderColor?.a)
          set(
            element,
            `border-${border.side}-color`,
            css(darkForegroundOver(over(borderColor, region.before), backgrounds, 'border')),
          )
      }
      if (element.tagName === 'IMG') {
        const image = element as HTMLImageElement
        const src = image.getAttribute('src')
        if (canRecolor(src) && !darkImages.has(imageKey(src, base))) later.push([image, src])
        else swap(image, src)
      }
    }
  } catch (error) {
    restore()
    throw error
  }
  // Images not prepared ahead (the email was switched after it opened) follow shortly after,
  // unless the email is back in its own colours or replaced by then.
  if (later.length)
    void prepareDarkImages(
      later.map(([, src]) => src),
      base,
      () => active,
    ).then(() => {
      for (const [image, src] of later)
        if (active && image.getAttribute('src') === src) swap(image, src)
    })
  return restore
}
