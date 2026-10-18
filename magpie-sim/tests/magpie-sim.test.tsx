import { expect, mock, test } from 'claude-code/testing'

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
  test(`a click picks a row, and a heading sorts, on ${surface}`, async ($, on) => {
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
    // The terminal spells each play's tiles as a picture beside its square.
    const selected = (rank: number, label: string) =>
      new RegExp(surface === 'terminal' ? `^▶ +${rank} ${label} *$` : `^▶ +${rank} ${label} `)
    // An exchange is written -Q: its tiles after the dash where they are pictures.
    expect(await ui.find({ type: 'Text', text: selected(1, surface === 'terminal' ? '-' : '-Q') })).toBeDefined()
    expect(await ui.find({ type: surface === 'terminal' ? 'Image' : 'Svg' })).toBeDefined()
    if (surface === 'terminal') {
      expect((await ui.findAll({ type: 'Image' })).some(image => image.key?.startsWith('tiles-') === true)).toBe(true)
    }

    await ui.press({ key: 'pick-8F DROP' })
    expect(await ui.find({ type: 'Text', text: selected(10, '8F') })).toBeDefined()
    // A click on the row already picked does nothing.
    await ui.press({ key: 'pick-8F DROP' })
    if (surface === 'terminal') {
      expect(blits).toEqual(['board'])
    }

    // A new order keeps the selected play, its rank the sim's own.
    await ui.press({ key: 'sort-score' })
    expect(await ui.find({ type: 'Text', text: /Sc▼/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: selected(10, '8F') })).toBeDefined()
    await ui.press({ key: 'sort-score' })
    expect(await ui.find({ type: 'Text', text: /Sc▲/ })).toBeDefined()
    await ui.unmount()
  })
}

// Fifty plays of seven tiles, as a sim of 50 plays prints them: a tall pane
// lists the top 20, and its pictures stay inside what one tree may hold.
const FIFTY_TEXT = [
  '# lexicon NWL23',
  ...Array.from({ length: 50 }, (_, index) => {
    const id = `${(index % 15) + 1}${'ABCD'[Math.floor(index / 15)] ?? 'A'} ETAERIO`
    return `${index + 1}:  ${id}    70 - ${(60 - index * 0.5).toFixed(2)} 0.07 30.00 0.19 70.00 5000 30.00 20.00 10.00 40.00 20.00 10.00`
  }),
  '',
  'Showing 50 of 50 plays',
  'Showing 4 of 4 plies',
  '',
].join('\n')
const MAX_IMAGE_SOURCE = 2 * 1024 * 1024

test('a tall pane lists the top 20 plays, its pictures inside the tree budget', async ($, on) => {
  const clock = mock.clock(on)
  on('ui.panes', () => ({ value: [] }) as never)
  on('session.surfaces', () => ({ value: ['terminal'] }) as never)
  on('ui.blit', () => ({ value: {} }) as never)
  on('fs.read', (_$, e) =>
    (e.as === 'bytes' ? { value: { base64: fixtureFont().toBase64() } } : { value: FIFTY_TEXT }) as never,
  )
  const ui = await $.ui.mount({
    plugin: 'magpie-sim',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'magpie-results',
    props: {
      title: 'MAGPIE sim',
      isFocused: true,
      bodyColumns: 160,
      placement: 'inline',
      scroll: { offset: 0, bodyRows: 90 },
      view: {},
    },
  })
  const tree = await ui.drawn()
  // Two pictures, the board and the tiles of all 20 rows in one.
  expect(await ui.findAll({ type: 'Image' })).toHaveLength(2)
  const buttons = await ui.findAll({ type: 'Button' })
  expect(buttons.filter(button => /^pick-\d+[A-D] ETAERIO$/.test(button.key ?? ''))).toHaveLength(20)
  expect(await ui.find({ type: 'Text', text: /top 20 of 50/ })).toBeDefined()
  // Every picture's decoded bytes, as Claude Code counts them; the selected
  // row's text backgrounds and the tile column's picture.
  let bytes = 0
  const selectedBackgrounds = new Set<string>()
  let tiles: { png: Uint8Array; rows: number; key: string } | undefined
  type Node = {
    type?: string
    props?: { key?: string; rows?: number; backgroundColor?: string; source?: { png?: string; rgba?: string } }
    children?: unknown[]
  }
  const walk = (node: unknown) => {
    if (typeof node !== 'object' || node === null) {
      return
    }
    const { type, props, children } = node as Node
    const source = type === 'Image' ? (props?.source?.png ?? props?.source?.rgba) : undefined
    bytes += source === undefined ? 0 : Math.floor((source.length * 3) / 4)
    if (type === 'Image' && props?.source?.png !== undefined && props.key?.startsWith('tiles-') === true) {
      tiles = { png: Uint8Array.fromBase64(props.source.png), rows: props.rows ?? 0, key: props.key }
    }
    if (type === 'Text' && props?.backgroundColor !== undefined) {
      selectedBackgrounds.add(props.backgroundColor)
    }
    for (const child of children ?? []) {
      walk(child)
    }
  }
  walk(tree)
  // Compressed, the board and the column are a sliver of the budget.
  expect(bytes).toBeGreaterThan(10_000)
  expect(bytes).toBeLessThan(MAX_IMAGE_SOURCE / 10)
  // The selected row (the first) on one colour; the column a terminal row
  // a play, 42 pixels each (IHDR height at byte 20), with an alpha channel
  // (colour type 6, byte 25) so the rows not selected stay clear.
  expect([...selectedBackgrounds]).toEqual(['#385278'])
  expect(tiles?.rows).toBe(20)
  // Keyed by its size, 7 tiles of two columns by 20 rows.
  expect(tiles?.key).toBe('tiles-14x20')
  expect(new DataView((tiles?.png ?? new Uint8Array(32)).buffer).getUint32(20)).toBe(20 * 42)
  expect(tiles?.png[25]).toBe(6)
  // The other listed plays' pictures drawn ahead, a timer tick each.
  await clock.advance(1000)
  const why = await $.command.run({ command: 'magpie', args: 'why' } as never)
  expect(why.text).toContain('drew 19 pictures ahead')
  await ui.unmount()
})
