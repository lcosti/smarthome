/**
 * Shrink a camera photo to something worth sending over supermarket signal.
 *
 * A phone camera produces 3-12 MB; the text on a recipe page survives 1500px on
 * the long edge at JPEG q0.8 — a couple of hundred kilobytes. createImageBitmap
 * honours EXIF orientation in every browser this household uses, so a portrait
 * photo arrives the right way up without any rotation maths here.
 */

const LONG_EDGE = 1500
const QUALITY = 0.8

export interface CompressedPhoto {
  data: string
  media_type: 'image/jpeg'
}

export async function compressToJpeg(
  file: File,
  longEdge = LONG_EDGE,
  quality = QUALITY
): Promise<CompressedPhoto> {
  const bitmap = await createImageBitmap(file)
  try {
    const scale = Math.min(1, longEdge / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Could not get a canvas context')
    context.drawImage(bitmap, 0, 0, width, height)

    const blob = await new Promise<Blob | null>(resolve =>
      canvas.toBlob(resolve, 'image/jpeg', quality)
    )
    if (!blob) throw new Error('Could not encode the photo')

    return { data: await toBase64(blob), media_type: 'image/jpeg' }
  } finally {
    bitmap.close()
  }
}

/** Base64 without the data-URI prefix, which is what the Edge Function expects. */
function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error)
    reader.onload = () => {
      const url = reader.result as string
      resolve(url.slice(url.indexOf(',') + 1))
    }
    reader.readAsDataURL(blob)
  })
}
