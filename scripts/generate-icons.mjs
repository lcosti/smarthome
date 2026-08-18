// Generates the icon set from public/logo.png: the mark on a light rounded
// square. Run with `node scripts/generate-icons.mjs` from the repo root after
// changing the artwork or the colours below.
// The art is committed once and every icon is derived from it, so the whole set
// stays reproducible from one place — including favicon.ico, which browsers
// cache hard and which used to be a hand-made binary with no generator.

import { deflateSync, inflateSync } from 'node:zlib'
import { readFileSync, writeFileSync } from 'node:fs'
import { Buffer } from 'node:buffer'

const SOURCE = 'public/logo.png'
const PLATE = [229, 238, 255] // #e5eeff, the mark's own highlight

// ---------------------------------------------------------------- decoding --

function paeth(a, b, c) {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) return a
  return pb <= pc ? b : c
}

/**
 * Decodes 8-bit truecolour-with-alpha, non-interlaced PNG only — which is what
 * the artwork is. Anything else throws rather than decoding wrongly.
 */
function decodePng(buffer) {
  let offset = 8
  let header = null
  const idat = []

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    const data = buffer.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') header = data
    if (type === 'IDAT') idat.push(data)
    offset += 12 + length
  }

  if (!header) throw new Error(`${SOURCE}: no IHDR chunk`)
  const width = header.readUInt32BE(0)
  const height = header.readUInt32BE(4)
  const [depth, colourType, , , interlace] = header.subarray(8, 13)
  if (depth !== 8 || colourType !== 6 || interlace !== 0) {
    throw new Error(`${SOURCE}: expected 8-bit RGBA non-interlaced, got depth ${depth} colour type ${colourType} interlace ${interlace}`)
  }

  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * 4
  const pixels = Buffer.alloc(height * stride)

  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    for (let x = 0; x < stride; x++) {
      const left = x >= 4 ? pixels[y * stride + x - 4] : 0
      const up = y > 0 ? pixels[(y - 1) * stride + x] : 0
      const upLeft = y > 0 && x >= 4 ? pixels[(y - 1) * stride + x - 4] : 0
      let value = line[x]
      if (filter === 1) value += left
      else if (filter === 2) value += up
      else if (filter === 3) value += (left + up) >> 1
      else if (filter === 4) value += paeth(left, up, upLeft)
      else if (filter !== 0) throw new Error(`${SOURCE}: unknown filter ${filter} on row ${y}`)
      pixels[y * stride + x] = value & 0xff
    }
  }

  return { width, height, pixels }
}

/** Trims the fully transparent border so the mark is centred on its ink. */
function cropToInk({ width, height, pixels }) {
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (pixels[(y * width + x) * 4 + 3] === 0) continue
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  if (maxX < 0) throw new Error(`${SOURCE}: no opaque pixels`)

  const cropped = { width: maxX - minX + 1, height: maxY - minY + 1 }
  cropped.pixels = Buffer.alloc(cropped.width * cropped.height * 4)
  for (let y = 0; y < cropped.height; y++) {
    pixels.copy(
      cropped.pixels,
      y * cropped.width * 4,
      ((y + minY) * width + minX) * 4,
      ((y + minY) * width + minX + cropped.width) * 4
    )
  }
  return cropped
}

// -------------------------------------------------------------- resampling --

/** Nearest neighbour at a whole-number factor — pixel art survives this exactly. */
function magnify(art, factor) {
  const width = art.width * factor
  const height = art.height * factor
  const pixels = Buffer.alloc(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const from = (Math.floor(y / factor) * art.width + Math.floor(x / factor)) * 4
      art.pixels.copy(pixels, (y * width + x) * 4, from, from + 4)
    }
  }
  return { width, height, pixels }
}

/**
 * Area average, for the favicon only: the art is wider than a 16 or 32 pixel
 * canvas, so there is no whole-number factor to be had. The result is a soft
 * silhouette rather than crisp pixels, which is the ceiling for a mark this
 * detailed at tab size.
 */
function shrink(art, width, height) {
  const pixels = Buffer.alloc(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const x0 = (x * art.width) / width
      const x1 = ((x + 1) * art.width) / width
      const y0 = (y * art.height) / height
      const y1 = ((y + 1) * art.height) / height
      const totals = [0, 0, 0, 0]
      let weightTotal = 0

      for (let sy = Math.floor(y0); sy < Math.ceil(y1); sy++) {
        const coverY = Math.min(y1, sy + 1) - Math.max(y0, sy)
        for (let sx = Math.floor(x0); sx < Math.ceil(x1); sx++) {
          const weight = coverY * (Math.min(x1, sx + 1) - Math.max(x0, sx))
          const from = (sy * art.width + sx) * 4
          const alpha = art.pixels[from + 3] / 255
          // Premultiply, or transparent pixels drag their colour into the average.
          for (let c = 0; c < 3; c++) totals[c] += art.pixels[from + c] * alpha * weight
          totals[3] += art.pixels[from + 3] * weight
          weightTotal += weight
        }
      }

      const offset = (y * width + x) * 4
      const alpha = totals[3] / weightTotal
      for (let c = 0; c < 3; c++) {
        pixels[offset + c] = alpha === 0 ? 0 : Math.round((totals[c] / weightTotal) * (255 / alpha))
      }
      pixels[offset + 3] = Math.round(alpha)
    }
  }
  return { width, height, pixels }
}

