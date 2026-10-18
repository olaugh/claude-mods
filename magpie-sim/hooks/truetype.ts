// Reads glyph outlines from a TrueType font and rasterizes them, with no
// dependencies: the tables a Latin monospace font needs (cmap formats 4 and
// 12, loca, glyf with composite glyphs, hmtx), FreeType's outline
// emboldening, and an exact-coverage scanline rasterizer (font-rs's).

export type OutlinePoint = { x: number; y: number; isOnCurve: boolean }
/** Contours in font units, y up. */
export type Outline = readonly (readonly OutlinePoint[])[]

export type InkBox = { minX: number; maxX: number; minY: number; maxY: number }

/** Coverage, 0 to 1, of `width * height` pixels whose top-left corner is
 * `left` right of the pen and `top` above the baseline. */
export type GlyphBitmap = { width: number; height: number; left: number; top: number; alpha: Float32Array }

export type Font = {
  unitsPerEm: number
  /** The glyph's outline, emboldened as FreeType's FT_GlyphSlot_Embolden
   * does when `isBold`; empty for a codepoint the font lacks. */
  outline: (codepoint: number, isBold: boolean) => Outline
}

const MAX_COMPOSITE_DEPTH = 8
// FT_GlyphSlot_Embolden thickens strokes by a 24th of the em.
const EMBOLDEN_EM_FRACTION = 1 / 24

export function parseFont(bytes: Uint8Array): Font {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const tables = new Map<string, number>()
  const tableCount = view.getUint16(4)
  for (let index = 0; index < tableCount; index++) {
    const at = 12 + index * 16
    const tag = String.fromCharCode(view.getUint8(at), view.getUint8(at + 1), view.getUint8(at + 2), view.getUint8(at + 3))
    tables.set(tag, view.getUint32(at + 8))
  }
  const table = (tag: string): number => {
    const at = tables.get(tag)
    if (at === undefined) {
      throw new Error(`the font has no ${tag} table (only TrueType outlines are read)`)
    }
    return at
  }
  const head = table('head')
  const loca = table('loca')
  const glyf = table('glyf')
  const unitsPerEm = view.getUint16(head + 18)
  const isLongLoca = view.getInt16(head + 50) === 1
  const glyphCount = view.getUint16(table('maxp') + 4)
  const glyphIndexOf = cmapLookup(view, table('cmap'))

  const glyphOffset = (glyph: number): number =>
    isLongLoca ? view.getUint32(loca + glyph * 4) : view.getUint16(loca + glyph * 2) * 2

  const glyphOutline = (glyph: number, depth: number): OutlinePoint[][] => {
    if (glyph >= glyphCount || depth > MAX_COMPOSITE_DEPTH) {
      return []
    }
    const start = glyphOffset(glyph)
    if (glyphOffset(glyph + 1) === start) {
      return []
    }
    const at = glyf + start
    const contourCount = view.getInt16(at)
    return contourCount >= 0 ? simpleGlyph(view, at, contourCount) : compositeGlyph(view, at, depth, glyphOutline)
  }

  const outlines = new Map<string, Outline>()
  return {
    unitsPerEm,
    outline: (codepoint, isBold) => {
      const key = `${codepoint}:${isBold}`
      let outline = outlines.get(key)
      if (outline === undefined) {
        const plain = glyphOutline(glyphIndexOf(codepoint), 0)
        outline = isBold ? embolden(plain, unitsPerEm * EMBOLDEN_EM_FRACTION) : plain
        outlines.set(key, outline)
      }
      return outline
    },
  }
}

