// The board's colours (tui/theme.c's THEME_DARK) and geometry, shared by the
// terminal's pixel picture and the SVG the other surfaces draw.

import { BOARD_DIM, RACK_SIZE, type Premium } from './layout'

export type Rgb = readonly [number, number, number]

export const BACKGROUND: Rgb = [0, 0, 0]
export const BOARD: Rgb = [10, 14, 18]
export const EMPTY_SQUARE: Rgb = [18, 22, 20]
export const LABEL: Rgb = [110, 130, 120]
export const TILE_FG: Rgb = [130, 230, 160]
export const TILE_BG: Rgb = [30, 50, 35]
// A preview tile is the player's hue blended halfway into the background.
export const PREVIEW_BG: Rgb = [
  (TILE_FG[0] + BACKGROUND[0]) / 2,
  (TILE_FG[1] + BACKGROUND[1]) / 2,
  (TILE_FG[2] + BACKGROUND[2]) / 2,
]
// A spent rack tile: grey on the background.
export const GHOST_FG: Rgb = [102, 102, 102]
export const PREMIUM_COLORS: Readonly<Record<Premium, { bg: Rgb; fg: Rgb }>> = {
  TW: { bg: [91, 35, 47], fg: [204, 117, 133] },
  DW: { bg: [124, 63, 77], fg: [216, 154, 160] },
  TL: { bg: [31, 68, 88], fg: [88, 139, 168] },
  DL: { bg: [51, 94, 122], fg: [125, 168, 200] },
  CENTER: { bg: [124, 63, 77], fg: [216, 154, 160] },
}

export const SQUARE = 36
export const GAP = 2
// Room for the row numbers at the left and the column letters on top.
export const LEFT = 20
export const TOP = 14
const RIGHT = 8
const BOTTOM = 8
const RACK_GAP = 12
const RACK_TILE_GAP = 4

export const BOARD_SPAN = BOARD_DIM * SQUARE + (BOARD_DIM - 1) * GAP
export const PICTURE_WIDTH = LEFT + BOARD_SPAN + RIGHT
export const PICTURE_HEIGHT = TOP + BOARD_SPAN + RACK_GAP + SQUARE + BOTTOM
export const RACK_Y = TOP + BOARD_SPAN + RACK_GAP

// Centred for a full rack, so a shorter one sits where a full one would.
const RACK_SPAN = RACK_SIZE * SQUARE + (RACK_SIZE - 1) * RACK_TILE_GAP

export function squareX(col: number): number {
  return LEFT + col * (SQUARE + GAP)
}

export function squareY(row: number): number {
  return TOP + row * (SQUARE + GAP)
}

export function rackTileX(index: number): number {
  return LEFT + (BOARD_SPAN - RACK_SPAN) / 2 + index * (SQUARE + RACK_TILE_GAP)
}
