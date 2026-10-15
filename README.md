# claude-mods

My personal mods for [Claude Code](https://claude.com/claude-code). The repository is a plugin marketplace: each folder is one mod.

## Install

In a terminal Claude Code session, type:

```
/plugin install turn-copy --marketplace olaugh/claude-mods
```

Answer `y` to add the marketplace, then pick the user scope (Enter). The mod is active right away and loads in every
session you start on that machine afterwards. Repeat once per machine.

To pick up changes later:

```
claude plugin update turn-copy
```

then `/reload-plugins` in a running session.

## Mods

### turn-copy

A copy button under each finished assistant reply. It copies the whole turn's text (every text block of the reply,
joined) and turns into a check mark for 1.5 s, like the Claude desktop app. Beside it, the reply's size:
`1,234 chars · 18 lines`, which also copies when clicked.

- Terminal: the icons are Nerd Font glyphs (Material `content_copy` U+F018F and `check` U+F012C), so the terminal needs a
  Nerd Font (kitty and Ghostty draw them built in). Clicks work in fullscreen terminal mode; otherwise use `/copy`.
- Desktop app: shows `⧉ Copy` / `✓ Copied`.

Agents (Claude sessions) installing or writing mods: see [AGENTS.md](AGENTS.md).

## Developing

Edit a mod's `hooks/register.tsx`, then check it:

```
claude plugin validate turn-copy
claude plugin test turn-copy
```

To run a working copy without installing, start Claude Code with `claude --plugin-dir ./turn-copy` (or name the folder in
`CLAUDE_CODE_PLUGIN_DIRS`).
