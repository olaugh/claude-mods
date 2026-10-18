// Draws the board as RGBA pixels for the terminal's <Image>: the layout of
// board.ts, its glyphs rasterized from the font and blended in.

import { drawBoard, type Canvas } from './board'
import type { Play } from './sim'
import { PICTURE_HEIGHT, PICTURE_WIDTH, type Rgb } from './theme'
import { rasterize, type Font, type GlyphBitmap } from './truetype'

export type Picture = { width: number; height: number; pixels: Uint8Array }

// Rasterized glyphs by character, size and weight: a board draws the same
// few dozen many times.
const bitmaps = new Map<string, GlyphBitmap | null>()

function glyphBitmap(font: Font, char: string, size: number, isBold: boolean): GlyphBitmap | null {
  const key = `${char}:${size}:${isBold}`
  let bitmap = bitmaps.get(key)
  if (bitmap === undefined) {
    bitmap = rasterize(font.outline(char.codePointAt(0) ?? 0, isBold), size / font.unitsPerEm)
    bitmaps.set(key, bitmap)
  }
  return bitmap
}

function pixelCanvas(picture: Picture, font: Font): Canvas {
  const { width, height, pixels } = picture
  // Coordinates are rounded: a centred shape can land on a half pixel, and a
  // fractional index into the pixels writes nothing.
  const rect = (x: number, y: number, rectWidth: number, rectHeight: number, color: Rgb) => {
    const left = Math.max(0, Math.round(x))
    const right = Math.min(width, Math.round(x + rectWidth))
    const top = Math.max(0, Math.round(y))
    const bottom = Math.min(height, Math.round(y + rectHeight))
    for (let row = top; row < bottom; row++) {
      for (let at = (row * width + left) * 4, col = left; col < right; col++, at += 4) {
        pixels[at] = color[0]
        pixels[at + 1] = color[1]
        pixels[at + 2] = color[2]
        pixels[at + 3] = 255
      }
    }
  }
  return {
    rect,
    diamond: (centerX, centerY, radius, color) => {
      for (let dy = -radius; dy <= radius; dy++) {
        const halfWidth = radius - Math.abs(dy)
        rect(centerX - halfWidth, centerY + dy, halfWidth * 2 + 1, 1, color)
      }
    },
    glyph: (char, size, isBold, inkLeft, baseline, color) => {
      const bitmap = glyphBitmap(font, char, size, isBold)
      if (bitmap === null) {
        return
      }
      // The bitmap's own left edge is its ink's, floored.
      const x0 = Math.round(inkLeft)
      const y0 = Math.round(baseline) - bitmap.top
      for (let row = 0; row < bitmap.height; row++) {
        const y = y0 + row
        if (y < 0 || y >= height) {
          continue
        }
        for (let col = 0; col < bitmap.width; col++) {
          const x = x0 + col
          const coverage = bitmap.alpha[row * bitmap.width + col] ?? 0
          if (x < 0 || x >= width || coverage <= 0) {
            continue
          }
          const at = (y * width + x) * 4
          for (let channel = 0; channel < 3; channel++) {
            const under = pixels[at + channel] ?? 0
            pixels[at + channel] = Math.round(under + (color[channel]! - under) * coverage)
          }
        }
      }
    },
  }
}

export function boardPicture(font: Font, board: readonly string[] | null, rack: string, play: Play): Picture {
  const picture: Picture = {
    width: PICTURE_WIDTH,
    height: PICTURE_HEIGHT,
    pixels: new Uint8Array(PICTURE_WIDTH * PICTURE_HEIGHT * 4),
  }
  drawBoard(pixelCanvas(picture, font), font, board, rack, play)
  return picture
}
