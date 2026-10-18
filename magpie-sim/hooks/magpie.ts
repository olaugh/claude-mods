// Turns what the person asks for (an opening rack, a CGP, a path or URL of a
// CGP or GCG, and for a GCG which position in it) into a MAGPIE run:
// `setoptions` with the sim's settings on the command line, which keeps
// MAGPIE reading commands, then the position and `gsimulate` on its
// standard input.

import { BOARD_DIM, COLUMN_LETTERS, premiumAt } from './layout'

export const DEFAULT_LEXICON = 'CSW24'
// 5,000 iterations for each of the top 50 plays, shared evenly.
export const SIM_PLAYS = 50
export const ITERATIONS_PER_PLAY = 5000
export const SIM_PLIES = 4
// Long enough never to cut the iterations short.
const SIM_TIME_LIMIT_SECONDS = 3600
// More `next`s than any game has events; the ones past its end only say so.
const SCAN_STEPS = 150
// The tiles a rack holds.
const RACK_TILES = 7

/** A play as `commit` takes it: `8G VAV`, lowercase a blank. */
export type PlacedMove = {
  coordinate: string
  word: string
  /** The tiles its player kept, when known: committed from the whole rack. */
  leave?: string
}

export type Position =
  /** A rack to move with, after the moves played before it, if any. */
  | { kind: 'rack'; rack: string; after?: PlacedMove[] }
  // The rest, each with the moves played after it and the rack to move with
  // then, when moves followed.
  | { kind: 'cgp'; cgp: string; after?: PlacedMove[]; rack?: string }
  /** A path, URL or cross-tables or Woogles game id: MAGPIE's `load` fetches it. */
  | { kind: 'gcg'; source: string; after?: PlacedMove[]; rack?: string }
  /** A URL of unknown content: fetched, then read as a CGP or a GCG. */
  | { kind: 'url'; url: string; after?: PlacedMove[]; rack?: string }
  /** A local file of unknown content: read, then the same. */
  | { kind: 'file'; path: string; after?: PlacedMove[]; rack?: string }

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
  /** Moves played on from what the pane shows, in order, then the rack to
   * move with (left out: asked for). */
  | { action: 'play'; moves: MoveDescription[]; rack?: string }
  | { action: 'navigate'; to: Navigation }
  | { action: 'lexicon'; lexicon: string }
  | { action: 'reopen' }
  /** A picture of what the pane shows, sent to the person (for a phone). */
  | { action: 'picture' }
  | { action: 'unclear'; question: string }

/** What the interpreter knows of the pane: the analysis it shows, if any,
 * the moves played to reach it, the rack to move with, its top plays; and
 * the lexicons MAGPIE has. */
export type InterpreterContext = {
  current?: {
    label: string
    source: string
    lexicon: string
    turn?: number
    turns?: number
    moves?: readonly string[]
    rack?: string
    topPlays?: readonly string[]
  }
  lexica: readonly string[]
  /** A question the last /magpie asked, and what was typed up to it. */
  asked?: { typed: readonly string[]; question: string }
}

/** The interpreter's instructions and the person's words, with what the
 * pane shows now. */
