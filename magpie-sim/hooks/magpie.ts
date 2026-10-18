// Turns what the person asks for (an opening rack, a CGP, a path or URL of a
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
const LEXICON_NAME = /^[A-Z]+\d*$/
// Pages MAGPIE's `load` knows how to read a game from.
const GAME_SITES = /(^|\.)(woogles\.io|cross-tables\.com)$/i
const COORDINATE = /^(?:\d{1,2}[A-O]|[A-O]\d{1,2})$/
const PLAYED_WORD = /^[A-Za-z?.()]+$/

/** Where `/magpie next turn` and the like move in the game the pane shows. */
export type Navigation = 'next' | 'previous' | 'first' | 'last'

/** What the person asked for, as the interpreter model reads their words, or
 * as the simulate tool's caller states it. */
export type Intent =
  | {
      action: 'sim'
      /** An opening rack, a CGP, or a path or URL of a .cgp or .gcg; left out,
       * the game or position the pane shows now. */
      position?: string
      lexicon?: string
      /** For a rack: the moves played before it. */
      after?: PlacedMove[]
      /** For a GCG, which position: one of these. */
      turn?: number
      rack?: string
      word?: string
      /** With `word`: the rack it was played `from` (the default), or its
       * player's next rack, `after` it. */
      relation?: 'from' | 'after'
      /** Letters that could be the rack or the word. */
      letters?: string
      /** MAGPIE's goto: events played, or start or end. */
      event?: number | 'start' | 'end'
    }
  | { action: 'navigate'; to: Navigation }
  | { action: 'lexicon'; lexicon: string }
  | { action: 'reopen' }
  | { action: 'unclear'; question: string }

/** What the interpreter knows of the pane: the analysis it shows, if any,
 * and the lexicons MAGPIE has. */
export type InterpreterContext = {
  current?: { label: string; source: string; lexicon: string; turn?: number; turns?: number }
  lexica: readonly string[]
}

/** The interpreter's instructions and the person's words, with what the
 * pane shows now. */
export function interpreterPrompt(text: string, context: InterpreterContext): { system: string; prompt: string } {
  const current = context.current
  const state =
    current === undefined
      ? 'The pane shows nothing yet.'
      : [
          `The pane shows ${current.label} (from ${current.source})`,
          current.lexicon === '' ? '' : `in ${current.lexicon}`,
          current.turn === undefined ? '' : `at turn ${current.turn} of ${current.turns ?? '?'}`,
        ]
          .filter(part => part !== '')
          .join(' ') + '.'
  const lexica =
    context.lexica.length === 0
      ? 'The lexicons installed are not known; use the usual names (CSW24, NWL23).'
      : `The lexicons installed: ${context.lexica.join(', ')}. A family name (csw, nwl, twl) means its newest one here.`
  const system = `You read what a person typed after /magpie, a command that analyzes crossword (Scrabble) positions with the MAGPIE engine, and reply with one JSON object and nothing else.

The object is one of:
- {"action":"sim", ...} to analyze a position, with these fields as they apply:
  "position": an opening rack (up to 7 tiles, ? for a blank, in capitals), a CGP string copied whole, or a path or URL of a .cgp or .gcg file copied exactly (keep any #13# on a cross-tables link). Leave it out to mean the game or position the pane shows now.
  "lexicon": a lexicon name, e.g. "NWL23", only if the person names one.
  "after": for a rack, the moves played before it, in order: [{"coordinate":"8G","word":"VAV"}]. A coordinate is a row number then a column letter for across (8G) or a column letter then a row number for down (H8), in capitals. Write a word in capitals when the person typed it all in lowercase; when they mixed cases, keep their case (a lowercase letter is a blank). A tile already on the board is a "." or in parentheses.
  For a game (a GCG), which position, at most one of:
  "turn": a turn number, 1 being the game's first move.
  "rack": letters the player to move held then.
  "word" with "relation": a word played in the game; "from" (the default) is the turn it was played on, "after" is the next rack of the player who played it.
  "letters": letters that could be either the rack or the word, when the person does not say which.
  "event": MAGPIE's goto, a number of events played, or "start" or "end".
  With none of them, the game's latest position.
- {"action":"navigate","to":"next"|"previous"|"first"|"last"} to move to another turn of the game the pane shows ("next turn", "back", "first turn", "end of game").
- {"action":"lexicon","lexicon":"CSW24"} to analyze what the pane shows again in another lexicon, when the person names only a lexicon.
- {"action":"reopen"} to show the pane again without a new analysis.
- {"action":"unclear","question":"..."} when you cannot tell what they mean; ask one short question.

Words like "sim", "opening", "rack", "the", "turn", "where", "played" only say what the rest is. Words are case-insensitive except as "after" says.

Examples:
"ADOPQRR" -> {"action":"sim","position":"ADOPQRR"}
"opening rack rucksex" -> {"action":"sim","position":"RUCKSEX"}
"rucksex nwl" -> {"action":"sim","position":"RUCKSEX","lexicon":"NWL23"}
"AEINRST after 8g vav" -> {"action":"sim","position":"AEINRST","after":[{"coordinate":"8G","word":"VAV"}]}
"~/games/r3.gcg turn 12" -> {"action":"sim","position":"~/games/r3.gcg","turn":12}
"https://woogles.io/game/abc the turn where I played VODKA" -> {"action":"sim","position":"https://woogles.io/game/abc","word":"VODKA","relation":"from"}
"game.gcg after silvered" -> {"action":"sim","position":"game.gcg","word":"SILVERED","relation":"after"}
"game.gcg DEEILRV" -> {"action":"sim","position":"game.gcg","letters":"DEEILRV"}
"turn 14" -> {"action":"sim","turn":14}
"prev" -> {"action":"navigate","to":"previous"}
"csw" -> {"action":"lexicon","lexicon":"CSW24"}`
  return { system, prompt: `${state}\n${lexica}\n\nWhat they typed: ${text}` }
}

