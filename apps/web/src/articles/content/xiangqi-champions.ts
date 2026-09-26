import type { Article } from '../types.js';
import type { XiangqiReplaySpec } from '../../xiangqi-replay.js';
import {
  CHAMPIONS,
  championTableRows,
  editionGapSentence,
  xiangqiChampionTimelineSvg,
} from '@mistboard/board-render';

// One champion, one game, in the order they first won the title. The specs below
// were GENERATED from the companion study by scripts/study-chapter-to-article.mjs
// and are baked in: nothing here is fetched at render, and the widget never
// calls the studies API. That means this file IS a second copy of the study's
// moves and annotations, and editing a chapter does not change the article
// until someone re-runs the script. An earlier version of this comment claimed
// the opposite, which is the kind of note that stops anyone checking.
//
// Baked rather than fetched at render: an article is a compiled content module,
// and a runtime fetch would make a published page depend on a study still
// existing and still being readable. Regenerate with:
//   node scripts/study-chapter-to-article.mjs --study ytSzepET --out specs.json

// 1956 · The first national championship
const C_Ue0EgpS7: XiangqiReplaySpec = {
  iccs: "h2e2 h9g7 h0g2 b9c7 i0h0 i9h9 c3c4 g6g5 b2b4 c9e7 b0c2 b7b5 h0h6 h7i7 h6h9 g7h9 a0a1 d9e8 a1h1 h9g7 g3g4 a9d9 g4g5 d9d2 g2e1 e7g5 h1h7 b5b7 e2g2 e6e5 h7h6 g5e7 h6c6 c7e6 c0e2 d2d5 b4b6 e6g5 e2g4 e5e4 c4c5 e7c5 b6b5 c5e7 b5g5 e7g5 c6g6 g9e7 e3e4 d5c5 g4e2 i7i3 g6b6 b7c7 b6b3 i3i0 b3i3 i0h0 i3h3 h0i0 c2b4 c5b5 e1c2 g7e6 g2g1 i0i4 g1b1 b5c5 h3h4 c7c2 h4i4 e6d4 i4i3 c2b2 i3d3 c5c1 b1b0 d4e6 e4e5 e6c5 d3e3 c1b1 b0c0 b2d2 b4d5 d2a2 c0c4 b1d1 d0e1 a2a0 d5c7 d1d7 e3b3 c5e4 b3b9 e8d9 c7d5 f9e8 c4d4 d7a7 b9b3 g5i7 b3e3 e4g5 e5f5 a7b7 e1d2 g5h7 d5e7 i7g9 e7c8 e9f9 d4f4 e8f7 e3e9 f9f8 c8e7 b7b4 e2c4 b4b0 e0e1 b0f0 e9f9 f8e8 f4e4 e8e7 f5e5",
  red: "Li Yiting",
  black: "Yang Guanlin",
  event: "1956 National Individual Championship",
  resultText: "1-0",
  annotations: {
    byPly: {
      "98": {
        glyph: "??",
        note: "blunder: 18.7 win% given up, eval +3.49 after. The engine wanted the line in the sibling branch.",
        line: "e4c5 c4d4 d7b7 b9d9 e9e8 e1d2 c5b3 d4b4 b3c1 e0d0 c1a2 b4b6 a2b0 e2c0 b0c2 d0d1 c2b4 d5b4 b7b6 d9d4 e8e9 d1e1 b6b5 d4e4 a0b0 c0e2 f9e8 b4c2",
        "lineEval": "±"
      },
      "99": {
        glyph: "!",
        note: "Great: the only move that punishes the error before it, and every alternative is at least a mistake worse.",
      },
    },
  },
};

// 1960 · Hu Ronghua, aged fifteen
const C_0BM6N4j4: XiangqiReplaySpec = {
  iccs: "h2e2 h9g7 h0g2 g6g5 i0h0 i9h9 c3c4 h7h3 b0c2 c9e7 b2b9 a9b9 a0b0 b7b3 c2d4 f9e8 c4c5 b9b4 d4b3 h3e3 d0e1 h9h0 g2h0 g7f5 b0b1 e3c3 c5c6 e6e5 e2g2 f5g3 h0i2 g3e4 c0e2 c3c5 g2h2 c5b5 h2h4 e4c3 h4h9 e8f9 b1b2 b5b3 i2g3 g5g4 e2g4 c3e4 g3e2 b4c4 b2b0 b3e3 c6d6 e4c3 h9h6 f9e8 h6e6 c3a2 b0d0 e5e4 e6e3 e4e3 e2g3 c4g4 d0d2 a2c1 d2d1 c1a2 d1d2 a2c1 d2d1 c1b3 g3f1 e3e2 d1d3 b3c1 d3d1 c1a2 g0i2 g4g2 i3i4 g2i2 f1g3 i2g2 g3e4 g2g4 d1a1 g4e4 a1a2 e7g5 d6c6 e8f7 e0d0 a6a5 a2c2 e2e1 f0e1 e4i4 c2e2 f7e8 e2e5 i4c4 e1d2 c4c6 e5g5 c6a6 g5g4 g9e7 g4e4 i6i5 e4e5 i5i4 e5e4 i4i3 e4e3 a6i6 e3e5 i6d6 d0d1 d6d3 e5a5 e8f7 a5e5 d9e8 e5e7 i3h3 a3a4 h3g3 a4a5 g3f3 e7e2 d3d5 a5a6 d5d6 a6a7 d6d7 a7a8 d7d8 a8a9 d8d9 e2i2 d9a9 i2i9 e8f9 i9i4 a9a1 d1d0 f3f2 i4f4 f2f1 f4f7 f9e8 f7b7 e9d9 b7b4 a1a7 b4f4 a7d7",
  red: "Yang Guanlin",
  black: "Hu Ronghua",
  event: "1960 National Individual Championship",
  perspective: "black",
  resultText: "0-1",
  annotations: {
    byPly: {
      "17": {
        glyph: "?!",
        note: "inaccuracy: 7.2 win% given up, eval -0.74 after. The engine wanted the line in the sibling branch.",
        line: "d4e6 g7e6 e2e6 b3b4 e6a6 b4b5 c4c5 b5b4 a6a9 b4e4 e3e4 b9a9 g2i1 h3h4 b0b3 c6c5 h0h3 a9a6 g0e2 a6h6 b3e3 c5c4 i1g2",
        "lineEval": "="
      },
      "28": {
        glyph: "?!",
        note: "inaccuracy: 7.7 win% given up, eval +0.39 after. The engine wanted the line in the sibling branch.",
        line: "f5d4 h0g2 d4b3 g2e3 c3g3 b1b2 b4f4 e2e6 b3d4 e6a6 d4f3 e3f1 g3a3 b2a2 a3b3 a2f2 b3b5 a6a9 e7c9 a9a3 b5e5 a3e3 g5g4 f1h2 g4g3 g0e2 c9e7 c6d6 f4f7 e2g0 f7f6 d6e6",
        "lineEval": "⩱"
      },
      "29": {
        glyph: "?!",
        note: "inaccuracy: 5.3 win% given up, eval -0.19 after. The engine wanted the line in the sibling branch.",
        line: "e2h2 e5e4 h2h1 e4e3 h1f1 b4c4 b1c1 f5g3 h0g2 e3d3 f1g1 g3e4 c1c2 c4c6 c2e2 e4g3 e2e5 c3a3 c0e2 d3c3 g1g3 c3b3 g2e3 a3e3 e5e3 b3b2 e1d0 a6a5 i3i4",
        "lineEval": "⩲"
      },
      "37": {
        glyph: "?!",
        note: "inaccuracy: 5.8 win% given up, eval -0.73 after. The engine wanted the line in the sibling branch.",
        line: "h2h9 g9i7 i2g1 e4c5 g1f3 e5e4 f3d2 e4e3 d2c4 e3d3 h9h5 b5b7 h5h3 d3c3 b1d1 b7b3 h3b3 c3b3 d1d5 a6a5 c6d6 b4b5 c4d2",
        "lineEval": "="
      },
      "45": {
        glyph: "?",
        note: "mistake: 10.9 win% given up, eval -1.59 after. The engine wanted the line in the sibling branch.",
        line: "g3f1 b4b5 e2g4 b3i3 b2b5 c3b5 a3a4 b5d4 c6b6 d9e8 h9h1 i6i5 h1i1 i3d3 f1h2 e5e4 g4i2 d3e3 e1f2 e4f4 i1i5 d4b3 i5i4 b3d2 e0e1 e3e5 e1d1 d2b1 b6c6",
        "lineEval": "⩱"
      },
      "46": {
        glyph: "!",
        note: "Great: the only move that punishes the error before it, and every alternative is at least a mistake worse.",
      },
      "48": {
        glyph: "!!",
        note: "Brilliant: a piece (cannon) offered and not recovered, worth 4.5, confirmed along the engine's own line.",
      },
      "66": {
        glyph: "?",
        note: "mistake: 14.1 win% given up, eval -0.81 after. The engine wanted the line in the sibling branch.",
        line: "c1b3 g3f1 e3e2 d1d3 b3c1 d3d1 c1a2 g0i2 g4g2 f1e3 g2i2 e3d5 i2i3 d1a1 e2e1 f0e1 i3i0 e1f0 i0i2 a1d1 i2i3 d1f1 i3a3 f1a1 i6i5 f0e1 a3a5 e0f0",
        "lineEval": "∓"
      },
      "67": {
        glyph: "?",
        note: "mistake: 13.6 win% given up, eval -2.43 after. The engine wanted the line in the sibling branch.",
        line: "d1a1 a2c3 a1c1 c3b5 c1c5 b5a3 c5c3 a3c4 g0e2 e3e2 g3e2 c4d6 c3c6 d6e4 c6a6 g4g2 a6a2 e4g5 e2c1 g2g3 a2i2 g3a3 i3i4 e8f7 i4i5",
        "lineEval": "⩱"
      },
      "93": {
        glyph: "?!",
        note: "inaccuracy: 6.2 win% given up, eval -2.09 after. The engine wanted the line in the sibling branch.",
        line: "c6c7 e2e1 f0e1 e4e1 a2d2 d9e8 d2b2 e9f9 b2b9 f9f8 b9g9 e1e3 g9i9 g5i7 c7c8 e3a3 i9i7 a3a0 d0d1",
        "lineEval": "∓"
      },
      "96": {
        glyph: "?",
        note: "mistake: 12.4 win% given up, eval -0.95 after. The engine wanted the line in the sibling branch.",
        line: "e4e1 c2c5 e1e3 c5d5 d9e8 d5a5 e8f9 a5d5 e3e4 d5d9 e9e8 d9d6 e4i4 a3a4 i6i5 a4a5 i4c4 a5b5 i5i4 d6d8 e8e9 d8d9 e9e8 b5b6 i4h4 d9d8 e8e9 d8d9 e9e8 d9d3 g9e7",
        "lineEval": "∓"
      },
      "103": {
        glyph: "?!",
        note: "inaccuracy: 7.3 win% given up, eval -1.38 after. The engine wanted the line in the sibling branch.",
        line: "e5a5 g9e7 a3a4 c6c4 a5a6 i6i5 a4a5 i5i4 a5b5 i4h4 a6e6 h4g4 b5b6 g4f4 d0e0 c4c0 e0e1 c0d0 e6d6 f4e4 b6c6 d0c0 e1f1 c0c3 d6e6",
        "lineEval": "⩱"
      },
      "105": {
        glyph: "?!",
        note: "inaccuracy: 5.2 win% given up, eval -2.20 after. The engine wanted the line in the sibling branch.",
        line: "g5g9 e8f9 g9g2 a6d6 g2i2 d9e8 d0d1 e8f7 i2f2 d6d3 f2f7 d3a3 f7f6 a3a1 d1d0 a1i1 f6a6 i1i5 d0d1 f9e8 a6a9 e8d9 a9a6 i5i1 d1d0 i1i0 d0d1 i0i5 a6e6 d9e8 d1e1",
        "lineEval": "∓"
      },
      "130": {
        glyph: "?!",
        note: "inaccuracy: 7 win% given up, eval -2.60 after. The engine wanted the line in the sibling branch.",
        line: "f3e3 e2f2 d3d5 a5a6 e3d3 d2e1 e8f9 e1f0 f7e8 f0e1 d3e3 e1d2 d5d6 a6a7 d6d7 a7a8 d7d8 a8a9 d8d9",
        "lineEval": "−+"
      },
      "131": {
        glyph: "?!",
        note: "inaccuracy: 6.2 win% given up, eval -3.51 after. The engine wanted the line in the sibling branch.",
        line: "a5a6 d5d6 a6a7 d6d7 a7a8 d7d8 a8a9 d8d9 e2h2 f3e3 a9b9 d9b9 h2h9 e8f9 h9h3 b9b3 h3h4 e3d3 h4e4 f9e8",
        "lineEval": "∓"
      },
      "151": {
        glyph: "??",
        note: "blunder: 15.3 win% given up, eval mate in 7 after. The engine wanted the line in the sibling branch.",
        line: "f7f3 a1a7 d0d1 a7b7 f3e3 b7f7 e3c3 f7d7 c3e3 d7d6 e3a3 e9d9 a3a9 d9d8",
        "lineEval": "−+"
      },
    },
  },
};

