// Lays out the board, the previewed play and the rack once, in Fira Code
// with the TUI's tile proportions (tui/pixel_compose.c), for both outputs:
// the terminal's pixels (draw.ts) and the other surfaces' SVG (svg.ts).

import { BOARD_DIM, COLUMN_LETTERS, premiumAt, TILE_SCORES } from './layout'
import { placedTiles, rackGhosts, type Play } from './sim'
import {
  BACKGROUND,
  BLANK_FG,
  BOARD,
  BOARD_SPAN,
  EMPTY_SQUARE,
  GHOST_FG,
  LABEL,
  LEFT,
  PICTURE_HEIGHT,
  PICTURE_WIDTH,
  PREMIUM_COLORS,
  PREVIEW_BG,
  RACK_Y,
  rackTileX,
  SQUARE,
  squareX,
  squareY,
  TILE_BG,
  TILE_FG,
  TOP,
  type Rgb,
} from './theme'
import { inkBox, type Font, type InkBox } from './truetype'

/** What a board is drawn onto. Glyphs are placed by the left edge of their
 * ink and their baseline, in pixels from the picture's top-left. */
export type Canvas = {
  rect: (x: number, y: number, width: number, height: number, color: Rgb) => void
  diamond: (centerX: number, centerY: number, radius: number, color: Rgb) => void
  glyph: (char: string, size: number, isBold: boolean, inkLeft: number, baseline: number, color: Rgb) => void
}

// tui/pixel_compose.c's proportions of a tile with score subscripts.
const LETTER_SIZE = Math.floor(SQUARE * 0.5)
// Its letter on a tile without one, as small tiles draw.
const LARGE_LETTER_SIZE = Math.floor(SQUARE * 0.74)
const SCORE_SIZE = Math.floor(SQUARE * 0.24)
const LETTER_BASELINE = Math.floor(SQUARE * 0.72)
const LETTER_LIFT = Math.floor(SQUARE * 0.08)
const SCORE_MARGIN_X = Math.floor(SQUARE * 0.12)
const SCORE_MARGIN_Y = Math.floor(SQUARE * 0.16)
const LABEL_SIZE = 10

/** The ink box of `char` drawn at `size` pixels, y up from the baseline. */
export function glyphInk(font: Font, char: string, size: number, isBold: boolean): InkBox | null {
  return inkBox(font.outline(char.codePointAt(0) ?? 0, isBold), size / font.unitsPerEm)
}

/** `isLarge`: a tile without a score drawn small (a row of the table), its
 * letter at the TUI's size for that. */
export type Tile = { letter: string; fg: Rgb; bg: Rgb; isBold: boolean; hasScore: boolean; isLarge?: true }

/** A tile's colours on `bg`: a blank's letter grey, as the TUI draws it. */
export function tileColors(letter: string, bg: Rgb): { fg: Rgb; bg: Rgb } {
  return { fg: letter === letter.toLowerCase() ? BLANK_FG : TILE_FG, bg }
}

export function drawTile(canvas: Canvas, font: Font, x: number, y: number, tile: Tile) {
  canvas.rect(x, y, SQUARE, SQUARE, tile.bg)
  const size = tile.isLarge === true && !tile.hasScore ? LARGE_LETTER_SIZE : LETTER_SIZE
  const ink = glyphInk(font, tile.letter, size, tile.isBold)
  const score = TILE_SCORES[tile.letter] ?? 0
  if (ink !== null) {
    const inkWidth = Math.ceil(ink.maxX) - Math.floor(ink.minX)
    // Off centre to the left, and raised, to leave the score its corner.
    const shift = tile.hasScore ? Math.floor(SQUARE * (score >= 10 ? 0.07 : 0.03)) : 0
    const baseline = LETTER_BASELINE - (tile.hasScore ? LETTER_LIFT : 0)
    canvas.glyph(tile.letter, size, tile.isBold, x + Math.floor((SQUARE - inkWidth) / 2) - shift, y + baseline, tile.fg)
  }
  if (!tile.hasScore) {
    return
  }
  // Digits right to left from the bottom-right margin, a pixel apart.
  let right = x + SQUARE - SCORE_MARGIN_X
  const bottom = y + SQUARE - SCORE_MARGIN_Y
  for (const digit of [...String(score)].reverse()) {
    const digitInk = glyphInk(font, digit, SCORE_SIZE, tile.isBold)
    if (digitInk === null) {
      continue
    }
    const digitWidth = Math.ceil(digitInk.maxX) - Math.floor(digitInk.minX)
    // Sits the digit's ink bottom on the margin, as the TUI's bitmap does.
    canvas.glyph(digit, SCORE_SIZE, tile.isBold, right - digitWidth, bottom + Math.floor(digitInk.minY), tile.fg)
    right -= digitWidth + 1
  }
}

