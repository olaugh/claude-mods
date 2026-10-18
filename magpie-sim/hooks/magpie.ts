// Turns what the person names (an opening rack, a CGP, a path or URL of a
// CGP or GCG, and for a GCG which position in it) into a MAGPIE run:
// `setoptions` with the sim's settings on the command line, which keeps
// MAGPIE reading commands, then the position and `gsimulate` on its
// standard input.

import { BOARD_DIM } from './layout'

export const DEFAULT_LEXICON = 'CSW24'
// 20,000 iterations for each of the top 50 plays, shared evenly.
export const SIM_PLAYS = 50
export const ITERATIONS_PER_PLAY = 20000
export const SIM_PLIES = 2
// Long enough never to cut the iterations short.
const SIM_TIME_LIMIT_SECONDS = 3600
// More `next`s than any game has events; the ones past its end only say so.
const SCAN_STEPS = 150

/** A play as `commit` takes it: `8G VAV`, lowercase a blank. */
export type PlacedMove = { coordinate: string; word: string }

export type Position =
  /** A rack to move with, after the moves played before it, if any. */
  | { kind: 'rack'; rack: string; after?: PlacedMove[] }
  | { kind: 'cgp'; cgp: string }
  /** A path, URL or cross-tables or Woogles game id: MAGPIE's `load` fetches it. */
  | { kind: 'gcg'; source: string }
  /** A URL of unknown content: fetched, then read as a CGP or a GCG. */
  | { kind: 'url'; url: string }
  /** A local file of unknown content: read, then the same. */
  | { kind: 'file'; path: string }

/** Which position of a GCG to sim. */
export type Selector =
  /** The game's turn-th move, from 1: the position it was made from. */
  | { kind: 'turn'; turn: number }
  /** The position whose player to move held this rack. */
  | { kind: 'rack'; rack: string }
  /** The position this word was played from. */
  | { kind: 'word'; word: string }
  /** The rack its player held next, at their following turn, after this
   * word was played (where, if given). */
  | { kind: 'after'; word: string; coordinate?: string }
  /** Letters that could be a rack or a word. */
  | { kind: 'letters'; letters: string }
  /** MAGPIE's own `goto` argument: events played, start or end. */
  | { kind: 'goto'; goto: string }
  /** The turn the game's event-th event was a move of: cross-tables's
   * viewer counts moves so (`#13#`), challenge bonuses and end points
   * among them. */
  | { kind: 'move'; event: number }

export type SimRequest = {
  position: Position
  /** A short name for titles and messages. */
  label: string
  /** As the person gave the position, to repeat back to them. */
  source: string
  /** Left out: CSW24, or what a CGP's `lex` or a GCG's `#lexicon` says. */
  lexicon?: string
  /** For a GCG; left out, its latest position with a player to move. */
  at?: Selector
}

const RACK = /^[A-Za-z?]{1,7}$/
const LEXICON = /^[A-Za-z]+\d+$/
// Pages MAGPIE's `load` knows how to read a game from.
const GAME_SITES = /(^|\.)(woogles\.io|cross-tables\.com)$/i
// Words naming what the next token is, and words that say nothing.
const KEYWORDS: Readonly<Record<string, Selector['kind']>> = {
  turn: 'turn',
  move: 'turn',
  rack: 'rack',
  word: 'word',
  play: 'word',
  before: 'word',
  event: 'goto',
}
// Words that say nothing about which position: "the turn where I played
// VODKA" is VODKA. `turn` and `move` are filler too unless a number follows.
const FILLER = new Set([
  'at', 'on', 'in', 'the', 'a', 'an', 'with', 'of', 'for',
  'where', 'when', 'was', 'played', 'i', 'my', 'his', 'her', 'their', 'position',
])
const TURN_NUMBER = /^#?\d+$/
// Between the moves after `after`.
const SEPARATORS = new Set(['then', 'and'])
const COORDINATE = /^(?:\d{1,2}[A-Oa-o]|[A-Oa-o]\d{1,2})$/
const PLAYED_WORD = /^[A-Za-z?.()]+$/

/** A word as typed, in MAGPIE's spelling: all lowercase is plain tiles
 * (`vav` is VAV); in a mixed-case word lowercase letters are blanks. */
export function canonicalWord(word: string): string {
  return word === word.toLowerCase() ? word.toUpperCase() : word
}

