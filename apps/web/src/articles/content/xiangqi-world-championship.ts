import {
  sanctionedWorldChampions,
  WORLD_CHAMPIONS,
  WORLD_EDITIONS,
  worldChampionTableRows,
  xiangqiWorldTitleTimelineSvg,
} from '@mistboard/board-render';
import type { XiangqiReplaySpec } from '../../xiangqi-replay.js';
import type { Article } from '../types.js';

// Split out of the champions article in 2026-08. That piece is about one
// country's title; this one is about a different competition with a different
// list of holders, and wedging the two together forced every reader to hold two
// title systems at once to follow either.

// 2025 · Shanghai, and the title leaves China
const C_BV0kkYY4: XiangqiReplaySpec = {
  iccs: "h2d2 g6g5 h0g2 h9g7 i0h0 i9h9 h0h4 h7i7 h4f4 b9c7 c3c4 b7a7 b0c2 a9b9 a0b0 b9b3 b2a2 b3b0 c2b0 a7a3 a2c2 c9e7 c2c3 h9h8 d2d7 h8h2 b0c2 a3a4 c4c5 h2g2 c3c6 e7c5 d7i7 c5e7 c2e1 g2d2 f4a4 g9i7 c0e2 d2d6 c6c0 c7b5 e1c2 g7f5 f0e1 f5g3 a4b4 d6d5 c2a3 b5d4 a3c4 e7c5 b4b6 g3f1 b6e6 d9e8 c0c1 f1h2 e3e4 g5g4 c1d1 d4e2 c4d2 e2d4 e6h6 h2f3 d2f3 d4b3 h6b6 d5d1 b6b3 g4f4 f3d2 f4e4 b3b9 e8d9 b9b4 e4e3 b4e4 d9e8 e4e3 i7g9 e3e6 i6i5 e6e5 c5e7 e5i5 d1c1 i5i6 c1c5 i3i4 c5g5 g0e2 g5e5 d2c4 e5e2 i6a6 e7c5 i4i5 e2e4 c4b2 e4e7 b2a4 e7c7 a6d6 c5a7 a4b6 g9e7 i5i6 e7c9 i6h6 c9e7 h6g6 e7c9 d6e6 c7b7 e6d6 b7c7 g6g7 c7b7 g7g8 b7c7 d6g6 c7b7 b6c4 b7c7 c4d6 c7d7 g8f8 e9d9 g6f6 d9e9 e0f0 e9d9 e1d2 c9e7 d0e1 e7c9 f8f9 e8f9 f6f9 d9d8 d6f5 d8e8 f5h6 c9e7 f9f8 e8e9 f8f7 a7c5 h6f5 d7d3 f5g7 e9d9 f7f9 d9d8 f9f6 d8d9 f0e0 d3d4 g7f5 d4d7 f6b6 d9e9 f5d6 e9d9 d6e4 d7d4 e4f6 d9d8 f6h7 d4d5 h7f8 d8e8 f8e6 e8e9 e6g7 e9d9 b6b9 d9d8 b9e9 d5d3 g7f9 d3f3 e1f0 f3e3 d2e1 e3f3 e9b9 d8e8 b9d9 f3f4 e0d0 f4f3 d9d5 f3f6 f9g7 f6f7 g7f5 f7f6 f5g3 e8e9 g3e4 f6f4 d5e5 e9f9 e5e6 f4f7 e4d6 f9f8 d0e0 f8f9 e1f2 f9f8 e0e1 f8f9 e6e5",
  red: "Lại Lý Huynh",
  black: "Fung Ka-chun",
  event: "2025 19th World Xiangqi Championship",
  resultText: "1-0",
  annotations: {
    byPly: {
      "31": {
        glyph: "?!",
        note: "inaccuracy: 5.4 win% given up, eval -0.11 after. The engine wanted the line in the sibling branch.",
        line: "c0e2 e7c5 d7i7 g9i7 f4a4 g2f2 a4d4 f2f7 d4d6 c7e8 d6c6 f7f5 c2a3 i7g9 c6c8 f5d5 c3b3 c5a7 b3b9 a7c9 a3c4 g9e7 b9b1 g7f5 c4b6",
        "lineEval": "⩲"
      },
      "58": {
        glyph: "?!",
        note: "inaccuracy: 7.4 win% given up, eval +1.48 after. The engine wanted the line in the sibling branch.",
        line: "d5f5 e6d6 d4e2 c1f1 f5f1 c4d2 i7g9 d6a6 f1f3 g0e2 f3e3 a6i6 e3e2 i3i4 g5g4 i6g6 g4h4 i4i5 g9e7 g6b6 e7c9 d2c4 e2e4 c4a5 e4a4",
        "lineEval": "⩲"
      },
      "62": {
        glyph: "?!",
        note: "inaccuracy: 6.8 win% given up, eval +2.33 after. The engine wanted the line in the sibling branch.",
        line: "d4c2 c4d2 d5f5 e6a6 c2b0 e4e5 f5e5 a6a9 e8d9 a9d9 e9e8 d1b1 i7g5 d2b3 g4g3 b3a5 e5e7 d9d5 h2f3 e1f2 e7c7 b1e1 c5e7 e2c0 e7g9 g0e2 g9e7 e2c4 e7c9",
        "lineEval": "±"
      },
      "125": {
        glyph: "?!",
        note: "inaccuracy: 6.3 win% given up, eval +1.81 after. The engine wanted the line in the sibling branch.",
        line: "g6e6 e9d9 g8f8 b7c7 b6d5 c7d7 e6e5 a7c5 e1d2 d9d8 f8e8 f9e8 e5e8 d8d9 e8e9 d9d8 e9e5 c9a7 d0e1 d7b7 e1f2 b7b0 e0e1 b0b7 e5e8 d8d9 e8e6 d9d8 e6c6 b7i7 c6a6",
        "lineEval": "±"
      },
      "126": {
        glyph: "?!",
        note: "inaccuracy: 5.7 win% given up, eval +2.53 after. The engine wanted the line in the sibling branch.",
        line: "a7c5 c4e5 b7i7 e5g4 e8d9 e0f0 i7f7 e1f2 c9e7 g6e6 f9e8 f0f1 f7f5 g4h6 f5f9 e6a6 f9f4 a6d6 e9f9 d0e1 f9e9 d6g6 e9f9 g8h8 f4f5 h6g8",
        "lineEval": "±"
      },
      "139": {
        glyph: "?",
        note: "mistake: 10.8 win% given up, eval +0.79 after. The engine wanted the line in the sibling branch.",
        line: "f0e0 a7c5 f6g6 d9e9 f8g8 c5a7 d6f5 d7f7 f5h6 f7f4 e1f0 f4f3 g6d6 c9e7 e0d0 e8d9 g8h8 f3f8",
        "lineEval": "±"
      },
      "140": {
        glyph: "??",
        note: "blunder: 20.8 win% given up, eval +3.44 after. The engine wanted the line in the sibling branch.",
        line: "c9e7 d6c4 a7c5 c4a5 e8f9 f6f9 d9d8 f9e9 d7c7 f0e0 c5a7 e1d0 a7c5 e9h9 d8e8 h9h5 e8d8 h5d5 d8e8 d5d6 e8e9 a5b3 c5a7 b3d4 c7c4 d4f5 c4e4 d0e1 a7c5",
        "lineEval": "⩲"
      },
      "145": {
        glyph: "??",
        note: "blunder: 29.5 win% given up, eval +0.81 after. The engine wanted the line in the sibling branch.",
        line: "f0e0 d7c7 f5d6 e8d8 f9e9 c7c0 e1d0 c0c7 e9e8 d8d9 d6c8 a7c5 e8e5 c7d7 e5c5 c9e7 c5i5 d9d8 i5i8 d8d9 i8e8 e7g9 e8e9 d9d8 e9g9 d7d2 g9g8 d8d9 g8g5 d9d8 c8a7 d2e2",
        "lineEval": "+−"
      },
      "182": {
        glyph: "??",
        note: "blunder: 36.4 win% given up, eval +6.35 after. The engine wanted the line in the sibling branch.",
        line: "d5e5 e9b9 e5d5 b9b7 d8d9 g7e6 d9e9 b7b8 e7g5 b8b9 e9e8 e6g7 e8d8 b9b8 d8d9 b8b5 d9e9 b5b7 c5e7 b7b9",
        "lineEval": "⩲"
      },
      "183": {
        glyph: "??",
        note: "blunder: 36.1 win% given up, eval +0.56 after. The engine wanted the line in the sibling branch.",
        line: "g7e6 d3d7 e1d0 d7b7 e9c9 b7d7 c9c5 d8d9 c5f5 d7d6 f5e5 d6d7 e6g7 d7d2",
        "lineEval": "+−"
      },
      "208": {
        glyph: "?!",
        note: "inaccuracy: 5.9 win% given up, eval +1.38 after.",
      },
      "212": {
        glyph: "??",
        note: "blunder: 15.7 win% given up, eval +4.00 after.",
      },
      "215": {
        glyph: "??",
        note: "blunder: 15.5 win% given up, eval +1.96 after.",
      },
      "216": {
        glyph: "??",
        note: "blunder: 31 win% given up, eval mate in 20 after.",
      },
    },
  },
};



