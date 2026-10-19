import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import {
  applyMove,
  blankText,
  canonicalWord,
  cgpUnseen,
  checkLexicon,
  choosePosition,
  classifyPosition,
  commitCommands,
  describePosition,
  distributionName,
  fitsDescription,
  gcgPositions,
  interpreterPrompt,
  magpieRun,
  missingText,
  missingTiles,
  parseDistribution,
  parseGenerated,
  parseIntent,
  playSquares,
  positionLabel,
  rackLess,
  racksFor,
  requestFromIntent,
  sameTiles,
  scanRun,
  shortText,
  splitCgp,
  tilesFromRack,
  tilesLeft,
  withBlanks,
  wordOnBoard,
  type Choice,
  type Intent,
  type MoveDescription,
} from '../hooks/magpie'
import { headerLine, reportLines, rowLine, tableLayout } from '../hooks/register'
import { cardPicture } from '../hooks/card'
import { boardPicture, tilesPicture } from '../hooks/draw'
import { encodePng } from '../hooks/png'
import { parseBoard, parseSim, placedTiles, rackGhosts, resultText, type Play } from '../hooks/sim'
import { parseFont } from '../hooks/truetype'
import { fixtureFont } from './font-fixture'

const CGP = '15/15/15/15/15/15/15/5DROP6/15/15/15/15/15/15/15 AEINRST/AQR 14/0 0 lex CSW24;'

// What MAGPIE printed for `cgp <CGP>`, `shgame` and `gsimulate`, cut to four
// plays.
const CGP_OUTPUT = `
   A B C D E F G H I J K L M N O   > Player 1  AEINRST  14
   ------------------------------    Player 2  AQR      0
 1|=     '       =       '     = |
 2|  -       "       "       -   |   Unseen: 86 (37v | 47c)
 3|    -       '   '       -     |   ? ? A A A A A A A B
 4|'     -       '       -     ' |   B C C D D D E E E E
 5|        -           -         |   E E E E E E E F F G
 6|  "       "       "       "   |   G G H H I I I I I I
 7|    '       '   '       '     |   I I J K L L L L M M
 8|=     '   D R O P     '     = |   N N N N N O O O O O
 9|    '       '   '       '     |   O O P R R R S S S T
10|  "       "       "       "   |   T T T T U U U U V V
11|        -           -         |   W W X Y Y Z
12|'     -       '       -     ' |
13|    -       '   '       -     |
14|  -       "       "       -   |
15|=     '       =       '     = |
   ------------------------------

1: J2 RETAINS  69 - 76.44 0.2014 76.81 0.5895 69.00 1001 31.66 12.17 2.60 41.53 21.20 20.78
2: J2 RETINAS  69 - 76.23 0.2110 76.31 0.6204 69.00 1001 33.60 14.04 2.60 41.16 22.15 22.08
3: J2 RESIANT  69 - 76.25 0.2274 76.52 0.6549 69.00 1001 33.23 14.82 2.60 41.53 21.77 22.08
4: J2 RATINES  69 - 76.14 0.2055 75.90 0.5814 69.00 1001 35.19 13.81 2.60 41.87 22.30 23.38

Showing 4 of 4 plays
Showing 2 of 2 plies

Iters:     4004
Time:      0.09 seconds
Opp Rack:  AQR
Status:    Finished (max iterations reached)
`

test('positions are told apart', () => {
  expect(classifyPosition('ADOPQRR')).toEqual({ kind: 'rack', rack: 'ADOPQRR' })
  expect(classifyPosition('aeinst?')).toEqual({ kind: 'rack', rack: 'AEINST?' })
  expect(classifyPosition(CGP)).toEqual({ kind: 'cgp', cgp: CGP })
  expect(classifyPosition('/games/round3.gcg')).toEqual({ kind: 'gcg', source: '/games/round3.gcg' })
  expect(classifyPosition('~/positions/pos.cgp')).toEqual({ kind: 'file', path: '~/positions/pos.cgp' })
  expect(classifyPosition('https://woogles.io/game/t5KYar5t')).toEqual({
    kind: 'gcg',
    source: 'https://woogles.io/game/t5KYar5t',
  })
  expect(classifyPosition('https://example.com/annotated/12.gcg').kind).toBe('gcg')
  expect(classifyPosition('https://example.com/share?id=9').kind).toBe('url')
  expect(() => classifyPosition('12345')).toThrow()
})

const sim = (fields: Omit<Extract<Intent, { action: 'sim' }>, 'action'>) => requestFromIntent({ action: 'sim', ...fields })

test('a sim intent becomes a request: the position read for its kind, and which', () => {
  expect(sim({ position: 'ADOPQRR', lexicon: 'NWL23' })).toEqual({
    position: { kind: 'rack', rack: 'ADOPQRR' },
    label: 'ADOPQRR',
    source: 'ADOPQRR',
    lexicon: 'NWL23',
  })
  const game = '~/games/game.gcg'
  expect(sim({ position: game, turn: 12 }).at).toEqual({ kind: 'turn', turn: 12 })
  expect(sim({ position: game, rack: 'deeilrv' }).at).toEqual({ kind: 'rack', rack: 'DEEILRV' })
  expect(sim({ position: game, word: 'VODKA' }).at).toEqual({ kind: 'word', word: 'VODKA' })
  expect(sim({ position: game, word: '(S)ilvered', relation: 'after' }).at).toEqual({ kind: 'after', word: 'SILVERED' })
  expect(sim({ position: game, letters: 'DEEILRV' }).at).toEqual({ kind: 'letters', letters: 'DEEILRV' })
  expect(sim({ position: game, event: 23 }).at).toEqual({ kind: 'goto', goto: '23' })
  expect(sim({ position: game }).at).toBe(undefined)
  // A CGP is taken whole, opcodes and all.
  expect(sim({ position: CGP }).position).toEqual({ kind: 'cgp', cgp: CGP })
  // Which position means nothing beside a rack or a CGP.
  expect(() => sim({ position: 'ADOPQRR', turn: 12 })).toThrow()
  expect(() => sim({ position: game, turn: 0 })).toThrow()
  expect(() => sim({})).toThrow()
})

test('with no position, the intent means what the pane shows, in its lexicon', () => {
  const shown = sim({ position: '~/games/game.gcg', lexicon: 'CSW21', turn: 4 })
  const moved = requestFromIntent({ action: 'sim', turn: 9 }, shown)
  expect([moved.source, moved.lexicon, moved.at]).toEqual(['~/games/game.gcg', 'CSW21', { kind: 'turn', turn: 9 }])
  // A new position starts afresh.
  expect(requestFromIntent({ action: 'sim', position: 'RUCKSEX' }, shown).lexicon).toBe(undefined)
})

test("the interpreter's reply, and what it is told", () => {
  expect(parseIntent('{"action":"sim","position":"RUCKSEX","lexicon":"nwl23"}')).toEqual({
    action: 'sim',
    position: 'RUCKSEX',
    lexicon: 'NWL23',
  })
  // Fenced, or with words around it, the object is still read.
  expect(parseIntent('```json\n{"action":"navigate","to":"previous"}\n```')).toEqual({ action: 'navigate', to: 'previous' })
  expect(parseIntent('{"action":"lexicon","lexicon":"csw24"}')).toEqual({ action: 'lexicon', lexicon: 'CSW24' })
  expect(parseIntent('{"action":"unclear","question":"Which game?"}')).toEqual({ action: 'unclear', question: 'Which game?' })
  expect(() => parseIntent('no idea')).toThrow()
  expect(() => parseIntent('{"action":"dance"}')).toThrow()
  expect(() => parseIntent('{"action":"navigate","to":"sideways"}')).toThrow()

  const { system, prompt } = interpreterPrompt('rucksex nwl', {
    current: { label: 'anno62161.gcg turn 13', source: 'https://x.test/a.gcg', lexicon: 'CSW24', turn: 13, turns: 23 },
    lexica: ['CSW24', 'NWL20', 'NWL23'],
  })
  expect(system).toContain('"rucksex nwl" -> {"action":"sim","position":"RUCKSEX","lexicon":"NWL23"}')
  expect(prompt).toContain('The pane shows anno62161.gcg turn 13 (from https://x.test/a.gcg) in CSW24 at turn 13 of 23.')
  expect(prompt).toContain('The lexicons installed: CSW24, NWL20, NWL23.')
  expect(prompt.endsWith('What they typed: rucksex nwl')).toBe(true)
  expect(interpreterPrompt('x', { lexica: [] }).prompt.startsWith('The pane shows nothing yet.')).toBe(true)

  expect(checkLexicon('nwl23', ['CSW24', 'NWL23'])).toBe('NWL23')
  expect(() => checkLexicon('NWL99', ['CSW24', 'NWL23'])).toThrow()
  expect(checkLexicon('CSW19', [])).toBe('CSW19')
})

test('a CGP splits into its fields and its lexicon', () => {
  expect(splitCgp(CGP)).toEqual({
    fields: '15/15/15/15/15/15/15/5DROP6/15/15/15/15/15/15/15 AEINRST/AQR 14/0 0',
    lexicon: 'CSW24',
  })
  expect(splitCgp('15/15/15/15/15/15/15/15/15/15/15/15/15/15/15 ADOPQRR/ 0/0 0').lexicon).toBe(undefined)
})

