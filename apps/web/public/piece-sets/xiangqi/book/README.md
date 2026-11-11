# Book (`book`)

- Source: BabelStone Xiangqi Colour, Version 11.001 (2021-11-01), by Andrew West,
  https://www.babelstone.co.uk/Fonts/Xiangqi.html
  (`BabelStoneXiangqiColour.woff`, Unicode Chess Symbols U+1FA60..U+1FA6D)
- License: SIL Open Font License 1.1, full text with the copyright notice in
  `OFL.txt` (copied from the font's own license record). Reserved Font Name:
  BabelStone; this set is not a font and does not use that name.
- Attribution (shown on the site's Source code page, /source): "Book pieces:
  glyphs from BabelStone Xiangqi Colour by Andrew West, SIL Open Font License 1.1."
- How the files were made (2026-10-08): each glyph's COLR layers (yellow disc,
  red or black ring, character) were drawn as filled SVG paths with fontTools,
  flipped to SVG's y-down axis, with a `viewBox` that centres the disc. The
  `*-back.svg` files are the disc and ring layers with no character.
- Not drawn by this set: crossed soldier (plain soldier is used), Fortress
  treasure and Duck Xiangqi duck (Mistboard draws them on this set's back).
- Xiangqi Mahjong tile layers (2026-10-15), in `tile/`: each piece file split
  by `apps/web/scripts/asset-tile-glyphs.mjs` into the character alone
  (`tile/<color>-<role>.svg`) and the disc's surface with the character
  removed, its `viewBox` cropped to a square inside the rim
  (`tile/<color>-face.svg`, from the general). Derived, never edited by hand;
  `apps/web/src/asset-tile-glyphs.test.ts` re-derives them.