// Same text card as the champions article, which is the point: they are a pair,
// and a reader who has seen one should recognise the other as its sibling rather
// than as an unrelated page. 世界 (world) against that piece's 冠军 (champion).
const WORLD_TITLE_THUMBNAIL = [
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 200" ',
  'preserveAspectRatio="xMidYMid slice" width="320" height="200" role="img" ',
  'aria-label="A card reading World, the xiangqi world title, since 1990">',
  '<rect x="0" y="0" width="320" height="200" fill="var(--xq-diagram-bg, #d9bd82)"/>',
  '<text x="160" y="60" text-anchor="middle" font-family="\'Noto Sans SC\', ',
  '\'PingFang SC\', \'Hiragino Sans GB\', \'Microsoft YaHei\', system-ui, sans-serif" ',
  'font-size="26" font-weight="700" letter-spacing="10" fill="#b9832f" ',
  'opacity="0.5">\u4e16\u754c</text>',
  '<text x="160" y="116" text-anchor="middle" font-family="Roboto, system-ui, sans-serif" ',
  'font-size="40" font-weight="700" fill="#b9832f">WORLD TITLE</text>',
  '<text x="160" y="150" text-anchor="middle" font-family="Roboto, system-ui, sans-serif" ',
  'font-size="15" font-weight="600" letter-spacing="1.4" fill="#b9832f" opacity="0.62">',
  'AND WHY IT IS NOT THE HARDER ONE</text>',
  '<text x="160" y="176" text-anchor="middle" font-family="Roboto, system-ui, sans-serif" ',
  'font-size="12" letter-spacing="2.4" fill="#5a4626" opacity="0.72">SINCE 1990</text>',
  '</svg>',
].join('');


// 2015 · Zheng Weitong over the man who would take the title ten years later.
// Harvested from dpxq (moves only), replayed through our rule engine, annotated
// by the same postgame path the review page uses.
const C_ZWT2015: XiangqiReplaySpec = {
  "iccs": "c3c4 b7c7 h2e2 c9e7 d0e1 h9g7 h0g2 i9h9 i0h0 h7h3 g3g4 h3g3 b0c2 g6g5 g4g5 c6c5 c2d4 c5c4 d4e6 g7e6 e2e6 d9e8 e6g6 h9h0 g2h0 g3g6 g5g6 b9d8 b2i2 d8e6 h0g2 a9b9 c0e2 c4c3 g6f6 e6c5 g2f4 b9b6 f6e6 c5e6 f4d5 c7c5 d5c3 e6f4 e2g4 b6b3 c3d1 f4d3 a0c0 d3e5 g4e2 e5f3 i2f2 b3d3 d1b2 d3e3 b2a4 c5e5 c0c3 e3c3 a4c3 e5e3 c3d5 e3i3 d5b4 i3a3 b4a6 i6i5 a6b4 i5i4 e2c0 e7c5 f2d2 g9e7 c0e2 i4h4 d2d1 h4g4 b4d5 a3a8 e1f2 g4g3 d5f6 f3d4 f6e4 g3f3 f0e1 e8f7 e4d6 f9e8 d6c8 e9f9 c8d6 a8a3 d6e4 f3e3 e4d6 a3a0 d6c4 d4c2 c4b2 a0a6 e1d2 a6h6 f2e1 h6h0 g0i2 e3e2 i2g4 e2e1 e0e1 h0h4 e1e0 c2b4 g4e2 h4h2 b2c4 b4a2 d2e1 a2c3 d1d3 h2h6 c4e3 h6e6 e3g2 f9e9 e0f0 c3d1 d3h3 d1b2 e2g0 b2d3 h3e3 e6h6 g0e2 h6h8 e1d2 e9d9 e3f3 d3e5 f3f2 e8d7 d2e1 e5d3 f2f1 h8e8 e2c0 e7g5 c0e2 c5e7 e2g4 e8g8 e1d2 g8g4 g2e3 g4i4 f1d1 d3e5 d2e1 d9e9 e3c2 i4i8 f0e0 e5f3 e0d0 e7c5 e1f2 f3h2 c2e3 h2g0 d1e1 e9d9 e1g1 g0i1 g1d1 d9e9 d1e1 e9f9 e1d1 i1g0 d1g1 i8f8 e3g4 f9e9 g4e5 f8f2 e5d7 e9d9 d0e0 c5e7 g1d1 f2d2 d7e5 d2i2 e5d7 i2d2 d7e5 d2i2 e5d7 i2d2 d7b8 d9e9 b8d7 e9e8 d1e1 e8d8 d7e5 d2e2 e0f0 f7e8 e5d3 d8d9 d3f4 e2e4 e1g1 g0i1 g1d1 d9e9 d1h1 e4e5 h1f1 e5e3 f0e0 e3g3 f1e1 g3g4 e0d0 i1g0 e1e6 g0f2 e6e2 f2e4 e2e3 g4i4 f4e6 i4i8 e6g7 i8f8 d0e0 e8f7 g7i6 e9d9 i6h8 f8g8 h8g6 e4f6 g6i5 e7c5 i5h3 g8e8 e0f0 f6g4 e3e1 g5i7 e1e2 e8f8 f0e0 d9d8 h3i1 g4f2 e0e1 f8e8 e1f1 f2h1 e2h2 e8i8 i1h3 d8e8 h2e2 i8i9 f1e1 i9e9 h3f4 e9e2",
  "red": "Lại Lý Huynh",
  "black": "Zheng Weitong",
  "event": "2015 14th World Xiangqi Championship",
  "resultText": "0-1",
  "annotations": {
    "byPly": {
      "199": {
        "glyph": "??",
        "note": "blunder: 46.2 win% given up, eval #-1 after. The engine wanted the line in the sibling branch.",
        "line": "e0f0 i2i0 f0f1 d9e9 d1d2 i0i8 d2f2 f7e8 f2e2 e7c5 f1f0 i8i6 e5d3 c5e7 e2e6 i6i5 e6g6 g0h2 g6i6 i5i0 i6d6 i0i8 d3c5 h2f3 c5e4",
        "lineEval": "⩱"
      },
      "200": {
        "glyph": "??",
        "note": "blunder: 46.4 win% given up, eval -0.39 after. The engine wanted the line in the sibling branch.",
        "line": "i2d2",
        "lineEval": "−+"
      },
      "203": {
        "glyph": "??",
        "note": "blunder: 46.1 win% given up, eval #-1 after. The engine wanted the line in the sibling branch.",
        "line": "e0f0 f7e8 d1e1 d2e2 b8c6 e2f2 c6e5 f2f4 e5d7 e9f9 d7e5 f4f6 f0f1 f6f8 f1f0 e8f7 e1f1 g0f2 f1f7 f8e8 e5g6 f2h1 f0f1 f9e9 f7f3 h1g3 f1f0 e7c5 f0e0",
        "lineEval": "⩱"
      },
      "204": {
        "glyph": "??",
        "note": "blunder: 46.3 win% given up, eval -0.40 after. The engine wanted the line in the sibling branch.",
        "line": "e9d9",
        "lineEval": "−+"
      },
      "259": {
        "glyph": "?!",
        "note": "inaccuracy: 7.9 win% given up, eval -1.75 after. The engine wanted the line in the sibling branch.",
        "line": "e2g2 f8f9 g2a2 d8d7 a2d2 c5e7 d2e2 d7d8 e2e4 e7c5 e4f4 f9e9 e0f0 g4i3 f0f1 i3h5 f4f3 h5g3 f1f0 c5a7",
        "lineEval": "⩱"
      },
      "265": {
        "glyph": "?",
        "note": "mistake: 10.6 win% given up, eval -5.44 after. The engine wanted the line in the sibling branch.",
        "line": "e2e6 e8f8 f1e1 f8f9 e6h6 f9e9 h6i6 d8d7 i6i5 h1g3 i1g2 f7e8 e1f1",
        "lineEval": "∓"
      }
    }
  }
};