test('the MAGPIE run for each kind of position', () => {
  const rack = magpieRun({ kind: 'rack', rack: 'ADOPQRR' }, {}, 10, { rit: true, wit: true })
  expect(rack.args.slice(0, 3)).toEqual(['setoptions', '-lex', 'CSW24'])
  expect(rack.args.join(' ')).toContain('-wmp true -rit true -wit true -ritmmap true')
  expect(rack.args.join(' ')).toContain('-numplays 50 -plies 4 -iterations 250000 -sr rr')
  expect(rack.stdin).toBe('rack ADOPQRR\nshgame\ngsimulate\n')

  const cgp = magpieRun({ kind: 'cgp', cgp: CGP }, {}, 10, { rit: false, wit: false })
  expect(cgp.lexicon).toBe('CSW24')
  expect(cgp.args.join(' ')).toContain('-rit false -wit false')
  expect(cgp.stdin.split('\n')[0]).toBe('cgp 15/15/15/15/15/15/15/5DROP6/15/15/15/15/15/15/15 AEINRST/AQR 14/0 0')

  // A GCG's own lexicon stands unless one is asked for.
  const gcg = magpieRun({ kind: 'gcg', source: '/games/a.gcg' }, { goto: '23' }, 10, { rit: true, wit: true })
  expect(gcg.args.includes('-lex')).toBe(false)
  expect(gcg.stdin).toBe('load /games/a.gcg\ngoto 23\nshgame\ngsimulate\n')
})

test("a midgame sim reads its board from shgame's", () => {
  const sim = parseSim(CGP_OUTPUT)
  expect(sim.board?.[7]).toBe('.....DROP......')
  expect(sim.board?.[0]).toBe('...............')
  expect(sim.rack).toBe('AEINRST')
  expect(sim.plays.map(play => play.id)).toEqual(['J2 RETAINS', 'J2 RETINAS', 'J2 RESIANT', 'J2 RATINES'])
  const retains = sim.plays[0]
  if (retains === undefined) {
    throw new Error('no plays')
  }
  expect([retains.isDown, retains.leave, retains.score]).toEqual([true, '', 69])
  expect(placedTiles(retains)[0]).toEqual({ row: 1, col: 9, letter: 'R' })
  expect(placedTiles(retains)[6]).toEqual({ row: 7, col: 9, letter: 'S' })
  expect(rackGhosts(sim.rack, retains).every(isGhost => isGhost)).toBe(true)
  expect(reportLines(sim, 1)).toEqual(['1. J2 RETAINS: 69 pts, win 76.44% ±0.20, equity +76.81'])
})

// Stretches of what the GCG scan printed (`load`, then `next` after `next`),
// each printed game cut to its header, its top border and the two rows
// beside them that say which event led there.

// The end of anno62161.gcg: Josh to move with DEEILRV after event 23; no one
// to move after his outplay or the end rack points.
const SCAN_ENDING = `
   A B C D E F G H I J K L M N O   > Josh  DEEILRV  616
   ------------------------------    Nits  ELTUV    387
13|  W A Z     ' L '       T A M |   Event 23 (Nits):
14|  O I     " P E N T I C E D   |   13M TAM 26 AELMTUV
   A B C D E F G H I J K L M N O     Josh           690
   ------------------------------    Nits  ELTUV    387
13|  W A Z     ' L '       T A M |   Event 24 (Josh):
14|  O I     " P E N T I C E D   |   11H (S)ILVERED 74 DEEILRV
   A B C D E F G H I J K L M N O     Josh           706
   ------------------------------    Nits  ELTUV    387
13|  W A Z     ' L '       T A M |   Event 25 (Josh):
14|  O I     " P E N T I C E D   |   ELTUV +16 (end rack points)
`

// Events 7 to 13 of testdata/gcgs/outplay_challenge_bonus.gcg: a pass, a
// phony (VOKDA) and its withdrawal, which RightBehindYou makes while
// HastyBot is to move, so it is no one's turn.
const SCAN_PHONY = `
   A B C D E F G H I J K L M N O     HastyBot                 176
   ------------------------------  > RightBehindYou  ADGKOSV  131
13|    -       '   '       -     |   Event 7 (HastyBot):
14|  -       "       "       -   |   K2 NEUM 27 EEIMNTU
   A B C D E F G H I J K L M N O   > HastyBot        AAEEILT  176
   ------------------------------    RightBehindYou           131
13|    -       '   '       -     |   Event 8 (RightBehindYou):
14|  -       "       "       -   |   (pass) ADGKOSV
   A B C D E F G H I J K L M N O     HastyBot                 194
   ------------------------------  > RightBehindYou  ADGKOSV  131
13|    -       '   '       -     |   Event 9 (HastyBot):
14|  -       "       "       -   |   11K LEA 18 AAEEILT
   A B C D E F G H I J K L M N O   > HastyBot        ADEEIRT  194
   ------------------------------    RightBehindYou           158
13|    -       '   '       -     |   Event 10 (RightBehindYou):
14|  -       "       "       -   |   6B VOKDA 27 ADGKOSV
   A B C D E F G H I J K L M N O   > HastyBot        ADEEIRT  194
   ------------------------------    RightBehindYou  ADKOV    131
13|    -       '   '       -     |   Event 11 (RightBehindYou):
14|  -       "       "       -   |   6B VOKDA 27 ADGKOSV (challenged off)
   A B C D E F G H I J K L M N O     HastyBot                 211
   ------------------------------  > RightBehindYou  ADGKOSV  131
13|    -       '   '       -     |   Event 12 (HastyBot):
14|  -       "       "       -   |   M2 ED 17 ADEEIRT
   A B C D E F G H I J K L M N O   > HastyBot        ABEIRTV  211
   ------------------------------    RightBehindYou           158
13|    -       '   '       -     |   Event 13 (RightBehindYou):
14|  -       "       "       -   |   6B VODKA 27 ADGKOSV
`

test('the positions of a GCG, one per turn', () => {
  const positions = gcgPositions(SCAN_PHONY)
  // The withdrawal after event 10 is not a turn; the latest position is.
  expect(positions.map(position => [position.events, position.turn, position.player, position.rack])).toEqual([
    [7, 1, 'RightBehindYou', 'ADGKOSV'],
    [8, 2, 'HastyBot', 'AAEEILT'],
    [9, 3, 'RightBehindYou', 'ADGKOSV'],
    [11, 4, 'HastyBot', 'ADEEIRT'],
    [12, 5, 'RightBehindYou', 'ADGKOSV'],
    [13, 6, 'HastyBot', 'ABEIRTV'],
  ])
  expect(positions[2]?.move).toBe('6B VOKDA 27 ADGKOSV')
  expect(positions[5]?.move).toBe(undefined)
  // A finished game's latest position is before its last move.
  expect(gcgPositions(SCAN_ENDING).map(position => [position.events, position.move])).toEqual([
    [23, '11H (S)ILVERED 74 DEEILRV'],
  ])
  expect(scanRun('https://example.com/a.gcg', undefined).stdin.startsWith('load https://example.com/a.gcg\nnext\nnext\n')).toBe(
    true,
  )
})

test('a turn, rack or word picks one position, or asks which', () => {
  const positions = gcgPositions(SCAN_PHONY)
  const events = (choice: Choice) => ('position' in choice ? choice.position.events : choice)
  expect(events(choosePosition(positions, undefined))).toBe(13)
  expect(events(choosePosition(positions, { kind: 'turn', turn: 4 }))).toBe(11)
  expect(events(choosePosition(positions, { kind: 'word', word: 'VOKDA' }))).toBe(9)
  expect(events(choosePosition(positions, { kind: 'letters', letters: 'AEILTAE' }))).toBe(8)
  expect(events(choosePosition(positions, { kind: 'rack', rack: 'TVRBAIE' }))).toBe(13)
  expect(choosePosition(positions, { kind: 'goto', goto: 'end' })).toEqual({ goto: 'end' })
  // RightBehindYou held ADGKOSV three times: ask.
  const ambiguous = choosePosition(positions, { kind: 'letters', letters: 'ADGKOSV' })
  expect('candidates' in ambiguous ? ambiguous.candidates.map(describePosition) : ambiguous).toEqual([
    'turn 1: RightBehindYou to move with ADGKOSV, who played (pass)',
    'turn 3: RightBehindYou to move with ADGKOSV, who played 6B VOKDA',
    'turn 5: RightBehindYou to move with ADGKOSV, who played 6B VODKA',
  ])
  expect('error' in choosePosition(positions, { kind: 'turn', turn: 7 })).toBe(true)
  expect('error' in choosePosition(positions, { kind: 'word', word: 'QUIXOTIC' })).toBe(true)
  expect('error' in choosePosition([], undefined)).toBe(true)
})

test('positions are named short', () => {
  expect(positionLabel('https://www.cross-tables.com/annotated/selfgcg/621/anno62161.gcg')).toBe('anno62161.gcg')
  expect(positionLabel('~/games/round3.gcg')).toBe('round3.gcg')
  expect(positionLabel('ADOPQRR')).toBe('ADOPQRR')
  expect(positionLabel(CGP)).toBe('CGP')
})

