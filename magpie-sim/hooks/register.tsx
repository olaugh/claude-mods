import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { SortKey } from '../types'
import { boardPicture } from './draw'
import {
  choosePosition,
  DEFAULT_LEXICON,
  describePosition,
  gcgPositions,
  isCgp,
  ITERATIONS_PER_PLAY,
  magpieRun,
  parseArgs,
  scanRun,
  SIM_PLAYS,
  SIM_PLIES,
  sniffPosition,
  type Accelerators,
  type GcgPosition,
  type MagpieRun,
  type Selector,
  type SimRequest,
} from './magpie'
import { describePlay, parseSim, type Play, type Sim } from './sim'
import { boardSvg } from './svg'
import { PICTURE_HEIGHT, PICTURE_WIDTH } from './theme'
import { parseFont, type Font } from './truetype'

const PLUGIN = 'magpie-sim'
const PANE = 'magpie-results'
// Where MAGPIE is installed unless the magpieDir option says otherwise.
const DEFAULT_MAGPIE_DIR = '~/magpie'
// Ten minutes, the most $.process.run allows.
const RUN_TIMEOUT_MS = 600_000
// The TUI's font (tui/assets/magpie.ttf), under its own licence beside it.
const FONT_FILE = 'assets/FiraCodeNerdFontMono-Regular.ttf'
// The sim the pane shows before any has run.
const DEFAULT_SIM_FILE = 'sims/ADOPQRR-CSW24.txt'
// Plays the simulate tool lists for the model; the pane shows them all.
const PLAYS_REPORTED = 10

// The terminal picture's box in cells. Cells are about twice as tall as they
// are wide, so 44 x 24 keeps the 596 x 638 picture's tiles near square.
const BOARD_COLUMNS = 44
const BOARD_ROWS = 24
// Rows the table draws above its plays: the summary, the keys, the headings.
const TABLE_CHROME_ROWS = 3
// The full table's width; below it the table drops its less-used columns.
const FULL_TABLE_COLUMNS = 75
// Wide enough for the board beside the full table.
const PANE_COLUMNS = BOARD_COLUMNS + 2 + FULL_TABLE_COLUMNS
const PANE_ROWS = 30

const selectedId = atom({ plugin: 'magpie-sim', key: 'selectedId' } as const, '')
const sortKey = atom({ plugin: 'magpie-sim', key: 'sortKey' } as const, 'win' as SortKey)
const isDescending = atom({ plugin: 'magpie-sim', key: 'isDescending' } as const, true)
const windowTop = atom({ plugin: 'magpie-sim', key: 'windowTop' } as const, 0)
const simFile = atom({ plugin: 'magpie-sim', key: 'simFile' } as const, '')
const simText = atom({ plugin: 'magpie-sim', key: 'simText' } as const, '')
const running = atom({ plugin: 'magpie-sim', key: 'running' } as const, '')
const runError = atom({ plugin: 'magpie-sim', key: 'runError' } as const, '')

// How many plays the table showed when last drawn, so a key press moves the
// window as far as the person can see. The drawing clamps it again.
let lastRoom = 10
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

// The request with its position in MAGPIE's terms: a URL or file read and
// told apart, a local path made absolute for MAGPIE's own directory.
async function resolveRequest($: EngineInterface, request: SimRequest) {
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


type Resolved = { kind: 'rack'; rack: string } | { kind: 'cgp'; cgp: string } | { kind: 'gcg'; source: string }

/** A sim ready to run: the position in MAGPIE's terms, and for a GCG the
 * `goto` that reaches it. */
type Plan = {
  resolved: Resolved
  lexicon?: string
  goto?: string
  label: string
  where: Magpie
  threadCount: number
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
    throw new Error(`a sim of ${already} is still running`)
  }
  const { resolved, lexicon: knownLexicon } = await resolveRequest($, request)
  const where = await findMagpie($)
  let lexicon = knownLexicon
  let goto: string | undefined
  let label = request.label
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
    if ('goto' in choice) {
      goto = choice.goto
      label = `${label} event ${goto}`
    } else {
      goto = String(choice.position.events)
      label = `${label} turn ${choice.position.turn}`
    }
  }
  return { plan: { resolved, lexicon, goto, label, where, threadCount: await threads($) } }
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
    throw new Error(`a sim of ${already} is still running`)
  }
  await update($, running, () => plan.label)
  await update($, runError, () => '')
  try {
    const started = Date.now()
    const magpie = async (accelerated: Accelerators) => {
      const run = magpieRun(plan.resolved, { lexicon: plan.lexicon, goto: plan.goto }, plan.threadCount, accelerated)
      return { run, ...(await execute($, plan.where, plan.label, run)) }
    }
    const tried = await accelerators($, plan.where, plan.lexicon)
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
  width: number
  sort?: SortKey
  isLeft?: true
  isCompact?: true
  cell: (play: Play) => string
}

