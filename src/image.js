// Images for the receipt: decode a PNG (or take RGBA pixels), scale it to the print
// head, and turn grey into black and white dots — thermal heads print no grey.
import { unzlibSync } from 'fflate'

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }
const DEPTHS = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] }
const MAX_PIXELS = 40e6
// Adam7 interlace passes: first column, first row, column step, row step.
const ADAM7 = [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]]

/**
 * Decode a PNG into 8-bit RGBA pixels. Every PNG colour type, bit depth,
 * transparency (tRNS) and interlacing is supported.
 * @param {Uint8Array|ArrayBuffer} bytes
 * @returns {{ width: number, height: number, data: Uint8Array }}
 */
export function decodePNG(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  if (!SIGNATURE.every((v, i) => b[i] === v)) {
    const jpeg = b[0] === 0xff && b[1] === 0xd8
    throw new TypeError(`escpos-arabic: ${jpeg ? 'JPEG is not supported; convert the image to PNG, or pass decoded RGBA pixels' : 'not a PNG file'}`)
  }
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
  let header = null, palette = null, trns = null
  const idat = []
  for (let p = 8; p + 8 <= b.length;) {
    const len = dv.getUint32(p)
    const type = String.fromCharCode(b[p + 4], b[p + 5], b[p + 6], b[p + 7])
    const body = b.subarray(p + 8, p + 8 + len)
    if (body.length < len) throw new RangeError('escpos-arabic: the PNG file is truncated')
    if (type === 'IHDR') {
      header = { width: dv.getUint32(p + 8), height: dv.getUint32(p + 12), depth: b[p + 16], color: b[p + 17], interlace: b[p + 20] }
    } else if (type === 'PLTE') palette = body
    else if (type === 'tRNS') trns = body
    else if (type === 'IDAT') idat.push(body)
    else if (type === 'IEND') break
    p += 12 + len
  }
  if (!header || !idat.length) throw new TypeError('escpos-arabic: the PNG has no image data')
  const { width, height, depth, color, interlace } = header
  if (!DEPTHS[color]?.includes(depth)) throw new TypeError(`escpos-arabic: unsupported PNG (colour type ${color}, ${depth}-bit)`)
  if (!width || !height || width * height > MAX_PIXELS) throw new RangeError(`escpos-arabic: PNG size ${width}×${height} is out of range`)
  if (color === 3 && !palette) throw new TypeError('escpos-arabic: the PNG has no palette')

  const raw = unzlibSync(concat(idat))
  const out = new Uint8Array(width * height * 4)
  const read = sampler({ depth, color, palette, trns })
  const channels = CHANNELS[color]
  const bpp = Math.max(1, (channels * depth) >> 3) // bytes per pixel, for the filters
  let at = 0
  const passes = interlace ? ADAM7 : [[0, 0, 1, 1]]
  for (const [x0, y0, dx, dy] of passes) {
    const w = Math.ceil((width - x0) / dx)
    const h = Math.ceil((height - y0) / dy)
    if (w <= 0 || h <= 0) continue
    const stride = Math.ceil((w * channels * depth) / 8)
    let prev = new Uint8Array(stride)
    for (let y = 0; y < h; y++) {
      if (at + 1 + stride > raw.length) throw new RangeError('escpos-arabic: the PNG image data is truncated')
      const row = unfilter(raw[at], raw.subarray(at + 1, at + 1 + stride), prev, bpp)
      at += 1 + stride
      for (let x = 0; x < w; x++) read(row, x, out, ((y0 + y * dy) * width + x0 + x * dx) * 4)
      prev = row
    }
  }
  return { width, height, data: out }
}

function concat(parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) { out.set(p, o); o += p.length }
  return out
}

function unfilter(type, src, prev, bpp) {
  const row = new Uint8Array(src.length)
  for (let i = 0; i < src.length; i++) {
    const a = i >= bpp ? row[i - bpp] : 0
    const up = prev[i]
    const c = i >= bpp ? prev[i - bpp] : 0
    let v = src[i]
    if (type === 1) v += a
    else if (type === 2) v += up
    else if (type === 3) v += (a + up) >> 1
    else if (type === 4) {
      const p = a + up - c
      const pa = Math.abs(p - a), pb = Math.abs(p - up), pc = Math.abs(p - c)
      v += pa <= pb && pa <= pc ? a : pb <= pc ? up : c
    } else if (type !== 0) throw new TypeError(`escpos-arabic: bad PNG filter type ${type}`)
    row[i] = v
  }
  return row
}

