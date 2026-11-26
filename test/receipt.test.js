import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { Receipt, TypeFace, FontStack, ltr, toArabicDigits, PAPER } from '../src/index.js'
import { shapeLine, wrapText } from '../src/shaper.js'
import { Bitmap } from '../src/raster.js'
import * as cmd from '../src/escpos.js'

const read = (p) => readFileSync(new URL(`../node_modules/@embedpdf/${p}`, import.meta.url))
const naskh = new TypeFace(read('fonts-arabic/fonts/NotoNaskhArabic-Regular.ttf'))
const naskhBold = new TypeFace(read('fonts-arabic/fonts/NotoNaskhArabic-Bold.ttf'))
const sans = new TypeFace(read('fonts-latin/fonts/NotoSans-Regular.ttf'))
const stack = new FontStack([naskh, sans])
const receipt = (o = {}) => new Receipt({ font: naskh, fallbackFonts: [sans], ...o })

const chars = (text, glyphs) => glyphs.map((g) => text[g.cluster]).join('')
const blackIn = (bmp, x0, x1) => {
  let n = 0
  for (let y = 0; y < bmp.height; y++) for (let x = x0; x < x1; x++) n += bmp.data[y * bmp.width + x]
  return n
}

/* ───────── shaping ───────── */

test('lam-alef becomes one ligature glyph', () => {
  const { glyphs } = shapeLine(naskh, 'لا', true)
  assert.equal(glyphs.length, 1)
})

test('joined letters use contextual forms, not isolated ones', () => {
  const isolated = shapeLine(naskh, 'ب', true).glyphs[0].id
  const joined = shapeLine(naskh, 'ببب', true).glyphs.map((g) => g.id)
  assert.equal(joined.length, 3)
  assert.ok(joined.every((id) => id !== isolated), 'every beh in a word should be initial, medial or final')
})

test('Arabic is laid out right to left', () => {
  const { glyphs } = shapeLine(naskh, 'كتب', true) // no ligatures in this word
  assert.equal(chars('كتب', glyphs), 'بتك')
})

test('numbers keep their digit order inside Arabic text', () => {
  const text = 'المجموع 1042'
  const visual = chars(text, shapeLine(stack, text, true).glyphs)
  assert.ok(visual.startsWith('1042'), `got ${visual}`) // the number sits at the left end
})

test('Latin words read left to right inside an Arabic line', () => {
  const text = 'دواء Panadol'
  const visual = chars(text, shapeLine(stack, text, true).glyphs)
  assert.ok(visual.startsWith('Panadol'), `got ${visual}`)
})

test('ltr() keeps a leading minus on the left of the number', () => {
  const text = `الحسم ${ltr('-2,763')}`
  const visual = chars(text, shapeLine(stack, text, true).glyphs).replace(/[⁦-⁩]/g, '')
  assert.ok(visual.startsWith('-2,763'), `got ${visual}`)
})

test('characters missing from the main font come from the fallback', () => {
  const { glyphs } = shapeLine(stack, 'Vitamin سي', true)
  const latin = glyphs.filter((g) => g.face === sans).map((g) => 'Vitamin سي'[g.cluster]).join('')
  assert.equal(latin.replace(/ /g, ''), 'Vitamin')
  assert.ok(glyphs.every((g) => g.id !== 0), 'no .notdef boxes')
})

test('fallback positions are converted to the main font units', () => {
  const alone = shapeLine(sans, 'A', false).glyphs[0].xAdvance
  const viaStack = shapeLine(stack, 'A', false).glyphs[0].xAdvance
  assert.ok(Math.abs(viaStack - (alone * naskh.upem) / sans.upem) < 1e-6)
})

test('Arabic-Indic digits', () => {
  assert.equal(toArabicDigits('2026/11/26'), '٢٠٢٦/١١/٢٦')
})

