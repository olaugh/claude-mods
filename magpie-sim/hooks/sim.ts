// Reads a sim as MAGPIE prints it with `-hr false`: a line per simmed play,
// then a summary. The columns are src/str/sim_string.c's UCGI ones: rank,
// move, leave, score, Ig, Wp, WpSE, Eq, EqSE, StEq, It, then each ply's
// score mean, score stdev and bingo%. Lines starting `# lexicon` name the
// lexicon, which the output leaves out.

import { BOARD_DIM, COLUMN_LETTERS } from './layout'

export type PlyStats = { score: number; stdev: number; bingoPct: number }

export type Play = {
  /** Where the sim ranked it: by win%. */
  rank: number
  /** As the sim lists it: `8F DROP`, `exch Q`, `pass`. */
  id: string
  kind: 'place' | 'exchange' | 'pass'
  /** The word, `.` for a tile already on the board and lowercase for a
   * blank; for an exchange the tiles thrown back; empty for a pass. */
  tiles: string
  row: number
  col: number
  isDown: boolean
  leave: string
  score: number
  winPct: number
  winSe: number
  equity: number
  equitySe: number
  staticEquity: number
  iterations: number
  plies: PlyStats[]
}

export type Sim = {
  /** Sorted, blanks last, as MAGPIE writes a rack. */
  rack: string
  lexicon: string
  /** What the person named: a rack, a file, a URL. */
  label: string
  /** The position's rows, `.` empty and lowercase a blank; null when the
   * output printed no board (an opening rack). */
  board: string[] | null
  plays: Play[]
  plies: number
  iterations: number
  seconds: number
  status: string
}

const PLAY_LINE = /^\s*(\d+):\s+(.*)$/
// The Ig column: X for a play the threshold found too close to the best.
const IGNORED_MARKS = new Set(['-', 'X'])
// Wp, WpSE, Eq, EqSE, StEq, It.
const STAT_COLUMNS = 6
const PLY_COLUMNS = 3

function numberAt(tokens: readonly string[], at: number, line: string): number {
  const value = Number(tokens[at])
  if (tokens[at] === undefined || Number.isNaN(value)) {
    throw new Error(`no number in column ${at + 1} of "${line.trim()}"`)
  }
  return value
}

// `8F` is across, row first; `H8` is down, column first.
function parseCoordinates(text: string): { row: number; col: number; isDown: boolean } {
  const across = /^(\d+)([A-Z])$/.exec(text)
  const down = /^([A-Z])(\d+)$/.exec(text)
  const [rowText, colText, isDown] =
    across !== null ? [across[1], across[2], false] : down !== null ? [down[2], down[1], true] : []
  const row = Number(rowText) - 1
  const col = COLUMN_LETTERS.indexOf(colText ?? '')
  if (isDown === undefined || row < 0 || row >= BOARD_DIM || col < 0) {
    throw new Error(`no square at ${text}`)
  }
  return { row, col, isDown }
}

// MAGPIE writes the tiles a play goes through in parentheses, `(S)ILVERED`;
// a `.` stands for each, as in a GCG.
function boardTilesAsDots(word: string): string {
  return word.replace(/\(([^)]*)\)/g, (_, onBoard: string) => '.'.repeat(onBoard.length))
}

export function parsePlayLine(line: string): Play | null {
  const match = PLAY_LINE.exec(line)
  if (match === null) {
    return null
  }
  const tokens = (match[2] ?? '').trim().split(/\s+/)
  let at = 0
  let play: Pick<Play, 'id' | 'kind' | 'tiles' | 'row' | 'col' | 'isDown'>
  if (tokens[0] === '(exch') {
    const tiles = (tokens[1] ?? '').replace(/\)$/, '')
    play = { id: `exch ${tiles}`, kind: 'exchange', tiles, row: 0, col: 0, isDown: false }
    at = 2
  } else if (tokens[0] === 'pass') {
    play = { id: 'pass', kind: 'pass', tiles: '', row: 0, col: 0, isDown: false }
    at = 1
  } else {
    const word = tokens[1] ?? ''
    play = { id: `${tokens[0]} ${word}`, kind: 'place', tiles: boardTilesAsDots(word), ...parseCoordinates(tokens[0] ?? '') }
    at = 2
  }
  // A play that spends the whole rack leaves an empty leave cell, which the
  // split drops: the score is whatever stands before the Ig mark.
  const ignoredAt = tokens.findIndex((token, index) => index > at && IGNORED_MARKS.has(token))
  if (ignoredAt < 0) {
    throw new Error(`no Ig column in "${line.trim()}"`)
  }
  const leave = ignoredAt - at === 2 ? (tokens[at] ?? '') : ''
  const stats = ignoredAt + 1
  const plyCount = Math.floor((tokens.length - stats - STAT_COLUMNS) / PLY_COLUMNS)
  const plies: PlyStats[] = []
  for (let ply = 0; ply < plyCount; ply++) {
    const first = stats + STAT_COLUMNS + ply * PLY_COLUMNS
    plies.push({
      score: numberAt(tokens, first, line),
      stdev: numberAt(tokens, first + 1, line),
      bingoPct: numberAt(tokens, first + 2, line),
    })
  }
  return {
    ...play,
    rank: Number(match[1]),
    leave,
    score: numberAt(tokens, ignoredAt - 1, line),
    winPct: numberAt(tokens, stats, line),
    winSe: numberAt(tokens, stats + 1, line),
    equity: numberAt(tokens, stats + 2, line),
    equitySe: numberAt(tokens, stats + 3, line),
    staticEquity: numberAt(tokens, stats + 4, line),
    iterations: numberAt(tokens, stats + 5, line),
    plies,
  }
}