// 1965 · The champion Hu could not shake
const C_kkN9Bwhq: XiangqiReplaySpec = {
  iccs: "h2e2 b9c7 h0g2 h9g7 i0h0 i9h9 g3g4 c6c5 b0a2 c9e7 b2b6 g6g5 g4g5 e7g5 b6c6 a9b9 a0b0 b7b3 c3c4 c5c4 h0h4 g7f5 a2c1 c4c3 h4c4 g9e7 c6c3 b3e3 e2e6 c7e6 b0b9 h7g7 b9b2 g7g2 b2g2 e6d4 g2d2 e3e6 c4d4 f5d4 d2d4 h9h3 c3c4 h3e3 d0e1 e3c3 e0d0 c3c1 d4d9 e9e8 c0e2 c1c3 d9d6 e6e4 i3i4 a6a5 c4c6 c3a3 c6i6 e8f8 d6d5 f9e8 i4i5 f8f9 i6i9 a5a4 d5d4 e4e5 i5i6 e5c5 i6h6 c5c9 i9i4 a3a0 d0d1 a4a3 d4f4 f9e9 f4a4 c9d9 i4e4 e9f9 e1f2 a0f0 a4a3 f0f1 d1d0 e8d7 d0e0 f1f2 a3a9 f2f0 e0e1 f0f1 e1e0 d9c9 h6g6 f1f5 g6g7 f5f0 e0e1 f0f8 a9b9 d7e8 b9b5 c9c7 b5b9 c7c9 e4h4 c9e9 h4h9 e7c9 b9c9 e8d9 h9e9 f9e9 c9c5 g5i7 c5e5 d9e8 e2g4 i7g9 g0i2 e9d9 e5d5 d9e9 d5b5 e9d9 g4e2 d9e9 e2g0 e9d9 e1e0 g9i7 i2g4 i7g9 b5d5 d9e9 d5a5 e9d9 a5b5 g9i7 b5d5 d9e9 d5d7 i7g9 g7f7 f8i8 d7d8 i8h8 d8d5 h8h7 f7f8 h7e7 e0d0 g9i7 d5b5 e7d7 d0e0 d7e7 e0d0 e7d7 d0e0 d7e7 e0d0 e7d7 d0e0 d7e7 e0d0 e8d9 g0e2 e7d7 d0e0 d7e7 b5h5 i7g9 h5h9 e7g7 h9h8 g7e7 h8g8 g9i7 g8h8",
  red: "Yang Guanlin",
  black: "Hu Ronghua",
  event: "1965 National Individual Championship",
  resultText: "1-0",
  annotations: {
    byPly: {
      "25": {
        glyph: "?!",
        note: "inaccuracy: 6.3 win% given up, eval -0.99 after. The engine wanted the line in the sibling branch.",
        line: "c1b3 g5e7 h4h3 b9b4 b0b1 c3b3 h3h5 f5d4 b1c1 b3b2 g2f4 b2c2 c1d1 d4e2 f4d5 b4c4 g0e2 c4c6 d5f6 c6c3",
        "lineEval": "="
      },
      "26": {
        glyph: "??",
        note: "blunder: 22.7 win% given up, eval +1.53 after. The engine wanted the line in the sibling branch.",
        line: "h7g7 c1b3 c3b3 c4f4 b9b5 g2h4 g7g0 f0e1 g5e7 f4f5 b5b4 h4g2 g0i0 e2d2 h9h0 f5f0 h0g0 c0e2 g0g2 f0i0 g2e2 i0f0",
        "lineEval": "∓"
      },
      "33": {
        glyph: "?!",
        note: "inaccuracy: 9.6 win% given up, eval +0.75 after. The engine wanted the line in the sibling branch.",
        line: "b9b6 e6d4 c4d4 f5d4 g2e3 g7g0 f0e1 g0g1 c1d3 h9h0 e1f0 e7c9 d3e1 h0h2 e1g0 h2d2 c3c1",
        "lineEval": "±"
      },
      "80": {
        glyph: "?!",
        note: "inaccuracy: 9.8 win% given up, eval +1.40 after. The engine wanted the line in the sibling branch.",
        line: "a0b0 a4a3 b0b6 a3h3 c9c7 e1d2 c7d7 d1e1 e7c9 i4i9 d7e7 e1d1 e7c7 i9i2 c7d7 d1e1 d7a7 h6h7 b6b1 e1e0 g5e7 f0e1 b1b4 e2c0 b4b6 h3h4",
        "lineEval": "⩲"
      },
      "81": {
        glyph: "!",
        note: "Great: the only move that punishes the error before it, and every alternative is at least a mistake worse.",
      },
      "83": {
        glyph: "?",
        note: "mistake: 12.6 win% given up, eval +0.10 after. The engine wanted the line in the sibling branch.",
        line: "e4e8 a0a1 d1d0 a1a0 d0d1 a0c0 e8i8 c0c8 i8i2 c8d8 e1d2 a3b3 d1d0 d8d6 h6h7 d6f6 a4d4 f6f0 d0d1 f9e9 h7g7 f0f1 d1d0 f1f4 d4d7 f4f0 d0d1 e7c5 d1e1 f0g0 d7d9 e9d9",
        "lineEval": "±"
      },
      "122": {
        glyph: "?!",
        note: "inaccuracy: 5.4 win% given up, eval +1.83 after. The engine wanted the line in the sibling branch.",
        line: "i7g9 e5b5 e9d9 b5b9 d9d8 b9b6 d8d9 e1e0 g9i7 b6d6 d9e9 d6a6 e9d9 a6a9 d9d8 a9a3 d8d9 a3d3 d9e9 d3d7 e9f9 d7b7 e8d9 b7b6 f8e8 g0e2 e8e7 b6f6 f9e9 g7f7",
        "lineEval": "±"
      },
      "129": {
        glyph: "?!",
        note: "inaccuracy: 5.4 win% given up, eval +1.65 after. The engine wanted the line in the sibling branch.",
        line: "e1e0 f8h8 i2g0 h8f8 b5b9 d9d8 b9b8 d8d9 b8b5 g9i7 b5d5 d9e9 d5d7 e9f9 d7a7 e8d9 a7a9 f8d8 a9a5 d8e8 g0e2",
        "lineEval": "±"
      },
      "130": {
        glyph: "?!",
        note: "inaccuracy: 7.2 win% given up, eval +2.56 after. The engine wanted the line in the sibling branch.",
        line: "g9i7 b5b9 d9d8 b9b2 d8d9 e2g4 i7g9 b2b9 d9d8 b9b5 d8d9 e1e0 g9i7 b5b2",
        "lineEval": "±"
      },
      "146": {
        glyph: "?!",
        note: "inaccuracy: 8.6 win% given up, eval +4.82 after. The engine wanted the line in the sibling branch.",
        line: "e9f9 d7a7 e8d9 a7a5 f8e8 g0e2 e8e7 a5f5 f9e9 g7f7 e7e6 f5b5 d9e8 b5b9 e8d9 b9b8 e6e8 b8b5 e8g8 b5e5",
        "lineEval": "±"
      },
    },
  },
};

// 1980 · Liu Dahua opens the summer
const C_H4ovjgj7: XiangqiReplaySpec = {
  iccs: "h2e2 h9g7 h0g2 i9h9 c3c4 g6g5 b0c2 b9c7 b2b4 g7h5 g3g4 g5g4 b4g4 g9e7 e2d2 a9b9 a0b0 h7g7 g4d4 h5g3 d4g4 h9h5 g0e2 c6c5 c4c5 h5c5 c2d4 b7b2 i0i1 g3e2 c0e2 g7g2 d2g2 b2g2 b0b9 c7b9 i1f1 c5h5 f1f2 g2g1 d4f5 d9e8 e3e4 b9c7 f2f3 g1i1 e2g0 i1i0 f5d6 e8d7 g4i4 i0h0 f3g3 i6i5 i4g4 h5g5 g3h3 h0i0 h3h0 i0i1 h0h1 i1i0 g4g1 g5d5 g1g6 d5g5 h1h0 i0i1 g6i6 c7d5 h0h6 d5f4 i6e6 f4e6 h6e6 g5g0 e6h6 g0g3 f0e1 i1i0 e4e5 g3g0 e1f0 i0f0 d0e1 f0f8 e1f0 f9e8 h6i6 g0g3 i6i5 g3a3 f0e1 f8f9 e5e6 a3e3 e6f6 e3h3 f6e6 e9d9 d6b5 e8f7 e0d0 h3e3 e6d6 d7e8 e1d2 d9e9 d6c6 e3d3 d0d1 a6a5 b5d6 a5a4 i5i6 f9g9 i3i4 a4b4 d6f5 b4b3 i6d6 d3i3 f5h6 b3c3 c6c7 c3c2 h6g8 e9f9 d6c6 c2b2 c7c8 i3i1 d1d0 i1g1 g8i7 g1g7 i7h5 g7g5 h5i7 g5d5 d0d1 f9e9 d1e1 d5d2 i4i5 d2d5 i5i6 e9d9 i7g6 g9e9 c6f6 e8d7 e1f1 e9f9 g6f8 f7e8",
  red: "Li Laiqun",
  black: "Liu Dahua",
  event: "1980 National Individual Championship",
  perspective: "black",
  resultText: "0-1",
  annotations: {
    byPly: {
      "47": {
        glyph: "?!",
        note: "inaccuracy: 5.4 win% given up, eval -1.26 after. The engine wanted the line in the sibling branch.",
        line: "g4i4 i1g1 i4g4 c7d5 g4g6 d5b4 f3b3 h5f5 b3b4 f5f6 g6g3 f6f3 g3g6 f3e3 g6a6 e3e2 f0e1 e8d9 e0f0 f9e8 a6i6 g1g2",
        "lineEval": "⩱"
      },
      "53": {
        glyph: "?!",
        note: "inaccuracy: 8.6 win% given up, eval -3.41 after. The engine wanted the line in the sibling branch.",
        line: "i4g4 h5g5 g4g3 c7d5 d0e1 f9e8 d6b7 d5b4 f3b3 g5g4 b7a9 h0h8 g0i2 g4e4 g3g2 e4d4 b3h3 h8g8 h3h9 e8f9 a9c8 g8d8 h9h8 e9d9 g2d2 b4a2 d2b2 d4b4 h8h9 d9e9 h9h8 b4b2",
        "lineEval": "∓"
      },
      "54": {
        glyph: "?",
        note: "mistake: 11.8 win% given up, eval -1.81 after. The engine wanted the line in the sibling branch.",
        line: "h0h4 g3g6 i6i5 g6e6 i5i4 d6b7 c7d5 e6e5 h5e5 e4e5 d5e3 i3i4 h4e4 d0e1 e3g4 e1f2 g4e5 b7d6 e4f4 f0e1 e5d3 i4i5 f4f8 e0d0 f8a8 i5i6 a8a3 i6h6 c9a7 h6g6 a3a0 g0e2",
        "lineEval": "−+"
      },
      "57": {
        glyph: "?!",
        note: "inaccuracy: 5.1 win% given up, eval -2.79 after. The engine wanted the line in the sibling branch.",
        line: "d0e1 c7d5 e4e5 g5e5 g4g8 e5e3 g3e3 d5e3 a3a4 f9e8 g8i8 h0h4 i8i6 e3g4 d6b5 e6e5 b5d6 g4h2 i6a6 h2g0 e0d0 g0h2 a6a9 c9a7",
        "lineEval": "∓"
      },
      "58": {
        glyph: "?!",
        note: "inaccuracy: 8.7 win% given up, eval -1.67 after. The engine wanted the line in the sibling branch.",
        line: "h0f0 e0f0 g5g4 g0e2 g4g2 h3h5 g2e2 d6b5 c7a8 h5d5 e2f2 f0e0 f2b2 b5d4 b2i2 d4b5 i2i0 e0e1 i0i3 d5d7 f9e8 d7d6 i3e3 e1f1 e3b3 d6a6 b3b5 a6a8 b5f5 f1e1",
        "lineEval": "−+"
      },
      "64": {
        glyph: "?",
        note: "mistake: 11.3 win% given up, eval -0.99 after. The engine wanted the line in the sibling branch.",
        line: "i0f0 e0f0 g5d5 f0e0 d5d6 h1h3 d6d4 h3e3 c7d5 g0e2 d4b4 e3d3 d5f6 g1e1 f6e4 e1e4 b4e4 e0e1 e6e5 d3h3 e4f4 e1e0 e5e4 e2c0 d7e8",
        "lineEval": "∓"
      },
      "71": {
        glyph: "?!",
        note: "inaccuracy: 8.9 win% given up, eval -1.08 after. The engine wanted the line in the sibling branch.",
        line: "i6i9 g5g9 h0h1 g9i9 h1i1 d5e3 i1g1 i9h9 e4e5 e6e5 d6f7 e9d9 f7e5 f9e8 g1g3 e3f1 g3g2 h9h3 f0e1 f1g3 e1f0 g3e4 g2e2",
        "lineEval": "="
      },
      "72": {
        glyph: "?!",
        note: "inaccuracy: 7.9 win% given up, eval -0.21 after. The engine wanted the line in the sibling branch.",
        line: "g5g0 e4e5 d5c3 i6i9 g0g9 i9h9 c3e2 f0e1 e2d4 e1d2 i1c1 d0e1 c1c8 h6h8 c8e8 a3a4 e9d9 e5d5 e8e9 h9f9 g9f9",
        "lineEval": "∓"
      },
      "73": {
        glyph: "?",
        note: "mistake: 13.4 win% given up, eval -1.72 after. The engine wanted the line in the sibling branch.",
        line: "h6h4 g5g6 i6i9 g6g9 i9i6 g9i9 i6f6 f4g2 h4g4 g2e3 g4g1 i1i0 f6h6 f9e8 g1g6 i9g9 g6g9 e7g9 h6h9 g9i7 h9c9",
        "lineEval": "="
      },
      "81": {
        glyph: "?!",
        note: "inaccuracy: 8 win% given up, eval -2.24 after. The engine wanted the line in the sibling branch.",
        line: "e1d2 g3i3 d6c4 i0g0 e4e5 g0g9 h6a6 i3i0 e0e1 i0i1 e1e0 f9e8 a6i6 i1i4 c4d6 i4i0 e0e1 i0d0 d6e4 d0i0 e5e6 e9d9 e6d6 i0i1 e1e0 i1i4 e4f6 i4d4 d6d7 e8d7 i6i5 d4d2",
        "lineEval": "∓"
      },
      "88": {
        glyph: "?!",
        note: "inaccuracy: 5.2 win% given up, eval -2.00 after. The engine wanted the line in the sibling branch.",
        line: "g0g5 e5e6 f8e8 h6f6 g5e5 f0e1 e8e6 e0f0 f9e8 e1d2 e5e2 d6b7 e6e4 f6f4 e4e3 f4f3 e3e5 f3f5 e7g9 b7a9 e2e3 a9c8 e9d9 f0f1 g9e7",
        "lineEval": "−+"
      },
      "102": {
        glyph: "?",
        note: "mistake: 11.7 win% given up, eval -0.48 after. The engine wanted the line in the sibling branch.",
        line: "d9e9 b5c7 h3c3 c7b5 c3e3 e6d6 e3d3 i3i4 a6a5 i5h5 a5a4 i4i5 a4a3 i5i6 a3b3 i6i7 b3b2 i7h7 d3g3 b5d4 b2b1 h7h8 e8f7 d6d7 g3g0 e1f0 g0f0 e0e1 f0f1 e1e2 f1f2 e2e1",
        "lineEval": "∓"
      },
      "103": {
        glyph: "?",
        note: "mistake: 12.9 win% given up, eval -1.96 after. The engine wanted the line in the sibling branch.",
        line: "i5d5 h3h0 e1f0 h0f0 e0e1 f0f1 e1e0 f7e8 b5c7 d9e9 c7a6 f1b1 a6c7 b1i1 e6d6 i1i3 c7a6 f9f7 a6c5 e9f9 e0d0 i3i0 d0d1 i0b0 c5d3 b0g0 d3c5 g0g6",
        "lineEval": "⩱"
      },
      "115": {
        glyph: "?",
        note: "mistake: 10.5 win% given up, eval -2.99 after. The engine wanted the line in the sibling branch.",
        line: "d6c8 d3d8 c8b6 a4a3 i5i6 d8b8 i3i4 a3b3 d1e1 b3c3 e1e0 c3c2 d2e1 c2c1 e1f0 f9f8 f0e1 e7c5 i4i5 e8d9 i6e6 f8e8 e0f0",
        "lineEval": "∓"
      },
    },
  },
};