// Every board below is a world-championship game by that champion, from an
// edition he actually won, harvested moves-only and replayed through our own
// rule engine before anything was written about it. Xu Tianhong has no board:
// he won in 1993 and the archives hold four games from that edition, none of
// them his. A section without a game is the honest form of that.

const C_LQ1997: XiangqiReplaySpec = {
  "iccs": "h2e2 h9g7 g3g4 i9h9 h0g2 c6c5 i0h0 b9c7 b0a2 a6a5 b2b6 g9e7 b6c6 a9a6 a0b0 a6c6 b0b7 h7i7 h0h9 g7h9 b7b8 f9e8 b8b1 h9f8 b1h1 e6e5 e2e5 c6f6 c0e2 i7h7 e3e4 f6f3 e5a5 f3g3 g2e1 h7h3 a3a4 f8h7 e1c0 h7f6 e4e5 f6e4 a5a9 g6g5 d0e1 g5g4 e2g4 c7b5 a4a5 b5c3 a2b4 c3d1 b4d5 e7g9 a9a6 d1c3 d5c3 e4c3 g0e2 g9e7 a6e6 c3a2 c0b2 g3b3 h1h2 a2b4 a5b5 c5c4 b2d1 c4d4 d1e3 b4d3 e1d2 h3f3 e3f5 f3h3 f5h6 e9f9 e6f6 b3b0 e0e1 b0b1 e1e0 b1b0 e0e1 b0f0 e5e6 h3e3 e2c0 f9f8 h2g2",
  "red": "Lü Qin",
  "black": "Wu Guilin",
  "event": "1997 5th World Xiangqi Championship",
  "resultText": "1-0",
  "annotations": {
    "byPly": {
      "52": {
        "glyph": "?!",
        "note": "inaccuracy: 6.2 win% given up, eval +0.68 after. The engine wanted the line in the sibling branch.",
        "line": "c5c4 b4c6 e7c5 a9a6 c5e7 a6a9",
        "lineEval": "="
      },
      "66": {
        "glyph": "?!",
        "note": "inaccuracy: 8.6 win% given up, eval +1.08 after. The engine wanted the line in the sibling branch.",
        "line": "a2b0 e5d5 b0c2 b2c0 b3d3 e2g0 c2d4 c0d2 c5c4 e1d0 d4f5 f0e1 c4c3 h2f2 d3d5 d2c4 d5c5 g4e2 h3d3 e6e5 f5g7 f2g2 e9f9",
        "lineEval": "="
      },
      "68": {
        "glyph": "?",
        "note": "mistake: 12.4 win% given up, eval +2.62 after. The engine wanted the line in the sibling branch.",
        "line": "h3f3 b2d1 b4d3 e5f5 e9f9 h2h9 f9f8 e6c6 f3f4 f5f6 b3b5 f6g6 e8d7 c6i6 f8e8 i6i8 d3c1 g6g7 e8d8 h9f9",
        "lineEval": "±"
      },
      "86": {
        "glyph": "?!",
        "note": "inaccuracy: 8.4 win% given up, eval +3.85 after. The engine wanted the line in the sibling branch.",
        "line": "b0b1 e1e0 h3e3 e2g0 b1b0 e0e1 b0b1 e1e0 b1f1 e5f5 e3f3 f5g5 d3f4 h6f5 f3f5",
        "lineEval": "±"
      },
      "87": {
        "glyph": "??",
        "note": "blunder: 23.7 win% given up, eval +0.74 after. The engine wanted the line in the sibling branch.",
        "line": "f6f5 h3e3 e2g0 d3b2 h6f7 f0f5 f7h8 f9e9 e5f5 e3a3 h8g6 d4d3 g6i7 b2c0 e1f1",
        "lineEval": "+−"
      },
      "91": {
        "glyph": "??",
        "note": "blunder: 39.7 win% given up, eval -3.64 after. The engine wanted the line in the sibling branch.",
        "line": "f6f5 e3e5 b5c5 d4e4 c0e2 e4e3 c5d5 e5e4 e6f6 e8f7 f6f7 f8e8 f5e5 d3e5 d5e5 f0f6 g4i2 e3d3 e2c0 e4b4 e1e0 d3d2 h6g8 f6f7 h2d2 f7g7 e0d0 b4b0 c0a2",
        "lineEval": "⩲"
      }
    }
  }
};

