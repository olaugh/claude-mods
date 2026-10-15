# AGENTS.md — for Claude (and other agents) working with these mods

This repository is a Claude Code **plugin marketplace** named `olaugh-mods` (`.claude-plugin/marketplace.json`). Each
top-level folder is one mod (a plugin whose `hooks/hooks.json` loads a TypeScript hooks module). John uses kitty at home and
Ghostty at work, both with Nerd Fonts.

## Installing the mods for John

Installing changes the user's Claude Code setup, so do it when John asks.

- **One mod, interactively (preferred):** tell John to type this at the prompt of a terminal Claude Code session (it is a
  slash command, not a shell command; it is not available inside the desktop app's Code tab):
  ```
  /plugin install turn-copy --marketplace olaugh/claude-mods
  ```
  It asks `Add marketplace?` (answer `y`) and a scope (user scope, the first one, so it loads in every session).
- **From a shell:**
  ```
  claude plugin marketplace add olaugh/claude-mods
  claude plugin install turn-copy@olaugh-mods --scope user
  ```
  (user is the default scope for both commands; it loads the mod in every session on the machine.)
- **Every mod in the marketplace:** install each `name` listed in `.claude-plugin/marketplace.json` the same way.
- **Without installing (a checked-out working copy):** `claude --plugin-dir /path/to/claude-mods/<mod>` for one session,
  or put the folder in `CLAUDE_CODE_PLUGIN_DIRS` (absolute paths, `:`-separated) in the `env` block of
  `~/.claude/settings.json` to load it in every session; edits then apply without reinstalling.
- **Updating:** `claude plugin update <mod>`, then `/reload-plugins` in a running session.
- Check what is installed with `claude plugin list`. Do not install a mod twice (a marketplace install plus a
  `--plugin-dir`/`CLAUDE_CODE_PLUGIN_DIRS` copy of the same mod draws its UI twice).

This is a private repository: the machine's git must be able to read `github.com/olaugh/claude-mods`
(`gh auth status`; `gh auth setup-git` if `git clone` asks for credentials).

## Adding or changing a mod

Layout of a mod `<name>/`:

```
<name>/.claude-plugin/plugin.json   { "name": "<name>", "version": "x.y.z", "description": "...", "author": { "name": "olaugh" } }
<name>/hooks/hooks.json             { "modules": ["./register.tsx"] }
<name>/hooks/register.tsx           export const register: Register = (on) => { ... }   (types from 'claude-code')
<name>/tests/*.test.tsx             behaviour tests
<name>/tsconfig.json                { "extends": "./.claude-plugin/types/tsconfig.json" }
```

1. Create the folder, then add an entry to `.claude-plugin/marketplace.json`:
   `{ "name": "<name>", "source": "./<name>", "description": "..." }`.
2. The API reference is written by Claude Code into `<name>/.claude-plugin/types/` when the mod is loaded (ignored by git);
   the `plugin-authoring` skill explains the API (load it before writing hooks).
3. Check before committing:
   ```
   claude plugin validate .          # the marketplace
   claude plugin validate <name>     # the mod: hooks, calls, refused results
   claude plugin test <name>         # its tests
   ```
   Give gating hooks a `.catch(...)` (validate lists them).
4. Bump `version` in the mod's `plugin.json` when changing it, so `claude plugin update` picks it up.
5. Add the mod to `README.md`.

Conventions: terminal icons are Nerd Font glyphs (drawn by kitty and Ghostty); surfaces without them (the desktop app)
get words. No secrets, tokens or machine-specific paths in the repository.
