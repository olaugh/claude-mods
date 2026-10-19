// Tiles of more than one letter, Catalan's, which MAGPIE writes in brackets:
// [L·L], [NY], [QU], a blank's in lowercase ([ny]). Inside the mod each is
// one letter, a cased one no set MAGPIE plays has, so that a rack or a word
// is a string with a letter per tile and a blank is its lowercase, as for
// every other set. MAGPIE's output is packed so as it comes in, what goes to
// MAGPIE or is shown is unpacked.

const MULTI_LETTER: readonly { name: string; tile: string }[] = [
  { name: 'L·L', tile: 'Ŀ' },
  { name: 'NY', tile: 'Ñ' },
  { name: 'QU', tile: 'Ꝗ' },
]

// L·L also as a person (or the model reading them) may write it in
// brackets, its dot left out or a full stop: [LL] is no other tile.
const BRACKETED = /\[(L[·.]?L|NY|QU)\]/giu
const PACKED = /[ĿŀÑñꝖꝗ]/gu

/** The one letter standing for a tile named by its letters (`L·L`), as a
 * letter distribution names it; a single letter is itself. */
export function tileOf(written: string): string {
  const name = /^l[·.]?l$/iu.test(written) ? written.replace(/^(.)[·.]?(.)$/u, '$1·$2') : written
  const upper = name.toUpperCase()
  const tile = MULTI_LETTER.find(multi => multi.name === upper)?.tile
  if (tile === undefined) {
    return name
  }
  return name === upper ? tile : tile.toLowerCase()
}

/** A tile's letters, as it is drawn: `L·L` for Catalan's, a blank's in
 * lowercase. */
export function tileLabel(tile: string): string {
  const upper = tile.toUpperCase()
  const name = MULTI_LETTER.find(multi => multi.tile === upper)?.name
  if (name === undefined) {
    return tile
  }
  return tile === upper ? name : name.toLowerCase()
}

/** Text with each bracketed tile packed into its one letter. */
export function packTiles(text: string): string {
  return text.replace(BRACKETED, (_, name: string) => tileOf(name))
}

/** Text with each packed tile written back in brackets, as MAGPIE takes it
 * and people read it. */
export function unpackTiles(text: string): string {
  return text.replace(PACKED, tile => `[${tileLabel(tile)}]`)
}