// --------------------------------------------------------------- rendering --

function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

/** Signed-distance coverage of a rounded rectangle, 1 inside and 0 outside. */
function roundedRectCoverage(x, y, size, radius, aa) {
  const half = size / 2
  const qx = Math.abs(x - half) - (half - radius)
  const qy = Math.abs(y - half) - (half - radius)
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - radius
  return 1 - smoothstep(-aa, aa, outside)
}

function renderIcon(art, size, { corner, fraction, opaque }) {
  const factor = Math.floor((size * fraction) / art.width)
  const mark = factor >= 1
    ? magnify(art, factor)
    : shrink(art, Math.max(1, Math.round(size * fraction)), Math.max(1, Math.round(((size * fraction) / art.width) * art.height)))

  const left = Math.round((size - mark.width) / 2)
  const top = Math.round((size - mark.height) / 2)
  const pixels = Buffer.alloc(size * size * 4)
  const aa = size / 220
  const radius = corner * size

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const plate = opaque ? 1 : roundedRectCoverage(x + 0.5, y + 0.5, size, radius, aa)

      let ink = 0
      const colour = [0, 0, 0]
      const mx = x - left
      const my = y - top
      if (mx >= 0 && my >= 0 && mx < mark.width && my < mark.height) {
        const from = (my * mark.width + mx) * 4
        ink = mark.pixels[from + 3] / 255
        for (let c = 0; c < 3; c++) colour[c] = mark.pixels[from + c]
      }

      const offset = (y * size + x) * 4
      for (let c = 0; c < 3; c++) {
        pixels[offset + c] = Math.round(PLATE[c] * (1 - ink) + colour[c] * ink)
      }
      pixels[offset + 3] = Math.round(plate * 255)
    }
  }

  return pixels
}

// ---------------------------------------------------------------- encoding --

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(buffer) {
  let c = 0xffffffff
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

function encodePng(size, pixels) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8 // bit depth
  header[9] = 6 // truecolour with alpha
  header[10] = 0
  header[11] = 0
  header[12] = 0

  // Each scanline is prefixed with its filter type; 0 means "no filtering".
  const stride = size * 4
  const raw = Buffer.alloc(size * (stride + 1))
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

/**
 * An ICO is a directory of images; the payloads may be PNG, which every browser
 * this app will meet understands, so the PNG encoder above does the real work.
 */
function encodeIco(images) {
  const directory = Buffer.alloc(6 + images.length * 16)
  directory.writeUInt16LE(0, 0) // reserved
  directory.writeUInt16LE(1, 2) // type: icon
  directory.writeUInt16LE(images.length, 4)

  let offset = directory.length
  images.forEach(({ size, png }, index) => {
    const entry = 6 + index * 16
    directory[entry] = size >= 256 ? 0 : size // 0 means 256
    directory[entry + 1] = size >= 256 ? 0 : size
    directory[entry + 2] = 0 // palette colours
    directory[entry + 3] = 0 // reserved
    directory.writeUInt16LE(1, entry + 4) // colour planes
    directory.writeUInt16LE(32, entry + 6) // bits per pixel
    directory.writeUInt32LE(png.length, entry + 8)
    directory.writeUInt32LE(offset, entry + 12)
    offset += png.length
  })

  return Buffer.concat([directory, ...images.map(image => image.png)])
}

// ------------------------------------------------------------------- write --

const art = cropToInk(decodePng(readFileSync(SOURCE)))
console.log(`read ${SOURCE}, mark is ${art.width}x${art.height}`)

const targets = [
  { file: 'public/pwa-192x192.png', size: 192, corner: 0.22, fraction: 0.62, opaque: false },
  { file: 'public/pwa-512x512.png', size: 512, corner: 0.22, fraction: 0.62, opaque: false },
  // Maskable icons are cropped to a circle by the launcher, so bleed the
  // plate to the edges and keep the mark inside the safe zone.
  { file: 'public/pwa-maskable-512x512.png', size: 512, corner: 0, fraction: 0.55, opaque: true },
  // iOS ignores the manifest and masks this itself; it must not be transparent.
  { file: 'public/apple-touch-icon.png', size: 180, corner: 0, fraction: 0.6, opaque: true }
]

for (const { file, size, ...options } of targets) {
  writeFileSync(file, encodePng(size, renderIcon(art, size, options)))
  console.log(`wrote ${file} (${size}x${size})`)
}

// The tab icon is smaller than the artwork, so it takes the shrink path.
const FAVICON_SIZES = [16, 32, 48]
const favicon = FAVICON_SIZES.map(size => ({
  size,
  png: encodePng(size, renderIcon(art, size, { corner: 0, fraction: 0.86, opaque: true }))
}))
writeFileSync('public/favicon.ico', encodeIco(favicon))
console.log(`wrote public/favicon.ico (${FAVICON_SIZES.join(', ')})`)