const NAVIGATIONS: readonly Navigation[] = ['next', 'previous', 'first', 'last']

/** The interpreter's reply as an Intent; throws on anything else. */
export function parseIntent(reply: string): Intent {
  const json = /\{[\s\S]*\}/.exec(reply)?.[0]
  if (json === undefined) {
    throw new Error(`the reply held no JSON: ${reply.slice(0, 200)}`)
  }
  const value: unknown = JSON.parse(json)
  if (typeof value !== 'object' || value === null) {
    throw new Error('the reply was not an object')
  }
  const fields = value as Record<string, unknown>
  const text = (name: string) => (typeof fields[name] === 'string' && fields[name] !== '' ? (fields[name] as string) : undefined)
  switch (fields.action) {
    case 'navigate': {
      const to = NAVIGATIONS.find(navigation => navigation === fields.to)
      if (to === undefined) {
        throw new Error(`no way to move called ${String(fields.to)}`)
      }
      return { action: 'navigate', to }
    }
    case 'lexicon': {
      const lexicon = text('lexicon')
      if (lexicon === undefined) {
        throw new Error('a lexicon change that names no lexicon')
      }
      return { action: 'lexicon', lexicon: lexicon.toUpperCase() }
    }
    case 'reopen':
      return { action: 'reopen' }
    case 'unclear':
      return { action: 'unclear', question: text('question') ?? 'What should I sim?' }
    case 'sim': {
      const intent: Extract<Intent, { action: 'sim' }> = { action: 'sim' }
      const position = text('position')
      const lexicon = text('lexicon')
      if (position !== undefined) {
        intent.position = position
      }
      if (lexicon !== undefined) {
        intent.lexicon = lexicon.toUpperCase()
      }
      if (Array.isArray(fields.after)) {
        intent.after = fields.after.map(move => {
          const { coordinate, word } = (move ?? {}) as Record<string, unknown>
          return { coordinate: String(coordinate ?? ''), word: String(word ?? '') }
        })
      }
      if (typeof fields.turn === 'number') {
        intent.turn = fields.turn
      }
      for (const name of ['rack', 'word', 'letters'] as const) {
        const value = text(name)
        if (value !== undefined) {
          intent[name] = value
        }
      }
      if (fields.relation === 'after' || fields.relation === 'from') {
        intent.relation = fields.relation
      }
      if (typeof fields.event === 'number' || fields.event === 'start' || fields.event === 'end') {
        intent.event = fields.event
      }
      return intent
    }
    default:
      throw new Error(`no action called ${String(fields.action)}`)
  }
}

