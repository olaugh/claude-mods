// Writes a picture as a PNG, compressed here: the plugin's environment has no
// deflate, so this is one made for these pictures, whose colours run flat.
// Each byte is matched against the pixel before it and the row above, the
// matches and the rest in deflate's fixed Huffman codes: one quick pass, no
// search. Truecolour, 8 bits a channel, alpha kept when asked.

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10]
const ADLER_MODULUS = 65521
// The most bytes summed before Adler-32's sums must be reduced.
const ADLER_BLOCK = 5552
const MIN_MATCH = 3
const MAX_MATCH = 258
const END_OF_BLOCK = 256

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let crc = index
  for (let bit = 0; bit < 8; bit++) {
    crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1
  }
  return crc >>> 0
})

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (let index = 0; index < bytes.length; index++) {
    crc = CRC_TABLE[(crc ^ bytes[index]!) & 0xff]! ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function adler32(bytes: Uint8Array): number {
  let low = 1
  let high = 0
  for (let start = 0; start < bytes.length; start += ADLER_BLOCK) {
    const end = Math.min(bytes.length, start + ADLER_BLOCK)
    for (let index = start; index < end; index++) {
      low += bytes[index]!
      high += low
    }
    low %= ADLER_MODULUS
    high %= ADLER_MODULUS
  }
  return ((high << 16) | low) >>> 0
}

// A Huffman code goes in most significant bit first, the bits deflate packs
// least significant first: each code reversed once, here.
function reversed(code: number, bits: number): number {
  let out = 0
  for (let bit = 0; bit < bits; bit++) {
    out = (out << 1) | ((code >>> bit) & 1)
  }
  return out
}

// The fixed codes of the literal and length symbols, 0 to 287.
const SYMBOL_BITS = Uint8Array.from({ length: 288 }, (_, symbol) => (symbol < 144 ? 8 : symbol < 256 ? 9 : symbol < 280 ? 7 : 8))
const SYMBOL_CODES = Uint16Array.from({ length: 288 }, (_, symbol) =>
  reversed(
    symbol < 144 ? 0x30 + symbol : symbol < 256 ? 0x190 + symbol - 144 : symbol < 280 ? symbol - 256 : 0xc0 + symbol - 280,
    SYMBOL_BITS[symbol]!,
  ),
)

const LENGTH_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258]
const LENGTH_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0]
const DISTANCE_BASE = [
  1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289,
  16385, 24577,
]
const DISTANCE_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13]
// The farthest back a match may reach.
const WINDOW = 32768

// Each match length's code, looked up.
const LENGTH_CODE = new Uint8Array(MAX_MATCH + 1)
for (const [code, base] of LENGTH_BASE.entries()) {
  const last = code === LENGTH_BASE.length - 1 ? MAX_MATCH : base + (1 << LENGTH_EXTRA[code]!) - 1
  for (let length = base; length <= last; length++) {
    LENGTH_CODE[length] = code
  }
}

// A match distance as deflate writes it: its code, reversed, and the extra
// bits past the code's base.
function distanceParts(distance: number) {
  let code = 0
  while (code < DISTANCE_BASE.length - 1 && DISTANCE_BASE[code + 1]! <= distance) {
    code++
  }
  return { code: reversed(code, 5), extra: distance - DISTANCE_BASE[code]!, extraBits: DISTANCE_EXTRA[code]! }
}

/** `data` deflated in one block of fixed codes, a match sought only at
 * `near` and `above` bytes back: a pixel's width and a row's. */
function deflate(data: Uint8Array, near: number, above: number): Uint8Array {
  // At worst every byte a 9-bit literal.
  const out = new Uint8Array(Math.ceil((data.length * 9) / 8) + 64)
  let length = 0
  let buffer = 0
  let count = 0
  const write = (value: number, bits: number) => {
    buffer |= value << count
    count += bits
    while (count >= 8) {
      out[length++] = buffer & 0xff
      buffer >>>= 8
      count -= 8
    }
  }
  const writeSymbol = (symbol: number) => write(SYMBOL_CODES[symbol]!, SYMBOL_BITS[symbol]!)
  const candidates = [near, above].filter(distance => distance > 0 && distance <= WINDOW)
  const parts = candidates.map(distanceParts)

  write(1, 1) // the last block
  write(1, 2) // in fixed codes
  let at = 0
  while (at < data.length) {
    const limit = Math.min(MAX_MATCH, data.length - at)
    let best = 0
    let bestIndex = 0
    for (let index = 0; index < candidates.length && limit >= MIN_MATCH; index++) {
      const from = at - candidates[index]!
      if (from < 0) {
        continue
      }
      let matched = 0
      while (matched < limit && data[from + matched] === data[at + matched]) {
        matched++
      }
      if (matched > best) {
        best = matched
        bestIndex = index
      }
    }
    if (best >= MIN_MATCH) {
      const code = LENGTH_CODE[best]!
      writeSymbol(257 + code)
      write(best - LENGTH_BASE[code]!, LENGTH_EXTRA[code]!)
      const distance = parts[bestIndex]!
      write(distance.code, 5)
      write(distance.extra, distance.extraBits)
      at += best
    } else {
      writeSymbol(data[at]!)
      at++
    }
  }
  writeSymbol(END_OF_BLOCK)
  if (count > 0) {
    out[length++] = buffer & 0xff
  }
  return out.subarray(0, length)
}

function uint32(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff]
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typed = new Uint8Array(4 + data.length)
  typed.set([...type].map(char => char.charCodeAt(0)))
  typed.set(data, 4)
  const out = new Uint8Array(12 + data.length)
  out.set(uint32(data.length))
  out.set(typed, 4)
  out.set(uint32(crc32(typed)), 8 + data.length)
  return out
}

// A zlib stream: its header, the deflated data, the data's Adler-32.
function zlib(data: Uint8Array, near: number, above: number): Uint8Array {
  const deflated = deflate(data, near, above)
  const out = new Uint8Array(2 + deflated.length + 4)
  out.set([0x78, 0x01])
  out.set(deflated, 2)
  out.set(uint32(adler32(data)), 2 + deflated.length)
  return out
}

/** The PNG of an RGBA picture, its alpha dropped unless `hasAlpha`. */
export function encodePng(width: number, height: number, rgba: Uint8Array, hasAlpha = false): Uint8Array {
  const channels = hasAlpha ? 4 : 3
  const rowBytes = 1 + width * channels
  const raw = new Uint8Array(rowBytes * height)
  for (let row = 0; row < height; row++) {
    // Filter type 0 (none), then the row's pixels.
    let to = row * rowBytes + 1
    const end = (row + 1) * width * 4
    for (let from = row * width * 4; from < end; from += 4) {
      raw[to] = rgba[from]!
      raw[to + 1] = rgba[from + 1]!
      raw[to + 2] = rgba[from + 2]!
      if (hasAlpha) {
        raw[to + 3] = rgba[from + 3]!
      }
      to += channels
    }
  }
  // Colour type 6 is truecolour with alpha, 2 without.
  const header = new Uint8Array([...uint32(width), ...uint32(height), 8, hasAlpha ? 6 : 2, 0, 0, 0])
  const parts = [
    new Uint8Array(SIGNATURE),
    chunk('IHDR', header),
    chunk('IDAT', zlib(raw, channels, rowBytes)),
    chunk('IEND', new Uint8Array()),
  ]
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0))
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}
