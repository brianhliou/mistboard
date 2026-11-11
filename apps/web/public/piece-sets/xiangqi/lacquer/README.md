# Lacquer (`lacquer`)

- Source: https://github.com/gbtami/pychess-variants/tree/master/static/images/pieces/xiangqi/playok
  (pychess.org's default xiangqi skin)
- Art: PlayOK, https://www.playok.com/ ; SVG derivative by Sebastian Pipping
  (characters set in WenQuanYi Micro Hei)
- License: CC0 1.0 Universal (public domain dedication),
  https://creativecommons.org/publicdomain/zero/1.0/ . Upstream notice: `LICENSE.txt`.
- Attribution (not required by CC0, given anyway): "Lacquer piece art by PlayOK,
  CC0 1.0, via pychess-variants."
- Changes for Mistboard (2026-10-08): root `viewBox` set so the disc sits centred
  in the piece box; files renamed to `<color>-<role>.svg`; `*-back.svg` is the
  upstream `*_covered.svg`. Drawings unchanged.
- Not drawn by this set: crossed soldier (plain soldier is used), Fortress
  treasure and Duck Xiangqi duck (Mistboard draws them on this set's back).
- Xiangqi Mahjong tile layers (2026-10-15), in `tile/`: each piece file split
  by `apps/web/scripts/asset-tile-glyphs.mjs` into the character alone
  (`tile/<color>-<role>.svg`) and the disc's surface with the character
  removed, its `viewBox` cropped to a square inside the rim
  (`tile/<color>-face.svg`, from the general). Derived, never edited by hand;
  `apps/web/src/asset-tile-glyphs.test.ts` re-derives them.
- Banqi face-down tile (2026-10-17): `banqi-back.svg` is `black-back.svg`
  unchanged with a mother-of-pearl flower and ring drawn on it by Mistboard,
  one look for both sides.
