import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { SortKey } from '../types'
import { cardPicture } from './card'
import { boardPicture, ROW_TILE_STEP, tilesPicture } from './draw'
import {
  cgpUnseen,
  checkLexicon,
  choosePosition,
  fitsDescription,
  generateRun,
  parseGenerated,
  racksFor,
  type GeneratedPlay,
  DEFAULT_LEXICON,
  describePosition,
  gcgPositions,
  interpreterPrompt,
  ITERATIONS_PER_PLAY,
  magpieRun,
  modeFor,
  parseIntent,
  requestFromIntent,
  scanRun,
  SIM_PLAYS,
  SIM_PLIES,
  sniffPosition,
  type Accelerators,
  type GcgPosition,
  type Intent,
  type InterpreterContext,
  type MagpieRun,
  type Mode,
  type MoveDescription,
  type PlacedMove,
  type Resolved,
  type Selector,
  type SimRequest,
} from './magpie'
import { encodePng } from './png'
import { describePlay, parseBoard, parseSim, playTiles, resultText, type Play, type Sim } from './sim'
import { boardSvg } from './svg'
import { PICTURE_HEIGHT, PICTURE_WIDTH, SQUARE } from './theme'
import { parseFont, type Font } from './truetype'

const PLUGIN = 'magpie-sim'
const PANE = 'magpie-results'
// Where MAGPIE is installed unless the magpieDir option says otherwise.
const DEFAULT_MAGPIE_DIR = '~/magpie'
// The model that reads what the person typed after /magpie: quick, and
// a short JSON reply is all it writes.
const INTERPRETER_MODEL = 'haiku'
const INTERPRETER_MAX_TOKENS = 400
const INTERPRETER_TIMEOUT_MS = 30_000
// The pane's top plays the interpreter is told of.
const TOP_PLAYS_TOLD = 8
// Ten minutes, the most $.process.run allows.
const RUN_TIMEOUT_MS = 600_000
// The TUI's font (tui/assets/magpie.ttf), under its own licence beside it.
const FONT_FILE = 'assets/FiraCodeNerdFontMono-Regular.ttf'
// The sim the pane shows before any has run.
const DEFAULT_SIM_FILE = 'sims/ADOPQRR-CSW24.txt'
// Plays the simulate tool lists for the model; the pane shows them all.
const PLAYS_REPORTED = 10
// How long after a command its picture's prompt goes: past the command's own
// turn.
const PROMPT_DELAY_MS = 100

// The terminal picture's box in cells. Cells are about twice as tall as they
// are wide, so 44 x 24 keeps the 596 x 638 picture's tiles near square.
const BOARD_COLUMNS = 44
const BOARD_ROWS = 24
// Rows the table draws above its plays: the summary and the headings.
const TABLE_CHROME_ROWS = 2
// About the full table's width (tableLayout measures it per sim), for the
// pane's opening size: room for the board beside it.
const TYPICAL_TABLE_COLUMNS = 80
const PANE_COLUMNS = BOARD_COLUMNS + 2 + TYPICAL_TABLE_COLUMNS
const PANE_ROWS = 30

const selectedId = atom({ plugin: 'magpie-sim', key: 'selectedId' } as const, '')
const sortKey = atom({ plugin: 'magpie-sim', key: 'sortKey' } as const, 'win' as SortKey)
const isDescending = atom({ plugin: 'magpie-sim', key: 'isDescending' } as const, true)
const windowTop = atom({ plugin: 'magpie-sim', key: 'windowTop' } as const, 0)
const simFile = atom({ plugin: 'magpie-sim', key: 'simFile' } as const, '')
const simText = atom({ plugin: 'magpie-sim', key: 'simText' } as const, '')
const running = atom({ plugin: 'magpie-sim', key: 'running' } as const, '')
const runError = atom({ plugin: 'magpie-sim', key: 'runError' } as const, '')
const current = atom({ plugin: 'magpie-sim', key: 'current' } as const, '')

// How many plays the table showed when last drawn, and how many it has, so
// the wheel scrolls no further than its end. The drawing clamps it again.
let lastRoom = 10
let lastCount = 0
let lastPictureMs = 0
// Whether a terminal has drawn the pane, so a move seen only on the other
// surfaces skips the RGBA picture they would not show.
let isTerminalDrawing = false

// What the mod did, newest last, for `/magpie why`.
const log: string[] = []
const LOG_KEPT = 40

function note(line: string) {
  log.push(`${new Date().toTimeString().slice(0, 8)} ${line}`)
  if (log.length > LOG_KEPT) {
    log.shift()
  }
}

let fontLoad: Promise<Font> | null = null

// Reads and parses the font once per load of the module; a failed read is
// tried again at the next draw.
export function loadFont($: EngineInterface): Promise<Font> {
  fontLoad ??= $.fs
    .read(`${$.plugin.root}/${FONT_FILE}`, { as: 'bytes' })
    .then(({ base64 }) => parseFont(Uint8Array.fromBase64(base64)))
    .catch((error: unknown) => {
      fontLoad = null
      throw error
    })
  return fontLoad
}

// Pictures by play id, for the sim loaded now.
const pictures = new Map<string, string>()
const PICTURES_KEPT = 8

// The last sim parsed, by what it was parsed from: a run's output, or a file.
let simLoad: { source: string; sim: Promise<Sim> } | null = null

async function simPath($: EngineInterface): Promise<string> {
  const file = await read($, simFile)
  return file === '' ? `${$.plugin.root}/${DEFAULT_SIM_FILE}` : file
}

// The sim the pane shows: the last run's, else the file the show tool named,
// else the one the mod ships. Parsed once each; a failed read is tried again
// at the next draw.
export async function loadSim($: EngineInterface): Promise<Sim> {
  const text = await read($, simText)
  const source = text !== '' ? text : await simPath($)
  if (simLoad?.source !== source) {
    pictures.clear()
    rowPictures.clear()
    const sim = text !== '' ? Promise.resolve().then(() => parseSim(text)) : $.fs.read(source).then(parseSim)
    simLoad = { source, sim }
    sim.catch(() => {
      if (simLoad?.sim === sim) {
        simLoad = null
      }
    })
  }
  return simLoad.sim
}

let threadCount: Promise<number> | null = null

// All the cores but two, for the sim's threads.
function threads($: EngineInterface): Promise<number> {
  threadCount ??= $.process
    .run(['getconf', '_NPROCESSORS_ONLN'])
    .then(({ stdout }) => Math.max(1, (Number.parseInt(stdout, 10) || 6) - 2))
    .catch(() => 4)
  return threadCount
}

let home: Promise<string> | null = null

async function expandHome($: EngineInterface, path: string): Promise<string> {
  if (path !== '~' && !path.startsWith('~/')) {
    return path
  }
  home ??= $.process.run(['printenv', 'HOME']).then(({ stdout }) => stdout.trim())
  return (await home) + path.slice(1)
}

// An absolute path, `~` expanded and a relative one taken from the session's
// directory; rejects when nothing is there.
async function absolutePath($: EngineInterface, path: string): Promise<string> {
  const expanded = await expandHome($, path)
  const { realPath } = await $.fs.stat(expanded, { resolve: true })
  return realPath ?? expanded
}

// The lexicon a GCG names, when its text is at hand.
function gcgLexicon(text: string): string | undefined {
  return /^#lexicon\s+(\S+)/m.exec(text)?.[1]?.toUpperCase()
}

// The MAGPIE install that runs the sims, holding bin/magpie and data/: the
// magpieDir option (~/magpie unless set), read as the module loads. Empty
// runs the magpie on PATH, whose data directory is its own business.
let magpieDir = ''

