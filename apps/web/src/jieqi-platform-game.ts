// The game the jieqi platform article is built around.
//
// A real Mistboard game (room jq_96f40ebb, 5+5 casual, 2026-08): a guest beats
// PikaJieQi by checkmate in 73 moves, after the engine leads for most of the
// middlegame and gives it back. That shape is why this game and not a cleaner
// one — the advantage graph actually swings, so the review figures in the
// article have something to show.
//
// Moves were extracted from the finished game's own history and verified by
// replaying all 146 plies through the kernel: every move is legal and the
// result reproduces as checkmate for black, which is what the live game page
// reports.
//
// The deal is the PUBLIC deal (jieqiPublicDeal, packages/game), never the real
// one: a piece captured face-down is known only to its capturer, and a piece
// that never moved is known to nobody (Brian, 2026-10-16). The five home
// squares listed in `undetermined` are those pieces; their roles here are the
// kernel's placeholders, not facts. Regenerated 2026-10-16 from the real deal
// and checked against prod's public record (/api/jieqi/games/:id, ply 0), which
// matched on every home square. jieqi-platform-game.test.ts fails if a hidden
// identity comes back.
//
// Deal order is jieqiHomeSquares(color), general excluded (it starts face-up).

import type { JieqiDeal } from '@mistboard/game';

export const JIEQI_PLATFORM_GAME: {
  red: string;
  black: string;
  event: string;
  outcome: string;
  result: string;
  deal: JieqiDeal;
  moves: string;
} = {
  red: 'Pikafish',
  black: 'Guest',
  event: 'Mistboard · 5+5 casual',
  outcome: 'Black wins by checkmate · 73 moves',
  result: 'Black delivers checkmate on move 73.',
  deal: {
    red: [
      'chariot',
      'horse',
      'soldier',
      'soldier',
      'soldier',
      'horse',
      'advisor',
      'elephant',
      'advisor',
      'cannon',
      'cannon',
      'elephant',
      'chariot',
      'soldier',
      'soldier',
    ],
    black: [
      'elephant',
      'soldier',
      'soldier',
      'chariot',
      'horse',
      'soldier',
      'soldier',
      'cannon',
      'soldier',
      'elephant',
      'advisor',
      'cannon',
      'horse',
      'chariot',
      'advisor',
    ],
    undetermined: { red: ['b1', 'd1', 'f1'], black: ['i7', 'h10'] },
  },
  moves:
    'h1g3 a7a6 c4c5 e7e6 i4i5 c7c6 a4a5 a6c4 c5a7 a10a7 a5g5 g10e8 a1a7 b8b1 c1a3 b1c1 g5b5 b10a8 a7d7 g7g6 h3h10 i10h10 g1e3 g6g7 d7g7 e8g7 g4g5 g7f5 g3f4 f5d6 b5b4 c6c5 i1i3 c1d1 e1d1 h8h4 b3c3 c5b5 f4e5 e6e5 e4e5 f10e9 b4h4 c10e8 e3c4 e9e5 c4e5 d10e9 h4i4 d6e4 c3d4 e4g3 i4i7 g3f1 i7e7 f1h2 d4c3 h10g9 e5d7 g9f8 e7e3 e10d10 e3d3 d10e10 c3d4 h2f3 d4e3 f3h2 d7c9 e10f10 e3f4 e8g10 c9a8 e9d8 a8b6 f8e9 d1e1 h2g4 d3f3 f10e10 i3g1 g10e8 f3d3 g4f2 e1e2 f2h3 f4e3 h3g1 e2e1 e8c6 g5g6 b5c5 g6f6 d8c7 b6c8 e9d8 c8a7 c6a8 f6e6 c5d5 e3f2 g1h3 f2g3 h3i5 d3b3 i5g4 b3b4 g4e3 e1e2 e3c2 b4b2 c2d4 e2d2 d4f3 d2d1 f3g5 b2e2 e10f10 e2h2 g5e6 h2h1 d5d4 a3a4 c7b6 a7c8 b6c7 d1e1 d4e4 h1h2 e6d4 a4a5 e4e3 h2h9 e3e2 e1d1 d4f3 g3f2 e2f2 h9e9 d8e9 c8e9 f2e2 e9g8 f10e10 a5a6 e2d2',
};