// 1980 · And then Yang Guanlin
const C_nj9VX8BK: XiangqiReplaySpec = {
  iccs: "h2e2 h9g7 h0g2 g6g5 c3c4 b9c7 b0c2 i9h9 i0i1 a9a8 i1f1 a8d8 b2a2 b7b3 a0b0 b3g3 g0i2 g3h3 f1f4 d8d1 f0e1 h7i7 c2d4 h3h0 g2h4 d1d3 b0b8 f9e8 e2g2 g7h5 a2c2 g9e7 d4c6 g5g4 f4g4 h5f6 g4g7 i7i8 b8b7 h9h4 b7c7 h0i0 g2f2 h4h0 f2f0 i8f8 g7g0 h0g0 i2g0 f8f0 e1f0 d3e3 c2e2 f6g4 e0e1 e3c3 e2e7 c9e7 c6e7 g4e5 e7c8 e9f9 c7h7 e5d3 e1d1 d3f2 d1e1 c3c1 e1e2 f2h1",
  red: "Yang Guanlin",
  black: "Liu Dahua",
  event: "1980 National Individual Championship",
  perspective: "black",
  resultText: "0-1",
  annotations: {
    byPly: {
      "13": {
        glyph: "?!",
        note: "inaccuracy: 5.3 win% given up, eval -0.53 after. The engine wanted the line in the sibling branch.",
        line: "a0a1 b7b3 a1d1 d8d1 f1d1 b3g3 g0i2 g9e7 c2b4 g7f5 b4c6 g5g4 c6d4 f5h4 d4f5 h4g2 d1h1 g2e3 f5e3 h7h3 e3g4 c7d5 e2e3 d5e3 g4e3 g3g5 b2e2 f9e8 a3a4 h9h6",
        "lineEval": "="
      },
      "18": {
        glyph: "?!",
        note: "inaccuracy: 6.5 win% given up, eval +0.04 after. The engine wanted the line in the sibling branch.",
        line: "g9e7 e3e4 d8d3 b0b7 g7h5 e4e5 e6e5 b7b5 c6c5 b5c5 e5e4 c5e5 d3c3 e5e4 f9e8 c2e3 c3c0 e4e7 c9e7 e2e7 e8f7 e7e5 g5g4 f1f7 h5g7",
        "lineEval": "⩱"
      },
      "22": {
        glyph: "?!",
        note: "inaccuracy: 7.3 win% given up, eval +0.97 after. The engine wanted the line in the sibling branch.",
        line: "g9e7 c2d4 h3a3 b0b3 a3a4 b3b4 a4a3 a2d2 h7h0 g2h0 h9h0 f4f0 h0f0 e0f0 d1c1 d2c2 a3a0 b4b0 a0c0 c2c0 c1c4 e2c2 c4d4 c2c7",
        "lineEval": "="
      },
      "25": {
        glyph: "?!",
        note: "inaccuracy: 9.5 win% given up, eval +0.04 after. The engine wanted the line in the sibling branch.",
        line: "a2d2 d1c1 d2c2 c1d1 c2c6 c9e7 b0b7 h0i0 g2h4 i7i3 d4f3 d1d7 e2h2 g7h5 h4f5 i3e3 c0e2",
        "lineEval": "±"
      },
      "26": {
        glyph: "?!",
        note: "inaccuracy: 8.7 win% given up, eval +1.00 after. The engine wanted the line in the sibling branch.",
        line: "i7i3 b0b7 i3i4 h4g2 i4d4 b7c7 g9e7 a2a6 f9e8 a6a9 d4d7 f4h4 h9h4 g2h4 d1b1 h4g6 b1b9 a9a8 b9b3 c7c6 b3d3",
        "lineEval": "="
      },
      "27": {
        glyph: "?!",
        note: "inaccuracy: 9.1 win% given up, eval +0.00 after. The engine wanted the line in the sibling branch.",
        line: "e2g2 g7h5 g2g3 g5g4 f4g4 d3e3 d4f5 e3f3 g4g6 f3d3 b0b2 h5f4 b2b8 f9e8 a2h2 i7h7 h2h7 h0h7 g6g4",
        "lineEval": "⩲"
      },
      "32": {
        glyph: "?!",
        note: "inaccuracy: 6.5 win% given up, eval +0.71 after. The engine wanted the line in the sibling branch.",
        line: "h0i0 c4c5 d3e3 c5c6 e3h3 c6c7 c9e7 e1f2 h3h0 e0e1 h0h1 e1e0 i7c7 c0a2 h1h0 e0e1 h0h1 e1e0 h9h6 d4b5 h1h0 e0e1 h0h1 e1e0",
        "lineEval": "="
      },
      "33": {
        glyph: "??",
        note: "blunder: 20.9 win% given up, eval -1.61 after. The engine wanted the line in the sibling branch.",
        line: "c2c6 i7f7 g2f2 h9g9 f2f7 g5g4 f4g4 g9g4 i2g4 d3d4 b8d8 e8d7 h4g2 h0h2 d8g8 d4c4 c6i6 h5i3 g4e2 c4i4 i6i3 i4i3 g8h8 i3f3 f7d7 h2i2 d7d3 f3f6 h8h9 e9e8",
        "lineEval": "⩲"
      },
      "41": {
        glyph: "?",
        note: "mistake: 14.3 win% given up, eval -3.77 after. The engine wanted the line in the sibling branch.",
        line: "c6e7 c9e7 c2c7 e7c9 c7c6 h0i0 c6f6 d3e3 g2c2 c9a7 b7a7 h4h0 f6f0 i0f0 c2b2 f0f9 g7g0 h0g0 i2g0 e3b3 b2e2 i8i3 a7a6 i3i0 e1f0 b3e3 d0e1 f9f6 e2b2 e8d7 a6a7 f6f5",
        "lineEval": "∓"
      },
    },
  },
};

// 1982 · Li Laiqun takes the title
const C_sUzJIb4U: XiangqiReplaySpec = {
  iccs: "b2e2 b7e7 b0c2 b9c7 a0b0 c6c5 h0i2 h9g7 i0i1 a9a8 i1f1 i9i8 b0b4 a8f8 b4f4 e9e8 g3g4 f8f4 f1f4 i8f8 f4f8 e8f8 h2g2 g9i7 g4g5 i7g5 i2g3 e7d7 g3e4 c7d5 e4c5 d7c7 c3c4 c9a7 c5a6 c7c2 g2c2 d5e3 c2c3 e3c4 a3a4 c4e3 a6b4 g5e7 c3c7 e3f5 e2g2 g6g5 c7g7 g5g4 b4d5 g4g3 g2a2 a7c9 d5f6 h7h6 a2i2 f9e8 i2i6 e8f7 i3i4 f5d4 g7g4 e6e5 d0e1 d4b3 g4h4 b3c1 e0d0 c1d3 c0e2 f8f9 e1d2 h6h8 f0e1 f9e9 i4i5 d3c5 a4a5 h8f8 f6g4 e5e4 a5b5 e4f4 h4f4",
  red: "Li Laiqun",
  black: "Hu Ronghua",
  event: "1982 National Individual Championship",
  resultText: "1-0",
  annotations: {
    byPly: {
      "44": {
        glyph: "??",
        note: "blunder: 23.6 win% given up, eval +2.76 after. The engine wanted the line in the sibling branch.",
        line: "f9e8 e2e1 h7h5 c0e2 e3d5 b4d3 d5c3 d3f4 h5h7 e1f1 e8f7 f4d5 f7e8 d5c3 e6e5 c3d1 f8f9 d1f2 f9e9 f1e1 g5e7 e1e5 h7i7 f2e4 i7i9 e5d5 g6g5 e4d6",
        "lineEval": "="
      },
      "45": {
        glyph: "!",
        note: "Great: the only move that punishes the error before it, and every alternative is at least a mistake worse.",
      },
      "85": {
        glyph: "?!",
        note: "inaccuracy: 5.7 win% given up, eval +2.89 after. The engine wanted the line in the sibling branch.",
        line: "g4h6 c5b3 h6f7 g3g2 i6f6 d9e8 f6f8 e8f7 f8f4 f7e8 f4g4 g2h2 h4h9 e9f9 e2c4 h2g2",
        "lineEval": "+−"
      },
    },
  },
};

// 1986 · Lü Qin arrives
const C_DCNGV4UV: XiangqiReplaySpec = {
  iccs: "h2e2 b9c7 h0g2 h7f7 g3g4 c6c5 b0a2 g9e7 b2c2 a9b9 a0b0 b7b3 i0h0 h9g7 c3c4 c5c4 g4g5 g6g5 h0h4 b3c3 b0b9 c3c0 d0e1 c7b9 e2e6 f9e8 e6e5 b9c7 c2d2 c0c2 d2d1 c4c3 a2c3 i9h9 h4f4 e9f9 e3e4 h9h6 g2e3 c2b2 d1d7 f9f8 d7d2 b2b6 f4f2 b6f6 f2g2 f6f3 e3d1 g7f5 g0i2 f3h3 g2h2 g5g4 d2c2 c7e6 e5d5 e6d4 e4e5 h3e3 c3e2 h6h2 c2h2 f5g3 d1e3 g3e2 e3g4 e2g1 e0d0 g1f3 h2b2 e7g5 b2f2 f7f2 e1f2 d4c2 d0d1 c2a3 e5f5 a3c4 f0e1 c9e7 d1d0 f8f9 i2g0 a6a5 g0e2 c4a3 g4e3 a5a4 d0e0 f9e9 d5d6 f3h4 e2g4 a4b4 i3i4 a3c4 d6d4 h4g6 e3d5 g6f8 f5f6 e7c9 g4e2 c4b2 d4f4 f8h7 f4e4 e9f9 f6g6 h7f8 g6h6 b2d3 h6i6 f8e6 e4e3 b4b3 e1d2 e6d4 f2e1 d3b2 e2g4 b3c3 e3e4 b2d3 d5f6 c3c2 e0d0 d3f4 i4i5 d4e6 i5h5 g5i7 i6i7 e8f7 i7h7 e6c5 e4e3 f4g2 e3f3 f9e9 f3f7 c2c1 g4e2 d9e8 f7g7 c5a4 g7g9 e9d9 f6e8 c9e7 e8c7 d9d8 g9c9 c1b1 c7d5 a4b2 d5e7 b2d3 e7c6 d8e8 h7g7 g2f4 h5h6 f4d5 g7f7 d3f4 e2g4 f4e6 h6g6 e6c7 c9i9 b1c1 i9i1",
  red: "Lü Qin",
  black: "Yu Youhua",
  event: "1986 National Individual Championship",
  resultText: "1-0",
  annotations: {
    byPly: {
      "36": {
        glyph: "?!",
        note: "inaccuracy: 7.9 win% given up, eval +1.11 after. The engine wanted the line in the sibling branch.",
        line: "f7f5 d1c1 c7e6 g2h4 g5g4 f4g4 f5f8 g0e2 f8g8 g4f4 g8i8 c3b5 c2c5 f4g4 h9h5 e3e4 h5g5 g4g5 c5g5 b5d6 i8h8 e1f2 g5h5 c1f1 h5h6 h4g6",
        "lineEval": "="
      },
      "37": {
        glyph: "?!",
        note: "inaccuracy: 9.3 win% given up, eval +0.08 after. The engine wanted the line in the sibling branch.",
        line: "d1d7 f9f8 d7d8 f8f9 f4f6 g7h5 e5f5 f9e9 f5f7 e8f7 c3e4 h9h8 f6i6 h5g7 i6c6 h8d8 c6c7 c2a2 c7e7 d9e8 e7c7 d8b8 c7c9 e8d9 e0d0 f7e8 g2h4 g5g4 h4g6 a2g2 g6e7 b8b0",
        "lineEval": "±"
      },
      "41": {
        glyph: "!!",
        note: "Brilliant: a piece (cannon) offered and not recovered, worth 4.5, confirmed along the engine's own line.",
      },
      "49": {
        glyph: "?!",
        note: "inaccuracy: 5 win% given up, eval -0.75 after. The engine wanted the line in the sibling branch.",
        line: "d2f2 g7f5 f2f5 f7g7 f5f6 h6f6 g2g5 g7g0 g5g0 f3c3 g0g2 e8f7 i3i4 c7b5 g2f2 f6c6 e5f5 f8e8 e4e5 b5d4 f2d2 d4f5 e5f5 e8e9 d2d3 c3c2 e3g4 f7e8 e1f2 c6b6 f5e5 c2c8",
        "lineEval": "="
      },
      "53": {
        glyph: "?!",
        note: "inaccuracy: 9.7 win% given up, eval -1.53 after. The engine wanted the line in the sibling branch.",
        line: "d2f2 h3h0 i2g0 h0i0 e1d0 h6h0 f2f7 e8f7 d1f2 f8f9 d0e1 d9e8 g2g1 h0h4 c3b1 c7b5 a3a4 i0h0 e5e6 f5d4 e6f6 f9e9 g1g5 h4h6 g5f5",
        "lineEval": "⩱"
      },
      "60": {
        glyph: "??",
        note: "blunder: 18 win% given up, eval +0.07 after. The engine wanted the line in the sibling branch.",
        line: "f5g3 c2f2 g4f4 f2f7 e8f7 i2g0 f8e8 d5d7 f4g4 h2g2 e8e9 c3d5 h6d6 d7f7 d9e8 f7f1 d6c6 f1g1 h3a3 g1g3",
        "lineEval": "∓"
      },
      "64": {
        glyph: "!!",
        note: "Brilliant: a piece (cannon) offered and not recovered, worth 2.5, confirmed along the engine's own line.",
      },
      "94": {
        glyph: "?!",
        note: "inaccuracy: 6.4 win% given up, eval +1.39 after. The engine wanted the line in the sibling branch.",
        line: "g5i7 e3d5 e9f9 d6g6 i7g9 g6g4 e8f7 d5f4 a3c2 f5f6 d9e8 g4a4 c2d4 e2g0 f9e9 a4a6 d4c6 e0d0 f3h2 g0i2 h2f3 f6f7 e8f7 a6i6 c6d4 i6i9 e9e8 i3i4",
        "lineEval": "⩲"
      },
      "104": {
        glyph: "?!",
        note: "inaccuracy: 8.5 win% given up, eval +2.45 after. The engine wanted the line in the sibling branch.",
        line: "f8h7 d4b4 e7c9 f6g6 c4e5 g6h6 h7f6 d5b6 f6g4 b6c8 e9f9 h6i6 g5e7 c8d6 e5f3 b4f4 f9e9 d6c8 e9f9 c8b6 e7g9 b6d5 f9e9 e0f0 e8d7",
        "lineEval": "±"
      },
      "107": {
        glyph: "?!",
        note: "inaccuracy: 8.3 win% given up, eval +1.47 after. The engine wanted the line in the sibling branch.",
        line: "d5b4 f8h7 d4e4 e9f9 f6g6 g5e7 g6h6 h7f6 e4h4 f6e4 e0d0 e4g5 h4h5 g5h3 h5h4 e8d7 h6i6 h3f4 e2g4 f4g6 h4h9 b2c4 b4c2 d9e8 h9i9 g6e5 g4e2 c4d6 c2e3 e5g6 i6h6 g6h4",
        "lineEval": "±"
      },
      "111": {
        glyph: "?!",
        note: "inaccuracy: 6 win% given up, eval +1.09 after. The engine wanted the line in the sibling branch.",
        line: "e4f4 f9e9 d5b6 e8f9 b6c8 e9e8 f4f5 b2d3 f5b5 e8f8 f6g6 g5i7 b5f5 f9e8 g6h6 h7i9 c8d6 d3c5 h6i6 i9g8 f5e5",
        "lineEval": "±"
      },
      "130": {
        glyph: "?!",
        note: "inaccuracy: 6.8 win% given up, eval +1.73 after. The engine wanted the line in the sibling branch.",
        line: "c2d2 e1d2 d4b3 e4e0 b3d2 e0f0 d2f3 i4i5 e8f7 i5h5 c9e7 i6h6 d9e8 f6d5 d3c1 d5c3 c1d3 c3b5 d3e1 b5d6 e1g2 f0f1 g2i3 h5g5 e7g5 d6e8 i3g4 e8d6 g4h2 f1f0 f9e9 d6f7",
        "lineEval": "±"
      },
    },
  },
};