/** The tiles a play takes from its player's rack: the board's own (in
 * parentheses, or a `.` each) left out, a blank as `?`. */
export function tilesFromRack(word: string): string {
  return [...word.replace(/\([^)]*\)/g, '').replaceAll('.', '')]
    .map(letter => (letter === letter.toLowerCase() ? '?' : letter))
    .join('')
}

/** Whether `text` opens with a CGP board: its rows split by slashes. */
export function isCgp(text: string): boolean {
  return (text.trim().split(/\s+/)[0] ?? '').split('/').length === BOARD_DIM
}

export function classifyPosition(text: string): Position {
  const trimmed = text.trim()
  if (/^https?:\/\//i.test(trimmed)) {
    const url = new URL(trimmed)
    // A viewer's `#13#` is for the page (gameFragmentEvents), not the fetch.
    url.hash = ''
    return GAME_SITES.test(url.hostname) || /\.gcg$/i.test(url.pathname)
      ? { kind: 'gcg', source: url.href }
      : { kind: 'url', url: url.href }
  }
  if (isCgp(trimmed)) {
    return { kind: 'cgp', cgp: trimmed }
  }
  if (/^[~/.]/.test(trimmed) || /\.(gcg|cgp|txt)$/i.test(trimmed)) {
    return /\.gcg$/i.test(trimmed) ? { kind: 'gcg', source: trimmed } : { kind: 'file', path: trimmed }
  }
  if (RACK.test(trimmed)) {
    return { kind: 'rack', rack: trimmed.toUpperCase() }
  }
  throw new Error(
    `cannot tell what "${trimmed}" is: give an opening rack (ADOPQRR), a CGP, or a path or URL of a CGP or GCG`,
  )
}

/** A short name for a position: a URL's or path's last part, else as given. */
export function positionLabel(text: string): string {
  const trimmed = text.trim()
  if (isCgp(trimmed)) {
    return 'CGP'
  }
  if (/^https?:\/\//i.test(trimmed)) {
    const url = new URL(trimmed)
    const annotated = url.searchParams.get('u')
    if (/cross-tables\.com$/i.test(url.hostname) && annotated !== null) {
      return `cross-tables ${annotated}`
    }
    return url.pathname.split('/').filter(part => part !== '').pop() ?? url.hostname
  }
  return /[/]/.test(trimmed) ? (trimmed.split('/').filter(part => part !== '').pop() ?? trimmed) : trimmed
}

/** The move a game viewer's link shows: cross-tables's annotated viewer
 * writes its move counter, which counts the events MAGPIE does, as `#13#`. */