type Magpie = { binary: string; cwd?: string }

async function findMagpie($: EngineInterface): Promise<Magpie> {
  if (magpieDir === '') {
    return { binary: 'magpie' }
  }
  const dir = await expandHome($, magpieDir)
  return { binary: `${dir}/bin/magpie`, cwd: dir }
}

// Whichever of the RIT and WIT the lexicon has built. A lexicon or data
// directory not known before the run (a GCG MAGPIE fetches, the magpie on
// PATH) tries both, and the run goes again without them if MAGPIE finds them
// missing.
async function accelerators($: EngineInterface, magpie: Magpie, lexicon: string | undefined): Promise<Accelerators> {
  if (lexicon === undefined || magpie.cwd === undefined) {
    return { rit: true, wit: true }
  }
  const magpieDir = magpie.cwd
  const [rit, wit] = await Promise.all(
    ['rit', 'wit'].map(kind => $.fs.exists(`${magpieDir}/data/lexica/${lexicon}.${kind}`)),
  )
  return { rit: rit === true, wit: wit === true }
}

// The request with its position in MAGPIE's terms (Resolved), the moves
// played after it and its rack carried over.
async function resolveRequest($: EngineInterface, request: SimRequest): Promise<{ resolved: Resolved; lexicon?: string }> {
  const found = await resolvePosition($, request)
  const { after, rack } = request.position
  return {
    ...found,
    resolved: {
      ...found.resolved,
      ...(after === undefined || after.length === 0 ? {} : { after }),
      ...(rack === undefined || rack === '' || found.resolved.kind === 'rack' ? {} : { rack }),
    },
  }
}

// The position itself: a URL or file read and told apart, a local path made
// absolute for MAGPIE's own directory.
async function resolvePosition($: EngineInterface, request: SimRequest): Promise<{ resolved: Resolved; lexicon?: string }> {
  const position = request.position
  let lexicon = request.lexicon
  if (position.kind === 'rack' || position.kind === 'cgp') {
    return { resolved: position, lexicon }
  }
  if (position.kind === 'gcg') {
    if (/^https?:\/\//i.test(position.source) || !/[/.~]/.test(position.source)) {
      return { resolved: position, lexicon }
    }
    const path = await absolutePath($, position.source)
    lexicon ??= gcgLexicon(await $.fs.read(path))
    return { resolved: { kind: 'gcg' as const, source: path }, lexicon }
  }
  if (position.kind === 'url') {
    const fetched = await $.process.run(['curl', '-fsSL', '--max-time', '60', position.url], { timeoutMs: 70_000 })
    if (fetched.exitCode !== 0) {
      throw new Error(`could not fetch ${position.url}: ${fetched.stderr.trim()}`)
    }
    return sniffPosition(fetched.stdout) === 'cgp'
      ? { resolved: { kind: 'cgp' as const, cgp: fetched.stdout.trim() }, lexicon }
      : { resolved: { kind: 'gcg' as const, source: position.url }, lexicon: lexicon ?? gcgLexicon(fetched.stdout) }
  }
  const path = await absolutePath($, position.path)
  const text = await $.fs.read(path)
  return sniffPosition(text) === 'cgp'
    ? { resolved: { kind: 'cgp' as const, cgp: text.trim().split('\n')[0] ?? '' }, lexicon }
    : { resolved: { kind: 'gcg' as const, source: path }, lexicon: lexicon ?? gcgLexicon(text) }
}

// What MAGPIE said went wrong, when the run printed no sim.
function magpieErrors(stdout: string, stderr: string, otherwise: string): string {
  const lines = `${stderr}\n${stdout}`
    .split('\n')
    .map(line => line.trim())
    .filter(line => /error|fatal|not found|invalid|cannot/i.test(line))
  return lines.slice(0, 4).join('; ') || stderr.trim().slice(0, 300) || otherwise
}


/** A sim ready to run: the position in MAGPIE's terms, and for a GCG the
 * `goto` that reaches it. */
type Plan = {
  request: SimRequest
  resolved: Resolved
  lexicon?: string
  goto?: string
  label: string
  where: Magpie
  threadCount: number
  /** For a game: the turn chosen, and how many it has. */
  turn?: number
  turns?: number
  /** Simmed, or its endgame solved (the bag empty). */
  mode: Mode
}

/** What the pane says while a plan runs. */
function planStatus(plan: Plan): string {
  return plan.mode === 'endgame' ? `Solving the endgame of ${plan.label}` : `Simulating ${plan.label}: ${SIM_SHAPE}`
}

/** What the pane shows, for `/magpie next turn` and `/magpie csw`: the
 * request that made it (a game's at its turn), its lexicon, and the game's
 * turn and turns. Kept as JSON in the `current` atom. */
type Current = { request: SimRequest; label: string; lexicon: string; turn?: number; turns?: number }

async function readCurrent($: EngineInterface): Promise<Current | undefined> {
  const json = await read($, current)
  return json === '' ? undefined : (JSON.parse(json) as Current)
}

async function execute($: EngineInterface, where: Magpie, label: string, run: MagpieRun) {
  note(`running ${label}: ${where.binary} ${run.args.join(' ')} <<< ${run.stdin.trim().split('\n').slice(0, 3).join('; ')}`)
  let result
  try {
    result = await $.process.run([where.binary, ...run.args], { cwd: where.cwd, stdin: run.stdin, timeoutMs: RUN_TIMEOUT_MS })
  } catch (error) {
    throw new Error(
      `could not run ${where.binary} (${error instanceof Error ? error.message : String(error)}); install MAGPIE there, or set the mod's MAGPIE directory with \`claude plugin configure magpie-sim@olaugh-mods\``,
    )
  }
  return { result, said: result.stdout + result.stderr }
}

/** Works out what to sim, before anything runs: the position read or
 * fetched, and for a GCG which of its positions, or the ones that fit when
 * the person's turn, rack or word fits more than one. */
async function planSim($: EngineInterface, request: SimRequest): Promise<{ plan: Plan } | { candidates: GcgPosition[] }> {
  const already = await read($, running)
  if (already !== '') {
    throw new Error(`still running: ${already}`)
  }
  const { resolved, lexicon: knownLexicon } = await resolveRequest($, request)
  const where = await findMagpie($)
  let lexicon = knownLexicon
  let goto: string | undefined
  let label = request.label
  let turn: number | undefined
  let turns: number | undefined
  let mode: Mode = resolved.kind === 'cgp' ? modeFor(cgpUnseen(resolved.cgp)) : 'sim'
  if (resolved.kind === 'gcg') {
    // Every position of the game, to find the one asked for. The scan also
    // learns whether the GCG names its lexicon (one MAGPIE fetched is
    // unread here).
    let scan = await execute($, where, label, scanRun(resolved.source, lexicon))
    if (lexicon === undefined && /without a specified lexicon/.test(scan.said)) {
      lexicon = DEFAULT_LEXICON
      scan = await execute($, where, label, scanRun(resolved.source, lexicon))
    }
    const positions = gcgPositions(scan.result.stdout)
    const choice = choosePosition(positions, request.at)
    if ('error' in choice) {
      throw new Error(
        positions.length === 0 ? magpieErrors(scan.result.stdout, scan.result.stderr, choice.error) : choice.error,
      )
    }
    if ('candidates' in choice) {
      return { candidates: choice.candidates }
    }
    turns = positions.length
    if ('goto' in choice) {
      goto = choice.goto
      label = `${label} event ${goto}`
    } else {
      goto = String(choice.position.events)
      turn = choice.position.turn
      mode = modeFor(choice.position.unseen)
      label = `${label} turn ${turn}`
    }
  }
  const plan: Plan = { request, resolved, goto, label, where, threadCount: await threads($), mode }
  if (lexicon !== undefined) {
    plan.lexicon = lexicon
  }
  if (turns !== undefined) {
    plan.turns = turns
  }
  if (turn !== undefined) {
    plan.turn = turn
  }
  return { plan }
}

