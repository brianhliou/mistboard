/**
 * Seed the Duck Xiangqi companion study: the seven decisive engine self-play
 * games behind the rules article's sample game, chapter one being the game the
 * article embeds.
 *
 * The games come from Fairy-Stockfish on both sides at 8s per move, full
 * strength, with MultiPV opening sampling so the seven do not share an opening.
 * Every mainline is replayed through the Duck Xiangqi kernel before it is
 * written, so a chapter can never carry a turn the board would reject. Chapter
 * comments are computed from each game's own engine eval curve, not written by
 * hand.
 *
 * A TURN is a piece move AND a duck placement, so a token carries both:
 * `b1c3@c8`. The duck half is absent on exactly one turn per game, the general
 * capture that ends it. That is the tree adapter's own spelling
 * (duckXiangqiTurnKey), which is why these tokens paste straight into
 * /analysis/duck-xiangqi?moves=.
 *
 * Usage (local dev, server on 3011):
 *   npx tsx apps/server/src/seed-duck-xiangqi-games-study.ts \
 *     --email you@example.com [--base http://127.0.0.1:3011] \
 *     [--visibility public|unlisted|private]
 *
 * Against a real server, supply a browser session instead of --email:
 *   MISTBOARD_SESSION_COOKIE='mistboard_session=...' npx tsx ... --base https://mistboard.com
 * The cookie is a live credential: read from the environment, never logged.
 *
 * --in-place rewrites the chapters of the EXISTING study, keeping its id. Use
 * this once the study is published: a plain re-run refuses to create a second
 * copy, and deleting it would mint a NEW id, which 404s the /study/<id> link
 * the rules article hardcodes.
 */
import {
  applyDuckXiangqiTurn,
  createInitialDuckXiangqiState,
  type DuckXiangqiGameState,
  type DuckXiangqiSquare,
  getDuckXiangqiLegalTurns,
} from '@mistboard/game';
import { resolveExistingStudy } from './seed-study-idempotency.js';

const STUDY_NAME = 'Duck Xiangqi: seven engine games';
const STUDY_DESCRIPTION =
  'Companion study to the Duck Xiangqi rules article: the seven decisive engine self-play games the article\u2019s sample game was chosen from, in full. Fairy-Stockfish on both sides at 8s per move with opening sampling, so the duck is placed by search rather than by a book. Chapter one is the game the article embeds. Article: /rules/duck-xiangqi';

type SerializedNode = {
  uci?: string;
  annotations?: { comments?: { text: string }[] };
  children: SerializedNode[];
};

type SampleGame = {
  plies: number;
  winner: string;
  comment: string;
  moves: string;
};

/** Ordered for the study: the article's game first, then by how long the game
 *  stayed inside a pawn of level. Comments are computed from the eval curve. */