// The glyph index lookup of the font's Unicode cmap: format 12 where the
// font has one, else format 4.
function cmapLookup(view: DataView, cmap: number): (codepoint: number) => number {
  let format4: number | undefined
  let format12: number | undefined
  const recordCount = view.getUint16(cmap + 2)
  for (let index = 0; index < recordCount; index++) {
    const at = cmap + 4 + index * 8
    const platform = view.getUint16(at)
    const encoding = view.getUint16(at + 2)
    const subtable = cmap + view.getUint32(at + 4)
    const isUnicode = platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10))
    if (!isUnicode) {
      continue
    }
    const format = view.getUint16(subtable)
    if (format === 12) {
      format12 ??= subtable
    } else if (format === 4) {
      format4 ??= subtable
    }
  }
  if (format12 !== undefined) {
    const table = format12
    const groupCount = view.getUint32(table + 12)
    return codepoint => {
      for (let index = 0; index < groupCount; index++) {
        const at = table + 16 + index * 12
        const first = view.getUint32(at)
        if (codepoint >= first && codepoint <= view.getUint32(at + 4)) {
          return view.getUint32(at + 8) + codepoint - first
        }
      }
      return 0
    }
  }
  if (format4 !== undefined) {
    const table = format4
    const segmentCount = view.getUint16(table + 6) / 2
    const ends = table + 14
    const starts = ends + segmentCount * 2 + 2
    const deltas = starts + segmentCount * 2
    const rangeOffsets = deltas + segmentCount * 2
    return codepoint => {
      for (let index = 0; index < segmentCount; index++) {
        if (codepoint > view.getUint16(ends + index * 2)) {
          continue
        }
        const first = view.getUint16(starts + index * 2)
        if (codepoint < first) {
          return 0
        }
        const delta = view.getInt16(deltas + index * 2)
        const rangeOffsetAt = rangeOffsets + index * 2
        const rangeOffset = view.getUint16(rangeOffsetAt)
        if (rangeOffset === 0) {
          return (codepoint + delta) & 0xffff
        }
        const glyph = view.getUint16(rangeOffsetAt + rangeOffset + (codepoint - first) * 2)
        return glyph === 0 ? 0 : (glyph + delta) & 0xffff
      }
      return 0
    }
  }
  throw new Error('the font has no Unicode cmap of format 4 or 12')
}

function simpleGlyph(view: DataView, at: number, contourCount: number): OutlinePoint[][] {
  const ends: number[] = []
  for (let index = 0; index < contourCount; index++) {
    ends.push(view.getUint16(at + 10 + index * 2))
  }
  const pointCount = (ends[ends.length - 1] ?? -1) + 1
  const instructionLength = view.getUint16(at + 10 + contourCount * 2)
  let cursor = at + 12 + contourCount * 2 + instructionLength

  const flags: number[] = []
  while (flags.length < pointCount) {
    const flag = view.getUint8(cursor++)
    flags.push(flag)
    if (flag & 0x08) {
      for (let repeat = view.getUint8(cursor++); repeat > 0; repeat--) {
        flags.push(flag)
      }
    }
  }
  const readCoordinates = (shortBit: number, sameBit: number): number[] => {
    const values: number[] = []
    let value = 0
    for (const flag of flags.slice(0, pointCount)) {
      if (flag & shortBit) {
        const delta = view.getUint8(cursor++)
        value += flag & sameBit ? delta : -delta
      } else if (!(flag & sameBit)) {
        value += view.getInt16(cursor)
        cursor += 2
      }
      values.push(value)
    }
    return values
  }
  const xs = readCoordinates(0x02, 0x10)
  const ys = readCoordinates(0x04, 0x20)

  const contours: OutlinePoint[][] = []
  let first = 0
  for (const end of ends) {
    const contour: OutlinePoint[] = []
    for (let index = first; index <= end; index++) {
      contour.push({ x: xs[index] ?? 0, y: ys[index] ?? 0, isOnCurve: ((flags[index] ?? 0) & 0x01) !== 0 })
    }
    contours.push(contour)
    first = end + 1
  }
  return contours
}

function compositeGlyph(
  view: DataView,
  at: number,
  depth: number,
  glyphOutline: (glyph: number, depth: number) => OutlinePoint[][],
): OutlinePoint[][] {
  const contours: OutlinePoint[][] = []
  const f2dot14 = (offset: number) => view.getInt16(offset) / 16384
  let cursor = at + 10
  let flags: number
  do {
    flags = view.getUint16(cursor)
    const component = view.getUint16(cursor + 2)
    cursor += 4
    let first: number
    let second: number
    if (flags & 0x0001) {
      first = view.getInt16(cursor)
      second = view.getInt16(cursor + 2)
      cursor += 4
    } else {
      first = view.getInt8(cursor)
      second = view.getInt8(cursor + 1)
      cursor += 2
    }
    // Offsets only: components placed by matching points are left where
    // they are, which no Latin letter or digit needs.
    const [dx, dy] = flags & 0x0002 ? [first, second] : [0, 0]
    let [a, b, c, d] = [1, 0, 0, 1]
    if (flags & 0x0008) {
      a = d = f2dot14(cursor)
      cursor += 2
    } else if (flags & 0x0040) {
      a = f2dot14(cursor)
      d = f2dot14(cursor + 2)
      cursor += 4
    } else if (flags & 0x0080) {
      a = f2dot14(cursor)
      b = f2dot14(cursor + 2)
      c = f2dot14(cursor + 4)
      d = f2dot14(cursor + 6)
      cursor += 8
    }
    for (const contour of glyphOutline(component, depth + 1)) {
      contours.push(contour.map(point => ({
        x: a * point.x + c * point.y + dx,
        y: b * point.x + d * point.y + dy,
        isOnCurve: point.isOnCurve,
      })))
    }
  } while (flags & 0x0020)
  return contours
}

