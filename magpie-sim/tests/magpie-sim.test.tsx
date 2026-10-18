import { expect, test } from 'claude-code/testing'

import { glyphInk } from '../hooks/board'
import { boardPicture } from '../hooks/draw'
import { headerLine, rowLine, sortPlays, summaryLine, tableLayout, windowStart } from '../hooks/register'
import { parsePlayLine, parseSim, placedTiles, rackGhosts, type Play } from '../hooks/sim'
import { boardSvg } from '../hooks/svg'
import { PICTURE_HEIGHT, PICTURE_WIDTH, PREVIEW_BG, squareX, squareY } from '../hooks/theme'
import { parseFont, rasterize } from '../hooks/truetype'
import { fixtureFont } from './font-fixture'

// The head and tail of the ADOPQRR sim the mod ships, as MAGPIE printed it.
const SIM_TEXT = `# lexicon CSW24
1:  (exch Q)     ADOPRR 0  - 48.67 0.0774 18.22 0.1946 5.21 20006 31.47 22.51 16.72 53.67 26.21 55.91
2:  (exch QR)    ADOPR  0  - 48.12 0.0773 16.64 0.1949 5.80 20006 31.47 22.51 16.72 51.21 26.45 48.99
10: 8F DROP      AQR    14 - 45.28 0.0624 10.61 0.1535 7.52 20006 34.98 23.31 26.73 34.07 16.11 3.29
18: 8F PRO       ADQR   10 - 43.35 0.0619 5.40  0.1526 3.41 20006 33.00 23.25 25.19 31.45 16.21 2.87
40: 8E PRAD      OQR    14 - 40.51 0.0639 -1.50 0.1609 1.60 19992 41.87 25.64 26.47 30.43 14.15 1.68

Showing 5 of 40 plays
Showing 2 of 2 plies

Iters:     800002
Time:      12.31 seconds
Opp Rack:
Infer:     0
Wp Cutoff: 0.005
Status:    Finished (max iterations reached)

Nps:       194930
`

const SIM = parseSim(SIM_TEXT)

function playById(id: string): Play {
  const play = SIM.plays.find(candidate => candidate.id === id)
  if (play === undefined) {
    throw new Error(`${id} is not among the test plays`)
  }
  return play
}

test('a sim reads as MAGPIE printed it', () => {
  expect(SIM.rack).toBe('ADOPQRR')
  expect(SIM.lexicon).toBe('CSW24')
  expect(SIM.plies).toBe(2)
  expect(SIM.iterations).toBe(800002)
  expect(SIM.status).toBe('Finished (max iterations reached)')
  expect(SIM.plays.map(play => play.id)).toEqual(['exch Q', 'exch QR', '8F DROP', '8F PRO', '8E PRAD'])
  const drop = playById('8F DROP')
  expect([drop.row, drop.col, drop.isDown, drop.leave, drop.score]).toEqual([7, 5, false, 'AQR', 14])
  expect([drop.winPct, drop.equity, drop.staticEquity, drop.iterations]).toEqual([45.28, 10.61, 7.52, 20006])
  expect(drop.plies).toEqual([
    { score: 34.98, stdev: 23.31, bingoPct: 26.73 },
    { score: 34.07, stdev: 16.11, bingoPct: 3.29 },
  ])
  expect(playById('exch Q').kind).toBe('exchange')
  expect(summaryLine(SIM)).toBe('ADOPQRR · CSW24 · 2 plies · 800,002 iters in 12.3 s')
})

test('down plays, blanks and empty leaves', () => {
  const bingo = parsePlayLine('3:  H4 PaRADOR        78 - 60.00 0.1 40.00 0.2 70.00 100 30.0 20.0 10.0 40.0 20.0 5.0')
  if (bingo === null) {
    throw new Error('the bingo line did not read')
  }
  expect([bingo.row, bingo.col, bingo.isDown, bingo.leave, bingo.score]).toEqual([3, 7, true, '', 78])
  expect(placedTiles(bingo).slice(0, 2)).toEqual([
    { row: 3, col: 7, letter: 'P' },
    { row: 4, col: 7, letter: 'a' },
  ])
  expect(rackGhosts('ADOPRR?', bingo)).toEqual([true, true, true, true, true, true, true])
  expect(parsePlayLine('Showing 5 of 40 plays')).toBe(null)
})

test('sorting by a field, and flipping it', () => {
  const scores = SIM.plays.map(play => play.score)
  expect(sortPlays(SIM.plays, 'score', true)[0]?.score).toBe(Math.max(...scores))
  expect(sortPlays(SIM.plays, 'score', false)[0]?.score).toBe(Math.min(...scores))
  const tiles = sortPlays(SIM.plays, 'play', false).map(play => play.tiles)
  expect(tiles).toEqual([...tiles].sort())
  const wins = sortPlays(SIM.plays, 'win', true).map(play => play.winPct)
  expect(wins).toEqual([...wins].sort((a, b) => b - a))
})

