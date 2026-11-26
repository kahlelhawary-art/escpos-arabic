// A 1-bit canvas the width of the print head, and a glyph rasteriser.
// Outlines are filled with the non-zero rule using 4 sub-scanlines per pixel and exact
// horizontal coverage, then thresholded — thermal heads print dots, not grey.

export class Bitmap {
  /** @param {number} width in dots; a multiple of 8 (384 for 58 mm, 576 for 80 mm heads) */
  constructor(width) {
    if (!Number.isInteger(width) || width <= 0 || width % 8) throw new RangeError('escpos-arabic: width must be a positive multiple of 8')
    this.width = width
    this.height = 0
    this.data = new Uint8Array(0) // 1 = black, one byte per dot
  }

  /** Grow the canvas so it is at least `h` rows tall (capacity doubles, so growth stays cheap). */
  ensure(h) {
    h = Math.ceil(h)
    if (h <= this.height) return
    if (this.width * h > this.data.length) {
      const next = new Uint8Array(this.width * Math.max(h, (this.data.length / this.width) * 2, 64))
      next.set(this.data)
      this.data = next
    }
    this.height = h
  }

  fillRect(x, y, w, h) {
    x = Math.max(0, Math.round(x)); y = Math.max(0, Math.round(y))
    const x1 = Math.min(this.width, Math.round(x + w)), y1 = Math.round(y + h)
    this.ensure(y1)
    for (let row = y; row < y1; row++) this.data.fill(1, row * this.width + x, row * this.width + x1)
  }

  /** Rows packed 8 dots per byte, most significant bit first (the ESC/POS raster layout). */
  packRows(fromRow = 0, toRow = this.height) {
    const bpr = this.width / 8
    const out = new Uint8Array(bpr * (toRow - fromRow))
    for (let y = fromRow; y < toRow; y++) {
      const src = y * this.width
      const dst = (y - fromRow) * bpr
      for (let bx = 0; bx < bpr; bx++) {
        let b = 0
        for (let k = 0; k < 8; k++) b = (b << 1) | this.data[src + bx * 8 + k]
        out[dst + bx] = b
      }
    }
    return out
  }
}

const SUB = 4 // sub-scanlines per pixel row

/** Flatten outline commands (font units, y up) into closed polygons in pixel space. */
function flatten(commands, ox, oy, scale) {
  const polys = []
  let poly = null
  let cx = 0, cy = 0, sx = 0, sy = 0
  const X = (x) => ox + x * scale
  const Y = (y) => oy - y * scale
  const steps = (len) => Math.max(2, Math.min(24, Math.ceil(len * scale / 3)))
  for (const { type, values: v } of commands) {
    switch (type) {
      case 'M':
        poly = []
        polys.push(poly)
        cx = sx = v[0]; cy = sy = v[1]
        poly.push(X(cx), Y(cy))
        break
      case 'L':
        cx = v[0]; cy = v[1]
        poly.push(X(cx), Y(cy))
        break
      case 'Q': {
        const n = steps(Math.hypot(v[0] - cx, v[1] - cy) + Math.hypot(v[2] - v[0], v[3] - v[1]))
        for (let i = 1; i <= n; i++) {
          const t = i / n, u = 1 - t
          poly.push(X(u * u * cx + 2 * u * t * v[0] + t * t * v[2]), Y(u * u * cy + 2 * u * t * v[1] + t * t * v[3]))
        }
        cx = v[2]; cy = v[3]
        break
      }
      case 'C': {
        const n = steps(Math.hypot(v[0] - cx, v[1] - cy) + Math.hypot(v[2] - v[0], v[3] - v[1]) + Math.hypot(v[4] - v[2], v[5] - v[3]))
        for (let i = 1; i <= n; i++) {
          const t = i / n, u = 1 - t
          const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t
          poly.push(X(a * cx + b * v[0] + c * v[2] + d * v[4]), Y(a * cy + b * v[1] + c * v[3] + d * v[5]))
        }
        cx = v[4]; cy = v[5]
        break
      }
      case 'Z':
        cx = sx; cy = sy
        break
    }
  }
  // Close every contour, whether or not the outline said so.
  for (const p of polys) if (p.length >= 4 && (p[0] !== p[p.length - 2] || p[1] !== p[p.length - 1])) p.push(p[0], p[1])
  return polys
}

