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
the board with the selected play on it, beside a table of the sim's top 20 plays (win%, equity, static equity, iterations, the
opponent's mean reply and bingo rate), each play spelled in tiles: bright green for the tiles it plays, darker green for
the board's own it plays through, blanks' letters grey. Click a row to put its play on the board; click a heading to
sort those 20 by it (again to flip); the wheel scrolls the rows.

Say what to sim after `/magpie` in your own words. A model (Haiku) reads them into a request, knowing what the pane
shows and which lexicons MAGPIE has; the rest is MAGPIE's:

```
/magpie ADOPQRR                          an opening rack (in your lexicon unless you name another)
/magpie opening rack rucksex nwl         NWL23, the newest NWL installed
/magpie AEINRST after 8g vav             a rack after the moves before it (all lowercase is plain tiles; VaV has a blank)
/magpie 15/15/.../15 AEINRST/ 0/0 0 lex CSW24;    a CGP
/magpie ~/games/round3.gcg turn 12       a GCG (path, URL, woogles.io or cross-tables.com link) at a turn
/magpie <game> the turn where josh played brisant    or a rack held, or "after VODKA" (that player's next rack)
/magpie https://www.cross-tables.com/annotated.php?u=62161#13#    the turn the viewer link's move 13 was played on
/magpie next turn                        back, first turn, end of game: through the game the pane shows
/magpie csw                              the same position again in another lexicon (it says if that is the one in use)
```

Play on from what the pane shows by saying what happened, as a game goes on:

```
/magpie inertias was played. opp played zag through the a in inertias. next rack for me is polish?
```

The model turns that into moves and a rack (`polish?` is ?HILOPS); each move is then found among the legal plays
MAGPIE generates on the board so far (in milliseconds), narrowed by what you said: square, direction, score, the tiles
it went through, "to the TWS". Your own move is the sim's best-ranked placement of the word, the one the pane showed;
the opponent's, when it fits more than one place, is asked about, and a move that fits nowhere says so and where the
word does fit. With no rack given, `/magpie` asks for it; then the new position is simmed.

Tiles are counted from MAGPIE's letter distribution less the board. A word needing more of a letter than is left
takes blanks, and when the blank could be more than one of its tiles `/magpie` asks which ("the first Z (JAzZ) or the
second Z (JAZz)?"; say a blank in lowercase to skip the question). A word the tiles cannot make ("PIZZAZZ needs 4 Zs,
and only 1 Z and 2 blanks are left") and a rack the bag cannot hold are refused before anything runs. "Keeping ION"
commits your move from the whole rack, and your next rack must hold ION. A short answer to a question ("the second
z", "14G") is read with what you typed before it.

A game's position left out is its latest with a player to move. When a turn, rack or word fits more than one
position, `/magpie` lists them and asks which. Asking Claude ("sim AEINRST after 8G VAV") works too: the mod gives the
model a `simulate` tool that takes the same request as fields and reports the top plays back.

The table fills in while a sim runs, its numbers and order updating about twice a second. Each sim is 50 plays × 5,000 iterations at 4 plies, with WMP, and RIT and WIT where the lexicon has them. With the bag
empty (seven or fewer tiles unseen) MAGPIE solves the endgame instead, and the table shows its 50 best first moves: Result
the final spread (`W+20`, `L-10`, `T=0`), Net what the line nets, Then the rest of the line.

- Installs MAGPIE itself. Installing the mod asks the language you play in (English, Français, Deutsch, Nederlands,
  Català, Polski) and your lexicon, the one a position is simmed in when it names none. The first session without
  MAGPIE opens a setup pane with the same choices and an Install button, which gets MAGPIE 0.1.3 (on Windows the
  published `.exe`, its SHA-256 checked; on macOS and Linux, where none is published yet, built from its source in
  about a minute, which needs Apple's command-line tools or make and a C compiler), then has MAGPIE fetch its data
  (about 195 MB, every language) and build your lexicon's word map. About a minute on a Mac, all told. `/magpie setup`
  opens the pane again, to change the language or lexicon; until MAGPIE is installed, `/magpie` and the `simulate` tool
  open it too.
- MAGPIE lives in `~/.magpie` (`bin/magpie` and `data/`; `%LOCALAPPDATA%\MAGPIE` on Windows, where MAGPIE itself looks),
  or wherever `magpieDir` says (`claude plugin configure magpie-sim@olaugh-mods`). To use a MAGPIE checkout's own
  build instead, after `make release`: `mkdir -p ~/magpie/bin && cp bin/magpie ~/magpie/bin/ && cp -cR data ~/magpie/`
  (`-c` clones on APFS, so the 5 GB of data costs no space until it changes), and set `magpieDir` to `~/magpie`.
- Terminal: the board is an image, drawn by kitty graphics (kitty, Ghostty). Desktop and VS Code get SVG.
- Phone: the Claude app following a session over Remote Control draws no pane, so a `/magpie` sent from it gets a
  picture instead: a PNG of the board and the top 10 plays with their leaves, which the mod draws once the sim finishes and asks
  Claude to send (a short turn: a file card reaches the phone only from a SendUserFile call in the conversation).
  Asking Claude from the phone sends one too. `/magpie picture` (or "send it to my phone") sends one of what the pane shows.
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
