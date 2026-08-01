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

/**
 * The largest centred square inside a rectangle.
 *
 * Centred rather than top-anchored even though these are usually faces: a photo
 * taken to be somebody's avatar has them in the middle of it, and the top of a
 * landscape holiday photo is sky. Pure, so the arithmetic is tested without a
 * canvas.
 */
export function squareCrop(width: number, height: number) {
  const side = Math.min(width, height)
  return {
    side,
    x: Math.round((width - side) / 2),
    y: Math.round((height - side) / 2)
  }
}

const AVATAR_EDGE = 192
const AVATAR_QUALITY = 0.82

/**
 * A camera photo as an avatar: centre-cropped square, small enough to live in a
 * database row.
 *
 * A full data URL rather than bare base64 — unlike {@link compressToJpeg}, whose
 * caller is an Edge Function that wants the payload on its own, this goes
 * straight into an `<img src>`. 192px covers the largest place an avatar is
 * drawn (the board's hero, at 56 CSS pixels) on a 2x screen, and lands around
 * 8 KB.
 */
export async function cropToAvatar(
  file: File,
  edge = AVATAR_EDGE,
  quality = AVATAR_QUALITY
): Promise<string> {
  const bitmap = await createImageBitmap(file)
  try {
    const { side, x, y } = squareCrop(bitmap.width, bitmap.height)

    const canvas = document.createElement('canvas')
    canvas.width = edge
    canvas.height = edge
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Could not get a canvas context')
    context.drawImage(bitmap, x, y, side, side, 0, 0, edge, edge)

    return canvas.toDataURL('image/jpeg', quality)
  } finally {
    bitmap.close()
  }
}

/**
 * The picture to draw for a recipe, from the two places one can come from.
 *
 * A photograph taken in this kitchen beats the address the source site
 * published: it is of the plate that actually came out, it cannot 404, and it is
 * there in airplane mode. Removing it falls back to the site's picture rather
 * than to a blank page, which is why both columns exist. Every surface that
 * draws a recipe goes through this, so there is one answer to "which picture".
 */
export function pictureOf(
  recipe: { photo?: string | null, image_url?: string | null } | null | undefined
): string | null {
  return recipe?.photo ?? recipe?.image_url ?? null
}

const RECIPE_EDGE = 800
const RECIPE_QUALITY = 0.8

/**
 * A camera photo as a recipe's own picture: whole frame, small enough to live in
 * a database row.
 *
 * The third encoder here, and it is a third because the three callers want
 * genuinely different things. {@link compressToJpeg} hands bare base64 to an
 * Edge Function and can afford 1500px because the payload is thrown away after
 * the model has read it. {@link cropToAvatar} crops to a square because an
 * avatar is a face in a circle. This one keeps the frame it was given — a plate
 * of food is not a face, the page hero is 16:9 and the library thumbnail is a
 * square, and no single crop serves both, so `object-cover` does it per surface
 * from the full picture.
 *
 * A full data URL, like the avatar and unlike the import: this goes straight
 * into an `<img src>` and into the row itself. 800px is the widest it is ever
 * drawn — the aspect-video hero at the tablet's `max-w-3xl` — and lands near
 * 100 KB, well under the 512 KB the column's check constraint allows.
 */
export async function photoForRecipe(
  file: File,
  longEdge = RECIPE_EDGE,
  quality = RECIPE_QUALITY
): Promise<string> {
  const bitmap = await createImageBitmap(file)
  try {
    const scale = Math.min(1, longEdge / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Could not get a canvas context')
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)

    return canvas.toDataURL('image/jpeg', quality)
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
