# Wood (`wood`)

- Source: "gmchess style wood piece set" by Kadagaden,
  https://github.com/Kadagaden/chess-pieces/tree/master/xiangqi_gmchess_style_wood
  (a vector remake of the gmchess piece set)
- License: Creative Commons Attribution 4.0 International (CC BY 4.0),
  https://creativecommons.org/licenses/by/4.0/
- Attribution (shown to players on the site's Source code page, /source):
  "Wood pieces: "gmchess style wood piece set" by Kadagaden
  (https://github.com/Kadagaden/chess-pieces), CC BY 4.0. Modified."
- Changes for Mistboard (2026-10-08): root `viewBox` set so the disc sits centred
  in the piece box; files renamed to `<color>-<role>.svg`. `red-back.svg` and
  `black-back.svg` are the general (帥 / 將) with the character removed, used for
  face-down pieces in jieqi and banqi. Drawings otherwise unchanged.
- Not drawn by this set: crossed soldier (plain soldier is used), Fortress
  treasure and Duck Xiangqi duck (Mistboard draws them on this set's back).
- Xiangqi Mahjong tile layers (2026-10-15), in `tile/`: each piece file split
  by `apps/web/scripts/asset-tile-glyphs.mjs` into the character alone
  (`tile/<color>-<role>.svg`) and the disc's surface with the character
  removed, its `viewBox` cropped to a square inside the rim
  (`tile/<color>-face.svg`, from the general). Derived, never edited by hand;
  `apps/web/src/asset-tile-glyphs.test.ts` re-derives them.