export function interpreterPrompt(text: string, context: InterpreterContext): { system: string; prompt: string } {
  const current = context.current
  const state =
    current === undefined
      ? 'The pane shows nothing yet.'
      : [
          [
            `The pane shows ${current.label} (from ${current.source})`,
            current.lexicon === '' ? '' : `in ${current.lexicon}`,
            current.turn === undefined ? '' : `at turn ${current.turn} of ${current.turns ?? '?'}`,
          ]
            .filter(part => part !== '')
            .join(' ') + '.',
          current.moves === undefined || current.moves.length === 0 ? '' : `Moves played to reach it: ${current.moves.join(', ')}.`,
          current.rack === undefined || current.rack === '' ? 'The rack to move with is not known yet.' : `The player to move (the person) holds ${current.rack}.`,
          current.topPlays === undefined || current.topPlays.length === 0 ? '' : `Its top plays: ${current.topPlays.join(', ')}.`,
        ]
          .filter(part => part !== '')
          .join('\n')
  const asked =
    context.asked === undefined
      ? ''
      : `\nTheir last /magpie asked them something. What they typed: "${context.asked.typed.join('", then "')}". It asked: "${context.asked.question}". When what they type now answers it, reply with that whole request again with the answer folded in (a square or score picks a placement; "the second z" names the blank: JAZz); otherwise read it alone.`
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
- {"action":"picture"} to send a picture of what the pane shows ("send it to my phone", "picture", "image").
- {"action":"unclear","question":"..."} when you cannot tell what they mean; ask one short question.
- {"action":"play","moves":[...],"rack":"..."} when the person tells what was played from the position the pane shows, as a game goes on: each move in order, then the rack they now hold.
  A move: {"word":"INERTIAS"} with whatever they said of it: "by" ("me" for the person, "opponent"), "square" (its first tile's square, 8H or H8 as above), "direction" ("across" or "down"), "score", "through" (tiles on the board it went through: [{"letter":"A","word":"INERTIAS"}], the word on the board each is in), "premium" ("TW", "DW", "TL" or "DL": "to the TWS" is TW). "leave": the tiles they kept ("keeping ion" is "ION"). A pass is {"pass":true}. The word is in capitals, the board's tiles in it included; when they say which tile was a blank, that letter alone in lowercase ("the second z was the blank": JAZz). Moves alternate: the person's own first move is from the rack they hold, often one of the top plays.
  "rack": the tiles they hold now, in capitals, ? for a blank; a ? after letters is the blank ("polish?" is ?HILOPS, not a question), and a rack is not a word to look up. Leave it out when they have not said.

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
"inertias was played. opp played zag through the a in inertias. next rack for me is polish?" -> {"action":"play","moves":[{"word":"INERTIAS","by":"me"},{"word":"ZAG","by":"opponent","through":[{"letter":"A","word":"INERTIAS"}]}],"rack":"?HILOPS"}
"I played qi at 8g for 22, they passed, now I have aeinrst" -> {"action":"play","moves":[{"word":"QI","by":"me","square":"8G","score":22},{"pass":true,"by":"opponent"}],"rack":"AEINRST"}
"my rack is now deeilrv" -> {"action":"play","moves":[],"rack":"DEEILRV"}
"I played jazz 8g keeping ion" -> {"action":"play","moves":[{"word":"JAZZ","by":"me","square":"8G","leave":"ION"}]}
"prev" -> {"action":"navigate","to":"previous"}
"csw" -> {"action":"lexicon","lexicon":"CSW24"}`
  return { system, prompt: `${state}\n${lexica}${asked}\n\nWhat they typed: ${text}` }
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
    case 'picture':
      return { action: 'picture' }
    case 'play': {
      const moves = Array.isArray(fields.moves) ? fields.moves.map(parseMove) : []
      const rack = text('rack')?.toUpperCase()
      if (rack !== undefined && !RACK.test(rack)) {
        throw new Error(`a rack is 1 to 7 tiles, not "${rack}"`)
      }
      return rack === undefined ? { action: 'play', moves } : { action: 'play', moves, rack }
    }
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
    // Mapped, the 1.9 GB RIT costs no time to load; pages come in as used.
    '-ritmmap', String(accelerators.rit),
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

/** A position with tiles in the bag is simmed; one with the bag empty has its
 * endgame solved. */
export type Mode = 'sim' | 'endgame'

// The endgame solver's best first moves to list, each with its line.
export const ENDGAME_PLAYS = 50
// The most tiles the player to move can fail to see with the bag empty: the
// other rack.
const ENDGAME_UNSEEN = 7
// An English set, which a CGP's unseen tiles are counted from.
const TILES_IN_SET = 100

export function modeFor(unseen: number | undefined): Mode {
  return unseen !== undefined && unseen <= ENDGAME_UNSEEN ? 'endgame' : 'sim'
}

/** The tiles a CGP's player to move cannot see: the set less the board's and
 * their rack's. */
export function cgpUnseen(cgp: string): number {
  const [board = '', racks = ''] = cgp.trim().split(/\s+/)
  const onBoard = (board.match(/[A-Za-z]/g) ?? []).length
  const rack = (racks.split('/')[0] ?? '').length
  return TILES_IN_SET - onBoard - rack
}

// The settings an endgame solve runs with, after `setoptions`.
function endgameOptions(lexicon: string | undefined, threads: number): string[] {
  return [
    ...(lexicon === undefined ? [] : ['-lex', lexicon]),
    '-wmp', 'true',
    '-etopk', String(ENDGAME_PLAYS),
    '-threads', String(threads),
    '-hr', 'false',
    ...ASCII_BOARD,
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
  /** How many tiles the player to move cannot see: the bag and the other
   * rack; an endgame from seven or fewer. */
  unseen?: number
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
  const printed = new Map<
    number,
    { onTurn?: { player: string; rack: string; unseen?: number }; event?: { player: string; what: string } }
  >()
  for (const game of output.split(PRINTED_GAME)) {
    if (!/A B C D E F G H I J K L M N O/.test(game)) {
      continue
    }
    const event = EVENT.exec(game)
    const onTurn = ON_TURN.exec(game)
    const unseen = /Unseen: (\d+)/.exec(game)?.[1]
    printed.set(event === null ? 0 : Number(event[1]), {
      onTurn:
        onTurn === null
          ? undefined
          : {
              player: onTurn[1] ?? '',
              rack: onTurn[2] ?? '',
              ...(unseen === undefined ? {} : { unseen: Number(unseen) }),
            },
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

/** A position already in MAGPIE's terms: a rack, a CGP's text, or a GCG's
 * source; each with the moves played after it and the rack to move with
 * then (a rack position's always; a CGP's or GCG's when moves followed). */
export type Resolved =
  | { kind: 'rack'; rack: string; after?: PlacedMove[] }
  | { kind: 'cgp'; cgp: string; after?: PlacedMove[]; rack?: string }
  | { kind: 'gcg'; source: string; after?: PlacedMove[]; rack?: string }

/** The commands that commit moves, whoever's turn: each from a rack of its
 * tiles and the leave its player kept, when known. `commit` reads a board
 * tile as `.`, not in parentheses. */
export function commitCommands(moves: readonly PlacedMove[]): string[] {
  return moves.flatMap(move =>
    move.coordinate === 'pass'
      ? ['commit pass']
      : [
          `rack ${tilesFromRack(move.word)}${move.leave ?? ''}`,
          `commit ${move.coordinate} ${move.word.replace(/\(([^)]*)\)/g, (_, onBoard: string) => '.'.repeat(onBoard.length))}`,
        ],
  )
}

// The commands that reach a position, before what it is for: the board and
// the moves after it, not the rack to move with.
function setupCommands(position: Resolved, request: { lexicon?: string; goto?: string }) {
  const commands: string[] = []
  let lexicon = request.lexicon
  if (position.kind === 'rack') {
    lexicon ??= DEFAULT_LEXICON
  } else if (position.kind === 'cgp') {
    const { fields, lexicon: cgpLexicon } = splitCgp(position.cgp)
    lexicon ??= cgpLexicon ?? DEFAULT_LEXICON
    commands.push(`cgp ${fields}`)
  } else {
    // `load` leaves the game at its start.
    commands.push(`load ${position.source}`, `goto ${request.goto ?? 'end'}`)
  }
  commands.push(...commitCommands(position.after ?? []))
  return { commands, lexicon }
}

/** The run for a position: reached, its rack set, then simmed or its
 * endgame solved. `shgame` prints the board the picture draws. */
export function magpieRun(
  position: Resolved,
  request: { lexicon?: string; goto?: string },
  threads: number,
  accelerators: Accelerators,
  mode: Mode = 'sim',
): MagpieRun {
  const { commands, lexicon } = setupCommands(position, request)
  if (position.rack !== undefined && position.rack !== '') {
    commands.push(`rack ${position.rack}`)
  }
  commands.push('shgame', mode === 'endgame' ? 'endgame' : 'gsimulate')
  return {
    args: ['setoptions', ...(mode === 'endgame' ? endgameOptions(lexicon, threads) : simOptions(lexicon, threads, accelerators))],
    stdin: `${commands.join('\n')}\n`,
    lexicon: lexicon ?? '',
  }
}

// Every legal play listed, however many.
const ALL_PLAYS = 10000

/** The run that lists every legal play of the player to move from each of
 * `racks`, on the board the position reaches: a move's legal placements.
 * No wordmap: the lexicon's DAWG alone, which loads at once. */
export function generateRun(position: Resolved, request: { lexicon?: string; goto?: string }, racks: readonly string[]): MagpieRun {
  const { commands, lexicon } = setupCommands(position, request)
  commands.push('shgame', ...racks.flatMap(rack => [`rack ${rack}`, 'generate']))
  return {
    args: [
      'setoptions',
      ...(lexicon === undefined ? [] : ['-lex', lexicon]),
      '-wmp', 'false',
      '-s1', 'equity', '-s2', 'equity', '-r1', 'all', '-r2', 'all',
      '-numplays', String(ALL_PLAYS), '-maxnumdplays', String(ALL_PLAYS), '-shwithmoves', 'false',
      '-hr', 'false',
      ...ASCII_BOARD,
    ],
    stdin: `${commands.join('\n')}\n`,
    lexicon: lexicon ?? '',
  }
}

/** A legal play as `generate` lists it: `H8 (I)NERTIAS 77 77.00`. */
export type GeneratedPlay = { coordinate: string; word: string; score: number; equity: number }

const GENERATED = /^\s*\d+:\s+(\d+[A-O]|[A-O]\d+)\s+(\S+)\s+(?:\S+\s+)?(-?\d+)\s+(-?\d+(?:\.\d+)?)\s*$/

/** Each `generate`'s placements (exchanges and passes left out), in order,
 * each list closed by its `Showing N of M plays`. */
export function parseGenerated(output: string): GeneratedPlay[][] {
  const lists: GeneratedPlay[][] = []
  let list: GeneratedPlay[] = []
  for (const line of output.split('\n')) {
    const play = GENERATED.exec(line)
    if (play !== null) {
      list.push({ coordinate: play[1] ?? '', word: play[2] ?? '', score: Number(play[3]), equity: Number(play[4]) })
    } else if (/^Showing \d+ of \d+ plays/.test(line)) {
      lists.push(list)
      list = []
    }
  }
  return lists
}

/** A move as the person described it: its word (the board's tiles in it
 * included) and whatever narrows where it went. */
export type MoveDescription = {
  word: string
  by?: 'me' | 'opponent'
  /** `8H` across, `H8` down: where its first tile is. */
  square?: string
  direction?: 'across' | 'down'
  score?: number
  /** Board tiles it went through, each with the word on the board it is in. */
  through?: { letter: string; word?: string }[]
  /** A premium square one of its tiles covers: "to the TWS". */
  premium?: 'TW' | 'DW' | 'TL' | 'DL'
  /** The tiles its player kept: "keeping ION". */
  leave?: string
  /** A pass, which has no word. */
  pass?: true
}

/** A word's letters in capitals, whatever marked the board's or the blanks. */
export const letters = (word: string) => word.replace(/[^A-Za-z]/g, '').toUpperCase()

/** Where each tile of a play goes, the board's own (in parentheses) marked. */
export function playSquares(coordinate: string, word: string): { row: number; col: number; letter: string; isThrough: boolean }[] {
  const across = /^(\d+)([A-O])$/.exec(coordinate)
  const down = /^([A-O])(\d+)$/.exec(coordinate)
  const row = Number(across?.[1] ?? down?.[2]) - 1
  const col = COLUMN_LETTERS.indexOf(across?.[2] ?? down?.[1] ?? '')
  const squares: { row: number; col: number; letter: string; isThrough: boolean }[] = []
  let isThrough = false
  for (const char of word) {
    if (char === '(' || char === ')') {
      isThrough = char === '('
      continue
    }
    const offset = squares.length
    squares.push({ row: row + (down !== null ? offset : 0), col: col + (across !== null ? offset : 0), letter: char, isThrough })
  }
  return squares
}

/** The squares of each run of tiles on `board` that spells `word`, across
 * or down. */
export function wordOnBoard(board: readonly string[], word: string): { row: number; col: number }[][] {
  const target = letters(word)
  const found: { row: number; col: number }[][] = []
  const scan = (at: (line: number, index: number) => { row: number; col: number }) => {
    for (let line = 0; line < BOARD_DIM; line++) {
      let run: { row: number; col: number }[] = []
      for (let index = 0; index <= BOARD_DIM; index++) {
        const square = index < BOARD_DIM ? at(line, index) : undefined
        const tile = square === undefined ? '.' : (board[square.row]?.[square.col] ?? '.')
        if (tile !== '.' && square !== undefined) {
          run.push(square)
          continue
        }
        if (run.length > 1 && run.map(({ row, col }) => board[row]?.[col] ?? '').join('').toUpperCase() === target) {
          found.push(run)
        }
        run = []
      }
    }
  }
  scan((line, index) => ({ row: line, col: index }))
  scan((line, index) => ({ row: index, col: line }))
  return found
}

/** Whether a legal play is the move described. `board` is the board it was
 * played on, for what it went through. */
export function fitsDescription(play: GeneratedPlay, description: MoveDescription, board: readonly string[]): boolean {
  if (letters(play.word) !== letters(description.word)) {
    return false
  }
  // Lowercase in what the person said marks the blanks: exactly those.
  const said = canonicalWord(spelling(description.word))
  if (said !== said.toUpperCase() && spelling(play.word) !== said) {
    return false
  }
  if (description.square !== undefined && play.coordinate !== description.square.toUpperCase()) {
    return false
  }
  if (description.direction !== undefined && (description.direction === 'across') !== /^\d/.test(play.coordinate)) {
    return false
  }
  if (description.score !== undefined && play.score !== description.score) {
    return false
  }
  const squares = playSquares(play.coordinate, play.word)
  const through = squares.filter(square => square.isThrough)
  for (const { letter, word } of description.through ?? []) {
    const runs = word === undefined ? undefined : wordOnBoard(board, word)
    const isThere = through.some(
      square =>
        square.letter.toUpperCase() === letter.toUpperCase() &&
        (runs === undefined || runs.some(run => run.some(({ row, col }) => row === square.row && col === square.col))),
    )
    if (!isThere) {
      return false
    }
  }
  if (description.premium !== undefined) {
    const premium = description.premium
    const isOn = squares.some(square => {
      const there = premiumAt(square.row, square.col)
      return !square.isThrough && (there === premium || (premium === 'DW' && there === 'CENTER'))
    })
    if (!isOn) {
      return false
    }
  }
  return true
}

/** The racks to find a described move from, its player's tiles unknown: the
 * word's letters less the board's it went through; a word of more than a
 * rack's tiles tries each letter it could have gone through. */
export function racksFor(description: MoveDescription): string[] {
  // Case kept: a lowercase letter is a blank the person named.
  const tiles = [...canonicalWord(spelling(description.word))]
  for (const { letter } of description.through ?? []) {
    const at = tiles.findIndex(tile => tile.toUpperCase() === letter.toUpperCase())
    if (at >= 0) {
      tiles.splice(at, 1)
    }
  }
  if (tiles.length <= RACK_TILES) {
    return [tiles.join('')]
  }
  if (tiles.length > RACK_TILES + 1) {
    return []
  }
  // One tile was the board's: each distinct letter in turn.
  return [...new Set(tiles)].map(letter => {
    const rest = [...tiles]
    rest.splice(rest.indexOf(letter), 1)
    return rest.join('')
  })
}

const PREMIUMS: readonly NonNullable<MoveDescription['premium']>[] = ['TW', 'DW', 'TL', 'DL']

// A move of a play intent, as the interpreter wrote it.
function parseMove(value: unknown): MoveDescription {
  const fields = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>
  const by: Pick<MoveDescription, 'by'> = fields.by === 'me' || fields.by === 'opponent' ? { by: fields.by } : {}
  if (fields.pass === true) {
    return { word: '', pass: true, ...by }
  }
  if (typeof fields.word !== 'string' || letters(fields.word) === '') {
    throw new Error('a move with no word')
  }
  const move: MoveDescription = { word: canonicalWord(spelling(fields.word)), ...by }
  if (typeof fields.leave === 'string' && /^[A-Za-z?]{1,7}$/.test(fields.leave)) {
    move.leave = fields.leave.toUpperCase()
  }
  if (typeof fields.square === 'string' && COORDINATE.test(fields.square.toUpperCase())) {
    move.square = fields.square.toUpperCase()
  }
  if (fields.direction === 'across' || fields.direction === 'down') {
    move.direction = fields.direction
  }
  if (typeof fields.score === 'number') {
    move.score = fields.score
  }
  if (Array.isArray(fields.through)) {
    move.through = fields.through.flatMap(item => {
      const { letter, word } = (typeof item === 'object' && item !== null ? item : {}) as Record<string, unknown>
      return typeof letter === 'string' && /^[A-Za-z]$/.test(letter)
        ? [typeof word === 'string' && word !== '' ? { letter: letter.toUpperCase(), word: letters(word) } : { letter: letter.toUpperCase() }]
        : []
    })
  }
  const premium = PREMIUMS.find(name => name === fields.premium)
  if (premium !== undefined) {
    move.premium = premium
  }
  return move
}

/** A count of tiles: letters in capitals, `?` for blanks. */
export type Tiles = Map<string, number>

// Which letter distribution a lexicon's tiles come from, as MAGPIE picks it
// (letter_distribution.h).
const DISTRIBUTIONS: readonly [RegExp, string][] = [
  [/^(CSW|NWL|OSPD|OSW|TWL|America|CEL)/i, 'english'],
  [/^RD/i, 'german'],
  [/^NSF/i, 'norwegian'],
  [/^DISC/i, 'catalan'],
  [/^FRA/i, 'french'],
  [/^OSPS/i, 'polish'],
  [/^DSW/i, 'dutch'],
]

export function distributionName(lexicon: string): string | undefined {
  return DISTRIBUTIONS.find(([pattern]) => pattern.test(lexicon))?.[1]
}

/** A distribution file (`A,a,9,1,...`): each tile and how many the set has.
 * Undefined for a set with tiles of more than one letter, which the
 * counting here does not read. */
export function parseDistribution(csv: string): Tiles | undefined {
  const tiles: Tiles = new Map()
  for (const line of csv.split('\n')) {
    const [tile, , count] = line.split(',')
    if (tile === undefined || tile === '' || count === undefined) {
      continue
    }
    if ([...tile].length !== 1) {
      return undefined
    }
    tiles.set(tile.toUpperCase(), Number(count))
  }
  return tiles
}

/** The set less the tiles on `board` (a blank is lowercase) and `less`. */
export function tilesLeft(set: Tiles, board: readonly string[], less = ''): Tiles {
  const left = new Map(set)
  const take = (tile: string) => left.set(tile, (left.get(tile) ?? 0) - 1)
  for (const row of board) {
    for (const tile of row) {
      if (tile !== '.') {
        take(tile === tile.toUpperCase() ? tile : '?')
      }
    }
  }
  for (const tile of less) {
    take(tile === '?' || tile !== tile.toUpperCase() ? '?' : tile)
  }
  return left
}

const countOf = (tiles: string) => {
  const counts: Tiles = new Map()
  for (const tile of tiles) {
    counts.set(tile, (counts.get(tile) ?? 0) + 1)
  }
  return counts
}

/** The letters of `tiles` (a `?` a blank) that `left` cannot supply. */
export function missingTiles(tiles: string, left: Tiles): { tile: string; need: number; have: number }[] {
  return [...countOf(tiles.toUpperCase())].flatMap(([tile, need]) => {
    const have = Math.max(0, left.get(tile) ?? 0)
    return need > have ? [{ tile, need, have }] : []
  })
}

/** A rack for `needed` from what is left, a blank standing in for each
 * letter short; or which letter cannot be had even with the blanks. A
 * lowercase letter is one the person said was a blank. */
export function withBlanks(needed: string, left: Tiles): { rack: string } | { short: { tile: string; need: number; have: number; blanks: number } } {
  const blanks = Math.max(0, left.get('?') ?? 0)
  const marked = [...needed].filter(tile => tile !== tile.toUpperCase()).length
  if (marked > blanks) {
    return { short: { tile: '?', need: marked, have: blanks, blanks: 0 } }
  }
  let used = marked
  let rack = '?'.repeat(marked)
  const plain = [...needed].filter(tile => tile === tile.toUpperCase()).join('')
  for (const [tile, need] of countOf(plain)) {
    const have = Math.max(0, left.get(tile) ?? 0)
    const excess = Math.max(0, need - have)
    if (used + excess > blanks) {
      return { short: { tile, need, have, blanks: Math.max(0, blanks - used) } }
    }
    used += excess
    rack += tile.repeat(need - excess) + '?'.repeat(excess)
  }
  return { rack }
}

/** A word's letters, case kept where the person said which were blanks. */
export function spelling(word: string): string {
  return word.replace(/[^A-Za-z]/g, '')
}

/** `board` with a play's own tiles on it (its board tiles are there). */
export function applyMove(board: readonly string[], coordinate: string, word: string): string[] {
  const rows = board.map(row => [...row])
  for (const square of playSquares(coordinate, word)) {
    const row = rows[square.row]
    if (!square.isThrough && row !== undefined) {
      row[square.col] = square.letter
    }
  }
  return rows.map(row => row.join(''))
}

/** What stays of `rack` once `tiles` leave it (a blank as `?`), or null when
 * it does not hold them. */
export function rackLess(rack: string, tiles: string): string | null {
  const left = [...rack.toUpperCase()]
  for (const tile of tiles.toUpperCase()) {
    const at = left.indexOf(tile)
    if (at < 0) {
      return null
    }
    left.splice(at, 1)
  }
  return left.join('')
}

const sortTiles = (tiles: string) => [...tiles.toUpperCase()].sort().join('')

/** Whether two racks hold the same tiles, in any order. */
export function sameTiles(a: string, b: string): boolean {
  return sortTiles(a) === sortTiles(b)
}

const plural = (count: number, tile: string) =>
  `${count === 0 ? 'no' : count} ${tile === '?' ? 'blank' : tile}${count === 1 ? '' : 's'}`

/** Why a word cannot be had from what is left: "PIZZAZZ needs 4 Zs, and
 * only 1 Z and 2 blanks are left". */
export function shortText(word: string, short: { tile: string; need: number; have: number; blanks: number }): string {
  if (short.tile === '?') {
    return `${word} needs ${plural(short.need, '?')}, and only ${plural(short.have, '?')} ${short.have === 1 ? 'is' : 'are'} left`
  }
  return `${word} needs ${plural(short.need, short.tile)}, and only ${plural(short.have, short.tile)} and ${plural(short.blanks, '?')} are left`
}

/** Why a rack cannot be had: "no blank is left", "only 1 H is left". */
export function missingText(missing: readonly { tile: string; need: number; have: number }[]): string {
  return missing
    .map(({ tile, have }) => (have === 0 ? `no ${tile === '?' ? 'blank' : tile} is left` : `only ${plural(have, tile)} ${have === 1 ? 'is' : 'are'} left`))
    .join(', ')
}

const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth']

/** Which of a play's tiles are its blanks, by place among the word's same
 * letters: "the second Z", "the A", "the first E and the S". */
export function blankText(word: string): string {
  const plain = letters(word)
  const named: string[] = []
  let index = 0
  let isThrough = false
  for (const char of word) {
    if (char === '(' || char === ')') {
      isThrough = char === '('
      continue
    }
    const letter = char.toUpperCase()
    if (!isThrough && char !== letter) {
      const same = [...plain].filter(tile => tile === letter).length
      const place = [...plain.slice(0, index)].filter(tile => tile === letter).length
      named.push(same === 1 ? `the ${letter}` : `the ${ORDINALS[place] ?? `${place + 1}th`} ${letter}`)
    }
    index += 1
  }
  return named.length === 0 ? 'no blank' : named.join(' and ')
}