// A streamed run (a sim) answered as a run is: what `answer` gives, in two
// pieces cut mid-line, as a pipe may cut it.
function answerSpawns(
  on: On,
  runs: { argv: readonly string[]; stdin?: string; cwd?: string }[],
  answer: (argv: readonly string[], stdin?: string) => string,
) {
  on('process.spawn', async function* (_$: unknown, e: { argv: readonly string[]; input?: string; cwd?: string }) {
    runs.push({ argv: e.argv, stdin: e.input, cwd: e.cwd })
    const stdout = answer(e.argv, e.input)
    const cut = Math.floor(stdout.length / 2)
    for (const text of [stdout.slice(0, cut), stdout.slice(cut)].filter(piece => piece !== '')) {
      yield { stream: 'stdout' as const, text }
    }
    return { value: { code: 0, signal: null } }
  } as never)
}

// A Linux computer's environment, as the hosts below stand in for it.
const LINUX = { env: { HOME: '/home/test', TMPDIR: '/tmp/test' }, uname: 'Linux x86_64' }

// Stands in for the host: the computer (Linux unless `machine` says),
// HOME, the core count, the lexicons, MAGPIE (whose scan of a GCG and whose
// sim answer from fixtures, its lines ended as `machine` ends them), and the
// model reading /magpie's words, which answers `replies` in order.
function fakeHost(
  on: On,
  scan = SCAN_ENDING,
  replies: string[] = [],
  endgame = '',
  machine: { env: Record<string, string>; uname: string; newline?: string } = LINUX,
) {
  const runs: { argv: readonly string[]; stdin?: string; cwd?: string }[] = []
  mock.env(on, machine.env)
  const answer = (argv: readonly string[], stdin?: string) =>
    argv[0] === 'uname'
      ? `${machine.uname}\n`
      : argv[0] === 'getconf'
        ? '12\n'
        : (stdin?.includes('next\n') ? scan : stdin?.includes('endgame\n') ? endgame : CGP_OUTPUT).replaceAll(
            '\n',
            machine.newline ?? '\n',
          )
  on('process.run', (_$, e) => {
    runs.push({ argv: e.argv, stdin: e.init?.stdin, cwd: e.init?.cwd })
    return {
      value: { exitCode: 0, stdout: answer(e.argv, e.init?.stdin), stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
    } as never
  })
  answerSpawns(on, runs, answer)
  on('fs.exists', () => ({ value: true }) as never)
  on('fs.list', () => ({ value: ['CSW24.kwg', 'CSW24.klv2', 'NWL23.kwg'].map(name => ({ name, kind: 'file', size: 1 })) }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('model.complete', () => {
    const text = replies.shift()
    const usage = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
    return { value: text === undefined ? { isAnswered: false, reason: 'api-error', usage } : { isAnswered: true, text, usage } } as never
  })
  return runs
}

for (const [options, binary, cwd] of [
  [undefined, '/home/test/.magpie/bin/magpie', '/home/test/.magpie'],
  [{ magpieDir: '/opt/magpie/' }, '/opt/magpie/bin/magpie', '/opt/magpie'],
  [{ magpieDir: '~/magpie' }, '/home/test/magpie/bin/magpie', '/home/test/magpie'],
] as const) {
  test(`the simulate tool runs ${binary} and reports the top plays`, { options: options ?? {} }, async ($, on) => {
    const runs = fakeHost(on)
    const result = await $.tool.call({ tool: 'mcp__magpie-sim__simulate', position: CGP } as never)
    expect(JSON.stringify(result)).toContain('1. J2 RETAINS: 69 pts, win 76.44%')
    const magpie = runs.find(run => run.argv[0] === binary)
    expect(magpie?.cwd).toBe(cwd)
    expect(magpie?.argv.join(' ')).toContain('-lex CSW24 -wmp true -rit true -wit true')
    expect(magpie?.argv.join(' ')).toContain('-threads 10')
    expect(magpie?.stdin?.startsWith('cgp 15/15/')).toBe(true)
  })
}

// Windows: MAGPIE where it keeps its own data, the cores as Windows names
// them, CRLF lines read as any others.
const WINDOWS = {
  env: { OS: 'Windows_NT', PROCESSOR_ARCHITECTURE: 'ARM64', USERPROFILE: 'C:\\Users\\test', LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local', NUMBER_OF_PROCESSORS: '8', TEMP: 'C:\\Temp' },
  uname: '',
  newline: '\r\n',
}

test('on Windows the simulate tool runs magpie.exe from %LOCALAPPDATA%\\MAGPIE', async ($, on) => {
  const runs = fakeHost(on, SCAN_ENDING, [], '', WINDOWS)
  fakePictures(on)
  const result = JSON.stringify(await $.tool.call({ tool: 'mcp__magpie-sim__simulate', position: CGP, picture: true } as never))
  expect(result).toContain('1. J2 RETAINS: 69 pts, win 76.44%')
  const magpie = runs.find(run => run.argv[0]?.endsWith('magpie.exe'))
  expect(magpie?.argv[0]).toBe('C:\\Users\\test\\AppData\\Local\\MAGPIE/bin/magpie.exe')
  expect(magpie?.cwd).toBe('C:\\Users\\test\\AppData\\Local\\MAGPIE')
  expect(magpie?.argv.join(' ')).toContain('-threads 6')
  expect(runs.some(run => run.argv[0] === 'uname' || run.argv[0] === 'getconf' || run.argv[0] === 'sh')).toBe(false)
  // The picture's base64 decoded by certutil, from the file $.fs wrote.
  const decode = runs.find(run => run.argv[0] === 'certutil')
  expect(decode?.argv.slice(0, 3)).toEqual(['certutil', '-f', '-decode'])
  expect(decode?.argv[3]).toMatch(/^C:\\Temp\\magpie-sim\\CGP-\d+\.raw\.png\.b64$/)
  expect(result).toMatch(/C:\\\\Temp\/magpie-sim\/CGP-\d+\.raw\.png/)
})

const XT_GAME = 'https://www.cross-tables.com/annotated/selfgcg/621/anno62161.gcg'

test('a GCG with no turn named sims its latest position with a player to move', async ($, on) => {
  const runs = fakeHost(on)
  const result = await $.tool.call({ tool: 'mcp__magpie-sim__simulate', position: XT_GAME } as never)
  const sims = runs.filter(run => run.stdin?.includes('gsimulate'))
  expect(sims.map(run => run.stdin)).toEqual([`load ${XT_GAME}\ngoto 23\nshgame\ngsimulate\n`])
  expect(JSON.stringify(result)).toContain('anno62161.gcg turn 1')
})

test('a rack the player held more than once is asked about, not simmed', async ($, on) => {
  const runs = fakeHost(on, SCAN_PHONY)
  const result = await $.tool.call({ tool: 'mcp__magpie-sim__simulate', position: XT_GAME, letters: 'ADGKOSV' } as never)
  const text = JSON.stringify(result)
  expect(text).toContain('ADGKOSV fits 3 positions in anno62161.gcg')
  expect(text).toContain('turn 3: RightBehindYou to move with ADGKOSV, who played 6B VOKDA')
  expect(runs.some(run => run.stdin?.includes('gsimulate'))).toBe(false)
})

test('/magpie reads its words with the model, and asks which position when several fit', async ($, on) => {
  fakeHost(on, SCAN_PHONY, [`{"action":"sim","position":"${XT_GAME}","rack":"ADGKOSV"}`])
  const { text } = await $.command.run({ command: 'magpie', args: `${XT_GAME} when they had ADGKOSV` } as never)
  expect(text).toContain('Rack ADGKOSV fits 3 positions in anno62161.gcg:')
  expect(text).toContain(`Say which, e.g. /magpie ${XT_GAME} turn 1`)
})

test('/magpie says so when the model does not answer', async ($, on) => {
  fakeHost(on)
  const { text } = await $.command.run({ command: 'magpie', args: 'rucksex' } as never)
  expect(text).toContain('the model reading it did not answer (api-error)')
})

test('/magpie moves through the game the pane shows', async ($, on) => {
  fakeHost(on, SCAN_PHONY, [
    '{"action":"navigate","to":"next"}',
    '{"action":"navigate","to":"previous"}',
    '{"action":"navigate","to":"first"}',
  ])
  const before = await $.command.run({ command: 'magpie', args: 'next turn' } as never)
  expect(before.text).toContain('no game to move through')
  // The latest position, turn 6 of 6.
  await $.tool.call({ tool: 'mcp__magpie-sim__simulate', position: XT_GAME } as never)
  const back = await $.command.run({ command: 'magpie', args: 'back' } as never)
  expect(back.text).toContain('Simulating anno62161.gcg turn 5 in ')
})

test('/magpie with a lexicon alone analyzes the same position again, unless it is in use', async ($, on) => {
  fakeHost(on, SCAN_ENDING, ['{"action":"lexicon","lexicon":"CSW24"}', '{"action":"lexicon","lexicon":"NWL23"}'])
  await $.tool.call({ tool: 'mcp__magpie-sim__simulate', position: 'AEINRST' } as never)
  const same = await $.command.run({ command: 'magpie', args: 'csw' } as never)
  expect(same.text).toBe('Already using CSW24 for AEINRST.')
  const other = await $.command.run({ command: 'magpie', args: 'nwl' } as never)
  // The sim runs on after the command answers.
  expect(other.text).toContain('Analyzing AEINRST again in NWL23 (was CSW24)')
})

// The endgame of that game, as MAGPIE printed it: the board after event 23,
// and plays through the S already on 11H, which it writes in parentheses.
const ENDGAME_OUTPUT = `
   A B C D E F G H I J K L M N O   > Josh  DEEILRV  616
   ------------------------------    Nits  ELTUV    387
 1|=     '       G A M B O G I C |
 2|  -       "   I   "       -   |
 3|    J       R E G N A N T     |
 4|'   O Y       '       O U   ' |
 5|    W O S   B R I S A N t     |
 6|  Q   U H " L     "       "   |
 7|  A '   A   I   '       '     |
 8|= I T E R A N t       '     = |
 9|  D '   N   Y A '       '     |
10|  "     I O   S   "       "   |
11|      F E U   S     -         |
12|'     E R K   E       -     ' |
13|  W A Z     ' L '       T A M |
14|  O I     " P E N T I C E D   |
15|P O T H E R E D       ' F O X |
   ------------------------------ 

1:  11H (S)ILVERED      74 - 100.00 0.0000 90.00 0.0000 90.00 1 0.00  0.00 0.00 0.00  0.00 0.00 
2:  11H (S)LIVERED      74 - 100.00 0.0000 90.00 0.0000 90.00 1 0.00  0.00 0.00 0.00  0.00 0.00 

Showing 2 of 2 plays
Showing 2 of 2 plies
`

test('tiles a play goes through are left where they are', () => {
  const sim = parseSim(ENDGAME_OUTPUT)
  const silvered = sim.plays[0]
  if (silvered === undefined) {
    throw new Error('no plays')
  }
  expect(silvered.id).toBe('11H (S)ILVERED')
  expect(silvered.tiles).toBe('.ILVERED')
  expect(sim.rack).toBe('DEEILRV')
  // The S is the board's; the play's tiles start beside it.
  expect(sim.board?.[10]?.[7]).toBe('S')
  expect(placedTiles(silvered).length).toBe(7)
  expect(placedTiles(silvered)[0]).toEqual({ row: 10, col: 8, letter: 'I' })
  // A blank on the board reads as its lowercase letter.
  expect(sim.board?.[4]?.[12]).toBe('t')
})

test('a rack after the moves played before it', () => {
  const request = sim({ position: 'AEINRST', after: [{ coordinate: '8g', word: 'vav' }] })
  expect(request.position).toEqual({ kind: 'rack', rack: 'AEINRST', after: [{ coordinate: '8G', word: 'VAV' }] })
  expect(request.label).toBe('AEINRST after 8G VAV')
  expect(magpieRun(request.position as never, {}, 10, { rit: true, wit: true }).stdin).toBe(
    'rack VAV\ncommit 8G VAV\nrack AEINRST\nshgame\ngsimulate\n',
  )
  // Mixed case keeps its blanks; a board tile in parentheses is a `.` to
  // commit and no tile from the rack.
  const two = sim({
    position: 'AEINRST',
    after: [
      { coordinate: '8g', word: 'VaV' },
      { coordinate: '9f', word: '(v)ie' },
    ],
  })
  expect(magpieRun(two.position as never, {}, 10, { rit: true, wit: true }).stdin).toBe(
    'rack V?V\ncommit 8G VaV\nrack IE\ncommit 9F .IE\nrack AEINRST\nshgame\ngsimulate\n',
  )
  expect(canonicalWord('vav')).toBe('VAV')
  expect(canonicalWord('VaV')).toBe('VaV')
  expect(tilesFromRack('ANTIQuES')).toBe('ANTIQ?ES')
  expect(() => sim({ position: 'AEINRST', after: [{ coordinate: 'Z9', word: 'VAV' }] })).toThrow()
  expect(() => sim({ position: CGP, after: [{ coordinate: '8G', word: 'VAV' }] })).toThrow()
})

test('before a word is the rack it was played from; after it, its player’s next rack', () => {
  const positions = gcgPositions(SCAN_PHONY)
  const events = (choice: Choice) => ('position' in choice ? choice.position.events : choice)
  expect(events(choosePosition(positions, { kind: 'word', word: 'LEA' }))).toBe(8)
  // HastyBot played LEA on turn 2; their next rack is turn 4's.
  expect(events(choosePosition(positions, { kind: 'after', word: 'LEA' }))).toBe(11)
  // After the phony came off, RightBehindYou's next rack (turn 5).
  expect(events(choosePosition(positions, { kind: 'after', word: 'VOKDA', coordinate: '6B' }))).toBe(12)
  expect('error' in choosePosition(positions, { kind: 'after', word: 'VOKDA', coordinate: '7B' })).toBe(true)
  // RightBehindYou has no turn after VODKA in this stretch, nor Josh after
  // the game's last move.
  const lastTurn = choosePosition(positions, { kind: 'after', word: 'VODKA' })
  expect('error' in lastTurn ? lastTurn.error : lastTurn).toBe("VODKA was RightBehindYou's last turn; no rack came after it")
  expect('error' in choosePosition(gcgPositions(SCAN_ENDING), { kind: 'after', word: 'SILVERED' })).toBe(true)
  // "The VODKA turn", as letters that could be a rack, is where VODKA was
  // played.
  const choice = choosePosition(positions, { kind: 'letters', letters: 'VODKA' })
  expect('position' in choice ? choice.position.turn : choice).toBe(5)
})

// Events 17 to 21 of anno62161.gcg: MAGPIE takes Josh's GAMBOGIC (event 19)
// and its challenge bonus (event 20) as one step, so `next` prints no event
// 19.
const SCAN_BONUS = `
   A B C D E F G H I J K L M N O     Josh           453
   ------------------------------  > Nits  DEGIINT  265
13|  W A Z     ' L '       -     |   Event 17 (Josh):
14|  -       "   E   "       -   |   3G REGNANT 79 AEGNNRT
   A B C D E F G H I J K L M N O   > Josh  ABCGIMO  453
   ------------------------------    Nits           277
13|  W A Z     ' L '       -     |   Event 18 (Nits):
14|  -       "   E   "       -   |   H1 GI(E) 12 DEGIINT
   A B C D E F G H I J K L M N O     Josh           559
   ------------------------------  > Nits  CDEINPT  277
13|  W A Z     ' L '       -     |   Event 20 (Josh):
14|  -       "   E   "       -   |   1H (G)AMBOGIC 101 + 5 = 106 ABCGIMO
   A B C D E F G H I J K L M N O   > Josh  DEEFORX  559
   ------------------------------    Nits           361
13|  W A Z     ' L '       -     |   Event 21 (Nits):
14|  -       "   E   "       -   |   14G P(E)NTICED 84 CDEINPT
`

test('a play and its challenge bonus are one turn', () => {
  const positions = gcgPositions(SCAN_BONUS)
  expect(positions.map(position => [position.events, position.turn, position.player, position.movedTo])).toEqual([
    [17, 1, 'Nits', 18],
    [18, 2, 'Josh', 20],
    [20, 3, 'Nits', 21],
    [21, 4, 'Josh', undefined],
  ])
  const events = (choice: Choice) => ('position' in choice ? choice.position.events : choice)
  // The viewer's move 19 is GAMBOGIC, and its move 20 the bonus: both
  // Josh's turn.
  expect(events(choosePosition(positions, { kind: 'move', event: 19 }))).toBe(18)
  expect(events(choosePosition(positions, { kind: 'move', event: 20 }))).toBe(18)
  expect(events(choosePosition(positions, { kind: 'move', event: 21 }))).toBe(20)
  expect('error' in choosePosition(positions, { kind: 'move', event: 25 })).toBe(true)
})

test('cross-tables links, and the move their viewer shows', () => {
  const link = 'https://www.cross-tables.com/annotated.php?u=62161#13#'
  expect(classifyPosition(link)).toEqual({ kind: 'gcg', source: 'https://www.cross-tables.com/annotated.php?u=62161' })
  expect(sim({ position: link }).label).toBe('cross-tables 62161')
  // #13# is the viewer's move 13: the turn it was played on.
  expect(sim({ position: link }).at).toEqual({ kind: 'move', event: 13 })
  expect(sim({ position: 'https://www.cross-tables.com/annotated.php?u=62161' }).at).toBe(undefined)
  expect(sim({ position: 'https://www.cross-tables.com/annotated.php?u=62161#0#' }).at).toBe(undefined)
  // A turn asked for says which position instead.
  expect(sim({ position: link, turn: 5 }).at).toEqual({ kind: 'turn', turn: 5 })
  const positions = gcgPositions(SCAN_PHONY)
  const events = (choice: Choice) => ('position' in choice ? choice.position.events : choice)
  // Move 10 is the phony, played on RightBehindYou's turn 3; move 11, its
  // withdrawal, was no one's turn.
  expect(events(choosePosition(positions, { kind: 'move', event: 10 }))).toBe(9)
  expect('error' in choosePosition(positions, { kind: 'move', event: 11 })).toBe(true)
  // `event N` is MAGPIE's goto, named by its turn where one starts there.
  const choice = choosePosition(positions, { kind: 'goto', goto: '11' })
  expect('position' in choice ? choice.position.turn : choice).toBe(4)
  expect(choosePosition(positions, { kind: 'goto', goto: '10' })).toEqual({ goto: '10' })
})

test('columns fit the longest play, through-tiles and all', () => {
  const sim = parseSim(ENDGAME_OUTPUT)
  const layout = tableLayout(sim.plays, false)
  const header = headerLine(layout, 'win', true)
  const rows = sim.plays.map(play => rowLine(layout, play, false))
  expect(rows.every(row => row.length === header.length)).toBe(true)
  // Every row's Win% ends where the heading's does.
  const winEnd = header.indexOf('Win%▼') + 'Win%▼'.length
  expect(rows.every(row => /\d$/.test(row.slice(0, winEnd)) && row[winEnd] === ' ')).toBe(true)
})

// The solver on that endgame (testdata as MAGPIE printed it, cut to four
// moves): the board, then each first move with what its line nets (V), the
// final spread (S) and the line's later turns.
const ENDGAME_SOLVE = `${ENDGAME_OUTPUT.split('\n1:')[0]}
Endgame (depth: 6, time: 6.442s, status: finished)
Play                          V  S   Turn 2            Turn 3                   Turn 4       Turn 5
11H (S)ILVERED 74 (ELTUV +16) 90 319
10H (S)LIVE 10                14 243 4K V(OU)LU 15     M8 RED 15 (ET +4)
K11 VIR(I)D 18                14 243 4K V(OU)LU 15     11K (V)ELE 7 (ET +4)
K12 DE(I) 4                   14 243 J11 TE 5          4K L(OU)R 7              7A V(A)U 10  O1 (C)IVE 16 (L +2)
`

test('an endgame reads as results: W+ or L- the final spread, and what the line nets', () => {
  const solved = parseSim(ENDGAME_SOLVE)
  expect([solved.kind, solved.rack, solved.plies, solved.seconds]).toEqual(['endgame', 'DEEILRV', 6, 6.442])
  expect(solved.plays.map(play => [play.id, play.score, play.result, play.net, play.line])).toEqual([
    ['11H (S)ILVERED', 74, 319, 90, '(ELTUV +16)'],
    ['10H (S)LIVE', 10, 243, 14, '4K V(OU)LU 15 · M8 RED 15 (ET +4)'],
    ['K11 VIR(I)D', 18, 243, 14, '4K V(OU)LU 15 · 11K (V)ELE 7 (ET +4)'],
    ['K12 DE(I)', 4, 243, 14, 'J11 TE 5 · 4K L(OU)R 7 · 7A V(A)U 10 · O1 (C)IVE 16 (L +2)'],
  ])
  // What stays on the rack, for the board's ghosts.
  expect(solved.plays[1]?.leave).toBe('DER')
  expect(solved.board?.[10]?.[7]).toBe('S')
  expect([resultText(20), resultText(-10), resultText(0)]).toEqual(['W+20', 'L-10', 'T=0'])
  const layout = tableLayout(solved.plays, false, false, 'endgame')
  expect(headerLine(layout, 'net', true)).toMatch(/Play +Sc +Result +Net▼ +Then/)
  expect(rowLine(layout, solved.plays[0] as never, true)).toMatch(/^▶ +1 11H \(S\)ILVERED +74 +W\+319 +\+90 \(ELTUV \+16\)/)
  expect(reportLines(solved, 1)).toEqual(['1. 11H (S)ILVERED: 74 pts, W+319, net 90; then (ELTUV +16)'])
})

test('with the bag empty the endgame is solved, not simmed', async ($, on) => {
  // The scan's last position shows 5 unseen tiles: the other rack alone.
  const scan = SCAN_ENDING.replace('   Nits  ELTUV    387\n', '   Nits  ELTUV    387\n 2|  -       "       "       -   |   Unseen: 5 (2v | 3c)\n')
  const runs = fakeHost(on, scan, [], ENDGAME_SOLVE)
  const result = await $.tool.call({ tool: 'mcp__magpie-sim__simulate', position: XT_GAME } as never)
  expect(JSON.stringify(result)).toContain('1. 11H (S)ILVERED: 74 pts, W+319, net 90')
  const solve = runs.find(run => run.stdin?.includes('endgame'))
  expect(solve?.stdin).toBe(`load ${XT_GAME}\ngoto 23\nshgame\nendgame\n`)
  expect(solve?.argv.join(' ')).toContain('-etopk 50')
  expect(cgpUnseen(CGP)).toBe(100 - 4 - 7)
})

// Deflate's fixed-code blocks undone, as a PNG reader would: enough to read
// back what encodePng writes, in a test runtime with no inflate of its own.
const LENGTH_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258]
const LENGTH_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0]
const DISTANCE_BASE = [
  1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289,
  16385, 24577,
]
const DISTANCE_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13]

function inflateFixed(data: Uint8Array): number[] {
  const out: number[] = []
  let position = 0
  const bit = () => ((data[position >>> 3] ?? 0) >>> (position++ & 7)) & 1
  const bits = (count: number) => {
    let value = 0
    for (let index = 0; index < count; index++) {
      value |= bit() << index
    }
    return value
  }
  // A Huffman code comes most significant bit first.
  const code = (count: number, start = 0) => {
    let value = start
    for (let index = 0; index < count; index++) {
      value = (value << 1) | bit()
    }
    return value
  }
  let isLast = false
  while (!isLast) {
    isLast = bit() === 1
    if (bits(2) !== 1) {
      throw new Error('not a block of fixed codes')
    }
    for (;;) {
      const seven = code(7)
      let symbol: number
      if (seven <= 23) {
        symbol = 256 + seven
      } else {
        const eight = code(1, seven)
        symbol = eight <= 0xbf ? eight - 0x30 : eight <= 0xc7 ? 280 + eight - 0xc0 : 144 + code(1, eight) - 0x190
      }
      if (symbol === 256) {
        break
      }
      if (symbol < 256) {
        out.push(symbol)
        continue
      }
      const length = (LENGTH_BASE[symbol - 257] ?? 0) + bits(LENGTH_EXTRA[symbol - 257] ?? 0)
      const distanceCode = code(5)
      const distance = (DISTANCE_BASE[distanceCode] ?? 0) + bits(DISTANCE_EXTRA[distanceCode] ?? 0)
      for (let index = 0; index < length; index++) {
        out.push(out[out.length - distance] ?? -1)
      }
    }
  }
  return out
}

// A PNG's chunks by type.
function pngChunks(png: Uint8Array): Map<string, Uint8Array> {
  const chunks = new Map<string, Uint8Array>()
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength)
  for (let at = 8; at < png.length; at += 12 + view.getUint32(at)) {
    chunks.set(String.fromCharCode(...png.subarray(at + 4, at + 8)), png.subarray(at + 8, at + 8 + view.getUint32(at)))
  }
  return chunks
}

