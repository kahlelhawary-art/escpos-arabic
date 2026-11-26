// escpos-arabic — Arabic receipts that print correctly on ESC/POS thermal printers.
// Text is shaped (joined letters, ligatures, marks), put in bidi order, and rasterised
// at the printer's resolution; QR codes, barcodes, feed and cut use native commands.
import { TypeFace, FontStack, shapeLine, wrapText, toArabicDigits } from './shaper.js'
import { Bitmap, drawGlyphs } from './raster.js'
import * as cmd from './escpos.js'
import { encodePNG } from './png.js'

export { TypeFace, FontStack, toArabicDigits, Bitmap }

/** Print-head widths in dots (203 dpi). */
export const PAPER = Object.freeze({ '58mm': 384, '80mm': 576 })

// QR byte-mode capacity at error correction M, versions 1–15 (for the preview size only).
const QR_CAP_M = [14, 26, 42, 62, 84, 106, 122, 152, 180, 213, 251, 287, 331, 362, 412]

export class Receipt {
  /**
   * @param {object} options
   * @param {Uint8Array|ArrayBuffer|TypeFace} options.font regular font (TTF/OTF bytes)
   * @param {Uint8Array|ArrayBuffer|TypeFace} [options.boldFont] bold font; without it bold text is thickened by one dot
   * @param {Array<Uint8Array|ArrayBuffer|TypeFace>} [options.fallbackFonts] fonts for characters the main font lacks (e.g. a Latin font)
   * @param {Array<Uint8Array|ArrayBuffer|TypeFace>} [options.boldFallbackFonts] bold versions of the fallbacks
   * @param {number|'58mm'|'80mm'} [options.width=576] print-head width in dots
   * @param {'rtl'|'ltr'} [options.direction='rtl'] paragraph direction
   * @param {number} [options.size=24] default text size in dots
   * @param {number} [options.lineHeight=1.3] line height as a multiple of the size
   * @param {number} [options.padding=0] blank margin on both sides, in dots
   * @param {'latin'|'arabic'} [options.digits='latin'] print 0–9 as is, or as ٠–٩
   * @param {number} [options.threshold=0.45] coverage needed to print a dot (lower = heavier text)
   */
  constructor(options = {}) {
    const { font, boldFont, fallbackFonts = [], boldFallbackFonts, width = 576, direction = 'rtl', size = 24, lineHeight = 1.3, padding = 0, digits = 'latin', threshold = 0.45 } = options
    if (!font) throw new TypeError('escpos-arabic: pass the font bytes as { font }')
    this.width = typeof width === 'string' ? PAPER[width] : width
    if (!this.width) throw new RangeError(`escpos-arabic: unknown paper width "${width}"`)
    const load = (f) => (f instanceof TypeFace ? f : new TypeFace(f))
    const fallbacks = fallbackFonts.map(load)
    this.regular = new FontStack([load(font), ...fallbacks])
    this.bold = boldFont ? new FontStack([load(boldFont), ...(boldFallbackFonts ? boldFallbackFonts.map(load) : fallbacks)]) : null
    this.rtl = direction !== 'ltr'
    this.size = size
    this.lineHeight = lineHeight
    this.padding = padding
    this.digits = digits
    this.threshold = threshold
    this.blocks = []
    this.canvas = null
    this.y = 0
  }

  /* ───────── internals ───────── */

  _canvas() {
    if (!this.canvas) {
      this.canvas = new Bitmap(this.width)
      this.blocks.push({ kind: 'raster', bmp: this.canvas })
      this.y = 0
    }
    return this.canvas
  }

  _close() {
    if (this.canvas) this.canvas.ensure(this.y)
    this.canvas = null
  }

  _face(bold) {
    return bold && this.bold ? this.bold : this.regular
  }

  _prep(text) {
    text = String(text ?? '')
    return this.digits === 'arabic' ? toArabicDigits(text) : text
  }

  _metrics(face, size) {
    const scale = size / face.upem
    const asc = face.ascender * scale
    const desc = -face.descender * scale
    const lh = Math.max(size * this.lineHeight, (asc + desc) * 0.92)
    return { scale, asc, lh, lead: (lh - (asc + desc)) / 2 }
  }

  _rtl(direction) {
    return direction ? direction === 'rtl' : this.rtl
  }

  /** Physical side for a logical alignment. */
  _side(align, rtl) {
    if (align === 'center') return 'center'
    const start = align !== 'end'
    return start === rtl ? 'right' : 'left'
  }

  _drawLine(face, text, { x, w, side, size, bold, rtl }) {
    const m = this._metrics(face, size)
    const { glyphs, width } = shapeLine(face, text, rtl)
    const px = width * m.scale
    const left = side === 'center' ? x + (w - px) / 2 : side === 'right' ? x + w - px : x
    drawGlyphs(this._canvas(), face, glyphs, left, this.y + m.lead + m.asc, size, {
      threshold: this.threshold,
      embolden: bold && !this.bold,
    })
  }