function signedArea(outline: Outline): number {
  let area = 0
  for (const contour of outline) {
    for (const [index, point] of contour.entries()) {
      const next = contour[(index + 1) % contour.length] ?? point
      area += point.x * next.y - next.x * point.y
    }
  }
  return area / 2
}

// FreeType's FT_Outline_EmboldenXY with equal strengths: each point moves
// out along the bisector of its two edges, so every stroke thickens by
// `strength` and corners keep their shape.
export function embolden(outline: Outline, strength: number): Outline {
  const half = strength / 2
  // TrueType outer contours run clockwise (negative area with y up).
  const isClockwise = signedArea(outline) < 0
  return outline.map(contour => {
    const points = contour.filter((point, index) => {
      const previous = contour[(index - 1 + contour.length) % contour.length]
      return previous === undefined || previous.x !== point.x || previous.y !== point.y || contour.length === 1
    })
    return points.map((point, index) => {
      const previous = points[(index - 1 + points.length) % points.length] ?? point
      const next = points[(index + 1) % points.length] ?? point
      const inLength = Math.hypot(point.x - previous.x, point.y - previous.y)
      const outLength = Math.hypot(next.x - point.x, next.y - point.y)
      if (inLength === 0 || outLength === 0) {
        return point
      }
      const inX = (point.x - previous.x) / inLength
      const inY = (point.y - previous.y) / inLength
      const outX = (next.x - point.x) / outLength
      const outY = (next.y - point.y) / outLength
      const cosine = inX * outX + inY * outY
      // A turn sharper than about 160 degrees would spike: leave it.
      if (cosine <= -0.9375) {
        return point
      }
      const d = cosine + 1
      let shiftX = inY + outY
      let shiftY = inX + outX
      let q = outX * inY - outY * inX
      if (isClockwise) {
        shiftX = -shiftX
        q = -q
      } else {
        shiftY = -shiftY
      }
      // Shorter than the strength, an edge limits the shift, so thin
      // segments do not cross over.
      const limit = Math.min(inLength, outLength)
      const scale = half * q <= limit * d ? half / d : limit / q
      return { x: point.x + shiftX * scale, y: point.y + shiftY * scale, isOnCurve: point.isOnCurve }
    })
  })
}

export type PathSink = {
  moveTo: (x: number, y: number) => void
  lineTo: (x: number, y: number) => void
  quadTo: (controlX: number, controlY: number, x: number, y: number) => void
  close: () => void
}

// Walks each contour as lines and quadratic curves, adding the on-curve
// point TrueType implies between two off-curve points.
export function walkOutline(outline: Outline, sink: PathSink) {
  for (const contour of outline) {
    const expanded: OutlinePoint[] = []
    for (const [index, point] of contour.entries()) {
      const next = contour[(index + 1) % contour.length] ?? point
      expanded.push(point)
      if (!point.isOnCurve && !next.isOnCurve) {
        expanded.push({ x: (point.x + next.x) / 2, y: (point.y + next.y) / 2, isOnCurve: true })
      }
    }
    const first = expanded.findIndex(point => point.isOnCurve)
    if (first < 0) {
      continue
    }
    const ordered = [...expanded.slice(first), ...expanded.slice(0, first)]
    const start = ordered[0]
    if (start === undefined) {
      continue
    }
    sink.moveTo(start.x, start.y)
    for (let index = 1; index <= ordered.length; ) {
      const point = ordered[index % ordered.length] ?? start
      if (point.isOnCurve) {
        sink.lineTo(point.x, point.y)
        index += 1
      } else {
        const end = ordered[(index + 1) % ordered.length] ?? start
        sink.quadTo(point.x, point.y, end.x, end.y)
        index += 2
      }
    }
    sink.close()
  }
}

export function inkBox(outline: Outline, scale: number): InkBox | null {
  let box: InkBox | null = null
  for (const contour of outline) {
    for (const point of contour) {
      const x = point.x * scale
      const y = point.y * scale
      if (box === null) {
        box = { minX: x, maxX: x, minY: y, maxY: y }
      } else {
        box.minX = Math.min(box.minX, x)
        box.maxX = Math.max(box.maxX, x)
        box.minY = Math.min(box.minY, y)
        box.maxY = Math.max(box.maxY, y)
      }
    }
  }
  return box
}

