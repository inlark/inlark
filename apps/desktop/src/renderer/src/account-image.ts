/** Twice the largest avatar, so pictures stay sharp on high-density screens. */
const SIZE = 128
const MAX_BYTES = 25 * 1024 * 1024
export const accountImageTypes = 'image/png,image/jpeg,image/webp,image/gif,image/avif'

/** Crops a chosen picture to its centre square and shrinks it, so it can be kept with the account. */
export async function accountImage(file: Blob): Promise<string> {
  if (!accountImageTypes.split(',').includes(file.type))
    throw new Error('Choose a PNG, JPEG, WebP, GIF or AVIF picture.')
  if (file.size > MAX_BYTES) throw new Error('This picture is too large. Choose one under 25 MB.')
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new Error('This picture could not be read. Try a different file.')
  }
  const side = Math.min(bitmap.width, bitmap.height)
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = Math.min(SIZE, side)
  const context = canvas.getContext('2d')!
  context.imageSmoothingQuality = 'high'
  context.drawImage(
    bitmap,
    (bitmap.width - side) / 2,
    (bitmap.height - side) / 2,
    side,
    side,
    0,
    0,
    canvas.width,
    canvas.height,
  )
  bitmap.close()
  return canvas.toDataURL('image/webp', 0.92)
}
