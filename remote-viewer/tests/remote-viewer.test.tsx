import { expect, test } from 'claude-code/testing'
import type { RenderSurface } from 'claude-code'
import { viewers } from '../hooks/register'

test('viewers names each surface once, with a count', () => {
  expect(viewers([])).toBe(null)
  expect(viewers(['mobile'])).toBe('phone')
  expect(viewers(['mobile', 'mobile'])).toBe('phone ×2')
  expect(viewers(['mobile', 'desktop'])).toBe('phone + desktop')
})

test('the footer shows attached clients until they detach', async ($, on) => {
  let roster: RenderSurface[] = ['terminal']
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.surfaces', () => ({ value: roster }) as never)
  on('session.attach', (_, e) => ({ clientId: e.clientId }))
  on('session.detach', (_, e) => ({ clientId: e.clientId }))
  // Stands in for the engine's own mode labels.
  on('ui.render', ($e, e) => {
    const { Text } = $e.ui.resolve(e)
    return <Text dimColor>focus</Text>
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const footer = async (surface: 'terminal' | 'desktop' = 'terminal') => {
    const ui = await $.ui.mount({ plugin: 'remote-viewer', surface, component: 'SessionMode', requestId: 'modes', props: { modes: ['focus'] } })
    const label = await ui.find({ type: 'Text', text: /phone|desktop/ })
    expect(await ui.find({ type: 'Text', text: 'focus' })).toBeDefined()
    await ui.unmount()
    return label?.text ?? null
  }

  expect(await footer()).toBe(null)

  roster = ['terminal', 'mobile']
  await $.session.attach({ surface: 'mobile', clientId: 'phone-1' })
  expect(await footer()).toBe('\u{F011C} phone')
  // The attached app's own footer does not name itself.
  expect(await footer('desktop')).toBe(null)

  roster = ['terminal', 'mobile', 'desktop']
  await $.session.attach({ surface: 'mobile', clientId: 'phone-2' })
  await $.session.attach({ surface: 'desktop', clientId: 'mac' })
  expect(await footer()).toBe('\u{F011C} phone ×2 + desktop')

  roster = ['terminal', 'desktop']
  await $.session.detach({ clientId: 'phone-1', reason: 'detached' } as never)
  await $.session.detach({ clientId: 'phone-2', reason: 'detached' } as never)
  expect(await footer()).toBe('\u{F0379} desktop')

  roster = ['terminal']
  await $.session.detach({ clientId: 'mac', reason: 'detached' } as never)
  expect(await footer()).toBe(null)
})

test('a client attached before a reload is found from the roster', async ($, on) => {
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.surfaces', () => ({ value: ['terminal', 'mobile'] }) as never)
  on('ui.render', ($e, e) => {
    const { Text } = $e.ui.resolve(e)
    return <Text dimColor>focus</Text>
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'remote-viewer', surface: 'terminal', component: 'SessionMode', requestId: 'modes', props: { modes: [] } })
  expect((await ui.find({ type: 'Text', text: /phone/ }))?.text).toBe('\u{F011C} phone')
  await ui.unmount()
})
