// Reads ESC/POS bytes the way a printer would, for the commands this library sends, and
// rebuilds the printed raster image. Written from the Epson command reference, separately
// from src/escpos.js, so tests compare two independent readings of the same bytes.
//
// Any byte that is not part of a known command is an error: a real printer would print
// it as a stray character.

const ESC = 0x1b
const GS = 0x1d
const hex = (n) => '0x' + n.toString(16).padStart(2, '0')

/**
 * @param {Uint8Array} bytes
 * @param {number} width print-head width in dots
 * @returns {{ rows: Uint8Array[], commands: string[] }} printed raster rows (1 = black) and the command log
 */
export function readEscPos(bytes, width) {
  const rows = []
  const commands = []
  let i = 0
  const need = (n, what) => {
    if (i + n > bytes.length) throw new Error(`${what} at byte ${i} is cut short`)
  }
  const fail = (what) => {
    throw new Error(`${what} at byte ${i}: a printer would print it as text`)
  }

  while (i < bytes.length) {
    const b = bytes[i]
    if (b === ESC) {
      need(2, 'ESC command')
      const c = bytes[i + 1]
      if (c === 0x40) { commands.push('init'); i += 2 } // ESC @
      else if (c === 0x61) { need(3, 'ESC a'); commands.push(`align ${['left', 'center', 'right'][bytes[i + 2]] ?? fail('bad ESC a value')}`); i += 3 }
      else if (c === 0x64) { need(3, 'ESC d'); commands.push(`feed ${bytes[i + 2]}`); i += 3 }
      else if (c === 0x70) { need(5, 'ESC p'); commands.push(`drawer ${bytes[i + 2]}`); i += 5 }
      else fail(`unknown command ESC ${hex(c)}`)
    } else if (b === GS) {
      need(2, 'GS command')
      const c = bytes[i + 1]
      if (c === 0x76) {
        // GS v 0 m xL xH yL yH d1…dk — raster bit image, k = (xL + xH·256) × (yL + yH·256)
        need(8, 'GS v 0')
        if (bytes[i + 2] !== 0x30) fail('GS v without 0')
        const mode = bytes[i + 3]
        const xBytes = bytes[i + 4] | (bytes[i + 5] << 8)
        const yDots = bytes[i + 6] | (bytes[i + 7] << 8)
        if (mode !== 0) throw new Error(`raster mode ${mode} prints at double size`)
        if (xBytes * 8 !== width) throw new Error(`raster is ${xBytes * 8} dots wide, the head is ${width}`)
        need(8 + xBytes * yDots, 'GS v 0 image data')
        for (let y = 0; y < yDots; y++) {
          const row = new Uint8Array(width)
          for (let x = 0; x < width; x++) row[x] = (bytes[i + 8 + y * xBytes + (x >> 3)] >> (7 - (x & 7))) & 1
          rows.push(row)
        }
        commands.push(`raster ${yDots}`)
        i += 8 + xBytes * yDots
      } else if (c === 0x28 && bytes[i + 2] === 0x6b) {
        // GS ( k pL pH cn fn … — 2D codes; the parameter count is pL + pH·256
        need(7, 'GS ( k')
        const p = bytes[i + 3] | (bytes[i + 4] << 8)
        need(5 + p, 'GS ( k data')
        if (bytes[i + 5] !== 0x31) fail('GS ( k for a code other than QR')
        commands.push(`qr ${String.fromCharCode(bytes[i + 6])}`)
        i += 5 + p
      } else if (c === 0x6b) {
        // GS k m n d1…dn (m = 65–73)
        need(4, 'GS k')
        const m = bytes[i + 2]
        if (m < 65 || m > 73) fail(`GS k with the NUL-terminated form ${m}`)
        const n = bytes[i + 3]
        need(4 + n, 'GS k data')
        commands.push(`barcode ${m}`)
        i += 4 + n
      } else if (c === 0x68 || c === 0x77 || c === 0x48) {
        need(3, `GS ${hex(c)}`) // barcode height, module width, text position
        i += 3
      } else if (c === 0x56) {
        need(3, 'GS V')
        const m = bytes[i + 2]
        if (m === 65 || m === 66) { need(4, 'GS V'); commands.push(`cut ${m === 66 ? 'partial' : 'full'}`); i += 4 }
        else if (m === 0 || m === 1 || m === 48 || m === 49) { commands.push('cut'); i += 3 }
        else fail(`bad GS V mode ${m}`)
      } else fail(`unknown command GS ${hex(c)}`)
    } else fail(`stray byte ${hex(b)}`)
  }
  return { rows, commands }
}