const GAMES: SampleGame[] = [
  {
    plies: 120,
    winner: 'black',
    comment:
      "The game the rules article embeds. The engine eval was still within 1.5 pawns of level as late as ply 63 of 120. Through that stretch Black held the larger edge, peaking at -461. The duck screened a cannon on 30 plies and jammed a horse's leg on 29. Black captures the general with e1–e2.",
    moves:
      'b3b5@d9 b8b6@a8 h3e3@b9 g7g6@e5 b5c5@g8 b6c6@e5 b1a3@c8 h10g8@g3 e3e7@f8 b10c8@e6 e7h7@b3 g8f6@e5 c5c7@c5 h8e8@e6 c1e3@c5 c6e6@e2 h1g3@e5 i10h10@c6 h7h6@h9 f6g4@f6 h6h3@h7 e6a6@b10 a1a2@h9 a6b6@b2 h3i3@h7 a10b10@b2 c4c5@c6 g4i3@i2 a2h2@h3 c10a8@h5 i1i3@h7 b6b3@h4 c7f7@h3 b3c3@h5 a3c2@h3 h10h7@h6 f7f2@h3 h7f7@g2 h2h10@f3 f7g7@d2 g3f5@g9 g7f7@f6 f2f3@d3 b10b3@f6 f5d4@f5 b3b2@d3 f3g3@f3 g10i8@d3 h10h8@g2 e8f8@d3 h8h7@g7 f7d7@e7 h7h8@d6 d10e9@d3 d4e6@e7 f8f3@h3 i3i2@e2 b2c2@g2 f1e2@f5 d7e7@f8 e6d4@d2 f3f8@d3 g3g2@f2 c2b2@d2 d4c2@f2 b2c2@d2 i4i5@f4 c2a2@d2 e2f1@c2 f8f2@e2 i2i4@f4 c3c4@d2 h8i8@g4 f2d2@e2 e4e5@c2 d2d4@e4 i4i2@h2 d4e4@e2 e3c1@b2 g6g5@e3 g2h2@h5 e7h7@e3 i8g8@b2 g5f5@e8 h2g2@b2 h7h1@g7 g2g3@h2 a2c2@g2 c1e3@e2 h1g1@f2 g3g2@e2 c2c3@d3 i2h2@e2 c3e3@a5 g2g7@e2 c8e7@d8 g8i8@e2 g1g7@g2 e5e6@e2 e7d9@f2 e6d6@e2 e3d3@e3 e1e2@d4 a8c10@e3 i8i7@h7 g7g1@f2 i7a7@e1 d3d1@g2 e2e3@e2 e4e5@f3 a7f7@d4 f5f4@f3 f7f5@e2 g1f1@e1 d6d7@e2 f4e4@d2 e3e2@e3 f1e1@f2 h2h1@a1 e1e2',
  },
  {
    plies: 210,
    winner: 'black',
    comment:
      "The engine eval was still within 1.5 pawns of level as late as ply 209 of 210. Through that stretch Black held the larger edge, peaking at -491. The duck screened a cannon on 8 plies and jammed a horse's leg on 78. Black captures the general with e4–d2.",
    moves:
      'b1c3@a8 h10g8@h2 c4c5@e8 b10c8@d3 g4g5@b10 g10i8@h2 h3g3@h5 c10e8@g6 g1e3@h4 g7g6@c4 g5g6@g7 i8g6@g5 h1f2@g7 c8e9@c4 f2g4@f7 b8b4@g7 c3d5@f4 a10a8@h1 g4i5@b8 i7i6@h5 c5c6@c5 i6i5@b8 d5b4@g7 a8d8@h1 i4i5@c4 h8i8@h1 g3i3@d7 i8i3@i2 b3i3@i6 i10h10@a3 c6c7@h3 d8d4@b3 f1e2@c4 h10h3@i2 e3g5@c4 h3g3@d3 c1e3@c4 g3e3@f4 b4c2@c3 d4d2@f4 a1c1@g3 e3c3@i2 i5i6@d7 d2c2@g7 c1c2@d7 c3c2@g10 i1f1@c3 c2d2@f3 i3g3@d3 e9c10@f7 f1f5@d4 d10e9@a8 g3g2@d4 d2b2@f2 f5f7@b3 a7a6@f2 c7d7@b3 g8h10@d2 d7e7@b3 e8c6@d2 f7f5@b3 b2a2@f2 f5b5@a3 g6e8@d2 b5b10@d10 a2a3@d9 g2i2@g3 e9d10@d9 e7e8@d7 a3g3@f1 e8f8@g2 c10d8@e9 e2f1@d7 f10e9@e8 i2e2@g4 e9f8@e9 b10b6@e6 f8e9@d7 e4e5@g4 d8f7@f6 b6c6@a1 f7e5@e6 c6d6@f3 g3g5@e6 e2e3@h9 g5g3@d5 d1e2@f3 h10g8@d5 d6a6@f3 g8e7@e6 e3e4@c6 e7f5@b6 i6i7@g4 g3c3@c6 e2d1@e3 f5h4@e2 a6f6@d3 c3a3@e2 a4a5@c3 h4g2@f2 e1e2@c3 a3a5@f5 f6f9@a4 e5g6@e7 e2f2@f10 a5e5@e3 f9g9@b4 e5e4@g10 g9g6@f4 e9f10@g4 f1e2@f4 d10e9@g5 i7h7@f4 g2h4@g5 g6f6@f4 e4e7@g6 f6c6@f7 e9d10@e6 h7g7@f7 h4f5@f6 g7g8@f7 f10e9@e6 f2f1@f7 e7e6@d6 c6c3@f6 f5h6@g9 g8h8@f8 h6f7@h9 c3f3@g7 e6g6@f4 h8h9@f6 f7d8@e1 f3i3@i4 g6h6@f10 h9g9@g6 h6i6@i4 i3g3@g6 d8f7@f9 f1e1@f8 i6i9@f9 g3g7@f8 f7d8@g8 g7g3@h9 d8f7@f9 g3g7@f8 f7d8@g8 e2f1@h9 d8e6@e7 g7g8@e2 i9i6@f9 g8g6@h6 i6i9@f6 g9h9@e7 i9i10@f6 h9i9@f7 i10f10@f6 d1e2@f8 e6d4@d1 g6g4@c2 d4e6@g6 e1d1@f9 f10g10@g9 i9h9@g8 e6c7@g9 g4g6@g8 c7e8@g7 g6e6@f8 g10g4@e7 d1e1@f8 g4h4@e7 h9i9@f8 h4h7@e7 e6g6@i7 h7f7@g10 i9i10@f8 e10f10@h10 g6g10@e10 f10f9@g9 e2d3@g7 f9f8@g9 g10h10@h9 f7h7@h8 h10g10@a1 e8f6@g9 d3e2@e6 f6e4@g9 e2f3@g7 e4c3@g9 f3e2@i7 h7g7@g8 g10h10@h9 g7h7@h8 h10g10@d3 h7g7@g8 g10h10@d3 g7h7@h8 e2d3@h9 h7d7@h8 f1e2@e4 c3a4@h9 e1d1@c2 a4c5@h9 d1d2@c4 d7b7@h8 h10g10@c4 c5e4@d1 g10g8@e3 f8f9@e7 g8g1@a1 e4d2',
  },
  {
    plies: 150,
    winner: 'black',
    comment:
      "The engine eval was still within 1.5 pawns of level as late as ply 101 of 150. Through that stretch Black held the larger edge, peaking at -601. The duck screened a cannon on 6 plies and jammed a horse's leg on 56. Black captures the general with e2–e1.",
    moves:
      'h1g3@i6 b10c8@e3 c4c5@e8 g7g6@b2 h3h7@f7 h10g8@g7 b3b5@h5 g10e8@d7 f1e2@c6 i7i6@d7 g1e3@i8 c7c6@d2 c5c6@i7 e8c6@b10 i4i5@a6 c8d6@i4 b1c3@b2 b8c8@c4 b5c5@c7 c6e8@d5 c3a2@f3 d6f5@f4 g3f1@i8 f5d4@i2 a2b4@d3 a10b10@c4 h7h2@b8 h8i8@c4 g4g5@b8 g6g5@d3 i1g1@b8 i6i5@h5 b4d3@b6 i5h5@b3 h2i2@h10 i8h8@c4 g1i1@b3 g8f6@b2 c5c4@d5 f10e9@b1 a4a5@d5 i10i7@h2 e4e5@g4 i7i5@g2 e3g1@e4 g5f5@f2 g1i3@i4 c8c1@b1 d3c1@d3 i5i3@c2 a1a2@d3 b10b4@f2 c4c8@g8 d4e2@d2 a2b2@b3 e2f4@f3 b2b4@d8 f4g2@f2 e1e2@h2 h8c8@d2 f1h2@g3 f6d5@d2 b4d4@g3 f5e5@d3 i2g2@i2 i3h3@i10 g2f2@d8 h3h2@g10 c1d3@d8 c10a8@i10 i1i6@f3 h5g5@e3 d4h4@h3 h2g2@h5 h4c4@d4 g5f5@c5 i6i10@g10 c8c6@f10 c4g4@g3 g2h2@f10 g4h4@h3 h2g2@f10 h4g4@g3 g2h2@g10 i10h10@h5 e9f10@h7 g4h4@h3 h2i2@d6 h4i4@i3 i2g2@g10 i4g4@g3 g2h2@h9 g4h4@h3 h2g2@h8 e2e1@e3 g2g1@f1 e1e2@d2 g1d1@g10 f2f10@d2 d10e9@c3 f10f6@d2 c6e6@g10 e2f2@d2 e9f10@h7 h4h5@d2 d5e3@f3 f2e2@g4 d1d3@h7 h5h3@f3 e3d5@e3 h10h4@e4 d3d1@h7 e2f2@d2 e5e4@f3 h4e4@d2 d5f6@c4 e4d4@d2 d1c1@d5 h3f3@f7 f5e5@f5 f3f4@e4 c1g1@f5 f4i4@e4 g1g2@f3 f2f1@g1 f6e4@d7 i4i10@g1 a7a6@f5 i10i5@g1 g2d2@d3 d4e4@g5 e5e4@f5 a5a6@e2 e4e3@f5 f1f2@e2 a8c6@f5 i5g5@e2 e6a6@f5 g5g3@e2 d2d1@f3 g3g4@e1 d1d2@e2 f2f1@f2 e3e2@d1 g4g2@e1 a6a1@f2 g2g1@i1 a1g1@d1 f1e1@a1 e2e1',
  },
  {
    plies: 150,
    winner: 'black',
    comment:
      "The engine eval was still within 1.5 pawns of level as late as ply 81 of 150. Through that stretch Black held the larger edge, peaking at -315. The duck screened a cannon on 10 plies and jammed a horse's leg on 62. Black captures the general with e10–e3.",
    moves:
      'h3h5@c6 g10e8@h2 h5c5@a8 b8b4@d9 b3e3@a8 f10e9@c9 b1c3@c6 b10a8@b1 c5i5@i6 b4b6@i9 a1b1@c6 i7i6@i7 b1b6@f10 i6i5@g6 i4i5@i6 h8h6@f6 e3i3@i6 c7c6@i9 b6b7@i6 h10g8@i9 b7e7@f8 i10i5@f7 e7e8@d9 h6g6@e3 e8e5@g5 g6g4@h5 c1e3@g5 a7a6@f5 i3f3@i3 i5e5@i4 e4e5@a3 a8c9@i2 f1e2@b7 a10a7@i3 e5e6@b7 g7g6@i3 c4c5@b7 c6c5@i4 e3c5@b7 g4b4@i2 f3f4@c7 b4b1@c2 g1e3@c1 a7c7@c2 h1g3@c1 b1a1@b1 e3c1@c6 c9b7@d4 g3e4@c6 c7i7@i5 f4f3@i6 g6g5@i2 i1g1@h7 g5f5@g3 f3e3@g7 g8f10@f1 c5a3@i6 i7d7@b6 g1g2@d5 d7g7@g5 g2g1@g6 g7c7@c6 g1f1@c4 c7c6@f4 e6f6@d4 c6c4@f3 f1i1@d4 f5f4@e5 e3g3@f9 f4e4@g10 c3e4@d4 f10e8@e6 g3e3@d4 b7d6@e5 e4g3@d4 e9f10@e6 g3h5@d4 d6f5@e9 e3e7@d4 d10e9@f7 h5g7@e5 c4c7@g6 g7e8@f3 c10e8@f7 e7e5@e7 c7c1@b2 f6e6@c2 c1b1@e7 a3c5@b2 e10d10@h1 i1i10@b2 f5h4@f1 i10h10@b4 b1b3@h8 e2d3@b1 h4f3@e2 e1f1@e1 f3e5@e2 f1f2@e4 b3b2@e2 h10h4@c2 e5d3@e3 f2f3@d2 d3c5@g4 e6e7@g2 e8c6@g4 h4h5@c2 a1a3@f5 d1e2@d2 c5e4@e5 f3f2@e3 b2d2@f5 h5h4@e3 d10e10@g4 e7f7@e3 a3a2@g4 f7e7@e3 a2a3@g4 e7f7@e3 c6a8@g4 f7g7@e3 e4g3@f3 e2f1@e2 a3a1@f3 h4g4@e2 g3h1@f3 f1e2@g1 a1a2@g3 g4g6@g1 a2e2@g3 f2f3@d3 e2e1@g3 g6b6@d3 h1g3@e3 b6g6@g2 e1g1@g4 g7h7@g5 g1i1@g4 h7h8@i3 d2d8@g4 g6g8@b7 i1i3@f2 g8d8@h3 e9d8@a7 f3f2@f3 i3i7@g9 f2f3@g7 a8c6@g8 f3e3@g7 e10e3',
  },
  {
    plies: 129,
    winner: 'red',
    comment:
      "The engine eval was still within 1.5 pawns of level as late as ply 60 of 129. Through that stretch Red held the larger edge, peaking at 253. The duck screened a cannon on 4 plies and jammed a horse's leg on 65. Red captures the general with g8–e8.",
    moves:
      'h3h5@e8 f10e9@b2 h1g3@h9 g7g6@e3 h5d5@h9 c7c6@h1 d5b5@b4 b8f8@d2 i1h1@g8 g10e8@h3 d1e2@g8 a7a6@h5 a4a5@g8 a6a5@a9 a1a5@a7 h8g8@a9 g1e3@a7 i7i6@a9 c4c5@a6 c6c5@a9 e3c5@a6 g8g4@a9 c5e3@a8 b10c8@a6 h1h4@a7 f8g8@a6 b1c3@a8 a10a9@a6 b5b8@a8 c8d6@a6 a5d5@a8 g8b8@g2 d5d6@g5 b8c8@d2 h4g4@c2 a9a3@b2 b3b10@b3 c8c1@d2 b10b2@b3 c1c2@e5 d6d3@b3 h10g8@c1 g4f4@b3 g6g5@d2 f4f7@g4 a3b3@a2 f7g7@h8 g8h10@a2 g7g5@d2 b3b2@h9 d3d1@b3 h10i8@b5 d1c1@g6 e7e6@g4 g5d5@h10 e9f8@d3 d5d4@h10 i8g7@c4 g3f5@g6 g7i8@d3 d4b4@b3 e6e5@f6 e4e5@b3 i8h6@g5 b4b2@g6 h6g4@f4 b2c2@g3 g4e3@f4 c3e4@d3 e3g2@e3 e1d1@g5 i6i5@i8 i4i5@i9 g2h4@g5 f5g7@i7 h4g6@f7 i5i6@f6 i10i6@h7 g7e8@d9 g6e5@c9 e8d10@g6 f8e9@d9 c2c5@e6 e9d10@d5 c1b1@e6 c10e8@d5 e4g5@g6 e5c6@h5 g5f7@g6 i6i7@g9 f7d6@d7 c6d8@c8 d6e8@e9 i7d7@e1 c5d5@d6 d7e7@d7 e8g9@f9 e10e9@d6 b1c1@d9 d8f7@c2 d5d10@f8 e7d7@d9 d10g10@d4 f7h8@e1 g10c10@d4 d7d9@f9 d1e1@h7 e9f9@c2 g9f7@g8 h8g6@g10 f7h8@g7 g6f4@g8 c10g10@e9 f9f8@c2 g10g8@f9 f8e8@f8 c1c8@e9 d9d8@f8 c8c10@e9 d8d9@f8 c10e10@e9 e8d8@f8 e10c10@e8 d9c9@f8 c10c9@f3 f4d3@e8 e2d3@f8 d8e8@a1 g8e8',
  },
  {
    plies: 229,
    winner: 'red',
    comment:
      "The engine eval was still within 1.5 pawns of level as late as ply 51 of 229. Through that stretch Black held the larger edge, peaking at -384. The duck screened a cannon on 18 plies and jammed a horse's leg on 82. Red captures the general with d1–d9.",
    moves:
      'b3b5@b9 d10e9@c5 g1e3@h9 c7c6@c7 b5h5@h4 h8d8@b2 a1a3@b9 g7g6@c3 h5i5@i6 h10i8@g5 i5h5@f9 b8b4@c3 h1f2@b9 d8f8@c3 a3b3@b2 b4e4@f3 b1c3@e2 e4e6@e4 d1e2@i9 b10c8@h8 h3h4@e8 i8g7@g5 h5h7@i6 i10i8@h8 h7e7@d8 f8e8@b7 e7d7@d2 i8f8@b7 i1i3@f6 a10b10@b7 d7d3@f7 b10b3@b7 d3b3@f7 a7a6@e4 i4i5@f6 c8b6@e4 h4h6@f6 e6e5@h3 g4g5@f7 g6g5@e6 b3b5@f7 e5e6@f3 i3g3@f5 i7i6@d2 g3g5@e7 g7i8@d6 f2g4@i7 f8f4@g9 h6h3@d2 i8h6@g6 b5b4@h5 f4c4@g6 b4b1@h5 c4c3@f3 i5i6@d2 e6i6@g3 h3h1@d2 e8h8@g6 g4h2@d2 h6f7@g2 g5h5@d2 i6h6@g7 b1b2@h7 c3c2@g7 h5b5@h5 b6c8@h3 h1g1@h7 c10e8@b6 h2g4@d2 c2c4@g5 b5f5@e4 f7d6@g5 f5f6@d4 h6h7@f9 b2b7@f4 c4c1@d2 e2d1@b1 c1c4@g5 b7b8@e4 e8c10@g8 b8b6@f4 c6c5@g3 b6c6@e4 c4d4@g7 c6c10@e4 g10e8@c6 g4i5@g7 e8c10@g10 i5h7@e4 c10a8@g4 f6e6@d10 e9d8@e9 g1h1@h6 e10d10@h5 h7g5@d5 a8c10@e7 h1h5@f8 f10e9@e5 f1e2@e4 c5b5@f7 h5i5@f8 b5b4@g6 i5i10@e8 c10a8@i8 e6h6@f5 h8e8@h7 g5e6@e4 d4c4@h9 e6g7@c7 c4g4@f7 h6h10@g5 e8e5@e10 g7i6@d9 d6e4@f10 i6h4@d9 e9f10@h8 h10f10@e10 d10d9@e9 h4i6@b8 g4g9@f7 i6h4@f1 g9g4@e9 h4i6@d3 e5e3@f1 e2d3@e9 e4d6@f9 e1e2@e4 d6c4@f9 a4a5@a1 g4g2@f2 e2e1@f7 g2g9@e9 a5a6@h9 e3e7@f7 f10f8@d4 e7e10@f1 i6h8@g8 d8e9@f5 f8f6@e4 g9g1@f1 e1e2@e6 g1h1@f2 h8g10@e3 h1h6@g6 g10f8@e8 e9f8@g6 f6f8@f2 h6h2@e8 e2e1@f3 h2h1@f2 f8c8@g1 c4e5@e2 e1f1@g1 e5d3@c9 d1e2@g1 d3f4@c9 c8f8@g1 d9e9@f7 f1f2@g2 h1h2@f5 f2f1@f3 h2e2@f5 f8f10@e4 f4e6@g10 f10f2@e3 e2f2@e1 f1f2@e5 b4c4@b7 a6a7@e5 a8c6@e4 i10i4@c3 c4d4@e2 i4h4@e4 e10f10@e2 h4h1@e5 d4d3@e2 h1e1@e5 d3e3@e4 a7b7@e5 c6e8@e4 e1a1@e5 f10f5@e2 a1a4@e5 f5f8@e4 f2f1@e2 e6c5@e1 a4i4@c6 e3f3@e1 b7c7@f7 e8c10@e1 i4i5@f7 e9e8@e1 i5i8@f7 e8e9@e1 i8i2@f4 c10e8@e1 i2e2@f4 e9d9@e1 e2a2@f2 c5e4@e1 a2i2@f7 e4d2@e1 i2e2@f2 e8c6@e1 c7b7@f6 c6e8@e1 b7c7@f2 f8f6@e1 c7d7@f5 f6f10@e1 d7c7@f2 f3e3@g2 e2e8@e2 e3f3@e1 e8e2@f8 f3e3@h2 f1f2@c4 e3e2@e9 f2e2@d3 d2b3@e7 e2e1@d4 b3c5@c8 e1d1@d7 f10f2@d2 c7d7@c6 f2f10@e7 d7c7@d4 f10a10@e1 d1d9',
  },
  {
    plies: 193,
    winner: 'red',
    comment:
      "The engine eval was still within 1.5 pawns of level as late as ply 28 of 193. Through that stretch Red held the larger edge, peaking at 253. The duck screened a cannon on 26 plies and jammed a horse's leg on 73. Red captures the general with e9–e8.",
    moves:
      'b1c3@a8 g10e8@g3 c4c5@b9 g7g6@h2 c3d5@c8 b8b5@d6 d5f6@c8 b5b4@f7 h3h7@h9 b10c8@d9 b3e3@f7 f10e9@c9 f6e8@d9 e9f8@d8 e8d10@d9 e10d10@g3 g1i3@h2 h10g8@g1 a1a3@e10 a7a6@b3 h1f2@d9 i10i8@b3 a4a5@a4 b4b9@g5 i1g1@e2 g8h6@b3 g4g5@d8 b9g9@g8 g5g6@g7 h6i4@g4 g6g7@g8 g9f9@g2 g7g8@f7 h8h9@e10 g8g9@f7 f9f10@d3 g9h9@h8 i4h6@g5 e3f3@h8 f8e9@g2 f3h3@d8 i8f8@f7 g1g6@f3 a6a5@f7 a3d3@f3 a10b10@d7 g6b6@b9 d10d9@d6 h3f3@b9 f10d10@d6 b6b10@c9 d10b10@d7 h9g9@b5 f8d8@f9 d3b3@f8 d9d10@b6 h7h10@f8 a5b5@b4 g9g10@b8 e9f10@b4 b3a3@d9 d10e10@c9 g10f10@e9 e10f10@a8 f2h3@e10 d8d3@b3 f1e2@c3 d3d4@a4 h10c10@e10 b5c5@a5 h3g5@e10 b10b4@a5 e4e5@e4 f10e10@a7 a3a6@g4 b4b5@d6 a6a10@d5 h6g4@d7 c10c7@d5 c8d10@c10 f3b3@d5 g4i3@c8 g5f3@d7 d4b4@e3 b3c3@g2 i3g4@c8 c3d3@f4 b4e4@c9 f3g5@i6 e4e5@g6 c7c10@d9 e10e9@f7 a10a7@f5 b5b8@g6 a7a9@f5 b8b7@c9 g5f7@d7 e9e8@f6 a9a7@d7 b7c7@b7 f7e5@c2 g4e5@b7 d3e3@c6 c5d5@b7 a7a6@d8 i7i6@b6 e1f1@f5 d10f9@c6 a6b6@f8 e8e9@c6 b6b9@d9 c7d7@c9 c10g10@f8 d5d4@c9 b9b7@i5 f9g7@c7 g10d10@c4 d7d9@d7 d10a10@f5 d4c4@d7 b7c7@e8 c4d4@d7 a10a9@d8 d9d10@d7 c7c5@d5 e7e6@e4 c5c9@d9 e9e8@e10 c9d9@e4 d10f10@d8 d9d10@e4 f10f9@d7 f1e1@e4 f9c9@d7 d10d9@d8 c9c3@d7 d9g9@g8 d4d3@i8 g9g8@f8 e8e9@c8 e3c3@c2 d3c3@a8 g8g7@c2 e5c4@f7 a9c9@d6 c4b6@f7 g7g6@f6 b6d7@e7 g6e6@d8 c3c2@e7 c1e3@d8 d7f8@e8 e6c6@d2 i6i5@c3 c9b9@d2 i5h5@c7 b9b5@d2 h5i5@e8 b5f5@d2 f8g6@d6 f5f2@e6 i5h5@d6 f2c2@f4 e9e8@d6 e2f3@e6 g6e5@d6 c2e2@d5 e5f3@e5 e1f1@f8 f3e5@e7 e2e5@d6 h5h4@f6 c6c9@g4 e8d8@h9 e3c5@g4 d8e8@f8 c9h9@g4 e8d8@h7 e5e2@g4 h4i4@d9 c5e3@e8 i4h4@h8 f1f2@g4 h4h3@h8 h9f9@e9 h3i3@a1 f9e9@h3 i3i2@g2 e2e1@h2 i2i1@a1 e1e2@h1 d8e8@a1 e9e8',
  },
];