test('the window follows the selection', () => {
  expect(windowStart(0, 5, 10, 40)).toBe(0)
  expect(windowStart(0, 12, 10, 40)).toBe(3)
  expect(windowStart(3, 2, 10, 40)).toBe(2)
  expect(windowStart(35, 39, 10, 40)).toBe(30)
})

test('the rack ghosts what the play spends or throws back', () => {
  expect(rackGhosts(SIM.rack, playById('8F DROP'))).toEqual([false, true, true, true, false, true, false])
  expect(rackGhosts(SIM.rack, playById('exch QR'))).toEqual([false, false, false, false, true, true, false])
})

test('headings line up with the rows', () => {
  for (const isCompact of [false, true]) {
    const layout = tableLayout(SIM.plays, isCompact)
    for (const play of SIM.plays) {
      expect(headerLine(layout, 'win', true).length).toBe(rowLine(layout, play, true).length)
    }
    expect(layout.width).toBe(headerLine(layout, 'win', true).length)
  }
})

test('the font reader finds glyphs, and bold widens them', () => {
  const font = parseFont(fixtureFont())
  const regular = glyphInk(font, 'F', 100, false)
  const bold = glyphInk(font, 'F', 100, true)
  if (regular === null || bold === null) {
    throw new Error('the fixture font lost a glyph')
  }
  expect(bold.maxX - bold.minX > regular.maxX - regular.minX).toBe(true)
  const bitmap = rasterize(font.outline('O'.codePointAt(0) ?? 0, false), 100 / font.unitsPerEm)
  expect(bitmap === null).toBe(false)
})

test('the pictures show the play, and an exchange places nothing', () => {
  const font = parseFont(fixtureFont())
  const pixelAt = (pixels: Uint8Array, row: number, col: number) => {
    const at = ((squareY(row) + 3) * PICTURE_WIDTH + squareX(col) + 3) * 4
    return [...pixels.slice(at, at + 3)]
  }
  const drop = boardPicture(font, null, SIM.rack, playById('8F DROP'))
  expect(drop.pixels.length).toBe(PICTURE_WIDTH * PICTURE_HEIGHT * 4)
  // Inside the D's tile on 8F, clear of the letter: the preview colour.
  expect(pixelAt(drop.pixels, 7, 5)).toEqual([...PREVIEW_BG])
  const exchange = boardPicture(font, null, SIM.rack, playById('exch Q'))
  expect(pixelAt(exchange.pixels, 7, 5)).not.toEqual([...PREVIEW_BG])
  const svg = boardSvg(font, null, SIM.rack, playById('8F DROP'))
  expect(svg.startsWith('<svg')).toBe(true)
  expect(svg.length < 131072).toBe(true)
})

for (const [surface, bodyColumns] of [
  ['terminal', 130],
  ['desktop', 100],
  ['mobile', 44],
] as const) {
  test(`the pane moves and sorts on ${surface}`, async ($, on) => {
    // Stands in for the surface: takes each picture swap.
    const blits: string[] = []
    on('ui.blit', (_$, e) => {
      blits.push(e.key)
      return { value: {} } as never
    })
    // Stands in for the file system: the mod reads its font and its sim.
    on('fs.read', (_$, e) =>
      (e.as === 'bytes' ? { value: { base64: fixtureFont().toBase64() } } : { value: SIM_TEXT }) as never,
    )
    const ui = await $.ui.mount({
      plugin: 'magpie-sim',
      surface,
      component: 'Pane',
      requestId: 'magpie-results',
      props: {
        title: 'MAGPIE sim',
        isFocused: true,
        bodyColumns,
        placement: 'inline',
        scroll: { offset: 0, bodyRows: 40 },
        view: {},
      },
    })
    expect(await ui.find({ type: 'Text', text: /^▶ +1 exch Q / })).toBeDefined()
    expect(await ui.find({ type: surface === 'terminal' ? 'Image' : 'Svg' })).toBeDefined()

    await ui.press({ key: 'down' })
    expect(await ui.find({ type: 'Text', text: /^▶ +2 exch QR/ })).toBeDefined()
    // At the top already, the second up moves nothing.
    await ui.press({ key: 'up' })
    await ui.press({ key: 'up' })
    expect(await ui.find({ type: 'Text', text: /^▶ +1 exch Q / })).toBeDefined()
    if (surface === 'terminal') {
      expect(blits).toEqual(['board', 'board'])
    }

    // A new order keeps the selected play, its rank the sim's own.
    await ui.press({ key: 'sort-score' })
    expect(await ui.find({ type: 'Text', text: /Sc▼/ })).toBeDefined()
    await ui.press({ key: 'down' })
    expect(await ui.find({ type: 'Text', text: /^▶ +2 exch QR/ })).toBeDefined()
    await ui.press({ key: 'sort-score' })
    expect(await ui.find({ type: 'Text', text: /Sc▲/ })).toBeDefined()
    await ui.unmount()
  })
}
