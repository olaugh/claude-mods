// The board as SVG for the surfaces without an Image: Desktop, VS Code and
// the mobile app, which draws it in a web view. The layout of board.ts, each
// glyph its Fira Code outline as a path, defined once and placed with <use>,
// so no surface needs the font.

import { drawBoard, type Canvas } from './board'
import type { Play } from './sim'
import { PICTURE_HEIGHT, PICTURE_WIDTH, type Rgb } from './theme'
import { inkBox, walkOutline, type Font, type Outline } from './truetype'

function css(color: Rgb): string {
  return `rgb(${color.map(Math.round).join(',')})`
}

const round = (value: number) => Math.round(value * 10) / 10

// The outline as path data in font units, y up.
function pathData(outline: Outline): string {
  const parts: string[] = []
  walkOutline(outline, {
    moveTo: (x, y) => parts.push(`M${round(x)} ${round(y)}`),
    lineTo: (x, y) => parts.push(`L${round(x)} ${round(y)}`),
    quadTo: (controlX, controlY, x, y) => parts.push(`Q${round(controlX)} ${round(controlY)} ${round(x)} ${round(y)}`),
    close: () => parts.push('Z'),
  })
  return parts.join('')
}

function svgCanvas(font: Font, defs: Map<string, string>, body: string[]): Canvas {
  return {
    rect: (x, y, width, height, color) => {
      body.push(`<rect x="${round(x)}" y="${round(y)}" width="${round(width)}" height="${round(height)}" fill="${css(color)}"/>`)
    },
    diamond: (centerX, centerY, radius, color) => {
      const points = [
        [centerX, centerY - radius],
        [centerX + radius, centerY],
        [centerX, centerY + radius],
        [centerX - radius, centerY],
      ]
      body.push(`<polygon points="${points.map(point => point.map(round).join(',')).join(' ')}" fill="${css(color)}"/>`)
    },
    glyph: (char, size, isBold, inkLeft, baseline, color) => {
      const outline = font.outline(char.codePointAt(0) ?? 0, isBold)
      const scale = size / font.unitsPerEm
      const ink = inkBox(outline, scale)
      if (ink === null) {
        return
      }
      const id = `g${char.codePointAt(0)}${isBold ? 'b' : ''}`
      if (!defs.has(id)) {
        defs.set(id, `<path id="${id}" d="${pathData(outline)}"/>`)
      }
      // The pixel picture puts the ink's floored left edge at inkLeft.
      const originX = inkLeft - Math.floor(ink.minX)
      const transform = `translate(${round(originX)} ${round(baseline)}) scale(${scale.toFixed(5)} ${(-scale).toFixed(5)})`
      body.push(`<use href="#${id}" transform="${transform}" fill="${css(color)}"/>`)
    },
  }
}

export function boardSvg(font: Font, board: readonly string[] | null, rack: string, play: Play): string {
  const defs = new Map<string, string>()
  const body: string[] = []
  drawBoard(svgCanvas(font, defs, body), font, board, rack, play)
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${PICTURE_WIDTH} ${PICTURE_HEIGHT}" width="${PICTURE_WIDTH}" height="${PICTURE_HEIGHT}">` +
    `<defs>${[...defs.values()].join('')}</defs>${body.join('')}</svg>`
  )
}