// Adds a line's signed area to the cells it crosses (font-rs's
// accumulation rasterizer); a running sum over each row then gives every
// pixel's exact coverage.
function accumulateLine(cells: Float32Array, width: number, height: number, x0: number, y0: number, x1: number, y1: number) {
  if (Math.abs(y0 - y1) <= 1e-9) {
    return
  }
  let direction = 1
  if (y0 > y1) {
    direction = -1
    ;[x0, y0, x1, y1] = [x1, y1, x0, y0]
  }
  const dxdy = (x1 - x0) / (y1 - y0)
  let x = x0
  if (y0 < 0) {
    x -= y0 * dxdy
  }
  const rowEnd = Math.min(height, Math.ceil(y1))
  for (let row = Math.max(0, Math.floor(y0)); row < rowEnd; row++) {
    const rowStart = row * width
    const dy = Math.min(row + 1, y1) - Math.max(row, y0)
    const xNext = x + dxdy * dy
    const d = dy * direction
    const left = Math.min(x, xNext)
    const right = Math.max(x, xNext)
    const leftFloor = Math.floor(left)
    const rightCeil = Math.ceil(right)
    const at = rowStart + leftFloor
    if (at >= 0) {
      if (rightCeil <= leftFloor + 1) {
        const middle = 0.5 * (x + xNext) - leftFloor
        cells[at] = (cells[at] ?? 0) + d - d * middle
        cells[at + 1] = (cells[at + 1] ?? 0) + d * middle
      } else {
        const slope = 1 / (right - left)
        const leftFraction = left - leftFloor
        const a0 = 0.5 * slope * (1 - leftFraction) * (1 - leftFraction)
        const rightFraction = right - rightCeil + 1
        const am = 0.5 * slope * rightFraction * rightFraction
        cells[at] = (cells[at] ?? 0) + d * a0
        if (rightCeil === leftFloor + 2) {
          cells[at + 1] = (cells[at + 1] ?? 0) + d * (1 - a0 - am)
        } else {
          const a1 = slope * (1.5 - leftFraction)
          cells[at + 1] = (cells[at + 1] ?? 0) + d * (a1 - a0)
          for (let col = leftFloor + 2; col < rightCeil - 1; col++) {
            cells[rowStart + col] = (cells[rowStart + col] ?? 0) + d * slope
          }
          const a2 = a1 + (rightCeil - leftFloor - 3) * slope
          cells[rowStart + rightCeil - 1] = (cells[rowStart + rightCeil - 1] ?? 0) + d * (1 - a2 - am)
        }
        cells[rowStart + rightCeil] = (cells[rowStart + rightCeil] ?? 0) + d * am
      }
    }
    x = xNext
  }
}

export function rasterize(outline: Outline, scale: number): GlyphBitmap | null {
  const box = inkBox(outline, scale)
  if (box === null) {
    return null
  }
  const left = Math.floor(box.minX)
  const top = Math.ceil(box.maxY)
  const width = Math.ceil(box.maxX) - left
  const height = top - Math.floor(box.minY)
  if (width <= 0 || height <= 0) {
    return null
  }
  // One spare cell past the end: a line on the right edge adds to it.
  const cells = new Float32Array(width * height + 4)
  let penX = 0
  let penY = 0
  let startX = 0
  let startY = 0
  const toX = (x: number) => x * scale - left
  const toY = (y: number) => top - y * scale
  const line = (x: number, y: number) => {
    accumulateLine(cells, width, height, penX, penY, x, y)
    penX = x
    penY = y
  }
  walkOutline(outline, {
    moveTo: (x, y) => {
      penX = startX = toX(x)
      penY = startY = toY(y)
    },
    lineTo: (x, y) => line(toX(x), toY(y)),
    quadTo: (controlX, controlY, x, y) => {
      const [x0, y0] = [penX, penY]
      const [x1, y1] = [toX(controlX), toY(controlY)]
      const [x2, y2] = [toX(x), toY(y)]
      // Enough straight pieces that none strays a visible fraction of a
      // pixel from the curve.
      const deviationX = x0 - 2 * x1 + x2
      const deviationY = y0 - 2 * y1 + y2
      const deviation = deviationX * deviationX + deviationY * deviationY
      const pieces = deviation < 0.333 ? 1 : 1 + Math.floor(Math.sqrt(Math.sqrt(3 * deviation)))
      for (let piece = 1; piece <= pieces; piece++) {
        const t = piece / pieces
        const u = 1 - t
        line(u * u * x0 + 2 * u * t * x1 + t * t * x2, u * u * y0 + 2 * u * t * y1 + t * t * y2)
      }
    },
    close: () => line(startX, startY),
  })
  const alpha = new Float32Array(width * height)
  let sum = 0
  for (let index = 0; index < alpha.length; index++) {
    sum += cells[index] ?? 0
    alpha[index] = Math.min(1, Math.abs(sum))
  }
  return { width, height, left, top, alpha }
}