// 1989 · Zhao Guorong before the titles
const C_oyo2kgtC: XiangqiReplaySpec = {
  iccs: "c3c4 b7c7 h2e2 g9e7 b0a2 b9a7 a0b0 a9a8 a3a4 a8f8 a2b4 f8f5 h0g2 h9f8 i0i1 i9h9 b0b1 h7g7 b4a6 c7c4 b1c1 h9h4 g3g4 h4g4 c1f1 f5f1 i1f1 f8d7 f1f7 g7g9 e2e6 d9e8 g0e2 g4g3 b2d2 c4g4 f0e1 d7c5 a6c5 c6c5 e2g4 g3g2 c0e2 g2g3 e0f0 e9d9 d2d1 c5c4 f7f4 a7b5 f4d4 d9e9 d4f4 e9d9 f4d4 d9e9 d4c4 c9a7 c4f4 e9d9 f4d4 d9e9 d4f4 e9d9 e1d2 e8d7 f4f9 d9d8 f9f8 d8d9 f8f9 d9d8 d2e1",
  red: "Zhao Guorong",
  black: "Hu Ronghua",
  event: "1989 National Individual Championship",
  resultText: "1-0",
  annotations: {
    byPly: {
      "20": {
        glyph: "?!",
        note: "inaccuracy: 7.7 win% given up, eval +0.70 after. The engine wanted the line in the sibling branch.",
        line: "c7c8 i1f1 h9h5 a4a5 f9e8 b2b5 f5f1 b1f1 h5h4 g3g4 h4g4 g2f4 g4g0 b5b8 g0g4 f4d5 c6c5 c4c5 g4a4 b8a8 a4a5 e2c2 c8c2 f1f8",
        "lineEval": "="
      },
      "58": {
        glyph: "??",
        note: "blunder: 18.4 win% given up, eval +3.76 after. The engine wanted the line in the sibling branch.",
        line: "g3f3 e1f2 c9a7 a4a5 f3f6 e6e5 f6d6 a5b5 d6d1 c4c7 d1d0 f0f1 e9d9 c7e7 g6g5 e7g7 d0d5 e3e4 g9h9 b5b6 h9h4 g4i2 d5d6 g7b7 h4f4 f1e1 d6d1 e1e0 d1d4 b7a7 d4e4 a7a5",
        "lineEval": "±"
      },
      "59": {
        glyph: "!",
        note: "Great: the only move that punishes the error before it, and every alternative is at least a mistake worse.",
      },
    },
  },
};

// 1990 · Xu Yinchuan, also aged fifteen
const C_rhF5YH7d: XiangqiReplaySpec = {
  iccs: "g0e2 g9e7 c3c4 b9a7 b0c2 a9a8 a0a1 g6g5 a1g1 h9f8 h0f1 a8d8 h2i2 h7h8 g3g4 f8h7 b2b6 h8e8 i0h0 d8d5 h0h6 d5b5 b6e6 e8e6 h6e6 b7b6 e6e4 a7c8 e4d4 i9i8 f1d2 c8d6 g1f1 i8g8 c4c5 b5c5 d4f4 f9e8 f4b4 d6c8 d2e4 c5d5 f1h1 g8g7 h1h5 g7f7 d0e1 a6a5 i2h2 h7f6 h5h9 f7f9 h9f9 e9f9 e4g5 f6g4 h2h8 e8f7 g5f7 g4h6 f7h6 b6h6 b4h4 h6h5 c2b4 d5b5 h4d4 b5g5 d4d9 c8e9 e0d0 h5h0 d0d1 g5b5 h8h1 b5b7 b4c6 b7d7 d9d7 e9d7 e1d0 d7b6 e3e4 b6c8 e4e5 c8d6 e5e6 d6e4 c6d8 f9f8 e6e7 e4c3 d1e1 h0d0 e2c4 c3e4 e7f7 f8e8 d8b7 d0d5 h1h2",
  red: "Xu Tianhong",
  black: "Xu Yinchuan",
  event: "1990 National Individual Championship",
  resultText: "1-0",
  annotations: {
    byPly: {
      "28": {
        glyph: "?!",
        note: "inaccuracy: 5.4 win% given up, eval +1.14 after. The engine wanted the line in the sibling branch.",
        line: "f9e8 e4d4 i9f9 g1h1 g5g4 h1h7 f9f1 e2g4 a6a5 g4e2 f1f7 h7h9 f7f9 h9h3 b5f5 f0e1 f5f3 d4h4 f9f4 h4h8 e8f9 h8h5 f3h3 h5h3 d9e8 i2g2 b6b8 h3h5 b8b5 g2g8 f4f3 g8i8",
        "lineEval": "⩲"
      },
      "33": {
        glyph: "?!",
        note: "inaccuracy: 8.2 win% given up, eval +0.32 after. The engine wanted the line in the sibling branch.",
        line: "g1h1 h7f8 g4g5 f8e6 c4c5 e6d4 c5b5 d4b5 h1h5 c6c5 c2d4 c5c4 d4c6 i8c8 i2i6 b5d4 g5g6 d4c6 h5b5 c8b8 g6g7 c6b4 i6i9 e7g9 b5d5",
        "lineEval": "±"
      },
      "34": {
        glyph: "?!",
        note: "inaccuracy: 7 win% given up, eval +1.09 after. The engine wanted the line in the sibling branch.",
        line: "g5g4 e2g4 i8f8 f1h1 h7g5 i2e2 f8f6 d2e4 g5e4 e3e4 d6f5 d4d3 f6d6 d3d6 f5d6 e4e5 b5e5",
        "lineEval": "⩲"
      },
      "56": {
        glyph: "?!",
        note: "inaccuracy: 5.2 win% given up, eval +1.68 after. The engine wanted the line in the sibling branch.",
        line: "f9e9 h2h8 f6g8 h8h5 d5d6 g5e4 d6h6 h5f5 g8f6 g4g5 f6d7 f5d5 e7g5 e4g5 c8e7 d5d1 h6h5 g5e4 b6a6 e1f2 h5f5",
        "lineEval": "±"
      },
      "68": {
        glyph: "?",
        note: "mistake: 12.1 win% given up, eval +3.25 after. The engine wanted the line in the sibling branch.",
        line: "c8d6 h8a8 h5h9 b4d5 d6f5 d4d3 f5g3 e1f2 g3i2 d3d4 i2g1 e0d0 b5b0 a8a9 g1e2 d0e0 e2c1 e0e1 b0b7 d4h4",
        "lineEval": "±"
      },
    },
  },
};

