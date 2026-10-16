// Sample game for the MistyBanqi engine article (the conversion pathology).
//
// A real prod PvE game: MistyBanqi as Red (first to move) vs a human as Black.
// MistyBanqi reaches a position up ten pieces to two, utterly winning, and then
// draws it by threefold repetition. Its handcrafted evaluation rewards holding
// material but gives no credit for *converting* a won position, so with nothing
// telling it to make progress it shuffles, and the repetition rule ends the game
// a draw. Reconstructed from the finished game's truth history (the deal is public
// once the game ends) and verified to replay through the banqi kernel to the
// recorded final position. The four never-flipped tiles keep their dealt identities
// but stay face-down the whole game.

import type { BanqiDeal } from '@mistboard/game';

export const BANQI_CONVERSION_GAME: {
  red: string;
  black: string;
  event: string;
  outcome: string;
  result: string;
  deal: BanqiDeal;
  moves: string;
} = {
  red: 'MistyBanqi',
  black: 'Human',
  event: 'Human vs engine · mistboard.com',
  outcome: 'Draw by repetition · MistyBanqi up 10 pieces to 2',
  result:
    "MistyBanqi (Red) is up ten pieces to two, a trivially won position, but its evaluation gives no reward for converting a win over holding material, so it shuffles instead of pressing and the game is drawn by threefold repetition. If you're losing on material against it, keep the game going: it may shuffle its own way into a draw.",
  // 32-tile deal in ALL_BANQI_SQUARES order (a1..h1, a2..h4); reveals follow it.
  deal: [
    { color: 'red', role: 'elephant' },
    { color: 'black', role: 'chariot' },
    { color: 'black', role: 'soldier' },
    { color: 'black', role: 'advisor' },
    { color: 'black', role: 'soldier' },
    { color: 'black', role: 'cannon' },
    { color: 'red', role: 'chariot' },
    { color: 'black', role: 'elephant' },
    { color: 'red', role: 'soldier' },
    { color: 'red', role: 'chariot' },
    { color: 'black', role: 'general' },
    { color: 'black', role: 'soldier' },
    { color: 'red', role: 'cannon' },
    { color: 'red', role: 'horse' },
    { color: 'red', role: 'cannon' },
    { color: 'red', role: 'soldier' },
    { color: 'black', role: 'chariot' },
    { color: 'red', role: 'soldier' },
    { color: 'black', role: 'soldier' },
    { color: 'red', role: 'elephant' },
    { color: 'black', role: 'elephant' },
    { color: 'black', role: 'horse' },
    { color: 'red', role: 'general' },
    { color: 'red', role: 'soldier' },
    { color: 'black', role: 'horse' },
    { color: 'red', role: 'advisor' },
    { color: 'red', role: 'soldier' },
    { color: 'black', role: 'advisor' },
    { color: 'black', role: 'cannon' },
    { color: 'red', role: 'horse' },
    { color: 'red', role: 'advisor' },
    { color: 'black', role: 'soldier' },
  ],
  // Space-separated from+to tokens (files a-h, ranks 1-4); a flip is from==to.
  moves:
    'a1a1 f3f3 b1b1 g1g1 a1b1 c3c3 h3h3 e2e2 c2c2 b2b2 e2c2 c1c1 b1c1 e1e1 c4c4 c3c4 c2c3 b4b4 b4c4 d3d3 c4b4 g4g4 a3a3 h2h2 c3a3 a2a2 a2a1 h1h1 f4f4 h1g1 f4f3 e3e3 d3e3 d2d2 a3a2 f2f2 a2d2 f1f1 f2f1 g1f1 e3e2 d1d1 d2d3 d1d2 e2e1 f1e1 a4a4 d2d3 b4a4 d3e3 g4f4 e1e2 g3g3 e2f2 h2h1 g2g2 g2g1 f2f1 g1g2 f1f2 g2g1 f2f1 g1g2 f1f2',
};

