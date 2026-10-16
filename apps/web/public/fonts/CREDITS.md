# Font credits

- `noto-sans-latin.woff2` — Noto Sans variable font, reused from lila's
  self-hosted font bundle. Licensed under the
  [SIL Open Font License 1.1](https://openfontlicense.org/).
- `roboto-latin.20b535fa.woff2` — Roboto, Google. Licensed under the
  [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0).
- `noto-sans-vietnamese.woff2`, `roboto-vietnamese.woff2`: the Vietnamese
  subsets of the same versions as the latin files above (Noto Sans 2.015,
  Roboto 3.009), downloaded from Google Fonts
  (`fonts.googleapis.com/css2?family=Noto+Sans:wght@100..900&family=Roboto:wght@100..900`,
  the `/* vietnamese */` faces; gstatic `notosans/v42` and `roboto/v49`).
  Same licenses as their latin halves (OFL 1.1 and Apache 2.0).
- `apps/server/assets/fonts/NotoSans-{Regular,Bold}.ttf` — Noto Sans
  (notofonts.github.io), bundled for server-side share-card text rendering
  (the prod container has no system fonts). Also OFL 1.1.
- `apps/server/assets/fonts/NotoSansSC-Bold.otf` — Noto Sans SC Bold, the
  simplified-Chinese subset of Noto Sans CJK (github.com/notofonts/noto-cjk,
  `Sans/SubsetOTF/SC`), bundled so share cards can print Chinese titles.
  Also OFL 1.1.
- The xiangqi piece characters in server-rendered share cards
  (`packages/board-render/src/generated/xiangqi-glyph-paths.ts`) are glyph
  outlines extracted from Noto Sans CJK SC Bold (Google/Adobe), also licensed
  under the SIL Open Font License 1.1. Baked by
  `scripts/bake-xiangqi-glyphs.mjs`.