export function gameFragmentMove(text: string): number | undefined {
  const move = /^https?:\/\/[^#]*cross-tables\.com\/[^#]*#(\d+)#?$/i.exec(text.trim())?.[1]
  return move === undefined ? undefined : Number(move)
}

function selector(kind: Selector['kind'] | undefined, value: string): Selector {
  const upper = value.toUpperCase()
  if (kind === 'turn' || (kind === undefined && /^#?\d+$/.test(value))) {
    if (!/^#?\d+$/.test(value) || Number(value.replace('#', '')) < 1) {
      throw new Error(`a turn is a number from 1, not "${value}"`)
    }
    return { kind: 'turn', turn: Number(value.replace('#', '')) }
  }
  if (kind === 'goto' || (kind === undefined && /^(start|end)$/i.test(value))) {
    if (!/^(\d+|start|end)$/i.test(value)) {
      throw new Error(`an event is a number, start or end, not "${value}"`)
    }
    return { kind: 'goto', goto: value.toLowerCase() }
  }
  if (!/^[A-Za-z?]+$/.test(value)) {
    throw new Error(`"${value}" is not a turn number, a rack or a word`)
  }
  if (kind === 'rack') {
    if (!RACK.test(value)) {
      throw new Error(`a rack is 1 to 7 tiles, not "${value}"`)
    }
    return { kind: 'rack', rack: upper }
  }
  if (kind === 'word') {
    return { kind: 'word', word: upper.replaceAll('?', '') }
  }
  // Too long for a rack, or holding a blank, it can only be one of them.
  if (value.length > 7) {
    return { kind: 'word', word: upper }
  }
  return value.includes('?') ? { kind: 'rack', rack: upper } : { kind: 'letters', letters: upper }
}

export type Qualifiers = { lexicon?: string; at?: Selector; after?: PlacedMove[] }

/** A word as typed, without quotes, end punctuation or a possessive:
 * `"VODKA's"` is VODKA. */
function cleanToken(token: string): string {
  return token.replace(/^["'“‘]+|["'”’!:;]+$/g, '').replace(/['’]s$/i, '')
}

/** Reads the words after a position: a lexicon (CSW24); for a rack, the
 * moves played before it (`after 8G VAV, 9F ...`); for a GCG, which
 * position, as `12`, `turn 12`, `DEEILRV`, `rack DEEILRV`, `VODKA` or `the
 * VODKA turn` (where it was played), `before VODKA` (the same), `after
 * VODKA` (its player's next rack) or `event 23`. Filler words (`at`, `the`,
 * `where`, `played`) are skipped. */
export function parseQualifiers(rawTokens: readonly string[]): Qualifiers {
  const tokens = rawTokens.map(cleanToken).filter(token => token !== '')
  const qualifiers: Qualifiers = {}
  const isFiller = (token: string | undefined) => FILLER.has((token ?? '').toLowerCase())
  // The next token that says something, at or after `from`.
  const meaningfulFrom = (from: number) => {
    let at = from
    while (at < tokens.length && isFiller(tokens[at])) {
      at++
    }
    return at
  }
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index] ?? ''
    const lower = token.toLowerCase()
    if (isFiller(token)) {
      continue
    }
    if (LEXICON.test(token)) {
      qualifiers.lexicon = token.toUpperCase()
      continue
    }
    if ((lower === 'turn' || lower === 'move') && !TURN_NUMBER.test(tokens[meaningfulFrom(index + 1)] ?? '')) {
      continue
    }
    if (lower === 'after') {
      index = meaningfulFrom(index + 1) - 1
      const moves: PlacedMove[] = []
      while (COORDINATE.test(tokens[index + 1] ?? '')) {
        const coordinate = (tokens[index + 1] ?? '').toUpperCase()
        const word = tokens[index + 2] ?? ''
        if (!PLAYED_WORD.test(word)) {
          throw new Error(`${coordinate} needs the word played there: after ${coordinate} VAV`)
        }
        moves.push({ coordinate, word: canonicalWord(word) })
        index += 2
        while (SEPARATORS.has((tokens[index + 1] ?? '').toLowerCase())) {
          index++
        }
      }
      if (moves.length > 0) {
        qualifiers.after = [...(qualifiers.after ?? []), ...moves]
        continue
      }
      const word = tokens[++index]
      if (word === undefined || !PLAYED_WORD.test(word)) {
        throw new Error('"after" needs a move or a word: after 8G VAV, after SILVERED')
      }
      if (qualifiers.at !== undefined) {
        throw new Error('name one position: a turn, a rack or a word')
      }
      qualifiers.at = { kind: 'after', word: word.replace(/[().]/g, '').toUpperCase() }
      continue
    }
    const kind = KEYWORDS[lower]
    if (kind !== undefined) {
      index = meaningfulFrom(index + 1)
    }
    const value = kind === undefined ? token : tokens[index]
    if (value === undefined) {
      throw new Error(`"${token}" needs something after it: turn 12, rack DEEILRV, before SILVERED`)
    }
    if (qualifiers.at !== undefined) {
      throw new Error('name one position: a turn, a rack or a word')
    }
    qualifiers.at = selector(kind, value)
  }
  return qualifiers
}

/** Reads `/magpie` arguments: a CGP whole, else a position and then its
 * qualifiers (parseQualifiers). */