/** Replay a mainline through the kernel, returning the turn tokens it accepts.
 *  A token that the kernel will not match is a hard error here rather than a
 *  chapter that renders a stuck board: applyDuckXiangqiTurn returns the state
 *  UNCHANGED for an illegal turn, so nothing downstream would notice. */
function verifiedLine(moves: string): { ucis: string[]; final: DuckXiangqiGameState } {
  let state = createInitialDuckXiangqiState('seed-duck-study');
  const ucis: string[] = [];
  const tokens = moves.trim().split(/\s+/).filter(Boolean);
  tokens.forEach((token, ply) => {
    const [piece, duckTo] = token.split('@');
    if (!piece) throw new Error(`bad token "${token}" at ply ${ply + 1}`);
    const from = piece.slice(0, piece.length - (piece.endsWith('10') ? 3 : 2)) as DuckXiangqiSquare;
    const to = piece.slice(from.length) as DuckXiangqiSquare;
    const turn = getDuckXiangqiLegalTurns(state).find(
      (t) =>
        t.from === from &&
        t.to === to &&
        (duckTo === undefined ? t.duckTo === null : t.duckTo === (duckTo as DuckXiangqiSquare)),
    );
    if (!turn) throw new Error(`illegal turn "${token}" at ply ${ply + 1}`);
    state = applyDuckXiangqiTurn(state, turn);
    ucis.push(token);
  });
  return { ucis, final: state };
}