/** What the person's turn, rack or word was, for the question. */
function selectorText(at: Selector | undefined): string {
  switch (at?.kind) {
    case 'rack':
      return `Rack ${at.rack}`
    case 'word':
      return `The word ${at.word}`
    case 'letters':
      return at.letters
    default:
      return 'That'
  }
}

function candidateLines(candidates: readonly GcgPosition[]): string[] {
  return candidates.map(candidate => `  ${describePosition(candidate)}`)
}

/** Runs a planned sim and makes it the one the pane shows. One at a time. */
async function runPlan($: EngineInterface, plan: Plan): Promise<Sim> {
  const already = await read($, running)
  if (already !== '') {
    throw new Error(`still running: ${already}`)
  }
  await update($, running, () => planStatus(plan))
  await update($, runError, () => '')
  try {
    const started = Date.now()
    const magpie = async (accelerated: Accelerators) => {
      const run = magpieRun(plan.resolved, { lexicon: plan.lexicon, goto: plan.goto }, plan.threadCount, accelerated, plan.mode)
      return { run, ...(await execute($, plan.where, plan.label, run)) }
    }
    // The endgame solver has no use for them.
    const tried = plan.mode === 'endgame' ? { rit: false, wit: false } : await accelerators($, plan.where, plan.lexicon)
    let { run, result, said } = await magpie(tried)
    if ((tried.rit || tried.wit) && /not found for data type (rack|word) info table/.test(said)) {
      ;({ run, result } = await magpie({ rit: false, wit: false }))
    }
    const header = [run.lexicon === '' ? '' : `# lexicon ${run.lexicon}`, `# label ${plan.label}`]
    const text = `${header.filter(line => line !== '').join('\n')}\n${result.stdout}`
    let sim: Sim
    try {
      sim = parseSim(text)
    } catch {
      throw new Error(magpieErrors(result.stdout, result.stderr, 'MAGPIE printed no sim results'))
    }
    note(`${plan.label}: ${sim.plays.length} plays in ${((Date.now() - started) / 1000).toFixed(1)} s`)
    await update($, simText, () => text)
    // A game is kept at its turn, so moving from it and changing its
    // lexicon start from there.
    const shown: Current = {
      request: plan.turn === undefined ? plan.request : { ...plan.request, at: { kind: 'turn', turn: plan.turn } },
      label: plan.label,
      lexicon: run.lexicon !== '' ? run.lexicon : (plan.lexicon ?? ''),
    }
    if (plan.turn !== undefined && plan.turns !== undefined) {
      shown.turn = plan.turn
      shown.turns = plan.turns
    }
    await update($, current, () => JSON.stringify(shown))
    await update($, selectedId, () => '')
    await update($, windowTop, () => 0)
    return sim
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    note(`${plan.label} failed: ${message}`)
    await update($, runError, () => `${plan.label}: ${message}`)
    throw error
  } finally {
    await update($, running, () => '')
  }
}

type Column = {
  title: string
  sort?: SortKey
  isLeft?: true
  isCompact?: true
  cell: (play: Play) => string
}

const signed = (value: number) => (value > 0 ? '+' : '') + value.toFixed(2)

const COLUMNS: readonly Column[] = [
  { title: 'Play', sort: 'play', isLeft: true, isCompact: true, cell: play => play.id },
  { title: 'Leave', isLeft: true, cell: play => play.leave },
  { title: 'Sc', sort: 'score', isCompact: true, cell: play => String(play.score) },
  { title: 'Win%', sort: 'win', isCompact: true, cell: play => play.winPct.toFixed(2) },
  { title: '±', cell: play => play.winSe.toFixed(2) },
  { title: 'Eq', sort: 'equity', isCompact: true, cell: play => signed(play.equity) },
  { title: 'StEq', sort: 'static', cell: play => signed(play.staticEquity) },
  { title: 'Iters', sort: 'iterations', cell: play => String(play.iterations) },
  // The opponent's reply: its mean score and how often it bingoes.
  { title: 'OpSc', cell: play => play.plies[0]?.score.toFixed(1) ?? '' },
  { title: 'OpBn%', cell: play => play.plies[0]?.bingoPct.toFixed(1) ?? '' },
]

// An endgame's table: the final spread, what the line nets, and the rest of
// the line.
const ENDGAME_COLUMNS: readonly Column[] = [
  { title: 'Play', sort: 'play', isLeft: true, isCompact: true, cell: play => play.id },
  { title: 'Sc', sort: 'score', isCompact: true, cell: play => String(play.score) },
  { title: 'Result', sort: 'result', isCompact: true, cell: play => resultText(play.result) },
  { title: 'Net', sort: 'net', isCompact: true, cell: play => (play.net === undefined ? '' : `${play.net > 0 ? '+' : ''}${play.net}`) },
  { title: 'Then', isLeft: true, cell: play => play.line ?? '' },
]
// The selection marker and the sim's rank, before the columns.
const RANK_WIDTH = 5

// A tile in a row of the table: two terminal columns, one row.
const TILE_COLUMNS = 2

/** The table's columns, each as wide as its widest cell, or its title with
 * room for a sort arrow, and the width of a whole row. With `tiles`, the
 * Play column (the first) spells each play as its square and a picture of
 * its tiles: the widest square label, and room for the most tiles. */
export type TableLayout = {
  columns: readonly { column: Column; width: number }[]
  width: number
  tiles?: { labelWidth: number; slots: number }
}

export function tableLayout(
  plays: readonly Play[],
  isCompact: boolean,
  isTiled = false,
  kind: Sim['kind'] = 'sim',
): TableLayout {
  const kindColumns = kind === 'endgame' ? ENDGAME_COLUMNS : COLUMNS
  const spelled = plays.map(playTiles)
  const tiles = isTiled
    ? {
        labelWidth: Math.max(0, ...spelled.map(play => play.label.length)),
        slots: Math.max(1, ...spelled.map(play => play.tiles.length)),
      }
    : undefined
  const columns = (isCompact ? kindColumns.filter(column => column.isCompact) : kindColumns).map(column => ({
    column,
    width: Math.max(
      column.title.length + (column.sort === undefined ? 0 : 1),
      ...(tiles !== undefined && column.sort === 'play'
        ? [tiles.labelWidth + 1 + TILE_COLUMNS * tiles.slots]
        : plays.map(play => column.cell(play).length)),
    ),
  }))
  const width = columns.reduce((total, { width: columnWidth }) => total + 1 + columnWidth, RANK_WIDTH)
  return tiles === undefined ? { columns, width } : { columns, width, tiles }
}

function sortValue(play: Play, key: SortKey): number {
  switch (key) {
    case 'win':
      return play.winPct
    case 'equity':
      return play.equity
    case 'score':
      return play.score
    case 'static':
      return play.staticEquity
    case 'iterations':
      return play.iterations
    case 'result':
      return play.result ?? 0
    case 'net':
      return play.net ?? 0
    case 'play':
      return 0
  }
}

