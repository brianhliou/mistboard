// Sample game for the Banqi rules article.
//
// A real game: MistyBanqi (Strongest tier) as Red vs a human as Black, replayed
// through the banqi kernel from the recorded deal. Black wins the opening
// material — the first eight captures are all Black's — but every Black piece
// ends up dominated by Red's elephant, the highest piece left on the board, and
// Black resigns a nominally "up-material" position. In Banqi, rank beats raw
// material. Reconstructed from the finished game's truth history (the deal is
// public once the game ends); verified to replay to the recorded final position.

import type { BanqiDeal } from '@mistboard/game';

export const BANQI_SAMPLE_GAME: {
  red: string;
  black: string;
  event: string;
  result: string;
  deal: BanqiDeal;
  moves: string;
} = {
  red: 'MistyBanqi · Strongest',
  black: 'Human',
  event: 'Human vs engine',
  result:
    'Black is up material (five pieces to three) but cannot touch Red’s elephant, the highest piece left, while it picks off Black’s pieces one by one. Black resigns. In banqi, rank beats raw material.',
  // The 32-tile deal in ALL_BANQI_SQUARES order (a1, b1, … h1, a2, … h4):
  // createInitialBanqiState places deal[i] face-down on square i, and a flip
  // reveals it. So Red's a1 corner is really a horse, b1 a black chariot, etc.
  deal: [
    { color: 'red', role: 'horse' },
    { color: 'black', role: 'chariot' },
    { color: 'black', role: 'soldier' },
    { color: 'black', role: 'advisor' },
    { color: 'black', role: 'advisor' },
    { color: 'black', role: 'horse' },
    { color: 'red', role: 'soldier' },
    { color: 'black', role: 'soldier' },
    { color: 'red', role: 'horse' },
    { color: 'black', role: 'horse' },
    { color: 'red', role: 'general' },
    { color: 'red', role: 'soldier' },
    { color: 'black', role: 'elephant' },
    { color: 'red', role: 'elephant' },
    { color: 'black', role: 'soldier' },
    { color: 'red', role: 'soldier' },
    { color: 'black', role: 'soldier' },
    { color: 'black', role: 'soldier' },
    { color: 'red', role: 'chariot' },
    { color: 'red', role: 'soldier' },
    { color: 'red', role: 'advisor' },
    { color: 'red', role: 'elephant' },
    { color: 'red', role: 'cannon' },
    { color: 'red', role: 'advisor' },
    { color: 'red', role: 'soldier' },
    { color: 'black', role: 'cannon' },
    { color: 'black', role: 'chariot' },
    { color: 'red', role: 'chariot' },
    { color: 'black', role: 'general' },
    { color: 'red', role: 'cannon' },
    { color: 'black', role: 'cannon' },
    { color: 'black', role: 'elephant' },
  ],
  // Space-separated from+to tokens (files a-h, ranks 1-4); a flip is the
  // self-move from==to (e.g. "a1a1"). Replayed via applyBanqiMove.
  moves:
    'a1a1 e3e3 e4e4 e4e3 e1e1 d2d2 g1g1 f2f2 c1c1 d1d1 b1b1 d1d2 a2a2 b1a1 b2b2 a1a2 c3c3 g4g4 g3g3 e3e4 h4h4 f1f1 f4f4 e4f4 b3b3 f1g1 h1h1 e1f1 d3d3 f1f2 a4a4 a3a3 c4c4 c4c3 e2e2 c3d3 h3h3 a3a4 h2h2 h1h2 h3h4 c2c2 c2d2 b3c3 d2e2 c1d1 e2f2 d1e1 g3d3 c3c2 d3c3 f4e4 c3c4 e4e3 c4g4 e1f1 g4g3 e3e4 f2e2 c2d2 e2e3 e4f4 g3g1 f1f2 g1f1 f4g4 h4h3 f2e2 e3e4 e2e3 e4f4 g4g3 h3h2 e3e4 f1g1 g3h3 f4g4 e4f4 g4h4 h3h2 g1f1 f4g4 f1f2 h2h1 h4h3 g4g3 h3h4 d2e2 b4b4 b4h4 f3f3 g2g2 f3g3 h1h2 f2h2 d4d4 g3g2',
};
