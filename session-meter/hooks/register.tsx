import type { EngineInterface, Register, SessionContextUsage, SessionRateLimit } from 'claude-code'

// Past this share of the weekly limit or of the context window the figure
// turns the warning color.
export const WARN_AT = 75

type Reading = {
  model: string
  context: SessionContextUsage | null
  limits: readonly SessionRateLimit[]
  now: number
}

let reading: Reading = { model: '', context: null, limits: [], now: 0 }
let tick: { cancel: () => void } | null = null

// "claude-fable-5-2[1m]" -> "Fable 5.2".
export function displayModel(model: string): string {
  const short = model.replace(/\[.*\]$/, '').replace(/^.*claude-/, '').replace(/-\d{8}$/, '')
  const [name = '', ...version] = short.split('-')
  const title = name.charAt(0).toUpperCase() + name.slice(1)
  return version.length > 0 ? `${title} ${version.join('.')}` : title
}

export const weeklyLimit = (limits: readonly SessionRateLimit[]) => limits.find(l => l.kind === 'seven_day') ?? null

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

export type Part = { text: string; isHigh: boolean }

// The footer's parts in order: model, context fill, the weekly limit, its
// reset.
export function parts(r: Reading): Part[] {
  const out: Part[] = []
  if (r.model) out.push({ text: displayModel(r.model), isHigh: false })
  if (r.context?.percent !== undefined) {
    out.push({ text: `ctx ${r.context.percent}%`, isHigh: r.context.percent > WARN_AT })
  }
  const limit = weeklyLimit(r.limits)
  if (limit) {
    out.push({ text: `week ${Math.floor(limit.percentUsed)}%`, isHigh: limit.percentUsed > WARN_AT })
    const left = until(limit.resetsAt, r.now)
    if (left) out.push({ text: `resets ${left}`, isHigh: false })
  }
  return out
}

// Every window as reported, for /meter.
export function report(r: Reading): string {
  const lines = [`model: ${r.model || 'unknown'}`]
  if (r.context?.tokens !== undefined) {
    lines.push(`context: ${r.context.tokens} of ${r.context.window} tokens (${r.context.percent ?? '?'}%)`)
  } else {
    lines.push('context: no reading yet')
  }
  if (r.limits.length === 0) lines.push('limits: none reported')
  for (const l of r.limits) {
    const left = until(l.resetsAt, r.now)
    lines.push(`${l.kind}: ${l.percentUsed}%${left ? `, resets in ${left}` : ''}`)
  }
  return lines.join('\n')
}

async function take($: EngineInterface, context: SessionContextUsage, limits: readonly SessionRateLimit[]) {
  reading = { model: await $.session.model(), context, limits, now: await $.clock.now() }
  $.ui.invalidate('ui.render')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    const usage = await $.session.usage()
    await take($, usage.context, usage.rateLimits)
    $.command.register({ name: 'meter', description: 'List the model, context fill and every usage limit window' })
    // The countdown stays current while idle.
    tick?.cancel()
    tick = $.clock.every(60_000, async () => {
      reading = { ...reading, now: await $.clock.now() }
      $.ui.invalidate('ui.render')
    })
    return started
  })

  // Pushed after each turn and whenever a figure moves.
  on('session.measure', async ($, e, next) => {
    await take($, e.context, e.rateLimits)
    return next(e)
  })

  on('command.run', { command: 'meter' }, async $ => {
    const usage = await $.session.usage()
    await take($, usage.context, usage.rateLimits)
    return { text: report(reading) }
  })

  // The mode labels at the right of the prompt footer: the engine's own, then
  // the meter.
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const theirs = await next(e)
    const shown = parts(reading)
    if (shown.length === 0) return theirs

    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="row" columnGap={1}>
        {theirs}
        {shown.map((p, i) =>
          p.isHigh
            ? <Text key={String(i)} color="warning" bold>{p.text}</Text>
            : <Text key={String(i)} dimColor>{p.text}</Text>)}
      </Box>
    )
  }).catch(($, e, next) => next(e))
}