// 1994 · Fourteen years later
const C_z88B1zTk: XiangqiReplaySpec = {
  iccs: "h2e2 h9g7 h0g2 i9h9 i0h0 b9c7 b0a2 g6g5 b2c2 b7b5 h0h6 g7f5 a0b0 a9b9 b0b4 c9e7 a3a4 d9e8 h6h3 c6c5 c2c1 f5g3 e2c2 g3h5 h3h5 c5c4 b4b5 c7b5 c2c4 b5d4 g2f4 d4f3 f0e1 b9b5 c4b4 h7h6 c3c4 h9h7 e1f2 b5e5 c1h1 e5e3 d0e1 e6e5 h1h6 e5e4 f4e6 e3d3 b4e4 d3d6 h6d6 h7h5 d6d0 g5g4 e6c7 g4f4 e4e6 f3d4 e6d6 d4c2 a2c3 h5e5 d0d5 e8d7 c4c5 f4f3 c0e2 f9e8 c7a6 c2a1 d5d3 f3e3 d3d1 a1b3 c5d5 e5h5 a6c7 b3c1 a4a5 h5h0 e1f0 h0h4 f0e1 h4b4 e0f0 b4h4 d1d0 e3f3 a5b5 h4h3 c3e4 h3i3 b5c5 i3i4 e4c3 i4f4 c3d1 i6i5 d5e5 i5i4 c5d5 i4i3 c7b5 i3h3 b5d4 h3g3 d4f5 e7g5 d6f6 f4h4 d1c3 g9e7 c3b5 h4b4 b5d6 g3g2 e5e6 f3f2 e6e7 c1d3 e7e8 d7e8 e1f2 g2g1 f6e6 e9d9 d6e8 d9d8 e8g7",
  red: "Hu Ronghua",
  black: "Liu Dahua",
  event: "1994 National Individual Championship",
  resultText: "1-0",
  annotations: {
    byPly: {
      "23": {
        glyph: "?!",
        note: "inaccuracy: 7.2 win% given up, eval -0.44 after. The engine wanted the line in the sibling branch.",
        line: "c3c4 g3h5 h3f3 c5c4 b4c4 g5g4 f3f5 h5g7 f5f8 c7d5 c4g4 g7h5 e2e6 b9b6 g4d4 d5f6 d4b4 b6e6 b4b5 e6c6 c0e2 c6c2 b5b9 e8d9 c1d1 f9e8",
        "lineEval": "="
      },
      "34": {
        glyph: "?!",
        note: "inaccuracy: 7.9 win% given up, eval -0.48 after. The engine wanted the line in the sibling branch.",
        line: "b9d9 c4b4 h9h8 h5h3 g5g4 b4g4 h8g8 h3f3 g8g4 g0e2 h7f7 f4e6 g4g6 e6c7 d9d1 c3c4 g6h6 c1c3 h6h0 f3f0 h0f0 e0f0",
        "lineEval": "∓"
      },
      "37": {
        glyph: "?!",
        note: "inaccuracy: 7.4 win% given up, eval -1.51 after. The engine wanted the line in the sibling branch.",
        line: "e1f2 e6e5 c1b1 b5c5 b1c1 c5b5 c3c4 e5e4 b4e4 b5f5 f4h3 f5d5 c1f1 d5d3 f1f3 d3e3 g0e2 e3e4 f2e1 g5g4 f3f6 e4e6 f6i6 e6e3 i6a6 g4g3 h3i1 h9h7 a2b4",
        "lineEval": "⩱"
      },
      "38": {
        glyph: "??",
        note: "blunder: 17.5 win% given up, eval +0.43 after. The engine wanted the line in the sibling branch.",
        line: "b5e5 e3e4 e5d5 g0e2 d5d1 e1f2 d1i1 d0e1 i1i0 e1f0 i0i2 f2e1 i2h2 f4h3 h9h7 b4b7 e8d7 b7b2 h2h0 a2b4 h7h8 b4c6 h6c6 h5h8 c6c1 b2b6",
        "lineEval": "∓"
      },
      "44": {
        glyph: "?!",
        note: "inaccuracy: 5.5 win% given up, eval +0.79 after. The engine wanted the line in the sibling branch.",
        line: "e3e5 g0e2 e5f5 h1f1 f5e5 f4g6 e5f5 b4b7 e7c9 b7b9 c9a7 b9a9 f5f6 a2b4 e6e5 f1f3 f6f3 g6e5 f3i3 e1f0 i3b3 b4c6 b3b7 c6d8 b7e7 e5g6 e7d7 d8b9 a7c9 b9c7 e8d9 g6f8",
        "lineEval": "="
      },
      "48": {
        glyph: "?",
        note: "mistake: 10.4 win% given up, eval +1.85 after. The engine wanted the line in the sibling branch.",
        line: "e3b3 e6c7 f3e5 c7d5 e4e3 h6b6 h7h5 b6b3 h5h0 d5e3 h0g0 e1f0 e5d3 f2e1 g0g3 e1d2 g3g1 b3c3 g1b1 f0e1 b1b2",
        "lineEval": "⩲"
      },
      "49": {
        glyph: "?",
        note: "mistake: 13.5 win% given up, eval +0.31 after. The engine wanted the line in the sibling branch.",
        line: "b4b9 a6a5 b9a9 e7c5 e6c5 e9d9 a2b4 d3d6 b4a6 d6b6 a4a5",
        "lineEval": "±"
      },
      "50": {
        glyph: "?",
        note: "mistake: 11.8 win% given up, eval +1.64 after. The engine wanted the line in the sibling branch.",
        line: "f3d2 e0f0 h7f7 e6c5 e9d9 c5a6 d9e9 a6b8 f7f4 h5h3 d3d6 e4e2 d2c0 a2c1 c0e1 c1d3 e1g2 e2g2 f4c4 g0e2 c4c3 g2g0 c3d3 h3d3 d6d3 h6e6 g9i7",
        "lineEval": "="
      },
      "63": {
        glyph: "?!",
        note: "inaccuracy: 5.4 win% given up, eval +1.22 after. The engine wanted the line in the sibling branch.",
        line: "d6e6 f4f3 g0e2 f3f2 e1f2 e5e3 e6c6 e8d7 c7a6 e3i3 d0d2 i3i0 e0e1 f9e8 a6b4 i0i1 e1e0 i1i0 e0e1 c2a1 b4a2 i0i1 e1e0 i1i0 e0e1 i6i5 c3e4 i0i1 e1e0 i1i0 e0e1 i5i4",
        "lineEval": "±"
      },
      "67": {
        glyph: "?",
        note: "mistake: 10.2 win% given up, eval +0.35 after. The engine wanted the line in the sibling branch.",
        line: "g0e2 e5e6 c5c6 e6e3 c3b5 e3e5 c6b6 e5h5 d5d0 h5c5 b6a6 c2d4 a4a5 f9e8 d6h6 d4e6 c7a8 e6g5 h6h2",
        "lineEval": "±"
      },
      "68": {
        glyph: "?",
        note: "mistake: 10.8 win% given up, eval +1.57 after. The engine wanted the line in the sibling branch.",
        line: "e5e6 c5c6 e6e3 c3a2 a6a5 a4a5 e3a3 d5d2 a3a5 d6e6 f9e8 c6d6 e9f9 e6h6 f3e3 a2c1 a5h5 h6g6 h5h6",
        "lineEval": "⩲"
      },
      "70": {
        glyph: "?!",
        note: "inaccuracy: 6 win% given up, eval +2.14 after. The engine wanted the line in the sibling branch.",
        line: "e5e3 d6c6 e7c5 a6b4 c5e7 d5d3 e3e4 b4d5 e7c5 d3d2 e4e6 c6d6 c2a3 d2d0 g9e7 i3i4 e6e5 d6b6 a3c4 b6b3",
        "lineEval": "±"
      },
      "93": {
        glyph: "?!",
        note: "inaccuracy: 5.9 win% given up, eval +1.47 after. The engine wanted the line in the sibling branch.",
        line: "d5c5 i3i0 c7d5 c1e2 d5f6 e2d4 c5d5 d4c2 f0e0 e9f9 b5c5 c2d0 d6d0 e7c5 d5c5 i0h0 d0b0 f3e3 c5d5 g9i7 d5d6",
        "lineEval": "±"
      },
      "113": {
        glyph: "?",
        note: "mistake: 11.9 win% given up, eval +0.30 after. The engine wanted the line in the sibling branch.",
        line: "f6e6 g3g2 c3e4 f3f2 e1f2 h4f4 d0d4 f4f3 d4d2 f3f4 f5g7 c1d3 f0f1 g5i7 g7h5 i7g5 h5g3 e9f9 e5f5 g5i7",
        "lineEval": "±"
      },
      "118": {
        glyph: "?",
        note: "mistake: 13.8 win% given up, eval +1.94 after. The engine wanted the line in the sibling branch.",
        line: "e7c9 d5c5 c1d3 e6e7 f3f2 e7d7 e8d7 d6f7 e9e8 c5c6 b4b1 f7g9 e8e9 f6h6 f2f1 f0f1 b1e1 f1f0 e1h1 g9f7 e9e8 h6f6 d3c1 f7g9 e8e9 d0d4",
        "lineEval": "⩲"
      },
      "121": {
        glyph: "?!",
        note: "inaccuracy: 8.6 win% given up, eval +1.53 after. The engine wanted the line in the sibling branch.",
        line: "e7d7 e8d7 d6f7 e9e8 f7g9 e8f8 g9h7 f8f9 h7g5 f9f8 d5d6 d3e1 d6d7 b4b0 d0e0 b0b6 g5h7 f8f9 d7e7 b6f6 h7f6 g2g1 e0c0 f2f1 f0e0",
        "lineEval": "+−"
      },
      "124": {
        glyph: "?",
        note: "mistake: 12 win% given up, eval +3.54 after. The engine wanted the line in the sibling branch.",
        line: "b4b0 d0e0 b0b1 f5e3 g2f2 e2c0 e9d9 d6f5 b1b2 e0d0 d9e9 c0e2 b2b0 d0c0 f2e2 g0e2 d3c1 f0f1 b0b6",
        "lineEval": "±"
      },
    },
  },
};

// 1995 · Guangdong’s next champion
const C_ZBE8Dp5U: XiangqiReplaySpec = {
  iccs: "h2e2 h9g7 h0g2 b9c7 c3c4 g6g5 b0c2 i9h9 i0i1 c9e7 b2b4 g7f5 i1h1 a9a8 e2d2 h9h8 c0e2 h7g7 h1f1 f5g3 f1f7 g3h5 a0a1 h8f8 a1f1 f8f7 f1f7 d9e8 f7f4 a6a5 f4h4 b7b5 b4b1 g7h7 h4f4 a5a4 a3a4 a8a4 c4c5 a4f4 g2f4 g5g4 c5b5 h5f4 b5b6 c6c5 b6c6 c7b9 b1b8 b9d8 c2d4 f4d3 b8c8 c5c4 c8c4 h7h4 c6d6 e6e5 c4c8 h4d4 d2d4 e8d7 e2g4 e5e4 e3e4 d3f2 e0e1 f2e4 d6d7 d8f7 c8c6 f9e8 d7d8 e7c5 c6e6 e8f9 d8c8 e4f2 g0e2 f2h1 i3i4 h1g3 e6e3 e9e8 d4e4 e8f8 e4f4 f8e8 e1d1 f7d6 c8b8 d6f5 e3e5 f5h6 e5h5 c5e7 d0e1 e7g5 e1f2 g9i7 f0e1 e8e7 e2g0 f9e8 b8c8 e8d7 c8d8 d7e8 g0i2 e8d9 f4b4 e7f7 h5h0 h6i4 h0f0 f7e7 b4b0 g3f1 b0e0 e7f7 e1d0 i4g3 d1e1 i6i5 f0g0",
  red: "Xu Yinchuan",
  black: "Liu Dahua",
  event: "1995 National Individual Championship",
  resultText: "1-0",
  annotations: {
    byPly: {
      "31": {
        glyph: "?!",
        note: "inaccuracy: 5.1 win% given up, eval -0.40 after. The engine wanted the line in the sibling branch.",
        line: "g2h4 a5a4 a3a4 a8a4 h4f5 a4a5 b4b1 b7b3 f5g7 h5g7 b1g1 g7f5 g1f1 g5g4 e2g4 a5d5 d2h2 f5h6 g4e2 h6f7 f1f7 e8f7 f4f7",
        "lineEval": "="
      },
      "53": {
        glyph: "?!",
        note: "inaccuracy: 6.2 win% given up, eval -0.70 after. The engine wanted the line in the sibling branch.",
        line: "c6b6 e6e5 d4f5 d8e6 e2g4 c5c4 f5h6 e5e4 e3e4 d3f2 e0e1 f2e4 d2d1 e7g5 b8a8 e6f4 g0e2 e4c3 d1d6 h7e7 e1f1 e7f7 h6f7 e8f7 d6h6 f4d5 a8a6 d5e3",
        "lineEval": "="
      },
      "54": {
        glyph: "?!",
        note: "inaccuracy: 6.4 win% given up, eval +0.00 after. The engine wanted the line in the sibling branch.",
        line: "g4f4 c6d6 e6e5 d4b5 f4f3 d2a2 f3e3 a2a9 e9d9 d0e1 e5e4 e1d2 d3e5 a9c9 e3d3 c9c5 d9e9 c5d5 e8d7 d2e1 e4e3 d6e6",
        "lineEval": "⩱"
      },
      "104": {
        glyph: "?!",
        note: "inaccuracy: 5.2 win% given up, eval +1.27 after. The engine wanted the line in the sibling branch.",
        line: "e7e8 b8c8 e8e9 g0i2 f9e8 h5h0 h6i4 c8d8 g5e7 f4f5 e8d7 f5e5 e7g5 h0e0 i4h6 d1d0 i7g9 e5d5 g9e7 d5a5 e9f9 a5a9 f9e9 a9d9 d7e8 d9c9",
        "lineEval": "⩲"
      },
      "108": {
        glyph: "?!",
        note: "inaccuracy: 6.8 win% given up, eval +2.14 after. The engine wanted the line in the sibling branch.",
        line: "e7f7 g0i2 f7f8 h5h0 g3e4 h0i0 f8f9 i2g0 e4c3 d1d0 c3d5 f4d4 d5f4 i0i6 h6i4 i6d6 i4h6 d4d7 f9e9 g0e2 h6f7 d6d1 f4e6 d8c8 e6c5 d7c7 f7d6 c8d8 d6e4 c7c6 e9f9 d0e0",
        "lineEval": "±"
      },
      "112": {
        glyph: "?!",
        note: "inaccuracy: 6.9 win% given up, eval +3.07 after. The engine wanted the line in the sibling branch.",
        line: "g3h1 b4b6 h1g3 h5h0 h6f5 h0e0 e7f7 e0f0 g3f1 b6b8 f5g3 b8b2 f7e7 f0g0 e7f7 e1d0 f7e7 g0g1",
        "lineEval": "±"
      },
    },
  },
};

// 1996 · Tao Hanming over Liu Dahua
const C_hLWs5hR5: XiangqiReplaySpec = {
  iccs: "g3g4 h7g7 b2e2 g9e7 h0i2 a9a8 b0c2 a8f8 i0h0 f9e8 a0b0 b9a7 c3c4 f8f5 c2d4 f5d5 h2h4 h9f8 e2d2 d5h5 d4c6 b7d7 c6a7 c9a7 c0e2 i6i5 e3e4 h5f5 h0h3 i9h9 b0b3 g7i7 d0e1 h9h5 d2a2 a7c9 a2a6 f5a5 a6d6 a5d5 d6a6 d7a7 a6a4 d5a5 b3f3 h5h8 h4h6 a5b5 a4a6 b5a5 a6b6 a7a3 f3a3 a5a3 h3a3 h8h6 e4e5 h6h5 a3f3 f8h7 e5f5 e6e5 b6b5 i7i9 c4c5 e5e4 c5d5 h5h6 d5e5 i9h9 b5b7 h7g9 b7b6 h6h2 b6e6 e4d4 f5f6 h2h5 e5f5 g9h7 f6g6 h7f8 e6e5 h5h4 g4g5 f8e6 f5f6 e6c5 f6f7 c5d7 e5e6 d7c5 e6e5 c5d7 e5e6 d7c5 e6e5 h4e4 g5f5 c5d7 f3h3 h9f9 f7f8 d7e5 f5e5 e4e5 g6g7 d4e4 g7g8 e5f5 h3h4 e4f4 i2g1 f4f3 h4h3 f5g5 g1f3 f9f3 h3f3 g5h5 f3f6 h5g5 f6i6 e8f9 i6i9 d9e8 f8f9 e9d9 g8f8 e8f9 i9i6",
  red: "Tao Hanming",
  black: "Liu Dahua",
  event: "1996 National Individual Championship",
  resultText: "1-0",
  annotations: {
    byPly: {
      "54": {
        glyph: "?!",
        note: "inaccuracy: 8.1 win% given up, eval +1.30 after. The engine wanted the line in the sibling branch.",
        line: "h8h6 h3h6 a5a3 h6i6 i7h7 i6i5 h7h3 i5h5 e8f9 b6b0 h3b3 h5f5 a3a0 b0d0 f8h7 f5h5 b3b7 h5h6 h7f8 h6h3 b7a7 h3b3 f8h7 i2g3 g6g5 g4g5 h7g5 g3i4 g5i4 i3i4 a7a4 b3b6",
        "lineEval": "⩲"
      },
      "96": {
        glyph: "??",
        note: "blunder: 26.4 win% given up, eval mate in 1 after. The engine wanted the line in the sibling branch.",
        line: "h4e4 g6f6 d7c5 f3h3 h9f9 f7f8 c5e6 f6e6 e4e6 f8f9 e8f9 g5f5 e6e4 h3h5 i5i4 i2g3 e4h4 i3i4 h4h5 g3h5 d4d3 h5f6 d9e8 e0d0 e9d9 i4i5 d9d8 f5e5",
        "lineEval": "+−"
      },
      "97": {
        glyph: "??",
        note: "blunder: 26.3 win% given up, eval +2.79 after. The engine wanted the line in the sibling branch.",
        line: "e6e5",
        "lineEval": "+−"
      },
      "116": {
        glyph: "?!",
        note: "inaccuracy: 6.2 win% given up, eval +4.05 after.",
      },
      "130": {
        glyph: "?!",
        note: "inaccuracy: 6.6 win% given up, eval mate in 14 after.",
      },
      "131": {
        glyph: "?",
        note: "mistake: 11.1 win% given up, eval +5.22 after.",
      },
    },
  },
};