test('wrapping keeps every line within the width', () => {
  const text = 'الأدوية المصروفة بوصفة طبية لا تُستبدل ولا تُسترجع. يُرجى الاحتفاظ بالفاتورة.'
  const max = 8 * naskh.upem // about eight ems: several words a line, no word too long
  const lines = wrapText(stack, text, max, true)
  assert.ok(lines.length > 1)
  for (const l of lines) assert.ok(shapeLine(stack, l, true).width <= max, l)
  assert.equal(lines.join(' '), text)
})

test('a word longer than the line is broken between characters', () => {
  const lines = wrapText(stack, 'https://example.com/a/very/long/path/that/does/not/fit', 3000, false)
  assert.ok(lines.length > 1)
  for (const l of lines) assert.ok(shapeLine(stack, l, false).width <= 3000)
})

/* ───────── layout ───────── */

test('right-aligned by default in Arabic, left in English', () => {
  const ar = receipt().text('سلام').toBitmap()
  assert.ok(blackIn(ar, 288, 576) > 0 && blackIn(ar, 0, 288) === 0)
  const en = receipt({ direction: 'ltr' }).text('Hello').toBitmap()
  assert.ok(blackIn(en, 0, 288) > 0 && blackIn(en, 288, 576) === 0)
})

test('centred text has equal margins (within a few dots)', () => {
  const bmp = receipt().text('صيدلية النور', { align: 'center', size: 40 }).toBitmap()
  let left = Infinity, right = -1
  for (let y = 0; y < bmp.height; y++) for (let x = 0; x < bmp.width; x++) if (bmp.data[y * bmp.width + x]) { left = Math.min(left, x); right = Math.max(right, x) }
  assert.ok(Math.abs(left - (bmp.width - 1 - right)) <= 6, `left ${left}, right ${bmp.width - 1 - right}`)
})

test('the first column sits on the right in Arabic', () => {
  const bmp = receipt().row(['أ', ''], { widths: [1, 1], gap: 0 }).toBitmap()
  assert.ok(blackIn(bmp, 288, 576) > 0)
  assert.equal(blackIn(bmp, 0, 288), 0)
})

test('a cell wraps inside its column and the row grows', () => {
  const one = receipt().row(['قصير', '1']).toBitmap().height
  const two = receipt().row(['اسم صنف طويل جداً لا يتسع في عمود واحد ضيق', '1'], { widths: [1, 3] }).toBitmap().height
  assert.ok(two > one * 1.8)
})

test('58 mm paper is 384 dots wide', () => {
  assert.equal(PAPER['58mm'], 384)
  assert.equal(receipt({ width: '58mm' }).text('سلام').toBitmap().width, 384)
})

test('bold without a bold font is thickened; with one, it uses it', () => {
  const plain = blackIn(receipt().text('سلام').toBitmap(), 0, 576)
  const fake = blackIn(receipt().text('سلام', { bold: true }).toBitmap(), 0, 576)
  const real = blackIn(receipt({ boldFont: naskhBold }).text('سلام', { bold: true }).toBitmap(), 0, 576)
  assert.ok(fake > plain && real > plain)
})

test('rules draw across the paper', () => {
  const bmp = receipt({ padding: 8 }).rule({ style: 'solid', weight: 2, space: 0 }).toBitmap()
  assert.equal(blackIn(bmp, 0, 8), 0)
  assert.equal(blackIn(bmp, 8, 568), 560 * 2)
})

test('the width must be a multiple of 8', () => {
  assert.throws(() => new Bitmap(500), RangeError)
  assert.throws(() => new Receipt({}), TypeError)
})

/* ───────── ESC/POS bytes ───────── */

const find = (hay, needle) => {
  outer: for (let i = 0; i <= hay.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer
    return i
  }
  return -1
}

test('starts with ESC @ and rasterises text with GS v 0, 72 bytes a row on 80 mm', () => {
  const r = receipt().text('سلام')
  const bytes = r.encode()
  assert.deepEqual([...bytes.slice(0, 2)], [0x1b, 0x40])
  const at = find(bytes, [0x1d, 0x76, 0x30, 0x00])
  assert.ok(at > 0)
  assert.equal(bytes[at + 4] | (bytes[at + 5] << 8), 72)
  const rows = bytes[at + 6] | (bytes[at + 7] << 8)
  assert.equal(rows, r.toBitmap().height)
})

