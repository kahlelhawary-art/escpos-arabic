// Text shaping: HarfBuzz joins the letters (initial, medial, final and isolated forms,
// lam-alef and other ligatures, mark positioning), the Unicode bidi algorithm puts Arabic,
// numbers and Latin words in visual order. The output is glyphs left to right, ready to draw.
import { Blob, Face, Font, Buffer, Direction, shape } from 'harfbuzzjs'
import bidiFactory from 'bidi-js'

const bidi = bidiFactory()

/** A loaded font: shaping, metrics and cached glyph outlines. */
export class TypeFace {
  /** @param {Uint8Array | ArrayBuffer} data TrueType or OpenType font bytes. */
  constructor(data) {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
    if (!bytes.byteLength) throw new TypeError('escpos-arabic: the font data is empty')
    this.face = new Face(new Blob(bytes), 0)
    this.font = new Font(this.face)
    this.upem = this.face.upem
    const ext = this.font.hExtents()
    this.ascender = ext.ascender
    this.descender = ext.descender // negative
    this.lineGap = ext.lineGap
    this.outlines = new Map()
  }

  /** Outline commands for a glyph, in font units with y pointing up. */
  outline(glyphId) {
    let o = this.outlines.get(glyphId)
    if (!o) {
      o = this.font.glyphToJson(glyphId)
      this.outlines.set(glyphId, o)
    }
    return o
  }

  /** Whether the font has a glyph for this code point. */
  has(cp) {
    this.coverage ??= new Map()
    let v = this.coverage.get(cp)
    if (v === undefined) {
      v = this.font.nominalGlyph(cp) !== undefined
      this.coverage.set(cp, v)
    }
    return v
  }

  /** Shape one directional run. Glyphs come back in visual (left-to-right) order. */
  shapeRun(text, rtl) {
    const buf = new Buffer()
    buf.addText(text)
    buf.setDirection(rtl ? Direction.RTL : Direction.LTR)
    buf.guessSegmentProperties()
    shape(this.font, buf)
    return buf.getGlyphInfosAndPositions().map((g) => ({
      id: g.codepoint,
      cluster: g.cluster,
      xAdvance: g.xAdvance ?? 0,
      xOffset: g.xOffset ?? 0,
      yOffset: g.yOffset ?? 0,
    }))
  }
}

/**
 * A primary font plus fallbacks. Each character is drawn with the first font that has it;
 * spaces, marks and joiners stay with the character before them. Metrics and positions
 * are expressed in the primary font's units.
 */
export class FontStack {
  /** @param {TypeFace[]} faces primary first */
  constructor(faces) {
    this.faces = faces
    const p = faces[0]
    this.upem = p.upem
    this.ascender = p.ascender
    this.descender = p.descender
  }

  faceIndexFor(cp, current) {
    if (current >= 0 && (KEEP.test(String.fromCodePoint(cp)) || this.faces[current].has(cp))) return current
    for (let i = 0; i < this.faces.length; i++) if (this.faces[i].has(cp)) return i
    return current >= 0 ? current : 0
  }
}
const KEEP = /^[\s\p{M}\p{Cf}]$/u

const asStack = (f) => (f instanceof FontStack ? f : new FontStack([f]))

/** Split a single-direction run by font, shape each piece, return glyphs in visual order. */
function shapeByFont(stack, text, rtl, offset) {
  const pieces = []
  let current = -1
  let start = 0
  for (let i = 0; i < text.length; ) {
    const cp = text.codePointAt(i)
    const fi = stack.faceIndexFor(cp, current)
    if (fi !== current) {
      if (current >= 0) pieces.push({ fi: current, start, end: i })
      current = fi
      start = i
    }
    i += cp > 0xffff ? 2 : 1
  }
  pieces.push({ fi: current < 0 ? 0 : current, start, end: text.length })
  if (rtl) pieces.reverse() // pieces are in reading order; right-to-left runs are drawn from the end
  const out = []
  for (const p of pieces) {
    const face = stack.faces[p.fi]
    const k = stack.upem / face.upem
    for (const g of face.shapeRun(text.slice(p.start, p.end), rtl)) {
      out.push({ ...g, face, cluster: g.cluster + p.start + offset, xAdvance: g.xAdvance * k, xOffset: g.xOffset * k, yOffset: g.yOffset * k })
    }
  }
  return out
}