/** A function that writes pixel `x` of an unfiltered row as RGBA into `out` at `o`. */
function sampler({ depth, color, palette, trns }) {
  const channels = CHANNELS[color]
  const max = (1 << depth) - 1
  // One sample at its own bit depth.
  const sample = depth === 8 ? (row, k) => row[k]
    : depth === 16 ? (row, k) => (row[2 * k] << 8) | row[2 * k + 1]
      : (row, k) => (row[(k * depth) >> 3] >> (8 - depth - ((k * depth) & 7))) & max
  const to8 = depth === 16 ? (v) => v >> 8 : depth === 8 ? (v) => v : (v) => Math.round((v * 255) / max)
  const key = (i) => (trns[2 * i] << 8) | trns[2 * i + 1] // tRNS colour key, at the image's bit depth

  if (color === 3) {
    return (row, x, out, o) => {
      const i = sample(row, x)
      out[o] = palette[3 * i] ?? 0
      out[o + 1] = palette[3 * i + 1] ?? 0
      out[o + 2] = palette[3 * i + 2] ?? 0
      out[o + 3] = trns && i < trns.length ? trns[i] : 255
    }
  }
  if (color === 0) {
    const k = trns ? key(0) : -1
    return (row, x, out, o) => {
      const v = sample(row, x)
      out[o] = out[o + 1] = out[o + 2] = to8(v)
      out[o + 3] = v === k ? 0 : 255
    }
  }
  if (color === 2) {
    const k = trns ? [key(0), key(1), key(2)] : null
    return (row, x, out, o) => {
      const r = sample(row, 3 * x), g = sample(row, 3 * x + 1), bl = sample(row, 3 * x + 2)
      out[o] = to8(r); out[o + 1] = to8(g); out[o + 2] = to8(bl)
      out[o + 3] = k && r === k[0] && g === k[1] && bl === k[2] ? 0 : 255
    }
  }
  // 4: grey + alpha, 6: RGBA
  return (row, x, out, o) => {
    const s = channels * x
    if (color === 4) {
      out[o] = out[o + 1] = out[o + 2] = to8(sample(row, s))
      out[o + 3] = to8(sample(row, s + 1))
    } else {
      for (let c = 0; c < 4; c++) out[o + c] = to8(sample(row, s + c))
    }
  }
}

/**
 * How dark each pixel is, 0 (paper) to 1 (black). Transparent pixels count as paper.
 * @param {{ width: number, height: number, data: Uint8Array|Uint8ClampedArray }} img RGBA
 */
export function darkness({ width, height, data }) {
  const out = new Float32Array(width * height)
  for (let i = 0, o = 0; i < out.length; i++, o += 4) {
    const lum = (0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2]) / 255
    out[i] = (1 - lum) * (data[o + 3] / 255)
  }
  return out
}

/** Area-average resampling of a one-channel image to `W`×`H`. */
export function resize(src, w, h, W, H) {
  if (w === W && h === H) return src
  return axis(axis(src, w, h, W, true), W, h, H, false)
}

// Resample along one axis: each output cell averages the input cells it covers, by area.
function axis(src, w, h, n, horizontal) {
  const len = horizontal ? w : h
  const out = new Float32Array(horizontal ? n * h : w * n)
  const step = len / n
  for (let i = 0; i < n; i++) {
    const a = i * step, z = a + step
    for (let j = Math.floor(a); j < Math.min(len, Math.ceil(z)); j++) {
      const wgt = (Math.min(z, j + 1) - Math.max(a, j)) / step
      if (wgt <= 0) continue
      if (horizontal) for (let y = 0; y < h; y++) out[y * n + i] += src[y * w + j] * wgt
      else for (let x = 0; x < w; x++) out[i * w + x] += src[j * w + x] * wgt
    }
  }
  return out
}

/**
 * Black-and-white dots from darkness values (1 = print a dot).
 * @param {Float32Array} dark 0–1 per pixel
 * @param {'atkinson'|'floyd-steinberg'|'none'} mode error diffusion, or a plain threshold
 * @param {{ threshold?: number, tones?: [number, number] }} [o]
 *   threshold: darkness at which a dot is printed, for mode 'none'.
 *   tones: for dithering, darkness at or below the first value prints as paper and at or
 *   above the second as solid black, so dark brand colours print solid, not speckled.
 */
export function dither(dark, w, h, mode = 'atkinson', { threshold = 0.5, tones = [0.1, 0.65] } = {}) {
  const out = new Uint8Array(w * h)
  if (mode === 'none') {
    for (let i = 0; i < dark.length; i++) out[i] = dark[i] >= threshold ? 1 : 0
    return out
  }
  const [lo, hi] = tones
  if (!(lo >= 0 && hi <= 1 && lo < hi)) throw new RangeError('escpos-arabic: tones must be [light, dark] with 0 ≤ light < dark ≤ 1')
  const v = Float32Array.from(dark, (d) => Math.min(1, Math.max(0, (d - lo) / (hi - lo))))
  const add = (x, y, e) => { if (x >= 0 && x < w && y < h) v[y * w + x] += e }
  for (let y = 0; y < h; y++) {
    // Floyd–Steinberg runs in alternating directions, which avoids diagonal "worms".
    const back = mode === 'floyd-steinberg' && y % 2 === 1
    for (let k = 0; k < w; k++) {
      const x = back ? w - 1 - k : k
      const i = y * w + x
      const dot = v[i] >= 0.5 ? 1 : 0
      out[i] = dot
      const err = v[i] - dot
      if (mode === 'floyd-steinberg') {
        const s = back ? -1 : 1
        add(x + s, y, (err * 7) / 16)
        add(x - s, y + 1, (err * 3) / 16)
        add(x, y + 1, (err * 5) / 16)
        add(x + s, y + 1, err / 16)
      } else if (mode === 'atkinson') {
        const e = err / 8 // passes on 6/8 of the error, which keeps flat areas clean
        add(x + 1, y, e); add(x + 2, y, e)
        add(x - 1, y + 1, e); add(x, y + 1, e); add(x + 1, y + 1, e)
        add(x, y + 2, e)
      } else throw new RangeError(`escpos-arabic: unknown dither mode "${mode}"`)
    }
  }
  return out
}

/** Normalise what `.image()` accepts — PNG bytes or decoded RGBA pixels — to RGBA. */
export function toRGBA(source) {
  if (source instanceof Uint8Array || source instanceof ArrayBuffer) return decodePNG(source)
  const { width, height, data } = source ?? {}
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || !data || data.length !== width * height * 4) {
    throw new TypeError('escpos-arabic: pass PNG bytes, or { width, height, data } with 4 bytes (RGBA) per pixel')
  }
  return { width, height, data }
}