/** A lexicon name as MAGPIE spells it, if it has that lexicon (when the
 * list is known). */
export function checkLexicon(lexicon: string, lexica: readonly string[]): string {
  const name = lexicon.toUpperCase()
  if (!LEXICON_NAME.test(name)) {
    throw new Error(`"${lexicon}" is not a lexicon name`)
  }
  if (lexica.length > 0 && !lexica.includes(name)) {
    throw new Error(`MAGPIE has no ${name}; it has ${lexica.join(', ')}`)
  }
  return name
}

/** The request a sim intent makes: its position read for its kind, and for
 * a game which position. Left out, the position is the one the pane shows
 * (`previous`), in its lexicon unless the intent names another. */
export function requestFromIntent(intent: Extract<Intent, { action: 'sim' }>, previous?: SimRequest): SimRequest {
  const source = intent.position?.trim() ?? ''
  const base = source !== '' ? undefined : previous
  if (source === '' && base === undefined) {
    throw new Error('name a position: an opening rack, a CGP, or a .cgp or .gcg path or URL')
  }
  const request: SimRequest =
    base === undefined
      ? { position: classifyPosition(source), label: positionLabel(source), source }
      : { position: base.position, label: base.label, source: base.source }
  const lexicon = intent.lexicon ?? base?.lexicon
  if (lexicon !== undefined) {
    request.lexicon = lexicon
  }
  const at = selectorOf(intent)
  const position = request.position
  if (position.kind === 'rack' || position.kind === 'cgp') {
    if (at !== undefined) {
      throw new Error('a turn, rack or word picks a position in a game (a GCG); this position is the whole of what to sim')
    }
    if (intent.after !== undefined && intent.after.length > 0) {
      if (position.kind === 'cgp') {
        throw new Error('a CGP is the whole position; play the moves into it instead')
      }
      const after = intent.after.map(placedMove)
      request.position = { kind: 'rack', rack: position.rack, after }
      request.label = `${position.rack} after ${after.map(move => `${move.coordinate} ${move.word}`).join(', ')}`
    }
    return request
  }
  if (at !== undefined) {
    request.at = at
  } else {
    const move = base === undefined ? gameFragmentMove(source) : undefined
    if (move !== undefined && move > 0) {
      request.at = { kind: 'move', event: move }
    }
  }
  return request
}

function placedMove(move: PlacedMove): PlacedMove {
  const coordinate = move.coordinate.toUpperCase()
  if (!COORDINATE.test(coordinate) || !PLAYED_WORD.test(move.word)) {
    throw new Error(`"${move.coordinate} ${move.word}" is not a move: a square (8G, H8) and the word played there`)
  }
  return { coordinate, word: canonicalWord(move.word) }
}

// Which position of a game the intent names, if any.
function selectorOf(intent: Extract<Intent, { action: 'sim' }>): Selector | undefined {
  const asWord = (word: string) => word.replace(/[^A-Za-z]/g, '').toUpperCase()
  if (intent.turn !== undefined) {
    if (!Number.isInteger(intent.turn) || intent.turn < 1) {
      throw new Error(`a turn is a number from 1, not ${intent.turn}`)
    }
    return { kind: 'turn', turn: intent.turn }
  }
  if (intent.event !== undefined) {
    return { kind: 'goto', goto: String(intent.event) }
  }
  if (intent.word !== undefined) {
    return intent.relation === 'after' ? { kind: 'after', word: asWord(intent.word) } : { kind: 'word', word: asWord(intent.word) }
  }
  if (intent.rack !== undefined) {
    if (!RACK.test(intent.rack)) {
      throw new Error(`a rack is 1 to 7 tiles, not "${intent.rack}"`)
    }
    return { kind: 'rack', rack: intent.rack.toUpperCase() }
  }
  if (intent.letters !== undefined) {
    return { kind: 'letters', letters: asWord(intent.letters) }
  }
  return undefined
}

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
