// The QR code content that Saudi simplified tax invoices carry (ZATCA e-invoicing):
// five fields, each as Tag-Length-Value — one byte tag, one byte length (UTF-8 bytes),
// then the value — joined without separators and encoded as Base64.

const utf8 = new TextEncoder()

/**
 * The text to put in the QR code of a Saudi simplified tax invoice.
 * @param {object} invoice
 * @param {string} invoice.seller seller's name, as registered
 * @param {string|number} invoice.vatNumber seller's VAT registration number (15 digits)
 * @param {Date|string} invoice.timestamp when the invoice was issued; a Date is written in UTC
 * @param {number|string} invoice.total invoice total including VAT
 * @param {number|string} invoice.vat VAT total
 * @returns {string} Base64, ready for `.qr()`
 */
export function zatcaQR({ seller, vatNumber, timestamp, total, vat } = {}) {
  const name = String(seller ?? '').trim()
  if (!name) throw new TypeError('escpos-arabic: zatcaQR needs the seller name')
  const vatNo = String(vatNumber ?? '').trim()
  if (!/^\d{15}$/.test(vatNo)) throw new RangeError(`escpos-arabic: the VAT registration number must be 15 digits, got "${vatNo}"`)
  const totalText = amount(total, 'invoice total')
  const vatText = amount(vat, 'VAT total')
  if (Number(vatText) > Number(totalText)) throw new RangeError('escpos-arabic: the VAT total is larger than the invoice total')

  const values = [name, vatNo, time(timestamp), totalText, vatText].map((v) => utf8.encode(v))
  if (values[0].length > 255) throw new RangeError(`escpos-arabic: the seller name is ${values[0].length} bytes in UTF-8; the QR field holds at most 255`)
  const bytes = new Uint8Array(values.reduce((n, v) => n + 2 + v.length, 0))
  let o = 0
  values.forEach((v, i) => {
    bytes[o] = i + 1 // tags 1–5: seller, VAT number, timestamp, total, VAT
    bytes[o + 1] = v.length
    bytes.set(v, o + 2)
    o += 2 + v.length
  })
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

function time(t) {
  if (t instanceof Date) {
    if (Number.isNaN(t.getTime())) throw new RangeError('escpos-arabic: the invoice timestamp is an invalid Date')
    return t.toISOString().replace(/\.\d{3}Z$/, 'Z') // 2026-11-27T12:30:05Z
  }
  const s = String(t ?? '').trim()
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?$/.test(s)) {
    throw new RangeError(`escpos-arabic: the invoice timestamp must be a Date or ISO 8601 text like 2026-11-27T12:30:05Z, got "${s}"`)
  }
  return s
}

function amount(v, what) {
  if (typeof v === 'number') {
    if (!Number.isFinite(v) || v < 0) throw new RangeError(`escpos-arabic: the ${what} must be a number of 0 or more`)
    return v.toFixed(2)
  }
  const s = String(v ?? '').trim()
  if (!/^\d+(\.\d+)?$/.test(s)) throw new RangeError(`escpos-arabic: the ${what} must be digits with an optional decimal point, like 1150.00; got "${s}"`)
  return s
}
