// A sim's results as one picture for a phone, where no pane draws: a title,
// the board with a play on it, and the top plays in large rows, each spelled
// in tiles. Drawn with the board's pixel canvas, sent as a PNG.

import { drawBoard, drawTile, glyphInk, tileColors, type Canvas } from './board'
import { pixelCanvas, type Picture } from './draw'
import { playTiles, resultText, type Play, type Sim } from './sim'
import { BACKGROUND, LABEL, PICTURE_HEIGHT, PICTURE_WIDTH, PREVIEW_BG, SQUARE, TILE_BG, type Rgb } from './theme'
import type { Font } from './truetype'

// Fira Code's advance: 1200 of its 1950 units to the em, every glyph.
const ADVANCE_EM = 1200 / 1950
const MARGIN = 24
const TITLE_SIZE = 26
const SUBTITLE_SIZE = 18
const TEXT_SIZE = 22
const ROW_HEIGHT = SQUARE + 6
const TILE_STEP = SQUARE + 3
const COLUMN_GAP = 16
// The plays the picture lists; a phone shows no more legibly.
export const CARD_ROWS = 10
const MIN_WIDTH = 720
const TEXT: Rgb = [220, 220, 220]
// Behind the row whose play the board shows.
const PICKED_ROW: Rgb = [28, 40, 32]

type CardColumn = { title: string; cell: (play: Play) => string }

const signed = (value: number, digits: number) => (value > 0 ? '+' : '') + value.toFixed(digits)

// The numbers a phone needs: the table's main columns.
const SIM_COLUMNS: readonly CardColumn[] = [
  { title: 'Sc', cell: play => String(play.score) },
  { title: 'Win%', cell: play => play.winPct.toFixed(1) },
  { title: 'Eq', cell: play => signed(play.equity, 1) },
]
const ENDGAME_COLUMNS: readonly CardColumn[] = [
  { title: 'Sc', cell: play => String(play.score) },
  { title: 'Result', cell: play => resultText(play.result) },
  { title: 'Net', cell: play => signed(play.net ?? 0, 0) },
]

// Each glyph placed by its advance, as a monospace font sets it.
function drawText(canvas: Canvas, font: Font, text: string, x: number, baseline: number, size: number, color: Rgb, isBold = false) {
  const advance = size * ADVANCE_EM
  for (const [index, char] of [...text].entries()) {
    const ink = glyphInk(font, char, size, isBold)
    if (ink !== null) {
      canvas.glyph(char, size, isBold, x + index * advance + Math.floor(ink.minX), baseline, color)
    }
  }
}

const textWidth = (text: string, size: number) => Math.ceil([...text].length * size * ADVANCE_EM)

// Draws onto `canvas` moved right and down.
function shifted(canvas: Canvas, dx: number, dy: number): Canvas {
  return {
    rect: (x, y, width, height, color) => canvas.rect(x + dx, y + dy, width, height, color),
    diamond: (centerX, centerY, radius, color) => canvas.diamond(centerX + dx, centerY + dy, radius, color),
    glyph: (char, size, isBold, inkLeft, baseline, color) => canvas.glyph(char, size, isBold, inkLeft + dx, baseline + dy, color),
  }
}

/** The picture of `sim`, the board showing `shown`, under `title` and
 * `subtitle`. */
export function cardPicture(font: Font, sim: Sim, shown: Play, title: string, subtitle: string): Picture {
  const plays = sim.plays.slice(0, CARD_ROWS)
  const columns = sim.kind === 'endgame' ? ENDGAME_COLUMNS : SIM_COLUMNS
  const spelled = plays.map(playTiles)
  const rankWidth = textWidth(String(plays.length), TEXT_SIZE) + textWidth(' ', TEXT_SIZE)
  const labelWidth = Math.max(...spelled.map(play => textWidth(play.label, TEXT_SIZE)), textWidth('Play', TEXT_SIZE))
  const slots = Math.max(1, ...spelled.map(play => play.tiles.length))
  const widths = columns.map(column =>
    Math.max(textWidth(column.title, TEXT_SIZE), ...plays.map(play => textWidth(column.cell(play), TEXT_SIZE))),
  )
  const tilesAt = MARGIN + rankWidth + labelWidth + COLUMN_GAP
  const statsAt = tilesAt + slots * TILE_STEP + COLUMN_GAP
  const width = Math.max(
    MIN_WIDTH,
    statsAt + widths.reduce((total, columnWidth) => total + columnWidth + COLUMN_GAP, 0) + MARGIN,
    PICTURE_WIDTH + 2 * MARGIN,
  )
  const boardAt = MARGIN + TITLE_SIZE + SUBTITLE_SIZE + 2 * MARGIN
  const tableAt = boardAt + PICTURE_HEIGHT + MARGIN
  const height = tableAt + ROW_HEIGHT * (plays.length + 1) + MARGIN
  const picture: Picture = { width, height, pixels: new Uint8Array(width * height * 4) }
  const canvas = pixelCanvas(picture, font)

  canvas.rect(0, 0, width, height, BACKGROUND)
  drawText(canvas, font, title, MARGIN, MARGIN + TITLE_SIZE, TITLE_SIZE, TEXT, true)
  drawText(canvas, font, subtitle, MARGIN, MARGIN + TITLE_SIZE + SUBTITLE_SIZE + 12, SUBTITLE_SIZE, LABEL)
  drawBoard(shifted(canvas, Math.floor((width - PICTURE_WIDTH) / 2), boardAt), font, sim.board, sim.rack, shown)

  // The headings, then a row per play: rank, square, tiles, numbers right
  // aligned.
  const baselineIn = (top: number) => top + Math.floor(ROW_HEIGHT * 0.7)
  const drawNumbers = (cells: readonly string[], top: number, color: Rgb) => {
    let right = statsAt
    for (const [index, cell] of cells.entries()) {
      right += (widths[index] ?? 0) + COLUMN_GAP
      drawText(canvas, font, cell, right - COLUMN_GAP - textWidth(cell, TEXT_SIZE), baselineIn(top), TEXT_SIZE, color)
    }
  }
  drawText(canvas, font, '#', MARGIN, baselineIn(tableAt), TEXT_SIZE, LABEL)
  drawText(canvas, font, 'Play', MARGIN + rankWidth, baselineIn(tableAt), TEXT_SIZE, LABEL)
  drawNumbers(
    columns.map(column => column.title),
    tableAt,
    LABEL,
  )
  for (const [index, play] of plays.entries()) {
    const top = tableAt + ROW_HEIGHT * (index + 1)
    if (play.id === shown.id) {
      canvas.rect(MARGIN / 2, top, width - MARGIN, ROW_HEIGHT, PICKED_ROW)
    }
    drawText(canvas, font, String(play.rank), MARGIN, baselineIn(top), TEXT_SIZE, LABEL)
    drawText(canvas, font, spelled[index]?.label ?? '', MARGIN + rankWidth, baselineIn(top), TEXT_SIZE, TEXT)
    for (const [slot, { letter, isThrough }] of (spelled[index]?.tiles ?? []).entries()) {
      drawTile(canvas, font, tilesAt + slot * TILE_STEP, top + 3, {
        letter,
        ...tileColors(letter, isThrough ? TILE_BG : PREVIEW_BG),
        isBold: !isThrough,
        hasScore: false,
        isLarge: true,
      })
    }
    drawNumbers(
      columns.map(column => column.cell(play)),
      top,
      TEXT,
    )
  }
  return picture
}
