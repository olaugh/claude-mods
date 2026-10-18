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
opponent's mean reply and bingo rate), each play spelled in tiles: bright green for the tiles it plays, darker green for
the board's own it plays through, blanks' letters grey. Click a row to put its play on the board; click a heading to
sort by it (again to flip); the wheel scrolls the rows.

Say what to sim after `/magpie` in your own words. A model (Haiku) reads them into a request, knowing what the pane
shows and which lexicons MAGPIE has; the rest is MAGPIE's:

```
/magpie ADOPQRR                          an opening rack (CSW24 unless you name a lexicon)
/magpie opening rack rucksex nwl         NWL23, the newest NWL installed
/magpie AEINRST after 8g vav             a rack after the moves before it (all lowercase is plain tiles; VaV has a blank)
/magpie 15/15/.../15 AEINRST/ 0/0 0 lex CSW24;    a CGP
/magpie ~/games/round3.gcg turn 12       a GCG (path, URL, woogles.io or cross-tables.com link) at a turn
/magpie <game> the turn where josh played brisant    or a rack held, or "after VODKA" (that player's next rack)
/magpie https://www.cross-tables.com/annotated.php?u=62161#13#    the turn the viewer link's move 13 was played on
/magpie next turn                        back, first turn, end of game: through the game the pane shows
/magpie csw                              the same position again in another lexicon (it says if that is the one in use)
```

A game's position left out is its latest with a player to move. When a turn, rack or word fits more than one
position, `/magpie` lists them and asks which. Asking Claude ("sim AEINRST after 8G VAV") works too: the mod gives the
model a `simulate` tool that takes the same request as fields and reports the top plays back.

Each sim is 50 plays × 5,000 iterations at 4 plies, with WMP, and RIT and WIT where the lexicon has them. With the bag
empty (seven or fewer tiles unseen) MAGPIE solves the endgame instead, and the table shows its 50 best first moves: Result
the final spread (`W+20`, `L-10`, `T=0`), Net what the line nets, Then the rest of the line.

- Needs MAGPIE installed in `~/magpie` (`bin/magpie` and `data/`), or wherever `magpieDir` says
  (`claude plugin configure magpie-sim@olaugh-mods`; empty runs the `magpie` on PATH). From a MAGPIE checkout, after
  `make release`: `mkdir -p ~/magpie/bin && cp bin/magpie ~/magpie/bin/ && cp -cR data ~/magpie/` (`-c` clones on
  APFS, so the 5 GB of data costs no space until it changes).
- Terminal: the board is an image, drawn by kitty graphics (kitty, Ghostty). Desktop and VS Code get SVG.
- Phone: the Claude app following a session over Remote Control draws no pane, so a `/magpie` sent from it gets a
  picture instead (a PNG of the board and the top 10 plays, sent with SendUserFile once the sim finishes), as does
  asking Claude from the phone. `/magpie picture` (or "send it to my phone") sends one of what the pane shows.
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
