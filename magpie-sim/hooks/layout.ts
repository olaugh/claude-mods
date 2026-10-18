// The standard board and the English tile values: what a sim's output
// leaves out.

export const BOARD_DIM = 15
export const RACK_SIZE = 7

export type Premium = 'TW' | 'DW' | 'TL' | 'DL' | 'CENTER'

// The standard board's top half: = TW, - DW, " TL, ' DL, * the centre.
const TOP_HALF = [
  "=..'...=...'..=",
  '.-..."..."...-.',
  "..-...'.'...-..",
  "'..-...'...-..'",
  '....-.....-....',
  '."..."..."...".',
  "..'...'.'...'..",
  "=..'...*...'..=",
]
const LAYOUT = [...TOP_HALF, ...TOP_HALF.slice(0, TOP_HALF.length - 1).reverse()]
const PREMIUMS: Readonly<Record<string, Premium>> = {
  '=': 'TW',
  '-': 'DW',
  '"': 'TL',
  "'": 'DL',
  '*': 'CENTER',
}

export const TILE_SCORES: Readonly<Record<string, number>> = {
  A: 1, B: 3, C: 3, D: 2, E: 1, F: 4, G: 2, H: 4, I: 1, J: 8, K: 5, L: 1, M: 3,
  N: 1, O: 1, P: 3, Q: 10, R: 1, S: 1, T: 1, U: 1, V: 4, W: 4, X: 8, Y: 4, Z: 10,
}

export const COLUMN_LETTERS = 'ABCDEFGHIJKLMNO'

export function premiumAt(row: number, col: number): Premium | null {
  return PREMIUMS[LAYOUT[row]?.[col] ?? '.'] ?? null
}