  _native(bytes, align, preview) {
    this._close()
    this.blocks.push({ kind: 'native', bytes, side: this._side(align, this.rtl), preview })
    return this
  }

  /* ───────── content ───────── */

  /**
   * A paragraph, wrapped to the paper width.
   * @param {string} text
   * @param {{ size?: number, bold?: boolean, align?: 'start'|'center'|'end', direction?: 'rtl'|'ltr' }} [o]
   */
  text(text, o = {}) {
    const { size = this.size, bold = false, align = 'start' } = o
    const rtl = this._rtl(o.direction)
    const face = this._face(bold)
    const m = this._metrics(face, size)
    const w = this.width - 2 * this.padding
    const c = this._canvas()
    for (const line of wrapText(face, this._prep(text), w / m.scale, rtl)) {
      if (line) this._drawLine(face, line, { x: this.padding, w, side: this._side(align, rtl), size, bold, rtl })
      this.y += m.lh
      c.ensure(this.y)
    }
    return this
  }

  /**
   * A row of columns. The first column sits at the start side (the right, in Arabic).
   * Each cell wraps inside its column.
   * @param {Array<string|number>} cells
   * @param {{ widths?: number[], align?: Array<'start'|'center'|'end'>, size?: number, bold?: boolean, gap?: number, direction?: 'rtl'|'ltr' }} [o]
   */
  row(cells, o = {}) {
    const n = cells.length
    if (!n) return this
    const { widths = Array(n).fill(1), size = this.size, bold = false, gap = 16 } = o
    const rtl = this._rtl(o.direction)
    const align = o.align ?? cells.map((_, i) => (i === 0 ? 'start' : i === n - 1 ? 'end' : 'center'))
    const face = this._face(bold)
    const m = this._metrics(face, size)
    const total = widths.reduce((a, b) => a + b, 0)
    const inner = this.width - 2 * this.padding - gap * (n - 1)
    const colW = widths.map((w) => (inner * w) / total)
    // Column positions in reading order: from the right in rtl, from the left in ltr.
    const xs = []
    let acc = 0
    for (let i = 0; i < n; i++) {
      xs.push(rtl ? this.width - this.padding - acc - colW[i] : this.padding + acc)
      acc += colW[i] + gap
    }
    const lines = cells.map((cell, i) => wrapText(face, this._prep(cell), colW[i] / m.scale, rtl))
    const rows = Math.max(...lines.map((l) => l.length))
    const c = this._canvas()
    for (let r = 0; r < rows; r++) {
      for (let i = 0; i < n; i++) {
        const line = lines[i][r]
        if (line) this._drawLine(face, line, { x: xs[i], w: colW[i], side: this._side(align[i] ?? 'start', rtl), size, bold, rtl })
      }
      this.y += m.lh
      c.ensure(this.y)
    }
    return this
  }

  /**
   * A horizontal rule.
   * @param {{ style?: 'solid'|'dashed'|'dotted'|'double', weight?: number, space?: number }} [o]
   */
  rule(o = {}) {
    const { style = 'dashed', weight = 2, space = 10 } = o
    const c = this._canvas()
    const x0 = this.padding, x1 = this.width - this.padding
    this.y += space
    const line = (y) => {
      if (style === 'solid' || style === 'double') return c.fillRect(x0, y, x1 - x0, weight)
      const [on, off] = style === 'dotted' ? [weight, weight * 2] : [12, 8]
      for (let x = x0; x < x1; x += on + off) c.fillRect(x, y, Math.min(on, x1 - x), weight)
    }
    line(this.y)
    if (style === 'double') { this.y += weight + 3; line(this.y) }
    this.y += weight + space
    c.ensure(this.y)
    return this
  }

  /** Blank space, in dots. */
  space(dots = 12) {
    const c = this._canvas()
    this.y += dots
    c.ensure(this.y)
    return this
  }

  /**
   * A native QR code (printed by the printer itself, so it stays sharp).
   * @param {string} data
   * @param {{ size?: number, ecc?: 'L'|'M'|'Q'|'H', align?: 'start'|'center'|'end' }} [o]
   */
  qr(data, o = {}) {
    const { size = 6, ecc = 'M', align = 'center' } = o
    const len = new TextEncoder().encode(String(data)).length
    const v = QR_CAP_M.findIndex((cap) => cap >= len) + 1 || 16
    const dots = (17 + 4 * v) * size
    return this._native(cmd.qr(data, { size, ecc }), align, { kind: 'QR', w: dots, h: dots })
  }

