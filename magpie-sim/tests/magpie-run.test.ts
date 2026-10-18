import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import {
  canonicalWord,
  choosePosition,
  classifyPosition,
  describePosition,
  gcgPositions,
  magpieRun,
  parseArgs,
  positionLabel,
  scanRun,
  splitCgp,
  tilesFromRack,
  type Choice,
} from '../hooks/magpie'
import { reportLines } from '../hooks/register'
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

test('/magpie arguments: a position, then a lexicon, and for a GCG which position', () => {
  expect(parseArgs('ADOPQRR NWL23')).toEqual({
    position: { kind: 'rack', rack: 'ADOPQRR' },
    label: 'ADOPQRR',
    source: 'ADOPQRR',
    lexicon: 'NWL23',
  })
  const at = (args: string) => parseArgs(`~/games/game.gcg ${args}`).at
  expect(at('12')).toEqual({ kind: 'turn', turn: 12 })
  expect(at('turn 12')).toEqual({ kind: 'turn', turn: 12 })
  expect(at('at turn #12 CSW21')).toEqual({ kind: 'turn', turn: 12 })
  expect(parseArgs('~/games/game.gcg at turn #12 CSW21').lexicon).toBe('CSW21')
  expect(at('DEEILRV')).toEqual({ kind: 'letters', letters: 'DEEILRV' })
  expect(at('rack deeilrv')).toEqual({ kind: 'rack', rack: 'DEEILRV' })
  expect(at('aeinst?')).toEqual({ kind: 'rack', rack: 'AEINST?' })
  expect(at('before SILVERED')).toEqual({ kind: 'word', word: 'SILVERED' })
  expect(at('SILVERED')).toEqual({ kind: 'word', word: 'SILVERED' })
  expect(at('event 23')).toEqual({ kind: 'goto', goto: '23' })
  expect(at('end')).toEqual({ kind: 'goto', goto: 'end' })
  expect(parseArgs('https://www.cross-tables.com/annotated/selfgcg/621/anno62161.gcg').source).toBe(
    'https://www.cross-tables.com/annotated/selfgcg/621/anno62161.gcg',
  )
  // A CGP is taken whole, opcodes and all.
  expect(parseArgs(CGP).position).toEqual({ kind: 'cgp', cgp: CGP })
  // Which position means nothing beside a rack or a CGP.
  expect(() => parseArgs('ADOPQRR 12')).toThrow()
  expect(() => parseArgs('game.gcg turn 12 rack AB')).toThrow()
  expect(() => parseArgs('game.gcg turn')).toThrow()
  expect(() => parseArgs('game.gcg turn 0')).toThrow()
  expect(() => parseArgs('')).toThrow()
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

// Stands in for the host: HOME, the core count, and MAGPIE, whose scan of a
// GCG and whose sim answer from fixtures.
function fakeHost(on: On, scan = SCAN_ENDING) {
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
            : CGP_OUTPUT
    return {
      value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
    } as never
  })
  on('fs.exists', () => ({ value: true }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
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
  const result = await $.tool.call({ tool: 'mcp__magpie-sim__simulate', position: XT_GAME, at: 'ADGKOSV' } as never)
  const text = JSON.stringify(result)
  expect(text).toContain('Not run: ADGKOSV fits 3 positions in anno62161.gcg')
  expect(text).toContain('turn 3: RightBehindYou to move with ADGKOSV, who played 6B VOKDA')
  expect(runs.some(run => run.stdin?.includes('gsimulate'))).toBe(false)
})

test('/magpie asks which position when its rack fits several', async ($, on) => {
  fakeHost(on, SCAN_PHONY)
  const { text } = await $.command.run({ command: 'magpie', args: `${XT_GAME} rack ADGKOSV` } as never)
  expect(text).toContain('Rack ADGKOSV fits 3 positions in anno62161.gcg:')
  expect(text).toContain(`Say which: /magpie ${XT_GAME} turn 1`)
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
  const request = parseArgs('AEINRST after 8g vav')
  expect(request.position).toEqual({ kind: 'rack', rack: 'AEINRST', after: [{ coordinate: '8G', word: 'VAV' }] })
  expect(request.label).toBe('AEINRST after 8G VAV')
  expect(magpieRun(request.position as never, {}, 10, { rit: true, wit: true }).stdin).toBe(
    'rack VAV\ncommit 8G VAV\nrack AEINRST\nshgame\ngsimulate\n',
  )
  // Mixed case keeps its blanks; a board tile in parentheses is a `.` to
  // commit and no tile from the rack.
  const two = parseArgs('AEINRST after 8g VaV, then 9f (v)ie')
  expect(magpieRun(two.position as never, {}, 10, { rit: true, wit: true }).stdin).toBe(
    'rack V?V\ncommit 8G VaV\nrack IE\ncommit 9F .IE\nrack AEINRST\nshgame\ngsimulate\n',
  )
  expect(canonicalWord('vav')).toBe('VAV')
  expect(canonicalWord('VaV')).toBe('VaV')
  expect(tilesFromRack('ANTIQuES')).toBe('ANTIQ?ES')
  expect(() => parseArgs('AEINRST after 8g')).toThrow()
  expect(() => parseArgs(`${CGP} after 8g vav`)).toThrow()
})

test('in a game, after a move is the position it was played into', () => {
  const positions = gcgPositions(SCAN_PHONY)
  const events = (choice: Choice) => ('position' in choice ? choice.position.events : choice)
  expect(parseArgs('game.gcg after lea').at).toEqual({ kind: 'after', word: 'LEA' })
  expect(parseArgs('game.gcg after 6b vokda').at).toEqual({ kind: 'after', word: 'VOKDA', coordinate: '6B' })
  expect(events(choosePosition(positions, { kind: 'after', word: 'LEA' }))).toBe(9)
  // After the phony, past its withdrawal: HastyBot to move.
  expect(events(choosePosition(positions, { kind: 'after', word: 'VOKDA', coordinate: '6B' }))).toBe(11)
  expect('error' in choosePosition(positions, { kind: 'after', word: 'VOKDA', coordinate: '7B' })).toBe(true)
  expect(events(choosePosition(positions, { kind: 'after', word: 'VODKA' }))).toBe(13)
})