const C_ZGR1991: XiangqiReplaySpec = {
  "iccs": "g3g4 c6c5 b2c2 h7e7 c0e2 h9g7 c3c4 i9h9 c4c5 e7e3 d0e1 c9e7 b0d1 e3b3 d1e3 e6e5 c5c6 e5e4 e3c4 a9a8 a0d0 h9h3 c4d6 a8d8 d0d5 b7b4 c2b2 b4b2 h2b2 b9a7 c6c7 h3c3 c7d7 d8a8 h0g2 a7c6 i0h0 g7e6 d5e5 c6d4 e5e4 c3c2 d6c4 b3b4 e4e3 a8a7 d7d8 a7d7 d8d9 e9d9 e1d2 b4b8 e3b3 b8e8 g2e3 c2c1 f0e1 e7c9 h0h2 d7f7 h2f2 f7f2 e1f2 c1b1 d2e1 d9e9 b3d3 b1b0 e1d0 e8d8 e3d5 f9e8 b2d2 e6f4 d3c3 d4e2 d5f4",
  "red": "Zhao Guorong",
  "black": "Wu Guilin",
  "event": "1991 2nd World Xiangqi Championship",
  "resultText": "1-0",
  "annotations": {
    "byPly": {
      "20": {
        "glyph": "?!",
        "note": "inaccuracy: 6.3 win% given up, eval +0.53 after. The engine wanted the line in the sibling branch.",
        "line": "b9d8 c6c7 b7b4 c4d6 e4d4 c7d7 b3d3 a0d0 g7e6 c2c6 b4b6 d7d8 d3d6 c6e6 b6e6 d0d4 a9b9 d4d6 b9b0 d6d0 b0d0 e0d0 h9h2 d8d9 e9e8 e2c0 e7c5 i0i2 h2h0 i2e2 e6e7 e2d2",
        "lineEval": "="
      },
      "32": {
        "glyph": "?",
        "note": "mistake: 12.3 win% given up, eval +1.12 after. The engine wanted the line in the sibling branch.",
        "line": "g7e6 d6c8 b3b8 d5d8 b8d8 c8a7 h3b3 c7d7 b3b2 d7d8 b2b7 i3i4 b7a7 d8d9 e9d9 i0i3 a7d7 h0g2",
        "lineEval": "="
      },
      "38": {
        "glyph": "?!",
        "note": "inaccuracy: 6.9 win% given up, eval +2.41 after. The engine wanted the line in the sibling branch.",
        "line": "c3c2 d5d2 c2d2 e1d2 g7e6 h0h3 e6d4 b2b1 d9e8 d7e7 g9e7 b1i1 b3b6 d6e4 c6e5 h3h5 g6g5 g4g5 b6b4 e2c4",
        "lineEval": "±"
      },
      "39": {
        "glyph": "?",
        "note": "mistake: 14.3 win% given up, eval +0.71 after. The engine wanted the line in the sibling branch.",
        "line": "h0h5 g6g5 h5h6 e6d4 d7e7 c3c2 b2b0 b3d3 d5e5 d4b3 b0d0 d3a3 e7d7 f9e8 d6f7 e9f9 e5g5 a3a0 d0d1 c2c0 e1d0 c0c5 d0e1 c5g5 f7g5 a8b8 h6h9 f9e9 h9g9 e8f9 g5f7 b8f8",
        "lineEval": "±"
      },
      "42": {
        "glyph": "?!",
        "note": "inaccuracy: 8.1 win% given up, eval +1.66 after. The engine wanted the line in the sibling branch.",
        "line": "d9e8 h0h5 g6g5 g4g5 e8d7 g5g6 b3b4 d6c4 a8c8 h5d5 e6c5 e4e3 c3e3 g2e3 c8c6 g6g7 c6e6 e3g4 d4f3 d5f5 f3d4 f5f2 d7e8 g7g8 g9i7 e1d2 i7g5",
        "lineEval": "⩲"
      },
      "46": {
        "glyph": "?!",
        "note": "inaccuracy: 7.8 win% given up, eval +2.54 after. The engine wanted the line in the sibling branch.",
        "line": "d9e8 h0h5 g6g5 h5h7 b4b7 h7h6 b7b9 e3b3 b9b2 g2e3 b2e2 g0e2 c2e2",
        "lineEval": "±"
      },
      "49": {
        "glyph": "??",
        "note": "blunder: 15.4 win% given up, eval +0.91 after. The engine wanted the line in the sibling branch.",
        "line": "h0h8 g6g5 h8f8 g5g4 c4b6 d4c6 d8d9 e9d9 f8f9 d9d8 f9f8 d8d9 b2b0 d7d1 b0d0 d1d0 e1d0 b4b0 e2c0 c2c0 e3b3 e6d4 f8f9 d9d8",
        "lineEval": "±"
      },
      "50": {
        "glyph": "?!",
        "note": "inaccuracy: 6.5 win% given up, eval +1.66 after. The engine wanted the line in the sibling branch.",
        "line": "d7d9 e1d2 d9c9 h0h5 f9e8 f0e1 c9c5 h5c5 e7c5 e3b3 b4b2 g2e3 c2c1 b3b2 c1c3 e3d5 c3i3 b2b6",
        "lineEval": "±"
      },
      "52": {
        "glyph": "?!",
        "note": "inaccuracy: 6.0 win% given up, eval +2.35 after. The engine wanted the line in the sibling branch.",
        "line": "c2c1 f0e1 c1b1 h0h8 d7d8 h8d8 d9d8 g2h4 g6g5 h4g6 e7c5 e1d0 g5g4 d2e1 d8e8 e2g4 g9e7 g0e2 b4b9",
        "lineEval": "±"
      },
      "59": {
        "glyph": "??",
        "note": "blunder: 16.5 win% given up, eval +0.70 after. The engine wanted the line in the sibling branch.",
        "line": "b2b0 d4f3 h0h1 e6d4 b0d0 d9e9 h1f1 e8e2 e0f0 e2h2 f1f3 d4f3 d0d7 c1c0 e1d0 h2h7 e3f1 c0c4 b3f3 f9e8 d7g7 c4c7 g7g8 c7e7 g8i8 h7f7",
        "lineEval": "±"
      },
      "60": {
        "glyph": "?",
        "note": "mistake: 10.2 win% given up, eval +1.88 after. The engine wanted the line in the sibling branch.",
        "line": "c1b1 e1d0 b1f1 d0e1 f1f3 h2f2 d7f7 e3d5 f3f2 e1f2 e6f4 d2e1 f4d5 b2d2 d9e9 d2d5 f7c7 d5e5 g9e7 e5b5 c7b7",
        "lineEval": "⩲"
      },
      "61": {
        "glyph": "?",
        "note": "mistake: 13.2 win% given up, eval +0.37 after. The engine wanted the line in the sibling branch.",
        "line": "b2b0 d9e9 b0d0 g9e7 b3b9 d4f3 h2f2 e8i8 b9b6 e6c5 b6g6 i8i3 g6i6",
        "lineEval": "±"
      },
      "76": {
        "glyph": "??",
        "note": "blunder: 28.8 win% given up, eval +4.25 after. The engine wanted the line in the sibling branch.",
        "line": "f4d5 d2d5 d8d7 d5d6 c9e7 f2e1 i6i5 c3e3 b0b5 e3e4 b5c5 d6f6 c5f5 f6b6 d4c2 b6e6 e9f9 e6e8 e7c5 e4e5 c2d4 e5f5 d4f5 c4e5",
        "lineEval": "⩲"
      }
    }
  }
};

const C_XYC2007: XiangqiReplaySpec = {
  "iccs": "h2e2 h9g7 h0g2 g6g5 i0h0 i9h9 h0h6 b9c7 b0c2 c6c5 a0a1 b7b6 h6h4 c9e7 g3g4 g5g4 h4g4 g7f5 a1f1 b6b5 f1h1 a9a8 c3c4 c5c4 g4c4 h9h8 c4f4 e7c5 e2f2 h7f7 h1h8 a8h8 f4c4 f7f2 b2f2 g9e7 g2f4 h8h2 d0e1 f9e8 c0e2 h2h4 c4b4 f5g7 f2g2 g7h5 g2g4 h5f4 b4f4 b5b9 f4b4 b9a9 b4b6 a9c9 c2b4 e8f7 a3a4 h4h3 g4c4 c7e8 c4c9 e8c9 b6e6 h3i3 b4a6 d9e8 a4a5 i3i5 a5b5 c9d7 e3e4 c5a7 a6c7 e7c9 e6d6 i5f5 c7d5 d7f8 d5c3 i6i5 b5b6 e8d9 c3d1 f7e8 d1e3 f5g5 e3c4 g5g6 d6d5 i5i4 c4d6 e8d7 b6c6 d9e8 d5i5 i4h4 i5h5 h4i4 e4e5 g6f6 e5f5 f6e6 h5h3 f8g6 h3d3 g6h8 d3f3 h8i6 f5f6 e6e5 d6c4 e5c5 c6d6 i6g5 f3e3 e9d9 d6d7 e8d7 e3d3 d9e9 d3d7 i4h4 d7g7 e9e8 g7g8 e8e7 g8d8 g5e4 f6e6 e7f7 d8e8",
  "red": "Xu Yinchuan",
  "black": "Nguyễn Vũ Quân",
  "event": "2007 10th World Xiangqi Championship",
  "resultText": "1-0",
  "annotations": {
    "byPly": {
      "56": {
        "glyph": "?!",
        "note": "inaccuracy: 5.7 win% given up, eval +0.76 after. The engine wanted the line in the sibling branch.",
        "line": "h4h5 a3a4 e7g9 b4a6 h5e5 b6b7 c7d5 a6c5 d5e3 c5d3 e5d5 g4g3 e3f5 d3b4 d5d7 b7d7 e8d7 g3g1 f5d4 e1f2 e6e5 g1e1",
        "lineEval": "="
      },
      "116": {
        "glyph": "?!",
        "note": "inaccuracy: 8.6 win% given up, eval +2.67 after. The engine wanted the line in the sibling branch.",
        "line": "e9f9 c4e5 c5d5 d6d7 e8d7 e5g6 g5i6 f6f7 d5f5 f7f8 f5f8 g6f8 f9f8 e3g3 f8e8 g3g8 e8e9 g8g9 e9e8 e2g4 i6h4 g9g5 i4i3 g5e5 e8d8 e5f5 d8e8 f5f6",
        "lineEval": "±"
      },
      "124": {
        "glyph": "?!",
        "note": "inaccuracy: 8.0 win% given up, eval +4.40 after. The engine wanted the line in the sibling branch.",
        "line": "e9f9 f6g6 f9e9 g7h7 h4g4 h7h9 e9e8 g6g7 g4f4 h9h8 e8e7 h8h6 f4e4 h6d6 e7e8 e0d0 g5f3 d6e6 c9e7 e6e4 c5d5 e1d2",
        "lineEval": "+−"
      }
    }
  }
};