// 2002 · Yu Youhua, once
const C_HFq9qzB8: XiangqiReplaySpec = {
  iccs: "h2e2 h9g7 h0g2 i9h9 c3c4 g6g5 b0c2 b9c7 b2b4 g7h5 c2d4 c9e7 a0a1 h9h8 i0i1 h5g3 e2c2 a9a8 i1h1 h7g7 g0e2 b7b9 a1f1 b9c9 b4b3 h8h1 f1h1 a8d8 h1h4 g3i2 b3b1 c6c5 b1d1 d8b8 d4f5 g7f7 h4h2 b8b2 f5d6 b2c2 d6c8 e9e8 h2h8 f7f8 d1f1 i2g3 f0e1 g5g4 f1i1 g4f4 i1f1 f4g4 f1i1 c9b9 e0f0 g4f4 i1f1 f4e4 e1f2 g3e2 c0e2 b9b0 e2c0 c2f2 g2h4 c7d5 h4g6 b0b7 d0e1 f2f6 g6f8 f6f8 c8d6 b7d7 h8f8 e8f8 c4c5 d5e3 c0e2 e3g2 f0e0 e4e3 c5c6 e3e2 e1f2 f8e8 c6c7 e2f2 f1b1 f2e2 c7d7 e2e1 e0d0 g2e3 d6b5 e8f8 b5d4 e6e5 b1b4 f8e8 b4b6 e5e4 b6e6 e7g5 d4b3 e3c2 b3c1 e4d4 e6b6 c2a3 b6b2 a3b1",
  red: "Xu Tianhong",
  black: "Yu Youhua",
  event: "2002 National Individual Championship",
  perspective: "black",
  resultText: "0-1",
  annotations: {
    byPly: {
      "49": {
        glyph: "??",
        note: "blunder: 20.2 win% given up, eval -2.88 after. The engine wanted the line in the sibling branch.",
        line: "e1f2 g4f4 c8e7 e8e7 h8f8 c9b9 f8g8 b9b3 g8g7 e7e8 g7c7 b3b0 e0e1 f4f3 c7g7 g3f5 g7g8 e8e9 f1f3 f5d4 f3f4 c2c3 g8d8 d4c2 e1e0 c3e3 d8d2 e3c3",
        "lineEval": "⩱"
      },
      "50": {
        glyph: "??",
        note: "blunder: 24.3 win% given up, eval +0.00 after. The engine wanted the line in the sibling branch.",
        line: "c9b9 e0f0 g4f4 i1f1 f4e4 f1h1 g3f5 f0e0 b9b0 h1h2 f5g3 e3e4 c2c3 c8e7 e8e7 h8f8 c5c4 f8b8 b0a0 b8b0 a0a1 b0b7 c4d4 h2h8",
        "lineEval": "−+"
      },
      "53": {
        glyph: "??",
        note: "blunder: 25.4 win% given up, eval -3.04 after. The engine wanted the line in the sibling branch.",
        line: "e1f2 g4f4 f2e1 f4g4",
        "lineEval": "="
      },
      "54": {
        glyph: "!",
        note: "Great: the only move that punishes the error before it, and every alternative is at least a mistake worse.",
      },
      "66": {
        glyph: "?",
        note: "mistake: 11.6 win% given up, eval -2.36 after. The engine wanted the line in the sibling branch.",
        line: "e4e3 h4g6 c5c4 c8e7 c4c3 g6f8 f2f8 h8f8 e8f8 e7g6 f8e8 g6f4 c3c2 f1e1 c2c1 e1e6 c7b5 f4d5 e3f3 e6e0 b0d0 f0f1 e8d8 d5f4 b5d4 a3a4 d4c2 f4e6 g9e7 e0e7 d8e8",
        "lineEval": "−+"
      },
      "68": {
        glyph: "?",
        note: "mistake: 13.6 win% given up, eval -1.06 after. The engine wanted the line in the sibling branch.",
        line: "b0d0 c4c5 d5e3 h8f8 f2f8 c8d6 e8d8 g6f8 e3d1 f0e0 d0d6 c5d5 d6b6 f8e6 d1c3 e6c7 b6c6 d5d6 c6c0 c7a6 e4e3 a6b4 d8e8 f1i1 c3b1 i1i6 b1d2 e0d0 e3e2 i6e6 e8f8",
        "lineEval": "∓"
      },
      "69": {
        glyph: "?!",
        note: "inaccuracy: 7 win% given up, eval -1.88 after. The engine wanted the line in the sibling branch.",
        line: "e3e4 c5c4 d0e1 f2f6 g6f8 f6f8 h8h5 d5e3 f1f2 e3g4 f0e0 g4f2 e1f2 b7c7 c0e2 c4d4 f2e1 d4e4 h5h6 e6e5 h6a6 f8h8 a6g6",
        "lineEval": "∓"
      },
      "82": {
        glyph: "?",
        note: "mistake: 12.7 win% given up, eval -0.57 after. The engine wanted the line in the sibling branch.",
        line: "e6e5 i3i4 e7g5 e1f2 e4f4 f2e1 f4e4 a3a4 f9e8 e2c0 d7d8 e1f2 e4f4 f2e1 f4e4 c0e2 e8d7 e1f2 e4f4 c5c6 d8d6 c6d6 g5e7 e2c0 e5e4 f2e1 f8e8 f1f2 g2h4 f2a2 h4f5 a2a6",
        "lineEval": "∓"
      },
      "83": {
        glyph: "??",
        note: "blunder: 18 win% given up, eval -2.73 after. The engine wanted the line in the sibling branch.",
        line: "e1f2 e3f3 f1f3 d7a7 c5d5 a7a3 i3i4 d9e8 d6b5 a3e3 e0d0 e8d7 f3g3 e3d3 b5a7 f9e8 a7c6 f8f9 e2g4 d3d2 g4i2 f9e9 d0e0 d2d1 e0e1 d1b1 c6b4 g2h0",
        "lineEval": "⩱"
      },
      "96": {
        glyph: "?",
        note: "mistake: 12.4 win% given up, eval -2.26 after. The engine wanted the line in the sibling branch.",
        line: "e3c2 b1c1 e6e5 d7d8 e8f8 b5d6 c2a3 d8c8 a6a5 d6f5 a3c2 f5e7 e5e4 e7g6 f8f7 g6h8 f7f8 h8i6 e4e3 i6h4 e3e2 h4g6 f8f7 g6e5 f7f8 i3i4",
        "lineEval": "−+"
      },
      "101": {
        glyph: "?!",
        note: "inaccuracy: 5.7 win% given up, eval -3.71 after. The engine wanted the line in the sibling branch.",
        line: "b4b1 e5e4 d4e2 e3c2 e2c1 e4d4 d7c7 a6a5 c7c8 e8e9 c8d8 d9e8 b1e1 c2e1 c1b3 e1c2 d0e0 d4e4 b3a5 c2a3 d8c8",
        "lineEval": "−+"
      },
      "109": {
        glyph: "?",
        note: "mistake: 10.7 win% given up, eval mate in 9 after. The engine wanted the line in the sibling branch.",
        line: "e6d6 c2a3 c1a2 a3c2 a2c1 a6a5 d6d9 a5a4 d9b9 a4b4 b9c9 b4b3 c9d9 e8e9 d7d8 f9e8 d9d4 c2d4 c1d3 d4f3 d3c1 b3c3 c1a2 c3d3",
        "lineEval": "−+"
      },
    },
  },
};

// 2010 · Sun Yongzheng, the year before
const C_fOnPsRe1: XiangqiReplaySpec = {
  iccs: "h2e2 h9g7 h0g2 i9h9 i0h0 g6g5 h0h6 b9c7 c3c4 h7i7 h6g6 i7i8 b2d2 h9h4 b0c2 h4c4 a0b0 a9b9 b0b3 d9e8 e3e4 i8g8 g6f6 b7a7 b3d3 c9e7 g2e3 c4c5 f0e1 a7a8 e4e5 e6e5 d3d4 g7h5 d4d5 e5e4 d5c5 c6c5 e2e4 c7d5 f6f3 d5e3 f3e3 a8c8 d2g2 c8c2 g2g5 g8i8 g3g4 b9b6 e3c3 b6e6 e4e2 i8i3 c3c2 e7g5 c2c5 g9e7 c5c3 i3e3",
  red: "Xu Tianhong",
  black: "Sun Yongzheng",
  event: "2010 National Individual Championship",
  perspective: "black",
  resultText: "0-1",
  annotations: {
    byPly: {
      "34": {
        glyph: "?!",
        note: "inaccuracy: 9.3 win% given up, eval +0.00 after. The engine wanted the line in the sibling branch.",
        line: "c5c3 d2d1 b9b1 e2e5 c7e6 d4d5 a8c8 e1f0 b1b3 d1f1 c3d3 d5d3 b3d3 f1f3 d3d8 f6f4 c8c2 e3c2 d8d3",
        "lineEval": "⩱"
      },
      "35": {
        glyph: "??",
        note: "blunder: 24.6 win% given up, eval -2.92 after. The engine wanted the line in the sibling branch.",
        line: "e3d5 g5g4 d5c7 b9b7 f6f8 b7c7 d4d8 e8d9 f8f7 f9e8 f7f8 e8f9",
        "lineEval": "="
      },
      "36": {
        glyph: "!",
        note: "Great: the only move that punishes the error before it, and every alternative is at least a mistake worse.",
      },
      "55": {
        glyph: "?!",
        note: "inaccuracy: 5.2 win% given up, eval -3.49 after. The engine wanted the line in the sibling branch.",
        line: "g5f5 i3i0 f5f0 i0f0 e0f0 c2b2 c3b3 b2c2 g4g5 h5i7 b3c3 c2b2 c3b3 b2c2 g5h5 i6i5 b3c3 c2b2 c3b3 b2c2 b3b9 e7c9 b9b6 e6e5 b6f6 g9e7 h5i5 i7h9 e1d2",
        "lineEval": "−+"
      },
      "59": {
        glyph: "?!",
        note: "inaccuracy: 5.1 win% given up, eval -4.39 after. The engine wanted the line in the sibling branch.",
        line: "c5b5 h5g3 e1f0 g3e2 c0e2 i3i0 b5b9 e8d9 b9b2 e6e3 d0e1 g5i7 a3a4 i6i5 e2c4 i0i3 b2e2 e3c3 e2e7 f9e8 e7e4 i3e3 e1d2 c3a3 e4e7 i5i4 e7a7 a3a0 e0e1 a0a1 e1e0 a1a4",
        "lineEval": "−+"
      },
    },
  },
};

