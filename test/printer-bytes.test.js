// The bytes sent to the printer, read back by an independent ESC/POS reader
// (test/helpers/read-escpos.js) and compared with the preview, dot for dot.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { Receipt, TypeFace, ltr } from '../src/index.js'
import { readEscPos } from './helpers/read-escpos.js'

const font = (p) => new TypeFace(readFileSync(new URL(`../node_modules/@embedpdf/${p}`, import.meta.url)))
const naskh = font('fonts-arabic/fonts/NotoNaskhArabic-Regular.ttf')
const naskhBold = font('fonts-arabic/fonts/NotoNaskhArabic-Bold.ttf')
const sans = font('fonts-latin/fonts/NotoSans-Regular.ttf')
const logo = readFileSync(new URL('../examples/logo.png', import.meta.url))

const sameRows = (printed, preview, from = 0) => {
  for (let y = 0; y < printed.length; y++) {
    const want = preview.data.subarray((from + y) * preview.width, (from + y + 1) * preview.width)
    if (!printed[y].every((v, x) => v === want[x])) return `row ${from + y} differs`
  }
  return null
}

for (const [paper, width] of [['80mm', 576], ['58mm', 384]]) {
  test(`${paper}: what the printer prints is exactly the preview`, () => {
    const r = new Receipt({ font: naskh, boldFont: naskhBold, fallbackFonts: [sans], width: paper, padding: 8 })
      .image(logo, { width: 120 })
      .text('صيدلية النور', { size: 40, bold: true, align: 'center' })
      .text(`هاتف: ${ltr('011 223 4455')}`, { align: 'center' })
      .rule()
      .row(['Panadol Extra 500mg — 24 قرص', '2', '18,000'], { widths: [3, 1, 1.6] })
      .rule({ style: 'double' })
      .row(['الإجمالي', '52,487 ل.س'], { size: 32, bold: true })
      .space(20)
    const preview = r.toBitmap()
    const { rows, commands } = readEscPos(r.encode({ band: 64 }), width)
    assert.equal(rows.length, preview.height)
    assert.equal(sameRows(rows, preview), null)
    assert.equal(commands[0], 'init')
    assert.ok(commands.filter((c) => c.startsWith('raster')).length > 1, 'sent in several bands')
  })
}

test('QR codes, barcodes, the drawer and the cut are all well-formed commands', () => {
  const r = new Receipt({ font: naskh, fallbackFonts: [sans] })
    .text('فاتورة 1042')
    .qr('https://example.com/receipt/1042')
    .barcode('INV-1042')
    .barcode('6291041500213', { type: 'EAN13' })
    .text('شكراً لزيارتكم', { align: 'center' })
    .drawer()
    .cut()
  const { rows, commands } = readEscPos(r.encode(), r.width) // throws on any stray byte
  assert.deepEqual(
    commands.filter((c) => !c.startsWith('raster') && !c.startsWith('align')),
    ['init', 'qr A', 'qr C', 'qr E', 'qr P', 'qr Q', 'barcode 73', 'barcode 67', 'drawer 0', 'feed 4', 'cut partial'],
  )
  // Every alignment change for a native block is undone before the next raster image.
  const aligns = commands.filter((c) => c.startsWith('align'))
  assert.equal(aligns.at(-1), 'align left')
  const rasterRows = r.blocks.filter((b) => b.kind === 'raster').reduce((n, b) => n + b.bmp.height, 0)
  assert.equal(rows.length, rasterRows)
})