const C_ZXX2009: XiangqiReplaySpec = {
  "iccs": "h2e2 h9g7 h0g2 i9h9 i0h0 b9c7 c3c4 g6g5 b0c2 b7b3 e3e4 h7h3 e4e5 d9e8 e5d5 c9e7 d0e1 a9d9 g2e3 c6c5 c4c5 e7c5 d5c5 d9d3 e3d5 c7d5 c2b4 d3c3 b4d5 c3c5 d5f6 h9h8 b2d2 h8f8 f6e4 c5d5 a0b0 f8f4 g3g4 d5d3 e4c5 d3e3 h0h3 b3h3 b0b9 e8d9 c5d7 e9e8 b9b8 e8e7 b8b7 e7f7 d7b8 g9e7 b8d9 g7f5 b7b8",
  "red": "Zhao Xinxin",
  "black": "Nguyễn Thành Bảo",
  "event": "2009 11th World Xiangqi Championship",
  "resultText": "1-0",
  "annotations": {
    "byPly": {
      "32": {
        "glyph": "?",
        "note": "mistake: 10.9 win% given up, eval +1.20 after. The engine wanted the line in the sibling branch.",
        "line": "b3e3 g3g4 c5d5 a0a2 e8f7 b2d2 d5c5 a2a0 c5d5 a0a2",
        "lineEval": "="
      },
      "34": {
        "glyph": "?!",
        "note": "inaccuracy: 8.3 win% given up, eval +2.24 after. The engine wanted the line in the sibling branch.",
        "line": "b3e3 a0b0 g9e7 g3g4 g5g4 f6g4 c5c3 c0a2 g7f5 h0h2 h8g8 g4e3 c3e3 b0b5 e3f3 e2f2 f5h4",
        "lineEval": "±"
      },
      "40": {
        "glyph": "?",
        "note": "mistake: 11.3 win% given up, eval +4.03 after. The engine wanted the line in the sibling branch.",
        "line": "f4f3 e4f6 d5f5 f6g8 e9d9 g4g5 f5f8 g8i9 f8i8 g5g6 i8i9 g6g7 i9i7 g7g8 i7g7 g8g9 g7g9 e2i2 g9g4 d2d0",
        "lineEval": "±"
      },
      "52": {
        "glyph": "??",
        "note": "blunder: 16.3 win% given up, eval #12 after. The engine wanted the line in the sibling branch.",
        "line": "e7e8 d7b6 e3e5 b7g7 h3e3 g7g8 f4f8 g8f8 e8f8 b6d7 f8f7 d7e5 e6e5 g4g5 e5e4 d2d5 e4f4 g5g6 f7f8 g6f6 e3f3 e2f2 f8e8 e0d0 f3b3 f2a2 b3b0 d0d1 b0a0 a2e2 a0b0 d5e5",
        "lineEval": "+−"
      }
    }
  }
};

const C_JC2011: XiangqiReplaySpec = {
  "iccs": "h2e2 h9g7 h0g2 i9h9 i0h0 b9c7 g3g4 c6c5 b0a2 a6a5 b2c2 c7b5 a0a1 a5a4 a3a4 a9a4 h0h4 a4d4 a1f1 g9e7 g2f4 f9e8 f4g6 h7h6 f1f4 d4d3 f4e4 b5c3 f0e1 b7b6 g6f4 c3a2 e2a2 d3c3 c2g2 c3c0 g2g7 c0c2 e4b4 h9h7 g4g5 e7g5 a2a6 c2c4 b4b5 h7g7 a6e6 g5e7 g0e2 c4d4 b5b6 d4f4 h4h6 g7g3 h6h9 f4f9 h9f9 e9f9 e6e5 g3e3 b6f6 f9e9 e5e6 e3h3 f6i6 h3f3 i3i4 e9f9 i6h6 f3f5 h6g6 e8f7 g6i6 f7e8 i6h6 e7g9 h6h9 c9e7 e6b6 f5g5 e1f2 f9e9 b6b5 g5g6 b5b9 e7c9 i4i5 e8f9 f2e1 c5c4 h9h4 g6b6 b9a9 c4b4 i5h5 b4b3 a9a4 c9e7 h5h6 d9e8 h6h7 b6a6 h7h8 b3c3 a4c4 c3d3 h4h3 a6d6 c4i4",
  "red": "Jiang Chuan",
  "black": "Lei Kam Fun",
  "event": "2011 12th World Xiangqi Championship",
  "resultText": "1-0",
  "annotations": {
    "byPly": {
      "24": {
        "glyph": "?!",
        "note": "inaccuracy: 5.9 win% given up, eval +0.86 after. The engine wanted the line in the sibling branch.",
        "line": "b5a3 c2c1 a3c2 e3e4 d4e4 f1d1 c2e3 d1d9 e8d9 e2e4 b7b6 g4g5 h7i7 h4f4 h9h6 c0e2 b6g6 c1e1 g6g0 e2g0 e6e5",
        "lineEval": "="
      },
      "26": {
        "glyph": "?!",
        "note": "inaccuracy: 7.1 win% given up, eval +1.63 after. The engine wanted the line in the sibling branch.",
        "line": "d4f4 g6f4 b5a3 c2d2 b7b5 f4g6 h6h5 f0e1 h5e5 h4h9 g7h9 d2d3 a3c2 e2d2 b5b6 g6f4 c2a1 g0e2 e5f5 d2b2 h9g7",
        "lineEval": "±"
      },
      "27": {
        "glyph": "?!",
        "note": "inaccuracy: 8.8 win% given up, eval +0.63 after. The engine wanted the line in the sibling branch.",
        "line": "a2b4 d3c3 b4d5 c3c2 d5e7 c9e7 g6e7 e8d7 e7g8 e9e8 f4a4 b7a7 g4g5 h9h8 g5g6 c2c4 a4c4 c5c4 h4c4 e8f8 c4c8 d9e8 c8c5 e6e5 e2f2 h8g8 c5e5 b5c3 e5f5 e8f7",
        "lineEval": "±"
      },
      "31": {
        "glyph": "?!",
        "note": "inaccuracy: 6.3 win% given up, eval +0.41 after. The engine wanted the line in the sibling branch.",
        "line": "g4g5 d3d5 e4g4 c5c4 e2d2 b6b3 e3e4 b3i3 h4h3 i3i0 g0i2 c3a2 d2a2",
        "lineEval": "±"
      },
      "42": {
        "glyph": "??",
        "note": "blunder: 20.2 win% given up, eval +2.68 after. The engine wanted the line in the sibling branch.",
        "line": "h7g7",
        "lineEval": "⩲"
      }
    }
  }
};