const signed = (value: number) => (value > 0 ? '+' : '') + value.toFixed(2)

const COLUMNS: readonly Column[] = [
  { title: 'Play', width: 12, sort: 'play', isLeft: true, isCompact: true, cell: play => play.id },
  { title: 'Leave', width: 7, isLeft: true, cell: play => play.leave },
  { title: 'Sc', width: 3, sort: 'score', isCompact: true, cell: play => String(play.score) },
  { title: 'Win%', width: 6, sort: 'win', isCompact: true, cell: play => play.winPct.toFixed(2) },
  { title: '±', width: 4, cell: play => play.winSe.toFixed(2) },
  { title: 'Eq', width: 6, sort: 'equity', isCompact: true, cell: play => signed(play.equity) },
  { title: 'StEq', width: 6, sort: 'static', cell: play => signed(play.staticEquity) },
  { title: 'Iters', width: 6, sort: 'iterations', cell: play => String(play.iterations) },
  // The opponent's reply: its mean score and how often it bingoes.
  { title: 'OpSc', width: 5, cell: play => play.plies[0]?.score.toFixed(1) ?? '' },
  { title: 'OpBn%', width: 5, cell: play => play.plies[0]?.bingoPct.toFixed(1) ?? '' },
]

const SORT_KEYS: readonly { key: SortKey; hotkey: string; label: string }[] = [
  { key: 'win', hotkey: 'w', label: 'win%' },
  { key: 'equity', hotkey: 'e', label: 'equity' },
  { key: 'score', hotkey: 's', label: 'score' },
  { key: 'static', hotkey: 't', label: 'static' },
  { key: 'iterations', hotkey: 'i', label: 'iters' },
  { key: 'play', hotkey: 'a', label: 'a-z' },
]

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

function pad(text: string, column: Column): string {
  return column.isLeft ? text.padEnd(column.width) : text.padStart(column.width)
}

function columnsFor(isCompact: boolean): readonly Column[] {
  return isCompact ? COLUMNS.filter(column => column.isCompact) : COLUMNS
}

export function headerLine(key: SortKey, descending: boolean, isCompact: boolean): string {
  const titles = columnsFor(isCompact).map(column =>
    pad(column.title + (column.sort === key ? (descending ? '▼' : '▲') : ''), column),
  )
  return ['#'.padStart(5), ...titles].join(' ')
}

// The rank is the sim's own, by win%, whatever the table's order.
export function rowLine(play: Play, isSelected: boolean, isCompact: boolean): string {
  const cells = columnsFor(isCompact).map(column => pad(column.cell(play), column))
  return [(isSelected ? '▶' : ' ') + String(play.rank).padStart(4), ...cells].join(' ')
}

export function summaryLine(sim: Sim): string {
  const parts = [
    sim.label !== '' && sim.label !== sim.rack ? `${sim.label}, rack ${sim.rack}` : sim.rack,
    sim.lexicon,
    `${sim.plies} ${sim.plies === 1 ? 'ply' : 'plies'}`,
    `${sim.iterations.toLocaleString('en-US')} iters in ${sim.seconds.toFixed(1)} s`,
  ]
  return parts.filter(part => part !== '').join(' · ')
}