export function sortPlays(plays: readonly Play[], key: SortKey, descending: boolean): Play[] {
  return [...plays].sort((a, b) => {
    const order = key === 'play' ? a.tiles.localeCompare(b.tiles) : sortValue(a, key) - sortValue(b, key)
    return (descending ? -order : order) || a.rank - b.rank
  })
}

// The first play the table shows: the stored one, moved just far enough to
// keep the selected play in view.
export function windowStart(top: number, index: number, room: number, count: number): number {
  const start = Math.min(Math.max(top, index - room + 1), index)
  return Math.min(Math.max(0, start), Math.max(0, count - room))
}

function pad(text: string, column: Column, width: number): string {
  return column.isLeft ? text.padEnd(width) : text.padStart(width)
}

export function headerLine(layout: TableLayout, key: SortKey, descending: boolean): string {
  const titles = layout.columns.map(({ column, width }) =>
    pad(column.title + (column.sort === key ? (descending ? '▼' : '▲') : ''), column, width),
  )
  return ['#'.padStart(RANK_WIDTH), ...titles].join(' ')
}

// The rank is the sim's own, by win%, whatever the table's order.
function rankCell(play: Play, isSelected: boolean): string {
  return (isSelected ? '▶' : ' ') + String(play.rank).padStart(RANK_WIDTH - 1)
}

export function rowLine(layout: TableLayout, play: Play, isSelected: boolean): string {
  const cells = layout.columns.map(({ column, width }) => pad(column.cell(play), column, width))
  return [rankCell(play, isSelected), ...cells].join(' ')
}

/** A tiled row's text either side of its tiles' picture: the rank and the
 * play's square, then the rest of the columns, so the row is as wide as
 * the header. */
export function rowParts(layout: TableLayout, play: Play, isSelected: boolean): { before: string; after: string } {
  const [playColumn, ...rest] = layout.columns
  if (layout.tiles === undefined || playColumn === undefined) {
    return { before: rowLine(layout, play, isSelected), after: '' }
  }
  const spelled = layout.tiles.labelWidth + 1 + TILE_COLUMNS * layout.tiles.slots
  return {
    before: `${rankCell(play, isSelected)} ${playTiles(play).label.padEnd(layout.tiles.labelWidth)} `,
    after:
      ' '.repeat(playColumn.width - spelled) +
      rest.map(({ column, width }) => ` ${pad(column.cell(play), column, width)}`).join(''),
  }
}

export function summaryLine(sim: Sim): string {
  const parts = [
    sim.label !== '' && sim.label !== sim.rack ? `${sim.label}, rack ${sim.rack}` : sim.rack,
    sim.lexicon,
    ...(sim.kind === 'endgame'
      ? [`endgame solved ${sim.plies} plies deep in ${sim.seconds.toFixed(1)} s`]
      : [
          `${sim.plies} ${sim.plies === 1 ? 'ply' : 'plies'}`,
          `${sim.iterations.toLocaleString('en-US')} iters in ${sim.seconds.toFixed(1)} s`,
        ]),
  ]
  return parts.filter(part => part !== '').join(' · ')
}

/** The top plays as the simulate tool reports them to the model. */
export function reportLines(sim: Sim, count: number): string[] {
  if (sim.kind === 'endgame') {
    return sim.plays
      .slice(0, count)
      .map(
        play =>
          `${play.rank}. ${play.id}: ${play.score} pts, ${resultText(play.result)}, net ${play.net ?? 0}${play.line === '' || play.line === undefined ? '' : `; then ${play.line}`}`,
      )
  }
  return sim.plays
    .slice(0, count)
    .map(
      play =>
        `${play.rank}. ${play.id}${play.leave === '' ? '' : ` (keeps ${play.leave})`}: ${play.score} pts, win ${play.winPct.toFixed(2)}% ±${play.winSe.toFixed(2)}, equity ${signed(play.equity)}`,
    )
}

// The selected play's picture as RGBA bytes, the last few kept: each is about
// 1.6 MB of base64.
function pictureSource(font: Font, sim: Sim, play: Play) {
  let rgba = pictures.get(play.id)
  if (rgba === undefined) {
    const started = Date.now()
    rgba = boardPicture(font, sim.board, sim.rack, play).pixels.toBase64()
    lastPictureMs = Date.now() - started
    if (pictures.size >= PICTURES_KEPT) {
      const oldest = pictures.keys().next().value
      if (oldest !== undefined) {
        pictures.delete(oldest)
      }
    }
  } else {
    pictures.delete(play.id)
  }
  pictures.set(play.id, rgba)
  return { rgba, width: PICTURE_WIDTH, height: PICTURE_HEIGHT }
}

async function sortedPlays($: EngineInterface, sim: Sim): Promise<Play[]> {
  return sortPlays(sim.plays, await read($, sortKey), await read($, isDescending))
}

// Where the selected play stands in the table: the first play when nothing
// is selected yet, or the selection is not in this sim.
function selectedIndex(sorted: readonly Play[], id: string): number {
  return Math.max(0, sorted.findIndex(play => play.id === id))
}

/** A row's click: its play on the board. */
async function selectPlay($: EngineInterface, id: string) {
  if ((await read($, selectedId)) === id) {
    return
  }
  // Swap the picture at once; the redraw the write below causes draws the
  // same source, which sends nothing. Refused where no terminal picture is
  // mounted (the other surfaces draw an Svg), and a failed swap must not
  // stop the selection: that redraw draws the new picture anyway.
  const sim = await loadSim($)
  const play = sim.plays.find(candidate => candidate.id === id)
  if (play !== undefined && isTerminalDrawing) {
    try {
      await $.ui.blit({ requestId: PANE, key: 'board', source: pictureSource(await loadFont($), sim, play) })
    } catch {
      // The redraw below shows it.
    }
  }
  await update($, selectedId, () => id)
}

// A row's tiles as RGBA bytes, by play, for the sim loaded now.
const rowPictures = new Map<string, string>()

function rowTilesSource(font: Font, play: Play, slots: number) {
  const key = `${slots}:${play.id}`
  let rgba = rowPictures.get(key)
  if (rgba === undefined) {
    rgba = tilesPicture(font, playTiles(play).tiles, slots).pixels.toBase64()
    rowPictures.set(key, rgba)
  }
  return { rgba, width: slots * ROW_TILE_STEP, height: SQUARE }
}

async function sortBy($: EngineInterface, key: SortKey) {
  if ((await read($, sortKey)) === key) {
    await update($, isDescending, descending => !descending)
  } else {
    await update($, sortKey, () => key)
    // Numbers sort high first, plays A to Z.
    await update($, isDescending, () => key !== 'play')
  }
  const sorted = await sortedPlays($, await loadSim($))
  const index = selectedIndex(sorted, await read($, selectedId))
  await update($, windowTop, top => windowStart(top, index, lastRoom, sorted.length))
}

async function openPane($: EngineInterface, title: string, focus: boolean): Promise<string> {
  const opened = await $.ui.open({
    id: PANE,
    title,
    focus: focus ? true : undefined,
    rows: PANE_ROWS,
    columns: PANE_COLUMNS,
  })
  return opened.isPlaced ? 'Opened the MAGPIE sim pane' : `The pane waits undrawn: ${opened.reason}`
}

async function currentTitle($: EngineInterface): Promise<string> {
  try {
    const sim = await loadSim($)
    return `MAGPIE · ${sim.label || sim.rack}`
  } catch {
    return 'MAGPIE'
  }
}

const SIM_SHAPE = `${SIM_PLAYS} plays × ${ITERATIONS_PER_PLAY.toLocaleString('en-US')} iterations, ${SIM_PLIES} plies`

