import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import {
  canonicalWord,
  cgpUnseen,
  checkLexicon,
  choosePosition,
  classifyPosition,
  describePosition,
  gcgPositions,
  interpreterPrompt,
  magpieRun,
  parseIntent,
  positionLabel,
  requestFromIntent,
  scanRun,
  splitCgp,
  tilesFromRack,
  type Choice,
  type Intent,
} from '../hooks/magpie'
import { headerLine, reportLines, resultText, rowLine, tableLayout } from '../hooks/register'
import { parseSim, placedTiles, rackGhosts } from '../hooks/sim'

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
  expect(rack.args.join(' ')).toContain('-wmp true -rit true -wit true')
  expect(rack.args.join(' ')).toContain('-numplays 50 -plies 2 -iterations 1000000 -sr rr')
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

// Stands in for the host: HOME, the core count, the lexicons, MAGPIE (whose
// scan of a GCG and whose sim answer from fixtures), and the model reading
// /magpie's words, which answers `replies` in order.
function fakeHost(on: On, scan = SCAN_ENDING, replies: string[] = [], endgame = '') {
  const runs: { argv: readonly string[]; stdin?: string; cwd?: string }[] = []
  on('process.run', (_$, e) => {
    runs.push({ argv: e.argv, stdin: e.init?.stdin, cwd: e.init?.cwd })
    const command = e.argv[0]
    const stdout =
      command === 'printenv'
        ? '/home/test\n'
        : command === 'getconf'
          ? '12\n'
          : e.init?.stdin?.includes('next\n')
            ? scan
            : e.init?.stdin?.includes('endgame\n')
              ? endgame
              : CGP_OUTPUT
    return {
      value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
    } as never
  })
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
  [undefined, '/home/test/magpie/bin/magpie', '/home/test/magpie'],
  [{ magpieDir: '/opt/magpie/' }, '/opt/magpie/bin/magpie', '/opt/magpie'],
  [{ magpieDir: '' }, 'magpie', undefined],
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
  expect(back.text).toContain('Simulating anno62161.gcg turn 5')
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