  /**
   * A native barcode.
   * @param {string} data
   * @param {{ type?: 'CODE128'|'EAN13'|'EAN8'|'CODE39'|'UPCA', height?: number, width?: number, text?: boolean, align?: 'start'|'center'|'end' }} [o]
   */
  barcode(data, o = {}) {
    const { type = 'CODE128', height = 80, width = 2, text = true, align = 'center' } = o
    const bytes = cmd.barcode(data, { type, height, width, text })
    const modules = type === 'EAN13' || type === 'UPCA' ? 95 : type === 'EAN8' ? 67 : (String(data).length + 3) * 11 + 2
    return this._native(bytes, align, { kind: type, w: Math.min(this.width, modules * width), h: height + (text ? 26 : 0) })
  }

  /** Feed paper by whole lines. */
  feed(lines = 3) {
    return this._native(cmd.feedLines(lines), 'start', { kind: 'feed', h: lines * 30 })
  }

  /** Feed and cut. */
  cut({ feed = 4, partial = true } = {}) {
    this._native(cmd.feedLines(feed), 'start', { kind: 'feed', h: feed * 30 })
    return this._native(cmd.cut(partial), 'start', null)
  }

  /** Pulse the cash-drawer kick-out connector. */
  drawer(pin = 0) {
    return this._native(cmd.drawer(pin), 'start', null)
  }

  /* ───────── output ───────── */

  /**
   * ESC/POS bytes, ready for a USB, serial, Bluetooth or network (port 9100) printer.
   * @param {{ band?: number }} [o] rows per raster command (lower for printers with small buffers)
   * @returns {Uint8Array}
   */
  encode({ band = 128 } = {}) {
    this._close()
    const parts = [Uint8Array.from(cmd.INIT)]
    for (const b of this.blocks) {
      if (b.kind === 'raster') {
        if (!b.bmp.height) continue
        parts.push(Uint8Array.from(cmd.align('left')))
        parts.push(cmd.raster(b.bmp.packRows(), b.bmp.width / 8, b.bmp.height, band))
      } else {
        parts.push(Uint8Array.from([...cmd.align(b.side), ...b.bytes, ...cmd.align('left')]))
      }
    }
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
    let o = 0
    for (const p of parts) { out.set(p, o); o += p.length }
    return out
  }

  /**
   * The receipt as one bitmap, for previews and tests. QR codes and barcodes are
   * printed by the printer, so they appear here as labelled frames of about the right size.
   * @returns {Bitmap}
   */
  toBitmap() {
    this._close()
    const out = new Bitmap(this.width)
    let y = 0
    for (const b of this.blocks) {
      if (b.kind === 'raster') {
        out.ensure(y + b.bmp.height)
        out.data.set(b.bmp.data.subarray(0, b.bmp.width * b.bmp.height), y * this.width)
        y += b.bmp.height
      } else if (b.preview?.kind === 'feed') {
        y += b.preview.h
        out.ensure(y)
      } else if (b.preview) {
        const { w, h, kind } = b.preview
        const x = b.side === 'center' ? (this.width - w) / 2 : b.side === 'right' ? this.width - w : 0
        out.ensure(y + h + 8)
        frame(out, x, y + 4, w, h)
        label(out, this.regular, kind, x, y + 4, w, h, this.threshold)
        y += h + 8
      }
    }
    return out
  }

  /** A PNG of {@link Receipt#toBitmap}. */
  toPNG() {
    const bmp = this.toBitmap()
    return encodePNG(bmp.width, bmp.height, bmp.packRows())
  }
}

function frame(bmp, x, y, w, h) {
  for (let i = 0; i < w; i += 10) { bmp.fillRect(x + i, y, Math.min(5, w - i), 2); bmp.fillRect(x + i, y + h - 2, Math.min(5, w - i), 2) }
  for (let j = 0; j < h; j += 10) { bmp.fillRect(x, y + j, 2, Math.min(5, h - j)); bmp.fillRect(x + w - 2, y + j, 2, Math.min(5, h - j)) }
}

function label(bmp, face, text, x, y, w, h, threshold) {
  const size = 22
  const { glyphs, width } = shapeLine(face, text, false)
  const px = width * (size / face.upem)
  drawGlyphs(bmp, face, glyphs, x + (w - px) / 2, y + h / 2 + size * 0.35, size, { threshold })
}

/**
 * Keep a piece of text left to right inside Arabic text, exactly as typed —
 * phone numbers, negative amounts, codes: `ltr('-2,763')`, `ltr('011 223 4455')`.
 * Wraps it in Unicode isolates (LRI … PDI), which print as nothing.
 */
export const ltr = (text) => `⁦${text}⁩`

/** The right-to-left counterpart of {@link ltr}, for Arabic inside a left-to-right receipt. */
export const rtl = (text) => `⁧${text}⁩`

/** Shortcut: `createReceipt(options)` is `new Receipt(options)`. */
export const createReceipt = (options) => new Receipt(options)