// Where the latest prompt came from: `bridge` for the phone (or the web) over
// Remote Control, where no pane draws, so a sim answers with a picture.
let lastPromptOrigin = ''

let pictureDirectory: Promise<string> | null = null

// Pictures go in the temporary directory, `magpie-sim` in it.
function pictureFolder($: EngineInterface): Promise<string> {
  pictureDirectory ??= $.process
    .run(['printenv', 'TMPDIR'])
    .then(({ stdout }) => `${stdout.trim().replace(/\/$/, '') || '/tmp'}/magpie-sim`)
  return pictureDirectory
}

function cardSubtitle(sim: Sim): string {
  return summaryLine({ ...sim, label: '' })
}

/** The picture of what the pane shows (or of `sim`) as a PNG file, for a
 * phone, which shows a file and no pane: its path and a caption. */
async function makePicture($: EngineInterface, given?: Sim): Promise<{ file: string; caption: string }> {
  const sim = given ?? (await loadSim($))
  const id = await read($, selectedId)
  const shown = sim.plays.find(play => play.id === id) ?? sim.plays[0]
  if (shown === undefined) {
    throw new Error('there are no plays to show')
  }
  const picture = cardPicture(await loadFont($), sim, shown, sim.label || sim.rack, cardSubtitle(sim))
  const directory = await pictureFolder($)
  const name = `${(sim.label || sim.rack).replace(/[^A-Za-z0-9]+/g, '-').slice(0, 60)}-${Date.now()}`
  const raw = `${directory}/${name}.raw.png`
  const path = `${directory}/${name}.png`
  // The file is binary and $.fs writes text: its base64 decoded on the way.
  const wrote = await $.process.run(['sh', '-c', 'mkdir -p "$1" && base64 --decode > "$2"', 'magpie-sim', directory, raw], {
    stdin: encodePng(picture.width, picture.height, picture.pixels).toBase64(),
  })
  if (wrote.exitCode !== 0) {
    throw new Error(`could not write the picture: ${wrote.stderr.trim()}`)
  }
  // Stored uncompressed (no deflate here); sips writes it compressed.
  const squeezed = await $.process.run(['sips', '-s', 'format', 'png', raw, '--out', path]).catch(() => undefined)
  const file = squeezed?.exitCode === 0 ? path : raw
  note(`drew ${file}`)
  return { file, caption: `${sim.label || sim.rack}: ${sim.kind === 'endgame' ? 'the endgame solved' : 'the top plays'}` }
}

/** What has Claude send a picture: a file card reaches the phone only as a
 * SendUserFile call of the conversation's own, which a plugin's
 * $.tool.call is not. */
function sendInstruction({ file, caption }: { file: string; caption: string }): string {
  return `Send the person this picture with SendUserFile (display "render", caption "${caption}"), as their phone shows no pane: ${file}`
}

/** The picture sent from outside a turn (a /magpie from the phone): a prompt
 * for Claude to send it, its own short turn once the session is idle. The
 * engine refuses a prompt from inside a command's hook, which holds the turn
 * it would wait on, so it goes from a timer of its own. */
async function sendPicture($: EngineInterface, given?: Sim): Promise<void> {
  const text = sendInstruction(await makePicture($, given))
  $.clock.after(PROMPT_DELAY_MS, () => {
    $.prompt.submit({ text }).catch((error: unknown) => note(`could not ask for the picture: ${String(error)}`))
  })
}

let lexicaList: Promise<string[]> | null = null

// The lexicons the MAGPIE directory has (its .kwg files); none known for the
// magpie on PATH.
async function lexica($: EngineInterface): Promise<string[]> {
  lexicaList ??= findMagpie($).then(async where =>
    where.cwd === undefined
      ? []
      : (await $.fs.list(`${where.cwd}/data/lexica`).catch(() => []))
          .map(entry => /^(.+)\.kwg$/.exec(entry.name)?.[1])
          .filter((name): name is string => name !== undefined)
          .sort(),
  )
  return lexicaList
}

/** What the person typed after /magpie, read by a model into an Intent with
 * what the pane shows and the lexicons at hand. */
async function interpret($: EngineInterface, text: string): Promise<Intent> {
  const shown = await readCurrent($)
  const context: InterpreterContext = { lexica: await lexica($) }
  if (shown !== undefined) {
    // The moves played on from the position's start, and, unless its rack is
    // still to come, the rack and the plays the pane ranks.
    const after = shown.request.position.after ?? []
    const isAwaitingRack = shown.request.position.rack === ''
    const sim = isAwaitingRack ? undefined : await loadSim($).catch(() => undefined)
    context.current = {
      label: shown.label,
      source: shown.request.source,
      lexicon: shown.lexicon,
      ...(shown.turn === undefined ? {} : { turn: shown.turn, turns: shown.turns }),
      moves: after.map(move => (move.coordinate === 'pass' ? 'pass' : `${move.coordinate} ${move.word}`)),
      rack: sim?.rack ?? '',
      topPlays: (sim?.plays ?? []).slice(0, TOP_PLAYS_TOLD).map(play => `${play.id} ${play.score}`),
    }
  }
  const { system, prompt } = interpreterPrompt(text, context)
  const reply = await $.model.complete({
    model: INTERPRETER_MODEL,
    system,
    prompt,
    maxTokens: INTERPRETER_MAX_TOKENS,
    timeoutMs: INTERPRETER_TIMEOUT_MS,
  })
  if (!reply.isAnswered) {
    throw new Error(`the model reading it did not answer (${reply.reason})`)
  }
  note(`read "${text}" as ${reply.text.trim()}`)
  return parseIntent(reply.text)
}

// A position nobody has shown yet: the empty board, its rack to come.
const EMPTY_BOARD: SimRequest = { position: { kind: 'rack', rack: '', after: [] }, label: 'the opening', source: '' }
// The placements a question lists when a move fits several.
const PLACEMENTS_LISTED = 6

const placed = (move: PlacedMove) => (move.coordinate === 'pass' ? 'pass' : `${move.coordinate} ${move.word}`)

function describeMove(move: MoveDescription): string {
  const parts = [
    move.square === undefined ? '' : `at ${move.square}`,
    move.direction ?? '',
    move.score === undefined ? '' : `for ${move.score}`,
    ...(move.through ?? []).map(({ letter, word }) => `through the ${letter}${word === undefined ? '' : ` of ${word}`}`),
    move.premium === undefined ? '' : `to a ${move.premium}`,
  ]
  return [move.word, ...parts].filter(part => part !== '').join(' ')
}

/** A play intent's moves found on the board in order, each a legal play of
 * the word as described, and the position they reach: the request to sim,
 * or the question to ask (a move that fits nowhere, or several places it
 * could be the opponent's), or the rack to ask for. */