export function parseArgs(args: string): SimRequest {
  const trimmed = args.trim()
  if (trimmed === '') {
    throw new Error('name a position: /magpie ADOPQRR, /magpie <cgp>, /magpie <path or URL of a .cgp or .gcg> [turn]')
  }
  if (isCgp(trimmed)) {
    // After its four fields a CGP holds only opcodes, each ended by `;`.
    const opcodes = trimmed.split(/\s+/).slice(4).join(' ')
    if (opcodes !== '' && !opcodes.endsWith(';')) {
      throw new Error(`a CGP is the whole position; "${opcodes}" is not its opcodes (lex CSW24;)`)
    }
    return { position: { kind: 'cgp', cgp: trimmed }, label: 'CGP', source: 'CGP' }
  }
  const [first = '', ...rest] = trimmed.split(/[\s,]+/)
  const { lexicon, at, after } = parseQualifiers(rest)
  const position = classifyPosition(first)
  const request: SimRequest = { position, label: positionLabel(first), source: first }
  if (lexicon !== undefined) {
    request.lexicon = lexicon
  }
  if (position.kind === 'rack' || position.kind === 'cgp') {
    if (at !== undefined) {
      throw new Error('a turn, rack or word picks a position in a GCG; this position is the whole of what to sim')
    }
    if (after !== undefined) {
      if (position.kind === 'cgp') {
        throw new Error('a CGP is the whole position; play the moves into it instead')
      }
      position.after = after
      request.label = `${position.rack} after ${after.map(move => `${move.coordinate} ${move.word}`).join(', ')}`
    }
    return request
  }
  if (after !== undefined) {
    // In a game, `after 11H SILVERED` names one of its moves.
    const [move, ...more] = after
    if (move === undefined || more.length > 0 || at !== undefined) {
      throw new Error('name one position: a turn, a rack, a word, or one move to come after')
    }
    request.at = { kind: 'after', word: move.word.replace(/[().]/g, '').toUpperCase(), coordinate: move.coordinate }
  } else if (at !== undefined) {
    request.at = at
  } else {
    const move = gameFragmentMove(first)
    if (move !== undefined && move > 0) {
      request.at = { kind: 'move', event: move }
    }
  }
  return request
}

/** The CGP's four fields, and its `lex` opcode if it has one. */
export function splitCgp(cgp: string): { fields: string; lexicon?: string } {
  const tokens = cgp.trim().split(/\s+/)
  const lexicon = /(?:^|;)\s*lex\s+([A-Za-z0-9_]+)\s*;/.exec(tokens.slice(4).join(' '))?.[1]
  return lexicon === undefined
    ? { fields: tokens.slice(0, 4).join(' ') }
    : { fields: tokens.slice(0, 4).join(' '), lexicon: lexicon.toUpperCase() }
}

/** A fetched or read file: a CGP if it opens like one, else a GCG. */
export function sniffPosition(text: string): 'cgp' | 'gcg' {
  return isCgp(text) ? 'cgp' : 'gcg'
}

export type Accelerators = { rit: boolean; wit: boolean }

export type MagpieRun = { args: string[]; stdin: string; lexicon: string }

// A plain ASCII board for `shgame` and the scan, which the mod reads.
const ASCII_BOARD = [
  '-boardcolor', 'none', '-boardtiles', 'primary', '-boardborder', 'ascii',
  '-boardcolumns', 'ascii', '-onturnmarker', 'ascii',
]

// The settings every sim runs with, after `setoptions`.
export function simOptions(lexicon: string | undefined, threads: number, accelerators: Accelerators): string[] {
  return [
    ...(lexicon === undefined ? [] : ['-lex', lexicon]),
    '-wmp', 'true',
    '-rit', String(accelerators.rit),
    '-wit', String(accelerators.wit),
    '-s1', 'equity', '-s2', 'equity',
    '-r1', 'all', '-r2', 'all',
    '-numplays', String(SIM_PLAYS),
    '-plies', String(SIM_PLIES),
    '-iterations', String(SIM_PLAYS * ITERATIONS_PER_PLAY),
    // Round robin with no stopping rule: every play gets its share.
    '-sr', 'rr', '-threshold', 'none', '-scondition', 'none',
    '-tlim', String(SIM_TIME_LIMIT_SECONDS),
    '-threads', String(threads),
    '-hr', 'false',
    ...ASCII_BOARD,
    '-maxnumdplays', String(SIM_PLAYS),
  ]
}

/** The run that prints every position of a GCG: loaded at its start, then
 * one `next` at a time, each printing the game. */
export function scanRun(source: string, lexicon: string | undefined): MagpieRun {
  return {
    args: ['setoptions', ...(lexicon === undefined ? [] : ['-lex', lexicon]), '-wmp', 'false', '-hr', 'false', ...ASCII_BOARD],
    stdin: `load ${source}\n${'next\n'.repeat(SCAN_STEPS)}`,
    lexicon: lexicon ?? '',
  }
}

