import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { Receipt, TypeFace, zatcaQR } from '../src/index.js'
import { readEscPos } from './helpers/read-escpos.js'

/** Read the QR text back: Base64, then tag (1 byte), length (1 byte), UTF-8 value, repeated. */
const readTLV = (base64) => {
  const bytes = Buffer.from(base64, 'base64')
  const fields = {}
  for (let i = 0; i < bytes.length;) {
    const tag = bytes[i], len = bytes[i + 1]
    assert.ok(i + 2 + len <= bytes.length, `field ${tag} runs past the end`)
    fields[tag] = { text: bytes.subarray(i + 2, i + 2 + len).toString('utf8'), len }
    i += 2 + len
  }
  return fields
}

const shop = { seller: 'مقهى الياسمين', vatNumber: '399999999900003', timestamp: '2026-11-27T12:30:05Z', total: 115, vat: 15 }

test('matches the worked example in ZATCA\'s QR documentation', () => {
  // "Bobs Basement Records", section 6.4 of
  // https://zatca1.discourse.group/t/structure-of-the-qr-code-for-electronic-tax-invoices/483
  const qr = zatcaQR({
    seller: 'Bobs Basement Records',
    vatNumber: '100025906700003',
    timestamp: '2022-04-25T15:30:00Z',
    total: '2100100.99',
    vat: '315015.15',
  })
  assert.equal(qr, 'ARVCb2JzIEJhc2VtZW50IFJlY29yZHMCDzEwMDAyNTkwNjcwMDAwMwMUMjAyMi0wNC0yNVQxNTozMDowMFoECjIxMDAxMDAuOTkFCTMxNTAxNS4xNQ==')
})

test('the five fields read back in order, with Arabic names measured in bytes', () => {
  const f = readTLV(zatcaQR(shop))
  assert.deepEqual(Object.keys(f).map(Number), [1, 2, 3, 4, 5])
  assert.equal(f[1].text, 'مقهى الياسمين')
  assert.equal(f[1].len, Buffer.byteLength('مقهى الياسمين')) // 25 bytes for 13 characters
  assert.equal(f[2].text, '399999999900003')
  assert.equal(f[3].text, '2026-11-27T12:30:05Z')
  assert.equal(f[4].text, '115.00')
  assert.equal(f[5].text, '15.00')
})

test('a Date is written in UTC without milliseconds; text is kept as given', () => {
  const at = new Date(Date.UTC(2026, 10, 27, 9, 5, 7, 450))
  assert.equal(readTLV(zatcaQR({ ...shop, timestamp: at }))[3].text, '2026-11-27T09:05:07Z')
  assert.equal(readTLV(zatcaQR({ ...shop, timestamp: '2026-11-27T12:05:07+03:00' }))[3].text, '2026-11-27T12:05:07+03:00')
})

test('numbers get two decimals; amounts given as text are kept', () => {
  const f = readTLV(zatcaQR({ ...shop, total: 1108.9, vat: '144.9' }))
  assert.equal(f[4].text, '1108.90')
  assert.equal(f[5].text, '144.9')
})

test('wrong invoice data is refused with a clear message', () => {
  assert.throws(() => zatcaQR({ ...shop, seller: ' ' }), /seller name/)
  assert.throws(() => zatcaQR({ ...shop, vatNumber: '39999999990003' }), /15 digits/)
  assert.throws(() => zatcaQR({ ...shop, timestamp: '27/11/2026 12:30' }), /ISO 8601/)
  assert.throws(() => zatcaQR({ ...shop, timestamp: new Date('nope') }), /invalid Date/)
  assert.throws(() => zatcaQR({ ...shop, total: -5 }), /invoice total/)
  assert.throws(() => zatcaQR({ ...shop, total: '1,150.00' }), /invoice total/)
  assert.throws(() => zatcaQR({ ...shop, vat: 200 }), /larger than the invoice total/)
  assert.throws(() => zatcaQR({ ...shop, seller: 'م'.repeat(130) }), /255/)
})

test('the QR reaches the printer as a native QR command holding exactly that text', () => {
  const naskh = new TypeFace(readFileSync(new URL('../node_modules/@embedpdf/fonts-arabic/fonts/NotoNaskhArabic-Regular.ttf', import.meta.url)))
  const qr = zatcaQR(shop)
  const bytes = new Receipt({ font: naskh }).text('فاتورة ضريبية مبسطة', { align: 'center' }).qr(qr).cut().encode()
  const { commands } = readEscPos(bytes, 576)
  assert.ok(commands.includes('qr P') && commands.includes('qr Q'))
  const data = new TextEncoder().encode(qr)
  const store = [0x1d, 0x28, 0x6b, (data.length + 3) & 0xff, (data.length + 3) >> 8, 0x31, 0x50, 0x30, ...data]
  const at = bytes.findIndex((_, i) => store.every((v, j) => bytes[i + j] === v))
  assert.ok(at > 0, 'the QR store command carries the Base64 text unchanged')
})
