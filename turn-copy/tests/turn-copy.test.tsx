import { expect, mock, test } from 'claude-code/testing'
import { iconLabel, replyText, stats } from '../hooks/register'

const MESSAGES = [
  { role: 'user', text: 'first question', toolUses: [] },
  { role: 'assistant', text: 'Let me look.', toolUses: [] },
  { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 't1', text: 'ok', isError: false }] },
  { role: 'assistant', text: 'The answer is 42.', toolUses: [] },
  { role: 'user', text: 'second question', toolUses: [] },
]

test('replyText joins a reply only at its last block', () => {
  const all = [['Let me look.', 'The answer is 42.'], ['Other reply']]
  expect(replyText(all, 'The answer is 42.')).toBe('Let me look.\n\nThe answer is 42.')
  expect(replyText(all, 'Let me look.')).toBe(null)
  expect(replyText(all, 'not in any reply')).toBe(null)
  expect(replyText(all, '   ')).toBe(null)
  // While a turn runs, the newest reply has no button; older ones keep theirs.
  expect(replyText(all, 'Other reply', true)).toBe(null)
  expect(replyText(all, 'The answer is 42.', true)).toBe('Let me look.\n\nThe answer is 42.')
})

test('icon label keeps a margin each side that trimming cannot remove', () => {
  const label = iconLabel('\u{F018F}')
  expect(label.trim()).toBe(label)
  expect([...label]).toEqual(['\u2800', '\u{F018F}', ' ', '\u2800'])
})

test('stats count characters and lines', () => {
  expect(stats('a')).toBe('1 char · 1 line')
  expect(stats('héllo\nworld')).toBe('11 chars · 2 lines')
  expect(stats('x'.repeat(1234) + '\n'.repeat(17))).toBe('1,251 chars · 18 lines')
})

test('button copies the whole turn and flashes a check mark', async ($, on) => {
  const clock = mock.clock(on)
  const copies: string[] = []
  on('session.messages', () => ({ value: MESSAGES }) as never)
  on('classic.SessionStart', () => ({}) as never)
  on('ui.copy', (_$, e) => {
    copies.push(e.text)
    return { value: { isCopied: true } } as never
  })
  // Stands in for the engine's own drawing of the reply.
  on('ui.render', ($e, e) => {
    const { Text } = $e.ui.resolve(e)
    return Text({ children: [String((e.props as { text?: string }).text ?? '')] }) as never
  })
  await $.classic.SessionStart({ source: 'clear' })

  for (const surface of ['terminal', 'desktop'] as const) {
    const last = await $.ui.mount({
      plugin: 'turn-copy', surface, component: 'AssistantMessage', requestId: 'm4',
      props: { text: 'The answer is 42.', isFirstOfReply: false },
    })
    expect(await last.find({ type: 'Text', text: /chars · 3 lines/ })).toBeDefined()
    expect(await last.find(surface === 'terminal' ? { type: 'Text', text: iconLabel('\u{F018F}') } : { type: 'Text', text: '⧉ Copy' })).toBeDefined()
    await last.press({ key: 'copy:m4' })
    expect(copies.at(-1)).toBe('Let me look.\n\nThe answer is 42.')
    expect(await last.find(surface === 'terminal' ? { type: 'Text', text: iconLabel('\u{F012C}') } : { type: 'Text', text: '✓ Copied' })).toBeDefined()
    await clock.advance(1600)
    expect(await last.find(surface === 'terminal' ? { type: 'Text', text: iconLabel('\u{F018F}') } : { type: 'Text', text: '⧉ Copy' })).toBeDefined()
    await last.unmount()

    // An earlier block of the reply, and a reply still being written: no button.
    for (const [id, text] of [['m2', 'Let me look.'], ['m6', 'Still working…']]) {
      const ui = await $.ui.mount({
        plugin: 'turn-copy', surface, component: 'AssistantMessage', requestId: id,
        props: { text, isFirstOfReply: true },
      })
      expect(await ui.find({ key: 'copy:' + id })).toBeUndefined()
      await ui.unmount()
    }
  }
})
