// GENERATED from two counted banqi games on Mistboard (human against the
// MistyBanqi bot), replayed through the canonical kernel. Each move list stops
// where the perpetual-chase article's diagrams stop; the players are not named
// on the page. Do not hand-edit: the diagram tests replay these through
// packages/game and assert what the captions claim.

import type { BanqiDeal } from '@mistboard/game';

// Game of 2026-09-16 that ended in a repetition draw at ply 88. Ply 79 (index
// 79, the 80th action) is the bot's flip on g2, turning up an advisor next to
// the human's chariot on g1; plies 80-87 are the shuttle that drew.
export const BANQI_CHASE_DRAW_GAME: { deal: BanqiDeal; moves: string } = {
  deal: [
    { color: 'black', role: 'advisor' },
    { color: 'black', role: 'chariot' },
    { color: 'red', role: 'soldier' },
    { color: 'red', role: 'cannon' },
    { color: 'red', role: 'soldier' },
    { color: 'black', role: 'soldier' },
    { color: 'black', role: 'chariot' },
    { color: 'black', role: 'soldier' },
    { color: 'red', role: 'elephant' },
    { color: 'black', role: 'soldier' },
    { color: 'red', role: 'soldier' },
    { color: 'black', role: 'soldier' },
    { color: 'red', role: 'cannon' },
    { color: 'red', role: 'horse' },
    { color: 'red', role: 'advisor' },
    { color: 'black', role: 'advisor' },
    { color: 'black', role: 'soldier' },
    { color: 'black', role: 'elephant' },
    { color: 'red', role: 'chariot' },
    { color: 'red', role: 'chariot' },
    { color: 'black', role: 'horse' },
    { color: 'black', role: 'elephant' },
    { color: 'red', role: 'soldier' },
    { color: 'red', role: 'soldier' },
    { color: 'black', role: 'cannon' },
    { color: 'black', role: 'cannon' },
    { color: 'red', role: 'general' },
    { color: 'black', role: 'horse' },
    { color: 'black', role: 'general' },
    { color: 'red', role: 'horse' },
    { color: 'red', role: 'elephant' },
    { color: 'red', role: 'advisor' },
  ],
  moves: [
    'e3e3 e1e1 h4h4 h3h3 f4f4 g3g3 d4d4 b4b4 b2b2 a4a4 a2a2 a3a3',
    'a4a2 a1a1 a3a4 b3b3 c2c2 c2b2 b4b2 h2h2 d2d2 f2f2 h1h1 f3f3',
    'f3f2 c1c1 f2f3 f1f1 f1e1 d1d1 a2a3 c1c2 a1a2 b1b1 b1c1 e4e4',
    'c1d1 g4g4 e4f4 c2d2 d1d2 c4c4 a4b4 c4d4 b4c4 d3d3 c4d4 d3d2',
    'b2b1 d2d1 a2b2 d1c1 b1a1 g1g1 b2b1 c1c2 b1c1 c2d2 a3a4 d2d3',
    'd4c4 d3e3 f3e3 c3c3 b3c3 e2e2 e3e2 g3f3 f4e4 f3f4 e4d4 f4e4',
    'd4d3 g4f4 e2e3 h3g3 d3d2 h4g4 h2h3 g2g2 g1f1 g2f2 f1g1 f2g2',
    'g1f1 g2f2 f1g1 f2g2',
  ].join(' '),
};

// Game of 2026-09-30: the human's general driving the bot's advisor across the empty board
// (plies 176-185) until the human's own advisor takes it on f3 (ply 186).
export const BANQI_CHASE_HERD_GAME: { deal: BanqiDeal; moves: string } = {
  deal: [
    { color: 'red', role: 'cannon' },
    { color: 'red', role: 'horse' },
    { color: 'red', role: 'chariot' },
    { color: 'black', role: 'elephant' },
    { color: 'black', role: 'soldier' },
    { color: 'red', role: 'advisor' },
    { color: 'black', role: 'advisor' },
    { color: 'black', role: 'soldier' },
    { color: 'black', role: 'soldier' },
    { color: 'red', role: 'horse' },
    { color: 'black', role: 'advisor' },
    { color: 'black', role: 'horse' },
    { color: 'black', role: 'cannon' },
    { color: 'black', role: 'general' },
    { color: 'red', role: 'elephant' },
    { color: 'black', role: 'soldier' },
    { color: 'red', role: 'chariot' },
    { color: 'red', role: 'soldier' },
    { color: 'red', role: 'advisor' },
    { color: 'red', role: 'soldier' },
    { color: 'black', role: 'soldier' },
    { color: 'red', role: 'general' },
    { color: 'black', role: 'elephant' },
    { color: 'red', role: 'soldier' },
    { color: 'red', role: 'soldier' },
    { color: 'black', role: 'cannon' },
    { color: 'black', role: 'chariot' },
    { color: 'black', role: 'chariot' },
    { color: 'red', role: 'elephant' },
    { color: 'black', role: 'horse' },
    { color: 'red', role: 'cannon' },
    { color: 'red', role: 'soldier' },
  ],
  moves: [
    'd2d2 d4d4 e3e3 b4b4 b2b2 b3b3 b4b2 a2a2 e2e2 f2f2 h4h4 b1b1',
    'c2c2 f4f4 c3c3 c3c2 e2c2 b1b2 c2c3 h2h2 f2e2 c1c1 a1a1 c1c2',
    'd1d1 c2c3 d1c1 b2a2 c1b1 e1e1 b1a1 a2b2 a1a2 b2b1 a2b2 b1c1',
    'b2b3 c3c2 b3c3 c2b2 c3c2 b2b3 c2c1 a4a4 c1c2 g3g3 c2c3 b3b2',
    'c3b3 b2c2 b3b4 a3a3 b4a4 a3b3 a4b4 b3b2 b4b3 b2a2 b3b2 c2d2',
    'e2d2 a2a3 b2b3 a3a2 e1e2 c4c4 e2f2 g1g1 d2c2 e4e4 c2d2 e4d4',
    'b3c3 d4e4 d2e2 e4f4 c4b4 g4g4 b4b3 h3h3 g3g4 f4g4 c3c4 h3h2',
    'c4d4 a2a1 b3b2 g4f4 e2e1 h4h3 e1d1 f3f3 e3f3 f4f3 d1e1 f3f2',
    'e1e2 f2f3 g2g2 g2g3 g1g2 g3g4 g2h2 h3h4 h2h3 f1f1 h3h4 g4g3',
    'h4g4 g3h3 g4g3 f3f4 g3h3 f4g4 h3g3 g4h4 d4e4 f1g1 e2f2 d3d3',
    'e4e3 d3d2 e3e2 d2d3 e2e3 d3d2 e3e2 d2d3 f2g2 g1f1 g2g1 f1e1',
    'e2e3 d3d2 g1f1 e1e2 e3e4 e2e3 e4f4 d2e2 f1g1 e2f2 f4g4 f2f1',
    'g1g2 h4g4 g3g4 e3d3 g4f4 d3c3 f4f3 c3c2 f3f2 f1g1 g2g3 c2b2',
    'g3f3 a1a2 f3e3 a2a3 e3d3 b2b1 d3d2 a3b3 d2c2 b3b4 c2b2 b1a1',
    'b2b1 a1a2 b1b2 a2a1 b2b3 a1b1 b3b4 b1b2 b4b3 b2c2 b3b2 c2d2',
    'b2c2 d2d3 c2d2 d3e3 d2d3 e3f3 f2f3',
  ].join(' '),
};