test('tall images are sent in bands that add up to the whole image', () => {
  const r = receipt()
  for (let i = 0; i < 12; i++) r.text('سطر')
  const bytes = r.encode({ band: 64 })
  let p = find(bytes, [0x1d, 0x76, 0x30, 0])
  let total = 0, bands = 0
  while (p < bytes.length && bytes[p] === 0x1d && bytes[p + 1] === 0x76) {
    const h = bytes[p + 6] | (bytes[p + 7] << 8)
    assert.ok(h > 0 && h <= 64)
    total += h
    bands++
    p += 8 + 72 * h
  }
  assert.ok(bands > 1)
  assert.equal(total, r.toBitmap().height)
})

test('raster bits: a filled row packs to 0xFF', () => {
  const b = new Bitmap(16)
  b.fillRect(0, 0, 16, 1)
  assert.deepEqual([...b.packRows()], [0xff, 0xff])
  const c = new Bitmap(8)
  c.fillRect(0, 0, 1, 1)
  assert.deepEqual([...c.packRows()], [0x80])
})

test('QR uses the native model 2 commands with UTF-8 data', () => {
  const bytes = cmd.qr('سلام', { size: 5, ecc: 'Q' })
  const data = [...new TextEncoder().encode('سلام')]
  assert.ok(find(bytes, [0x1d, 0x28, 0x6b, 4, 0, 0x31, 0x41, 0x32, 0]) === 0)
  assert.ok(find(bytes, [0x1d, 0x28, 0x6b, 3, 0, 0x31, 0x43, 5]) > 0)
  assert.ok(find(bytes, [0x1d, 0x28, 0x6b, 3, 0, 0x31, 0x45, 50]) > 0)
  assert.ok(find(bytes, [0x1d, 0x28, 0x6b, data.length + 3, 0, 0x31, 0x50, 0x30, ...data]) > 0)
  assert.deepEqual(bytes.slice(-8), [0x1d, 0x28, 0x6b, 3, 0, 0x31, 0x51, 0x30])
})

test('barcodes validate their data', () => {
  const ean = cmd.barcode('6291041500213', { type: 'EAN13' })
  assert.deepEqual(ean.slice(-17), [0x1d, 0x6b, 67, 13, ...[...'6291041500213'].map((c) => c.charCodeAt(0))])
  assert.throws(() => cmd.barcode('12AB', { type: 'EAN13' }), RangeError)
  const c128 = cmd.barcode('INV-1042') // 8 characters behind the {B code-set prefix
  assert.deepEqual(c128.slice(-12, -8), [0x49, 10, 0x7b, 0x42])
})

test('cut feeds and cuts; QR is centred and alignment is reset afterwards', () => {
  const bytes = receipt().text('مرحبا').qr('x').cut().encode()
  // The receipt ends with the partial cut, then alignment back to the left.
  assert.deepEqual([...bytes.slice(-7)], [0x1d, 0x56, 66, 0, 0x1b, 0x61, 0])
  const qrAt = find(bytes, [0x1d, 0x28, 0x6b, 4, 0, 0x31, 0x41])
  assert.deepEqual([...bytes.slice(qrAt - 3, qrAt)], [0x1b, 0x61, 1])
})

test('drawer kick', () => {
  assert.deepEqual(cmd.drawer(0), [0x1b, 0x70, 0, 25, 250])
})

/* ───────── preview ───────── */

test('PNG preview has the right size and signature', () => {
  const r = receipt().text('سلام').qr('https://example.com')
  const png = r.toPNG()
  assert.deepEqual([...png.slice(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const dv = new DataView(png.buffer, png.byteOffset)
  assert.equal(dv.getUint32(16), 576)
  assert.equal(dv.getUint32(20), r.toBitmap().height)
})