// 2025 · Wang Yubo, and an empty top
const C_aHRbltmz: XiangqiReplaySpec = {
  iccs: "c3c4 b7c7 h2e2 g9e7 c0a2 b9a7 b0d1 a9b9 h0g2 h7g7 g3g4 b9b5 i0h0 g7g4 g2f4 b5f5 b2b4 h9g7 e2f2 f5b5 a0b0 a6a5 b4b2 i9h9 h0h9 g7h9 b2e2 h9g7 f4e6 g7e6 e2e6 f9e8 e3e4 b5b0 d1b0 a7b5 f2f6 b5d4 e6g6 c6c5 b0d1 c5c4 a2c4 d4c2 c4e2 g4g3 f6i6 c7a7 d1c3 a7a3 e2c0 a5a4 g0e2 a4b4 i6i9 e9f9 c3d5 a3i3 d5f4 f9f8 g6f6 c2e3 f4g6 f8f9 g6h8 f9e9 f6g6 e8d7 g6e6 e7g5 f0e1 e3g2 h8f7 e9e8 f7g5 i3i0 e1f2 i0h0 g5i6 h0h6 i9i8 g3g7 i6h8 e8e9 h8f7 e9e8 e4e5 e8f8 f7g5 g2f4 e6f6 c9e7 g5e4 h6h9 i8i5 f4h3 i5f5 f8e8 e5e6 h9h6 e6d6 e8e9 f6e6 d9e8 d0e1 h3f4 c0a2 g7f7 e2g4 f7i7 e6e5 i7i6 e5a5 b4b3 a5a4 f4g2 g4i2 b3b2 a4a3 g2h4 i2g4 h4g6 f5b5 h6h4 g4i2 h4h5 a3a9 e8f7 b5b6 g6h8 d6d7 h5e5 d7e7 e9d9 e7d7 d9e9 e0d0 i6d6 d7d8 e9f9 b6b9 f9f8 b9b8 f7e8 d8e8 f8e8 b8h8 b2c2 a2c4 c2d2 d0e0 e8d8 h8h1 d6e6 a9a4 e5f5 c4e2 d2e2 e4d6 d8d9 a4d4 d9e9 i2g4 f5f3 h1h2 e2e1 e0e1 f3d3 d6c8 e9d9 h2h5 d3e3 e1d1 e3e5 d4d2 d9d8 h5h0",
  red: "Wang Yubo",
  black: "Su Yilin",
  event: "2025 National Individual Championship",
  resultText: "1-0",
  annotations: {
    byPly: {
      "23": {
        glyph: "?!",
        note: "inaccuracy: 5 win% given up, eval -0.58 after. The engine wanted the line in the sibling branch.",
        line: "f4e6 b5b4 e6c7 b4b0 d1b0 i9i8 h0h6 g6g5 c4c5 e7c5 f2f4 i8c8 c7e6 c5e7 e6g7 g4g7 h6g6 g7h7 b0d1 c6c5 d1f2 c8c6 f4e4 d9e8 g6g5 a7b5 g5h5 h7g7 e4b4 c6e6 h5h3 g7g8",
        "lineEval": "="
      },
      "24": {
        glyph: "?!",
        note: "inaccuracy: 5.1 win% given up, eval -0.02 after. The engine wanted the line in the sibling branch.",
        line: "i9i8 b2e2 i8d8 b0b5 a7b5 d1b2 c7a7 f0e1 b5c3 f4e6 c3e2 g0e2 g7e6 e2g4 d8b8 b2c0 g6g5 g4e2 b8b3 h0h3 b3d3 c0d2 a7a3 d2b1",
        "lineEval": "⩱"
      },
      "62": {
        glyph: "??",
        note: "blunder: 17.4 win% given up, eval +2.52 after. The engine wanted the line in the sibling branch.",
        line: "i3i0 e2g0 g3g8 f6h6 c2d4 d0e1 e8f7 h6h8 g8g7 i9i4 f8e8 c0e2 g7h7 e4e5 h7h4 e5e6 i0i1 e6f6 i1f1 f4g6",
        "lineEval": "⩲"
      },
      "63": {
        glyph: "!",
        note: "Great: the only move that punishes the error before it, and every alternative is at least a mistake worse.",
      },
      "69": {
        glyph: "?",
        note: "mistake: 15 win% given up, eval +1.25 after. The engine wanted the line in the sibling branch.",
        line: "f0e1 c9a7 h8f7 e9e8 i9i8 e7c5 g6g8 e8e7 f7h6 g3h3 h6f5 e7f7 i8h8 h3f3 g8g3 e3c2 g3g2 c2a1 f5h6 f7f8 g2f2 f3g3 h6g8 f8f9 g8f6 f9e9 f6d7 e9e8 d7f6 e8d8",
        "lineEval": "+−"
      },
      "76": {
        glyph: "?!",
        note: "inaccuracy: 6.9 win% given up, eval +2.19 after. The engine wanted the line in the sibling branch.",
        line: "g3e3 i9c9 e3e6 g5e6 i3e3 e6g7 e8f8 c9c5 b4c4 c5f5 c4d4 e4e5 d4e4 e5e6 g2h4 f5f2 h4g6 f2f1 d9e8 c0a2 g6i5 g7f5 e4f4 f5d6 e3f3 f1f4 f8f9 f4f5 i5h3 d6e4 h3g1 e0f0",
        "lineEval": "±"
      },
      "79": {
        glyph: "?",
        note: "mistake: 11.2 win% given up, eval +1.42 after. The engine wanted the line in the sibling branch.",
        line: "i9c9 g2i3 c9c5 i3g4 g5h7 g3f3 h7g9 e8e7 c5e5 g4e5 e4e5 f3f9 e5d5 b4c4 e6i6 c4d4 i6d6 d4e4 d6d9 e7e8 d9b9 h0h3 b9b1 h3e3 d0e1",
        "lineEval": "+−"
      },
      "85": {
        glyph: "?!",
        note: "inaccuracy: 5.9 win% given up, eval +1.51 after. The engine wanted the line in the sibling branch.",
        line: "e4e5 g2f4 e5f5 h6h1 h8f7 e9e8 f7g9 e8f8 e6h6 h1h3 h6h8 f8f9 f5f6 d9e8 i8i7 b4b3 i7i9 f9f8 e2g4 h3e3 i9i8 f8f9 h8h9 f9f8",
        "lineEval": "±"
      },
      "93": {
        glyph: "?!",
        note: "inaccuracy: 9.6 win% given up, eval +0.54 after. The engine wanted the line in the sibling branch.",
        line: "g5h7 f4h3 i8i7 h3i5 h7g9 g7g8 i7d7 f8f9 g9i8 h6h8 i8h6 i5h7 h6g4 h7g5 f6g6 g5e4 g4h6 g8e8 e5f5 e4f2 e0f0 f2h3 g6f6 e8d8 d7d1 d9e8 f5e5 f9e9 e5e6 e7c5 f6f5",
        "lineEval": "±"
      },
      "99": {
        glyph: "?!",
        note: "inaccuracy: 7.5 win% given up, eval +0.54 after. The engine wanted the line in the sibling branch.",
        line: "d0e1 e8e9 e5e6 e7c9 f5e5 d9e8 f6f5 g7i7 e4c5 h9h7 e6f6 c9e7 e5e4 h3g1 e0d0 g1f3 c5b7 i7i0 b7c9 i0i9 c9a8 i9i6 a8c7 i6i5 f5f4 i5a5 f6e6 a5a0 c0a2",
        "lineEval": "±"
      },
      "119": {
        glyph: "?!",
        note: "inaccuracy: 5.9 win% given up, eval +0.48 after. The engine wanted the line in the sibling branch.",
        line: "f5f3 h6h4 e4g3 i6i3 g3f5 h4h3 f3i3 g2i3 a4e4 e9d9 e4e3 i3h5 f5e7 h5f4 e0d0 h3h7 e3e4 b2a2 i2g4 a2b2 d0e0 h7h3 e1d2 b2c2 d6d7 f4e6 e4e5 h3g3 e5d5 d9e9 d7d8 c2d2",
        "lineEval": "±"
      },
      "126": {
        glyph: "??",
        note: "blunder: 19.7 win% given up, eval +2.99 after. The engine wanted the line in the sibling branch.",
        line: "i6i5 b5b9 e9f9 a3a9 f9f8 a9a8 f8f9 a8a6 g6e5 a6a9",
        "lineEval": "⩲"
      },
      "139": {
        glyph: "?!",
        note: "inaccuracy: 7.6 win% given up, eval +3.76 after. The engine wanted the line in the sibling branch.",
        line: "d7e7 e9f9 e4g5 h8g6 b6g6 f9e9 g5e6 e5e7 g6d6 e9f9 d6d9 f9f8 a9a8 f8e8 e6c7 e8f8 d9b9 e7e9 c7e6 e9e7",
        "lineEval": "+−"
      },
      "141": {
        glyph: "?!",
        note: "inaccuracy: 5.1 win% given up, eval +3.04 after. The engine wanted the line in the sibling branch.",
        line: "e4c5 e5d5 d0e0 d5d8 b6b9 f9f8 b9b8 d8d9 a9a8 f8f9 b8b9 f9f8 c5e6 f8e8 b9b8 e8e7 a8h8 d9e9 e6g5 d6g6",
        "lineEval": "+−"
      },
      "156": {
        glyph: "?!",
        note: "inaccuracy: 6.5 win% given up, eval +4.53 after. The engine wanted the line in the sibling branch.",
        line: "d2e2 e4g3 e2f2 c4e2 f2e2 a4d4 e2e1 e0d0 d8e8 d4e4 e6e4 g3e4 e5e7",
        "lineEval": "+−"
      },
    },
  },
};

// A text card, in the shape the titled-players thumbnail proved: one token big
// enough to be a mark, then quieter lines under it.
//
// The chart was tried here first and does not survive the size. At 158px in the
// homepage row its 22 rows are scratches, and the one thing it has to say (green
// thinning out, then turning red) needs the row labels and the axis it cannot
// afford at that scale.
//
// The mark is ENGLISH, and that is the whole decision. A version with 冠军 at
// 66px was better looking and worse at the job: the audience here is chess
// players who do not read Chinese, the card is 158px in the homepage row, and at
// that size the English line falls to about 8px. The only legible thing on the
// card would have been two characters the intended reader cannot decode. 冠军
// stays as an eyebrow, where it says "Chinese chess" without needing to be read.
//
// Geometry, palette and type colours are copied from TITLED_PLAYERS_THUMBNAIL on
// purpose: two cards in one row that are almost alike read as a mistake. The CJK
// stack is explicit because Roboto carries no hanzi and the platform fallback
// differs.
const CHAMPIONS_THUMBNAIL = [
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 200" ',
  'preserveAspectRatio="xMidYMid slice" width="320" height="200" role="img" ',
  'aria-label="A card reading Champions, every xiangqi title, 1956 to 2025">',
  '<rect x="0" y="0" width="320" height="200" fill="var(--xq-diagram-bg, #d9bd82)"/>',
  '<text x="160" y="60" text-anchor="middle" font-family="\'Noto Sans SC\', ',
  '\'PingFang SC\', \'Hiragino Sans GB\', \'Microsoft YaHei\', system-ui, sans-serif" ',
  'font-size="26" font-weight="700" letter-spacing="10" fill="#b9832f" ',
  'opacity="0.5">\u51a0\u519b</text>',
  '<text x="160" y="116" text-anchor="middle" font-family="Roboto, system-ui, sans-serif" ',
  'font-size="40" font-weight="700" fill="#b9832f">CHAMPIONS</text>',
  '<text x="160" y="150" text-anchor="middle" font-family="Roboto, system-ui, sans-serif" ',
  'font-size="15" font-weight="600" letter-spacing="1.4" fill="#b9832f" opacity="0.62">',
  'EVERY XIANGQI TITLE</text>',
  '<text x="160" y="176" text-anchor="middle" font-family="Roboto, system-ui, sans-serif" ',
  'font-size="12" letter-spacing="2.4" fill="#5a4626" opacity="0.72">SINCE 1956</text>',
  '</svg>',
].join('');