const C_XC2019: XiangqiReplaySpec = {
  "iccs": "h2e2 h9g7 h0g2 i9h9 i0h0 c6c5 b0a2 b9c7 b2c2 c7b5 h0h6 c9e7 a0a1 d9e8 a1d1 g6g5 e3e4 a9b9 e2e6 g7e6 h6e6 b5a3 c2e2 h7g7 e6a6 g7g3 g2e3 b7b3 c3c4 b3b2 c4c5 h9h3 e4e5 g3g4 a6a3 h3g3 d1d3 g4g0 f0e1 g0i0 a3b3 g3g0 e1f0 g0g1 f0e1 g1g0 e1f0 g0g1 f0e1 g1g0 e1f0 b9c9 b3b2 g0g1 f0e1 g1g0 e1f0 g0g1 f0e1 g1g0 e1f0 g5g4 e2c2 g0g1 f0e1 g1g0 e1f0 g0g1 f0e1 g1g0 e1f0 c9a9 e0e1 g0g1 e1e2 g4g3 e3f5 g3g2 f5h4 i0h0 h4g2 h0h2 g2f4 g1g2 e2e1 g2g4 c2c1 g4f4 b2h2 f4f0 c5d5 a9a4 h2b2 a4e4 c0e2 e4h4 b2b0 e8d9 e1d1 f9e8 d0e1 f0f6 d5d6 h4e4 e5e6 f6f5 d3d2 e4e3 d6d7 e3e6 d7d8 e9f9 b0b9 f9f8 b9b8",
  "red": "Xu Chao",
  "black": "Huang Xueqian",
  "event": "2019 16th World Xiangqi Championship",
  "resultText": "1-0",
  "annotations": {
    "byPly": {
      "30": {
        "glyph": "?!",
        "note": "inaccuracy: 7.2 win% given up, eval +1.42 after. The engine wanted the line in the sibling branch.",
        "line": "a3b5 e2b2 h9h4 e3f1 h4e4 d1e1 e4e1 d0e1 g5g4 a6a5 c5c4 b2b5 b3i3 b5e5 g3d3 e5e2 i3i5 a5d5 b9d9 d5f5 c4d4 f1e3",
        "lineEval": "⩲"
      },
      "32": {
        "glyph": "?!",
        "note": "inaccuracy: 8.7 win% given up, eval +2.33 after. The engine wanted the line in the sibling branch.",
        "line": "h9h2 d1b1 h2f2 e4e5 f2f3 e3d5 a3c4 b1d1 c4e5 d1d4 b9d9 d4e4 e5g4 d5f6 b2b8 a2b4 g3h3",
        "lineEval": "±"
      },
      "50": {
        "glyph": "??",
        "note": "blunder: 32.9 win% given up, eval #1 after. The engine wanted the line in the sibling branch.",
        "line": "b9b3 d3b3 g1g0 e1f0 b2d2 e5d5 d2d1 e2e7 e8d9 e7g7 g0g1 f0e1 g1h1 g7f7 d1d4 b3b4 h1h0 e1f0 d4d1 b4e4 d9e8 e0e1 h0h1 f7f1 d1f1 e3f1 i0i1 e4b4 g9e7 b4b9 e8d9 b9b7",
        "lineEval": "±"
      },
      "51": {
        "glyph": "??",
        "note": "blunder: 32.9 win% given up, eval +1.93 after. The engine wanted the line in the sibling branch.",
        "line": "e1f0",
        "lineEval": "+−"
      },
      "52": {
        "glyph": "?",
        "note": "mistake: 11.3 win% given up, eval +3.50 after. The engine wanted the line in the sibling branch.",
        "line": "b9b3 d3b3 b2d2 e5d5 g0g2 f0e1 g2g0 e1f0 d2d1 e2e7 g9e7 b3b9 e8d9 e3d1 g0g1 f0e1 e7c5 d5e5 g1g0 e1f0 g0g2 f0e1 g5g4 b9b2 g2g0 e1f0 g0g3 f0e1 i0i1 d1b0 i1i0 b2i2",
        "lineEval": "±"
      },
      "60": {
        "glyph": "??",
        "note": "blunder: 16.5 win% given up, eval #1 after. The engine wanted the line in the sibling branch.",
        "line": "i0h0 e0f0 g1g0 f0f1 g0g3 a2b4 g3g1 f1f0 g1g0 f0f1 h0h2 e1f2 h2e2 c0e2 c9c5 e3d5 g5g4 b4c2 e8d9 f1e1",
        "lineEval": "+−"
      },
      "61": {
        "glyph": "??",
        "note": "blunder: 19.7 win% given up, eval +3.80 after. The engine wanted the line in the sibling branch.",
        "line": "e1f0",
        "lineEval": "+−"
      },
      "70": {
        "glyph": "??",
        "note": "blunder: 18.4 win% given up, eval #1 after. The engine wanted the line in the sibling branch.",
        "line": "c9a9 e1d2 g1g0 e0e1 g0g1 e1e0 e7c9 e3f5 g1g0 e0e1 g0g1 e1e0 g4f4 b2b4 g1g5 c2c1 g5g1 e5e6",
        "lineEval": "+−"
      },
      "71": {
        "glyph": "??",
        "note": "blunder: 17.2 win% given up, eval +4.25 after. The engine wanted the line in the sibling branch.",
        "line": "e1f0",
        "lineEval": "+−"
      }
    }
  }
};

const C_WTY2022: XiangqiReplaySpec = {
  "iccs": "c3c4 g6g5 b0c2 h9g7 h2e2 b9c7 h0g2 i9h9 i0i1 c9e7 i1f1 h7i7 e3e4 d9e8 b2a2 a9b9 a0b0 b7b3 a3a4 g5g4 g3g4 h9h5 f1f3 h5b5 f0e1 b3b2 e2f2 b2f2 b0b5 b9b5 a2f2 g7h5 g0e2 b5d5 f2f1 i7g7 g2h4 c6c5 c2a3 g7h7 h4g2 h7g7 g2h4 g7h7 h4g2 e6e5 c4c5 d5c5 e4e5 c5e5 a3c4 e5c5 e1d2 c7e6 f1c1 c5b5 c1e1 e6c5 g4g5 e7g5 f3f5 g9e7 f5f6 c5d7 f6h6 h7g7 g2h4 b5b3 c4e3 b3d3 h6h5 d7c5 h4f5 g7g6 e1h1 d3d2 d0e1 d2d7 h5h6 g6e6 h6g6",
  "red": "Wang Tianyi",
  "black": "Wang Kuo",
  "event": "2022 17th World Xiangqi Championship",
  "resultText": "1-0",
  "annotations": {
    "byPly": {
      "46": {
        "glyph": "?!",
        "note": "inaccuracy: 7.5 win% given up, eval +1.28 after. The engine wanted the line in the sibling branch.",
        "line": "h7f7 f1i1 h5g7 f3h3 d5h5 h3h5 g7h5 c4c5 e7c5 a3c4 f7i7 i1i6 h5i3 g2h4 c5e7 h4g6 i3h5 c4d6 i7i8 e1f2 h5i7 i6i8 i7g6",
        "lineEval": "⩲"
      },
      "64": {
        "glyph": "?!",
        "note": "inaccuracy: 7.9 win% given up, eval +3.59 after. The engine wanted the line in the sibling branch.",
        "line": "b5b3 e1e7 e9d9 e7e3 h5g3 c4e5 c5b7 d0e1 b3b0 f6f3 g3i2 f3f4 i2g1 f4f1 g1i0 f1i1 h7g7 i1i0 g7g2 e3h3 b0b6 i0g0 b6h6",
        "lineEval": "±"
      }
    }
  }
};

const C_MC2023: XiangqiReplaySpec = {
  "iccs": "b0c2 c6c5 h0i2 b9c7 i3i4 g6g5 i2h4 a9a8 b2a2 h7h2 a2h2 c7b5 h4f5 a8d8 a0a1 i9i7 g3g4 g5g4 f5h6 g4h4 a1g1 i7g7 i0i1 h4h3 h2e2 h3g3 h6f5 g7g5 f5g3 h9g7 g3e4 g5g1 i1g1 g7f5 e4c5 b7e7 c3c4 d9e8 f0e1 b5c3 g1g9 f5d4 e2h2 e7h7 g9g7 h7h9 g0e2 d8d5 c5b7 d4f3 g7g3 f3g5 b7c9 g5i4 h2h4 d5h5 h4h9 h5h9 g3i3 i4g5 i3g3 g5i4 g3g6 i4h2 c9b7 h9h4 b7d6 e9d9 d6b5",
  "red": "Meng Chen",
  "black": "Lại Lý Huynh",
  "event": "2023 18th World Xiangqi Championship",
  "resultText": "1-0",
  "annotations": {
    "byPly": {
      "15": {
        "glyph": "?!",
        "note": "inaccuracy: 5.4 win% given up, eval -1.10 after. The engine wanted the line in the sibling branch.",
        "line": "i0i3 d8d5 i3h3 d5f5 h2h9 i9i7 d0e1 f5f7 c0e2 f7h7 h3h7 i7h7 h9i9 h7h9 i9i8 h9h8 i8i9 d9e8 a0d0 b5c3 d0d3 b7c7 c2b0 h8h9 i9i8 h9h8",
        "lineEval": "⩱"
      },
      "28": {
        "glyph": "?!",
        "note": "inaccuracy: 6.8 win% given up, eval -0.66 after. The engine wanted the line in the sibling branch.",
        "line": "g7d7 f0e1 b7c7 i1h1 h9g7 f5g3 c5c4 g3e4 c4c3 c2a1 d7f7 g1g5 b5d4 g5c5 c3d3 c5c4 g7f5 h1g1 d3d2 e1d2 d4e2 c0e2 d8d2",
        "lineEval": "∓"
      },
      "42": {
        "glyph": "?",
        "note": "mistake: 12.8 win% given up, eval +2.03 after. The engine wanted the line in the sibling branch.",
        "line": "c3e2 c0e2 e7c7 c2b4 c7a7 g9g6 a7a3 g6e6 d8d6 e6e5 f5h4 c5e4 d6g6 e5g5 g6g5 e4g5 c9e7 g5h7 h4f5 e3e4 f5d6 h7f6 a3a0 e2c0 d6c4 f6g8 e9d9 g8e7 a0a4 e7f5 c4b2",
        "lineEval": "⩲"
      },
      "64": {
        "glyph": "?",
        "note": "mistake: 10.1 win% given up, eval +3.31 after. The engine wanted the line in the sibling branch.",
        "line": "h9h0 e1f0 h0h6 g6g1 e6e5 g1b1 h6d6 c9b7 d6d9 f0e1 i4g5 b1b6 d9b9 c4c5 g5h3 b7d6 h3g1 e0f0 b9b6",
        "lineEval": "±"
      }
    }
  }
};

