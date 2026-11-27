import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { Receipt, TypeFace, decodePNG } from '../src/index.js'
import { resize, dither } from '../src/image.js'

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url))
const naskh = new TypeFace(readFileSync(new URL('../node_modules/@embedpdf/fonts-arabic/fonts/NotoNaskhArabic-Regular.ttf', import.meta.url)))
const receipt = (o = {}) => new Receipt({ font: naskh, ...o })

/** A solid RGBA image. */
const solid = (width, height, [r, g, b, a = 255]) => {
  const data = new Uint8Array(width * height * 4)
  for (let i = 0; i < data.length; i += 4) data.set([r, g, b, a], i)
  return { width, height, data }
}
/** Bounding box and dot count of everything black. */
const ink = (bmp) => {
  let n = 0, left = Infinity, right = -1, top = Infinity, bottom = -1
  for (let y = 0; y < bmp.height; y++) for (let x = 0; x < bmp.width; x++) {
    if (!bmp.data[y * bmp.width + x]) continue
    n++
    left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y)
  }
  return { n, left, right, top, bottom }
}

/* ───────── PNG decoding, checked against Pillow (test/fixtures/make.py) ───────── */

const FORMATS = {
  rgba8: 'RGBA, 8-bit',
  rgb8: 'RGB, 8-bit',
  gray8: 'grey, 8-bit',
  graya8: 'grey + alpha, 8-bit',
  gray1: 'grey, 1-bit',
  pal4: 'palette, 4-bit',
  'pal8-trns': 'palette, 8-bit, transparent entry',
  'rgb16-trns': 'RGB, 16-bit, transparent colour key',
  'adam7-rgba8': 'RGBA, interlaced',
  'adam7-gray2': 'grey, 2-bit, interlaced',
  'filters-rgba8': 'RGBA, all five row filters',
}

for (const [name, what] of Object.entries(FORMATS)) {
  test(`PNG ${what} decodes to the same pixels as Pillow`, () => {
    const img = decodePNG(fixture(`${name}.png`))
    assert.equal(img.width, 37)
    assert.equal(img.height, 23)
    assert.deepEqual(Buffer.from(img.data), fixture(`${name}.rgba`))
  })
}

test('JPEG and other files are refused with a clear message', () => {
  assert.throws(() => decodePNG(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0])), /JPEG is not supported/)
  assert.throws(() => decodePNG(new TextEncoder().encode('hello')), /not a PNG/)
})

test('a truncated PNG is refused', () => {
  const png = fixture('rgba8.png')
  assert.throws(() => decodePNG(png.subarray(0, png.length - 40)), RangeError)
})

/* ───────── scaling and dithering ───────── */

test('area-average scaling keeps the overall darkness', () => {
  const w = 101, h = 67
  const src = Float32Array.from({ length: w * h }, (_, i) => ((i * 7919) % 1000) / 1000)
  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length
  for (const [W, H] of [[40, 27], [13, 9], [250, 166]]) {
    assert.ok(Math.abs(mean(resize(src, w, h, W, H)) - mean(src)) < 2e-3, `${W}×${H}`)
  }
})

test('dithering a mid grey prints about half the dots', () => {
  const w = 200, h = 200
  const grey = new Float32Array(w * h).fill(0.5)
  const share = (mode) => dither(grey, w, h, mode, { tones: [0, 1] }).reduce((s, v) => s + v, 0) / (w * h)
  assert.ok(Math.abs(share('floyd-steinberg') - 0.5) < 0.02, `floyd-steinberg ${share('floyd-steinberg')}`)
  assert.ok(share('atkinson') > 0.4 && share('atkinson') < 0.6, `atkinson ${share('atkinson')}`)
})

test('dark brand colours print solid and pale backgrounds stay blank', () => {
  const dots = (rgb, o) => ink(receipt().image(solid(40, 40, rgb), o).toBitmap()).n
  assert.equal(dots([14, 92, 66]), 1600) // dark green
  assert.equal(dots([25, 40, 110]), 1600) // navy
  assert.equal(dots([245, 245, 240]), 0) // off-white
  const mid = dots([150, 150, 150]) // a mid grey is dithered
  assert.ok(mid > 200 && mid < 1400, `${mid}`)
  assert.ok(dots([150, 150, 150], { tones: [0, 1] }) < mid, 'wider tones print lighter')
  assert.throws(() => dots([0, 0, 0], { tones: [0.7, 0.2] }), RangeError)
})

test('without dithering, grey is printed by threshold', () => {
  const dark = receipt().image(solid(20, 10, [100, 100, 100]), { dither: 'none' }).toBitmap()
  const light = receipt().image(solid(20, 10, [160, 160, 160]), { dither: 'none' }).toBitmap()
  assert.equal(ink(dark).n, 200)
  assert.equal(ink(light).n, 0)
})

/* ───────── placement on the receipt ───────── */

test('an image is centred by default, at its own size', () => {
  const box = ink(receipt().image(solid(40, 20, [0, 0, 0])).toBitmap())
  assert.equal(box.n, 40 * 20)
  assert.deepEqual([box.left, box.right, box.top, box.bottom], [268, 307, 0, 19])
})

test('transparent pixels print nothing', () => {
  assert.equal(ink(receipt().image(solid(40, 20, [0, 0, 0, 0])).toBitmap()).n, 0)
})

test('width scales the image and keeps its proportions', () => {
  const box = ink(receipt().image(solid(40, 20, [0, 0, 0]), { width: 80 }).toBitmap())
  assert.equal(box.n, 80 * 40)
})

test('an image wider than the paper is fitted inside the padding', () => {
  const box = ink(receipt({ padding: 8 }).image(solid(1000, 10, [0, 0, 0])).toBitmap())
  assert.deepEqual([box.left, box.right], [8, 567])
})

test('start is the right side in Arabic, the left in English', () => {
  const ar = ink(receipt({ padding: 8 }).image(solid(30, 10, [0, 0, 0]), { align: 'start' }).toBitmap())
  assert.equal(ar.right, 567)
  const en = ink(receipt({ padding: 8, direction: 'ltr' }).image(solid(30, 10, [0, 0, 0]), { align: 'start' }).toBitmap())
  assert.equal(en.left, 8)
})

test('an image goes below the text before it, without overlapping', () => {
  const r = receipt().text('سلام')
  const textBottom = ink(r.toBitmap()).bottom
  const box = ink(r.image(solid(30, 10, [0, 0, 0])).toBitmap())
  assert.ok(box.bottom - 9 > textBottom)
})

test('PNG bytes, ArrayBuffer and browser ImageData are all accepted', () => {
  const png = fixture('rgba8.png')
  const fromBytes = ink(receipt().image(png).toBitmap()).n
  const fromBuffer = ink(receipt().image(png.buffer.slice(png.byteOffset, png.byteOffset + png.length)).toBitmap()).n
  const { width, height, data } = decodePNG(png)
  const fromImageData = ink(receipt().image({ width, height, data: new Uint8ClampedArray(data) }).toBitmap()).n
  assert.ok(fromBytes > 0)
  assert.equal(fromBuffer, fromBytes)
  assert.equal(fromImageData, fromBytes)
})

test('bad image input is refused', () => {
  assert.throws(() => receipt().image({ width: 2, height: 2, data: new Uint8Array(3) }), TypeError)
  assert.throws(() => receipt().image('logo.png'), TypeError)
  assert.throws(() => receipt().image(solid(4, 4, [0, 0, 0]), { dither: 'random' }), RangeError)
})
