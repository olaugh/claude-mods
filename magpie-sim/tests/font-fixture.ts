// A tiny TrueType font for the tests, which have no file system to read the
// real one from. 1000 units to the em; '0'-'9' and 'A'-'Z' are a 400 x 700
// rectangle, except 'O' (one contour of off-curve points only: a rounded
// box) and 'Q' (a composite: the rectangle moved 50 units right).

const UNITS_PER_EM = 1000

type Point = [x: number, y: number, isOnCurve: boolean]

function simpleGlyph(contours: Point[][]): number[] {
  const points = contours.flat()
  const xs = points.map(point => point[0])
  const ys = points.map(point => point[1])
  const words = [contours.length, Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
  let end = -1
  for (const contour of contours) {
    end += contour.length
    words.push(end)
  }
  words.push(0) // no instructions
  const bytes = words.flatMap(word => [(word >> 8) & 0xff, word & 0xff])
  // One flag a point, coordinates as 16-bit deltas.
  bytes.push(...points.map(point => (point[2] ? 0x01 : 0x00)))
  for (const axis of [0, 1] as const) {
    let previous = 0
    for (const point of points) {
      const delta = point[axis] - previous
      bytes.push((delta >> 8) & 0xff, delta & 0xff)
      previous = point[axis]
    }
  }
  return bytes
}

function compositeGlyph(component: number, dx: number, dy: number): number[] {
  // Two 16-bit arguments that are x and y offsets, one component.
  const words = [-1 & 0xffff, 0, 0, 0, 0, 0x0001 | 0x0002, component, dx, dy]
  return words.flatMap(word => [(word >> 8) & 0xff, word & 0xff])
}

class Writer {
  bytes: number[] = []
  u16(value: number) {
    this.bytes.push((value >> 8) & 0xff, value & 0xff)
  }
  u32(value: number) {
    this.u16((value >>> 16) & 0xffff)
    this.u16(value & 0xffff)
  }
}

export function fixtureFont(): Uint8Array {
  const rectangle: Point[] = [[100, 0, true], [100, 700, true], [500, 700, true], [500, 0, true]]
  const rounded: Point[] = [[100, 0, false], [100, 700, false], [500, 700, false], [500, 0, false]]
  const glyphs = [[], simpleGlyph([rectangle]), compositeGlyph(1, 50, 0), simpleGlyph([rounded])]

  const glyf: number[] = []
  const loca = new Writer()
  for (const glyph of glyphs) {
    loca.u32(glyf.length)
    glyf.push(...glyph)
    while (glyf.length % 4 !== 0) {
      glyf.push(0)
    }
  }
  loca.u32(glyf.length)

  const head = new Writer()
  for (let at = 0; at < 18; at += 2) {
    head.u16(0)
  }
  head.u16(UNITS_PER_EM)
  while (head.bytes.length < 50) {
    head.u16(0)
  }
  head.u16(1) // long loca offsets
  head.u16(0)

  const maxp = new Writer()
  maxp.u32(0x00005000)
  maxp.u16(glyphs.length)

  // cmap format 4: '0' to 'Z' through a glyph array, then the closing segment.
  const first = '0'.charCodeAt(0)
  const last = 'Z'.charCodeAt(0)
  const glyphIds: number[] = []
  for (let code = first; code <= last; code++) {
    const char = String.fromCharCode(code)
    glyphIds.push(char === 'O' ? 3 : char === 'Q' ? 2 : /[0-9A-Z]/.test(char) ? 1 : 0)
  }
  const subtable = new Writer()
  subtable.u16(4)
  subtable.u16(16 + 8 * 2 + glyphIds.length * 2)
  subtable.u16(0)
  subtable.u16(4) // two segments
  subtable.u16(0)
  subtable.u16(0)
  subtable.u16(0)
  subtable.u16(last)
  subtable.u16(0xffff)
  subtable.u16(0)
  subtable.u16(first)
  subtable.u16(0xffff)
  subtable.u16(0)
  subtable.u16(1)
  subtable.u16(4) // from this word to the glyph array
  subtable.u16(0)
  for (const glyphId of glyphIds) {
    subtable.u16(glyphId)
  }
  const cmap = new Writer()
  cmap.u16(0)
  cmap.u16(1)
  cmap.u16(3)
  cmap.u16(1)
  cmap.u32(12)
  cmap.bytes.push(...subtable.bytes)

  const tables: [string, number[]][] = [
    ['cmap', cmap.bytes],
    ['glyf', glyf],
    ['head', head.bytes],
    ['loca', loca.bytes],
    ['maxp', maxp.bytes],
  ]
  const font = new Writer()
  font.u32(0x00010000)
  font.u16(tables.length)
  font.u16(0)
  font.u16(0)
  font.u16(0)
  let offset = 12 + tables.length * 16
  for (const [tag, bytes] of tables) {
    font.bytes.push(...[...tag].map(char => char.charCodeAt(0)))
    font.u32(0)
    font.u32(offset)
    font.u32(bytes.length)
    offset += bytes.length
  }
  for (const [, bytes] of tables) {
    font.bytes.push(...bytes)
  }
  return new Uint8Array(font.bytes)
}
