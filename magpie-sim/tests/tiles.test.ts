import { expect, test } from 'claude-code/testing'

import { drawTile, setTileScores, type Canvas } from '../hooks/board'
import { parseScores } from '../hooks/magpie'
import { rowLine, summaryLine, tableLayout } from '../hooks/register'
import { parseSim, playTiles, spentTiles } from '../hooks/sim'
import { packTiles, tileLabel, tileOf, unpackTiles } from '../hooks/tiles'
import { parseFont } from '../hooks/truetype'
import { fixtureFont } from './font-fixture'

// What MAGPIE printed for RD29 after 8D ÄRGERN (`shgame`, then `gsimulate`
// with the rack ENÖSÜZ?), cut to the second board and the table.
const GERMAN = `# lexicon RD29
   A B C D E F G H I J K L M N O     Player 1           36
   ------------------------------  > Player 2  ENÖSÜZ?  0
 1|=     '       =       '     = |
 2|  -       "       "       -   |   Unseen: 89 (33v | 55c)
 3|    -       '   '       -     |   ? A A A A A B B C C
 4|'     -       '       -     ' |   D D D D E E E E E E
 5|        -           -         |   E E E E E E E F F G
 6|  "       "       "       "   |   G H H H H I I I I I
 7|    '       '   '       '     |   I J K K L L L M M M
 8|=     Ä R G E R N     '     = |   M N N N N N N N O O
 9|    '       '   '       '     |   O P Q R R R R S S S
10|  "       "       "       "   |   S S S T T T T T T U
11|        -           -         |   U U U U U V W X Y
12|'     -       '       -     ' |
13|    -       '   '       -     |   Event 1 (Player 1):
14|  -       "       "       -   |   8D ÄRGERN 36 ÄEGNRRS
15|=     '       =       '     = |
   ------------------------------

1: 9I ÖSE     NÜZ? 35 - 50.97 0.5196 60.03 1.3258 56.19 507 45.64 26.54 30.77 57.64 32.73 33.33
2: F6 ZÜ(G)E  NÖS? 18 - 48.99 0.4752 54.96 1.1960 54.53 507 42.97 24.22 30.77 62.03 33.96 38.46
3: F6 ZÜ(G)EN ÖS?  21 - 49.14 0.4275 55.51 1.0943 53.86 507 40.54 26.07 30.77 46.21 25.52 23.08

Showing 3 of 3 plays
Showing 2 of 2 plies

Iters:     1521
Time:      0.43 seconds
Status:    Finished (max iterations reached)
`

// The same for DISC2 after 8G RA[L·L]I, the rack AÇE[NY][QU]S: Catalan's
// tiles of two letters in brackets, on the board too, where they widen it.
const CATALAN = `# lexicon DISC2
   A B C D E F G H I J K L M N O     Player 1           26
   ------------------------------  > Player 2  AÇE[NY][QU]S   0
 1|=     '       =       '     = |
 2|  -       "       "       -   |   Unseen: 90 (38v | 50c)
 3|    -       '   '       -     |   ? ? A A A A A A A A
 4|'     -       '       -     ' |   A A B B C C C D D D
 5|        -           -         |   E E E E E E E E E E
 6|  "       "       "       "   |   E E F G G H I I I I
 7|    '       '   '       '     |   I I I J L L L L M M
 8|=     '     R A [L·L] I   '     = |   M N N N N N N O O O
 9|    '       '   '       '     |   O O P P R R R R R R
10|  "       "       "       "   |   R S S S S S S S T T
11|        -           -         |   T T T U U U U V X Z
12|'     -       '       -     ' |
13|    -       '   '       -     |   Event 1 (Player 1):
14|  -       "       "       -   |   8G RA[L·L]I 26 AEI[L·L]RS
15|=     '       =       '     = |
   ------------------------------

1: K8 SE[QU]AÇ   [NY]       56 - 51.17 0.6559 57.74 1.8947 55.53 507 51.18 22.80 48.72 58.79 24.98 23.08
2: K4 [NY]A[QU]ES Ç         56 - 46.81 0.5252 45.44 1.4394 46.48 507 50.38 23.33 48.72 40.82 18.31 5.13
3: G7 A(R)Ç      E[NY][QU]S 23 - 42.55 0.5802 33.00 1.6506 30.67 507 43.03 26.54 38.46 57.26 18.36 7.69

Showing 3 of 3 plays
Showing 2 of 2 plies

Iters:     1521
Time:      0.16 seconds
Status:    Finished (max iterations reached)
`

