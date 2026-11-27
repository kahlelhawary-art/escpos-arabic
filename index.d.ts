export type FontData = Uint8Array | ArrayBuffer | TypeFace
export type Align = 'start' | 'center' | 'end'
export type Direction = 'rtl' | 'ltr'

export interface ReceiptOptions {
  /** Main font (TTF/OTF bytes). WOFF/WOFF2 are not supported. */
  font: FontData
  /** Bold font. Without it, bold text is thickened by one dot. */
  boldFont?: FontData
  /** Fonts for characters the main font lacks, tried in order (e.g. a Latin font). */
  fallbackFonts?: FontData[]
  /** Bold versions of the fallback fonts. Defaults to `fallbackFonts`. */
  boldFallbackFonts?: FontData[]
  /** Print-head width in dots: 576 for 80 mm, 384 for 58 mm. Default 576. */
  width?: number | '58mm' | '80mm'
  /** Paragraph direction. Default `'rtl'`. */
  direction?: Direction
  /** Default text size in dots. Default 24. */
  size?: number
  /** Line height as a multiple of the size. Default 1.3. */
  lineHeight?: number
  /** Blank margin on both sides, in dots. Default 0. */
  padding?: number
  /** Print 0–9 as is, or as Arabic-Indic ٠–٩. Default `'latin'`. */
  digits?: 'latin' | 'arabic'
  /** Coverage a dot needs to be printed, 0–1. Lower prints heavier text. Default 0.45. */
  threshold?: number
}

export interface TextOptions {
  size?: number
  bold?: boolean
  align?: Align
  direction?: Direction
}

export interface RowOptions {
  /** Relative column widths. Default: equal. */
  widths?: number[]
  /** Per-column alignment. Default: first `start`, last `end`, others `center`. */
  align?: Align[]
  size?: number
  bold?: boolean
  /** Space between columns, in dots. Default 16. */
  gap?: number
  direction?: Direction
}

export interface RuleOptions {
  style?: 'solid' | 'dashed' | 'dotted' | 'double'
  /** Line thickness in dots. Default 2. */
  weight?: number
  /** Space above and below, in dots. Default 10. */
  space?: number
}

export interface QrOptions {
  /** Module size 1–16. Default 6. */
  size?: number
  ecc?: 'L' | 'M' | 'Q' | 'H'
  align?: Align
}

export interface BarcodeOptions {
  type?: 'CODE128' | 'EAN13' | 'EAN8' | 'CODE39' | 'UPCA'
  /** Bar height in dots. Default 80. */
  height?: number
  /** Module width 2–6. Default 2. */
  width?: number
  /** Print the human-readable text below. Default true. */
  text?: boolean
  align?: Align
}

/** Decoded pixels, 4 bytes (RGBA) per pixel — a browser `ImageData` fits. */
export interface RGBAImage {
  width: number
  height: number
  data: Uint8Array | Uint8ClampedArray
}

export interface ImageOptions {
  /** Width in dots; the height follows. Default: the image's own width, fitted to the paper. */
  width?: number
  /** Default `'center'`. */
  align?: Align
  /** How grey becomes dots. Default `'atkinson'`; `'none'` prints by `threshold`. */
  dither?: 'atkinson' | 'floyd-steinberg' | 'none'
  /**
   * When dithering: darkness (0–1) at or below which a pixel prints as paper, and at or
   * above which it prints solid black. Default `[0.1, 0.65]`, so dark brand colours print solid.
   */
  tones?: [number, number]
  /** With `dither: 'none'`: darkness (0–1) at which a dot is printed. Default 0.5. */
  threshold?: number
}

export declare class Bitmap {
  constructor(width: number)
  readonly width: number
  readonly height: number
  /** One byte per dot, 1 = black. */
  readonly data: Uint8Array
  ensure(height: number): void
  fillRect(x: number, y: number, w: number, h: number): void
  /** Rows packed 8 dots per byte, most significant bit first. */
  packRows(fromRow?: number, toRow?: number): Uint8Array
}

/** A loaded font. Reuse one across receipts to avoid parsing the font each time. */
export declare class TypeFace {
  constructor(data: Uint8Array | ArrayBuffer)
  readonly upem: number
  has(codePoint: number): boolean
}

export declare class FontStack {
  constructor(faces: TypeFace[])
  readonly faces: TypeFace[]
}

export declare class Receipt {
  constructor(options: ReceiptOptions)
  readonly width: number
  text(text: string | number, options?: TextOptions): this
  row(cells: Array<string | number>, options?: RowOptions): this
  rule(options?: RuleOptions): this
  /** An image (a logo, a stamp): PNG bytes or decoded RGBA pixels. Transparent areas stay blank. */
  image(source: Uint8Array | ArrayBuffer | RGBAImage, options?: ImageOptions): this
  space(dots?: number): this
  qr(data: string, options?: QrOptions): this
  barcode(data: string, options?: BarcodeOptions): this
  feed(lines?: number): this
  cut(options?: { feed?: number; partial?: boolean }): this
  drawer(pin?: 0 | 1): this
  /** ESC/POS bytes for the printer. `band`: rows per raster command (default 128). */
  encode(options?: { band?: number }): Uint8Array
  /** The receipt as one bitmap; QR codes and barcodes appear as labelled frames. */
  toBitmap(): Bitmap
  /** A PNG preview (1-bit). */
  toPNG(): Uint8Array
}

export declare function createReceipt(options: ReceiptOptions): Receipt
/** Keep text left to right inside Arabic, exactly as typed (phone numbers, negative amounts, codes). */
export declare function ltr(text: string | number): string
/** Keep text right to left inside a left-to-right receipt. */
export declare function rtl(text: string | number): string
export declare function toArabicDigits(text: string): string
export interface ZatcaInvoice {
  /** Seller's name, as registered. At most 255 bytes in UTF-8 (about 127 Arabic letters). */
  seller: string
  /** Seller's VAT registration number, 15 digits. */
  vatNumber: string | number
  /** When the invoice was issued. A Date is written in UTC (`2026-11-27T09:30:00Z`); ISO 8601 text is used as given. */
  timestamp: Date | string
  /** Invoice total including VAT. Numbers get two decimals; text like `"1150.00"` is used as given. */
  total: number | string
  /** VAT total. */
  vat: number | string
}

/**
 * The QR text for a Saudi simplified tax invoice (ZATCA): seller, VAT number, time,
 * total and VAT as Base64 TLV. Print it with `.qr(zatcaQR({...}))`.
 */
export declare function zatcaQR(invoice: ZatcaInvoice): string
/** Decode a PNG (any colour type, bit depth, transparency or interlacing) to RGBA. Decode a logo once and reuse it. */
export declare function decodePNG(bytes: Uint8Array | ArrayBuffer): { width: number; height: number; data: Uint8Array }
export declare const PAPER: Readonly<{ '58mm': 384; '80mm': 576 }>
