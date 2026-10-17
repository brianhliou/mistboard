// The MistyBanqi article's conversion game, kept here only for the article's
// thumbnail (BANQI_ENGINE_THUMBNAIL in articles/diagrams.ts draws a position from
// it). The article itself embeds the game from the public study "MistyBanqi
// against people", whose source of truth is scripts/data/misty-banqi-study.json;
// misty-banqi-study.test.ts checks this copy against it.
//
// A real prod PvE game: MistyBanqi in the first seat (red) against a person. It
// reaches ten pieces to two and then draws by threefold repetition, under the
// rules before the 長捉 rule. Rebuilt from the finished game's truth history.

import type { BanqiDeal } from '@mistboard/game';

export const BANQI_CONVERSION_GAME: { deal: BanqiDeal; moves: string } = {
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