export const BANQI_WIN_GAME: {
  red: string;
  black: string;
  event: string;
  outcome: string;
  result: string;
  deal: BanqiDeal;
  moves: string;
} = {
  red: 'MistyBanqi',
  black: 'Human',
  event: 'Human vs engine · mistboard.com',
  outcome: 'MistyBanqi wins · the opponent is left with no piece to move',
  result:
    'MistyBanqi (the first player) won this one outright, leaving the opponent with nothing to move. Banqi swings hard with the flips: it fell behind on material early here, then calculated its way back and cleared the board. Grinding down a position like this, capture by capture, is the strong half of its game.',
  // 32-tile deal in ALL_BANQI_SQUARES order (a1..h1, a2..h4); reveals follow it.
  deal: [
    { color: 'red', role: 'chariot' },
    { color: 'black', role: 'soldier' },
    { color: 'red', role: 'elephant' },
    { color: 'red', role: 'soldier' },
    { color: 'black', role: 'elephant' },
    { color: 'black', role: 'soldier' },
    { color: 'red', role: 'horse' },
    { color: 'black', role: 'chariot' },
    { color: 'red', role: 'chariot' },
    { color: 'black', role: 'advisor' },
    { color: 'black', role: 'elephant' },
    { color: 'black', role: 'chariot' },
    { color: 'red', role: 'advisor' },
    { color: 'red', role: 'horse' },
    { color: 'red', role: 'soldier' },
    { color: 'red', role: 'cannon' },
    { color: 'black', role: 'general' },
    { color: 'red', role: 'soldier' },
    { color: 'red', role: 'general' },
    { color: 'red', role: 'soldier' },
    { color: 'red', role: 'advisor' },
    { color: 'black', role: 'horse' },
    { color: 'black', role: 'cannon' },
    { color: 'red', role: 'cannon' },
    { color: 'red', role: 'elephant' },
    { color: 'black', role: 'soldier' },
    { color: 'black', role: 'soldier' },
    { color: 'black', role: 'soldier' },
    { color: 'black', role: 'advisor' },
    { color: 'black', role: 'cannon' },
    { color: 'black', role: 'horse' },
    { color: 'red', role: 'soldier' },
  ],
  // Space-separated from+to tokens (files a-h, ranks 1-4); a flip is from==to.
  moves:
    'b2b2 f2f2 c2c2 e3e3 c3c3 c3c2 b3b3 c2b2 g3g3 f3f3 g3e3 f2f3 b1b1 b2c2 e3b3 c2c3 b1b2 a2a2 b2c2 c3b3 d3d3 a2b2 b4b4 b2c2 b4b3 g1g1 e1e1 a1a1 d1d1 h4h4 e1d1 h2h2 h1h1 g2g2 h1h2 h3h3 h2h3 e2e2 h3g3 e2e1 g3g2 e1d1 g2g1 d1e1 b3b4 e1e2 g1g2 e2f2 g2g3 f3e3 g3h3 f4f4 f4h4 f2f3 h3h2 f3g3 e4e4 g3h3 e4e3 h3h4 e3d3 g4g4 d3c3 h4g4 c3c2 g4g3 d2d2 d4d4 c1c1 a4a4 c2c1 a3a3 a3a4 c4c4 c1b1 f1f1 b1a1 g3f3 a4a3 f3e3 d2c2 e3d3 a3b3 d3d4 b3c3 d4e4 c3d3 e4f4 d3e3 f4g4 e3f3 g4h4 f3g3 h4h3 g3h3',
};

