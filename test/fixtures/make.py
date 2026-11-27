"""Make the PNG fixtures for test/image.test.js, and the RGBA pixels each one should decode to.

Run with Python 3 and Pillow:  python test/fixtures/make.py

Pillow writes the common formats; a small encoder below writes what Pillow cannot
(Adam7 interlacing, every filter type, 2-bit grey, 16-bit RGB with a tRNS colour key).
Neither shares code with the JavaScript decoder, so the tests compare two independent readings.
"""
import os
import struct
import zlib

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
W, H = 37, 23  # odd sizes exercise partial bytes and partial interlace passes


def source():
    """An RGBA test picture: colour gradients, a dark disc, and alpha that varies."""
    px = []
    for y in range(H):
        for x in range(W):
            r = x * 255 // (W - 1)
            g = y * 255 // (H - 1)
            b = (x * 7 + y * 13) % 256
            a = 255 if x < W // 2 else (x * 31 + y * 17) % 256
            if (x - 18) ** 2 + (y - 11) ** 2 < 36:
                r, g, b = 20, 20, 20
            px.append((r, g, b, a))
    return px


def chunk(kind, body):
    return struct.pack('>I', len(body)) + kind + body + struct.pack('>I', zlib.crc32(kind + body) & 0xFFFFFFFF)


def paeth(a, b, c):
    p = a + b - c
    pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
    return a if pa <= pb and pa <= pc else b if pb <= pc else c


def filter_rows(rows, bpp):
    """Filter each row with a different type in turn (0–4), so the decoder meets all five."""
    out = bytearray()
    prev = bytes(len(rows[0])) if rows else b''
    for n, row in enumerate(rows):
        t = n % 5
        out.append(t)
        for i, v in enumerate(row):
            a = row[i - bpp] if i >= bpp else 0
            up = prev[i]
            c = prev[i - bpp] if i >= bpp else 0
            pred = [0, a, up, (a + up) // 2, paeth(a, up, c)][t]
            out.append((v - pred) & 0xFF)
        prev = row
    return bytes(out)


def pack(samples, depth):
    """Pack one row of samples at `depth` bits each, most significant bit first."""
    if depth == 8:
        return bytes(samples)
    if depth == 16:
        return b''.join(struct.pack('>H', s) for s in samples)
    out, acc, bits = bytearray(), 0, 0
    for s in samples:
        acc = (acc << depth) | s
        bits += depth
        if bits == 8:
            out.append(acc)
            acc, bits = 0, 0
    if bits:
        out.append(acc << (8 - bits))
    return bytes(out)


ADAM7 = [(0, 0, 8, 8), (4, 0, 8, 8), (0, 4, 4, 8), (2, 0, 4, 4), (0, 2, 2, 4), (1, 0, 2, 2), (0, 1, 1, 2)]


def write_png(path, pixels, color, depth, channels, interlace=False, extra=b''):
    """pixels: rows of per-pixel sample tuples, already at `depth`."""
    bpp = max(1, channels * depth // 8)
    data = b''
    passes = ADAM7 if interlace else [(0, 0, 1, 1)]
    for x0, y0, dx, dy in passes:
        rows = []
        for y in range(y0, H, dy):
            samples = [s for x in range(x0, W, dx) for s in pixels[y][x]]
            if samples:
                rows.append(pack(samples, depth))
        if rows:
            data += filter_rows(rows, bpp)
    ihdr = struct.pack('>IIBBBBB', W, H, depth, color, 0, 0, 1 if interlace else 0)
    with open(path, 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr) + extra + chunk(b'IDAT', zlib.compress(data, 9)) + chunk(b'IEND', b''))


def save_expected(name, rgba):
    with open(os.path.join(HERE, name + '.rgba'), 'wb') as f:
        f.write(rgba if isinstance(rgba, bytes) else bytes(v for p in rgba for v in p))


def main():
    src = source()
    rgba = Image.new('RGBA', (W, H))
    rgba.putdata(src)

    # Written by Pillow; the expected pixels are Pillow's own reading of the file.
    pillow = {
        'rgba8': rgba,
        'rgb8': rgba.convert('RGB'),
        'gray8': rgba.convert('L'),
        'graya8': rgba.convert('LA'),
        'gray1': rgba.convert('L').point(lambda v: 255 if v > 128 else 0).convert('1'),
    }
    pal = rgba.convert('RGB').quantize(colors=200)
    pillow['pal8-trns'] = pal
    pal16 = rgba.convert('RGB').quantize(colors=16)
    for name, im in pillow.items():
        path = os.path.join(HERE, name + '.png')
        if name == 'pal8-trns':
            im.save(path, transparency=3)
        else:
            im.save(path)
        save_expected(name, Image.open(path).convert('RGBA').tobytes())
    pal16_path = os.path.join(HERE, 'pal4.png')
    pal16.save(pal16_path, bits=4)
    with open(pal16_path, 'rb') as f:
        assert f.read(25)[24] == 4, 'Pillow did not write a 4-bit palette'
    save_expected('pal4', Image.open(pal16_path).convert('RGBA').tobytes())

    # Written by the encoder above; the expected pixels follow from the PNG specification.
    grid = [[src[y * W + x] for x in range(W)] for y in range(H)]

    write_png(os.path.join(HERE, 'adam7-rgba8.png'), grid, color=6, depth=8, channels=4, interlace=True)
    save_expected('adam7-rgba8', src)

    write_png(os.path.join(HERE, 'filters-rgba8.png'), grid, color=6, depth=8, channels=4)
    save_expected('filters-rgba8', src)

    gray2 = [[((r * 3 + g * 5) // 8 // 64,) for r, g, b, a in row] for row in grid]
    write_png(os.path.join(HERE, 'adam7-gray2.png'), gray2, color=0, depth=2, channels=1, interlace=True)
    save_expected('adam7-gray2', [(v * 85,) * 3 + (255,) for row in gray2 for (v,) in row])

    rgb16 = [[((r * 257) ^ x, g * 257, b * 257) for x, (r, g, b, a) in enumerate(row)] for row in grid]
    key = rgb16[11][18]  # a pixel inside the dark disc becomes the transparent colour
    trns = chunk(b'tRNS', struct.pack('>HHH', *key))
    write_png(os.path.join(HERE, 'rgb16-trns.png'), rgb16, color=2, depth=16, channels=3, extra=trns)
    save_expected('rgb16-trns', [(r >> 8, g >> 8, b >> 8, 0 if (r, g, b) == key else 255) for row in rgb16 for (r, g, b) in row])


if __name__ == '__main__':
    main()
