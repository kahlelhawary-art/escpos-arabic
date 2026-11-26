// A minimal 1-bit grayscale PNG writer for previews. No dependencies, no compression
// library: the image data goes in stored (uncompressed) deflate blocks, which every
// PNG reader accepts. Works in Node and in browsers.

let CRC_TABLE
function crc32(bytes) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      CRC_TABLE[n] = c >>> 0
    }
  }
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function adler32(bytes) {
  let a = 1, b = 0
  for (let i = 0; i < bytes.length; i++) {
    a = (a + bytes[i]) % 65521
    b = (b + a) % 65521
  }
  return ((b << 16) | a) >>> 0
}

const u32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]

function chunk(type, data) {
  const body = new Uint8Array(4 + data.length)
  for (let i = 0; i < 4; i++) body[i] = type.charCodeAt(i)
  body.set(data, 4)
  const out = new Uint8Array(8 + data.length + 4)
  out.set(u32(data.length), 0)
  out.set(body, 4)
  out.set(u32(crc32(body)), 8 + data.length)
  return out
}

/**
 * @param {number} width
 * @param {number} height
 * @param {Uint8Array} packedBlackRows rows packed 8 dots per byte, 1 = black
 * @returns {Uint8Array}
 */
export function encodePNG(width, height, packedBlackRows) {
  const bpr = Math.ceil(width / 8)
  // Scanlines: filter byte 0, then pixels. In 1-bit grayscale PNG, 1 means white.
  const raw = new Uint8Array((bpr + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (bpr + 1)] = 0
    for (let x = 0; x < bpr; x++) raw[y * (bpr + 1) + 1 + x] = ~packedBlackRows[y * bpr + x] & 0xff
  }
  // zlib stream made of stored blocks (at most 65535 bytes each), written into one buffer.
  const MAX = 65535
  const nBlocks = Math.max(1, Math.ceil(raw.length / MAX))
  const zlib = new Uint8Array(2 + nBlocks * 5 + raw.length + 4)
  zlib[0] = 0x78
  zlib[1] = 0x01
  let o = 2
  for (let b = 0; b < nBlocks; b++) {
    const part = raw.subarray(b * MAX, Math.min(raw.length, (b + 1) * MAX))
    const len = part.length
    zlib[o++] = b === nBlocks - 1 ? 1 : 0
    zlib[o++] = len & 255
    zlib[o++] = len >> 8
    zlib[o++] = ~len & 255
    zlib[o++] = (~len >> 8) & 255
    zlib.set(part, o)
    o += len
  }
  zlib.set(u32(adler32(raw)), o)

  const ihdr = new Uint8Array([...u32(width), ...u32(height), 1, 0, 0, 0, 0])
  const parts = [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib), chunk('IEND', new Uint8Array(0))]
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let p = 0
  for (const part of parts) { out.set(part, p); p += part.length }
  return out
}