// The general-hunt pathology (moved from brianhliou.com, 2026-10-16). A real
// prod PvE game, room bq_e684b31b-6275-49e8-aed8-427b4dd095f3, 18 June 2026:
// MistyBanqi holds the first seat and turns up the black pieces; the player has
// red. After action 44 Misty walks its general into the a1 corner, a red soldier
// marches b4-b3-a3-a2-a1, and the general is left with no legal move; it is
// captured on action 86 and Misty wins anyway at 153. Deal and moves rebuilt
// from the finished game's truth history (every tile was flipped, so the deal is
// complete); banqi-engine-game.test.ts replays it to the recorded positions.
export const BANQI_GENERAL_HUNT_GAME: {
  deal: BanqiDeal;
  moves: string;
} = {
  // 32-tile deal in ALL_BANQI_SQUARES order (a1..h1, a2..h4); reveals follow it.
  deal: [
    { color: 'black', role: 'general' },
    { color: 'black', role: 'cannon' },
    { color: 'black', role: 'soldier' },
    { color: 'black', role: 'soldier' },
    { color: 'red', role: 'chariot' },
    { color: 'black', role: 'soldier' },
    { color: 'red', role: 'horse' },
    { color: 'red', role: 'cannon' },
    { color: 'black', role: 'horse' },
    { color: 'red', role: 'advisor' },
    { color: 'black', role: 'elephant' },
    { color: 'red', role: 'soldier' },
    { color: 'black', role: 'cannon' },
    { color: 'black', role: 'advisor' },
    { color: 'black', role: 'advisor' },
    { color: 'red', role: 'horse' },
    { color: 'red', role: 'soldier' },
    { color: 'red', role: 'soldier' },
    { color: 'red', role: 'chariot' },
    { color: 'red', role: 'general' },
    { color: 'black', role: 'horse' },
    { color: 'black', role: 'soldier' },
    { color: 'red', role: 'elephant' },
    { color: 'black', role: 'elephant' },
    { color: 'red', role: 'advisor' },
    { color: 'red', role: 'soldier' },
    { color: 'red', role: 'elephant' },
    { color: 'red', role: 'soldier' },
    { color: 'black', role: 'soldier' },
    { color: 'black', role: 'chariot' },
    { color: 'red', role: 'cannon' },
    { color: 'black', role: 'chariot' },
  ],
  moves: [
    'a1a1 b1b1 d1d1 a2a2 b3b3 f2f2 b1b3 c3c3 e2e2 c3b3 e4e4 e1e1 a1b1 e1d1',
    'd4d4 d4e4 e2e4 f4f4 b4b4 c4c4 f2e2 c4d4 d2d2 d4e4 e2d2 e4f4 d2d1 g2g2',
    'g2f2 h3h3 f2e2 g4g4 h4h4 g1g1 h4g4 f4g4 e2f2 g4f4 f2g2 a3a3 g2g1 f4e4',
    'a2a3 b3a3 b1a1 a3b3 h3h4 b3c3 d1e1 b4b3 e1e2 b3a3 g1g2 a3a2 a1b1 a2a1',
    'g3g3 f3f3 g2g3 e4f4 g3g4 f4f3 g4g3 f3f4 g3f3 f4e4 f3f4 e4d4 f4e4 d4c4',
    'e4d4 c4b4 d4c4 d3d3 c4b4 d3d2 e2f2 e3e3 b4c4 c3d3 c2c2 d2c2 b2b2 d3e3',
    'b1b2 c2b2 f2e2 e3d3 c4d4 d3c3 d4d3 c3b3 h4g4 b2c2 e2f2 c2c3 d3d2 a4a4',
    'f2g2 a4b4 d2e2 b4c4 f1f1 c3d3 f1f2 b3c3 h2h2 c3c2 g2h2 c2d2 f2f3 c4d4',
    'f3e3 d3c3 e2d2 c1c1 e3d3 d4d3 c1c2 d3d2 c2c3 d2e2 h2g2 h1h1 c3c4 a1b1',
    'c4b4 b1c1 g4h4 c1d1 h4h3 e2d2 h3h2 d2d3 h2h1 d3c3 h1g1 d1d2 g2f2 d2d3',
    'f2e2 c3b3 b4c4 b3c3 e2d2 c3c4 d2d3 c4b4 d3c3 b4a4 c3b3 a4b4 b3b4',
  ].join(' '),
};