export const xiangqiChampionsArticle: Article = {
  slug: 'xiangqi-champions',
  kind: 'article',
  publisher: 'mistboard',
  title: 'Every Xiangqi Champion',
  seoTitle: 'Every Xiangqi Champion: Chinese Chess Title Holders and Their Games',
  summary:
    'Every winner of the Chinese national xiangqi championship since 1956, and an annotated game for thirteen of them. Plus the nine hundred years before the title existed, and the decade that has been struck from the record.',
  // The page's subject is a list, so it declares one. Built from CHAMPIONS, the
  // same data the figure and the table render, because a hand-written second
  // copy of twenty-two names is a copy that will drift.
  structuredData: () => [
    {
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      name: 'Chinese national xiangqi champions, 1956 to 2025',
      description:
        'Every winner of the Chinese national xiangqi championship, in the order they first took the title.',
      numberOfItems: CHAMPIONS.length,
      itemListOrder: 'https://schema.org/ItemListOrderAscending',
      itemListElement: CHAMPIONS.map((champ, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        item: {
          '@type': 'Person',
          name: champ.name,
          alternateName: champ.zh,
          jobTitle: 'Xiangqi grandmaster',
        },
      })),
    },
  ],
  status: 'published',
  publishedAt: '2026-08-29',
  audience:
    'English-speaking chess players who know the world chess champions by heart and cannot name a single xiangqi player.',
  thumbnail: { kind: 'svg', svg: CHAMPIONS_THUMBNAIL },
  intro: [
    {
      kind: 'paragraph',
      text:
        'Ask who the greatest chess player was and you get an argument with a shape to it: Fischer or Kasparov or Carlsen, measured against a title that has passed hand to hand since 1886. Ask the same about xiangqi and most English answers stop at the question.',
    },
    {
      kind: 'paragraph',
      text:
        'There is an answer, and almost nobody disputes it. Hu Ronghua won fourteen national championships, took the first at fifteen and the last at fifty-five, and won or shared every one of the ten championships held between 1960 and 1979. What is harder to explain is why the title he dominated is only sixty-nine years old, in a game that was already being played in its modern form when the Song dynasty fell. What follows is every winner, and a game for thirteen of them in the order they first took the title. Our own engine annotates the boards; the analysis is Pikafish at a million nodes a position.',
    },
    ],
  sections: [
    {
      heading: 'Before there was a title',
      blocks: [
        {
          kind: 'paragraph',
          text:
            'Xiangqi reached its modern form at the end of the Northern Song: sixteen pieces a side, nine files by ten ranks, the river, the palace, the general and advisors confined to it. By the Southern Song it was played widely enough that Wen Tianxiang, the statesman the Mongols executed in 1283, grew up in a family of players and left a book of forty endgame problems. Nine hundred years of the game, and composed positions like his are nearly all that survives: not one record of a game anyone actually played.',
        },
        {
          kind: 'paragraph',
          text:
            'What survives from the Ming onward is manuals: 橘中秘 of 1632, the most reprinted xiangqi text of the Ming and Qing, and 百局象棋谱 of 1801 with its hundred and seven positions named after proverbs. You can name the authors. You cannot say who was strongest, because nobody was keeping score. The first era with contested titles ran through the 1920s and 1930s and had no federation: newspapers organised the matches, and the winners were given names rather than trophies. Zhou Deyu finished three points clear when East China played North China in February 1931 and was crowned 七省棋王, Chess King of Seven Provinces, the seven being how many provinces the four players came from. Huang Songxuan then played him twenty games, finished one ahead, and Guangdong crowned him 九省棋王, Chess King of Nine Provinces. A title race settled by nickname inflation is not a system, but it was the closest the game had.',
        },
        {
          kind: 'paragraph',
          text:
            'Xie Xiaxun organised those matches and is the figure worth knowing. He played Western chess well enough to win a five-nation tournament at Shamian in 1936 with eighteen wins, one loss and one draw. In October 1937 he went to Southeast Asia as a national envoy and spent two years playing for the war: simultaneous displays, blindfold games, boards laid out with people as the pieces. He raised more than fifty million in banknotes and silver, and sent three thousand young overseas Chinese home to fight. In 1939 he played Zhou Enlai in Chongqing, and the drawn game they published in the Ta Kung Pao was titled 共抒国难, relieving the national crisis together. He died in 1987, aged ninety-nine.',
        },
        {
          kind: 'paragraph',
          text:
            `Then, in August 1956, the State Sports Commission made xiangqi an official sport and published the first competition rules. That December, in Beijing, the first national championship was played. Xiangqi was the only competitive event; go and Western chess were demonstrations. It has been played fifty-seven times since, missing ${editionGapSentence()}.`,
        },
      ],
    },
    {
      heading: 'Every national champion, 1956 to 2025',
      blocks: [
        {
          kind: 'paragraph',
          text:
            'Fifty-seven editions, twenty-two winners. One row per player, in the order they first took the title, with a bar over the years they held it.',
        },
        {
          kind: 'raw-svg',
          svg: xiangqiChampionTimelineSvg,
          zoomable: true,
          caption:
            'Hatched columns are years with no championship. The number after each name is that player\u2019s title count.',
        },
        {
          kind: 'paragraph',
          text:
            'Three things fall out of the shape. Hu Ronghua holds the middle of the chart for forty years, in two long runs either side of a gap that history took rather than a rival, then four scattered singles that land after the men who replaced him had themselves come and gone. The 1980s and 1990s are the only stretch where four or five names trade the title year to year. And from 2005 the bars turn red: thirteen men have won it since, and ten of them have a ruling against them.',
        },
        {
          kind: 'paragraph',
          text:
            'Thirteen of these men have an annotated game further down the page, one each, in the same order. The nine without one are here because a list of champions that leaves people out is not a list of champions.',
        },
        {
          kind: 'table',
          compact: true,
          wrap: true,
          headers: ['Champion', 'Titles', 'Years', 'Association ruling'],
          rows: championTableRows(),
          caption:
            'The same record as the figure, with the years written out. An asterisk marks the one shared title, in 1962. Every entry in the last column is a published ruling of the Chinese Xiangqi Association, not an allegation; the section below explains them.',
        },
      ],
    },
    {
      heading: 'Yang Guanlin 杨官璘, 1956',
      blocks: [
        {
          kind: 'paragraph',
          text:
            'Four national titles: 1956, 1957, 1959, and a fourth in 1962 shared with the boy who had just taken the game off him. He came out of Guangdong, played for money in Hong Kong between 1949 and 1951, and by the time the sport was organised he was good enough that it called him 第一国手, the nation\'s foremost player. Other players called him 魔叔, Magic Uncle. His reputation rested on endgames, which is a polite way of saying he beat people in positions everyone had agreed were drawn.',
        },
        {
          kind: 'paragraph',
          text:
            'He was the answer for most of a decade, and for longer than the record suggests. Five years after Hu Ronghua took the title off him, Yang was still beating him.',
        },
        {
          kind: 'xq-replay',
          spec: { ...C_kkN9Bwhq },
          caption:
            'Yang Guanlin vs Hu Ronghua, 12 November 1965. Ninety moves of endgame, and move 41 is the cannon swing that finally breaks it.',
        },
      ],
    },
    {
      heading: 'Li Yiting 李义庭, 1958',
      blocks: [
        {
          kind: 'paragraph',
          text:
            'They called him 小神童, the little prodigy, and he had earned it by sixteen: a four-game match against Yang Guanlin in 1954 that finished two apiece. He beat Yang again at the first national championship, in the tournament Yang went on to win, and took the title himself in 1958 at twenty.',
        },
        {
          kind: 'paragraph',
          text:
            'Then he stopped. Poor health and the politics of the late 1960s ended his competitive career in 1966, at twenty-eight, which is the whole reason a player this good has one championship. He coached afterwards, and the player he pushed forward was Liu Dahua, two sections down.',
        },
        {
          kind: 'xq-replay',
          spec: { ...C_Ue0EgpS7 },
          caption:
            'Li Yiting vs Yang Guanlin, 27 December 1956. Li was eighteen, and our engine grades him 99.0, the highest of any player here.',
        },
      ],
    },
    {
      heading: 'Hu Ronghua 胡荣华, 1960',
      blocks: [
        {
          kind: 'paragraph',
          text:
            'Fourteen national titles, the first at fifteen and the last at fifty-five, and every one of the ten championships held between 1960 and 1979, one of them shared. They called him 胡司令, Commander Hu. He played out of Shanghai, on his own, against the strongest player every other province could field, and he did it by rebuilding the openings underneath the game: the flying elephant, the anti-palace horse and the same-direction cannon are all mainstream today because Hu kept winning with them.',
        },
        {
          kind: 'paragraph',
          text:
            'This is the game he arrived with. Round three of his first national tournament, Black against the reigning champion.',
        },
        {
          kind: 'xq-replay',
          spec: { ...C_0BM6N4j4 },
          caption:
            'Yang Guanlin vs Hu Ronghua, 28 October 1960. Move 24 is the one to watch: a cannon Yang cannot take, marked brilliant.',
        },
        {
          kind: 'paragraph',
          text:
            'And this is thirty-four years later, in a tournament he did not win, against a man who had taken two national titles of his own in between.',
        },
        {
          kind: 'xq-replay',
          spec: { ...C_z88B1zTk },
          caption:
            'Hu Ronghua vs Liu Dahua, 15 October 1994. Hu at forty-eight, six years before his fourteenth title.',
        },
      ],
    },
    {
      heading: 'Liu Dahua 柳大华, 1980',
      blocks: [
        {
          kind: 'paragraph',
          text:
            'Two titles, 1980 and 1981, and the man who ended the longest run in the game: Hu had won every championship held for twenty years when Liu took the 1980 tournament off him. He is from Huangpi, in Hubei, and the sport knows him as 东方电脑, the Eastern Computer, for a memory that let him play nineteen simultaneous games blindfold in 1995. That was a world record until one of the champions further down this page broke it with twenty.',
        },
        {
          kind: 'paragraph',
          text:
            'He beat Li Laiqun in the 1980 tournament, then Yang Guanlin five days later.',
        },
        {
          kind: 'xq-replay',
          spec: { ...C_H4ovjgj7 },
          caption:
            'Li Laiqun vs Liu Dahua, 29 August 1980. Li would take four titles of his own starting two years later.',
        },
        {
          kind: 'xq-replay',
          spec: { ...C_nj9VX8BK },
          caption:
            'Yang Guanlin vs Liu Dahua, 3 September 1980. The outgoing era losing to the incoming one in under thirty-five moves.',
        },
      ],
    },
    {
      heading: 'Li Laiqun 李来群, 1982',
      blocks: [
        {
          kind: 'paragraph',
          text:
            'Four titles between 1982 and 1991, and the first of them mattered past his own career. Li is from Handan in Hebei, and 1982 was the first time the men\'s championship crossed the Yellow River: until then it had belonged to the south, to Guangdong and Shanghai and Hubei. He went through that tournament unbeaten, and through Hu Ronghua directly rather than around him.',
        },
        {
          kind: 'paragraph',
          text:
            'Chinese writers reach for two images for his game: a needle wrapped in cotton, and a python\'s coils. Both mean the same thing, which is that the position has already closed before you notice it closing.',
        },
        {
          kind: 'xq-replay',
          spec: { ...C_sUzJIb4U },
          caption:
            'Li Laiqun vs Hu Ronghua, 7 December 1982, from the championship Li won. Move 23 is the cannon push, and Hu has nothing after it.',
        },
      ],
    },
    {
      heading: 'Lü Qin 吕钦, 1986',
      blocks: [
        {
          kind: 'paragraph',
          text:
            'Five national titles and five world titles, more of the latter than anyone before or since. Guangdong called him 羊城少帅, the Young Marshal of Guangzhou, and paired him with Xu Yinchuan as 岭南双雄, the twin heroes of Lingnan. In almost any other era that record is the headline of the sport. Here it reads as a long second place behind Hu Ronghua.',
        },
        {
          kind: 'xq-replay',
          spec: { ...C_DCNGV4UV },
          caption:
            'Lü Qin vs Yu Youhua, 23 November 1986. The only game where both players are marked brilliant: Lü Qin\'s cannon on 21, Yu Youhua\'s horse on 32.',
        },
      ],
    },
    {
      heading: 'Xu Tianhong 徐天红, 1989',
      blocks: [
        {
          kind: 'paragraph',
          text:
            'National champion in 1989, world champion in 1993 with six wins, three draws and no losses. He is from Taizhou in Jiangsu, and the sport calls him 笑面佛, the Smiling Buddha, because he smiles right through a game. What is behind the smile is the opposite of friendly: tight openings, very few holes, and a habit of grinding advantages too small to see into wins.',
        },
        {
          kind: 'paragraph',
          text:
            'The year after his national title he met a fifteen-year-old from Guangdong, at the same age and on the same stage where Hu Ronghua had beaten Yang Guanlin thirty years earlier. This time the champion won.',
        },
        {
          kind: 'xq-replay',
          spec: { ...C_rhF5YH7d },
          caption:
            'Xu Tianhong vs Xu Yinchuan, 19 October 1990. No blunder from either side, which is the game Xu Tianhong wanted.',
        },
      ],
    },
    {
      heading: 'Zhao Guorong 赵国荣, 1990',
      blocks: [
        {
          kind: 'paragraph',
          text:
            'Four national titles spread across eighteen years, 1990 to 2008, plus the 1991 world championship. He learned in Harbin under Wang Jialiang, who was known as the Northeast Tiger, so the sport made Zhao the New Northeast Tiger. What people mean by it is that he plays bigger against stronger opponents, and that he fused the careful northern game with the sharper southern one.',
        },
        {
          kind: 'xq-replay',
          spec: { ...C_oyo2kgtC },
          caption:
            'Zhao Guorong vs Hu Ronghua, 22 October 1989, the year before his first title. Move 30 is the chariot swing, and Hu does not recover.',
        },
      ],
    },
    {
      heading: 'Xu Yinchuan 许银川, 1993',
      blocks: [
        {
          kind: 'paragraph',
          text:
            'Six national titles and three world titles. He won the first at eighteen, second only to Hu\'s fifteen, and spent the 1990s and 2000s as the best player in the country not named Hu Ronghua. Like Yang Guanlin before him he built it on endgames, and like Yang he came out of Guangdong. He is one of the three men to have won a national title since 2005 with no ruling against him.',
        },
        {
          kind: 'paragraph',
          text:
            'Here he is against the man who ended Hu\'s run.',
        },
        {
          kind: 'xq-replay',
          spec: { ...C_ZBE8Dp5U },
          caption:
            'Xu Yinchuan vs Liu Dahua, 11 October 1995. The only game here in which our engine finds neither a blunder nor a mistake from either player.',
        },
      ],
    },
    {
      heading: 'Tao Hanming 陶汉明, 1994',
      blocks: [
        {
          kind: 'paragraph',
          text:
            'The only champion here who came up outside the system. Tao grew up on the street chess stalls of Haicheng in Liaoning, turned professional late, and in 1994 became the first amateur-trained player to win the national title, playing for Jilin and taking it from Lü Qin on tiebreak in the final round. The sport named him 绿林棋王, chess king of the greenwood, which is the Chinese phrase for outlaws in the forest, and it is a verdict on his game rather than his upbringing: unorthodox, and ferocious in the middlegame.',
        },
        {
          kind: 'paragraph',
          text:
            'His game is wild by the standards of every other champion in this sequence, built on prepared surprises rather than accumulation. Here he is two years after the title, against a two-time champion.',
        },
        {
          kind: 'xq-replay',
          spec: { ...C_hLWs5hR5 },
          caption:
            'Tao Hanming vs Liu Dahua, 21 October 1996. More chances for both players than a positional grind offers, and Tao was better at taking them.',
        },
      ],
    },
    {
      heading: 'Yu Youhua 于幼华, 2002',
      blocks: [
        {
          kind: 'paragraph',
          text:
            'One title, in 2002, at forty-one, taken in the middle of the years that belonged to Hu Ronghua, Lü Qin and Xu Yinchuan. A Guangzhou newspaper writer had named him 拼命三郎 two decades earlier, roughly the desperado, after the 1981 championship: he finished sixth and did not draw a single one of his thirteen games. He plays for complications and accepts what comes with them.',
        },
        {
          kind: 'xq-replay',
          spec: { ...C_HFq9qzB8 },
          caption:
            'Xu Tianhong vs Yu Youhua, 3 November 2002, from the championship Yu finally won. The Smiling Buddha against the desperado.',
        },
      ],
    },
    {
      heading: 'Sun Yongzheng 孙勇征, 2011',
      blocks: [
        {
          kind: 'paragraph',
          text:
            'One title, in 2011, won without losing a game: five wins and six draws. He is where the list stops being straightforward. On 12 January 2025 the Chinese Xiangqi Association banned him for four years and three months and revoked his grandmaster title, in the same announcement that sanctioned forty-one people.',
        },
        {
          kind: 'paragraph',
          text:
            'Every man who won the national championship from 2010 to 2023 now has a ruling against him. What that means for the list is at the foot of the page.',
        },
        {
          kind: 'xq-replay',
          spec: { ...C_fOnPsRe1 },
          caption:
            'Xu Tianhong vs Sun Yongzheng, 18 October 2010, the year before his title. Sixty plies, the shortest game here.',
        },
      ],
    },
    {
      heading: 'Wang Yubo 王禹博, 2025',
      blocks: [
        {
          kind: 'paragraph',
          text:
            'The twenty-second man to win it, in Jinan in December 2025, a first title for a Beijing player coached by the grandmaster Zhang Qiang. His is the only game below in which the opponent appears nowhere else, and that is a consequence of the section above rather than an editorial choice.',
        },
        {
          kind: 'xq-replay',
          spec: { ...C_aHRbltmz },
          caption:
            'Wang Yubo vs Su Yilin, 6 December 2025, the opening round of the championship he won. Move 32 is the horse advance the engine marks.',
        },
      ],
    },
    {
      heading: 'The decade that was struck',
      blocks: [
        {
          kind: 'paragraph',
          text:
            'The red bars in the chart are the reason this list needs a footnote. Between 2024 and 2026 the Chinese Xiangqi Association worked through a match-fixing case the Chinese press calls 录音门, the recording gate, and it has [a page of its own](/blog/xiangqi-match-fixing): the investigation, everyone sanctioned, the reasoning, and the sources.'
        },
        {
          kind: 'paragraph',
          text:
            'Set that against the table above and the damage is easier to see than to state. Thirteen men have won the national championship since 2005 and ten of them have a ruling against them, including every single winner from 2010 to 2023. Xu Yinchuan, Zhao Guorong and Wang Yubo are the three who do not.',
        },
        {
          kind: 'paragraph',
          text:
            'The names stay in the table. A list that quietly dropped them would be a worse record of what happened, and these are published findings from the sport\u2019s own governing body rather than allegations. What the rulings do not tell you is which games were fixed, or how a player at that level is supposed to be caught, and that is a longer story than a list of champions can hold.',
        },
        {
          kind: 'cta',
          buttons: [
            {
              label: 'The world title, and the same names',
              href: '/blog/xiangqi-world-championship',
              emphasis: 'secondary',
            },
          ],
        },
      ],
    },
    {
      heading: 'Where that leaves the list',
      blocks: [
        {
          kind: 'paragraph',
          text:
            'Sixty-nine years, fifty-seven championships, twenty-two winners. For the first fifty of those years the question had a clear answer and it was usually Hu Ronghua. For the fifteen after that it has an answer the sport has since taken back. Wang Yubo\u2019s title in December 2025 is the first since Xu Yinchuan in 2009 that nobody has had to qualify.',
        },
        {
          kind: 'paragraph',
          text:
            'Every game on this page is a chapter in a study you can work through properly: the full move tree, the engine\u2019s lines as branches you can walk, one chapter per champion in the same order, and the 2025 world final at the end.',
        },
        {
          kind: 'cta',
          buttons: [
            {
              label: 'Learn how the pieces move',
              href: '/learn/xiangqi',
              emphasis: 'primary',
            },
            {
              label: 'Play through the whole study',
              href: '/study/ytSzepET',
              emphasis: 'secondary',
            },
          ],
        },
      ],
    },

  ],
};
