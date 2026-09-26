# Font credits

- `noto-sans-latin.woff2` — Noto Sans variable font, reused from lila's
  self-hosted font bundle. Licensed under the
  [SIL Open Font License 1.1](https://openfontlicense.org/).
- `roboto-latin.20b535fa.woff2` — Roboto, Google. Licensed under the
  [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0).
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
