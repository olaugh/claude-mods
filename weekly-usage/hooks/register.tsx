import type { EngineInterface, Register, SessionRateLimit } from 'claude-code'

// Past this share of the weekly limit the label turns the warning color and
// says when the window resets.
export const WARN_AT = 75

// Material's gauge, a Nerd Font glyph (kitty and Ghostty carry it built in).
// The space after it lets kitty draw it two cells wide.
const GAUGE_GLYPH = '\u{F029A}'

// The latest seven-day reading, or null off a subscription or before the
// first response reports one.
let weekly: SessionRateLimit | null = null
let now = 0
let tick: { cancel: () => void } | null = null

const pickWeekly = (limits: readonly SessionRateLimit[]) => limits.find(l => l.kind === 'seven_day') ?? null

async function take($: EngineInterface, limits: readonly SessionRateLimit[]) {
  weekly = pickWeekly(limits)
  now = await $.clock.now()
  $.ui.invalidate('ui.render')
}

// "2d 4h", "3h 20m", "45m": how long until `resetsAt`, or null once passed.
export function until(resetsAt: string | undefined, nowMs: number): string | null {
  if (!resetsAt) return null
  const ms = Date.parse(resetsAt) - nowMs
  if (!(ms > 0)) return null
  const minutes = Math.ceil(ms / 60_000)
  const d = Math.floor(minutes / 1440)
  const h = Math.floor((minutes % 1440) / 60)
  const m = minutes % 60
  if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`
  return `${m}m`
}

// "week 42%", and past WARN_AT "week 82% · resets in 1d 4h".
export function label(limit: SessionRateLimit, nowMs: number, word = 'week'): string {
  const percent = Math.floor(limit.percentUsed)
  const text = `${word} ${percent}%`
  if (limit.percentUsed <= WARN_AT) return text
  const left = until(limit.resetsAt, nowMs)
  return left ? `${text} · resets in ${left}` : text
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await take($, (await $.session.usage()).rateLimits)
    // The reset countdown shown past WARN_AT stays current while idle.
    tick?.cancel()
    tick = $.clock.every(60_000, async () => {
      if (weekly === null || weekly.percentUsed <= WARN_AT) return
      now = await $.clock.now()
      $.ui.invalidate('ui.render')
    })
    return started
  })

  // Pushed after each turn and whenever a window moves a whole point.
  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits')) await take($, e.rateLimits)
    return next(e)
  })

  // The mode labels at the right of the prompt footer: the engine's own, then
  // the weekly figure.
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const theirs = await next(e)
    if (weekly === null) return theirs

    const { Box, Text } = $.ui.resolve(e)
    const isHigh = weekly.percentUsed > WARN_AT
    const isTerminal = e.surface === 'terminal'
    const text = label(weekly, now, isTerminal ? 'week' : 'Weekly')
    return (
      <Box flexDirection="row" columnGap={1}>
        {theirs}
        {isHigh
          ? <Text color="warning" bold>{isTerminal ? GAUGE_GLYPH + ' ' : ''}{text}</Text>
          : <Text dimColor>{isTerminal ? GAUGE_GLYPH + ' ' : ''}{text}</Text>}
      </Box>
    )
  }).catch(($, e, next) => next(e))
}