/** The tiles a play takes from the rack: a blank as `?`. */
export function spentTiles(play: Play): string {
  if (play.kind === 'exchange') {
    return play.tiles
  }
  return [...play.tiles]
    .filter(letter => letter !== '.')
    .map(letter => (letter === letter.toLowerCase() ? '?' : letter))
    .join('')
}

function sortRack(tiles: string): string {
  // `?` sorts before the letters in ASCII; MAGPIE writes blanks last.
  return [...tiles].sort((a, b) => (a === '?' ? 1 : b === '?' ? -1 : a.localeCompare(b))).join('')
}

// A row of `shgame`'s ASCII board (-pretty false): its number, a bar, then
// two characters a square, the first a letter or a premium mark.
const BOARD_ROW = new RegExp(`^\\s?(\\d{1,2})\\|(.{${BOARD_DIM * 2}})\\|`)

/** The board rows `shgame` printed, the last board printed winning. */
export function parseBoard(lines: readonly string[]): string[] | null {
  let board: string[] | null = null
  for (const line of lines) {
    const match = BOARD_ROW.exec(line)
    if (match === null) {
      continue
    }
    const row = Number(match[1]) - 1
    if (row === 0) {
      board = []
    }
    if (board !== null && row === board.length) {
      const squares = match[2] ?? ''
      board.push(
        Array.from({ length: BOARD_DIM }, (_, col) => {
          const char = squares[col * 2] ?? ' '
          return /[A-Za-z]/.test(char) ? char : '.'
        }).join(''),
      )
    }
  }
  return board?.length === BOARD_DIM ? board : null
}

export function parseSim(text: string): Sim {
  const lines = text.split('\n')
  // The sim's table is the run of play lines just before `Showing N of M
  // plays`; a move list printed earlier (by `shgame`) is another run.
  let plays: Play[] = []
  let run: Play[] = []
  let lastRun: Play[] = []
  let lexicon = ''
  let label = ''
  let plies = 0
  let iterations = 0
  let seconds = 0
  let status = ''
  for (const line of lines) {
    const header = /^#\s*(lexicon|label)\s+(.*?)\s*$/.exec(line)
    const shownPlays = /^Showing \d+ of \d+ plays/.test(line)
    const shownPlies = /^Showing \d+ of (\d+) plies/.exec(line)
    const summary = /^(Iters|Time|Status):\s+(.*?)\s*$/.exec(line)
    const play = header === null ? parsePlayLine(line) : null
    if (play !== null) {
      run.push(play)
      continue
    }
    if (run.length > 0) {
      lastRun = run
      run = []
    }
    if (header !== null) {
      if (header[1] === 'lexicon') {
        lexicon = header[2] ?? ''
      } else {
        label = header[2] ?? ''
      }
    } else if (shownPlays) {
      plays = lastRun
    } else if (shownPlies !== null) {
      plies = Number(shownPlies[1])
    } else if (summary !== null) {
      const value = summary[2] ?? ''
      if (summary[1] === 'Iters') {
        iterations = Number(value)
      } else if (summary[1] === 'Time') {
        seconds = Number.parseFloat(value)
      } else {
        status = value
      }
    }
  }
  const first = plays[0]
  if (first === undefined) {
    throw new Error('the output holds no simmed plays: was it printed with -hr false?')
  }
  return {
    // Every play's spent tiles and leave make the rack; the first's will do.
    rack: sortRack(spentTiles(first) + first.leave),
    lexicon,
    label,
    board: parseBoard(lines),
    plays,
    plies: plies || first.plies.length,
    iterations,
    seconds,
    status,
  }
}

/** Where each placed tile lands, the board's own tiles skipped. */
export function placedTiles(play: Play): { row: number; col: number; letter: string }[] {
  if (play.kind !== 'place') {
    return []
  }
  return [...play.tiles].flatMap((letter, offset) =>
    letter === '.'
      ? []
      : [{ row: play.row + (play.isDown ? offset : 0), col: play.col + (play.isDown ? 0 : offset), letter }],
  )
}

// Which rack tiles the play spends, in rack order: the first unspent tile of
// each letter it takes, as the TUI ghosts them.
export function rackGhosts(rack: string, play: Play): boolean[] {
  const needed = [...spentTiles(play)]
  return [...rack].map(letter => {
    const at = needed.indexOf(letter)
    if (at < 0) {
      return false
    }
    needed.splice(at, 1)
    return true
  })
}

/** What the picture shows, in words, for the surfaces that cannot see it. */
export function describePlay(play: Play): string {
  if (play.kind === 'exchange') {
    return `Exchange ${play.tiles}, keeping ${play.leave || 'nothing'}`
  }
  if (play.kind === 'pass') {
    return 'Pass'
  }
  return `The board with ${play.id} placed, ${play.score} points`
}
