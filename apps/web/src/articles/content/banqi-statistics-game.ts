// The exhibit game for the banqi statistics article: seed 1183 of the 200-game
// MistyBanqi self-play run (ten million nodes a move, Taiwanese competition
// rules; run reduced by scripts/banqi-games-stats.ts). It was picked because it
// sits on every median the article quotes: 72 moves against a median 71, and
// the material lead changes for the last time at move 13, which is the median
// move 13. What happens there is the article's whole argument in one ply. Black
// flips its own general onto c3 at ply 22, and a red soldier two squares away
// walks d2-d3-c3 and eats it at ply 25, turning a six-point deficit into a
// six-point lead that red never gives back.
//
// The diagrams replay this deal through the real kernel, so they cannot drift
// from the game they describe.
import type { BanqiDeal } from '@mistboard/game';

export const BANQI_STATS_GAME: { deal: BanqiDeal; moves: string } = {
  // The 32-tile deal in ALL_BANQI_SQUARES order (a1, b1, ... h1, a2, ... h4).
  deal: [
    { color: 'red', role: 'chariot' },
    { color: 'black', role: 'advisor' },
    { color: 'black', role: 'advisor' },
    { color: 'black', role: 'soldier' },
    { color: 'red', role: 'horse' },
    { color: 'black', role: 'soldier' },
    { color: 'red', role: 'cannon' },
    { color: 'black', role: 'cannon' },
    { color: 'red', role: 'soldier' },
    { color: 'red', role: 'advisor' },
    { color: 'red', role: 'horse' },
    { color: 'black', role: 'soldier' },
    { color: 'black', role: 'chariot' },
    { color: 'black', role: 'elephant' },
    { color: 'red', role: 'soldier' },
    { color: 'red', role: 'elephant' },
    { color: 'black', role: 'cannon' },
    { color: 'red', role: 'soldier' },
    { color: 'black', role: 'general' },
    { color: 'red', role: 'soldier' },
    { color: 'black', role: 'horse' },
    { color: 'red', role: 'chariot' },
    { color: 'red', role: 'elephant' },
    { color: 'black', role: 'soldier' },
    { color: 'red', role: 'general' },
    { color: 'red', role: 'soldier' },
    { color: 'black', role: 'soldier' },
    { color: 'red', role: 'advisor' },
    { color: 'red', role: 'cannon' },
    { color: 'black', role: 'elephant' },
    { color: 'black', role: 'chariot' },
    { color: 'black', role: 'horse' },
  ],
  moves:
    'b2b2 b4b4 b1b1 b1b2 e4e4 d4d4 e2e2 b3b3 e4e2 b2b3 g2g2 d2d2 d3d3 e1e1 d3d2 e3e3 g3g3 e3e2 e1e2 h1h1 h2h2 c3c3 d2d3 b3b4 d3c3 b4b3 d4d3 g1g1 h2h1 f1f1 d1d1 d1d2 e2d2 a1a1 c1c1 c2c2 g1c1 b3b2 d2d1 b2c2 c1f1 a3a3 d3d4 f2f2 f1g1 f2f1 a1b1 c2c1 h3h3 c1b1 g3h3 b1c1 d1e1 c1d1 e1e2 d1d2 e2f2 d2d3 d4e4 d3e3 e4e3 a3e3 g2g3 f1f2 f4f4 f2f1 h4h4 f1g1 h1g1 f4e4 f3f3 e3d3 h3h4 e4e3 f3f2 e3e2 g1f1 d3d2 g4g4 g4g3 h4h3 g3g4 h3g3 g4h4 a2a2 d2d3 c3b3 e2e3 g3g4 h4h3 a4a4 c4c4 a2b2 e3e4 g4g3 e4e3 f2g2 d3g3 g2g3 h3g3 f1f2 e3d3 a4a3 d3c3 b2b1 g3h3 f2f3 c4d4 f3e3 h3g3 b3b4 c3c2 a3b3 g3h3 b3c3 c2d2 c3c2 d4d3 b4c4 h3g3 b1b2 g3h3 c4d4 d2d1 d4d3 d1e1 e3f3 e1f1 f3g3 h3h4 c2d2 f1g1 d2e2 g1h1 b2c2 h1g1 e2f2 g1h1 f2g2 h4g4 g3g4 h1g1 g2g1',
};

/** Ply of the capture that settles the lead: a red soldier takes the general. */
export const BANQI_STATS_GAME_DECIDING_PLY = 25;
