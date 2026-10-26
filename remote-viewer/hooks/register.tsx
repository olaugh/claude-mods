import type { EngineInterface, Register, RenderSurface } from 'claude-code'

// Material's cellphone and monitor, Nerd Font glyphs (kitty and Ghostty carry
// them built in). The space after one lets kitty draw it two cells wide.
const PHONE_GLYPH = '\u{F011C}'
const SCREEN_GLYPH = '\u{F0379}'

const NAMES: Partial<Record<RenderSurface, string>> = { mobile: 'phone', desktop: 'desktop', vscode: 'vscode' }

// The remote clients attached now, by client id. A client attached before a
// reload is known only by its surface (`seed:<surface>`).
const clients = new Map<string, RenderSurface>()

// Brings the map in line with the engine's roster: a surface no longer drawn
// has no clients; one drawn that the map lacks gets a seed.
async function reconcile($: EngineInterface) {
  const drawn = new Set<RenderSurface>((await $.session.surfaces()).filter(s => s !== 'terminal'))
  for (const [id, surface] of clients) if (!drawn.has(surface)) clients.delete(id)
  const known = new Set(clients.values())
  for (const surface of drawn) if (!known.has(surface)) clients.set('seed:' + surface, surface)
  $.ui.invalidate('ui.render')
}

// "phone", "phone ×2", "phone + desktop"; null with nothing attached.
export function viewers(surfaces: Iterable<RenderSurface>): string | null {
  const counts = new Map<RenderSurface, number>()
  for (const s of surfaces) counts.set(s, (counts.get(s) ?? 0) + 1)
  const parts = [...counts].map(([s, n]) => (NAMES[s] ?? s) + (n > 1 ? ` ×${n}` : ''))
  return parts.length ? parts.join(' + ') : null
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await reconcile($)
    return started
  })

  on('session.attach', async ($, e, next) => {
    const done = await next(e)
    if (e.surface !== 'terminal') {
      clients.delete('seed:' + e.surface)
      clients.set(e.clientId, e.surface)
    }
    await reconcile($)
    return done
  })

  on('session.detach', async ($, e, next) => {
    const done = await next(e)
    clients.delete(e.clientId)
    await reconcile($)
    return done
  })

  // On the terminal's footer only: it says who else is looking.
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const theirs = await next(e)
    const text = viewers(clients.values())
    if (e.surface !== 'terminal' || text === null) return theirs

    const { Box, Text } = $.ui.resolve(e)
    const glyph = [...clients.values()].includes('mobile') ? PHONE_GLYPH : SCREEN_GLYPH
    return (
      <Box flexDirection="row" columnGap={1}>
        {theirs}
        <Text color="suggestion">{glyph + ' ' + text}</Text>
      </Box>
    )
  }).catch(($, e, next) => next(e))
}