/**
 * Shape a single line of text into visually ordered glyphs.
 * @param {TypeFace|FontStack} fonts
 * @param {string} text
 * @param {boolean} baseRtl paragraph direction
 * @returns {{ glyphs: Array<{id:number, face:TypeFace, cluster:number, xAdvance:number, xOffset:number, yOffset:number}>, width: number }}
 *   positions and width in the primary font's units
 */
export function shapeLine(fonts, text, baseRtl) {
  const stack = asStack(fonts)
  if (!text) return { glyphs: [], width: 0 }
  const { levels } = bidi.getEmbeddingLevels(text, baseRtl ? 'rtl' : 'ltr')

  // Split into runs of one embedding level.
  const runs = []
  let start = 0
  for (let i = 1; i <= text.length; i++) {
    if (i === text.length || levels[i] !== levels[start]) {
      runs.push({ start, end: i, level: levels[start] })
      start = i
    }
  }
  for (const r of runs) r.glyphs = shapeByFont(stack, text.slice(r.start, r.end), r.level % 2 === 1, r.start)

  // Rule L2: from the highest level down to the lowest odd level,
  // reverse every maximal sequence of runs at that level or higher.
  let highest = 0
  let lowestOdd = Infinity
  for (const r of runs) {
    highest = Math.max(highest, r.level)
    if (r.level % 2 === 1) lowestOdd = Math.min(lowestOdd, r.level)
  }
  for (let lvl = highest; lvl >= lowestOdd; lvl--) {
    for (let i = 0; i < runs.length; ) {
      if (runs[i].level >= lvl) {
        let j = i
        while (j < runs.length && runs[j].level >= lvl) j++
        const seq = runs.slice(i, j).reverse()
        runs.splice(i, j - i, ...seq)
        i = j
      } else i++
    }
  }

  const glyphs = runs.flatMap((r) => r.glyphs)
  const width = glyphs.reduce((w, g) => w + g.xAdvance, 0)
  return { glyphs, width }
}

const ARABIC_INDIC = '٠١٢٣٤٥٦٧٨٩'
/** Replace 0–9 with Arabic-Indic digits (٠–٩). */
export function toArabicDigits(text) {
  return text.replace(/[0-9]/g, (d) => ARABIC_INDIC[d.charCodeAt(0) - 48])
}

/**
 * Break text into lines no wider than `maxWidth` font units. Breaks at spaces;
 * a single word longer than the line is broken between characters.
 * @returns {string[]}
 */
export function wrapText(face, text, maxWidth, baseRtl) {
  const lines = []
  for (const paragraph of String(text).split('\n')) {
    const words = paragraph.split(/ +/).filter((w, i, a) => w || a.length === 1)
    if (!words.length) { lines.push(''); continue }
    const space = shapeLine(face, ' ', baseRtl).width
    let line = ''
    let lineWidth = 0
    for (const word of words) {
      let w = shapeLine(face, word, baseRtl).width
      if (w > maxWidth) {
        // Too long for any line on its own (a URL, a long code): break between characters.
        if (line) { lines.push(line); line = ''; lineWidth = 0 }
        let piece = ''
        for (const ch of word) {
          if (piece && shapeLine(face, piece + ch, baseRtl).width > maxWidth) { lines.push(piece); piece = '' }
          piece += ch
        }
        line = piece
        lineWidth = shapeLine(face, piece, baseRtl).width
        continue
      }
      if (!line) { line = word; lineWidth = w; continue }
      if (lineWidth + space + w <= maxWidth) {
        line += ' ' + word
        lineWidth += space + w
      } else {
        lines.push(line)
        line = word
        lineWidth = w
      }
    }
    lines.push(line)
  }
  return lines
}