// Centres a glyph's ink in a box, its baseline at the TUI's 72%.
function drawCentered(canvas: Canvas, font: Font, char: string, x: number, y: number, width: number, height: number, size: number, color: Rgb) {
  const ink = glyphInk(font, char, size, false)
  if (ink === null) {
    return
  }
  const inkWidth = Math.ceil(ink.maxX) - Math.floor(ink.minX)
  canvas.glyph(char, size, false, x + Math.floor((width - inkWidth) / 2), y + Math.floor(height * 0.72), color)
}

// A premium square is its colour alone, unlabelled; the centre keeps its
// diamond.
function drawSquare(canvas: Canvas, row: number, col: number) {
  const x = squareX(col)
  const y = squareY(row)
  const premium = premiumAt(row, col)
  if (premium === null) {
    canvas.rect(x, y, SQUARE, SQUARE, EMPTY_SQUARE)
    return
  }
  const { bg, fg } = PREMIUM_COLORS[premium]
  canvas.rect(x, y, SQUARE, SQUARE, bg)
  if (premium === 'CENTER') {
    canvas.diamond(x + SQUARE / 2, y + SQUARE / 2, Math.floor(SQUARE * 0.2), fg)
  }
}

/** `board` is the position's rows, `.` for an empty square and lowercase
 * for a blank; null for an empty board. */
export function drawBoard(canvas: Canvas, font: Font, board: readonly string[] | null, rack: string, play: Play) {
  canvas.rect(0, 0, PICTURE_WIDTH, PICTURE_HEIGHT, BACKGROUND)
  canvas.rect(LEFT, TOP, BOARD_SPAN, BOARD_SPAN, BOARD)
  for (let col = 0; col < BOARD_DIM; col++) {
    drawCentered(canvas, font, COLUMN_LETTERS[col] ?? '', squareX(col), 0, SQUARE, TOP, LABEL_SIZE, LABEL)
  }
  for (let row = 0; row < BOARD_DIM; row++) {
    const number = String(row + 1)
    let right = LEFT - 4
    for (const digit of [...number].reverse()) {
      const ink = glyphInk(font, digit, LABEL_SIZE, false)
      if (ink !== null) {
        const width = Math.ceil(ink.maxX) - Math.floor(ink.minX)
        canvas.glyph(digit, LABEL_SIZE, false, right - width, squareY(row) + Math.floor(SQUARE / 2 + LABEL_SIZE * 0.35), LABEL)
        right -= width + 1
      }
    }
    for (let col = 0; col < BOARD_DIM; col++) {
      const letter = board?.[row]?.[col] ?? '.'
      if (letter === '.') {
        drawSquare(canvas, row, col)
      } else {
        drawTile(canvas, font, squareX(col), squareY(row), {
          letter,
          ...tileColors(letter, TILE_BG),
          isBold: false,
          hasScore: letter !== letter.toLowerCase(),
        })
      }
    }
  }
  // The previewed play: a muted tile under a bold letter, as the TUI
  // draws a preview. A blank is its lowercase letter, with no score. An
  // exchange places nothing: its rack ghosts show what goes back.
  for (const { row, col, letter } of placedTiles(play)) {
    drawTile(canvas, font, squareX(col), squareY(row), {
      letter,
      ...tileColors(letter, PREVIEW_BG),
      isBold: true,
      hasScore: letter !== letter.toLowerCase(),
    })
  }
  // The rack: the tiles the play spends drawn as grey ghosts, no score.
  const ghosts = rackGhosts(rack, play)
  for (const [index, letter] of [...rack].entries()) {
    const isGhost = ghosts[index] === true
    drawTile(canvas, font, rackTileX(index), RACK_Y, {
      letter,
      fg: isGhost ? GHOST_FG : TILE_FG,
      bg: isGhost ? BACKGROUND : TILE_BG,
      isBold: false,
      hasScore: !isGhost,
    })
  }
}