// The PNG's rows as a reader gets them, after its zlib header.
const pngRows = (png: Uint8Array) => inflateFixed((pngChunks(png).get('IDAT') ?? new Uint8Array()).subarray(2))

test('a PNG: signature, header, and every row, compressed', () => {
  const png = encodePng(2, 3, new Uint8Array(2 * 3 * 4).fill(200))
  expect([...png.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
  // IHDR: 13 bytes of width, height, 8 bits, truecolour.
  expect([...(pngChunks(png).get('IHDR') ?? [])]).toEqual([0, 0, 0, 2, 0, 0, 0, 3, 8, 2, 0, 0, 0])
  expect([...(pngChunks(png).get('IDAT')?.slice(0, 2) ?? [])]).toEqual([0x78, 0x01])
  // The rows: a filter byte and 2 RGB pixels each.
  expect(pngRows(png)).toEqual([0, 200, 200, 200, 200, 200, 200, 0, 200, 200, 200, 200, 200, 200, 0, 200, 200, 200, 200, 200, 200])

  // A board, every pixel read back, in a small part of its stored size;
  // a row of tiles with its alpha.
  const font = parseFont(fixtureFont())
  const sim = parseSim(CGP_OUTPUT)
  const board = boardPicture(font, sim.board, sim.rack, sim.plays[0] as Play)
  const boardPng = encodePng(board.width, board.height, board.pixels)
  const rowBytes = 1 + board.width * 3
  const expected: number[] = []
  for (let row = 0; row < board.height; row++) {
    expected.push(0)
    for (let col = 0; col < board.width; col++) {
      const at = (row * board.width + col) * 4
      expected.push(board.pixels[at] ?? 0, board.pixels[at + 1] ?? 0, board.pixels[at + 2] ?? 0)
    }
  }
  expect(pngRows(boardPng)).toEqual(expected)
  expect(boardPng.length).toBeLessThan((rowBytes * board.height) / 20)
  const tiles = tilesPicture(font, [{ letter: 'Q', isThrough: false }], 1)
  const tilesPng = encodePng(tiles.width, tiles.height, tiles.pixels, true)
  expect(pngChunks(tilesPng).get('IHDR')?.[9]).toBe(6)
  expect(pngRows(tilesPng).length).toBe((1 + tiles.width * 4) * tiles.height)
})

// A picture's making: the folder from TMPDIR, the PNG decoded there, sips;
// and the prompts the mod queues for Claude to send it.
function fakePictures(on: On) {
  const prompts: string[] = []
  on('fs.read', (_$, e) => (e.as === 'bytes' ? { value: { base64: fixtureFont().toBase64() } } : undefined) as never)
  on('fs.write', () => ({ value: undefined }) as never)
  on('prompt.submit', (_$, e) => {
    prompts.push(e.text)
    return { drop: 'the test keeps it' } as never
  })
  return prompts
}

// A Mac's squeezed by sips; elsewhere as written.
const PICTURE_FILE = /\/tmp\/test\/magpie-sim\/[A-Za-z0-9-]+-\d+(?:\.raw)?\.png/
const MAC = { env: { HOME: '/home/test', TMPDIR: '/tmp/test/' }, uname: 'Darwin arm64' }

test('the simulate tool draws a picture and tells Claude to send it', async ($, on) => {
  const runs = fakeHost(on, SCAN_ENDING, [], '', MAC)
  fakePictures(on)
  const result = JSON.stringify(await $.tool.call({ tool: 'mcp__magpie-sim__simulate', position: CGP, picture: true } as never))
  expect(result).toContain('Send the person this picture with SendUserFile (display \\"render\\"')
  expect(result).toMatch(PICTURE_FILE)
  const decode = runs.find(run => run.argv[0] === 'sh')
  expect(decode?.argv.slice(-2)[0]).toBe('/tmp/test/magpie-sim')
  expect(decode?.stdin?.startsWith(encodePng(1, 1, new Uint8Array(4)).toBase64().slice(0, 8))).toBe(true)
  expect(runs.some(run => run.argv[0] === 'sips')).toBe(true)
})

test('/magpie picture asks Claude, in a prompt, to send a picture of what the pane shows', async ($, on) => {
  fakeHost(on, SCAN_ENDING, ['{"action":"picture"}', '{"action":"picture"}'])
  const prompts = fakePictures(on)
  const clock = mock.clock(on)
  const before = await $.command.run({ command: 'magpie', args: 'send it to my phone' } as never)
  expect(before.text).toContain('nothing to show yet')
  await $.tool.call({ tool: 'mcp__magpie-sim__simulate', position: 'AEINRST' } as never)
  const after = await $.command.run({ command: 'magpie', args: 'send it to my phone' } as never)
  expect(after.text).toBe('Sent a picture of AEINRST.')
  // The prompt goes from a timer, past the command's own turn.
  expect(prompts.length).toBe(0)
  await clock.advance(1000)
  expect(prompts.length).toBe(1)
  expect(prompts[0]).toMatch(/^Send the person this picture with SendUserFile/)
  expect(prompts[0]).toMatch(PICTURE_FILE)
})

test("the phone's picture draws a sim and an endgame, leaves and all", () => {
  const font = parseFont(fixtureFont())
  for (const sim of [parseSim(CGP_OUTPUT), parseSim(ENDGAME_SOLVE)]) {
    const shown = sim.plays[0]
    if (shown === undefined) {
      throw new Error('no plays')
    }
    const picture = cardPicture(font, sim, shown, sim.rack, sim.kind)
    expect(picture.width >= 720).toBe(true)
    expect(picture.pixels.length).toBe(picture.width * picture.height * 4)
  }
  // An endgame play that keeps tiles shows them: 10H (S)LIVE keeps DER.
  expect(parseSim(ENDGAME_SOLVE).plays[1]?.leave).toBe('DER')
})

// What `generate` printed after 8G QI: the board, then the first of the plays
// from AEINRST (and H3 INERT(I)AS, further down its list).
const GENERATED_INERTIAS = `
   A B C D E F G H I J K L M N O     Player 1           22
   ------------------------------  > Player 2           0
 1|=     '       =       '     = |
 2|  -       "       "       -   |   Unseen: 98 (41v | 55c)
 3|    -       '   '       -     |   ? ? A A A A A A A A
 4|'     -       '       -     ' |   A B B C C D D D D E
 5|        -           -         |   E E E E E E E E E E
 6|  "       "       "       "   |   E F F G G G H H I I
 7|    '       '   '       '     |   I I I I I I J K L L
 8|=     '     Q I       '     = |   L L M M N N N N N N
 9|    '       '   '       '     |   O O O O O O O O P P
10|  "       "       "       "   |   R R R R R R S S S S
11|        -           -         |   T T T T T T U U U U
12|'     -       '       -     ' |   V V W W X Y Y Z
13|    -       '   '       -     |   Event 1 (Player 1):
14|  -       "       "       -   |   8G QI 22 IQ
15|=     '       =       '     = |
   ------------------------------

1:     H8 (I)NERTIAS          77 77.00
2:     9C RETAINS             74 74.00
3:     9C RETSINA             74 74.00
4:     9B STEARIN             73 73.00
5:     9D RATINES             73 73.00
6:     9D RETINAS             73 73.00
40:    H3 INERT(I)AS          59 59.00
Showing 1365 of 1365 plays
`

// And after H8 (I)NERTIAS, from ZG: ZAG through its A is one of them.
const GENERATED_ZAG = `
   A B C D E F G H I J K L M N O   > Player 1           22
   ------------------------------    Player 2           77
 1|=     '       =       '     = |
 2|  -       "       "       -   |   Unseen: 91 (38v | 51c)
 3|    -       '   '       -     |   ? ? A A A A A A A A
 4|'     -       '       -     ' |   B B C C D D D D E E
 5|        -           -         |   E E E E E E E E E F
 6|  "       "       "       "   |   F G G G H H I I I I
 7|    '       '   '       '     |   I I I J K L L L L M
 8|=     '     Q I       '     = |   M N N N N N O O O O
 9|    '       ' N '       '     |   O O O O P P R R R R
10|  "       "   E   "       "   |   R S S S T T T T T U
11|        -     R     -         |   U U U V V W W X Y Y
12|'     -       T       -     ' |   Z
13|    -       ' I '       -     |   Event 2 (Player 2):
14|  -       "   A   "       -   |   H8 (I)NERTIAS 77 AEINRST
15|=     '       S       '     = |
   ------------------------------

1:   13G Z(I)G    25 25.00
2:   13G G(I)  Z  5  13.39
3:   14G Z(A)G    13 13.00
4:   14H (A)G  Z  3  11.39
5:   (exch G)  Z  0  8.39
6:   10G Z(E)  G  11 7.82
7:   14G Z(A)  G  11 7.82
8:   (exch GZ)    0  0.00
9:   (exch Z)  G  0  -3.18
10:  pass      GZ 0  -1000.00
Showing 10 of 10 plays
`

test('a described move is found among the legal plays', () => {
  const inertias = parseGenerated(GENERATED_INERTIAS).flat()
  expect(inertias.length).toBe(7)
  const board = parseBoard(GENERATED_INERTIAS.split('\n')) ?? []
  expect(board[7]).toBe('......QI.......')
  // Two placements of INERTIAS; the square or the score picks one.
  const fits = (move: MoveDescription, plays = inertias, on = board) =>
    plays.filter(play => fitsDescription(play, move, on)).map(play => `${play.coordinate} ${play.word} ${play.score}`)
  expect(fits({ word: 'INERTIAS' })).toEqual(['H8 (I)NERTIAS 77', 'H3 INERT(I)AS 59'])
  expect(fits({ word: 'inertias', score: 59 })).toEqual(['H3 INERT(I)AS 59'])
  expect(fits({ word: 'INERTIAS', square: 'h8' })).toEqual(['H8 (I)NERTIAS 77'])
  expect(fits({ word: 'INERTIAS', direction: 'across' })).toEqual([])
  expect(fits({ word: 'INERTIAS', premium: 'TW' })).toEqual(['H8 (I)NERTIAS 77'])
  expect(fits({ word: 'INERTIAS', through: [{ letter: 'I', word: 'QI' }] })).toEqual(['H8 (I)NERTIAS 77', 'H3 INERT(I)AS 59'])

  // ZAG through the A of INERTIAS: just one; ZIG and the rest are not it.
  const zagBoard = parseBoard(GENERATED_ZAG.split('\n')) ?? []
  const zag = parseGenerated(GENERATED_ZAG).flat()
  expect(wordOnBoard(zagBoard, 'INERTIAS')).toEqual([
    [7, 8, 9, 10, 11, 12, 13, 14].map(row => ({ row, col: 7 })),
  ])
  expect(fits({ word: 'ZAG', through: [{ letter: 'A', word: 'INERTIAS' }] }, zag, zagBoard)).toEqual(['14G Z(A)G 13'])
  expect(fits({ word: 'ZAG', through: [{ letter: 'A', word: 'QI' }] }, zag, zagBoard)).toEqual([])
  expect(fits({ word: 'ZIG' }, zag, zagBoard)).toEqual(['13G Z(I)G 25'])
})

test('the racks to look for a move from, and the commits that replay it', () => {
  expect(racksFor({ word: 'ZAG', through: [{ letter: 'A', word: 'INERTIAS' }] })).toEqual(['ZG'])
  expect(racksFor({ word: 'ZAG' })).toEqual(['ZAG'])
  // Eight letters: one was the board's, each letter in turn.
  expect(racksFor({ word: 'INERTIAS' })).toEqual(['NERTIAS', 'IERTIAS', 'INRTIAS', 'INETIAS', 'INERIAS', 'INERTIS', 'INERTIA'])
  expect(racksFor({ word: 'QUIXOTISMS' })).toEqual([])
  expect(commitCommands([{ coordinate: 'H8', word: '(I)NERTIAS' }, { coordinate: 'pass', word: '' }, { coordinate: '14G', word: 'Z(A)G' }])).toEqual([
    'rack NERTIAS',
    'commit H8 .NERTIAS',
    'commit pass',
    'rack ZG',
    'commit 14G Z.G',
  ])
  expect(playSquares('14G', 'Z(A)G')).toEqual([
    { row: 13, col: 6, letter: 'Z', isThrough: false },
    { row: 13, col: 7, letter: 'A', isThrough: true },
    { row: 13, col: 8, letter: 'G', isThrough: false },
  ])
})

test("a play intent's moves, read from the interpreter", () => {
  expect(
    parseIntent(
      '{"action":"play","moves":[{"word":"INERTIAS","by":"me"},{"word":"zag","by":"opponent","through":[{"letter":"a","word":"inertias"}]},{"pass":true}],"rack":"?hilops"}',
    ),
  ).toEqual({
    action: 'play',
    moves: [
      { word: 'INERTIAS', by: 'me' },
      { word: 'ZAG', by: 'opponent', through: [{ letter: 'A', word: 'INERTIAS' }] },
      { word: '', pass: true },
    ],
    rack: '?HILOPS',
  })
  expect(() => parseIntent('{"action":"play","moves":[],"rack":"POLISHES"}')).toThrow()
})

// The pane showing AEINRST after 8G QI, then `/magpie inertias was played,
// opp played zag through the a in inertias, next rack polish?`.
test('/magpie plays on: each move found on the board, then the new rack simmed', async ($, on) => {
  const runs: { argv: readonly string[]; stdin?: string }[] = []
  const shownRack = 'AEINRST'
  mock.env(on, LINUX.env)
  const answer = (argv: readonly string[], stdin = '') =>
    argv[0] === 'getconf'
        ? '12\n'
        : stdin.includes(`rack ${shownRack}\ngenerate`)
          ? GENERATED_INERTIAS
          : stdin.includes('rack ZG\ngenerate')
            ? GENERATED_ZAG
            : // The sims: AEINRST's shows INERTIAS on top, as the pane did.
              `\n   A B C D E F G H I J K L M N O   > Player 1  ${shownRack}  0\n\n1:  H8 (I)NERTIAS  77 - 61.50 0.2 73.50 0.5 77.00 5000 30.0 20.0 10.0 40.0 20.0 10.0\n2:  H3 INERT(I)AS  59 - 50.00 0.2 50.00 0.5 59.00 5000 30.0 20.0 10.0 40.0 20.0 10.0\n\nShowing 2 of 2 plays\nShowing 2 of 4 plies\n`
  on('process.run', (_$, e) => {
    runs.push({ argv: e.argv, stdin: e.init?.stdin })
    const stdout = answer(e.argv, e.init?.stdin)
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } } as never
  })
  answerSpawns(on, runs, answer)
  on('fs.exists', () => ({ value: true }) as never)
  on('fs.list', () => ({ value: [{ name: 'CSW24.kwg', kind: 'file', size: 1 }] }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  const replies = [
    '{"action":"play","moves":[{"word":"INERTIAS","by":"me"},{"word":"ZAG","by":"opponent","through":[{"letter":"A","word":"INERTIAS"}]}],"rack":"?HILOPS"}',
  ]
  on('model.complete', () => {
    const usage = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
    return { value: { isAnswered: true, text: replies.shift() ?? '', usage } } as never
  })
  await $.tool.call({ tool: 'mcp__magpie-sim__simulate', position: shownRack, after: [{ coordinate: '8G', word: 'QI' }] } as never)
  const { text } = await $.command.run({ command: 'magpie', args: 'inertias was played. opp played zag through the a in inertias. next rack for me is polish?' } as never)
  expect(text).toContain('Played H8 (I)NERTIAS for 77 (the top of its placements), then 14G Z(A)G for 13.')
  expect(text).toContain('Simulating ?HILOPS in CSW24')
  const zagSearch = runs.find(run => run.stdin?.includes('rack ZG\ngenerate'))
  expect(zagSearch?.stdin).toBe('rack QI\ncommit 8G QI\nrack NERTIAS\ncommit H8 .NERTIAS\nshgame\nrack ZG\ngenerate\n')
  expect(zagSearch?.argv.join(' ')).toContain('-wmp false')
})

// What `generate` printed for JAZ? on the empty board, the first plays and
// both JAZZes at 8G: the blank either Z.
const GENERATED_JAZZ = `

   A B C D E F G H I J K L M N O   > Player 1           0
   ------------------------------    Player 2           0
 1|=     '       =       '     = |
 2|  -       "       "       -   |   Unseen: 100 (42v | 56c)
 3|    -       '   '       -     |   ? ? A A A A A A A A
 4|'     -       '       -     ' |   A B B C C D D D D E
 5|        -           -         |   E E E E E E E E E E
 6|  "       "       "       "   |   E F F G G G H H I I
 7|    '       '   '       '     |   I I I I I I I J K L
 8|=     '       -       '     = |   L L L M M N N N N N
 9|    '       '   '       '     |   N O O O O O O O O P
10|  "       "       "       "   |   P Q R R R R R R S S
11|        -           -         |   S S T T T T T T U U
12|'     -       '       -     ' |   U U V V W W X Y Y Z
13|    -       '   '       -     |
14|  -       "       "       -   |
15|=     '       =       '     = |
   ------------------------------

1:    8G JA       Z?   18 53.08
2:    8H JA       Z?   18 52.38
3:    8G ZA       J?   22 45.95
10:   8G JAZz          38 38.00
11:   8G JAzZ          38 38.00
Showing 179 of 179 plays
`

// The English set as MAGPIE's letterdistributions/english.csv lists it.
const ENGLISH_CSV = '?2 A9 B2 C2 D4 E12 F2 G3 H2 I9 J1 K1 L4 M2 N6 O8 P2 Q1 R6 S4 T6 U4 V2 W2 X1 Y2 Z1'
  .split(' ')
  .map(entry => `${entry.charAt(0)},${entry.charAt(0).toLowerCase()},${entry.slice(1)},0,0`)
  .join('\n')

const EMPTY = Array.from({ length: 15 }, () => '.'.repeat(15))

test('the tiles left, and a word or rack they cannot make', () => {
  expect(distributionName('CSW24')).toBe('english')
  expect(distributionName('RD28')).toBe('german')
  expect(distributionName('XYZ')).toBeUndefined()
  const set = parseDistribution(ENGLISH_CSV)
  expect(set?.get('E')).toBe(12)
  expect(parseDistribution('CH,ch,1,5,0\nA,a,9,1,1')).toBeUndefined()
  const left = tilesLeft(set ?? new Map(), EMPTY)
  // JAZZ is the one Z and a blank; PIZZAZZ needs more than there are.
  expect(withBlanks('JAZZ', left)).toEqual({ rack: 'JAZ?' })
  const pizzazz = withBlanks('PIZZAZZ', left)
  expect(pizzazz).toEqual({ short: { tile: 'Z', need: 4, have: 1, blanks: 2 } })
  expect('short' in pizzazz && shortText('PIZZAZZ', pizzazz.short)).toBe('PIZZAZZ needs 4 Zs, and only 1 Z and 2 blanks are left')
  // A blank named: JAZz is J, A, Z and a blank.
  expect(withBlanks('JAZz', left)).toEqual({ rack: '?JAZ' })

  const board = applyMove(EMPTY, '8G', 'JAZz')
  expect(board[7]).toBe('......JAZz.....')
  const after = tilesLeft(set ?? new Map(), board)
  expect(missingText(missingTiles('ZOOT', after))).toBe('no Z is left')
  expect(missingText(missingTiles('??ABCDE', after))).toBe('only 1 blank is left')
  expect(missingTiles('AEINRST', after)).toEqual([])
  // What a rack holds once a move's tiles leave it.
  expect(rackLess('JAZ?ION', 'JAZ?')).toBe('ION')
  expect(rackLess('AEINRST', 'Q')).toBeNull()
  expect(sameTiles('ION', 'noi')).toBe(true)
  expect(commitCommands([{ coordinate: '8G', word: 'JAZz', leave: 'ION' }])).toEqual(['rack JAZ?ION', 'commit 8G JAZz'])
})

test('which tile was the blank: both JAZZes fit, the one named alone', () => {
  const board = parseBoard(GENERATED_JAZZ.split('\n')) ?? []
  const plays = parseGenerated(GENERATED_JAZZ).flat()
  const fits = (move: MoveDescription) => plays.filter(play => fitsDescription(play, move, board)).map(play => play.word)
  expect(fits({ word: 'JAZZ', square: '8G' })).toEqual(['JAZz', 'JAzZ'])
  expect(fits({ word: 'JAzZ', square: '8G' })).toEqual(['JAzZ'])
  expect(racksFor({ word: 'JAzZ' })).toEqual(['JAzZ'])
  expect(blankText('JAzZ')).toBe('the first Z')
  expect(blankText('JAZz')).toBe('the second Z')
  expect(blankText('bAN(a)Na')).toBe('the B and the third A')
  expect(blankText('Z(A)G')).toBe('no blank')
})

// MAGPIE answering from fixtures: the board, a word's plays, a rack it
// refuses; the English set; the model reading /magpie in `replies` order.
function playHost(on: On, replies: string[], generated: Record<string, string>) {
  const runs: { argv: readonly string[]; stdin?: string }[] = []
  const prompts: string[] = []
  mock.env(on, LINUX.env)
  on('process.run', (_$, e) => {
    runs.push({ argv: e.argv, stdin: e.init?.stdin })
    const stdin = e.init?.stdin ?? ''
    const rack = Object.keys(generated).find(key => stdin.includes(`rack ${key}\ngenerate`))
    const refused = /rack (ZZ\S*)\n$/.exec(stdin)
    const value =
      e.argv[0] === 'getconf'
          ? { stdout: '12\n', stderr: '' }
          : refused !== null
            ? { stdout: GENERATED_JAZZ.split('\n1:')[0] ?? '', stderr: `(error 29) rack '${refused[1]}' is not available in the bag\n` }
            : { stdout: rack === undefined ? (GENERATED_JAZZ.split('\n1:')[0] ?? '') : (generated[rack] ?? ''), stderr: '' }
    return { value: { exitCode: 0, ...value, isStdoutTruncated: false, isStderrTruncated: false } } as never
  })
  on('fs.exists', () => ({ value: true }) as never)
  on('fs.list', () => ({ value: [{ name: 'CSW24.kwg', kind: 'file', size: 1 }] }) as never)
  on('fs.read', (_$, e) => (e.path.endsWith('/letterdistributions/english.csv') ? { value: ENGLISH_CSV } : { error: 'no such file' }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('model.complete', (_$, e) => {
    prompts.push(e.prompt)
    const usage = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
    return { value: { isAnswered: true, text: replies.shift() ?? '', usage } } as never
  })
  return { runs, prompts }
}

test('/magpie asks which Z of JAZZ was the blank, and the answer goes on from the question', async ($, on) => {
  const replies = [
    '{"action":"play","moves":[{"word":"JAZZ","by":"me","square":"8G","leave":"ION"}]}',
    '{"action":"play","moves":[{"word":"JAZz","by":"me","square":"8G","leave":"ION"}]}',
    '{"action":"play","moves":[{"word":"JAZz","by":"me","square":"8G","leave":"ION"},{"pass":true,"by":"opponent"}],"rack":"ABCDEF?"}',
    '{"action":"play","moves":[],"rack":"EIMNOT?"}',
  ]
  const { runs, prompts } = playHost(on, replies, { 'JAZ?': GENERATED_JAZZ, '?JAZ': GENERATED_JAZZ })
  const magpie = async (args: string) => (await $.command.run({ command: 'magpie', args } as never)).text
  expect(await magpie('I played jazz 8g keeping ion')).toBe(
    'Which tile of JAZZ at 8G was the blank: the first Z (JAzZ, 38) or the second Z (JAZz, 38)?',
  )
  expect(runs.some(run => run.stdin?.includes('rack JAZ?\ngenerate'))).toBe(true)
  // The answer is read with the question; then the opponent's turn is.
  expect(await magpie('the second z')).toBe(
    "Played 8G JAZz for 38. It is your opponent's turn after 8G JAZz: what did they play, or did they pass?",
  )
  expect(prompts[1]).toContain('What they typed: "I played jazz 8g keeping ion". It asked: "Which tile of JAZZ')
  // A rack without the ION kept is asked again, the moves kept for the rack
  // alone to follow.
  expect(await magpie('they passed, my rack is abcdef?')).toBe(
    'Played 8G JAZz for 38, then a pass. You kept ION after JAZz, but ABCDEF? does not hold it. What is your rack?',
  )
  expect(prompts[2]).toContain('What they typed: "I played jazz 8g keeping ion", then "the second z"')
  expect(await magpie('eimnot?')).toContain('Simulating EIMNOT? in CSW24')
  expect(prompts[3]).not.toContain('It asked')
  // JAZz committed from the whole rack it was played from.
  expect(runs.some(run => run.stdin === 'rack JAZ?ION\ncommit 8G JAZz\ncommit pass\nshgame\nrack EIMNOT?\n')).toBe(true)
})

test('/magpie says PIZZAZZ cannot have been played, and refuses a rack the bag cannot make', async ($, on) => {
  const { runs } = playHost(
    on,
    ['{"action":"play","moves":[{"word":"PIZZAZZ","by":"opponent"}]}', '{"action":"sim","position":"ZZAEIRT"}'],
    {},
  )
  const pizzazz = await $.command.run({ command: 'magpie', args: 'opp played pizzazz' } as never)
  expect(pizzazz.text).toBe('PIZZAZZ needs 4 Zs, and only 1 Z and 2 blanks are left: that cannot have been played.')
  const zz = await $.command.run({ command: 'magpie', args: 'zzaeirt' } as never)
  expect(zz.text).toBe('ZZAEIRT cannot be the correct rack: only 1 Z is left. What is the rack?')
  expect(runs.some(run => run.stdin?.includes('gsimulate'))).toBe(false)
})

// A sim as MAGPIE streams it with -pfrequency: the board, a table while it
// runs, then the table it finished on, each ending with its Nps: line.
const STREAM_BOARD = '\n   A B C D E F G H I J K L M N O   > Player 1  AEINRST  0\n\n'
const streamTable = (iterations: number, status: string, winPct: string) =>
  `1:  8D RETAINS  70 - ${winPct} 0.2 30.00 0.5 70.00 ${iterations / 2} 30.0 20.0 10.0 40.0 20.0 10.0\n` +
  `2:  8H RETAINS  70 - 40.00 0.2 20.00 0.5 70.00 ${iterations / 2} 30.0 20.0 10.0 40.0 20.0 10.0\n\n` +
  `Showing 2 of 2 plays\nShowing 2 of 4 plies\n\nIters:     ${iterations}\nTime:      1.50 seconds\nStatus:    ${status}\n \nNps:       9000\n`

test('a sim streams into the pane, a table at a time, and keeps the last', async ($, on) => {
  const runs: { argv: readonly string[]; stdin?: string }[] = []
  const seen: (string | undefined)[] = []
  mock.env(on, LINUX.env)
  // The pane, mounted before the sim runs: the stream's stub reads it.
  let ui: { find: (query: { type: 'Text'; text: RegExp }) => Promise<{ text?: string } | undefined> } | undefined
  on('process.run', (_$, e) => {
    runs.push({ argv: e.argv, stdin: e.init?.stdin })
    const stdout = e.argv[0] === 'getconf' ? '12\n' : ''
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } } as never
  })
  // Between the tables, what the pane's summary says.
  const summary = async () => (await ui?.find({ type: 'Text', text: /iters in/ }))?.text
  on('process.spawn', async function* (_$: unknown, e: { argv: readonly string[]; input?: string; cwd?: string }) {
    runs.push({ argv: e.argv, stdin: e.input })
    yield { stream: 'stdout' as const, text: STREAM_BOARD + streamTable(1000, 'Running', '55.00').slice(0, 40) }
    yield { stream: 'stdout' as const, text: streamTable(1000, 'Running', '55.00').slice(40) }
    seen.push(await summary())
    yield { stream: 'stdout' as const, text: streamTable(2000, 'Finished (max iterations reached)', '57.50') }
    seen.push(await summary())
    return { value: { code: 0, signal: null } }
  } as never)
  on('fs.exists', () => ({ value: true }) as never)
  on('fs.list', () => ({ value: [{ name: 'CSW24.kwg', kind: 'file', size: 1 }] }) as never)
  on('fs.read', (_$, e) => (e.as === 'bytes' ? { value: { base64: fixtureFont().toBase64() } } : { deny: 'no file' }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('ui.blit', () => ({ value: {} }) as never)
  const mounted = await $.ui.mount({
    plugin: 'magpie-sim',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'magpie-results',
    props: { title: 'MAGPIE sim', isFocused: true, bodyColumns: 160, placement: 'inline', scroll: { offset: 0, bodyRows: 40 }, view: {} },
  })
  ui = mounted
  const result = JSON.stringify(await $.tool.call({ tool: 'mcp__magpie-sim__simulate', position: 'AEINRST' } as never))
  // MAGPIE asked to print as it goes; the pane showed each table as it ended.
  expect(runs.find(run => run.stdin?.includes('gsimulate'))?.argv.join(' ')).toContain('-pfrequency 1000')
  expect(seen[0]).toContain('1,000 iters in 1.5 s')
  expect(seen[1]).toContain('2,000 iters in 1.5 s')
  expect(result).toContain('1. 8D RETAINS: 70 pts, win 57.50%')
  expect((await mounted.find({ type: 'Text', text: /iters in/ }))?.text).toContain('2,000 iters')
  await mounted.unmount()
})