async function resolvePlay(
  $: EngineInterface,
  intent: Extract<Intent, { action: 'play' }>,
  shown: Current | undefined,
): Promise<{ request: SimRequest; message?: string } | { answer: string; reopen?: true }> {
  const base = shown?.request ?? EMPTY_BOARD
  const isShownSim = shown !== undefined && (shown.request.position.rack ?? 'known') !== ''
  const sim = isShownSim ? await loadSim($).catch(() => undefined) : undefined
  if (intent.moves[0]?.by === 'opponent' && sim !== undefined) {
    return {
      answer: `In ${shown?.label ?? 'the pane'} it is your move, with ${sim.rack}: what did you play before ${intent.moves[0].word || 'that'}?`,
    }
  }
  // What reaches the base position: the scan of a game, a CGP's lexicon.
  const planned = await planSim($, { ...base, position: { ...base.position, rack: '' } })
  if ('candidates' in planned) {
    throw new Error(`which position of ${base.label} is not clear`)
  }
  const plan = planned.plan
  const baseAfter = base.position.after ?? []
  const played: PlacedMove[] = []
  const notes: string[] = []
  for (const [index, move] of intent.moves.entries()) {
    if (move.pass === true) {
      played.push({ coordinate: 'pass', word: '' })
      notes.push('a pass')
      continue
    }
    // The person's own first move is from the rack the pane shows; any
    // other's tiles are unknown, so the word's own letters stand in.
    const isMine = index === 0 && sim !== undefined && move.by !== 'opponent'
    const racks = isMine ? [sim.rack] : racksFor(move)
    if (racks.length === 0) {
      return { answer: `${move.word} is too long to find without its square: say where it went (H8, 8H).` }
    }
    const position: Resolved = { ...plan.resolved, after: [...baseAfter, ...played] }
    delete position.rack
    const { result } = await execute($, plan.where, `finding ${move.word}`, generateRun(position, { lexicon: plan.lexicon, goto: plan.goto }, racks))
    const board = parseBoard(result.stdout.split('\n')) ?? []
    const legal = new Map(parseGenerated(result.stdout).flat().map(play => [`${play.coordinate} ${play.word}`, play]))
    const fits = [...legal.values()].filter(play => fitsDescription(play, move, board))
    if (fits.length === 0) {
      const anywhere = [...legal.values()].filter(play => fitsDescription(play, { word: move.word }, board))
      const why = magpieErrors(result.stdout, result.stderr, '')
      return {
        answer: [
          `${describeMove(move)} is not a legal play here${why === '' ? '' : ` (${why})`}.`,
          anywhere.length === 0
            ? `${move.word} fits nowhere on this board: is the word or a blank (lowercase) right?`
            : `${move.word} fits at ${anywhere
                .slice(0, PLACEMENTS_LISTED)
                .map(play => `${play.coordinate} ${play.word} ${play.score}`)
                .join(', ')}: which?`,
        ].join(' '),
      }
    }
    // The person's own: the best the sim ranked (the play it showed), else
    // the best by equity. Another's, in more than one place: ask.
    const ranked = [...fits].sort((a, b) => {
      const rank = (play: GeneratedPlay) => sim?.plays.findIndex(simmed => simmed.id === `${play.coordinate} ${play.word}`) ?? -1
      const [rankA, rankB] = [rank(a), rank(b)].map(value => (value < 0 ? Number.MAX_SAFE_INTEGER : value))
      return (rankA ?? 0) - (rankB ?? 0) || b.equity - a.equity || b.score - a.score
    })
    if (ranked.length > 1 && !isMine) {
      return {
        answer: [
          `${describeMove(move)} fits ${ranked.length} places:`,
          ...ranked.slice(0, PLACEMENTS_LISTED).map(play => `  ${play.coordinate} ${play.word} for ${play.score}`),
          'Which? Say its square or score.',
        ].join('\n'),
      }
    }
    const chosen = ranked[0] as GeneratedPlay
    played.push({ coordinate: chosen.coordinate, word: chosen.word })
    notes.push(
      `${chosen.coordinate} ${chosen.word} for ${chosen.score}${isMine && ranked.length > 1 ? ' (the top of its placements)' : ''}`,
    )
  }
  const after = [...baseAfter, ...played]
  const rack = intent.rack ?? ''
  const recent = after.slice(-2).map(placed).join(', ')
  const request: SimRequest = {
    ...base,
    position: { ...base.position, after, rack } as SimRequest['position'],
    label: `${rack === '' ? 'next' : rack} after ${after.length > 2 ? '…, ' : ''}${recent}`,
  }
  const playedText = notes.length === 0 ? '' : `Played ${notes.join(', then ')}. `
  if (rack === '') {
    // Kept as what the pane stands on, so the rack alone can follow.
    const pending: Current = { request, label: request.label, lexicon: shown?.lexicon ?? plan.lexicon ?? '' }
    await update($, current, () => JSON.stringify(pending))
    return { answer: `${playedText}What rack do you have now?` }
  }
  return { request, message: `${playedText}Simulating ${rack}` }
}

/** The request an intent makes, against what the pane shows; or the answer
 * itself, when there is nothing to run (a question, the pane reopened, a
 * lexicon already in use, the end of the game reached). */
async function requestFor(
  $: EngineInterface,
  intent: Intent,
): Promise<{ request: SimRequest; message?: string } | { answer: string; reopen?: true; picture?: true }> {
  const shown = await readCurrent($)
  switch (intent.action) {
    case 'unclear':
      return { answer: intent.question }
    case 'reopen':
      return { answer: 'Opened the MAGPIE sim pane.', reopen: true }
    case 'play':
      return resolvePlay($, intent, shown)
    case 'picture':
      return shown === undefined
        ? { answer: 'There is nothing to show yet: sim a position first.' }
        : { answer: `Sent a picture of ${shown.label}.`, picture: true }
    case 'navigate': {
      if (shown?.turn === undefined || shown.turns === undefined) {
        return { answer: 'The pane shows no game to move through: sim a GCG first (/magpie <path or URL of a .gcg>).' }
      }
      const turn =
        intent.to === 'next'
          ? shown.turn + 1
          : intent.to === 'previous'
            ? shown.turn - 1
            : intent.to === 'first'
              ? 1
              : shown.turns
      if (turn < 1 || turn > shown.turns) {
        return { answer: `Turn ${shown.turn} is the game's ${turn < 1 ? 'first' : 'last'}.` }
      }
      if (turn === shown.turn) {
        return { answer: `The pane already shows turn ${turn}.`, reopen: true }
      }
      return { request: { ...shown.request, at: { kind: 'turn', turn } } }
    }
    case 'lexicon': {
      if (shown === undefined) {
        return { answer: 'There is nothing to analyze again yet: sim a position first.' }
      }
      const lexicon = checkLexicon(intent.lexicon, await lexica($))
      if (lexicon === shown.lexicon) {
        return { answer: `Already using ${lexicon} for ${shown.label}.`, reopen: true }
      }
      return {
        request: { ...shown.request, lexicon },
        message: `Analyzing ${shown.label} again in ${lexicon}${shown.lexicon === '' ? '' : ` (was ${shown.lexicon})`}`,
      }
    }
    case 'sim': {
      const request = requestFromIntent(intent, shown?.request)
      if (request.lexicon !== undefined) {
        request.lexicon = checkLexicon(request.lexicon, await lexica($))
      }
      return { request }
    }
  }
}

/** What the person's turn, rack or word was, for the question. */
function askWhich(request: SimRequest, candidates: readonly GcgPosition[]): string[] {
  return [
    `${selectorText(request.at)} fits ${candidates.length} positions in ${request.label}:`,
    ...candidateLines(candidates),
  ]
}