/** The top plays as the simulate tool reports them to the model. */
export function reportLines(sim: Sim, count: number): string[] {
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

async function moveBy($: EngineInterface, by: number) {
  const sim = await loadSim($)
  const sorted = await sortedPlays($, sim)
  const current = selectedIndex(sorted, await read($, selectedId))
  const index = Math.min(sorted.length - 1, Math.max(0, current + by))
  const next = sorted[index]
  if (next === undefined || index === current) {
    return
  }
  // Swap the picture at the frame rate; the redraw the writes below cause
  // draws the same source, which sends nothing. Refused where no terminal
  // picture is mounted (the other surfaces draw an Svg), and a failed swap
  // must not stop the move: that redraw draws the new picture anyway.
  if (isTerminalDrawing) {
    try {
      await $.ui.blit({ requestId: PANE, key: 'board', source: pictureSource(await loadFont($), sim, next) })
    } catch {
      // The redraw below shows it.
    }
  }
  await update($, selectedId, () => next.id)
  await update($, windowTop, top => windowStart(top, index, lastRoom, sorted.length))
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

export const register: Register = (on, options) => {
  magpieDir = typeof options.magpieDir === 'string' ? options.magpieDir.trim().replace(/\/+$/, '') : DEFAULT_MAGPIE_DIR

  on('session.start', async ($, e, next) => {
    // Each registration on its own: a refused one (a name another plugin
    // holds) must not keep the others from happening.
    await $.command
      .register({
        name: 'magpie',
        description:
          'Sim a position in MAGPIE and show it in a pane: /magpie <opening rack | CGP | .cgp/.gcg path or URL> [lexicon] [GCG turn number, rack or word]; no argument reopens the pane',
      })
      .catch((error: unknown) => note(`/magpie refused: ${String(error)}`))
    await $.tool
      .register({
        name: 'simulate',
        description: `Runs a MAGPIE Monte Carlo simulation of a crossword (Scrabble) position and shows the results in a pane beside the conversation, with a board picture of each play: ${SIM_SHAPE}, using WMP, RIT and WIT where the lexicon has them. Use it whenever the person asks to sim, simulate or analyze a rack or position. Takes a few seconds to a minute; one at a time. Returns the top plays by win%.`,
        inputSchema: {
          type: 'object',
          properties: {
            position: {
              type: 'string',
              description:
                'An opening rack (ADOPQRR, ? for a blank), a CGP string, or a path or URL of a .cgp or .gcg file; woogles.io and cross-tables.com game links work',
            },
            lexicon: { type: 'string', description: 'CSW24 unless a CGP or GCG names one; e.g. NWL23' },
            at: {
              type: 'string',
              description:
                "For a rack: the moves played before it, `after 8G VAV, 9F .IE` (an all-lowercase word is plain tiles). For a GCG, which position: a turn number (1 is the game's first move), a rack the player to move held, or a word: `VODKA`, `the VODKA turn` and `before VODKA` are the rack VODKA was played from, `after VODKA` that player's next rack; `turn 12`, `rack DEEILRV`, `event 23` (MAGPIE's goto) say which kind. A cross-tables viewer link's `#13#` picks its position. Left out: the latest position with a player to move. When it fits more than one position the tool lists them instead of running: ask the person which.",
            },
          },
          required: ['position'],
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
    if (args === '') {
      const opened = await openPane($, await currentTitle($), true)
      note(`/magpie: ${opened}`)
      return { text: `${opened}. j/k or the arrows move, w e s t i a sort, Esc returns to the prompt.` }
    }
    let request: SimRequest
    let planned: Awaited<ReturnType<typeof planSim>>
    try {
      request = parseArgs(args)
      planned = await planSim($, request)
    } catch (error) {
      return { text: error instanceof Error ? error.message : String(error) }
    }
    if ('candidates' in planned) {
      const first = planned.candidates[0]
      return {
        text: [
          `${selectorText(request.at)} fits ${planned.candidates.length} positions in ${request.label}:`,
          ...candidateLines(planned.candidates),
          `Say which: /magpie ${request.source} turn ${first?.turn ?? 1}`,
        ].join('\n'),
      }
    }
    const plan = planned.plan
    const opened = await openPane($, `MAGPIE · ${plan.label}`, true)
    // The sim outlives the command: the pane shows it running, then its
    // results, or what went wrong.
    void runPlan($, plan).catch(() => undefined)
    return { text: `${opened}. Simulating ${plan.label}: ${SIM_SHAPE}. The pane fills in when it finishes.` }
  })

  on('tool.call', { tool: 'mcp__magpie-sim__simulate' }, async ($, e) => {
    const input = e as { position?: unknown; lexicon?: unknown; at?: unknown }
    if (typeof input.position !== 'string' || input.position.trim() === '') {
      return { deny: `${PLUGIN}: name a position to sim` }
    }
    let request: SimRequest
    let planned: Awaited<ReturnType<typeof planSim>>
    try {
      // The same reading as /magpie's: a CGP whole, else the position and
      // what `at` says of it.
      const position = input.position.trim()
      const at = typeof input.at === 'string' || typeof input.at === 'number' ? String(input.at).trim() : ''
      request = parseArgs(isCgp(position) || at === '' ? position : `${position} ${at}`)
      if (typeof input.lexicon === 'string' && input.lexicon !== '') {
        request.lexicon = input.lexicon.toUpperCase()
      }
      planned = await planSim($, request)
    } catch (error) {
      return { deny: `${PLUGIN}: ${error instanceof Error ? error.message : String(error)}` }
    }
    if ('candidates' in planned) {
      return {
        result: [
          `Not run: ${selectorText(request.at)} fits ${planned.candidates.length} positions in ${request.label}:`,
          ...candidateLines(planned.candidates),
          'Ask the person which they mean, then call again with `at` set to its turn (e.g. "turn 12").',
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
    return {
      result: [
        `${opened}. ${summaryLine(sim)}, ${sim.plays.length} plays. Top by win%:`,
        ...reportLines(sim, PLAYS_REPORTED),
        'If the pane waits undrawn, the person can type /magpie to open it.',
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

  // The arrows and the wheel move the selection rather than the body: the
  // table draws only the plays that fit, so there is nothing else to scroll.
  on('ui.scroll', { requestId: PANE }, async ($, e) => {
    if (e.by !== 0) {
      await moveBy($, Math.sign(e.by) * Math.min(Math.abs(e.by), lastRoom))
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
          <Text color="yellow" wrap="truncate-end">{`Simulating ${runningLabel}: ${SIM_SHAPE}…`}</Text>
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

      const isCompact = e.props.bodyColumns < FULL_TABLE_COLUMNS
      const isWide = e.props.bodyColumns >= PANE_COLUMNS
      const besideBoard = isWide ? 0 : BOARD_ROWS + 1
      const statusRows = status === null ? 0 : 1
      const room = Math.max(3, e.props.scroll.bodyRows - TABLE_CHROME_ROWS - besideBoard - statusRows)
      lastRoom = room
      const top = windowStart(await read($, windowTop), index, room, sorted.length)
      const shown = sorted.slice(top, top + room)

      const alt = describePlay(selected)
      let picture = <Text dimColor>{alt}</Text>
      let font: Font | null = null
      try {
        font = await loadFont($)
      } catch (fontError) {
        picture = <Text color="red">{`Could not read ${FONT_FILE}: ${String(fontError)}`}</Text>
      }
      if (font !== null) {
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

      const timing = e.surface === 'terminal' ? ` · picture ${lastPictureMs} ms` : ''
      const table = (
        <Box flexDirection="column">
          {status}
          <Text dimColor wrap="truncate-end">
            {`${summaryLine(sim)} · ${top + 1}-${top + shown.length} of ${sorted.length}${timing}`}
          </Text>
          <Box flexDirection="row" columnGap={1} flexWrap="wrap">
            <Button key="down" hotkey="j" plain onPress={() => moveBy($, 1)}>
              down
            </Button>
            <Button key="up" hotkey="k" plain onPress={() => moveBy($, -1)}>
              up
            </Button>
            {SORT_KEYS.map(sort => (
              <Button
                key={`sort-${sort.key}`}
                hotkey={sort.hotkey}
                plain
                dimColor={sort.key !== key}
                onPress={() => sortBy($, sort.key)}
              >
                {sort.label}
              </Button>
            ))}
          </Box>
          <Text bold wrap="truncate-end">
            {headerLine(key, descending, isCompact)}
          </Text>
          {shown.map(play => (
            <Text inverse={play.id === selected.id} wrap="truncate-end">
              {rowLine(play, play.id === selected.id, isCompact)}
            </Text>
          ))}
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