/** A position of a GCG a player had to move from, with a known rack. */
export type GcgPosition = {
  /** Events played to reach it: MAGPIE's `goto` argument. */
  events: number
  /** Which move of the game was made from it, from 1. */
  turn: number
  player: string
  rack: string
  /** That move as MAGPIE writes it (`11H (S)ILVERED 74 DEEILRV`); none at
   * the latest position of a game in progress. */
  move?: string
  /** The events played once that move was: one more than `events`, or more
   * where MAGPIE takes a play and its challenge bonus as one step. */
  movedTo?: number
}

// Each printed game opens with the column letters.
const PRINTED_GAME = /\n(?=\s+A B C D E F G H I J K L M N O)/
// The header or the top border, whichever row holds the on-turn marker: a
// name, a rack and a score.
const ON_TURN = /^\s+(?:A B C D E F G H I J K L M N O|-{30})\s+>\s+(.+?)\s{2,}([A-Za-z?]{1,7})\s+-?\d+\s*$/m
// `Event N (player):` beside the board, and on the next row what it was.
const EVENT = /Event (\d+) \((.*?)\):[^\n]*\n[^\n]*\|\s+([^\n]*?)\s*$/m

/** The positions a scan printed that a player moved from (or, at the end of
 * a game in progress, is to move from). An event is a move when the player
 * who made it was the one to move: challenge bonuses, phonies taken off and
 * end-of-game points are events by the other player, or by nobody to move. */
export function gcgPositions(output: string): GcgPosition[] {
  const printed = new Map<number, { onTurn?: { player: string; rack: string }; event?: { player: string; what: string } }>()
  for (const game of output.split(PRINTED_GAME)) {
    if (!/A B C D E F G H I J K L M N O/.test(game)) {
      continue
    }
    const event = EVENT.exec(game)
    const onTurn = ON_TURN.exec(game)
    printed.set(event === null ? 0 : Number(event[1]), {
      onTurn: onTurn === null ? undefined : { player: onTurn[1] ?? '', rack: onTurn[2] ?? '' },
      event: event === null ? undefined : { player: event[2] ?? '', what: event[3] ?? '' },
    })
  }
  // `next` and `goto` step over an event MAGPIE takes with the one before
  // (a challenge bonus with its play), so the next event printed is the
  // next step, whatever its number.
  const printedEvents = [...printed.keys()].sort((a, b) => a - b)
  const positions: GcgPosition[] = []
  for (const [index, events] of printedEvents.entries()) {
    const onTurn = printed.get(events)?.onTurn
    if (onTurn === undefined) {
      continue
    }
    const movedTo = printedEvents[index + 1]
    const next = movedTo === undefined ? undefined : printed.get(movedTo)?.event
    if (movedTo === undefined) {
      positions.push({ events, turn: positions.length + 1, ...onTurn })
    } else if (next !== undefined && next.player === onTurn.player) {
      positions.push({ events, turn: positions.length + 1, ...onTurn, move: next.what, movedTo })
    }
  }
  return positions
}

/** A move as MAGPIE writes it, without its score and rack: `11H (S)ILVERED`,
 * `(exch FRV)`, `(pass)`. */
export function moveText(what: string): string {
  return what.startsWith('(') ? what.slice(0, what.indexOf(')') + 1) : what.split(/\s+/).slice(0, 2).join(' ')
}

// A placement's square and the word it formed, the board's tiles in it, in
// capitals: 11H, SILVERED.
function placement(what: string | undefined): { coordinate: string; word: string } | undefined {
  const match = /^(\d+[A-O]|[A-O]\d+)\s+(\S+)/.exec(what ?? '')
  return match === null ? undefined : { coordinate: match[1] ?? '', word: (match[2] ?? '').replace(/[()]/g, '').toUpperCase() }
}

function moveWord(what: string | undefined): string | undefined {
  return placement(what)?.word
}

const sortedTiles = (tiles: string) => [...tiles.toUpperCase()].sort().join('')

export type Choice =
  | { position: GcgPosition }
  | { goto: string }
  /** More than one position fits: the person picks. */
  | { candidates: GcgPosition[] }
  | { error: string }

