// Writes a picture as a PNG with nothing compressed: the plugin's environment
// has no deflate, so the image data goes in stored blocks, and macOS's sips
// compresses the file afterwards. Truecolour, 8 bits a channel, no alpha.

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10]
// The most a stored deflate block holds.
const STORED_BLOCK = 65535
const ADLER_MODULUS = 65521

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let crc = index
  for (let bit = 0; bit < 8; bit++) {
    crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1
  }
  return crc >>> 0
})

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function adler32(bytes: Uint8Array): number {
  let low = 1
  let high = 0
  for (const byte of bytes) {
    low = (low + byte) % ADLER_MODULUS
    high = (high + low) % ADLER_MODULUS
  }
  return ((high << 16) | low) >>> 0
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

// A zlib stream of stored blocks.
function zlibStored(data: Uint8Array): Uint8Array {
  const blocks = Math.max(1, Math.ceil(data.length / STORED_BLOCK))
  const out = new Uint8Array(2 + blocks * 5 + data.length + 4)
  out.set([0x78, 0x01])
  let at = 2
  for (let block = 0; block < blocks; block++) {
    const piece = data.subarray(block * STORED_BLOCK, (block + 1) * STORED_BLOCK)
    out[at] = block === blocks - 1 ? 1 : 0
    out[at + 1] = piece.length & 0xff
    out[at + 2] = piece.length >>> 8
    out[at + 3] = ~piece.length & 0xff
    out[at + 4] = (~piece.length >>> 8) & 0xff
    out.set(piece, at + 5)
    at += 5 + piece.length
  }
  out.set(uint32(adler32(data)), at)
  return out
}

/** The PNG of an RGBA picture, its alpha dropped. */
export function encodePng(width: number, height: number, rgba: Uint8Array): Uint8Array {
  const rowBytes = 1 + width * 3
  const raw = new Uint8Array(rowBytes * height)
  for (let row = 0; row < height; row++) {
    // Filter type 0 (none), then the row's RGB.
    for (let col = 0; col < width; col++) {
      const from = (row * width + col) * 4
      const to = row * rowBytes + 1 + col * 3
      raw[to] = rgba[from] ?? 0
      raw[to + 1] = rgba[from + 1] ?? 0
      raw[to + 2] = rgba[from + 2] ?? 0
    }
  }
  const header = new Uint8Array([...uint32(width), ...uint32(height), 8, 2, 0, 0, 0])
  const parts = [new Uint8Array(SIGNATURE), chunk('IHDR', header), chunk('IDAT', zlibStored(raw)), chunk('IEND', new Uint8Array())]
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0))
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}