test("Catalan's tiles of two letters are one letter each, and written back as MAGPIE writes them", () => {
  expect(packTiles('RA[L·L]I [ny]A[QU]ES')).toBe('RAĿI ñAꝖES')
  expect(unpackTiles('RAĿI ñAꝖES')).toBe('RA[L·L]I [ny]A[QU]ES')
  expect([tileOf('L·L'), tileOf('ny'), tileOf('Ç')]).toEqual(['Ŀ', 'ñ', 'Ç'])
  expect([tileLabel('Ŀ'), tileLabel('ꝗ'), tileLabel('Ä')]).toEqual(['L·L', 'qu', 'Ä'])
  // L·L as it may be written without its dot.
  expect(packTiles('RA[LL]I RA[l.l]I')).toBe('RAĿI RAŀI')
  // A timestamp's brackets are not a tile's.
  expect(packTiles('[2026-10-18 19:27:28] FATAL')).toBe('[2026-10-18 19:27:28] FATAL')
})

test('a German sim reads with its umlauts: the rack, the board, the plays and their leaves', () => {
  const sim = parseSim(GERMAN)
  expect(sim.rack).toBe('ENÖSÜZ?')
  expect(sim.board?.[7]).toBe('...ÄRGERN......')
  expect(sim.plays.map(play => [play.id, play.leave, play.score])).toEqual([
    ['9I ÖSE', 'NÜZ?', 35],
    ['F6 ZÜ(G)E', 'NÖS?', 18],
    ['F6 ZÜ(G)EN', 'ÖS?', 21],
  ])
  expect(spentTiles(sim.plays[1] ?? sim.plays[0]!)).toBe('ZÜE')
  const layout = tableLayout(sim.plays, false)
  expect(rowLine(layout, sim.plays[0]!, true)).toMatch(/^▶ +1 9I ÖSE +NÜZ\? +35 +50\.97/)
})

test('a Catalan sim reads its tiles of two letters, and shows them in brackets', () => {
  const sim = parseSim(CATALAN)
  expect(unpackTiles(sim.rack).length).toBeGreaterThan(sim.rack.length)
  expect([...sim.rack].sort()).toEqual([...'AÇEÑꝖS'].sort())
  expect(sim.board?.[7]).toBe('......RAĿI.....')
  const [first, second, third] = sim.plays
  expect([first?.id, first?.tiles, first?.leave, first?.isDown]).toEqual(['K8 SEꝖAÇ', 'SEꝖAÇ', 'Ñ', true])
  expect(second?.tiles).toBe('ÑAꝖES')
  expect(third?.tiles).toBe('A.Ç')
  expect(playTiles(first!).tiles.map(tile => tile.letter)).toEqual(['S', 'E', 'Ꝗ', 'A', 'Ç'])
  // The table and the summary write them as MAGPIE does, the columns as
  // wide as what they show.
  const layout = tableLayout(sim.plays, false)
  const rows = sim.plays.map(play => rowLine(layout, play, false))
  expect(rows[0]).toMatch(/^ +1 K8 SE\[QU\]AÇ +\[NY\] +56 /)
  expect(rows[2]).toMatch(/^ +3 G7 A\(R\)Ç +E\[NY\]\[QU\]S +23 /)
  // Every row as long as the others: each cell padded to what it shows.
  expect(new Set(rows.map(row => row.length)).size).toBe(1)
  expect(summaryLine(sim)).toContain('[NY]')
})

// A canvas that keeps what is drawn on it, glyph by glyph.
function glyphCanvas() {
  const glyphs: { char: string; size: number; left: number }[] = []
  const canvas: Canvas = {
    rect: () => undefined,
    diamond: () => undefined,
    glyph: (char, size, _isBold, left) => void glyphs.push({ char, size, left }),
  }
  return { canvas, glyphs }
}

// The test font draws A to Z and the digits alone: the real one has the
// rest (Ä, ·, the lowercase).
test("a tile draws its own set's score, and a Catalan tile all its letters, smaller", () => {
  const font = parseFont(fixtureFont())
  const white = [255, 255, 255] as const
  const tile = (letter: string) => ({ letter, fg: [...white] as [number, number, number], bg: [...white] as [number, number, number], isBold: false, hasScore: true })
  setTileScores(parseScores('Ä,ä,1,6,1\nL·L,l·l,1,10,0\nY,y,1,10,0'))
  const umlaut = glyphCanvas()
  drawTile(umlaut.canvas, font, 0, 0, tile('Ä'))
  expect(umlaut.glyphs.map(glyph => glyph.char)).toEqual(['6'])
  // German's Y is 10, not English's 4: the digits right to left.
  const y = glyphCanvas()
  drawTile(y.canvas, font, 0, 0, tile('Y'))
  expect(y.glyphs.map(glyph => glyph.char)).toEqual(['Y', '0', '1'])
  const ela = glyphCanvas()
  drawTile(ela.canvas, font, 0, 0, tile('Ŀ'))
  expect(ela.glyphs.map(glyph => glyph.char)).toEqual(['L', 'L', '0', '1'])
  // Side by side, both on the tile.
  const [first, second] = ela.glyphs
  expect((second?.left ?? 0) - (first?.left ?? 0)).toBeGreaterThanOrEqual(8)
  expect((second?.left ?? 99) + 8).toBeLessThanOrEqual(36)
})