/** The position a selector names among a GCG's, or what stands in the way. */
export function choosePosition(positions: readonly GcgPosition[], at: Selector | undefined): Choice {
  if (at?.kind === 'goto') {
    // Named by its turn when a player moves from there.
    const position = positions.find(candidate => String(candidate.events) === at.goto)
    return position === undefined ? { goto: at.goto } : { position }
  }
  if (positions.length === 0) {
    return { error: 'no position in the game has a player to move with a known rack' }
  }
  if (at === undefined) {
    return { position: positions[positions.length - 1] as GcgPosition }
  }
  if (at.kind === 'move') {
    // The turn whose move took the game past that event.
    const position = positions.find(
      candidate => candidate.movedTo !== undefined && candidate.events < at.event && at.event <= candidate.movedTo,
    )
    return position === undefined ? { error: `the game's move ${at.event} was no one's turn` } : { position }
  }
  if (at.kind === 'turn') {
    const position = positions.find(candidate => candidate.turn === at.turn)
    return position === undefined
      ? { error: `the game has turns 1 to ${positions.length}, not ${at.turn}` }
      : { position }
  }
  const byRack = (rack: string) => positions.filter(position => sortedTiles(position.rack) === sortedTiles(rack))
  const byWord = (word: string) => positions.filter(position => moveWord(position.move) === word)
  if (at.kind === 'after') {
    const played = positions.filter(position => {
      const move = placement(position.move)
      return move?.word === at.word && (at.coordinate === undefined || move.coordinate === at.coordinate)
    })
    // The rack its player held next: their following turn.
    const following = played.flatMap(position => {
      const next = positions.find(later => later.turn > position.turn && later.player === position.player)
      return next === undefined ? [] : [next]
    })
    if (following.length === 0) {
      return {
        error:
          played[0] === undefined
            ? `no turn of the game played ${at.word}`
            : `${at.word} was ${played[0].player}'s last turn; no rack came after it`,
      }
    }
    return following.length === 1 ? { position: following[0] as GcgPosition } : { candidates: following }
  }
  const matches =
    at.kind === 'rack'
      ? byRack(at.rack)
      : at.kind === 'word'
        ? byWord(at.word)
        : [...new Set([...byRack(at.letters), ...byWord(at.letters)])].sort((a, b) => a.events - b.events)
  const what = at.kind === 'rack' ? `rack ${at.rack}` : at.kind === 'word' ? `the word ${at.word}` : at.letters
  if (matches.length === 0) {
    return { error: `no turn of the game ${at.kind === 'letters' ? 'held or played' : 'matches'} ${what}` }
  }
  return matches.length === 1 ? { position: matches[0] as GcgPosition } : { candidates: matches }
}

/** One line per candidate position, for asking which. */
export function describePosition(position: GcgPosition): string {
  const move = position.move === undefined ? ', the latest position' : `, who played ${moveText(position.move)}`
  return `turn ${position.turn}: ${position.player} to move with ${position.rack}${move}`
}

/** The run for a position already in MAGPIE's terms: a rack, a CGP's text,
 * or a GCG's source and the `goto` that reaches its position. `shgame`
 * prints the board the picture draws. */
export function magpieRun(
  position: { kind: 'rack'; rack: string; after?: PlacedMove[] } | { kind: 'cgp'; cgp: string } | { kind: 'gcg'; source: string },
  request: { lexicon?: string; goto?: string },
  threads: number,
  accelerators: Accelerators,
): MagpieRun {
  const commands: string[] = []
  let lexicon = request.lexicon
  if (position.kind === 'rack') {
    lexicon ??= DEFAULT_LEXICON
    // Each earlier move from a rack of just its tiles, whoever's turn.
    // `commit` reads a board tile as `.`, not in parentheses.
    for (const move of position.after ?? []) {
      const word = move.word.replace(/\(([^)]*)\)/g, (_, onBoard: string) => '.'.repeat(onBoard.length))
      commands.push(`rack ${tilesFromRack(move.word)}`, `commit ${move.coordinate} ${word}`)
    }
    commands.push(`rack ${position.rack}`)
  } else if (position.kind === 'cgp') {
    const { fields, lexicon: cgpLexicon } = splitCgp(position.cgp)
    lexicon ??= cgpLexicon ?? DEFAULT_LEXICON
    commands.push(`cgp ${fields}`)
  } else {
    // `load` leaves the game at its start.
    commands.push(`load ${position.source}`, `goto ${request.goto ?? 'end'}`)
  }
  commands.push('shgame', 'gsimulate')
  return {
    args: ['setoptions', ...simOptions(lexicon, threads, accelerators)],
    stdin: `${commands.join('\n')}\n`,
    lexicon: lexicon ?? '',
  }
}
