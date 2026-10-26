# Piece-set credits

Every folder of art under `piece-sets/`: where it came from, who made it, and
its licence. Mistboard is AGPLv3; this file is the record that lets each set's
licence be checked against that.

This file does not cover the chess sets in `../pieces/`, which come from lichess;
their credits are in [`../pieces/CREDITS.md`](../pieces/CREDITS.md). The two
files together cover every piece set the site ships.

A folder's subfolders (`tile/`, `board/`) are covered by its row. A new folder
needs a row here; `apps/web/src/piece-set-credits.test.ts` fails without one.

## Mistboard's own art

Made for Mistboard: figures produced with an AI image model, then cleaned,
recoloured and resized by Mistboard. No third-party art is copied into them.
Released with the rest of the repository under AGPL-3.0-or-later.

| Folder | Set | Made | Notes |
|---|---|---|---|
| `xiangqi/international` | International (the default xiangqi set) | 2026-07, redrawn 2026-10 | Figures as transparent cutouts; the renderer draws the disc and ring. Includes the Fortress treasure and the crossed soldier. |
| `xiangqi/international-grid` | International, square-grid cannon | 2026-10 | The cannon's own figure for the square grid; derived from `xiangqi/international`. |
| `xiangqi/animal-dobutsu` | Animal Dobutsu | 2026-06 | Includes the Fortress treasure (peacock) and the Duck Xiangqi duck (2026-09). |
| `jungle/dobutsu` | Jungle Dobutsu | 2026-06 | The same Dobutsu drawings in Jungle's eight ranks; `board/` holds the terrain tiles (grass, water, trap, den). |
| `jungle/origami` | Jungle Origami | 2026-06 | Not served: retired when Dobutsu became the Jungle set. |

## Third-party art

Each xiangqi folder below carries a `README.md` with its exact source, the
changes Mistboard made, and the attribution line; the CC BY 4.0 and OFL credits
are also shown on the site's Source code page (`/source`).

| Folder | Set | Author | Licence | Details |
|---|---|---|---|---|
| `xiangqi/lacquer` | Lacquer | Art by PlayOK, SVG by Sebastian Pipping, via pychess-variants | CC0 1.0 | [README](./xiangqi/lacquer/README.md), upstream `LICENSE.txt` |
| `xiangqi/wood` | Wood ("gmchess style wood piece set") | Kadagaden | CC BY 4.0, modified | [README](./xiangqi/wood/README.md) |
| `xiangqi/book` | Book (glyphs from BabelStone Xiangqi Colour) | Andrew West | SIL OFL 1.1 | [README](./xiangqi/book/README.md), `OFL.txt` |
| `xiangqi/brush` | Brush (pychess-variants `hnzw`) | gbtami and contributors | AGPL-3.0, modified | [README](./xiangqi/brush/README.md) |
| `xiangqi/clerical` | Clerical (pychess-variants `lishuw`) | gbtami and contributors | AGPL-3.0, modified | [README](./xiangqi/clerical/README.md) |
| `international` | Shogi International (lishogi koma) | CouchTomato87 | CC BY 4.0 | From [lishogi](https://github.com/WandererXII/lishogi/tree/master/public/piece). Not served: dark shogi was retired 2026-09. |
| `colored` | Shogi Colored (lishogi koma) | CouchTomato87 | CC BY 4.0 | From lishogi, as above. Not served. |
| `chess` | Shogi Chess (lishogi koma) | peanatsu | CC BY-SA 3.0 | From lishogi, as above. Not served. |

The three shogi folders hold koma images named by their lishogi codes (`0FU`
for sente's pawn, `1OU` for gote's king). Nothing on the site loads them.
