// A pharmacy receipt with fictional data: a logo, Arabic and Latin mixed, columns, totals, a QR code.
// Writes pharmacy.png (preview) and pharmacy.bin (the bytes you send to the printer).
//   node examples/pharmacy.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import { createReceipt, ltr } from '../src/index.js'

const font = (p) => readFileSync(new URL(`../node_modules/@embedpdf/${p}`, import.meta.url))

const receipt = createReceipt({
  width: '80mm',
  font: font('fonts-arabic/fonts/NotoNaskhArabic-Regular.ttf'),
  boldFont: font('fonts-arabic/fonts/NotoNaskhArabic-Bold.ttf'),
  fallbackFonts: [font('fonts-latin/fonts/NotoSans-Regular.ttf')],
  boldFallbackFonts: [font('fonts-latin/fonts/NotoSans-Bold.ttf')],
  size: 24,
  padding: 8,
})

receipt
  .image(readFileSync(new URL('./logo.png', import.meta.url)), { width: 128 })
  .space(6)
  .text('صيدلية النور', { size: 44, bold: true, align: 'center' })
  .text('دمشق — شارع بغداد، بناء 12', { align: 'center' })
  .text(`هاتف: ${ltr('011 223 4455')}`, { align: 'center' })
  .rule()
  .row(['فاتورة رقم', '1042'], { widths: [1, 1] })
  .row(['التاريخ', '2026/11/26 — 14:35'], { widths: [1, 1.4] })
  .row(['الصيدلاني', 'د. سارة الحلبي'], { widths: [1, 1.4] })
  .rule()
  .row(['الصنف', 'الكمية', 'السعر'], { widths: [3, 1, 1.6], bold: true })
  .rule({ style: 'solid', weight: 1, space: 4 })
  .row(['Panadol Extra 500mg — 24 قرص', '2', '18,000'], { widths: [3, 1, 1.6] })
  .row(['شراب سعال للأطفال (100 مل)', '1', '12,500'], { widths: [3, 1, 1.6] })
  .row(['Vitamin C 1000 فوّار', '1', '9,750'], { widths: [3, 1, 1.6] })
  .row(['كمّامات طبية — علبة 50', '3', '15,000'], { widths: [3, 1, 1.6] })
  .rule()
  .row(['المجموع', '55,250 ل.س'], { widths: [1, 1] })
  .row(['الحسم 5%', `${ltr('-2,763')} ل.س`], { widths: [1, 1] })
  .row(['الإجمالي', '52,487 ل.س'], { widths: [1, 1], size: 32, bold: true })
  .rule({ style: 'double' })
  .text('الأدوية المصروفة بوصفة طبية لا تُستبدل ولا تُسترجع. يُرجى الاحتفاظ بالفاتورة.', { size: 21, align: 'center' })
  .space(8)
  .qr('https://example.com/receipt/1042', { size: 6 })
  .text('شكراً لزيارتكم — نتمنى لكم الشفاء', { align: 'center', bold: true })
  .cut()

writeFileSync(new URL('./pharmacy.png', import.meta.url), receipt.toPNG())
writeFileSync(new URL('./pharmacy.bin', import.meta.url), receipt.encode())
console.log('Wrote examples/pharmacy.png and examples/pharmacy.bin')