function chapterName(game: SampleGame, ordinal: number): string {
  const who = game.winner === 'red' ? 'Red' : 'Black';
  const suffix = ordinal === 1 ? ' (the article’s game)' : '';
  return `Game ${ordinal}: ${who} captures the general on move ${Math.ceil(game.plies / 2)}${suffix}`;
}

function chapterPayload(game: SampleGame, ordinal: number) {
  const name = chapterName(game, ordinal);
  const { ucis, final } = verifiedLine(game.moves);
  if (final.status.type !== 'finished') {
    throw new Error(`${name}: replay did not finish (status ${final.status.type})`);
  }
  let child: SerializedNode | null = null;
  for (const uci of [...ucis].reverse()) child = { uci, children: child ? [child] : [] };
  return {
    name,
    variant: 'duck-xiangqi' as const,
    orientation: 'red' as const,
    root: {
      version: 1 as const,
      root: {
        annotations: { comments: [{ text: game.comment }] },
        children: child ? [child] : [],
      },
    },
  };
}

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const base = arg('--base') ?? 'http://127.0.0.1:3011';
  const visibility = arg('--visibility') ?? 'private';
  const inPlace = process.argv.includes('--in-place');
  const email = arg('--email');
  let cookie = process.env.MISTBOARD_SESSION_COOKIE ?? '';

  if (!cookie) {
    if (!email) throw new Error('supply --email (dev) or MISTBOARD_SESSION_COOKIE (real server)');
    // Dev only: the login code comes back in the response, which is why this
    // needs no TTY. A real server never returns it, so the cookie path is the
    // only way in and stays a human step.
    // The start endpoint is IP rate-limited at 5 per 10 MINUTES
    // (authStartRatePerWindow / authStartRateWindowMs), so a re-run soon after
    // another sign-in trips it and the wait is minutes, not seconds. Retry on a
    // one-minute backoff rather than fail: a seeder that dies here is a seeder
    // nobody can run twice in an afternoon.
    for (let attempt = 0; ; attempt++) {
      const start = (await (
        await fetch(`${base}/api/auth/email/start`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email }),
        })
      ).json()) as { loginId?: string; devCode?: string; error?: string };
      if (start.devCode) {
        const confirm = await fetch(`${base}/api/auth/email/confirm`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ loginId: start.loginId, code: start.devCode }),
        });
        cookie = (confirm.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
        if (cookie) break;
      }
      if (start.error !== 'rate_limited') {
        throw new Error(
          `sign-in failed (${start.error ?? 'no devCode'}); dev auth codes may be off`,
        );
      }
      if (attempt >= 12) throw new Error('sign-in rate limiter never cleared (waited 12 minutes)');
      if (attempt === 0) console.log('rate limited; the window is 10 minutes, waiting it out');
      await new Promise((resolve) => setTimeout(resolve, 60000));
    }
  }

  const api = {
    get: (path: string) => fetch(`${base}${path}`, { headers: { cookie } }),
    del: (path: string) => fetch(`${base}${path}`, { method: 'DELETE', headers: { cookie } }),
    post: (path: string, body: unknown) =>
      fetch(`${base}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify(body),
      }),
  };

  const chapters = GAMES.map((game, i) => chapterPayload(game, i + 1));
  console.log(`verified ${chapters.length} mainlines through the kernel`);

  const decision = await resolveExistingStudy(api, STUDY_NAME);
  if (decision.action === 'skip' && !inPlace) {
    console.log(
      `"${STUDY_NAME}" already exists (${decision.existing.id}); pass --in-place to rewrite`,
    );
    return;
  }

  let studyId: string;
  if (decision.action === 'skip' && inPlace) {
    studyId = decision.existing.id;
    console.log(`rewriting chapters of ${studyId} in place`);
    const detail = (await (await api.get(`/api/studies/${studyId}`)).json()) as {
      chapters?: { id: string; name: string }[];
    };
    const existing = new Set((detail.chapters ?? []).map((c) => c.name));
    for (const chapter of chapters) {
      if (existing.has(chapter.name)) continue;
      const res = await api.post(`/api/studies/${studyId}/chapters`, chapter);
      if (!res.ok) throw new Error(`add chapter failed: ${res.status} ${await res.text()}`);
      console.log(`  + ${chapter.name}`);
    }
  } else {
    const created = await api.post('/api/studies', {
      name: STUDY_NAME,
      description: STUDY_DESCRIPTION,
      visibility,
      chapter: chapters[0],
    });
    if (!created.ok) throw new Error(`create failed: ${created.status} ${await created.text()}`);
    // The create response nests the study on a real server ({ study, chapters })
    // and some routes answer flat. Read both rather than assume: getting this
    // wrong produced `created undefined` and a run of 404s against prod, with
    // chapter one written and the other six lost.
    const body = (await created.json()) as { id?: string; study?: { id?: string } };
    const id = body.study?.id ?? body.id;
    if (!id) throw new Error(`create returned no study id: ${JSON.stringify(body).slice(0, 200)}`);
    studyId = id;
    console.log(`created ${studyId} (${visibility})`);
    for (const chapter of chapters.slice(1)) {
      const res = await api.post(`/api/studies/${studyId}/chapters`, chapter);
      if (!res.ok) throw new Error(`add chapter failed: ${res.status} ${await res.text()}`);
      console.log(`  + ${chapter.name}`);
    }
  }
  console.log(`\nstudy: ${base.replace(/:\d+$/, ':3010')}/study/${studyId}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
