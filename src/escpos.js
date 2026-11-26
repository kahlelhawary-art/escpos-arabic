// ESC/POS command bytes. Only widely supported commands (Epson-compatible):
// raster bit image (GS v 0), native QR (GS ( k, model 2), barcodes (GS k), feed, cut, drawer.

const ESC = 0x1b
const GS = 0x1d

export const INIT = [ESC, 0x40]
export const align = (a) => [ESC, 0x61, a === 'center' ? 1 : a === 'right' ? 2 : 0]
export const feedLines = (n) => [ESC, 0x64, clamp(n, 0, 255)]
export const cut = (partial = true) => [GS, 0x56, partial ? 66 : 65, 0]
export const drawer = (pin = 0) => [ESC, 0x70, pin ? 1 : 0, 25, 250]

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, Math.round(n)))
}

/**
 * Raster image in bands (some printers have small buffers).
 * @param {Uint8Array} packed rows packed 8 dots per byte
 * @param {number} bytesPerRow
 * @param {number} rows
 * @param {number} band rows per GS v 0 command
 */
export function raster(packed, bytesPerRow, rows, band = 128) {
  const bands = Math.ceil(rows / band)
  const out = new Uint8Array(bands * 8 + bytesPerRow * rows)
  let o = 0
  for (let y = 0; y < rows; y += band) {
    const h = Math.min(band, rows - y)
    out.set([GS, 0x76, 0x30, 0, bytesPerRow & 0xff, bytesPerRow >> 8, h & 0xff, h >> 8], o)
    o += 8
    out.set(packed.subarray(y * bytesPerRow, (y + h) * bytesPerRow), o)
    o += h * bytesPerRow
  }
  return out
}

const ECC = { L: 48, M: 49, Q: 50, H: 51 }

/** Native QR code: model 2, module size 1–16, error correction L/M/Q/H. */
export function qr(data, { size = 6, ecc = 'M' } = {}) {
  const bytes = [...new TextEncoder().encode(String(data))]
  if (bytes.length > 7089) throw new RangeError('escpos-arabic: QR data is too long')
  const store = bytes.length + 3
  return [
    GS, 0x28, 0x6b, 4, 0, 0x31, 0x41, 0x32, 0, // model 2
    GS, 0x28, 0x6b, 3, 0, 0x31, 0x43, clamp(size, 1, 16), // module size
    GS, 0x28, 0x6b, 3, 0, 0x31, 0x45, ECC[ecc] ?? ECC.M, // error correction
    GS, 0x28, 0x6b, store & 0xff, store >> 8, 0x31, 0x50, 0x30, ...bytes, // store
    GS, 0x28, 0x6b, 3, 0, 0x31, 0x51, 0x30, // print
  ]
}

const BARCODES = {
  UPCA: { m: 65, test: /^\d{11,12}$/ },
  EAN13: { m: 67, test: /^\d{12,13}$/ },
  EAN8: { m: 68, test: /^\d{7,8}$/ },
  CODE39: { m: 69, test: /^[0-9A-Z \-.$/+%]+$/ },
  CODE128: { m: 73, test: /^[\x20-\x7e]+$/ },
}

/** Native barcode with optional human-readable text below. */
export function barcode(data, { type = 'CODE128', height = 80, width = 2, text = true } = {}) {
  const spec = BARCODES[type]
  if (!spec) throw new RangeError(`escpos-arabic: unsupported barcode type ${type}`)
  data = String(data)
  if (!spec.test.test(data)) throw new RangeError(`escpos-arabic: "${data}" is not valid ${type} data`)
  let body = [...new TextEncoder().encode(data)]
  if (type === 'CODE128') body = [0x7b, 0x42, ...body] // {B: code set B
  return [
    GS, 0x68, clamp(height, 1, 255),
    GS, 0x77, clamp(width, 2, 6),
    GS, 0x48, text ? 2 : 0,
    GS, 0x6b, spec.m, body.length, ...body,
  ]
}
