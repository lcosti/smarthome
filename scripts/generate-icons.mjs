// Generates the PWA icon set from scratch: a tick on a dark rounded square.
// Run with `node scripts/generate-icons.mjs` after changing the colours below.
// Kept as code rather than binary artwork so the icons stay reproducible.

import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'
import { Buffer } from 'node:buffer'

const BACKGROUND = [15, 23, 42] // #0f172a
const FOREGROUND = [255, 255, 255]

/** Distance from a point to a line segment, used to stroke the tick. */
function distanceToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax
  const dy = by - ay
  const lengthSquared = dx * dx + dy * dy
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

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

function renderIcon(size, { corner, glyphScale, opaque }) {
  const pixels = Buffer.alloc(size * size * 4)
  const aa = size / 220
  const radius = corner * size
  const centre = size / 2
  const scale = size * glyphScale

  // A tick, as three points in glyph space (-0.5..0.5 of the glyph box, y up).
  // The middle point is the low vertex; the third is the high tail.
  const tick = [
    [-0.36, 0.02],
    [-0.12, -0.24],
    [0.36, 0.28]
  ].map(([gx, gy]) => [centre + gx * scale, centre - gy * scale])
  const stroke = size * glyphScale * 0.14

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x + 0.5
      const py = y + 0.5

      const plate = opaque ? 1 : roundedRectCoverage(px, py, size, radius, aa)

      const distance = Math.min(
        distanceToSegment(px, py, tick[0][0], tick[0][1], tick[1][0], tick[1][1]),
        distanceToSegment(px, py, tick[1][0], tick[1][1], tick[2][0], tick[2][1])
      )
      const ink = 1 - smoothstep(stroke - aa, stroke + aa, distance)

      const offset = (y * size + x) * 4
      for (let channel = 0; channel < 3; channel++) {
        pixels[offset + channel] = Math.round(BACKGROUND[channel] * (1 - ink) + FOREGROUND[channel] * ink)
      }
      pixels[offset + 3] = Math.round(plate * 255)
    }
  }

  return pixels
}

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

const targets = [
  { file: 'public/pwa-192x192.png', size: 192, corner: 0.22, glyphScale: 0.62, opaque: false },
  { file: 'public/pwa-512x512.png', size: 512, corner: 0.22, glyphScale: 0.62, opaque: false },
  // Maskable icons are cropped to a circle by the launcher, so bleed the
  // background to the edges and keep the glyph inside the safe zone.
  { file: 'public/pwa-maskable-512x512.png', size: 512, corner: 0, glyphScale: 0.44, opaque: true },
  // iOS ignores the manifest and masks this itself; it must not be transparent.
  { file: 'public/apple-touch-icon.png', size: 180, corner: 0, glyphScale: 0.6, opaque: true }
]

for (const { file, size, ...options } of targets) {
  writeFileSync(file, encodePng(size, renderIcon(size, options)))
  console.log(`wrote ${file} (${size}x${size})`)
}
