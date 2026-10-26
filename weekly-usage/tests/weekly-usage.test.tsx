import { expect, mock, test } from 'claude-code/testing'
import { label, until } from '../hooks/register'

const NOW = Date.parse('2026-10-26T12:00:00Z')
const RESETS = '2026-10-27T16:30:00Z' // 1d 4h 30m after NOW

const CONTEXT = { window: 200000 } as never
const measure = (percentUsed: number) => ({
  context: CONTEXT,
  rateLimits: [
    { kind: 'five_hour', percentUsed: 12 },
    { kind: 'seven_day', percentUsed, resetsAt: RESETS },
  ],
  changed: ['rateLimits' as const],
})

test('until counts down to the reset', () => {
  expect(until(RESETS, NOW)).toBe('1d 4h')
  expect(until('2026-10-26T15:00:00Z', NOW)).toBe('3h')
  expect(until('2026-10-26T12:44:10Z', NOW)).toBe('45m')
  expect(until('2026-10-26T11:00:00Z', NOW)).toBe(null)
  expect(until(undefined, NOW)).toBe(null)
})

test('label adds the reset only past 75%', () => {
  expect(label({ kind: 'seven_day', percentUsed: 42.9, resetsAt: RESETS }, NOW)).toBe('week 42%')
  expect(label({ kind: 'seven_day', percentUsed: 75, resetsAt: RESETS }, NOW)).toBe('week 75%')
  expect(label({ kind: 'seven_day', percentUsed: 82.5, resetsAt: RESETS }, NOW)).toBe('week 82% · resets in 1d 4h')
  expect(label({ kind: 'seven_day', percentUsed: 90 }, NOW, 'Weekly')).toBe('Weekly 90%')
})

test('the footer shows the weekly figure beside the modes, warned past 75%', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: NOW, context: CONTEXT, rateLimits: [] } }) as never)
  on('session.measure', (_, e) => ({ changed: e.changed }))
  // Stands in for the engine's own mode labels.
  on('ui.render', ($e, e) => {
    const { Text } = $e.ui.resolve(e)
    return <Text dimColor>focus</Text>
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const mount = (surface: 'terminal' | 'desktop') =>
    $.ui.mount({ plugin: 'weekly-usage', surface, component: 'SessionMode', requestId: 'modes', props: { modes: ['focus'] } })

  // Off a subscription (no reading yet): the engine's labels alone.
  let ui = await mount('terminal')
  expect(await ui.find({ type: 'Text', text: /week/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'focus' })).toBeDefined()
  await ui.unmount()

  await $.session.measure(measure(42))
  ui = await mount('terminal')
  const low = await ui.find({ type: 'Text', text: /week 42%$/ })
  expect(low?.props.dimColor).toBe(true)
  expect(await ui.find({ type: 'Text', text: 'focus' })).toBeDefined()
  await ui.unmount()

  await $.session.measure(measure(82))
  for (const surface of ['terminal', 'desktop'] as const) {
    ui = await mount(surface)
    const high = await ui.find({ type: 'Text', text: /[Ww]eek(ly)? 82% · resets in 1d 4h/ })
    expect(high?.props.color).toBe('warning')
    expect(high?.props.bold).toBe(true)
    await ui.unmount()
  }

  // Idle, the countdown keeps moving.
  await clock.advance(5 * 3600_000)
  ui = await mount('terminal')
  expect(await ui.find({ type: 'Text', text: /week 82% · resets in 23h 30m/ })).toBeDefined()
  await ui.unmount()
})
