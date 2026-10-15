import type { EngineInterface, Register } from 'claude-code'

const DONE_MS = 1500

// The icons are Nerd Font glyphs, which kitty and Ghostty carry built in:
// Material's content_copy (the back square an L at the upper left, the front
// one lower right) and its check. Text, so the button takes them as its
// label and a click lands on them. A space after a glyph lets kitty draw it
// two cells wide, nearer the desktop app's icon size.
const COPY_GLYPH = '\u{F018F}'
const DONE_GLYPH = '\u{F012C}'
// The pressed-and-hovered highlight covers the label's cells, and trailing
// spaces are trimmed (it lit one cell under a two-cell glyph). A braille
// blank draws as an empty cell and is not whitespace, so it holds a one-cell
// margin each side: margin, glyph, the space kitty widens it into, margin.
const MARGIN = '\u2800'
export const iconLabel = (glyph: string) => MARGIN + glyph + ' ' + MARGIN

const thousands = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',')

// What the copy holds: "1,234 chars · 18 lines".
export function stats(text: string): string {
  const chars = [...text].length
  const lines = text.split('\n').length
  return `${thousands(chars)} ${chars === 1 ? 'char' : 'chars'} · ${thousands(lines)} ${lines === 1 ? 'line' : 'lines'}`
}

// Each finished reply as its text blocks in order, rebuilt from the session's
// messages at load and around each turn. A block not found here (the reply
// still being written, a summary row) gets no button.
let replies: string[][] = []
let copied: string | null = null
// Turns under way; while one is, the newest reply is still being written.
const running = new Set<string>()
let timer: { cancel: () => void } | null = null

const norm = (s: string) => s.trim()

async function rebuild($: EngineInterface) {
  const out: string[][] = []
  let cur: string[] | null = null
  for (const m of await $.session.messages()) {
    if (m.role === 'user') {
      // A typed prompt opens a reply; a tool result continues the current one.
      if (norm(m.text) && !m.toolResults?.length) {
        if (cur?.length) out.push(cur)
        cur = []
      }
    } else if (norm(m.text)) {
      ;(cur ??= []).push(m.text)
    }
  }
  if (cur?.length) out.push(cur)
  replies = out
  $.ui.invalidate('ui.render')
}

// The whole reply's text when `block` is that reply's last text block, and
// the reply is finished (`lastOpen`: the newest reply is still being written).
export function replyText(
  all: readonly (readonly string[])[],
  block: string,
  lastOpen = false,
): string | null {
  const b = norm(block)
  if (!b) return null
  for (let r = all.length - 1; r >= 0; r--) {
    const texts = all[r]
    const last = texts[texts.length - 1]
    if (texts.some(t => t.includes(b))) {
      if (lastOpen && r === all.length - 1) return null
      return norm(last).endsWith(b) ? texts.map(norm).join('\n\n') : null
    }
  }
  return null
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await rebuild($)
    return next(e)
  })

  // /clear, /resume, /branch and compaction replace the conversation.
  on('classic.SessionStart', async ($, e, next) => {
    await rebuild($)
    return next(e)
  }).catch(($, e, next) => next(e)) // a failed rebuild must not hold up the session

  // The turn that starts has no blocks in `replies`, so it shows no button
  // until it completes.
  on('turn.start', async ($, e, next) => {
    running.add(e.turnId)
    await rebuild($)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    running.delete(e.turnId)
    if (e.agentId === undefined) {
      await rebuild($)
      // The last block can land just after the event; look again shortly.
      $.clock.after(400, () => {
        void rebuild($)
      })
    }
    return done
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const theirs = await next(e)
    if (e.props.isSummary) return theirs
    const text = replyText(replies, e.props.text, running.size > 0)
    if (text === null) return theirs

    const { Box, Button, Text } = $.ui.resolve(e)
    const id = e.requestId
    const isCopied = copied === id

    const onPress = async (press: { surface: typeof e.surface }) => {
      const result = await $.ui.copy({ text, surface: press.surface })
      if (!result.isCopied) {
        $.ui.toast('Copy failed: ' + result.reason)
        return
      }
      copied = id
      timer?.cancel()
      timer = $.clock.after(DONE_MS, () => {
        copied = null
        $.ui.invalidate('ui.render')
      })
      $.ui.invalidate('ui.render')
    }

    // The terminal draws the glyphs; surfaces in a proportional font without
    // the Nerd Font symbols (the desktop app) draw words.
    const label = stats(text)
    const icon =
      e.surface === 'terminal'
        ? isCopied
          ? <Text color="success">{iconLabel(DONE_GLYPH)}</Text>
          : <Text color="inactive">{iconLabel(COPY_GLYPH)}</Text>
        : isCopied
          ? <Text color="success">✓ Copied</Text>
          : <Text color="inactive">⧉ Copy</Text>
    return (
      <Box flexDirection="column">
        {theirs}
        <Box paddingLeft={e.surface === 'terminal' ? 1 : 2} flexDirection="row" columnGap={1}>
          <Button key={'copy:' + id} label={isCopied ? 'Copied' : 'Copy'} plain onPress={onPress}>
            {icon}
          </Button>
          <Button key={'count:' + id} label={label} plain onPress={onPress}>
            <Text dimColor>{label}</Text>
          </Button>
        </Box>
      </Box>
    )
  })
}