export const register: Register = (on, options) => {
  magpieDir = typeof options.magpieDir === 'string' ? options.magpieDir.trim().replace(/\/+$/, '') : DEFAULT_MAGPIE_DIR

  on('session.start', async ($, e, next) => {
    // Each registration on its own: a refused one (a name another plugin
    // holds) must not keep the others from happening.
    await $.command
      .register({
        name: 'magpie',
        description:
          'Sim a crossword position in MAGPIE and show it in a pane, in your own words: an opening rack, a CGP, a .gcg path or URL and which turn, a lexicon, next turn, csw; no argument reopens the pane',
      })
      .catch((error: unknown) => note(`/magpie refused: ${String(error)}`))
    await $.tool
      .register({
        name: 'simulate',
        description: `Runs a MAGPIE Monte Carlo simulation of a crossword (Scrabble) position and shows the results in a pane beside the conversation, with a board picture of each play: ${SIM_SHAPE}, using WMP, RIT and WIT where the lexicon has them. Use it whenever the person asks to sim, simulate or analyze a rack or position. Takes a few seconds to a minute; one at a time. Returns the top plays by win%. For a game, at most one of turn, rack, word, letters or event picks the position; when it fits more than one, the tool lists them instead of running: ask the person which.`,
        inputSchema: {
          type: 'object',
          properties: {
            position: {
              type: 'string',
              description:
                'An opening rack (ADOPQRR, ? for a blank), a CGP string, or a path or URL of a .cgp or .gcg file; woogles.io and cross-tables.com game links work (a cross-tables viewer link\'s #13# picks the turn of its move 13). Left out: the game or position the pane shows now.',
            },
            lexicon: { type: 'string', description: 'e.g. NWL23; CSW24 unless a CGP or GCG names one' },
            after: {
              type: 'array',
              description:
                'For a rack: the moves played before it, in order. Coordinates in capitals (8G across, H8 down); a word in capitals except a blank in lowercase; a board tile as "." or in parentheses.',
              items: {
                type: 'object',
                properties: { coordinate: { type: 'string' }, word: { type: 'string' } },
                required: ['coordinate', 'word'],
              },
            },
            turn: { type: 'integer', description: "For a game: a turn number, 1 being the game's first move" },
            rack: { type: 'string', description: 'For a game: a rack the player to move held' },
            word: { type: 'string', description: 'For a game: a word played in it' },
            relation: {
              type: 'string',
              enum: ['from', 'after'],
              description: "With word: the turn it was played on (from, the default), or its player's next rack (after)",
            },
            letters: { type: 'string', description: 'For a game: letters that could be the rack or the word' },
            event: { type: 'integer', description: "For a game: MAGPIE's goto, the number of events played" },
            picture: {
              type: 'boolean',
              description:
                'Also send the person a picture of the board and the top plays, as a phone shows no pane: set it when they ask for a picture (it is sent by itself when their message came from the phone over Remote Control)',
            },
          },
        },
        isDeferred: false,
      })
      .catch((error: unknown) => note(`the simulate tool refused: ${String(error)}`))
    await $.tool
      .register({
        name: 'show',
        description:
          "Opens the MAGPIE sim pane on a finished sim's results: a file holding what `magpie ... -hr false` printed for a simulate command, optionally headed by `# lexicon <name>` and `# label <text>` lines. Leave out `file` to reopen the pane on the sim it last showed.",
        inputSchema: {
          type: 'object',
          properties: {
            file: { type: 'string', description: 'Absolute path of the results file' },
          },
        },
      })
      .catch((error: unknown) => note(`the show tool refused: ${String(error)}`))
    return next(e)
  })

  // Notes where each prompt came from, for the simulate tool: a phone's gets
  // a picture.
  on('prompt.submit', ($, e, next) => {
    lastPromptOrigin = e.origin?.kind ?? ''
    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'magpie' }, async ($, e) => {
    const args = e.args.trim()
    if (args === 'why') {
      const panes = (await $.ui.panes()).map(
        pane => `${pane.id} placed=${pane.isPlaced} shown=${pane.isShown} focused=${pane.isFocused}`,
      )
      return {
        text: [
          `Surfaces attached: ${(await $.session.surfaces()).join(', ') || 'none'}.`,
          `Open panes: ${panes.join('; ') || 'none'}.`,
          `What the mod did:${log.length === 0 ? ' nothing yet' : ''}`,
          ...log,
        ].join('\n'),
      }
    }
    // The phone (or the web) over Remote Control draws no pane: a picture is
    // what it can show.
    const fromPhone = e.origin?.kind === 'bridge'
    let found: Awaited<ReturnType<typeof requestFor>>
    let planned: Awaited<ReturnType<typeof planSim>>
    try {
      found =
        args === ''
          ? { answer: 'Opened the MAGPIE sim pane.', reopen: true }
          : await requestFor($, await interpret($, args))
      if ('answer' in found) {
        if (found.reopen === true) {
          await openPane($, await currentTitle($), true)
        }
        if (found.picture === true || (fromPhone && found.reopen === true)) {
          await sendPicture($)
        }
        return { text: found.answer }
      }
      planned = await planSim($, found.request)
    } catch (error) {
      return { text: error instanceof Error ? error.message : String(error) }
    }
    if ('candidates' in planned) {
      const first = planned.candidates[0]
      return {
        text: [
          ...askWhich(found.request, planned.candidates),
          `Say which, e.g. /magpie ${found.request.source} turn ${first?.turn ?? 1}`,
        ].join('\n'),
      }
    }
    const plan = planned.plan
    const opened = await openPane($, `MAGPIE · ${plan.label}`, true)
    // The sim outlives the command: the pane shows it running, then its
    // results, or what went wrong.
    void runPlan($, plan)
      .then(sim => (fromPhone ? sendPicture($, sim) : undefined))
      .catch((error: unknown) => note(`${plan.label}: ${String(error)}`))
    return {
      text: `${opened}. ${found.message ?? planStatus(plan)}. ${fromPhone ? 'A picture follows' : 'The pane fills in'} when it finishes.`,
    }
  })

  on('tool.call', { tool: 'mcp__magpie-sim__simulate' }, async ($, e) => {
    const input = e as Record<string, unknown>
    let request: SimRequest
    let planned: Awaited<ReturnType<typeof planSim>>
    try {
      // The caller is a model already: its fields are the intent.
      const found = await requestFor($, parseIntent(JSON.stringify({ ...input, action: 'sim' })))
      if ('answer' in found) {
        return { result: found.answer }
      }
      request = found.request
      planned = await planSim($, request)
    } catch (error) {
      return { deny: `${PLUGIN}: ${error instanceof Error ? error.message : String(error)}` }
    }
    if ('candidates' in planned) {
      return {
        result: [
          'Not run.',
          ...askWhich(request, planned.candidates),
          'Ask the person which they mean, then call again with `turn` set to it.',
        ].join('\n'),
      }
    }
    const plan = planned.plan
    const opened = await openPane($, `MAGPIE · ${plan.label}`, false)
    let sim: Sim
    try {
      sim = await runPlan($, plan)
    } catch (error) {
      return { deny: `${PLUGIN}: the sim of ${plan.label} failed: ${error instanceof Error ? error.message : String(error)}` }
    }
    let pictureLine = 'If the pane waits undrawn, the person can type /magpie to open it.'
    // The caller is in a turn: it sends the picture itself.
    if (input.picture === true || lastPromptOrigin === 'bridge') {
      try {
        pictureLine = sendInstruction(await makePicture($, sim))
      } catch (error) {
        pictureLine = `The picture could not be drawn: ${error instanceof Error ? error.message : String(error)}`
      }
    }
    return {
      result: [
        `${opened}. ${summaryLine(sim)}, ${sim.plays.length} plays. Top ${sim.kind === 'endgame' ? 'by the solver' : 'by win%'}:`,
        ...reportLines(sim, PLAYS_REPORTED),
        pictureLine,
      ].join('\n'),
    }
  }).catch(($, e, next) => (next.called ? next(e) : { deny: `${PLUGIN}: the sim failed` }))

  on('tool.call', { tool: 'mcp__magpie-sim__show' }, async ($, e) => {
    const file = (e as { file?: unknown }).file
    if (typeof file === 'string' && file !== '') {
      if (!file.startsWith('/')) {
        return { deny: `${PLUGIN}: give the results file as an absolute path, not ${file}` }
      }
      await update($, simFile, () => file)
      await update($, simText, () => '')
      await update($, selectedId, () => '')
      await update($, windowTop, () => 0)
    }
    let sim: Sim
    try {
      sim = await loadSim($)
    } catch (error) {
      return { deny: `${PLUGIN}: could not read the sim: ${String(error)}` }
    }
    const opened = await openPane($, await currentTitle($), false)
    note(`show: ${opened}`)
    return {
      result: [`${opened}. ${summaryLine(sim)}, ${sim.plays.length} plays. Top by win%:`, ...reportLines(sim, PLAYS_REPORTED)].join(
        '\n',
      ),
    }
  }).catch(($, e, next) => (next.called ? next(e) : { deny: `${PLUGIN}: showing the sim failed` }))

  // The wheel scrolls the table's rows: it draws only the plays that fit,
  // so there is nothing else to scroll. The selection stays where it is.
  on('ui.scroll', { requestId: PANE }, async ($, e) => {
    if (e.by !== 0) {
      await update($, windowTop, top => Math.min(Math.max(0, top + e.by), Math.max(0, lastCount - lastRoom)))
    }
    return {}
  }).catch(($, e, next) => next(e)) // a failed move lets the body scroll as usual

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const where = `${e.surface}, ${e.props.bodyColumns}x${e.props.scroll.bodyRows} ${e.props.placement}`
    let drew = 'text only'
    // A failure is drawn in the pane and logged for `/magpie why`.
    try {
      const tree = await drawPane()
      note(`${where}: drew ${drew}`)
      return tree
    } catch (error) {
      note(`${where}: failed: ${String(error)}`)
      const { Text } = $.ui.resolve(e)
      return <Text color="red">{`The pane failed to draw: ${String(error)}`}</Text>
    }

    async function drawPane() {
      const { Box, Button, Text } = $.ui.resolve(e)
      const runningLabel = await read($, running)
      const error = await read($, runError)
      const status =
        runningLabel !== '' ? (
          <Text color="yellow" wrap="truncate-end">{`${runningLabel}…`}</Text>
        ) : error !== '' ? (
          <Text color="red" wrap="wrap">{`The sim failed: ${error}`}</Text>
        ) : null
      let sim: Sim
      try {
        sim = await loadSim($)
      } catch (loadError) {
        if (status !== null) {
          return status
        }
        throw loadError
      }
      const key = await read($, sortKey)
      const descending = await read($, isDescending)
      const sorted = sortPlays(sim.plays, key, descending)
      const index = selectedIndex(sorted, await read($, selectedId))
      const selected = sorted[index]
      if (selected === undefined) {
        return <Text dimColor>No plays.</Text>
      }

      let font: Font | null = null
      let fontProblem: string | null = null
      try {
        font = await loadFont($)
      } catch (fontError) {
        fontProblem = `Could not read ${FONT_FILE}: ${String(fontError)}`
      }
      // The terminal spells each play in tiles, as pictures.
      const isTiled = e.surface === 'terminal' && font !== null

      // The full table where it fits, else its main columns; the board
      // beside it where both fit, else above.
      const fullLayout = tableLayout(sim.plays, false, isTiled, sim.kind)
      const layout =
        e.props.bodyColumns < fullLayout.width ? tableLayout(sim.plays, true, isTiled, sim.kind) : fullLayout
      const isWide = e.props.bodyColumns >= BOARD_COLUMNS + 2 + layout.width
      const besideBoard = isWide ? 0 : BOARD_ROWS + 1
      const statusRows = status === null ? 0 : 1
      const room = Math.max(3, e.props.scroll.bodyRows - TABLE_CHROME_ROWS - besideBoard - statusRows)
      lastRoom = room
      lastCount = sorted.length
      // Where the wheel left the rows, whichever play is selected.
      const top = Math.min(Math.max(0, await read($, windowTop)), Math.max(0, sorted.length - room))
      const shown = sorted.slice(top, top + room)

      const alt = describePlay(selected)
      let picture = <Text dimColor>{alt}</Text>
      if (fontProblem !== null) {
        picture = <Text color="red">{fontProblem}</Text>
      } else if (font !== null) {
        if (e.surface === 'terminal') {
          isTerminalDrawing = true
          const { Image } = $.ui.resolve(e)
          picture = (
            <Image key="board" source={pictureSource(font, sim, selected)} columns={BOARD_COLUMNS} rows={BOARD_ROWS} alt={alt} />
          )
          drew = 'an Image'
        } else {
          const { Svg } = $.ui.resolve(e)
          const svg = boardSvg(font, sim.board, sim.rack, selected)
          picture = <Svg source={svg} alt={alt} />
          drew = `an Svg of ${svg.length} characters`
        }
      }

      // Each heading that sorts is a button: again to flip.
      const header = (
        <Box key="header" flexDirection="row">
          <Text bold>{'#'.padStart(RANK_WIDTH)}</Text>
          {layout.columns.map(({ column, width }) => {
            const arrow = column.sort === key ? (descending ? '▼' : '▲') : ''
            const title = ` ${pad(column.title + arrow, column, width)}`
            const sort = column.sort
            return sort === undefined ? (
              <Text bold>{title}</Text>
            ) : (
              <Button key={`sort-${sort}`} plain onPress={() => sortBy($, sort)}>
                <Text bold>{title}</Text>
              </Button>
            )
          })}
        </Box>
      )

      // Each row is a button that puts its play on the board; a tiled row's
      // tiles sit between its two halves, a picture no click reaches.
      const TileImage = e.surface === 'terminal' ? $.ui.resolve(e).Image : undefined
      const rows = shown.map(play => {
        const isSelected = play.id === selected.id
        const pick = () => selectPlay($, play.id)
        if (layout.tiles === undefined || font === null || TileImage === undefined) {
          return (
            <Button key={`pick-${play.id}`} plain onPress={pick}>
              <Text inverse={isSelected}>{rowLine(layout, play, isSelected)}</Text>
            </Button>
          )
        }
        const parts = rowParts(layout, play, isSelected)
        return (
          <Box key={`row-${play.id}`} flexDirection="row">
            <Button key={`pick-${play.id}`} plain onPress={pick}>
              <Text inverse={isSelected}>{parts.before}</Text>
            </Button>
            <TileImage
              key={`tiles-${play.id}`}
              source={rowTilesSource(font, play, layout.tiles.slots)}
              columns={TILE_COLUMNS * layout.tiles.slots}
              rows={1}
              alt={play.id}
            />
            <Button key={`pick-${play.id}-numbers`} plain onPress={pick}>
              <Text inverse={isSelected}>{parts.after}</Text>
            </Button>
          </Box>
        )
      })

      const timing = e.surface === 'terminal' ? ` · picture ${lastPictureMs} ms` : ''
      const table = (
        <Box flexDirection="column">
          {status}
          <Text dimColor wrap="truncate-end">
            {`${summaryLine(sim)} · ${top + 1}-${top + shown.length} of ${sorted.length}${timing}`}
          </Text>
          {header}
          {rows}
        </Box>
      )

      return isWide ? (
        <Box flexDirection="row" columnGap={2}>
          {picture}
          {table}
        </Box>
      ) : (
        <Box flexDirection="column">
          {picture}
          {table}
        </Box>
      )
    }
  })
}
