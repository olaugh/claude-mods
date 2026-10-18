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
  /** An endgame's: the final spread for the player to move, what the line
   * nets them, and the rest of the line (a going-out play's end points). */
  result?: number
  net?: number
  line?: string
}

export type Sim = {
  /** A Monte Carlo sim, or an endgame solved (the bag empty). */
  kind: 'sim' | 'endgame'
  /** Sorted, blanks last, as MAGPIE writes a rack. */
  rack: string
  lexicon: string
  /** What the person named: a rack, a file, a URL. */
  label: string
  /** The position's rows, `.` empty and lowercase a blank; null when the
   * output printed no board (an opening rack). */
  board: string[] | null
  plays: Play[]
  /** A sim's plies, or the endgame solver's depth. */
  plies: number
  iterations: number
  seconds: number
  status: string
}

const PLAY_LINE = /^\s*(\d+):\s+(.*)$/
// `shgame`'s header or top border, whichever holds the on-turn marker: a
// name, a rack and a score.
const ON_TURN = /^\s+(?:A B C D E F G H I J K L M N O|-{30})\s+>\s+(.+?)\s{2,}([A-Za-z?]{1,7})\s+-?\d+\s*$/m
const ENDGAME_HEADER = /^Endgame \(depth: (\d+), time: ([\d.]+)s, status: ([^)]*)\)/
// An endgame row's first move: square, word, score, and a going-out play's
// end points in parentheses.
const ENDGAME_MOVE = /^(pass|\S+\s+\S+)\s+(-?\d+)(?:\s+(\(.*\)))?$/
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

/** The rack the player to move holds, as the last game printed shows it. */
function onTurnRack(text: string): string | undefined {
  const racks = [...text.matchAll(new RegExp(ON_TURN.source, 'gm'))]
  return racks[racks.length - 1]?.[2]
}

/** An endgame as MAGPIE's solver prints it: a header with its depth and
 * time, then a row per first move, its columns where the headings start:
 * the move (and a going-out play's end points), V (what the line nets), S
 * (the final spread), then each later turn of the line. */
function parseEndgame(lines: readonly string[], at: number, rack: string): Pick<Sim, 'plays' | 'plies' | 'seconds' | 'status'> {
  const header = ENDGAME_HEADER.exec(lines[at] ?? '')
  const headings = lines[at + 1] ?? ''
  const starts = [...headings.matchAll(/Play|V|S|Turn \d+/g)].map(match => match.index)
  const [, netAt = 0, resultAt = 0, ...turnsAt] = starts
  const plays: Play[] = []
  for (let index = at + 2; index < lines.length && (lines[index] ?? '').trim() !== ''; index++) {
    const row = lines[index] ?? ''
    const cell = (from: number, to: number | undefined) => row.slice(from, to).trim()
    const move = ENDGAME_MOVE.exec(cell(0, netAt))
    if (move === null) {
      continue
    }
    const what = move[1] ?? ''
    const isPass = what === 'pass'
    const [square = '', word = ''] = what.split(/\s+/)
    const tiles = isPass ? '' : boardTilesAsDots(word)
    const later = turnsAt.map((from, turn) => cell(from, turnsAt[turn + 1])).filter(turn => turn !== '')
    const placed = isPass ? { row: 0, col: 0, isDown: false } : parseCoordinates(square)
    const play: Play = {
      rank: plays.length + 1,
      id: isPass ? 'pass' : `${square} ${word}`,
      kind: isPass ? 'pass' : 'place',
      tiles,
      ...placed,
      leave: '',
      score: Number(move[2]),
      winPct: 0,
      winSe: 0,
      equity: 0,
      equitySe: 0,
      staticEquity: 0,
      iterations: 0,
      plies: [],
      result: Number(cell(resultAt, turnsAt[0])),
      net: Number(cell(netAt, resultAt)),
      line: [move[3] ?? '', ...later].filter(part => part !== '').join(' · '),
    }
    play.leave = leaveAfter(rack, play)
    plays.push(play)
  }
  return {
    plays,
    plies: Number(header?.[1] ?? 0),
    seconds: Number(header?.[2] ?? 0),
    status: header?.[3] ?? '',
  }
}

// What stays on the rack once the play's tiles leave it.
function leaveAfter(rack: string, play: Play): string {
  const ghosts = rackGhosts(rack, play)
  return [...rack].filter((_, index) => ghosts[index] !== true).join('')
}

export function parseSim(text: string): Sim {
  const lines = text.split('\n')
  const endgameAt = lines.findIndex(line => ENDGAME_HEADER.test(line))
  if (endgameAt >= 0) {
    const rack = sortRack(onTurnRack(text) ?? '')
    const endgame = parseEndgame(lines, endgameAt, rack)
    if (endgame.plays.length === 0) {
      throw new Error('the endgame solver printed no plays')
    }
    return {
      kind: 'endgame',
      rack,
      lexicon: /^#\s*lexicon\s+(\S+)/m.exec(text)?.[1] ?? '',
      label: /^#\s*label\s+(.*?)\s*$/m.exec(text)?.[1] ?? '',
      board: parseBoard(lines),
      iterations: 0,
      ...endgame,
    }
  }
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
    kind: 'sim',
    // The player to move's, as shgame printed it; else every play's spent
    // tiles and leave make it, the first's as well as any.
    rack: sortRack(onTurnRack(text) ?? spentTiles(first) + first.leave),
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

/** A play as people write it: `8F DROP`, an exchange `-EO`, `pass`. */
export function playName(play: Play): string {
  return play.kind === 'exchange' ? `-${play.tiles}` : play.id
}

/** A play as the table spells it: its square (`-` before an exchange's
 * tiles, `pass`) and its tiles, the board's own (in parentheses) marked. */
export function playTiles(play: Play): { label: string; tiles: { letter: string; isThrough: boolean }[] } {
  if (play.kind === 'exchange') {
    return { label: '-', tiles: [...play.tiles].map(letter => ({ letter, isThrough: false })) }
  }
  if (play.kind === 'pass') {
    return { label: 'pass', tiles: [] }
  }
  const [label = '', word = ''] = play.id.split(' ')
  const tiles: { letter: string; isThrough: boolean }[] = []
  let isThrough = false
  for (const char of word) {
    if (char === '(' || char === ')') {
      isThrough = char === '('
    } else {
      tiles.push({ letter: char, isThrough })
    }
  }
  return { label, tiles }
}

/** An endgame's result as players write it: W+20 a win by 20, L-10 a loss
 * by 10, T=0 a tie. */
export function resultText(result: number | undefined): string {
  if (result === undefined) {
    return ''
  }
  return result > 0 ? `W+${result}` : result < 0 ? `L${result}` : 'T=0'
}

/** The latest whole results table in a sim's output so far, as parseSim
 * reads it: MAGPIE, asked to print as it goes (`-pfrequency`), prints the
 * board, then a table each so often, each ending with its `Nps:` line; the
 * board goes before the latest. `count` is how many tables have ended;
 * undefined before the first has. */
export function latestTable(output: string): { text: string; count: number } | undefined {
  const ends = [...output.matchAll(/^Nps:.*$/gm)].map(match => match.index + match[0].length)
  const end = ends[ends.length - 1]
  if (end === undefined) {
    return undefined
  }
  const start = ends[ends.length - 2] ?? 0
  const table = output.slice(start, end)
  if (start === 0) {
    return { text: table, count: ends.length }
  }
  const firstRow = output.search(/^\d+:\s/m)
  return { text: `${firstRow < 0 ? '' : output.slice(0, firstRow)}${table.replace(/^\n/, '')}`, count: ends.length }
}
