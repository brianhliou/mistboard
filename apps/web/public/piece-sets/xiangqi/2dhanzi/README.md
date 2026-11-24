# Flat (`2dhanzi`)

- Source: https://github.com/gbtami/pychess-variants/tree/5ebec9241a4a344204d63feaaeeee2549bd949ac/static/images/pieces/xiangqi/2dhanzi
  (pychess.org piece set `2dhanzi`, also the default xiangqi set on PlayStrategy)
- License: GNU AGPL-3.0-or-later. The pychess-variants asset list
  (`static/COPYING.md`) gives `static/images/pieces/xiangqi/*` as
  "pychess-variants contributors | AGPLv3+"; the repository license is
  https://github.com/gbtami/pychess-variants/blob/master/LICENSE. The original
  glyph artist is not named there. Mistboard is AGPL-3.0-or-later too; the full
  text is the repository's `LICENSE`.
- Attribution: "Flat pieces: the 2dhanzi set from pychess-variants
  (pychess-variants contributors), AGPL-3.0-or-later."
- Changes for Mistboard (2026-11-24), as AGPL section 5 asks: root `viewBox`
  set so the disc sits centred in the piece box; files renamed from
  `<side><letter>.svg` to `<color>-<role>.svg`. `red-back.svg` and
  `black-back.svg` are the general (`RK.svg` / `BK.svg`) with the character
  removed, used for face-down pieces in jieqi and fog. Each file carries a
  comment with its upstream path. Drawings otherwise unchanged; these SVGs are
  their own source.
- Not drawn by this set: crossed soldier (plain soldier is used), Fortress
  treasure and Duck Xiangqi duck (Mistboard draws them on this set's back), and
  the banqi face-down tile (Mistboard draws a plain disc in neither side's
  colour, `xiangqiBanqiBackMarks`).
- Xiangqi Mahjong tile layers (2026-11-24), in `tile/`: each piece file split
  by `apps/web/scripts/asset-tile-glyphs.mjs` into the character alone
  (`tile/<color>-<role>.svg`) and the disc's surface with the character
  removed, its `viewBox` cropped to a square inside the rim
  (`tile/<color>-face.svg`, from the general). Derived, never edited by hand;
  `apps/web/src/asset-tile-glyphs.test.ts` re-derives them.
