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
export declare const PAPER: Readonly<{ '58mm': 384; '80mm': 576 }>