export const xiangqiWorldChampionshipArticle: Article = {
  slug: 'xiangqi-world-championship',
  kind: 'article',
  publisher: 'mistboard',
  boardFamily: 'xiangqi',
  title: 'The Xiangqi World Championship',
  seoTitle: 'Xiangqi World Championship: Every Winner, and Why It Is Not the Senior Title',
  summary:
    'Every winner of the Xiangqi World Championship since 1990, why the Chinese national title is the harder one, and how a Vietnamese player took it out of China for the first time in 2025.',
  status: 'published',
  // Dated the 30th, not the 29th. It went live late on the 29th, hours after
  // the national-championship article it answers, and two pieces of one
  // argument landing the same day read as a dump rather than as a pair. The
  // date is what the reader and the feed see, so it carries the stagger.
  publishedAt: '2026-08-30',
  audience:
    'Readers who have met the national champions and want to know what the international title is worth.',
  thumbnail: { kind: 'svg', svg: WORLD_TITLE_THUMBNAIL },
  structuredData: () => [
    {
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      name: 'Xiangqi world champions, 1990 to 2025',
      numberOfItems: WORLD_CHAMPIONS.length,
      itemListOrder: 'https://schema.org/ItemListOrderAscending',
      itemListElement: WORLD_CHAMPIONS.map((champ, index) => ({
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
  intro: [
    {
      kind: 'paragraph',
      text: 'The World Xiangqi Championship has been held roughly every two years since 1990, organised by the World Xiangqi Federation. English readers tend to assume it is the senior title, the way the world chess championship is. It is not, and the reason is worth understanding before the list makes sense.',
    },
    {
      kind: 'paragraph',
      text: 'The Chinese national championship is the harder one to win. Almost everyone capable of winning either is Chinese, and only a handful of them qualify for the world event. For its first thirty-five years the world title was, in practice, a smaller Chinese championship with guests, and then in 2025 it left China for the first time.',
    },
  ],
  sections: [
    {
      heading: 'Every world champion, 1990 to 2025',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Nineteen editions, eleven winners. One row per player, in the order they first took the title, with a bar over the years they held it.',
        },
        {
          kind: 'raw-svg',
          svg: xiangqiWorldTitleTimelineSvg,
          zoomable: true,
          caption:
            'Hatched columns are years with no championship. The number after each name is that player’s title count.',
        },
        {
          kind: 'paragraph',
          text: 'Two things fall out of the shape. The left half belongs to three men, and the right half turns red at 2009 and stays red until the last row.',
        },
        {
          kind: 'table',
          compact: true,
          wrap: true,
          headers: ['Champion', 'Titles', 'Years', 'Association ruling'],
          rows: worldChampionTableRows(),
          caption:
            'The same record as the figure, with the years written out. Every entry in the last column is a published ruling of the Chinese Xiangqi Association, not an allegation; the section below explains them.',
        },
        {
          kind: 'cta',
          buttons: [
            {
              label: 'The national title, and every champion since 1956',
              href: '/blog/xiangqi-champions',
              emphasis: 'secondary',
            },
          ],
        },
      ],
    },
    {
      heading: 'Lü Qin 吕钦, 1990',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Five world titles across fifteen years and five Chinese national titles, 1986 to 2004. Guangdong called him 羊城少帅, the Young Marshal of Guangzhou, and later paired him with Xu Yinchuan as 岭南双雄, the twin heroes of Lingnan. He is the most decorated player on this page and was never, in any single year, the best player in China.',
        },
        {
          kind: 'paragraph',
          text: 'That sentence is the article in miniature. Hu Ronghua was ahead of him at home for most of his career and never entered this event; Lü Qin won it five times. Wu Guilin of Chinese Taipei was the strongest player outside the mainland for two decades and the recurring answer to who could actually beat these men, and Lü Qin beat him in 1990, 1995 and 1997.',
        },
        {
          kind: 'xq-replay',
          spec: { ...C_LQ1997 },
          caption:
            'Lü Qin vs Wu Guilin, 1997, from the fifth championship and the third of his five titles.',
        },
      ],
    },
    {
      heading: 'Zhao Guorong 赵国荣, 1991',
      blocks: [
        {
          kind: 'paragraph',
          text: 'World champion in 1991 and four times Chinese national champion, spread across eighteen years from 1990 to 2008, which is a longer span at the top than anyone here except Hu Ronghua managed. He learned in Harbin under Wang Jialiang, known as the Northeast Tiger, and the sport made him the New Northeast Tiger in turn.',
        },
        {
          kind: 'paragraph',
          text: 'He is one of three men on this list with no ruling against him.',
        },
        {
          kind: 'xq-replay',
          spec: { ...C_ZGR1991 },
          caption:
            'Zhao Guorong vs Wu Guilin, 1991, from the championship he won.',
        },
      ],
    },
    {
      heading: 'Xu Tianhong 徐天红, 1993',
      blocks: [
        {
          kind: 'paragraph',
          text: 'World champion in 1993 in Beijing with seven and a half points from nine, the year after taking the Chinese national title. He is from Taizhou in Jiangsu, and the sport calls him 笑面佛, the Smiling Buddha, because he smiles right through a game. What is behind the smile is tight openings and a habit of grinding advantages too small to see into wins.',
        },
        {
          kind: 'paragraph',
          text: 'He is the one champion here without a game, and that is a fact about the archives rather than about him. Four games survive from the 1993 edition in the databases this article draws on, and none of them are his. Showing a game from another event would be a different claim than the one this page makes.',
        },
      ],
    },
    {
      heading: 'Xu Yinchuan 许银川, 1999',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Three world titles, 1999, 2003 and 2007, alongside six Chinese national championships. He won his first national title at eighteen, second only to Hu Ronghua’s fifteen, and spent two decades as the best player in the country not named Hu Ronghua.',
        },
        {
          kind: 'paragraph',
          text: 'Like Lü Qin he came out of Guangdong, like Lü Qin he built his game on endgames, and like Lü Qin he is one of the three men here with a clean record.',
        },
        {
          kind: 'xq-replay',
          spec: { ...C_XYC2007 },
          caption:
            'Xu Yinchuan vs Nguyễn Vũ Quân, 2007, from the last of his three titles. Our engine grades him 98.5, the cleanest game on this page.',
        },
      ],
    },
    {
      heading: 'Zhao Xinxin 赵鑫鑫, 2009',
      blocks: [
        {
          kind: 'paragraph',
          text: 'From Taizhou in Zhejiang, national champion at nineteen in 2007, and world champion at twenty-one in 2009 with fifteen points from nine games. He is still the youngest man to have won this title, and taking it completed the set of national, Asian and world championships that Chinese xiangqi calls a grand slam.',
        },
        {
          kind: 'paragraph',
          text: 'He was banned for life on 12 January 2025, in the ruling that sanctioned forty-one people at once.',
        },
        {
          kind: 'xq-replay',
          spec: { ...C_ZXX2009 },
          caption:
            'Zhao Xinxin vs Nguyễn Thành Bảo, 2009, from the championship he won.',
        },
      ],
    },
    {
      heading: 'Jiang Chuan 蒋川, 2011',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Born in Yongjia, Zhejiang, in 1984. He took the Chinese national title in 2010 and the world title in Jakarta the year after, and he was the first player to pass 2700 on the rating list.',
        },
        {
          kind: 'paragraph',
          text: 'He is better known outside the tournament hall for blindfold play. On 3 January 2011 he took nineteen boards at once against Liu Dahua’s record and beat it with twenty, ending a mark that had stood since February 1995; he went to twenty-two in 2013 and to twenty-six after that, which is where the Guinness entry sits. He drew a five-year ban in April 2026.',
        },
        {
          kind: 'xq-replay',
          spec: { ...C_JC2011 },
          caption:
            'Jiang Chuan vs Lei Kam Fun, 2011, from the championship he won.',
        },
      ],
    },
    {
      heading: 'Wang Tianyi 王天一, 2013',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Three world titles and four Chinese national ones, and ten consecutive years at the top of the world rating list. In May 2023 he became the first player to hold a live rating above 2800. Beijing called him 外星人, the alien, for arriving from outside the provincial team system and beating everyone anyway.',
        },
        {
          kind: 'paragraph',
          text: 'The Chinese Xiangqi Association banned him for life in September 2024 and revoked his grandmaster title. A court in Hangzhou convicted him a year later.',
        },
        {
          kind: 'paragraph',
          text: 'The opponent below is the reason to show this particular game: Wang Kuo is himself a Chinese national champion, and the strongest man Wang Tianyi faced across his three world finals.',
        },
        {
          kind: 'xq-replay',
          spec: { ...C_WTY2022 },
          caption:
            'Wang Tianyi vs Wang Kuo, 2022, from the third of his three titles.',
        },
      ],
    },
    {
      heading: 'Zheng Weitong 郑惟桐, 2015',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Born in Chengdu in 1994. He took the Chinese national title in 2014 and again in 2015, then the world title in the same year, which is the harder order to do it in. He went to Tsinghua by recommendation in 2020 and won the individual gold at the 2023 Asian Games, China’s two hundredth medal of those Games.',
        },
        {
          kind: 'paragraph',
          text: 'He was banned for life on 12 January 2025. His title year also produced the longest game in either of these articles, and the opponent is the reason to show it.',
        },
        {
          kind: 'xq-replay',
          spec: { ...C_ZWT2015 },
          caption:
            'Lại Lý Huynh vs Zheng Weitong, 2015. Two hundred and seventy-four plies, and the man who loses it here takes the world title himself ten years later.',
        },
      ],
    },
    {
      heading: 'Xu Chao 徐超, 2019',
      blocks: [
        {
          kind: 'paragraph',
          text: 'From Wujiang in Suzhou, born 1981, playing from the age of seven and national youth champion at sixteen. He waited a long time for the senior title and took it in 2017 by beating the defending champion Wang Tianyi, becoming the nineteenth man to win the Chinese championship. The world title followed in Vancouver in 2019.',
        },
        {
          kind: 'paragraph',
          text: 'He was banned for life in April 2026.',
        },
        {
          kind: 'xq-replay',
          spec: { ...C_XC2019 },
          caption:
            'Xu Chao vs Huang Xueqian, 2019, the final round. This is the game that won it: nine judged moves between them, and six of those are blunders.',
        },
      ],
    },
    {
      heading: 'Meng Chen 孟辰, 2023',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Born in Anshan, Liaoning, in 1988, and one of only two men on this list who never won the Chinese national championship. He took the 2023 world title in Houston by beating Lại Lý Huynh in a tiebreak, which is the second time on this page that the future champion loses to a champion before becoming one.',
        },
        {
          kind: 'paragraph',
          text: 'He drew a six-month ban in January 2025, the lightest ruling here.',
        },
        {
          kind: 'xq-replay',
          spec: { ...C_MC2023 },
          caption:
            'Meng Chen vs Lại Lý Huynh, 2023. The second time the future champion loses to a champion before becoming one.',
        },
      ],
    },
    {
      heading: 'Why the national title is the harder one',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Lü Qin has five of the nineteen titles, Xu Yinchuan three and Wang Tianyi three, so eleven of the nineteen editions belong to three men. Nine of the eleven world champions also won the Chinese national championship. The two who did not are Meng Chen, who took the 2023 world title, and Lại Lý Huynh, who is Vietnamese and could never have entered the Chinese event.',
        },
        {
          kind: 'paragraph',
          text: 'That is the whole argument in one line. The world field is drawn from the same pool as the national field, minus most of it. China sends a small delegation, the rest of the entry is the strongest players from everywhere else, and for thirty-five years everywhere else was not close. A player who can win in Beijing can usually win in Singapore or Vancouver; the reverse has almost never been true.',
        },
        {
          kind: 'paragraph',
          text: 'The comparison English readers reach for is the wrong way round. The world title here is closer to a strong invitational than to a world championship, and the national championship is the thing with the deep field, the long history and the names everyone knows. Lü Qin has five world titles and never finished a year as the best player in China; Hu Ronghua, who was that player for two decades, never won this event at all.',
        },
      ],
    },
    {
      heading: 'The decade with a ruling on it',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Every edition from 2009 to 2023 was won by a man who now has a published ruling against him. That is eight championships and six men: three banned for life, one convicted in court, one given five years, and one given six months.',
        },
        {
          kind: 'paragraph',
          text: 'The rulings came out of the match-fixing case the Chinese press calls 录音门, the recording gate, which the Chinese Xiangqi Association worked through between 2024 and 2026. It has [a page of its own](/blog/xiangqi-match-fixing): the investigation, everyone sanctioned, the reasoning, and the sources. The findings are by the sport’s own governing body rather than allegations, and they are about those players’ careers rather than about specific world championship games.'
        },
        {
          kind: 'paragraph',
          text: 'The names stay in the table and the sections stay on the page. A list that quietly dropped them would be a worse record of what happened, and what the rulings do not tell you is which games were fixed. The [national championship list](/blog/xiangqi-champions) tells the same decade from the other side, where ten of the thirteen men who have won since 2005 carry a ruling.',
        },
      ],
    },
    {
      heading: 'Shanghai, September 2025',
      blocks: [
        {
          kind: 'paragraph',
          text: 'The 2025 championship was played in Shanghai in September, and won by Lại Lý Huynh of Vietnam, who beat Yin Sheng of China in the final on the twenty-seventh. He is the first man from outside China to take the standard title in the thirty-five years the event has existed.',
        },
        {
          kind: 'xq-replay',
          spec: { ...C_BV0kkYY4 },
          caption:
            'Lại Lý Huynh vs Fung Ka-chun, 23 September 2025, four days before the final. Two hundred and seventeen plies, and the engine has him level as late as move ninety.',
        },
        {
          kind: 'paragraph',
          text: 'It is tempting to read the two facts together, as though the bans opened a door. That reading is too neat. He was born in Vĩnh Long in 1990, won the world rapid title in 2022, and reached this final in 2023 before losing it to Meng Chen in a tiebreak. He appears twice more on this page, losing to Zheng Weitong in 2015 and to Meng Chen in 2023, which is a decade of arriving before he won anything. Vietnam has been the second strongest xiangqi nation for a generation without much English notice.',
        },
      ],
    },
    {
      heading: 'Where that leaves the title',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Nineteen editions, eleven winners, and a question that had the same answer for thirty-five years. The world title had never left China. Now it has, in the same decade the sport spent voiding its own results, and those two things are worth keeping separate.',
        },
        {
          kind: 'paragraph',
          text: 'What the title is worth is a separate question again, and the honest answer is that it has always been worth less than the championship held in Beijing. That is not a slight on the men who won it. It is what happens when one country is this far ahead of the rest, and it is the thing 2025 has started to change.',
        },
        {
          kind: 'paragraph',
          text:
            'Nine of the ten games on this page are chapters in a study you can work through properly: the full move tree, the engine\u2019s lines as branches you can walk, one chapter per champion in the order they appear here.',
        },
        {
          kind: 'cta',
          buttons: [
            { label: 'Learn how the pieces move', href: '/learn/xiangqi', emphasis: 'primary' },
            {
              label: 'Play through the whole study',
              href: '/study/1pfJeXA1',
              emphasis: 'secondary',
            },
          ],
        },
      ],
    },
  ],
};