/**
 * Fill polygons into a coverage buffer (values 0..1, union by maximum).
 * @param {Float32Array} cov  width*height coverage
 */
function fillPolygons(cov, width, height, polys) {
  const edges = []
  let minY = Infinity, maxY = -Infinity
  for (const p of polys) {
    for (let i = 0; i + 3 < p.length; i += 2) {
      const x0 = p[i], y0 = p[i + 1], x1 = p[i + 2], y1 = p[i + 3]
      if (y0 === y1) continue
      const dir = y1 > y0 ? 1 : -1
      const top = Math.min(y0, y1), bottom = Math.max(y0, y1)
      edges.push({ top, bottom, x0, y0, slope: (x1 - x0) / (y1 - y0), dir })
      minY = Math.min(minY, top); maxY = Math.max(maxY, bottom)
    }
  }
  if (!edges.length) return
  const local = new Float32Array(width) // this glyph's coverage for one pixel row
  const xs = []
  const rowStart = Math.max(0, Math.floor(minY)), rowEnd = Math.min(height, Math.ceil(maxY))
  for (let row = rowStart; row < rowEnd; row++) {
    local.fill(0)
    let touched = false
    for (let s = 0; s < SUB; s++) {
      const y = row + (s + 0.5) / SUB
      xs.length = 0
      for (const e of edges) if (y >= e.top && y < e.bottom) xs.push({ x: e.x0 + (y - e.y0) * e.slope, dir: e.dir })
      if (xs.length < 2) continue
      xs.sort((a, b) => a.x - b.x)
      let wind = 0
      for (let k = 0; k < xs.length - 1; k++) {
        wind += xs[k].dir
        if (!wind) continue
        const a = Math.max(0, xs[k].x), b = Math.min(width, xs[k + 1].x)
        if (b <= a) continue
        touched = true
        const ia = Math.floor(a), ib = Math.floor(b)
        if (ia === ib) { local[ia] += (b - a) / SUB; continue }
        local[ia] += (ia + 1 - a) / SUB
        for (let x = ia + 1; x < ib; x++) local[x] += 1 / SUB
        if (ib < width) local[ib] += (b - ib) / SUB
      }
    }
    if (!touched) continue
    const base = row * width
    for (let x = 0; x < width; x++) if (local[x] > cov[base + x]) cov[base + x] = local[x]
  }
}

/**
 * Draw a shaped line into the bitmap.
 * @param {Bitmap} bmp
 * @param {import('./shaper.js').TypeFace} face
 * @param {Array} glyphs visual-order glyphs from shapeLine
 * @param {number} x left edge in dots
 * @param {number} baseline baseline y in dots
 * @param {number} size font size in dots (the em height)
 * @param {{ threshold?: number, embolden?: boolean }} [opts]
 */
export function drawGlyphs(bmp, face, glyphs, x, baseline, size, { threshold = 0.45, embolden = false } = {}) {
  const scale = size / face.upem // positions are in the primary font's units
  const top = Math.floor(baseline - face.ascender * scale) - 2
  const bottom = Math.ceil(baseline - face.descender * scale) + 2
  const h = bottom - Math.max(0, top)
  const y0 = Math.max(0, top)
  bmp.ensure(bottom)
  const W = bmp.width
  const cov = new Float32Array(W * h)
  let pen = x
  for (const g of glyphs) {
    const gf = g.face ?? face
    const commands = gf.outline(g.id)
    if (commands.length) fillPolygons(cov, W, h, flatten(commands, pen + g.xOffset * scale, baseline - y0 - g.yOffset * scale, size / gf.upem))
    pen += g.xAdvance * scale
  }
  for (let row = 0; row < h; row++) {
    const src = row * W, dst = (row + y0) * W
    for (let col = 0; col < W; col++) {
      if (cov[src + col] >= threshold) {
        bmp.data[dst + col] = 1
        if (embolden && col + 1 < W) bmp.data[dst + col + 1] = 1
      }
    }
  }
}
