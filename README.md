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

### magpie-sim

Sims a crossword position in [MAGPIE](https://github.com/jvc56/MAGPIE) and shows the results in a pane: a picture of
the board with the selected play on it, beside a table of the top 50 plays (win%, equity, static equity, iterations, the
opponent's mean reply and bingo rate). `j`/`k` or the arrows move; `w` `e` `s` `t` `i` `a` sort by win%, equity, score,
static equity, iterations or A–Z (again to flip).

```
/magpie ADOPQRR                     an opening rack (CSW24 unless a lexicon follows: /magpie ADOPQRR NWL23)
/magpie AEINRST after 8g vav        a rack after the moves before it; an all-lowercase word is plain tiles, VaV has a blank
/magpie 15/15/.../15 AEINRST/ 0/0 0 lex CSW24;    a CGP
/magpie ~/games/round3.gcg 12       a GCG (path, URL, woogles.io or cross-tables.com link) at a turn
```

For a GCG, which position: a turn number (`12`, `turn 12`; 1 is the game's first move), a rack the player to move held
(`DEEILRV`, `rack DEEILRV`), a word played from it (`SILVERED`, `before SILVERED`), `after SILVERED` (the position it
was played into), or `event 23` (MAGPIE's `goto`). Left out, the latest position with a player to move. When it fits
more than one position, `/magpie` lists them and asks which. Asking Claude ("sim AEINRST after 8G VAV") works too: the
mod gives the model a `simulate` tool that reads the same words and reports the top plays back.

Each sim is 50 plays × 20,000 iterations at 2 plies, with WMP, and RIT and WIT where the lexicon has them.

- Needs MAGPIE installed in `~/magpie` (`bin/magpie` and `data/`), or wherever `magpieDir` says
  (`claude plugin configure magpie-sim@olaugh-mods`; empty runs the `magpie` on PATH). From a MAGPIE checkout, after
  `make release`: `mkdir -p ~/magpie/bin && cp bin/magpie ~/magpie/bin/ && cp -cR data ~/magpie/` (`-c` clones on
  APFS, so the 5 GB of data costs no space until it changes).
- Terminal: the board is an image, drawn by kitty graphics (kitty, Ghostty). Desktop, VS Code and mobile get SVG.
- The tiles are Fira Code (the MAGPIE TUI's font, OFL, in `assets/`), rasterized by the mod itself.

Agents (Claude sessions) installing or writing mods: see [AGENTS.md](AGENTS.md).

## Developing

Edit a mod's `hooks/register.tsx`, then check it:

```
claude plugin validate turn-copy
claude plugin test turn-copy
```

To run a working copy without installing, start Claude Code with `claude --plugin-dir ./turn-copy` (or name the folder in
`CLAUDE_CODE_PLUGIN_DIRS`).
