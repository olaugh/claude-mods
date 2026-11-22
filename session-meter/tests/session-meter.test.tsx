import { expect, mock, test } from 'claude-code/testing'
import { displayModel, parts, report, until } from '../hooks/register'

const NOW = Date.parse('2026-11-21T12:00:00Z')
const RESETS = '2026-11-22T16:30:00Z' // 1d 4h 30m after NOW
const MODEL = 'claude-fable-5-2[1m]'

const context = (percent: number) => ({ window: 1000000, tokens: percent * 10000, percent }) as never
const WEEK = { kind: 'seven_day', percentUsed: 26.4, resetsAt: RESETS }
const FIVE = { kind: 'five_hour', percentUsed: 12 }

test('model names', () => {
  expect(displayModel(MODEL)).toBe('Fable 5.2')
  expect(displayModel('us.anthropic.claude-opus-5-5-20261001')).toBe('Opus 5.5')
})

test('until counts down to the reset', () => {
  expect(until(RESETS, NOW)).toBe('1d 4h')
  expect(until('2026-11-21T12:44:10Z', NOW)).toBe('45m')
  expect(until('2026-11-21T11:00:00Z', NOW)).toBe(null)
  expect(until(undefined, NOW)).toBe(null)
})

test('parts and report', () => {
  const base = { model: MODEL, context: context(34), now: NOW }
  expect(parts({ ...base, limits: [FIVE, WEEK] }).map(p => p.text)).toEqual([
    'Fable 5.2', 'ctx 34%', 'week 26%', 'resets 1d 4h',
  ])
  const high = parts({ ...base, limits: [{ ...WEEK, percentUsed: 81 }] })
  expect(high.map(p => p.isHigh)).toEqual([false, false, true, false])
  expect(parts({ ...base, limits: [FIVE] }).map(p => p.text)).toEqual(['Fable 5.2', 'ctx 34%'])
  expect(report({ ...base, limits: [FIVE, WEEK] })).toContain('seven_day: 26.4%, resets in 1d 4h')
})

test('the footer shows the meter beside the modes and counts down while idle', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.model', () => ({ value: MODEL }))
  on('command.register', () => ({ value: undefined }) as never)
  on('session.usage', () => ({ value: { startedAt: NOW, context: { window: 1000000 }, rateLimits: [] } }) as never)
  on('session.measure', (_, e) => ({ changed: e.changed }))
  // Stands in for the engine's own mode labels.
  on('ui.render', ($e, e) => {
    const { Text } = $e.ui.resolve(e)
    return <Text dimColor>focus</Text>
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const mount = () =>
    $.ui.mount({ plugin: 'session-meter', surface: 'terminal', component: 'SessionMode', requestId: 'modes', props: { modes: ['focus'] } })

  // Before any reading: the model alone, beside the engine's labels.
  let ui = await mount()
  expect(await ui.find({ type: 'Text', text: 'Fable 5.2' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /ctx/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'focus' })).toBeDefined()
  await ui.unmount()

  await $.session.measure({ context: context(80), rateLimits: [FIVE, WEEK], changed: ['context', 'rateLimits'] })
  ui = await mount()
  expect((await ui.find({ type: 'Text', text: 'ctx 80%' }))?.props.color).toBe('warning')
  expect((await ui.find({ type: 'Text', text: 'week 26%' }))?.props.dimColor).toBe(true)
  expect(await ui.find({ type: 'Text', text: 'resets 1d 4h' })).toBeDefined()
  await ui.unmount()

  await clock.advance(5 * 3600_000)
  ui = await mount()
  expect(await ui.find({ type: 'Text', text: 'resets 23h 30m' })).toBeDefined()
  await ui.unmount()
})
