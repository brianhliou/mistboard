// Diagram + board constants and the shared helpers that build them. Relocated
// verbatim from articles-data.ts; every top-level declaration is exported so
// the per-article content modules and the articles-data.ts barrel can import
// what they reference. Pure relocation — no behavior changes.

import {
  CONE_QUEEN_BOARD,
  DISCOVERY_BOARD,
  fogSquaresFromVisible,
} from '@mistboard/board-render';
import { tokenPieceSize } from '../board-metrics.js';
import {
  applyBanqiMove,
  applyMove as applyXiangqiMove,
  type BanqiDeal,
  type BanqiMove,
  type BanqiPlayerView,
  type BanqiSquare,
  type BackRankRole,
  type Board,
  type Chess960Start,
  createInitialBanqiState,
  createChess960CastlingRightsForSides,
  createChess960InitialBoardForSides,
  createInitialMiniXiangqiBoard,
  createInitialMiniXiangqiState,
  createInitialXiangqiState,
  darkChessVariant,
  type GameState,
  getBanqiPlayerView,
  getMiniXiangqiPlayerView,
  getPlayerView as getXiangqiPlayerView,
  type MiniXiangqiBoard,
  type MiniXiangqiColor,
  type MiniXiangqiGameState,
  type MiniXiangqiPlayerView,
  type MiniXiangqiSquare,
  miniXiangqiCoordOf,
  miniXiangqiSquareOf,
  type PieceRole,
  type Square,
  type XiangqiColor,
  type XiangqiGameState,
  type XiangqiMove,
  type XiangqiPiece,
  type XiangqiPlayerView,
  type XiangqiSquare,
  squareOf as xiangqiSquareOf,
} from '@mistboard/game';
import { BANQI_CONVERSION_GAME } from '../banqi-engine-game.js';
import articleSnapshotFog from '../article-snapshot-fog.json' with { type: 'json' };
import articleSnapshotFogBlack from '../article-snapshot-fog-black.json' with { type: 'json' };
import {
  type XiangqiBoardGeometry,
  xiangqiBoardPoint,
} from '../xiangqi-board-geometry.js';
import type { XiangqiBoardLayout } from '../xiangqi-appearance-storage.js';
import { drawsCrossedSoldier, drawsVeteranSoldier } from '../xiangqi-crossed-soldier.js';
import {
  DEFAULT_XIANGQI_PIECE_SET,
  renderXiangqiPieceGlyphed,
  type XiangqiPieceSet,
  type XiangqiShroudedStyle,
} from '../xiangqi-piece-sets.js';
import type { ArticleSection, CtaBlock, CtaButton } from './types.js';

// Passthrough re-exports: identifiers referenced directly by article content
// objects but defined in upstream modules (not by this module's body).
// Re-exported here so every content module imports all of its references from a
// single './diagrams' surface.
export {
  ARTICLE_OG_POSITIONS,
  boardToPieces,
  DRAFT960_OFFER_A,
  piecesToBoard,
  startingPositionFromBackRank,
} from '@mistboard/board-render';
export {
  CROSSROADS_CHESS_START_FEN,
  renderCrossroadsChessBoard,
  renderCrossroadsChessRow,
} from '../crossroads-chess-diagram.js';
export { CROSSROADS_CHESS_SAMPLE_GAME } from '../crossroads-chess-sample-game.js';
export {
  SHOGI4_CAPTURE,
  SHOGI4_DROP,
  SHOGI4_JUMP_CASES,
  SHOGI4_MOVE_ROYAL,
  SHOGI4_PAIR_CARP,
  SHOGI4_PAIR_FOX,
  SHOGI4_PAIR_RACCOON,
  SHOGI4_PAIR_TAPIR,
  SHOGI4_RULES_THUMBNAIL,
  SHOGI4_START_BOARD,
  SHOGI4_WIN,
} from '../shogi4-rules-diagrams.js';
export { SHOGI4_GAME_STEPS, SHOGI4_GAME_TITLE } from '../shogi4-sample-game.js';
export {
  JUNGLE_DEN_ENTRY,
  JUNGLE_ELEPHANT_STUCK,
  JUNGLE_FLIP_CAPTURE,
  JUNGLE_FLIP_ELEPHANT_STUCK,
  JUNGLE_FLIP_MOVE,
  JUNGLE_FLIP_MUTUAL,
  JUNGLE_FLIP_RAT_TAKES_ELEPHANT,
  JUNGLE_FLIP_REVEAL,
  JUNGLE_FLIP_SETUP,
  JUNGLE_LION_LEAP_ACROSS,
  JUNGLE_LION_LEAP_CAPTURE,
  JUNGLE_NO_WATER,
  JUNGLE_OWN_TRAP,
  JUNGLE_RANK_LADDER,
  JUNGLE_RAT_BLOCKS,
  JUNGLE_RAT_ELEPHANT,
  JUNGLE_RAT_ENTERS_WATER,
  JUNGLE_RAT_SHORELINE,
  JUNGLE_START_BOARD,
  JUNGLE_STEP,
  JUNGLE_TIGER_LEAP,
  JUNGLE_TIGER_NO_HORIZONTAL,
  JUNGLE_TRAP,
} from '../jungle-rules-diagrams.js';

// ── Standardized rules-article closings ───────────────────────────────────
// Two kinds, picked by whether *this article's* game is playable on Mistboard
// today:
//   relatedClosing — the game is not hosted (base games, or fog variants not
//     yet public). Links onward to related rules articles.
//   playClosing — the game is live. Deep-links into the homepage play modal
//     (`/?play=lobby` etc.), so a reader drops straight into starting a game.
// A not-yet-public fog variant flips from related to play by swapping the call.
export function relatedClosing(opts: {
  heading: string;
  lead: string;
  links: CtaButton[];
  layout?: CtaBlock['layout'];
}): ArticleSection {
  return {
    heading: opts.heading,
    blocks: [
      { kind: 'paragraph', text: opts.lead },
      { kind: 'cta', buttons: opts.links, layout: opts.layout },
    ],
  };
}

export function playClosing(opts: {
  heading: string;
  lead: string;
  playLabel: string;
  playHref: string;
  secondary?: CtaButton[];
}): ArticleSection {
  return {
    heading: opts.heading,
    blocks: [
      { kind: 'paragraph', text: opts.lead },
      {
        kind: 'cta',
        buttons: [
          { label: opts.playLabel, href: opts.playHref, emphasis: 'primary' },
          ...(opts.secondary ?? []),
        ],
      },
    ],
  };
}

// Three distinct Chess960 back ranks per side for the Draft960 draft section.
// Each is valid (bishops on opposite-colored squares, king between rooks) and
// visually distinct. OFFER_A for both sides matches the actual D960 sample
// game's starting position (NNRKBQRB / RNQKBBRN) so the offer the reader sees
// in "The draft" is the same one that hits the board in "The starting
// position".
// DRAFT960_OFFER_A is shared with the article OG card (article-positions.ts).
export const DRAFT960_OFFER_B: PieceRole[] = ['rook', 'knight', 'bishop', 'bishop', 'king', 'queen', 'knight', 'rook'];
export const DRAFT960_OFFER_C: PieceRole[] = ['queen', 'rook', 'bishop', 'knight', 'knight', 'bishop', 'king', 'rook'];

export const DRAFT960_BLACK_OFFER_A: PieceRole[] = ['rook', 'knight', 'queen', 'king', 'bishop', 'bishop', 'rook', 'knight'];
export const DRAFT960_BLACK_OFFER_B: PieceRole[] = ['bishop', 'bishop', 'queen', 'knight', 'knight', 'rook', 'king', 'rook'];
export const DRAFT960_BLACK_OFFER_C: PieceRole[] = ['knight', 'bishop', 'bishop', 'queen', 'rook', 'king', 'knight', 'rook'];

// Starting-position triptych for the Fog of War rules article. Visibility is
// derived from the canonical fog-of-war variant kernel so the diagram exactly
// matches what players see in a live game.
export const DARK_CHESS_START_STATE = darkChessVariant.createInitialState('dark-chess-rules-start');
export const DARK_CHESS_START_VIEW_W = darkChessVariant.getPlayerView(DARK_CHESS_START_STATE, 'white');
export const DARK_CHESS_START_VIEW_B = darkChessVariant.getPlayerView(DARK_CHESS_START_STATE, 'black');
export const DARK_CHESS_START_FOG_W = fogSquaresFromVisible(DARK_CHESS_START_VIEW_W.visibleSquares);
export const DARK_CHESS_START_FOG_B = fogSquaresFromVisible(DARK_CHESS_START_VIEW_B.visibleSquares);

// Helper: derive the visibility complement for a player on a state.
export function fogFor(state: GameState, player: 'white' | 'black'): Square[] {
  return fogSquaresFromVisible(darkChessVariant.getPlayerView(state, player).visibleSquares);
}

// Helper: apply a sequence of moves from a start state; returns all states
// including the start. states[0] = start, states[N] = after N-th move.
export function replayMoves(
  start: GameState,
  moves: Array<{ from: Square; to: Square; promotion?: Exclude<PieceRole, 'king' | 'pawn'> }>,
): GameState[] {
  const states: GameState[] = [start];
  for (const move of moves) {
    states.push(darkChessVariant.applyMove(states[states.length - 1]!, move));
  }
  return states;
}

// ── Section 1: per-piece visibility cones ─────────────────────────────────
// Each demo is a near-empty board with only white pieces (the variant's
// visibility kernel doesn't require kings of either color for static
// rendering). Bishop demo uses two white bishops — one on a light square
// (e4) and one on a dark square (c3) — so the combined cones cover both
// colors and the color-locked nature of the piece is visible. Pawn demo
// uses five pawns on different files and ranks to show how vision differs
// by start-square: a rank-2 pawn sees two squares forward (single + double
// push), a moved pawn sees only one.
export function coneState(id: string, board: Board): GameState {
  return {
    id,
    variant: 'dark-chess',
    board,
    status: { type: 'playing', turn: 'white' },
    moveNumber: 30,
    castlingRights: [],
    halfmoveClock: 0,
  };
}
export const CONE_KNIGHT = coneState('cone-knight', {
  e4: { color: 'white', role: 'knight' },
  c5: { color: 'white', role: 'knight' },
});
export const CONE_BISHOP = coneState('cone-bishop', {
  e4: { color: 'white', role: 'bishop' },
  c3: { color: 'white', role: 'bishop' },
});
export const CONE_ROOK = coneState('cone-rook', {
  e4: { color: 'white', role: 'rook' },
  c6: { color: 'white', role: 'rook' },
});
export const CONE_QUEEN = coneState('cone-queen', CONE_QUEEN_BOARD);
export const CONE_PAWN = coneState('cone-pawn', {
  a2: { color: 'white', role: 'pawn' },
  b3: { color: 'white', role: 'pawn' },
  c2: { color: 'white', role: 'pawn' },
  d2: { color: 'white', role: 'pawn' },
  e4: { color: 'white', role: 'pawn' },
  f3: { color: 'white', role: 'pawn' },
  g3: { color: 'white', role: 'pawn' },
  h5: { color: 'white', role: 'pawn' },
});
export const CONE_KING = coneState('cone-king', {
  e4: { color: 'white', role: 'king' },
});
export const CONE_KNIGHT_FOG = fogFor(CONE_KNIGHT, 'white');
export const CONE_BISHOP_FOG = fogFor(CONE_BISHOP, 'white');
export const CONE_ROOK_FOG = fogFor(CONE_ROOK, 'white');
export const CONE_QUEEN_FOG = fogFor(CONE_QUEEN, 'white');
export const CONE_PAWN_FOG = fogFor(CONE_PAWN, 'white');
export const CONE_KING_FOG = fogFor(CONE_KING, 'white');

// Basic movement diagrams for the chess primer.
export const BASIC_KING = coneState('basic-chess-king', {
  e4: { color: 'white', role: 'king' },
});
export const BASIC_QUEEN = coneState('basic-chess-queen', {
  e4: { color: 'white', role: 'queen' },
});
export const BASIC_ROOK = coneState('basic-chess-rook', {
  e4: { color: 'white', role: 'rook' },
});
export const BASIC_BISHOP = coneState('basic-chess-bishop', {
  e4: { color: 'white', role: 'bishop' },
});
export const BASIC_KNIGHT = coneState('basic-chess-knight', {
  d4: { color: 'white', role: 'knight' },
});
export const BASIC_PAWN = coneState('basic-chess-pawn', {
  e2: { color: 'white', role: 'pawn' },
  d3: { color: 'black', role: 'knight' },
  f3: { color: 'black', role: 'bishop' },
});
export const BASIC_KING_TARGETS: Square[] = ['d3', 'e3', 'f3', 'd4', 'f4', 'd5', 'e5', 'f5'];
export const BASIC_ROOK_TARGETS: Square[] = [
  'e1',
  'e2',
  'e3',
  'e5',
  'e6',
  'e7',
  'e8',
  'a4',
  'b4',
  'c4',
  'd4',
  'f4',
  'g4',
  'h4',
];
export const BASIC_BISHOP_TARGETS: Square[] = [
  'b1',
  'c2',
  'd3',
  'f3',
  'g2',
  'h1',
  'a8',
  'b7',
  'c6',
  'd5',
  'f5',
  'g6',
  'h7',
];
export const BASIC_QUEEN_TARGETS: Square[] = [...BASIC_ROOK_TARGETS, ...BASIC_BISHOP_TARGETS];
export const BASIC_KNIGHT_TARGETS: Square[] = ['b3', 'b5', 'c2', 'c6', 'e2', 'e6', 'f3', 'f5'];
export const BASIC_CASTLE_BEFORE: Board = {
  e1: { color: 'white', role: 'king' },
  h1: { color: 'white', role: 'rook' },
};
export const BASIC_CASTLE_AFTER: Board = {
  g1: { color: 'white', role: 'king' },
  f1: { color: 'white', role: 'rook' },
};
export const BASIC_PROMOTION_BEFORE: Board = {
  e7: { color: 'white', role: 'pawn' },
  h8: { color: 'black', role: 'king' },
};
export const BASIC_PROMOTION_AFTER: Board = {
  e8: { color: 'white', role: 'queen' },
  h8: { color: 'black', role: 'king' },
};
export const BASIC_EN_PASSANT_BEFORE: Board = {
  e5: { color: 'white', role: 'pawn' },
  d5: { color: 'black', role: 'pawn' },
  h8: { color: 'black', role: 'king' },
};
export const BASIC_EN_PASSANT_AFTER: Board = {
  d6: { color: 'white', role: 'pawn' },
  h8: { color: 'black', role: 'king' },
};
// Canonical king-and-queen stalemate. Black to move: the king on a8 is NOT in
// check, but its only squares (a7, b7, b8) are all covered by the queen on b6,
// and Black has no other piece to move. No legal move + no check = draw.
export const BASIC_STALEMATE: Board = {
  a8: { color: 'black', role: 'king' },
  a6: { color: 'white', role: 'king' },
  b6: { color: 'white', role: 'queen' },
};

// ── Pawn capture visibility demo ─────────────────────────────────────────
// Pawns are the one piece whose "reach" differs between empty movement and
// capture. Empty diagonals stay fogged; occupied enemy diagonals appear.
export const PAWN_CAPTURE_EXAMPLES = coneState('pawn-capture-examples', {
  a2: { color: 'white', role: 'pawn' },
  b2: { color: 'white', role: 'pawn' },
  c2: { color: 'white', role: 'pawn' },
  d3: { color: 'white', role: 'pawn' },
  e4: { color: 'white', role: 'pawn' },
  f5: { color: 'white', role: 'pawn' },
  g4: { color: 'white', role: 'pawn' },
  h2: { color: 'white', role: 'pawn' },
  a4: { color: 'black', role: 'pawn' },
  b4: { color: 'black', role: 'pawn' },
  c6: { color: 'black', role: 'pawn' },
  d5: { color: 'black', role: 'pawn' },
  e7: { color: 'black', role: 'pawn' },
  f7: { color: 'black', role: 'pawn' },
  g7: { color: 'black', role: 'pawn' },
  h5: { color: 'black', role: 'pawn' },
});
export const PAWN_CAPTURE_EXAMPLES_FOG = fogFor(PAWN_CAPTURE_EXAMPLES, 'white');

// ── En passant demo ───────────────────────────────────────────────────────
// Four white pawns on the 5th rank, full black 7th rank. Black pushes
// b/d/f/h pawn two squares; white captures e.p. on three of them. The
// second push (after d7-d5) white passes with Kh1 — the e.p. window
// closes and the pushed pawn re-enters fog. The tail (a5/b7) shows white
// declining e.p. with a quiet push instead — legal, and lets the e.p.
// window close the same way Kh1 did.
export const ENPASSANT_INITIAL_BOARD: Board = {
  g1: { color: 'white', role: 'king' },
  a5: { color: 'white', role: 'pawn' },
  c5: { color: 'white', role: 'pawn' },
  e5: { color: 'white', role: 'pawn' },
  g5: { color: 'white', role: 'pawn' },
  g8: { color: 'black', role: 'king' },
  a7: { color: 'black', role: 'pawn' },
  b7: { color: 'black', role: 'pawn' },
  c7: { color: 'black', role: 'pawn' },
  d7: { color: 'black', role: 'pawn' },
  e7: { color: 'black', role: 'pawn' },
  f7: { color: 'black', role: 'pawn' },
  g7: { color: 'black', role: 'pawn' },
  h7: { color: 'black', role: 'pawn' },
};
export const ENPASSANT_INITIAL: GameState = {
  id: 'dark-chess-rules-enpassant',
  variant: 'dark-chess',
  board: ENPASSANT_INITIAL_BOARD,
  status: { type: 'playing', turn: 'black' },
  moveNumber: 30,
  castlingRights: [],
  halfmoveClock: 0,
};
export const ENPASSANT_MOVES = [
  { from: 'b7' as Square, to: 'b5' as Square },  // 1...b5
  { from: 'a5' as Square, to: 'b6' as Square },  // 2. axb6 e.p.
  { from: 'd7' as Square, to: 'd5' as Square },  // 2...d5
  { from: 'g1' as Square, to: 'h1' as Square },  // 3. Kh1 — pass; e.p. window closes
  { from: 'f7' as Square, to: 'f5' as Square },  // 3...f5
  { from: 'e5' as Square, to: 'f6' as Square },  // 4. exf6 e.p.
  { from: 'h7' as Square, to: 'h5' as Square },  // 4...h5
  { from: 'g5' as Square, to: 'h6' as Square },  // 5. gxh6 e.p.
  { from: 'a7' as Square, to: 'a5' as Square },  // 5...a5
  { from: 'b6' as Square, to: 'b7' as Square },  // 6. b7 — quiet push, declines bxa6 e.p.
];
export const ENPASSANT_STATES = replayMoves(ENPASSANT_INITIAL, ENPASSANT_MOVES);
export const ENPASSANT_POSITIONS = ENPASSANT_STATES.map((state, i) => {
  // Frame 0 = initial (no prior move). Otherwise the move that produced
  // this state is at ENPASSANT_MOVES[i - 1].
  const lastMove = i === 0 ? undefined : ENPASSANT_MOVES[i - 1];
  const arrows = lastMove ? [{ orig: lastMove.from, dest: lastMove.to }] : undefined;
  // Per-frame call-outs: frame 2/11 (after 1...b5) names the b5/b6 e.p.
  // window; frame 5/11 (after 3.Kh1 passes) names the d5/d6 window that
  // just closed.
  const highlightSquares: Square[] =
    i === 1 ? ['b5', 'b6'] : i === 4 ? ['d5', 'd6'] : [];
  return {
    boards: [
      {
        board: state.board,
        fogSquares: fogFor(state, 'white'),
        orientation: 'white' as const,
        label: "WHITE'S VIEW",
        ...(highlightSquares.length ? { highlightSquares } : {}),
      },
      {
        board: state.board,
        orientation: 'white' as const,
        label: 'SERVER TRUTH',
        arrows,
      },
      {
        board: state.board,
        fogSquares: fogFor(state, 'black'),
        orientation: 'white' as const,
        label: "BLACK'S VIEW",
      },
    ],
  };
});

// ── Discovered visibility demo ────────────────────────────────────────────
// White rooks doubled on the d-file (d1 supports d3). White's d3 rook sees
// up the d-file but not across rank 7, so Black's king (h7) and queen (b7)
// sit in fog. White slides Rd3-d7 — the rook's new square reveals rank 7,
// and both black pieces appear in white's view at once. The d1 rook keeps
// the d-file in sight throughout. Demonstrates "moving a piece moves its
// sight": new squares enter visibility on the next half-move.
// DISCOVERY_BOARD is shared with the article OG card (article-positions.ts).
export const DISCOVERY_BEFORE: GameState = {
  id: 'dark-chess-rules-discovery',
  variant: 'dark-chess',
  board: DISCOVERY_BOARD,
  status: { type: 'playing', turn: 'white' },
  moveNumber: 15,
  castlingRights: [],
  halfmoveClock: 0,
};
export const DISCOVERY_FINAL = darkChessVariant.applyMove(DISCOVERY_BEFORE, { from: 'd3', to: 'd7' });
export const DISCOVERY_BEFORE_FOG_W = fogFor(DISCOVERY_BEFORE, 'white');
export const DISCOVERY_FINAL_FOG_W = fogFor(DISCOVERY_FINAL, 'white');

// ── Sample game: PvE 8d0c230e (Misty 1.0 vs test1) ────────────────────────
// A complete live PvE game from production: Mistboard's engine (Misty 1.0)
// plays White against a human (test1) at 60+1. White wins; Black resigns on
// ply 75, after 38.Rxd5 wins the queen.
// https://mistboard.com/game/8d0c230e-ff56-4ece-a7cc-0488b1d62640
export const ENGINE_SAMPLE_START = darkChessVariant.createInitialState('pve-8d0c230e');
export const ENGINE_SAMPLE_STATES = replayMoves(ENGINE_SAMPLE_START, [
  { from: 'e2', to: 'e4' },  // 1.
  { from: 'c7', to: 'c6' },  // 1...
  { from: 'b1', to: 'c3' },  // 2.
  { from: 'd7', to: 'd5' },  // 2...
  { from: 'e4', to: 'd5' },  // 3.
  { from: 'c6', to: 'd5' },  // 3...
  { from: 'd2', to: 'd4' },  // 4.
  { from: 'b8', to: 'c6' },  // 4...
  { from: 'c1', to: 'e3' },  // 5.
  { from: 'g8', to: 'f6' },  // 5...
  { from: 'f1', to: 'd3' },  // 6.
  { from: 'd8', to: 'd6' },  // 6...
  { from: 'g1', to: 'f3' },  // 7.
  { from: 'g7', to: 'g5' },  // 7...
  { from: 'f3', to: 'g5' },  // 8.
  { from: 'h8', to: 'g8' },  // 8...
  { from: 'e1', to: 'h1' },  // 9.
  { from: 'c8', to: 'f5' },  // 9...
  { from: 'd3', to: 'f5' },  // 10.
  { from: 'e7', to: 'e6' },  // 10...
  { from: 'f5', to: 'd3' },  // 11.
  { from: 'f6', to: 'e4' },  // 11...
  { from: 'c3', to: 'e4' },  // 12.
  { from: 'd5', to: 'e4' },  // 12...
  { from: 'g5', to: 'e4' },  // 13.
  { from: 'd6', to: 'c7' },  // 13...
  { from: 'd1', to: 'f3' },  // 14.
  { from: 'f8', to: 'e7' },  // 14...
  { from: 'f3', to: 'h3' },  // 15.
  { from: 'e8', to: 'a8' },  // 15...
  { from: 'a2', to: 'a4' },  // 16.
  { from: 'g8', to: 'g6' },  // 16...
  { from: 'e3', to: 'd2' },  // 17.
  { from: 'd8', to: 'g8' },  // 17...
  { from: 'f1', to: 'b1' },  // 18.
  { from: 'g6', to: 'g2' },  // 18...
  { from: 'h3', to: 'g2' },  // 19.
  { from: 'g8', to: 'g2' },  // 19...
  { from: 'g1', to: 'g2' },  // 20.
  { from: 'c6', to: 'd8' },  // 20...
  { from: 'f2', to: 'f3' },  // 21.
  { from: 'e7', to: 'd6' },  // 21...
  { from: 'e4', to: 'd6' },  // 22.
  { from: 'c7', to: 'd6' },  // 22...
  { from: 'b1', to: 'g1' },  // 23.
  { from: 'c8', to: 'd7' },  // 23...
  { from: 'g2', to: 'h1' },  // 24.
  { from: 'd8', to: 'c6' },  // 24...
  { from: 'd2', to: 'c3' },  // 25.
  { from: 'b7', to: 'b5' },  // 25...
  { from: 'a4', to: 'b5' },  // 26.
  { from: 'c6', to: 'e7' },  // 26...
  { from: 'g1', to: 'g2' },  // 27.
  { from: 'e7', to: 'd5' },  // 27...
  { from: 'd3', to: 'e4' },  // 28.
  { from: 'd5', to: 'c3' },  // 28...
  { from: 'b2', to: 'c3' },  // 29.
  { from: 'e6', to: 'e5' },  // 29...
  { from: 'd4', to: 'e5' },  // 30.
  { from: 'd6', to: 'e5' },  // 30...
  { from: 'g2', to: 'g1' },  // 31.
  { from: 'd7', to: 'e6' },  // 31...
  { from: 'b5', to: 'b6' },  // 32.
  { from: 'a7', to: 'b6' },  // 32...
  { from: 'a1', to: 'a8' },  // 33.
  { from: 'f7', to: 'f5' },  // 33...
  { from: 'e4', to: 'b7' },  // 34.
  { from: 'e6', to: 'f6' },  // 34...
  { from: 'a8', to: 'a1' },  // 35.
  { from: 'f5', to: 'f4' },  // 35...
  { from: 'a1', to: 'd1' },  // 36.
  { from: 'h7', to: 'h6' },  // 36...
  { from: 'b7', to: 'd5' },  // 37.
  { from: 'e5', to: 'd5' },  // 37...
  { from: 'd1', to: 'd5' },  // 38.
]);

export const ENGINE_SAMPLE_POSITIONS = ENGINE_SAMPLE_STATES.map((state) => {
  const arrows = state.lastMove ? [{ orig: state.lastMove.from, dest: state.lastMove.to }] : undefined;
  return {
    boards: [
      { board: state.board, fogSquares: fogFor(state, 'white'), orientation: 'white' as const, label: "WHITE'S VIEW" },
      { board: state.board, orientation: 'white' as const, label: 'SERVER TRUTH', arrows },
      { board: state.board, fogSquares: fogFor(state, 'black'), orientation: 'white' as const, label: "BLACK'S VIEW" },
    ],
  };
});

// ── Draft960 full game: room db07069c ────────────────────────────────────────
// White #700 nnrkbqrb: a1=N b1=N c1=R d1=K e1=B f1=Q g1=R h1=B
// Black #626 rnqkbbrn: a8=R b8=N c8=Q d8=K e8=B f8=B g8=R h8=N
export const D960_W: Chess960Start = {
  id: 700,
  backRank: ['knight', 'knight', 'rook', 'king', 'bishop', 'queen', 'rook', 'bishop'] as BackRankRole[],
  fenPlacement: 'nnrkbqrb',
};
export const D960_B: Chess960Start = {
  id: 626,
  backRank: ['rook', 'knight', 'queen', 'king', 'bishop', 'bishop', 'rook', 'knight'] as BackRankRole[],
  fenPlacement: 'rnqkbbrn',
};
export const D960_REVEAL_S0: GameState = {
  id: 'draft960-reveal',
  variant: 'dark-chess',
  board: createChess960InitialBoardForSides(D960_W, D960_B),
  status: { type: 'playing', turn: 'white' },
  moveNumber: 1,
  castlingRights: createChess960CastlingRightsForSides(D960_W, D960_B),
  halfmoveClock: 0,
};

export const D960_FULL_STATES = replayMoves(D960_REVEAL_S0, [
  { from: 'e2', to: 'e4' },                        // 1. e4
  { from: 'h8', to: 'g6' },                        // 1...Nhg6 ← h8 KNIGHT reveal
  { from: 'f2', to: 'f3' },                        // 2. f3
  { from: 'a7', to: 'a5' },                        // 2...a5
  { from: 'e1', to: 'f2' },                        // 3. Be1f2 ← e1 BISHOP reveal
  { from: 'a5', to: 'a4' },                        // 3...a4
  { from: 'b1', to: 'c3' },                        // 4. Nc3
  { from: 'f7', to: 'f6' },                        // 4...f6
  { from: 'd2', to: 'd4' },                        // 5. d4
  { from: 'e8', to: 'f7' },                        // 5...Bef7 ← e8 BISHOP reveal
  { from: 'd1', to: 'c1' },                        // 6. O-O-O ← d1 KING reveals via castling
  { from: 'e7', to: 'e5' },                        // 6...e5
  { from: 'd4', to: 'd5' },                        // 7. d5
  { from: 'f8', to: 'd6' },                        // 7...Bfd6 ← f8 BISHOP reveal
  { from: 'g2', to: 'g4' },                        // 8. g4
  { from: 'd8', to: 'g8' },                        // 8...O-O ← d8 KING reveals via castling
  { from: 'c3', to: 'e2' },                        // 9. Ne2
  { from: 'c7', to: 'c6' },                        // 9...c6
  { from: 'd5', to: 'c6' },                        // 10. dxc6
  { from: 'd7', to: 'c6' },                        // 10...dxc6
  { from: 'e2', to: 'g3' },                        // 11. Ng3
  { from: 'd6', to: 'c7' },                        // 11...Bc7
  { from: 'h2', to: 'h4' },                        // 12. h4
  { from: 'g6', to: 'e7' },                        // 12...Ne7
  { from: 'f3', to: 'f4' },                        // 13. f4
  { from: 'e5', to: 'f4' },                        // 13...exf4
  { from: 'g3', to: 'e2' },                        // 14. Ne2
  { from: 'g7', to: 'g5' },                        // 14...g5
  { from: 'h4', to: 'g5' },                        // 15. hxg5
  { from: 'f6', to: 'g5' },                        // 15...fxg5
  { from: 'h1', to: 'f3' },                        // 16. Bhf3 ← h1 BISHOP reveal
  { from: 'f7', to: 'g6' },                        // 16...Bg6
  { from: 'c2', to: 'c3' },                        // 17. c3
  { from: 'b8', to: 'd7' },                        // 17...Nbd7 ← b8 KNIGHT reveal
  { from: 'a1', to: 'c2' },                        // 18. Na1c2 ← a1 KNIGHT reveal
  { from: 'd7', to: 'e5' },                        // 18...Ne5
  { from: 'c1', to: 'b1' },                        // 19. Kb1
  { from: 'e5', to: 'f3' },                        // 19...Nxf3
  { from: 'g1', to: 'h1' },                        // 20. Rh1
  { from: 'f3', to: 'e5' },                        // 20...Ne5
  { from: 'f2', to: 'c5' },                        // 21. Bc5
  { from: 'c8', to: 'e6' },                        // 21...Qe6 ← c8 QUEEN reveal
  { from: 'c5', to: 'e7' },                        // 22. Bxe7
  { from: 'e6', to: 'e7' },                        // 22...Qxe7
  { from: 'e2', to: 'd4' },                        // 23. Nd4
  { from: 'f4', to: 'f3' },                        // 23...f3
  { from: 'c2', to: 'b4' },                        // 24. Nb4
  { from: 'e7', to: 'b4' },                        // 24...Qxb4
  { from: 'c3', to: 'b4' },                        // 25. cxb4
  { from: 'f3', to: 'f2' },                        // 25...f2
  { from: 'h1', to: 'h2' },                        // 26. Rh2
  { from: 'e5', to: 'g4' },                        // 26...Ng4
  { from: 'h2', to: 'g2' },                        // 27. Rg2
  { from: 'g4', to: 'e3' },                        // 27...Ne3
  { from: 'd1', to: 'd2' },                        // 28. Rd2
  { from: 'e3', to: 'g2' },                        // 28...Nxg2
  { from: 'f1', to: 'g2' },                        // 29. Qxg2
  { from: 'f2', to: 'f1', promotion: 'queen' },    // 29...f1=Q ← PROMOTION
  { from: 'g2', to: 'f1' },                        // 30. Qxf1
  { from: 'f8', to: 'f1' },                        // 30...Rxf1 (castled rook)
  { from: 'b1', to: 'c2' },                        // 31. Kc2
  { from: 'a8', to: 'e8' },                        // 31...Re8
  { from: 'd4', to: 'c6' },                        // 32. Nc6
  { from: 'b7', to: 'c6' },                        // 32...bxc6
  { from: 'd2', to: 'd8' },                        // 33. Rd8+
  { from: 'e8', to: 'd8' },                        // 33...Rxd8
  { from: 'c2', to: 'd3' },                        // 34. Kd3
  { from: 'd8', to: 'd3' },                        // 34...Rxd3# ← KING CAPTURED
]);

// Narratives: empty strings use auto-label; notable moments get annotations.
export const D960_NARRATIVES: string[] = [
  "Both players have picked. White chose NNRKBQRB — knights on a1 and b1, king on d1, bishop on e1. Black chose RNQKBBRN — queen on c8, king on d8, knight on h8. Neither player can see the other's back rank.",
  "1.e4. Standard-looking first move. Nothing unusual yet.",
  "1...h8–g6. Something on h8 jumps to g6. Only a knight moves in an L-shape. In standard chess, h8 is a rook — rooks can't jump. Black's h8 has a knight.",
  "2.f3. White's f-pawn advances, clearing f2.",
  "2...a5. Black pushes the a-pawn.",
  "3.Be1–f2. A piece slides from e1 to f2. In standard chess, e1 is the king — kings don't go to f2 on move 3. This is a bishop. White has a bishop on e1.",
  "3...a4. Black's a-pawn keeps advancing.",
  "4.Nc3. White's b1 knight develops — same square as standard chess.",
  "4...f6. Black pushes the f-pawn.",
  "5.d4. White plays d4.",
  "5...Be8–f7. Black's e8 piece slides to f7 diagonally. Standard chess puts a king on e8 — Black has a bishop there.",
  "6.O-O-O. White castles queenside. The king was on d1; it ends on c1, the rook moves to d1. Non-standard king square revealed through castling.",
  "6...e5. Black's e-pawn advances.",
  "7.d5. White pushes the d-pawn.",
  "7...Bf8–d6. Black's f8 piece goes to d6 diagonally — a bishop. Standard chess also has a bishop on f8, so no surprise here.",
  "8.g4. White's g-pawn advances.",
  "8...O-O. Black castles kingside. The king was on d8; it ends on g8, the rook moves to f8. Non-standard king square revealed.",
  "9.Ne2. White's knight retreats.",
  "9...c6. Black challenges White's pawn chain.",
  "10.dxc6. White captures.",
  "10...dxc6. Black recaptures with the d-pawn.",
  "11.Ng3. Knight moves to g3.",
  "11...Bc7. Black's bishop retreats.",
  "12.h4. White pushes the h-pawn.",
  "12...Ne7. Black's knight repositions.",
  "13.f4. White's f-pawn advances.",
  "13...exf4. Black captures.",
  "14.Ne2. Knight retreats.",
  "14...g5. Black's g-pawn advances.",
  "15.hxg5. White captures on g5.",
  "15...fxg5. Black recaptures.",
  "16.Bh1–f3. White's h1 piece goes to f3 diagonally. Standard chess also has a bishop on h1 in some openings — but White's h1 was definitely a bishop in this setup.",
  "16...Bg6. Black's bishop moves.",
  "17.c3. White's c-pawn advances.",
  "17...Nb8–d7. Black's b8 piece jumps to d7 — a knight. Standard chess also has a knight on b8.",
  "18.Na1–c2. White's a1 piece jumps to c2 — a knight. Standard chess has a rook on a1. White's a1 has a knight.",
  "18...Ne5. Black's knight centralizes.",
  "19.Kb1. White's king steps to b1.",
  "19...Nxf3. Black's knight captures.",
  "20.Rh1. White's rook moves.",
  "20...Ne5. Black's knight returns.",
  "21.Bc5. White's bishop moves to c5.",
  "21...Qc8–e6. Black's c8 piece moves to e6 along a diagonal — a queen. Standard chess has a bishop on c8. Black has a queen there.",
  "22.Bxe7. White captures.",
  "22...Qxe7. Black recaptures with the queen.",
  "23.Nd4. White's knight goes to d4.",
  "23...f3. Black's pawn advances.",
  "24.Nb4. White's knight jumps.",
  "24...Qxb4. Black's queen captures.",
  "25.cxb4. White's pawn recaptures.",
  "25...f2. Black's pawn reaches f2.",
  "26.Rh2. White's rook moves.",
  "26...Ng4. Black's knight goes to g4.",
  "27.Rg2. White's rook slides.",
  "27...Ne3. Black's knight forks.",
  "28.Rd2. White's rook moves.",
  "28...Nxg2. Black's knight captures the rook.",
  "29.Qxg2. White's queen recaptures.",
  "29...f1=Q. Black's pawn promotes to queen.",
  "30.Qxf1. White captures the new queen.",
  "30...Rxf1. Black's rook recaptures.",
  "31.Kc2. White's king steps forward.",
  "31...Re8. Black's rook activates.",
  "32.Nc6. White's knight attacks.",
  "32...bxc6. Black's pawn captures.",
  "33.Rd8+. White's rook checks.",
  "33...Rxd8. Black's rook captures.",
  "34.Kd3. White's king walks into the open.",
  "34...Rxd3. Black's rook captures the king. Game over.",
];

export const D960_FULL_POSITIONS = D960_FULL_STATES.map((state, i) => {
  const isLast = i === D960_FULL_STATES.length - 1;
  return {
    ...(isLast ? { outcome: { headline: 'Black wins', reason: 'king captured', tone: 'win' as const } } : {}),
    boards: [
      { board: state.board, fogSquares: fogFor(state, 'white'), orientation: 'white' as const, label: "WHITE'S VIEW" },
      { board: state.board, orientation: 'white' as const, label: 'SERVER TRUTH' },
      { board: state.board, fogSquares: fogFor(state, 'black'), orientation: 'white' as const, label: "BLACK'S VIEW" },
    ],
  };
});

// Fog for the draft-section offer boards. White's offers fog the top half;
// black's offers fog the bottom half so each side's view mirrors the other.
export const PICK_SCREEN_FOG: Square[] = [
  'a5', 'b5', 'c5', 'd5', 'e5', 'f5', 'g5', 'h5',
  'a6', 'b6', 'c6', 'd6', 'e6', 'f6', 'g6', 'h6',
  'a7', 'b7', 'c7', 'd7', 'e7', 'f7', 'g7', 'h7',
  'a8', 'b8', 'c8', 'd8', 'e8', 'f8', 'g8', 'h8',
];

export const BLACK_PICK_SCREEN_FOG: Square[] = [
  'a1', 'b1', 'c1', 'd1', 'e1', 'f1', 'g1', 'h1',
  'a2', 'b2', 'c2', 'd2', 'e2', 'f2', 'g2', 'h2',
  'a3', 'b3', 'c3', 'd3', 'e3', 'f3', 'g3', 'h3',
  'a4', 'b4', 'c4', 'd4', 'e4', 'f4', 'g4', 'h4',
];

// ── Win-condition demo: vs-brian-game-3 final plies ──────────────────────────
// Brian (Black) vs production tier-1 engine (White), bakeoff PvE match. The
// engine's king walks Kf1→Ke1 with a black queen lurking unseen on e5 (it
// captured there four moves earlier); Qxe1 ends the game. Real game
// illustrating the canonical FoW failure mode: a king walking onto a file
// occupied by an opposing slider that sat outside the king's vision.
export const VS_BRIAN_3_START = darkChessVariant.createInitialState('vs-brian-game-3');
export const VS_BRIAN_3_STATES = replayMoves(VS_BRIAN_3_START, [
  { from: 'e2', to: 'e3' },
  { from: 'e7', to: 'e6' },
  { from: 'f1', to: 'e2' },
  { from: 'g8', to: 'f6' },
  { from: 'd2', to: 'd3' },
  { from: 'f8', to: 'e7' },
  { from: 'c1', to: 'd2' },
  { from: 'c7', to: 'c6' },
  { from: 'd3', to: 'd4' },
  { from: 'd7', to: 'd5' },
  { from: 'e2', to: 'd3' },
  { from: 'b8', to: 'd7' },
  { from: 'g1', to: 'e2' },
  { from: 'd7', to: 'b6' },
  { from: 'e1', to: 'h1' },  // 15. O-O (king e1 → h1 notation)
  { from: 'e7', to: 'd6' },
  { from: 'e2', to: 'g3' },
  { from: 'h7', to: 'h5' },
  { from: 'e3', to: 'e4' },
  { from: 'h5', to: 'h4' },
  { from: 'g3', to: 'e2' },
  { from: 'd5', to: 'e4' },
  { from: 'd3', to: 'e4' },
  { from: 'f6', to: 'e4' },
  { from: 'e2', to: 'f4' },
  { from: 'g7', to: 'g5' },
  { from: 'f1', to: 'e1' },
  { from: 'g5', to: 'f4' },
  { from: 'e1', to: 'e4' },
  { from: 'd8', to: 'f6' },
  { from: 'd1', to: 'e2' },
  { from: 'c8', to: 'd7' },
  { from: 'd4', to: 'd5' },
  { from: 'c6', to: 'd5' },
  { from: 'e4', to: 'b4' },
  { from: 'd6', to: 'b4' },
  { from: 'd2', to: 'b4' },
  { from: 'a8', to: 'c8' },
  { from: 'e2', to: 'f3' },
  { from: 'a7', to: 'a6' },
  { from: 'b1', to: 'd2' },
  { from: 'd7', to: 'b5' },
  { from: 'a1', to: 'e1' },
  { from: 'e8', to: 'd7' },
  { from: 'b4', to: 'c5' },
  { from: 'c8', to: 'c6' },
  { from: 'c2', to: 'c4' },
  { from: 'b6', to: 'c4' },
  { from: 'd2', to: 'c4' },
  { from: 'b5', to: 'c4' },
  { from: 'e1', to: 'e6' },
  { from: 'f7', to: 'e6' },
  { from: 'f3', to: 'd5' },
  { from: 'c4', to: 'd5' },
  { from: 'c5', to: 'd4' },
  { from: 'e6', to: 'e5' },
  { from: 'd4', to: 'e5' },
  { from: 'f6', to: 'e5' },
  { from: 'g1', to: 'f1' },
  { from: 'h8', to: 'g8' },
  { from: 'f1', to: 'e1' },  // 61. Ke1 — the fatal step onto the open e-file
  { from: 'e5', to: 'e1' },  // 62. Rxe1 — king captured
]);

// ── Win-condition demo: 13-ply game where white wins via bishop ────────────
// Production tier1 (White) plays Bf1-b5, eyeing the long diagonal to e8.
// Black, drawn to a material capture, plays dxe4 — that move persists into
// the final frame (the e4 pawn is gone). White ignores the captured pawn
// and plays Bxe8, taking the king on its starting square. Rendered as a
// triptych stepper (BLACK + SERVER + WHITE) so the reader can compare what
// each side saw at each of the three key moves.
export const WHITE_BISHOP_WIN_START = darkChessVariant.createInitialState('white-bishop-win');
export const WHITE_BISHOP_WIN_STATES = replayMoves(WHITE_BISHOP_WIN_START, [
  { from: 'e2', to: 'e4' },
  { from: 'b7', to: 'b6' },
  { from: 'b1', to: 'c3' },
  { from: 'c7', to: 'c5' },
  { from: 'd2', to: 'd4' },
  { from: 'e7', to: 'e6' },
  { from: 'd4', to: 'c5' },
  { from: 'b6', to: 'c5' },
  { from: 'g1', to: 'f3' },
  { from: 'd7', to: 'd5' },
  { from: 'f1', to: 'b5' },  // 11. Bb5 — bishop on the long diagonal
  { from: 'd5', to: 'e4' },  // 12. ...dxe4 — black grabs the e4 pawn
  { from: 'b5', to: 'e8' },  // 13. Bxe8 — king captured on its starting square
]);
// Frame 2 (after 11. Bb5) gets a red circle on e8 to call out that the bishop
// is now eyeing the king's starting square through a clear diagonal.
export type WinShape = { orig: Square; dest?: Square; brush?: 'red' | 'green' };
export const WHITE_BISHOP_WIN_POSITIONS = [
  { stateIdx: 10, shapes: [] as WinShape[] },
  {
    stateIdx: 11,
    shapes: [
      { orig: 'f1' as Square, dest: 'b5' as Square },
      { orig: 'e8' as Square, brush: 'red' as const },
    ] as WinShape[],
  },
  { stateIdx: 12, shapes: [{ orig: 'd5' as Square, dest: 'e4' as Square }] as WinShape[] },
  { stateIdx: 13, shapes: [{ orig: 'b5' as Square, dest: 'e8' as Square }] as WinShape[] },
].map(({ stateIdx, shapes }) => {
  const state = WHITE_BISHOP_WIN_STATES[stateIdx]!;
  return {
    boards: [
      {
        board: state.board,
        fogSquares: fogFor(state, 'white'),
        orientation: 'white' as const,
        label: "WHITE'S VIEW",
      },
      {
        board: state.board,
        orientation: 'white' as const,
        label: 'SERVER TRUTH',
        arrows: shapes.length ? shapes : undefined,
      },
      {
        board: state.board,
        fogSquares: fogFor(state, 'black'),
        orientation: 'white' as const,
        label: "BLACK'S VIEW",
      },
    ],
  };
});

// ── Castling triple-threat ──────────────────────────────────────────────────
// Kingside castling that is simultaneously out of, through, and into check.
// Black's knight on f3 covers e1 (out of) and g1 (into); black's bishop on a6
// covers f1 (through) along the a6-f1 diagonal. In FoW none of these matter —
// castling has no check restrictions. White castles, the king lands on g1,
// and Black's knight captures it on the next move.
//
// White visibility is set up so neither attacker is in sight: no e2/f2/g2
// pawns means no diagonal-capture vision onto f3, and a6 is far outside
// white's rank-1 line.
// PRE state: White knight is still on e4, about to jump to f6. Frame 1 of
// the stepper. After White plays Ne4-f6, the position becomes
// CASTLE_TRIPLE_BEFORE. Mirrored from the symmetric setup so that the
// reader views from White's perspective and Black is the side castling
// into the threat.
export const CASTLE_TRIPLE_PRE_BOARD: Board = {
  // Black: castling side
  e8: { color: 'black', role: 'king' },
  h8: { color: 'black', role: 'rook' },
  // White: attacking side
  a3: { color: 'white', role: 'bishop' },
  b1: { color: 'white', role: 'king' },
  e4: { color: 'white', role: 'knight' },
};
export const CASTLE_TRIPLE_PRE: GameState = {
  id: 'dark-chess-rules-castle-triple',
  variant: 'dark-chess',
  board: CASTLE_TRIPLE_PRE_BOARD,
  status: { type: 'playing', turn: 'white' },
  moveNumber: 20,
  castlingRights: ['a8', 'h8'],
  halfmoveClock: 0,
};
// White plays Ne4-f6, landing the threat on e8/f8/g8. Then Black castles
// kingside; then White's knight captures the king on g8.
export const CASTLE_TRIPLE_BEFORE = darkChessVariant.applyMove(CASTLE_TRIPLE_PRE, { from: 'e4', to: 'f6' });
export const CASTLE_TRIPLE_AFTER = darkChessVariant.applyMove(CASTLE_TRIPLE_BEFORE, { from: 'e8', to: 'h8' });
export const CASTLE_TRIPLE_FINAL = darkChessVariant.applyMove(CASTLE_TRIPLE_AFTER, { from: 'f6', to: 'g8' });
export const CASTLE_TRIPLE_PRE_FOG_W = fogFor(CASTLE_TRIPLE_PRE, 'white');
export const CASTLE_TRIPLE_PRE_FOG_B = fogFor(CASTLE_TRIPLE_PRE, 'black');
export const CASTLE_TRIPLE_BEFORE_FOG_W = fogFor(CASTLE_TRIPLE_BEFORE, 'white');
export const CASTLE_TRIPLE_AFTER_FOG_W = fogFor(CASTLE_TRIPLE_AFTER, 'white');
export const CASTLE_TRIPLE_FINAL_FOG_W = fogFor(CASTLE_TRIPLE_FINAL, 'white');
export const CASTLE_TRIPLE_BEFORE_FOG_B = fogFor(CASTLE_TRIPLE_BEFORE, 'black');
export const CASTLE_TRIPLE_AFTER_FOG_B = fogFor(CASTLE_TRIPLE_AFTER, 'black');
export const CASTLE_TRIPLE_FINAL_FOG_B = fogFor(CASTLE_TRIPLE_FINAL, 'black');

// ── Deduction: pawn that can't push ─────────────────────────────────────────
// Two single-board comparisons. A pawn always sees the square in front of it
// — unless something occupies that square. Fog directly ahead of a pawn is
// the simplest deduction available.
export const DEDUCE_PAWN_OPEN = coneState('deduction-pawn-open', {
  e4: { color: 'white', role: 'pawn' },
});
export const DEDUCE_PAWN_BLOCKED = coneState('deduction-pawn-blocked', {
  e4: { color: 'white', role: 'pawn' },
  e5: { color: 'black', role: 'knight' },
});
export const DEDUCE_PAWN_OPEN_FOG = fogFor(DEDUCE_PAWN_OPEN, 'white');
export const DEDUCE_PAWN_BLOCKED_FOG = fogFor(DEDUCE_PAWN_BLOCKED, 'white');

// ── Deduction: a square that flips to fog (1.d4 e6 2.Nf3 Bb4) ──────────────
// After 2...Bb4, square b4 — previously visible to White via b2's two-square
// push — falls to fog. With c3 and d2 both visible empty, the b4-e1 diagonal
// is open and the king is one move from capture.
export const DEDUCE_BB4_START = darkChessVariant.createInitialState('deduction-bb4');
export const DEDUCE_BB4_STATES = replayMoves(DEDUCE_BB4_START, [
  { from: 'd2', to: 'd4' },
  { from: 'e7', to: 'e6' },
  { from: 'g1', to: 'f3' },
  { from: 'f8', to: 'b4' },
]);
export const DEDUCE_BB4_POSITIONS = DEDUCE_BB4_STATES.map((state, i) => {
  const arrows = state.lastMove ? [{ orig: state.lastMove.from, dest: state.lastMove.to }] : undefined;
  const isFinal = i === DEDUCE_BB4_STATES.length - 1;
  const whiteView = {
    board: state.board,
    fogSquares: fogFor(state, 'white'),
    orientation: 'white' as const,
    label: "WHITE'S VIEW",
    ...(isFinal ? { highlightSquares: ['b4' as Square] } : {}),
  };
  return {
    boards: [
      whiteView,
      { board: state.board, orientation: 'white' as const, label: 'SERVER TRUTH', arrows },
      { board: state.board, fogSquares: fogFor(state, 'black'), orientation: 'white' as const, label: "BLACK'S VIEW" },
    ],
  };
});

// ── Deduction: a sight line names the capturer ────────────────────────────
// White pawn on d5; Black pawns on c6 and e6 both attack it. White's bishop
// on h3 keeps e6 in view via the h3-c8 diagonal. After 1...exd5, White's
// pawn vanishes AND the bishop sees e6 fall empty — the e-pawn moved, so
// White can name the capturer. Without the bishop, the capture square goes
// to fog and either candidate could have taken.
export const DEDUCE_RECAP_BEFORE: GameState = {
  id: 'deduction-capturer',
  variant: 'dark-chess',
  board: {
    g1: { color: 'white', role: 'king' },
    d5: { color: 'white', role: 'pawn' },
    h3: { color: 'white', role: 'bishop' },
    g8: { color: 'black', role: 'king' },
    c6: { color: 'black', role: 'pawn' },
    e6: { color: 'black', role: 'pawn' },
    c7: { color: 'black', role: 'knight' },
    d7: { color: 'black', role: 'rook' },
  },
  status: { type: 'playing', turn: 'black' },
  moveNumber: 20,
  castlingRights: [],
  halfmoveClock: 0,
};
export const DEDUCE_RECAP_AFTER = darkChessVariant.applyMove(DEDUCE_RECAP_BEFORE, { from: 'e6', to: 'd5' });
export const DEDUCE_RECAP_POSITIONS = [DEDUCE_RECAP_BEFORE, DEDUCE_RECAP_AFTER].map((state) => {
  const arrows = state.lastMove ? [{ orig: state.lastMove.from, dest: state.lastMove.to }] : undefined;
  return {
    boards: [
      { board: state.board, fogSquares: fogFor(state, 'white'), orientation: 'white' as const, label: "WHITE'S VIEW" },
      { board: state.board, orientation: 'white' as const, label: 'SERVER TRUTH', arrows },
      { board: state.board, fogSquares: fogFor(state, 'black'), orientation: 'white' as const, label: "BLACK'S VIEW" },
    ],
  };
});

// Companion to DEDUCE_RECAP_*: same position minus the bishop on h3. Used
// to show the "without a sight line" case — White sees the d5 pawn vanish
// but can't tell which Black pawn took.
export const DEDUCE_RECAP_NB_BEFORE: GameState = {
  id: 'deduction-capturer-no-bishop',
  variant: 'dark-chess',
  board: {
    g1: { color: 'white', role: 'king' },
    d5: { color: 'white', role: 'pawn' },
    g8: { color: 'black', role: 'king' },
    c6: { color: 'black', role: 'pawn' },
    e6: { color: 'black', role: 'pawn' },
    c7: { color: 'black', role: 'knight' },
    d7: { color: 'black', role: 'rook' },
  },
  status: { type: 'playing', turn: 'black' },
  moveNumber: 20,
  castlingRights: [],
  halfmoveClock: 0,
};
export const DEDUCE_RECAP_NB_AFTER = darkChessVariant.applyMove(DEDUCE_RECAP_NB_BEFORE, { from: 'e6', to: 'd5' });
export const DEDUCE_RECAP_NB_POSITIONS = [DEDUCE_RECAP_NB_BEFORE, DEDUCE_RECAP_NB_AFTER].map((state) => {
  const arrows = state.lastMove ? [{ orig: state.lastMove.from, dest: state.lastMove.to }] : undefined;
  return {
    boards: [
      { board: state.board, fogSquares: fogFor(state, 'white'), orientation: 'white' as const, label: "WHITE'S VIEW" },
      { board: state.board, orientation: 'white' as const, label: 'SERVER TRUTH', arrows },
      { board: state.board, fogSquares: fogFor(state, 'black'), orientation: 'white' as const, label: "BLACK'S VIEW" },
    ],
  };
});

// A second capture-deduction pattern: a pawn behind the captured pawn can later
// prove what did not capture. If the black e6-pawn took on d5, d5 would stay
// blocked in front of White's d4 pawn. When the hidden piece leaves and d5
// becomes visible empty, White can rule out the pawn capture and identify the
// mobile knight as the capturer.
export const DEDUCE_BACK_PAWN_START: GameState = {
  id: 'deduction-back-pawn-capturer',
  variant: 'dark-chess',
  board: {
    g1: { color: 'white', role: 'king' },
    d5: { color: 'white', role: 'pawn' },
    d4: { color: 'white', role: 'pawn' },
    g8: { color: 'black', role: 'king' },
    e6: { color: 'black', role: 'pawn' },
    f6: { color: 'black', role: 'knight' },
  },
  status: { type: 'playing', turn: 'black' },
  moveNumber: 24,
  castlingRights: [],
  halfmoveClock: 0,
};
export const DEDUCE_BACK_PAWN_STATES = replayMoves(DEDUCE_BACK_PAWN_START, [
  { from: 'f6', to: 'd5' },
  { from: 'g1', to: 'h1' },
  { from: 'd5', to: 'f4' },
]);
export const DEDUCE_BACK_PAWN_POSITIONS = DEDUCE_BACK_PAWN_STATES.map((state, i) => {
  const arrows = state.lastMove ? [{ orig: state.lastMove.from, dest: state.lastMove.to }] : undefined;
  const highlightSquares = i === DEDUCE_BACK_PAWN_STATES.length - 1 ? ['d5' as Square] : undefined;
  return {
    boards: [
      { board: state.board, fogSquares: fogFor(state, 'white'), orientation: 'white' as const, label: "WHITE'S VIEW", highlightSquares },
      { board: state.board, orientation: 'white' as const, label: 'SERVER TRUTH', arrows },
      { board: state.board, fogSquares: fogFor(state, 'black'), orientation: 'white' as const, label: "BLACK'S VIEW" },
    ],
  };
});

// ── Concepts: one view, many worlds ───────────────────────────────────────
// White's vision (Kg1, two rooks d1/f1, two knights c3/f3, pawns no further
// than rank 4) tops out at rank 5 in the centre (the c3 knight adds b5/a4),
// so the whole of Black's camp on ranks 6-8 is fog.
// Three very different Black armies therefore produce a byte-identical White
// view: the "fan" of worlds consistent with what one player can see. We vary
// only the king's side (kingside / centre / queenside) so the clustering
// visual can collapse the fan into two decision buckets. Verified: all three
// share the same visibleSquares and the same visible pieces (no Black leaks).
export const WORLDS_WHITE: Board = {
  g1: { color: 'white', role: 'king' },
  f1: { color: 'white', role: 'rook' },
  d1: { color: 'white', role: 'rook' },
  f3: { color: 'white', role: 'knight' },
  c3: { color: 'white', role: 'knight' },
  a2: { color: 'white', role: 'pawn' },
  b2: { color: 'white', role: 'pawn' },
  c2: { color: 'white', role: 'pawn' },
  d4: { color: 'white', role: 'pawn' },
  e4: { color: 'white', role: 'pawn' },
  f2: { color: 'white', role: 'pawn' },
  g2: { color: 'white', role: 'pawn' },
  h2: { color: 'white', role: 'pawn' },
};
export function worldState(id: string, black: Board): GameState {
  return {
    id,
    variant: 'dark-chess',
    board: { ...WORLDS_WHITE, ...black },
    status: { type: 'playing', turn: 'white' },
    moveNumber: 18,
    castlingRights: [],
    halfmoveClock: 0,
  };
}
export const WORLD_KINGSIDE = worldState('worlds-kingside', {
  g8: { color: 'black', role: 'king' },
  f8: { color: 'black', role: 'rook' },
  a8: { color: 'black', role: 'rook' },
  c6: { color: 'black', role: 'knight' },
  b6: { color: 'black', role: 'bishop' },
  a7: { color: 'black', role: 'pawn' },
  b7: { color: 'black', role: 'pawn' },
  c7: { color: 'black', role: 'pawn' },
  f7: { color: 'black', role: 'pawn' },
  g7: { color: 'black', role: 'pawn' },
  h7: { color: 'black', role: 'pawn' },
});
export const WORLD_CENTER = worldState('worlds-center', {
  e8: { color: 'black', role: 'king' },
  a8: { color: 'black', role: 'rook' },
  h8: { color: 'black', role: 'rook' },
  f6: { color: 'black', role: 'knight' },
  d6: { color: 'black', role: 'bishop' },
  a7: { color: 'black', role: 'pawn' },
  b7: { color: 'black', role: 'pawn' },
  c7: { color: 'black', role: 'pawn' },
  f7: { color: 'black', role: 'pawn' },
  g7: { color: 'black', role: 'pawn' },
  h7: { color: 'black', role: 'pawn' },
});
export const WORLD_QUEENSIDE = worldState('worlds-queenside', {
  c8: { color: 'black', role: 'king' },
  d8: { color: 'black', role: 'rook' },
  h8: { color: 'black', role: 'rook' },
  f6: { color: 'black', role: 'knight' },
  e6: { color: 'black', role: 'bishop' },
  a7: { color: 'black', role: 'pawn' },
  b7: { color: 'black', role: 'pawn' },
  c7: { color: 'black', role: 'pawn' },
  f7: { color: 'black', role: 'pawn' },
  g7: { color: 'black', role: 'pawn' },
  h7: { color: 'black', role: 'pawn' },
});
// White's view is identical for every world (Black sits entirely in the fog),
// so the "WHAT YOU SEE" board is derived from any one of them.
export const WORLDS_VIEW_FOG = fogFor(WORLD_KINGSIDE, 'white');

// ── Concepts: the move that survives every world (callback to the Bb4 line) ─
// Reuse the 1.d4 e6 2.Nf3 Bb4 position from "Pawn moves". After 2...Bb4 the
// b4-e1 diagonal is open (c3 and d2 are both empty) and it is White to move.
// The greedy/oblivious move (a3, ignoring the threat) loses the king to Bxe1
// if b4 hides a bishop; the patient move (Nb1-c3) blocks the diagonal and is
// safe whether b4 hides a bishop, a knight, or a pawn. Verified: Bxe1 ends the
// game (king-captured); Nc3 leaves the king on e1 with the bishop shut out.
export const SURVIVE_BB4_FINAL = DEDUCE_BB4_STATES[DEDUCE_BB4_STATES.length - 1]!;
export const SURVIVE_GREEDY_STATES = replayMoves(SURVIVE_BB4_FINAL, [
  { from: 'a2', to: 'a3' },
  { from: 'b4', to: 'e1' },
]);
export const SURVIVE_GREEDY_FINAL = SURVIVE_GREEDY_STATES[SURVIVE_GREEDY_STATES.length - 1]!;
export const SURVIVE_PATIENT_STATE = darkChessVariant.applyMove(SURVIVE_BB4_FINAL, { from: 'b1', to: 'c3' });

// Pre-stringified captured WS frame for the server-enforced-fog article.
// The full snapshot artifact is retained for board data and export/debug
// purposes. The article itself shows a smaller steady-state payload sample
// because snapshots intentionally include filtered replay events.
// Compact a pretty-printed JSON string so the wire-payload blocks stay
// verbatim but take far less vertical space: collapse two-field leaf objects
// ({color,role}, {from,to}, {black,white}) onto one line, and fold the long
// square list and move list into a single line each.
export function compactJsonLeaves(json: string): string {
  return json
    .replace(/\{\s*"color": ("[^"]*"),\s*"role": ("[^"]*")\s*\}/g, '{ "color": $1, "role": $2 }')
    .replace(/\{\s*"from": ("[^"]*"),\s*"to": ("[^"]*")\s*\}/g, '{ "from": $1, "to": $2 }')
    .replace(/\{\s*"black": (\d+),\s*"white": (\d+)\s*\}/g, '{ "black": $1, "white": $2 }')
    .replace(/\[\s*(?:"[^"]*",?\s*)+\]/g, (m) => m.replace(/\s+/g, ' ').replace(/\[ /, '[').replace(/ \]/, ']'))
    .replace(/\[\s*(?:\{ "from":[^\n]*\},?\s*)+\]/g, (m) => m.replace(/\s*\n\s*/g, ' '));
}
export const SERVER_FOG_SNAPSHOT_JSON_TEXT = compactJsonLeaves(JSON.stringify(articleSnapshotFog, null, 2));

export const SERVER_FOG_DELTA_PAYLOAD = `{
  "type": "event-appended",
  "roomId": "mb-demo-room-001",
  "seat": "white",
  "seq": 6,
  "state": {
    "board": {
      "a1": { "color": "white", "role": "rook" },
      "e4": { "color": "white", "role": "pawn" },
      "e5": { "color": "black", "role": "pawn" },
      "f7": { "color": "black", "role": "pawn" }
    },
    "visibleSquares": ["a1", "a2", "a3", "..."],
    "legalMoves": [{ "from": "b1", "to": "a3" }, "..."],
    "status": { "type": "playing", "turn": "white" },
    "perspective": "white",
    "clock": { "...": "current clock state" }
  }
}`;

// Board + fog projections for the server-enforced-fog article. Player views
// are sourced from captured snapshots; server truth is the same opening
// replayed through the game kernel.
export type CapturedFrame = { state: { board: Board; visibleSquares: Square[] } };
export const SERVER_FOG_FRAME_W = articleSnapshotFog as unknown as CapturedFrame;
export const SERVER_FOG_FRAME_B = articleSnapshotFogBlack as unknown as CapturedFrame;
export const SERVER_FOG_FOG_W = fogSquaresFromVisible(SERVER_FOG_FRAME_W.state.visibleSquares);
export const SERVER_FOG_FOG_B = fogSquaresFromVisible(SERVER_FOG_FRAME_B.state.visibleSquares);
export const SERVER_FOG_TRUTH_STATE = replayMoves(darkChessVariant.createInitialState('server-fog-model'), [
  { from: 'e2', to: 'e4' },
  { from: 'e7', to: 'e5' },
  { from: 'g1', to: 'f3' },
  { from: 'b8', to: 'c6' },
  { from: 'f1', to: 'c4' },
  { from: 'g8', to: 'f6' },
]).at(-1)!;

// Anatomy of the move-submission wire (client -> server). One small payload;
// the loop closes here.
export const SERVER_FOG_MOVE_PAYLOAD = `// client -> server, sent on player's move
{ type: 'move', from: 'e2', to: 'e4' }`;

export const SERVER_FOG_ACCESS_POLICY = `// live room gate (condensed)
export const seat = verifySeatClaim(socket, room);

if (!seat) {
  closeSocket(1008, 'private room');
  return;
}

send(projectPlayerView(room.gameState, seat));`;

export const SERVER_FOG_REVIEW_POLICY = `GET /room/abc123          active game, seat token required
GET /api/games/abc123/events  active game, 403
GET /game/abc123          finished game, public review
GET /room/abc123          finished game, opens without a seat`;

// The view computation, condensed from packages/game/src/variants.ts for the
// walkthrough. Real names kept; inline conditions named (yourTurn) for reading.
export const SERVER_FOG_VIEW_KERNEL = `// packages/game/src/variants.ts (condensed)

// 1. Which squares can this player see?
export function fogVisibleSquares(state, player) {
  // every square one of your own pieces stands on...
  const visible = new Set(ownPieceSquares(state.board, player));
  // ...plus every square one of your pieces could move to or capture on
  for (const move of getVisibilityMoves(state, player)) visible.add(move.to);
  return [...visible].sort();
}

// 2. Keep only the pieces standing on those squares.
export function boardVisibleTo(board, visibleSquares) {
  const visible = new Set(visibleSquares);
  const playerBoard = {};
  for (const [square, piece] of Object.entries(board))
    if (piece && visible.has(square)) playerBoard[square] = piece;
  return playerBoard;
}

// 3. Assemble the view that gets sent.
getPlayerView(state, player) {
  const visibleSquares = fogVisibleSquares(state, player);
  const board = boardVisibleTo(state.board, visibleSquares);
  return {
    board,            // only the pieces kept by step 2
    visibleSquares,   // step 1: which squares render clear vs. fogged
    legalMoves: yourTurn(state, player) ? getFogMovesForPlayer(state, player) : [],
    status, perspective: player, moveNumber, clock,
    lastMove,         // your own last move; the opponent's is stripped
  };
}`;

// ── Dark Xiangqi article diagrams ─────────────────────────────────────────
// The board-render package is chess-only today, so the Dark Xiangqi draft uses
// small raw SVG diagrams generated from the Xiangqi rules kernel.
export const XQ_CELL = 31;
export const XQ_MARGIN = 18;
export const XQ_BOARD_W = XQ_MARGIN * 2 + 8 * XQ_CELL;
export const XQ_BOARD_H = XQ_MARGIN * 2 + 9 * XQ_CELL;
export const XQ_PIECE_SIZE = tokenPieceSize(XQ_CELL);
export const XQ_FOG_OVERLAP = 0.5;
export const XQ_VIEWBOX_PAD = 4;
export const XQ_BOARD_RADIUS = 8;

export const XQ_START = createInitialXiangqiState('article-xiangqi-start');

// The classic intersection layout: pieces sit on the 31px grid crossings.
const XQ_INTERSECTION_GEO: XiangqiBoardGeometry = {
  fileCount: 9,
  rankCount: 10,
  cell: XQ_CELL,
  margin: XQ_MARGIN,
  riverGap: 0,
};
// The "Square grid" (cell) layout: pieces sit inside squares. A slightly smaller
// cell + river gap fit a full 9x10 grid inside the SAME board box (XQ_BOARD_W x
// XQ_BOARD_H), so every diagram's outer size and multi-board offsets are
// unchanged — only where points/lines land differs. Shares the transform math
// with the live board via xiangqiBoardPoint (single source of truth).
const XQ_CELL_SIZE = 30;
const XQ_CELL_RIVER_GAP = 10;
const XQ_CELL_GEO: XiangqiBoardGeometry = {
  fileCount: 9,
  rankCount: 10,
  cell: XQ_CELL_SIZE,
  margin: XQ_CELL_SIZE / 2,
  riverGap: XQ_CELL_RIVER_GAP,
};
// Center the (smaller) square grid inside the fixed board box.
const XQ_CELL_PAD_X = (XQ_BOARD_W - XQ_CELL_GEO.fileCount * XQ_CELL_SIZE) / 2;
const XQ_CELL_PAD_Y =
  (XQ_BOARD_H - (XQ_CELL_GEO.rankCount * XQ_CELL_SIZE + XQ_CELL_RIVER_GAP)) / 2;
const XQ_CELL_PIECE_SIZE = tokenPieceSize(XQ_CELL_SIZE);

// The layout a diagram render is currently producing. Diagram SVGs come from
// synchronous render thunks; the geometry helpers read this the same way the
// piece layers read activeXiangqiPieceSet. A repaint re-runs the thunk inside
// withXiangqiBoardLayout, so a settings switch (Square grid) flips every diagram.
export let activeXiangqiBoardLayout: XiangqiBoardLayout = 'intersection';

export function withXiangqiBoardLayout(layout: XiangqiBoardLayout, render: () => string): string {
  const previous = activeXiangqiBoardLayout;
  activeXiangqiBoardLayout = layout;
  try {
    return render();
  } finally {
    activeXiangqiBoardLayout = previous;
  }
}

// Piece disc size + fog half-cell for the active layout (the square grid uses a
// slightly smaller cell than the intersection board).
//
// Exported because the Duck Xiangqi figures draw the duck as an overlay above
// the piece layer rather than as a piece, and it has to be sized by exactly this
// number or it drifts from the discs beside it whenever the layout changes.
export function xqPieceSize(): number {
  return activeXiangqiBoardLayout === 'cell' ? XQ_CELL_PIECE_SIZE : XQ_PIECE_SIZE;
}
function xqHalfCell(): number {
  return (activeXiangqiBoardLayout === 'cell' ? XQ_CELL_SIZE : XQ_CELL) / 2;
}

export function xqPoint(
  file: number,
  rank: number,
  perspective: XiangqiColor,
  x0: number,
  y0: number,
): { x: number; y: number } {
  if (activeXiangqiBoardLayout === 'cell') {
    return xiangqiBoardPoint(
      file,
      rank,
      perspective,
      'cell',
      XQ_CELL_GEO,
      x0 + XQ_CELL_PAD_X,
      y0 + XQ_CELL_PAD_Y,
    );
  }
  return xiangqiBoardPoint(file, rank, perspective, 'intersection', XQ_INTERSECTION_GEO, x0, y0);
}

export function xqCoord(square: XiangqiSquare): { file: number; rank: number } {
  return { file: 'abcdefghi'.indexOf(square[0]!), rank: Number(square.slice(1)) };
}

export function xqSvgIdPart(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'x';
}

export function xqVisualRow(rank: number, perspective: XiangqiColor): number {
  return perspective === 'red' ? 10 - rank : rank - 1;
}

// Render context for the xiangqi piece set. The diagram SVGs are produced by
// synchronous render thunks; the piece layers read whichever set is active for
// the current render. A diagram block re-runs its thunk inside
// `withXiangqiPieceSet` to switch sets (the appearance picker), the same way
// chess diagrams restyle via CSS sprites. Safe because rendering is synchronous
// and single-threaded (build prerender and browser both); the previous set is
// always restored.
export let activeXiangqiPieceSet: XiangqiPieceSet = DEFAULT_XIANGQI_PIECE_SET;

export function withXiangqiPieceSet(set: XiangqiPieceSet, render: () => string): string {
  const previous = activeXiangqiPieceSet;
  activeXiangqiPieceSet = set;
  try {
    return render();
  } finally {
    activeXiangqiPieceSet = previous;
  }
}

export function xqBoardGrid(x0: number, y0: number, perspective: XiangqiColor): string {
  return activeXiangqiBoardLayout === 'cell'
    ? xqCellBoardGrid(x0, y0, perspective)
    : xqIntersectionBoardGrid(x0, y0, perspective);
}

// Palace diagonals (the general's-palace cue) + the mid-river label. Shared by
// both layouts; every endpoint comes from xqPoint, so it lands correctly whether
// pieces sit on intersections or in cells.
function xqPalaceAndRiver(x0: number, y0: number, perspective: XiangqiColor): string {
  const parts: string[] = [];
  for (const palace of [
    { fileMin: 3, fileMax: 5, rankBack: 1 },
    { fileMin: 3, fileMax: 5, rankBack: 8 },
  ]) {
    const topRank = palace.rankBack === 1 ? 3 : 10;
    const bottomRank = palace.rankBack;
    const a = xqPoint(palace.fileMin, topRank, perspective, x0, y0);
    const b = xqPoint(palace.fileMax, bottomRank, perspective, x0, y0);
    const c = xqPoint(palace.fileMax, topRank, perspective, x0, y0);
    const d = xqPoint(palace.fileMin, bottomRank, perspective, x0, y0);
    parts.push(`<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" class="xq-diagram-line" stroke-width="1"/>`);
    parts.push(`<line x1="${c.x}" y1="${c.y}" x2="${d.x}" y2="${d.y}" class="xq-diagram-line" stroke-width="1"/>`);
  }
  // River band sits between ranks 5 and 6 (file 4 is the horizontal center).
  const riverY = (xqPoint(0, 5, perspective, x0, y0).y + xqPoint(0, 6, perspective, x0, y0).y) / 2;
  const riverX = xqPoint(4, 1, perspective, x0, y0).x;
  parts.push(
    `<text x="${riverX}" y="${riverY + 1}" font-family="serif" font-size="16" class="xq-diagram-ink xq-diagram-river-label" text-anchor="middle" dominant-baseline="central">楚 河   漢 界</text>`,
  );
  return parts.join('');
}

// Square-grid layout: pieces sit inside cells, so the grid is drawn as one square
// per point instead of crossing lines. The board box is unchanged.
function xqCellBoardGrid(x0: number, y0: number, perspective: XiangqiColor): string {
  const half = XQ_CELL_SIZE / 2;
  const parts: string[] = [
    `<rect x="${x0}" y="${y0}" width="${XQ_BOARD_W}" height="${XQ_BOARD_H}" rx="${XQ_BOARD_RADIUS}" class="xq-diagram-bg"/>`,
  ];
  for (let file = 0; file < 9; file += 1) {
    for (let rank = 1; rank <= 10; rank += 1) {
      const { x, y } = xqPoint(file, rank, perspective, x0, y0);
      parts.push(
        `<rect x="${x - half}" y="${y - half}" width="${XQ_CELL_SIZE}" height="${XQ_CELL_SIZE}" class="xq-diagram-line" fill="none" stroke-width="1"/>`,
      );
    }
  }
  parts.push(xqPalaceAndRiver(x0, y0, perspective));
  return parts.join('');
}

function xqIntersectionBoardGrid(x0: number, y0: number, perspective: XiangqiColor): string {
  const parts: string[] = [
    `<rect x="${x0}" y="${y0}" width="${XQ_BOARD_W}" height="${XQ_BOARD_H}" rx="${XQ_BOARD_RADIUS}" class="xq-diagram-bg"/>`,
  ];
  const left = x0 + XQ_MARGIN;
  const right = left + 8 * XQ_CELL;
  const top = y0 + XQ_MARGIN;
  const bottom = top + 9 * XQ_CELL;
  const riverTop = top + 4 * XQ_CELL;
  const riverBottom = top + 5 * XQ_CELL;
  for (let r = 0; r < 10; r += 1) {
    const y = top + r * XQ_CELL;
    parts.push(`<line x1="${left}" y1="${y}" x2="${right}" y2="${y}" class="xq-diagram-line" stroke-width="1"/>`);
  }
  for (let f = 0; f < 9; f += 1) {
    const x = left + f * XQ_CELL;
    if (f === 0 || f === 8) {
      parts.push(`<line x1="${x}" y1="${top}" x2="${x}" y2="${bottom}" class="xq-diagram-line" stroke-width="1"/>`);
    } else {
      parts.push(`<line x1="${x}" y1="${top}" x2="${x}" y2="${riverTop}" class="xq-diagram-line" stroke-width="1"/>`);
      parts.push(`<line x1="${x}" y1="${riverBottom}" x2="${x}" y2="${bottom}" class="xq-diagram-line" stroke-width="1"/>`);
    }
  }
  parts.push(xqPalaceAndRiver(x0, y0, perspective));
  return parts.join('');
}

export function xqFogLayer(
  view: XiangqiPlayerView | null,
  x0: number,
  y0: number,
  perspective: XiangqiColor,
  clipId: string,
): string {
  if (!view) return '';
  const visible = new Set(view.visibleSquares);
  const parts: string[] = [];
  for (let file = 0; file < 9; file += 1) {
    for (let rank = 1; rank <= 10; rank += 1) {
      const sq = xiangqiSquareOf(file, rank);
      if (visible.has(sq)) continue;
      const { x, y } = xqPoint(file, rank, perspective, x0, y0);
      const visualRow = xqVisualRow(rank, perspective);
      const half = xqHalfCell();
      // Outer edges clamp to the board box (fog is clipped to it either way); the
      // interior half-cell tracks the active layout's cell size.
      const left = file === 0 ? x0 : x - half - XQ_FOG_OVERLAP;
      const right = file === 8 ? x0 + XQ_BOARD_W : x + half + XQ_FOG_OVERLAP;
      const top = visualRow === 0 ? y0 : y - half - XQ_FOG_OVERLAP;
      const bottom = visualRow === 9 ? y0 + XQ_BOARD_H : y + half + XQ_FOG_OVERLAP;
      parts.push(`M ${left} ${top} H ${right} V ${bottom} H ${left} Z`);
    }
  }
  if (parts.length === 0) return '';
  return [
    `<defs><clipPath id="${clipId}"><rect x="${x0}" y="${y0}" width="${XQ_BOARD_W}" height="${XQ_BOARD_H}" rx="${XQ_BOARD_RADIUS}"/></clipPath></defs>`,
    `<path d="${parts.join(' ')}" class="xq-diagram-fog" clip-path="url(#${clipId})"/>`,
  ].join('');
}

// Movement-diagram destination markers, following the standard board-UI
// vocabulary:
//   - filled green dot  = a legal move to an empty point
//   - green ring        = a legal capture (drawn around the enemy piece)
//   - red X             = a point the piece would reach on an open board but
//                         cannot, because something blocks the path (a horse's
//                         leg, an elephant's eye, the river)
// Green matches the existing arrow colour so diagrams read consistently with
// the live UI. The capture ring sits just outside the piece disc (radius ~13),
// so it stays visible even though markers render beneath the pieces.
export function xqMoveDots(
  dots: Array<{ square: XiangqiSquare; blocked?: boolean; capture?: boolean }> | undefined,
  x0: number,
  y0: number,
  perspective: XiangqiColor,
): string {
  if (!dots || dots.length === 0) return '';
  return dots
    .map(({ square, blocked, capture }) => {
      const { file, rank } = xqCoord(square);
      const { x, y } = xqPoint(file, rank, perspective, x0, y0);
      if (blocked) {
        const r = 7;
        return [
          `<line x1="${x - r}" y1="${y - r}" x2="${x + r}" y2="${y + r}" stroke="#d4351c" stroke-width="2.75" stroke-linecap="round"/>`,
          `<line x1="${x - r}" y1="${y + r}" x2="${x + r}" y2="${y - r}" stroke="#d4351c" stroke-width="2.75" stroke-linecap="round"/>`,
        ].join('');
      }
      if (capture) {
        return `<circle cx="${x}" cy="${y}" r="16" fill="none" stroke="#15781B" stroke-width="2.5"/>`;
      }
      return `<circle cx="${x}" cy="${y}" r="6.5" fill="#15781B" opacity="0.85"/>`;
    })
    .join('');
}

export function xqPiecesLayer(
  state: XiangqiGameState,
  view: XiangqiPlayerView | null,
  x0: number,
  y0: number,
  perspective: XiangqiColor,
  shroudedStyle?: XiangqiShroudedStyle,
): string {
  const entries = view
    ? Object.entries(view.board).map(([sq, entry]) => [sq, entry?.piece, entry?.shrouded] as const)
    : Object.entries(state.board).map(([sq, piece]) => [sq, piece, false] as const);
  return entries
    .map(([sq, piece, shrouded]) => {
      if (!piece) return '';
      const { file, rank } = xqCoord(sq as XiangqiSquare);
      const { x, y } = xqPoint(file, rank, perspective, x0, y0);
      const size = xqPieceSize();
      return renderXiangqiPieceGlyphed(piece as XiangqiPiece, activeXiangqiPieceSet, {
        x: x - size / 2,
        y: y - size / 2,
        size,
        shrouded,
        shroudedStyle,
        crossed: !shrouded && drawsCrossedSoldier(piece as XiangqiPiece, rank),
      });
    })
    .join('');
}

export function xqArrowLayer(
  arrows: Array<{ from: XiangqiSquare; to: XiangqiSquare }> | undefined,
  x0: number,
  y0: number,
  perspective: XiangqiColor,
): string {
  if (!arrows || arrows.length === 0) return '';
  return arrows
    .map(({ from, to }, index) => {
      const fromCoord = xqCoord(from);
      const toCoord = xqCoord(to);
      const start = xqPoint(fromCoord.file, fromCoord.rank, perspective, x0, y0);
      const rawEnd = xqPoint(toCoord.file, toCoord.rank, perspective, x0, y0);
      const dx = rawEnd.x - start.x;
      const dy = rawEnd.y - start.y;
      const length = Math.hypot(dx, dy) || 1;
      const end = {
        x: rawEnd.x - (dx / length) * 10,
        y: rawEnd.y - (dy / length) * 10,
      };
      const id = `xq-arrow-${from}-${to}-${index}`;
      return [
        `<defs><marker id="${id}" markerWidth="4" markerHeight="4" refX="2.05" refY="2" orient="auto" overflow="visible" markerUnits="strokeWidth"><path d="M0,0 V4 L3,2 Z" fill="#15781B"/></marker></defs>`,
        `<line x1="${start.x}" y1="${start.y}" x2="${end.x}" y2="${end.y}" stroke="#15781B" stroke-width="5.25" stroke-linecap="round" opacity="0.38" marker-end="url(#${id})"/>`,
      ].join('');
    })
    .join('');
}

// Translucent callouts for the board's two structural zones: the two palaces
// (the 3x3 boxes the general and advisors never leave) and the river band.
// Used by the board-anatomy diagram so the prose's palace/river have a visual.
export function xqZoneHighlights(x0: number, y0: number, perspective: XiangqiColor): string {
  const parts: string[] = [];
  const pad = 6;
  for (const [rLo, rHi] of [[1, 3], [8, 10]] as const) {
    const lo = xqPoint(3, rLo, perspective, x0, y0);
    const hi = xqPoint(5, rHi, perspective, x0, y0);
    const x = Math.min(lo.x, hi.x) - pad;
    const y = Math.min(lo.y, hi.y) - pad;
    const w = Math.abs(hi.x - lo.x) + pad * 2;
    const h = Math.abs(hi.y - lo.y) + pad * 2;
    parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#2563eb" opacity="0.13" rx="5"/>`);
  }
  const half = xqHalfCell();
  const left = xqPoint(0, 5, perspective, x0, y0).x - half;
  const right = xqPoint(8, 5, perspective, x0, y0).x + half;
  const ya = xqPoint(0, 5, perspective, x0, y0).y;
  const yb = xqPoint(0, 6, perspective, x0, y0).y;
  parts.push(
    `<rect x="${left}" y="${Math.min(ya, yb)}" width="${right - left}" height="${Math.abs(yb - ya)}" fill="#2563eb" opacity="0.09"/>`,
  );
  return parts.join('');
}

export function xqBoardSvg(opts: {
  state: XiangqiGameState;
  view?: XiangqiPlayerView;
  x: number;
  y: number;
  label: string;
  perspective?: XiangqiColor;
  arrows?: Array<{ from: XiangqiSquare; to: XiangqiSquare }>;
  dots?: Array<{ square: XiangqiSquare; blocked?: boolean; capture?: boolean }>;
  zones?: boolean;
  shroudedStyle?: XiangqiShroudedStyle;
  // Raw SVG drawn on top of the pieces (a confrontation line, etc.). The
  // caller positions it with xqPoint using the same x and boardY (y + 28).
  overlay?: string;
}): string {
  const perspective = opts.perspective ?? opts.view?.perspective ?? 'red';
  const view = opts.view ?? null;
  const boardY = opts.y + 28;
  const clipId = `xq-fog-${xqSvgIdPart(opts.state.id)}-${xqSvgIdPart(opts.label)}-${Math.round(opts.x)}-${Math.round(boardY)}-${perspective}`;
  return [
    `<text x="${opts.x + XQ_BOARD_W / 2}" y="${opts.y + 14}" font-family="system-ui, sans-serif" font-size="13" font-weight="700" class="xq-diagram-title" text-anchor="middle">${opts.label}</text>`,
    xqBoardGrid(opts.x, boardY, perspective),
    opts.zones ? xqZoneHighlights(opts.x, boardY, perspective) : '',
    xqFogLayer(view, opts.x, boardY, perspective, clipId),
    xqMoveDots(opts.dots, opts.x, boardY, perspective),
    xqPiecesLayer(opts.state, view, opts.x, boardY, perspective, opts.shroudedStyle),
    xqArrowLayer(opts.arrows, opts.x, boardY, perspective),
    opts.overlay ?? '',
  ].join('');
}

export function xqSvg(width: number, height: number, body: string, extraClass = ''): string {
  const paddedWidth = width + XQ_VIEWBOX_PAD * 2;
  const paddedHeight = height + XQ_VIEWBOX_PAD * 2;
  const layout = width <= XQ_BOARD_W ? 'single' : width <= XQ_BOARD_W * 2 + 28 ? 'pair' : 'wide';
  const cls = extraClass ? `xq-article-svg ${extraClass}` : 'xq-article-svg';
  return `<svg class="${cls}" data-xq-layout="${layout}" style="--xq-svg-width: ${paddedWidth}px" viewBox="0 0 ${paddedWidth} ${paddedHeight}" role="img" xmlns="http://www.w3.org/2000/svg"><g transform="translate(${XQ_VIEWBOX_PAD} ${XQ_VIEWBOX_PAD})">${body}</g></svg>`;
}

export const XQ_ALL_SQUARES: XiangqiSquare[] = Array.from({ length: 9 * 10 }, (_, i) =>
  xiangqiSquareOf(i % 9, Math.floor(i / 9) + 1),
);

export function xqStaticView(
  id: string,
  board: XiangqiPlayerView['board'],
  perspective: XiangqiColor = 'red',
): XiangqiPlayerView {
  return {
    id,
    perspective,
    board,
    visibleSquares: XQ_ALL_SQUARES,
    legalMoves: [],
    status: { type: 'playing', turn: perspective },
    moveNumber: 1,
  };
}

// ── Mini Xiangqi rules diagrams ────────────────────────────────────────────
// A self-contained 7x7 board SVG, reusing the Xiangqi rules-diagram scale
// (XQ_CELL / XQ_MARGIN / XQ_PIECE_SIZE) and marker vocabulary so the Mini
// Xiangqi page reads as a sibling of the full Xiangqi page. There is no river;
// each palace is a 3x3 box spanning ranks 1-3 (Red) and 5-7 (Black). Boards are
// drawn from Red's perspective with rank 1 at the bottom.
export const MXQ_FILES = 7;
export const MXQ_RANKS = 7;
export const MXQ_BOARD_W = XQ_MARGIN * 2 + (MXQ_FILES - 1) * XQ_CELL;
export const MXQ_BOARD_H = XQ_MARGIN * 2 + (MXQ_RANKS - 1) * XQ_CELL;

export function mxqPoint(file: number, rank: number): { x: number; y: number } {
  return {
    x: XQ_MARGIN + file * XQ_CELL,
    y: XQ_MARGIN + (MXQ_RANKS - rank) * XQ_CELL,
  };
}

function mxqPalaceBandLayer(): string {
  return ([[1, 3], [5, 7]] as const)
    .map(([loRank, hiRank]) => {
      const a = mxqPoint(2, hiRank);
      const b = mxqPoint(4, loRank);
      return `<rect x="${Math.min(a.x, b.x)}" y="${Math.min(a.y, b.y)}" width="${Math.abs(b.x - a.x)}" height="${Math.abs(b.y - a.y)}" class="xq-diagram-palace-band"/>`;
    })
    .join('');
}

export function mxqGridLayer(): string {
  const parts: string[] = [
    `<rect x="0" y="0" width="${MXQ_BOARD_W}" height="${MXQ_BOARD_H}" rx="${XQ_BOARD_RADIUS}" class="xq-diagram-bg"/>`,
    mxqPalaceBandLayer(),
  ];
  const left = XQ_MARGIN;
  const right = XQ_MARGIN + (MXQ_FILES - 1) * XQ_CELL;
  const top = XQ_MARGIN;
  const bottom = XQ_MARGIN + (MXQ_RANKS - 1) * XQ_CELL;
  for (let r = 0; r < MXQ_RANKS; r += 1) {
    const y = top + r * XQ_CELL;
    parts.push(`<line x1="${left}" y1="${y}" x2="${right}" y2="${y}" class="xq-diagram-line" stroke-width="1"/>`);
  }
  for (let f = 0; f < MXQ_FILES; f += 1) {
    const x = left + f * XQ_CELL;
    parts.push(`<line x1="${x}" y1="${top}" x2="${x}" y2="${bottom}" class="xq-diagram-line" stroke-width="1"/>`);
  }
  // Palace diagonals: files c-e (indices 2-4), ranks 1-3 (Red) and 5-7 (Black).
  for (const [loRank, hiRank] of [[1, 3], [5, 7]] as const) {
    const a = mxqPoint(2, hiRank);
    const b = mxqPoint(4, loRank);
    const c = mxqPoint(4, hiRank);
    const d = mxqPoint(2, loRank);
    parts.push(`<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" class="xq-diagram-line" stroke-width="1"/>`);
    parts.push(`<line x1="${c.x}" y1="${c.y}" x2="${d.x}" y2="${d.y}" class="xq-diagram-line" stroke-width="1"/>`);
  }
  return parts.join('');
}

export function mxqMarkerLayer(dots: MiniXiangqiSquare[], captures: MiniXiangqiSquare[]): string {
  const parts: string[] = [];
  for (const sq of captures) {
    const { file, rank } = miniXiangqiCoordOf(sq);
    const { x, y } = mxqPoint(file, rank);
    parts.push(`<circle cx="${x}" cy="${y}" r="16" fill="none" stroke="#15781B" stroke-width="2.5"/>`);
  }
  for (const sq of dots) {
    const { file, rank } = miniXiangqiCoordOf(sq);
    const { x, y } = mxqPoint(file, rank);
    parts.push(`<circle cx="${x}" cy="${y}" r="6.5" fill="#15781B" opacity="0.85"/>`);
  }
  return parts.join('');
}

export function mxqPiecesLayer(board: MiniXiangqiBoard): string {
  return Object.entries(board)
    .map(([sq, piece]) => {
      if (!piece) return '';
      const { file, rank } = miniXiangqiCoordOf(sq as MiniXiangqiSquare);
      const { x, y } = mxqPoint(file, rank);
      return renderXiangqiPieceGlyphed(piece as XiangqiPiece, activeXiangqiPieceSet, {
        x: x - XQ_PIECE_SIZE / 2,
        y: y - XQ_PIECE_SIZE / 2,
        size: XQ_PIECE_SIZE,
        // No river on the 7x7 board, so every soldier has the sideways step from
        // move one and draws promoted.
        crossed: drawsVeteranSoldier(piece),
      });
    })
    .join('');
}

export function miniXqBoardSvg(opts: {
  board: MiniXiangqiBoard;
  dots?: MiniXiangqiSquare[];
  captures?: MiniXiangqiSquare[];
}): string {
  const w = MXQ_BOARD_W + XQ_VIEWBOX_PAD * 2;
  const h = MXQ_BOARD_H + XQ_VIEWBOX_PAD * 2;
  const body = [
    mxqGridLayer(),
    mxqMarkerLayer(opts.dots ?? [], opts.captures ?? []),
    mxqPiecesLayer(opts.board),
  ].join('');
  return `<svg class="xq-article-svg" data-xq-layout="single" style="--xq-svg-width: ${w}px" viewBox="0 0 ${w} ${h}" role="img" xmlns="http://www.w3.org/2000/svg" aria-label="Mini Xiangqi board"><g transform="translate(${XQ_VIEWBOX_PAD} ${XQ_VIEWBOX_PAD})">${body}</g></svg>`;
}

// Clean fog-free starting position, used as both the page board and card image.
export const MINI_XIANGQI_START_BOARD = () => miniXqBoardSvg({ board: createInitialMiniXiangqiBoard() });

// Soldier movement: a Red soldier in the open moves and captures one point
// forward or sideways (never backward) from the very first move, because Mini
// Xiangqi has no river. Dots are quiet moves; the ring is a sideways capture.
export const MINI_XIANGQI_SOLDIER_BOARD: MiniXiangqiBoard = {
  d4: { color: 'red', role: 'soldier' },
  c4: { color: 'black', role: 'soldier' },
};
export const MINI_XIANGQI_SOLDIER_DIAGRAM = () => miniXqBoardSvg({
  board: MINI_XIANGQI_SOLDIER_BOARD,
  dots: ['d5', 'e4'],
  captures: ['c4'],
});

// Fog overlay for the Dark Mini Xiangqi boards: a dark path over every point
// the player cannot see, clipped to the rounded board, the same inverse-fog
// look the full Dark Xiangqi diagrams use.
export const MXQ_FOG_OVERLAP = 0.5;

export function mxqFogLayer(view: MiniXiangqiPlayerView, clipId: string): string {
  const visible = new Set(view.visibleSquares);
  const parts: string[] = [];
  for (let file = 0; file < MXQ_FILES; file += 1) {
    for (let rank = 1; rank <= MXQ_RANKS; rank += 1) {
      const sq = miniXiangqiSquareOf(file, rank);
      if (visible.has(sq)) continue;
      const { x, y } = mxqPoint(file, rank);
      const row = MXQ_RANKS - rank;
      const left = file === 0 ? 0 : x - XQ_CELL / 2 - MXQ_FOG_OVERLAP;
      const right = file === MXQ_FILES - 1 ? MXQ_BOARD_W : x + XQ_CELL / 2 + MXQ_FOG_OVERLAP;
      const top = row === 0 ? 0 : y - XQ_CELL / 2 - MXQ_FOG_OVERLAP;
      const bottom = row === MXQ_RANKS - 1 ? MXQ_BOARD_H : y + XQ_CELL / 2 + MXQ_FOG_OVERLAP;
      parts.push(`M ${left} ${top} H ${right} V ${bottom} H ${left} Z`);
    }
  }
  if (parts.length === 0) return '';
  return [
    `<defs><clipPath id="${clipId}"><rect x="0" y="0" width="${MXQ_BOARD_W}" height="${MXQ_BOARD_H}" rx="${XQ_BOARD_RADIUS}"/></clipPath></defs>`,
    `<path d="${parts.join(' ')}" class="xq-diagram-fog" clip-path="url(#${clipId})"/>`,
  ].join('');
}

// Pieces as the viewer sees them: own and visible pieces by glyph, shrouded
// blockers as a neutral ? marker in the owner's color.
export function mxqViewPiecesLayer(view: MiniXiangqiPlayerView): string {
  return Object.entries(view.board)
    .map(([sq, entry]) => {
      if (!entry) return '';
      const { file, rank } = miniXiangqiCoordOf(sq as MiniXiangqiSquare);
      const { x, y } = mxqPoint(file, rank);
      const piece = (
        entry.shrouded ? { color: entry.color, role: 'soldier' } : entry.piece
      ) as XiangqiPiece;
      return renderXiangqiPieceGlyphed(piece, activeXiangqiPieceSet, {
        x: x - XQ_PIECE_SIZE / 2,
        y: y - XQ_PIECE_SIZE / 2,
        size: XQ_PIECE_SIZE,
        shrouded: entry.shrouded,
        // Same promoted art as the full-information layer, but never on a
        // shrouded blocker: that soldier is a placeholder for an unseen piece,
        // and promoting it would assert a role the viewer has not been shown.
        crossed: !entry.shrouded && drawsVeteranSoldier(piece),
      });
    })
    .join('');
}

export function miniXqFogBoardSvg(view: MiniXiangqiPlayerView, clipId: string): string {
  const w = MXQ_BOARD_W + XQ_VIEWBOX_PAD * 2;
  const h = MXQ_BOARD_H + XQ_VIEWBOX_PAD * 2;
  const body = [
    mxqGridLayer(),
    mxqFogLayer(view, clipId),
    mxqViewPiecesLayer(view),
  ].join('');
  return `<svg class="xq-article-svg" data-xq-layout="single" style="--xq-svg-width: ${w}px" viewBox="0 0 ${w} ${h}" role="img" xmlns="http://www.w3.org/2000/svg" aria-label="Dark Mini Xiangqi board"><g transform="translate(${XQ_VIEWBOX_PAD} ${XQ_VIEWBOX_PAD})">${body}</g></svg>`;
}

// One labeled board in a comparison pair: the fogged player view when a view is
// given, otherwise the full server-truth board.
export function mxqBoardCell(opts: {
  x: number;
  label: string;
  state: MiniXiangqiGameState;
  view?: MiniXiangqiPlayerView;
  fogClipId?: string;
}): string {
  const layers: string[] = [mxqGridLayer()];
  if (opts.view && opts.fogClipId) {
    layers.push(mxqFogLayer(opts.view, opts.fogClipId));
    layers.push(mxqViewPiecesLayer(opts.view));
  } else {
    layers.push(mxqPiecesLayer(opts.state.board));
  }
  return `<g transform="translate(${opts.x} 0)"><text x="${MXQ_BOARD_W / 2}" y="11" font-family="system-ui, sans-serif" font-size="11" font-weight="700" class="xq-diagram-title" text-anchor="middle">${opts.label}</text><g transform="translate(0 20)">${layers.join('')}</g></g>`;
}

export const MXQ_BOARD_GAP = 22;

// A horizontal row of labeled boards: two for a view/truth pair, three for a
// red-view / server-truth / black-view triptych.
export function mxqBoardRowSvg(
  state: MiniXiangqiGameState,
  cells: Array<{ label: string; view?: MiniXiangqiPlayerView; fogClipId?: string }>,
): string {
  const n = cells.length;
  const totalW = MXQ_BOARD_W * n + MXQ_BOARD_GAP * (n - 1) + XQ_VIEWBOX_PAD * 2;
  const totalH = MXQ_BOARD_H + 20 + XQ_VIEWBOX_PAD * 2;
  const body = cells
    .map((cell, i) =>
      mxqBoardCell({
        x: i * (MXQ_BOARD_W + MXQ_BOARD_GAP),
        label: cell.label,
        state,
        view: cell.view,
        fogClipId: cell.fogClipId,
      }),
    )
    .join('');
  return `<svg class="xq-article-svg" data-xq-layout="${n >= 3 ? 'wide' : 'pair'}" style="--xq-svg-width: ${totalW}px" viewBox="0 0 ${totalW} ${totalH}" role="img" xmlns="http://www.w3.org/2000/svg"><g transform="translate(${XQ_VIEWBOX_PAD} ${XQ_VIEWBOX_PAD})">${body}</g></svg>`;
}

export function miniXqPairSvg(
  state: MiniXiangqiGameState,
  view: MiniXiangqiPlayerView,
  fogClipId: string,
): string {
  return mxqBoardRowSvg(state, [
    { label: "RED'S VIEW", view, fogClipId },
    { label: 'SERVER TRUTH' },
  ]);
}

// The opening position under fog. The card thumbnail shows Red's view; the page
// shows all three angles side by side (Red's view, the true board, Black's view).
export const MINI_XIANGQI_DARK_STATE = createInitialMiniXiangqiState('dark-mini-xiangqi-diagram');
export const MINI_XIANGQI_DARK_THUMBNAIL = () => miniXqFogBoardSvg(
  getMiniXiangqiPlayerView(MINI_XIANGQI_DARK_STATE, 'red'),
  'mxq-fog-thumb',
);
export const MINI_XIANGQI_DARK_TRIPTYCH = () => mxqBoardRowSvg(MINI_XIANGQI_DARK_STATE, [
  {
    label: "RED'S VIEW",
    view: getMiniXiangqiPlayerView(MINI_XIANGQI_DARK_STATE, 'red'),
    fogClipId: 'mxq-fog-tri-r',
  },
  { label: 'SERVER TRUTH' },
  {
    label: "BLACK'S VIEW",
    view: getMiniXiangqiPlayerView(MINI_XIANGQI_DARK_STATE, 'black'),
    fogClipId: 'mxq-fog-tri-b',
  },
]);

export function mxqDemoState(id: string, board: MiniXiangqiBoard): MiniXiangqiGameState {
  return {
    id,
    board,
    status: { type: 'playing', turn: 'red' },
    moveNumber: 8,
    progressClock: 0,
    positionCounts: {},
  };
}

// Cannon rule under fog: a Red cannon on d3 fires up the d-file. The screen on
// d5 is shrouded, the empty gap (d6) stays fogged, and the target on d7 (the
// Black general) is revealed with a capture bracket. A Black horse sits
// off-file on f3.
export const MINI_XIANGQI_CANNON_STATE = mxqDemoState('dmxq-cannon-rule', {
  d3: { color: 'red', role: 'cannon' },
  d5: { color: 'black', role: 'soldier' },
  d7: { color: 'black', role: 'general' },
  f3: { color: 'black', role: 'horse' },
});
export const MINI_XIANGQI_CANNON_PAIR = () => miniXqPairSvg(
  MINI_XIANGQI_CANNON_STATE,
  getMiniXiangqiPlayerView(MINI_XIANGQI_CANNON_STATE, 'red'),
  'mxq-fog-cannon',
);

// Horse leg under fog: a Red horse on d3 with the up-leg on d4 blocked. The leg
// point is a shrouded marker and the destinations behind it (c5, e5) stay hidden.
export const MINI_XIANGQI_HORSE_STATE = mxqDemoState('dmxq-horse-leg', {
  d3: { color: 'red', role: 'horse' },
  d4: { color: 'black', role: 'soldier' },
});
export const MINI_XIANGQI_HORSE_PAIR = () => miniXqPairSvg(
  MINI_XIANGQI_HORSE_STATE,
  getMiniXiangqiPlayerView(MINI_XIANGQI_HORSE_STATE, 'red'),
  'mxq-fog-horse',
);

export function xqViewWithExtraVisibleSquares(
  view: XiangqiPlayerView,
  squares: XiangqiSquare[],
): XiangqiPlayerView {
  return {
    ...view,
    visibleSquares: [...new Set([...view.visibleSquares, ...squares])].sort(),
  };
}

export const XQ_START_RED = getXiangqiPlayerView(XQ_START, 'red', 'D');
export const XQ_START_BLACK = getXiangqiPlayerView(XQ_START, 'black', 'D');
export const XQ_START_TRIPTYCH = () => xqSvg(
  XQ_BOARD_W * 3 + 56,
  XQ_BOARD_H + 52,
  [
    xqBoardSvg({ state: XQ_START, view: XQ_START_RED, x: 0, y: 0, label: "RED'S VIEW", perspective: 'red' }),
    xqBoardSvg({ state: XQ_START, x: XQ_BOARD_W + 28, y: 0, label: 'SERVER TRUTH', perspective: 'red' }),
    xqBoardSvg({
      state: XQ_START,
      view: XQ_START_BLACK,
      x: (XQ_BOARD_W + 28) * 2,
      y: 0,
      label: "BLACK'S VIEW",
      perspective: 'red',
    }),
  ].join(''),
);
export const XQ_RULES_PRIMER_START_BOARD = () => xqSvg(
  XQ_BOARD_W,
  XQ_BOARD_H + 52,
  xqBoardSvg({ state: XQ_START, x: 0, y: 0, label: 'STARTING POSITION', perspective: 'red' }),
  'xq-article-svg--hero',
);
export const XQ_RULES_PRIMER_THUMBNAIL = () => xqSvg(
  XQ_BOARD_W,
  XQ_BOARD_H,
  [xqBoardGrid(0, 0, 'red'), xqPiecesLayer(XQ_START, null, 0, 0, 'red')].join(''),
);

export function xqVisionDemoState(id: string, board: Partial<Record<XiangqiSquare, XiangqiPiece>>): XiangqiGameState {
  return {
    id,
    board,
    status: { type: 'playing', turn: 'black' },
    moveNumber: 12,
    progressClock: 0,
    positionCounts: {},
  };
}

// Open-information movement diagram for the Horse (rules primer). Left board:
// a horse on a clear central point reaches all eight L-shaped destinations.
// Right board: a single blocker on the point directly ahead (the "leg") kills
// the two destinations that step through it, shown as red X marks.
export function xqDots(squares: string[]): Array<{ square: XiangqiSquare; blocked?: boolean }> {
  return squares.map((s) => ({ square: s as XiangqiSquare }));
}
export const XQ_PRIMER_HORSE_OPEN = xqVisionDemoState('xq-primer-horse-open', {
  e5: { color: 'red', role: 'horse' },
});
export const XQ_PRIMER_HORSE_BLOCKED = xqVisionDemoState('xq-primer-horse-blocked', {
  e5: { color: 'red', role: 'horse' },
  e6: { color: 'black', role: 'soldier' },
  g5: { color: 'red', role: 'soldier' },
});
export const XQ_PRIMER_HORSE_PAIR = () => xqSvg(
  XQ_BOARD_W * 2 + 28,
  XQ_BOARD_H + 52,
  [
    xqBoardSvg({
      state: XQ_PRIMER_HORSE_OPEN,
      x: 0,
      y: 0,
      label: 'UNOBSTRUCTED',
      perspective: 'red',
      dots: xqDots(['c4', 'c6', 'd3', 'd7', 'f3', 'f7', 'g4', 'g6']),
    }),
    xqBoardSvg({
      state: XQ_PRIMER_HORSE_BLOCKED,
      x: XQ_BOARD_W + 28,
      y: 0,
      label: 'LEG BLOCKED',
      perspective: 'red',
      dots: [
        ...xqDots(['c4', 'c6', 'd3', 'f3', 'g4', 'g6']),
        { square: 'd7' as XiangqiSquare, blocked: true },
        { square: 'f7' as XiangqiSquare, blocked: true },
      ],
    }),
  ].join(''),
);

// General: one orthogonal step, confined to the palace.
export const XQ_PRIMER_GENERAL = xqVisionDemoState('xq-primer-general', {
  e2: { color: 'red', role: 'general' },
});
export const XQ_PRIMER_GENERAL_BOARD = () => xqSvg(
  XQ_BOARD_W,
  XQ_BOARD_H + 52,
  xqBoardSvg({
    state: XQ_PRIMER_GENERAL,
    x: 0,
    y: 0,
    label: 'GENERAL',
    perspective: 'red',
    dots: xqDots(['d2', 'f2', 'e1', 'e3']),
  }),
);

// The flying-general rule: two generals may not sit on the same open file with
// nothing between them. Left board is the forbidden facing (dashed red axis);
// right board is legal because a piece screens the file.
export const XQ_PRIMER_FACING_ILLEGAL = xqVisionDemoState('xq-primer-facing-illegal', {
  e1: { color: 'red', role: 'general' },
  e10: { color: 'black', role: 'general' },
});
export const XQ_PRIMER_FACING_LEGAL = xqVisionDemoState('xq-primer-facing-legal', {
  e1: { color: 'red', role: 'general' },
  e10: { color: 'black', role: 'general' },
  e6: { color: 'black', role: 'soldier' },
});
export function xqFacingLine(x0: number): string {
  const a = xqPoint(4, 1, 'red', x0, 28);
  const b = xqPoint(4, 10, 'red', x0, 28);
  const yTop = Math.min(a.y, b.y) + 16;
  const yBottom = Math.max(a.y, b.y) - 16;
  return `<line x1="${a.x}" y1="${yTop}" x2="${a.x}" y2="${yBottom}" stroke="#d4351c" stroke-width="3" stroke-linecap="round" opacity="0.6" stroke-dasharray="3 5"/>`;
}
export const XQ_PRIMER_FACING_PAIR = () => xqSvg(
  XQ_BOARD_W * 2 + 28,
  XQ_BOARD_H + 52,
  [
    xqBoardSvg({
      state: XQ_PRIMER_FACING_ILLEGAL,
      x: 0,
      y: 0,
      label: 'FACING: FORBIDDEN',
      perspective: 'red',
      overlay: xqFacingLine(0),
    }),
    xqBoardSvg({
      state: XQ_PRIMER_FACING_LEGAL,
      x: XQ_BOARD_W + 28,
      y: 0,
      label: 'SCREENED: ALLOWED',
      perspective: 'red',
    }),
  ].join(''),
);

// Advisor: one diagonal step, confined to the palace.
export const XQ_PRIMER_ADVISOR = xqVisionDemoState('xq-primer-advisor', {
  e2: { color: 'red', role: 'advisor' },
});
export const XQ_PRIMER_ADVISOR_BOARD = () => xqSvg(
  XQ_BOARD_W,
  XQ_BOARD_H + 52,
  xqBoardSvg({
    state: XQ_PRIMER_ADVISOR,
    x: 0,
    y: 0,
    label: 'ADVISOR',
    perspective: 'red',
    dots: xqDots(['d1', 'f1', 'd3', 'f3']),
  }),
);

// Elephant: two points diagonally, never crossing the river and never passing
// a piece on the midpoint "eye" of the diagonal. Left board shows the river
// limit (a7, e7 unreachable from c5); right board shows an eye block: a piece
// on d4 cuts off the c5 diagonal from an elephant on e3.
export const XQ_PRIMER_ELEPHANT_RIVER = xqVisionDemoState('xq-primer-elephant-river', {
  c5: { color: 'red', role: 'elephant' },
});
export const XQ_PRIMER_ELEPHANT_EYE = xqVisionDemoState('xq-primer-elephant-eye', {
  e3: { color: 'red', role: 'elephant' },
  d4: { color: 'black', role: 'soldier' },
});
export const XQ_PRIMER_ELEPHANT_PAIR = () => xqSvg(
  XQ_BOARD_W * 2 + 28,
  XQ_BOARD_H + 52,
  [
    xqBoardSvg({
      state: XQ_PRIMER_ELEPHANT_RIVER,
      x: 0,
      y: 0,
      label: 'THE RIVER',
      perspective: 'red',
      dots: [
        ...xqDots(['a3', 'e3']),
        { square: 'a7' as XiangqiSquare, blocked: true },
        { square: 'e7' as XiangqiSquare, blocked: true },
      ],
    }),
    xqBoardSvg({
      state: XQ_PRIMER_ELEPHANT_EYE,
      x: XQ_BOARD_W + 28,
      y: 0,
      label: 'THE EYE',
      perspective: 'red',
      dots: [
        ...xqDots(['c1', 'g1', 'g5']),
        { square: 'c5' as XiangqiSquare, blocked: true },
      ],
    }),
  ].join(''),
);

// Chariot: slides any distance along open lines, cannot jump. On the e-file it
// is stopped by the soldier (which it may capture); the other rays run free.
export const XQ_PRIMER_CHARIOT = xqVisionDemoState('xq-primer-chariot', {
  e4: { color: 'red', role: 'chariot' },
  e8: { color: 'black', role: 'soldier' },
});
export const XQ_PRIMER_CHARIOT_BOARD = () => xqSvg(
  XQ_BOARD_W,
  XQ_BOARD_H + 52,
  xqBoardSvg({
    state: XQ_PRIMER_CHARIOT,
    x: 0,
    y: 0,
    label: 'CHARIOT',
    perspective: 'red',
    dots: [
      ...xqDots([
        'e5', 'e6', 'e7',
        'e3', 'e2', 'e1',
        'd4', 'c4', 'b4', 'a4',
        'f4', 'g4', 'h4', 'i4',
      ]),
      { square: 'e8' as XiangqiSquare, capture: true },
    ],
  }),
);

// Cannon: moves like a chariot, but captures only by leaping exactly one
// screen. Left board shows free movement; right board jumps the screen on e5
// to capture the chariot on e8.
export const XQ_PRIMER_CANNON_MOVE = xqVisionDemoState('xq-primer-cannon-move', {
  e4: { color: 'red', role: 'cannon' },
});
export const XQ_PRIMER_CANNON_CAPTURE = xqVisionDemoState('xq-primer-cannon-capture', {
  e2: { color: 'red', role: 'cannon' },
  e5: { color: 'red', role: 'soldier' },
  e8: { color: 'black', role: 'chariot' },
});
export const XQ_PRIMER_CANNON_PAIR = () => xqSvg(
  XQ_BOARD_W * 2 + 28,
  XQ_BOARD_H + 52,
  [
    xqBoardSvg({
      state: XQ_PRIMER_CANNON_MOVE,
      x: 0,
      y: 0,
      label: 'MOVE',
      perspective: 'red',
      dots: xqDots([
        'e5', 'e6', 'e7', 'e8', 'e9', 'e10',
        'e3', 'e2', 'e1',
        'd4', 'c4', 'b4', 'a4',
        'f4', 'g4', 'h4', 'i4',
      ]),
    }),
    xqBoardSvg({
      state: XQ_PRIMER_CANNON_CAPTURE,
      x: XQ_BOARD_W + 28,
      y: 0,
      label: 'CAPTURE',
      perspective: 'red',
      dots: [{ square: 'e8' as XiangqiSquare, capture: true }],
    }),
  ].join(''),
);

// Soldier: one point straight forward; after crossing the river it may also
// step sideways. Never backward.
export const XQ_PRIMER_SOLDIER_BEFORE = xqVisionDemoState('xq-primer-soldier-before', {
  e4: { color: 'red', role: 'soldier' },
});
export const XQ_PRIMER_SOLDIER_AFTER = xqVisionDemoState('xq-primer-soldier-after', {
  e6: { color: 'red', role: 'soldier' },
});
export const XQ_PRIMER_SOLDIER_PAIR = () => xqSvg(
  XQ_BOARD_W * 2 + 28,
  XQ_BOARD_H + 52,
  [
    xqBoardSvg({
      state: XQ_PRIMER_SOLDIER_BEFORE,
      x: 0,
      y: 0,
      label: 'BEFORE THE RIVER',
      perspective: 'red',
      dots: xqDots(['e5']),
    }),
    xqBoardSvg({
      state: XQ_PRIMER_SOLDIER_AFTER,
      x: XQ_BOARD_W + 28,
      y: 0,
      label: 'ACROSS THE RIVER',
      perspective: 'red',
      dots: xqDots(['e7', 'd6', 'f6']),
    }),
  ].join(''),
);

export const XQ_VISION_STATES = [
  {
    label: 'SOLDIER',
    state: xqVisionDemoState('xq-vision-soldier', {
      a4: { color: 'red', role: 'soldier' },
      c6: { color: 'red', role: 'soldier' },
      e8: { color: 'red', role: 'soldier' },
      f7: { color: 'red', role: 'soldier' },
      i5: { color: 'red', role: 'soldier' },
    }),
  },
  {
    label: 'ADVISOR',
    state: xqVisionDemoState('xq-vision-advisor', {
      d1: { color: 'red', role: 'advisor' },
      e2: { color: 'red', role: 'advisor' },
    }),
  },
  {
    label: 'ELEPHANT',
    state: xqVisionDemoState('xq-vision-elephant', {
      c1: { color: 'red', role: 'elephant' },
      g5: { color: 'red', role: 'elephant' },
    }),
  },
  {
    label: 'HORSE',
    state: xqVisionDemoState('xq-vision-horse', {
      d7: { color: 'red', role: 'horse' },
      f6: { color: 'red', role: 'horse' },
    }),
  },
  {
    label: 'CANNON',
    state: xqVisionDemoState('xq-vision-cannon', {
      b7: { color: 'red', role: 'cannon' },
      f3: { color: 'red', role: 'cannon' },
    }),
  },
  {
    label: 'CHARIOT',
    state: xqVisionDemoState('xq-vision-chariot', {
      d2: { color: 'red', role: 'chariot' },
      f7: { color: 'red', role: 'chariot' },
    }),
  },
  {
    label: 'GENERAL',
    state: xqVisionDemoState('xq-vision-general', {
      e1: { color: 'red', role: 'general' },
    }),
  },
];

export const XQ_VISIBILITY_GRID_COLUMNS = 3;
export const XQ_VISIBILITY_GRID_GAP = 28;
export const XQ_VISIBILITY_GRID_ROW_H = XQ_BOARD_H + 52;
export const XQ_VISIBILITY_GRID = () => xqSvg(
  XQ_BOARD_W * XQ_VISIBILITY_GRID_COLUMNS + XQ_VISIBILITY_GRID_GAP * (XQ_VISIBILITY_GRID_COLUMNS - 1),
  XQ_VISIBILITY_GRID_ROW_H * Math.ceil(XQ_VISION_STATES.length / XQ_VISIBILITY_GRID_COLUMNS),
  XQ_VISION_STATES.map(({ state, label }, index) => {
    const row = Math.floor(index / XQ_VISIBILITY_GRID_COLUMNS);
    const col = index % XQ_VISIBILITY_GRID_COLUMNS;
    const rowCount = Math.min(XQ_VISIBILITY_GRID_COLUMNS, XQ_VISION_STATES.length - row * XQ_VISIBILITY_GRID_COLUMNS);
    const centeredRowOffset = ((XQ_VISIBILITY_GRID_COLUMNS - rowCount) * (XQ_BOARD_W + XQ_VISIBILITY_GRID_GAP)) / 2;
    return xqBoardSvg({
      state,
      view: getXiangqiPlayerView(state, 'red', 'D'),
      x: centeredRowOffset + col * (XQ_BOARD_W + XQ_VISIBILITY_GRID_GAP),
      y: row * XQ_VISIBILITY_GRID_ROW_H,
      label,
      perspective: 'red',
    });
  }).join(''),
);

export const XQ_VISION_MOVE_BEFORE = xqVisionDemoState('xq-vision-move-before', {
  b1: { color: 'red', role: 'chariot' },
  b2: { color: 'red', role: 'chariot' },
  a9: { color: 'black', role: 'chariot' },
  e9: { color: 'black', role: 'general' },
});
export const XQ_VISION_MOVE_AFTER: XiangqiGameState = {
  ...XQ_VISION_MOVE_BEFORE,
  id: 'xq-vision-move-after',
  board: {
    b1: { color: 'red', role: 'chariot' },
    b9: { color: 'red', role: 'chariot' },
    a9: { color: 'black', role: 'chariot' },
    e9: { color: 'black', role: 'general' },
  },
  lastMove: { from: 'b2' as XiangqiSquare, to: 'b9' as XiangqiSquare },
};
export const XQ_VISION_MOVE_PAIR = () => xqSvg(
  XQ_BOARD_W * 2 + 28,
  XQ_BOARD_H + 52,
  [
    xqBoardSvg({
      state: XQ_VISION_MOVE_BEFORE,
      view: getXiangqiPlayerView(XQ_VISION_MOVE_BEFORE, 'red', 'D'),
      x: 0,
      y: 0,
      label: 'BEFORE',
      perspective: 'red',
    }),
    xqBoardSvg({
      state: XQ_VISION_MOVE_AFTER,
      view: getXiangqiPlayerView(XQ_VISION_MOVE_AFTER, 'red', 'D'),
      x: XQ_BOARD_W + 28,
      y: 0,
      label: 'AFTER',
      perspective: 'red',
      arrows: [{ from: 'b2' as XiangqiSquare, to: 'b9' as XiangqiSquare }],
    }),
  ].join(''),
);

export const XQ_CANNON_RULE_STATE: XiangqiGameState = {
  id: 'xq-cannon-rule',
  board: {
    e7: { color: 'red', role: 'cannon' },
    c7: { color: 'black', role: 'soldier' },
    e10: { color: 'black', role: 'general' },
    g7: { color: 'black', role: 'soldier' },
    i7: { color: 'black', role: 'soldier' },
  },
  status: { type: 'playing', turn: 'red' },
  moveNumber: 12,
  progressClock: 0,
  positionCounts: {},
};
export const XQ_CANNON_RULE_RED = getXiangqiPlayerView(XQ_CANNON_RULE_STATE, 'red', 'D');
export const XQ_CANNON_RULE_PAIR = () => xqSvg(
  XQ_BOARD_W * 2 + 28,
  XQ_BOARD_H + 52,
  [
    xqBoardSvg({
      state: XQ_CANNON_RULE_STATE,
      view: XQ_CANNON_RULE_RED,
      x: 0,
      y: 0,
      label: "RED'S VIEW",
      perspective: 'red',
    }),
    xqBoardSvg({
      state: XQ_CANNON_RULE_STATE,
      x: XQ_BOARD_W + 28,
      y: 0,
      label: 'SERVER TRUTH',
      perspective: 'red',
    }),
  ].join(''),
);
export const XQ_DARK_XIANGQI_THUMBNAIL = () => xqSvg(
  XQ_BOARD_W,
  XQ_BOARD_H,
  [
    xqBoardGrid(0, 0, 'red'),
    xqFogLayer(XQ_START_RED, 0, 0, 'red', 'xq-fog-dark-xiangqi-thumbnail'),
    xqPiecesLayer(XQ_START, XQ_START_RED, 0, 0, 'red'),
  ].join(''),
);

// ── Fog Xiangqi sample game ───────────────────────────────────────────────
// A complete public production game from 2026-07-17:
// rebirthfox333 (Red) vs Misty DXQ 1.1 (Black), Red wins in 31 plies.
// The finish is an unusually clean demonstration of the Fog rules. Red's
// chariot captures on d10, Black's general recaptures onto the newly opened
// d-file, then Red's general flies from d1 to d10 and captures it.
// https://mistboard.com/dark-xiangqi/game/dxq_ef889df8-a1eb-4d0a-bd0a-ffd7e8bc30f4
export const XQ_FOG_SAMPLE_MOVES: XiangqiMove[] = [
  { from: 'h3', to: 'h5' },
  { from: 'b10', to: 'a8' },
  { from: 'h5', to: 'e5' },
  { from: 'g10', to: 'e8' },
  { from: 'e5', to: 'i5' },
  { from: 'h8', to: 'i8' },
  { from: 'i5', to: 'g5' },
  { from: 'c7', to: 'c6' },
  { from: 'i1', to: 'i2' },
  { from: 'b8', to: 'b1' },
  { from: 'a1', to: 'b1' },
  { from: 'i7', to: 'i6' },
  { from: 'i2', to: 'd2' },
  { from: 'i8', to: 'f8' },
  { from: 'd1', to: 'e2' },
  { from: 'e10', to: 'e9' },
  { from: 'e1', to: 'd1' },
  { from: 'a10', to: 'a9' },
  { from: 'b3', to: 'e3' },
  { from: 'h10', to: 'g8' },
  { from: 'g5', to: 'g8' },
  { from: 'c6', to: 'c5' },
  { from: 'c4', to: 'c5' },
  { from: 'i10', to: 'i8' },
  { from: 'g8', to: 'g9' },
  { from: 'e9', to: 'e10' },
  { from: 'g9', to: 'c9' },
  { from: 'a8', to: 'c9' },
  { from: 'd2', to: 'd10' },
  { from: 'e10', to: 'd10' },
  { from: 'd1', to: 'd10' },
];

function replayFogXiangqiSample(): XiangqiGameState[] {
  const states = [createInitialXiangqiState('fog-xiangqi-production-sample')];
  for (const [index, move] of XQ_FOG_SAMPLE_MOVES.entries()) {
    const current = states.at(-1)!;
    const next = applyXiangqiMove(current, move);
    if (next === current) {
      throw new Error(`invalid Fog Xiangqi sample move at ply ${index + 1}`);
    }
    states.push(next);
  }
  return states;
}

export const XQ_FOG_SAMPLE_STATES = replayFogXiangqiSample();

const XQ_FOG_SAMPLE_NARRATIVES: Partial<Record<number, string>> = {
  0: 'Red has the lower army. Step through Red’s view, the server truth, and Black’s view.',
  10: 'Black’s cannon jumps a screen and captures the horse on b1.',
  11: 'Red’s chariot immediately captures that cannon.',
  21: 'Red’s roaming cannon captures Black’s horse on g8.',
  28: 'Black’s remaining horse catches the cannon on c9.',
  29: 'Red’s chariot crashes into d10 and captures an advisor beside the general.',
  30: 'Black’s general captures the chariot on d10. The entire d-file between the two generals is now open.',
  31: 'Red’s general flies from d1 to d10 and captures Black’s general. Fog Xiangqi ends immediately.',
};

function xqFogSampleTriptych(state: XiangqiGameState): string {
  const arrows = state.lastMove ? [{ from: state.lastMove.from, to: state.lastMove.to }] : undefined;
  return xqSvg(
    XQ_BOARD_W * 3 + 56,
    XQ_BOARD_H + 52,
    [
      xqBoardSvg({
        state,
        view: getXiangqiPlayerView(state, 'red', 'D'),
        x: 0,
        y: 0,
        label: "RED'S VIEW",
        perspective: 'red',
      }),
      xqBoardSvg({
        state,
        x: XQ_BOARD_W + 28,
        y: 0,
        label: 'SERVER TRUTH',
        perspective: 'red',
        arrows,
      }),
      xqBoardSvg({
        state,
        view: getXiangqiPlayerView(state, 'black', 'D'),
        x: (XQ_BOARD_W + 28) * 2,
        y: 0,
        label: "BLACK'S VIEW",
        perspective: 'red',
      }),
    ].join(''),
  );
}

export const XQ_FOG_SAMPLE_STEPS = XQ_FOG_SAMPLE_STATES.map((state, ply) => ({
  svg: () => xqFogSampleTriptych(state),
  narrative: XQ_FOG_SAMPLE_NARRATIVES[ply],
}));

// ── Jieqi rules diagrams ──────────────────────────────────────────────────
// Jieqi is hidden-identity, not fog. These diagrams reuse the xiangqi board
// shell but render all non-general pieces as same-color piece backs and keep the
// whole board visible.
// Future real-game diagram candidates:
// https://www.youtube.com/watch?v=Tpmy3-pg9uc
//   2022 international Jieqi team open broadcast, strongest event provenance.
// https://www.youtube.com/watch?v=ZmNT0halq8s
//   2021 international Jieqi online championship broadcast.
// https://www.youtube.com/watch?v=7HNUtU02C6Q
//   Shorter Wang Tianyi vs Lei Yongming clip, easier to parse but less formal.
// Recovering positions from video is manual work. An engine-generated game may
// be a cleaner article source if we can produce and verify one later.
export const JIEQI_PAIR_W = XQ_BOARD_W * 2 + 28;
export const JIEQI_PAIR_CENTER_X = (JIEQI_PAIR_W - XQ_BOARD_W) / 2;

export const JIEQI_START_VIEW_BOARD = Object.fromEntries(
  Object.entries(XQ_START.board).map(([sq, piece]) => [
    sq,
    { piece, shrouded: piece.role !== 'general' },
  ]),
) as XiangqiPlayerView['board'];
export const JIEQI_START_VIEW = xqStaticView('jieqi-start-view', JIEQI_START_VIEW_BOARD);
export const JIEQI_START_BOARD = (labels?: { start?: string }) => xqSvg(
  XQ_BOARD_W,
  XQ_BOARD_H + 52,
  xqBoardSvg({
    state: XQ_START,
    view: JIEQI_START_VIEW,
    x: 0,
    y: 0,
    label: labels?.start ?? 'SHUFFLED START',
    perspective: 'red',
    shroudedStyle: 'back',
  }),
  // Section hero, matching the Xiangqi starting-position board.
  'xq-article-svg--hero',
);
export const JIEQI_RULES_THUMBNAIL = () => xqSvg(
  XQ_BOARD_W,
  XQ_BOARD_H,
  [
    xqBoardGrid(0, 0, 'red'),
    xqPiecesLayer(XQ_START, JIEQI_START_VIEW, 0, 0, 'red', 'back'),
  ].join(''),
);

export const JIEQI_REVEAL_BEFORE_BOARD: XiangqiPlayerView['board'] = {
  b1: { piece: { color: 'red', role: 'cannon' }, shrouded: true },
};
export const JIEQI_REVEAL_BEFORE_STATE = xqVisionDemoState('jieqi-reveal-before', {
  b1: { color: 'red', role: 'cannon' },
});
export const JIEQI_REVEAL_AFTER_STATE = xqVisionDemoState('jieqi-reveal-after', {
  c3: { color: 'red', role: 'cannon' },
});
export const JIEQI_REVEAL_BEFORE_VIEW = xqStaticView(
  'jieqi-reveal-before-view',
  JIEQI_REVEAL_BEFORE_BOARD,
);
export const JIEQI_REVEAL_PAIR = (labels?: { before?: string; after?: string }) => xqSvg(
  JIEQI_PAIR_W,
  XQ_BOARD_H + 52,
  [
    xqBoardSvg({
      state: JIEQI_REVEAL_BEFORE_STATE,
      view: JIEQI_REVEAL_BEFORE_VIEW,
      x: 0,
      y: 0,
      label: labels?.before ?? 'BEFORE: HORSE POINT',
      perspective: 'red',
      dots: [{ square: 'c3' as XiangqiSquare }],
      shroudedStyle: 'back',
    }),
    xqBoardSvg({
      state: JIEQI_REVEAL_AFTER_STATE,
      x: XQ_BOARD_W + 28,
      y: 0,
      label: labels?.after ?? 'AFTER: REVEALED CANNON',
      perspective: 'red',
      arrows: [{ from: 'b1' as XiangqiSquare, to: 'c3' as XiangqiSquare }],
    }),
  ].join(''),
);

export const JIEQI_REVEALED_ADVISOR_STATE = xqVisionDemoState('jieqi-revealed-advisor', {
  c6: { color: 'red', role: 'advisor' },
});
export const JIEQI_REVEALED_ELEPHANT_STATE = xqVisionDemoState('jieqi-revealed-elephant', {
  g7: { color: 'red', role: 'elephant' },
  f8: { color: 'black', role: 'soldier' },
});
export const JIEQI_REVEALED_FREEDOMS = (labels?: { advisor?: string; elephant?: string }) => xqSvg(
  JIEQI_PAIR_W,
  XQ_BOARD_H + 52,
  [
    xqBoardSvg({
      state: JIEQI_REVEALED_ADVISOR_STATE,
      x: 0,
      y: 0,
      label: labels?.advisor ?? 'ADVISOR AFTER REVEAL',
      perspective: 'red',
      dots: xqDots(['b5', 'd5', 'b7', 'd7']),
    }),
    xqBoardSvg({
      state: JIEQI_REVEALED_ELEPHANT_STATE,
      x: XQ_BOARD_W + 28,
      y: 0,
      label: labels?.elephant ?? 'ELEPHANT AFTER REVEAL',
      perspective: 'red',
      dots: [
        ...xqDots(['e5', 'i5', 'i9']),
        { square: 'e9' as XiangqiSquare, blocked: true },
      ],
    }),
  ].join(''),
);

// The start position at the same scale as the paired boards below it. The
// rules page uses JIEQI_START_BOARD, which is a full-width hero; in an article
// that also carries two-board figures, a hero board reads as a different
// diagram system. Same canvas width as a pair, one board centred in it.
export const JIEQI_START_ROW = (labels?: { start?: string }) => xqSvg(
  JIEQI_PAIR_W,
  XQ_BOARD_H + 52,
  xqBoardSvg({
    state: XQ_START,
    view: JIEQI_START_VIEW,
    x: JIEQI_PAIR_CENTER_X,
    y: 0,
    label: labels?.start ?? 'SHUFFLED START',
    perspective: 'red',
    shroudedStyle: 'back',
  }),
);

// ---- Jieqi openings article (slug: jieqi-openings) ----
// The openings are named in xiangqi file notation, which the chess-side
// audience cannot locate on a board. These two boards carry the geography so
// the tables can carry the argument.

// Left: the four openings that spend one move. Read left to right as Red sees
// them: edge pawn (a4), the 3-/7-file pawn push (c4), central pawn (e4), and
// the cannon point crossing the river (h3 to h7). Right: taking both horses
// with both cannons, which needs the black cannons on b8/h8 as screens.
export const JIEQI_OPENING_MOVES = (labels?: { moves?: string; gamble?: string }) => xqSvg(
  JIEQI_PAIR_W,
  XQ_BOARD_H + 52,
  [
    xqBoardSvg({
      state: XQ_START,
      view: JIEQI_START_VIEW,
      x: 0,
      y: 0,
      label: labels?.moves ?? 'FOUR OPENINGS, ONE MOVE EACH',
      perspective: 'red',
      shroudedStyle: 'back',
      arrows: [
        { from: 'a4' as XiangqiSquare, to: 'a5' as XiangqiSquare },
        { from: 'c4' as XiangqiSquare, to: 'c5' as XiangqiSquare },
        { from: 'e4' as XiangqiSquare, to: 'e5' as XiangqiSquare },
        { from: 'h3' as XiangqiSquare, to: 'h7' as XiangqiSquare },
      ],
    }),
    xqBoardSvg({
      state: XQ_START,
      view: JIEQI_START_VIEW,
      x: XQ_BOARD_W + 28,
      y: 0,
      label: labels?.gamble ?? 'BOTH CANNONS TAKE BOTH HORSES',
      perspective: 'red',
      shroudedStyle: 'back',
      arrows: [
        { from: 'b3' as XiangqiSquare, to: 'b10' as XiangqiSquare },
        { from: 'h3' as XiangqiSquare, to: 'h10' as XiangqiSquare },
      ],
    }),
  ].join(''),
);

// What a face-down piece on a cannon point is worth before you spend it, and
// what you are left holding if it turns out to be a soldier. The black cannon
// on h8 is the screen that makes the capture on h10 legal.
export const JIEQI_OPTION_BEFORE_BOARD: XiangqiPlayerView['board'] = {
  h3: { piece: { color: 'red', role: 'cannon' }, shrouded: true },
  h8: { piece: { color: 'black', role: 'cannon' }, shrouded: false },
  h10: { piece: { color: 'black', role: 'horse' }, shrouded: false },
};
export const JIEQI_OPTION_BEFORE_STATE = xqVisionDemoState('jieqi-option-before', {
  h3: { color: 'red', role: 'cannon' },
  h8: { color: 'black', role: 'cannon' },
  h10: { color: 'black', role: 'horse' },
});
export const JIEQI_OPTION_BEFORE_VIEW = xqStaticView(
  'jieqi-option-before-view',
  JIEQI_OPTION_BEFORE_BOARD,
);
export const JIEQI_OPTION_AFTER_STATE = xqVisionDemoState('jieqi-option-after', {
  h10: { color: 'red', role: 'soldier' },
  h8: { color: 'black', role: 'cannon' },
});
export const JIEQI_OPTION_SPENT = (labels?: { before?: string; after?: string }) => xqSvg(
  JIEQI_PAIR_W,
  XQ_BOARD_H + 52,
  [
    xqBoardSvg({
      state: JIEQI_OPTION_BEFORE_STATE,
      view: JIEQI_OPTION_BEFORE_VIEW,
      x: 0,
      y: 0,
      label: labels?.before ?? 'FACE-DOWN ON A CANNON POINT',
      perspective: 'red',
      shroudedStyle: 'back',
      dots: [
        ...xqDots(['h4', 'h5', 'h6', 'h7']),
        { square: 'h10' as XiangqiSquare, capture: true },
      ],
    }),
    xqBoardSvg({
      state: JIEQI_OPTION_AFTER_STATE,
      x: XQ_BOARD_W + 28,
      y: 0,
      label: labels?.after ?? 'SPENT: A SOLDIER TOOK THE HORSE',
      perspective: 'red',
      dots: xqDots(['g10', 'i10']),
    }),
  ].join(''),
);

export function jieqiCaptureTray(x: number, y: number, label: string, detail: string, shrouded: boolean): string {
  const pieceSize = 46;
  const cardW = (JIEQI_PAIR_W - 28) / 2;
  const cardX = x;
  return [
    `<rect x="${cardX}" y="${y}" width="${cardW}" height="94" rx="10" class="xq-jieqi-capture-card" stroke-width="1.5"/>`,
    renderXiangqiPieceGlyphed({ color: 'black', role: 'horse' }, activeXiangqiPieceSet, {
      x: cardX + 18,
      y: y + 24,
      size: pieceSize,
      shrouded,
      shroudedStyle: 'back',
    }),
    `<text x="${cardX + 82}" y="${y + 36}" font-family="system-ui, sans-serif" font-size="13" font-weight="700" class="xq-jieqi-capture-label">${label}</text>`,
    `<text x="${cardX + 82}" y="${y + 60}" font-family="system-ui, sans-serif" font-size="13" class="xq-jieqi-capture-detail">${detail}</text>`,
  ].join('');
}

export const JIEQI_CAPTURE_BEFORE_STATE = xqVisionDemoState('jieqi-capture-before', {
  a4: { color: 'red', role: 'chariot' },
  a7: { color: 'black', role: 'horse' },
});
export const JIEQI_CAPTURE_BEFORE_VIEW = xqStaticView('jieqi-capture-before-view', {
  a4: { piece: { color: 'red', role: 'chariot' }, shrouded: false },
  a7: { piece: { color: 'black', role: 'horse' }, shrouded: true },
});
export const JIEQI_CAPTURE_PRIVACY = (labels?: { capture?: string; title?: string; redKnows?: string; blackKnows?: string }) => xqSvg(
  JIEQI_PAIR_W,
  XQ_BOARD_H + 214,
  [
    xqBoardSvg({
      state: JIEQI_CAPTURE_BEFORE_STATE,
      view: JIEQI_CAPTURE_BEFORE_VIEW,
      x: JIEQI_PAIR_CENTER_X,
      y: 0,
      label: labels?.capture ?? 'CAPTURE',
      perspective: 'red',
      arrows: [{ from: 'a4' as XiangqiSquare, to: 'a7' as XiangqiSquare }],
      shroudedStyle: 'back',
    }),
    `<text x="${JIEQI_PAIR_W / 2}" y="${XQ_BOARD_H + 82}" font-family="system-ui, sans-serif" font-size="13" font-weight="700" class="xq-diagram-title" text-anchor="middle">${labels?.title ?? 'CAPTURED PIECE KNOWLEDGE'}</text>`,
    jieqiCaptureTray(
      0,
      XQ_BOARD_H + 104,
      labels?.redKnows ?? 'RED KNOWS',
      'the captured piece was a horse',
      false,
    ),
    jieqiCaptureTray(
      (JIEQI_PAIR_W + 28) / 2,
      XQ_BOARD_H + 104,
      labels?.blackKnows ?? 'BLACK KNOWS',
      'one dark piece disappeared',
      true,
    ),
  ].join(''),
);

// ── Banqi rules diagrams ──────────────────────────────────────────────────
// Future real-game diagram candidate:
// https://www.youtube.com/watch?v=9QZotFsuWaM
// Public 神來也暗棋 clip uploaded 2022-11-09 by "暗棋 Dark Chess".
// Manual parsing is required before using it as a reconstructed position.
export const BANQI_COLS = 8;
export const BANQI_ROWS = 4;
export const BANQI_CELL = 50;
export const BANQI_MARGIN = 16;
export const BANQI_BOARD_W = BANQI_MARGIN * 2 + BANQI_COLS * BANQI_CELL;
export const BANQI_BOARD_H = BANQI_MARGIN * 2 + BANQI_ROWS * BANQI_CELL;
export const BANQI_PIECE_SIZE = 42;
// Banqi diagrams fill the article column: the board canvas is exactly the board
// width (no pair-width letterboxing), so every banqi figure renders edge-to-edge
// instead of centered inside a wider xq-pair frame. Kept as named constants so
// the diagram bodies (title centering, board offset) need no per-call edits.
export const BANQI_PAIR_W = BANQI_BOARD_W;
export const BANQI_CENTER_X = 0;
export const BANQI_RIGHT_HALF_W = BANQI_MARGIN * 2 + (BANQI_COLS / 2) * BANQI_CELL;
export const BANQI_RIGHT_HALF_X0 = -(BANQI_COLS / 2) * BANQI_CELL;
// The engine-article thumbnail uses the full 8x4 board inside a card canvas
// close to 16:10. Keep a little extra space above the board so the full board
// sits slightly low in the image, matching the card's visual weight.
export const BANQI_ENGINE_THUMB_H = 270;
export const BANQI_ENGINE_THUMB_Y = 30;
const BANQI_ENGINE_THUMB_PLY = 30;

export type BanqiPieceSpec = {
  color?: XiangqiColor;
  role?: XiangqiPiece['role'];
  shrouded?: boolean;
};

export function banqiCellCenter(col: number, row: number, x0: number, y0: number): { x: number; y: number } {
  return {
    x: x0 + BANQI_MARGIN + col * BANQI_CELL + BANQI_CELL / 2,
    y: y0 + BANQI_MARGIN + row * BANQI_CELL + BANQI_CELL / 2,
  };
}

export function banqiBoardGrid(x0: number, y0: number): string {
  const left = x0 + BANQI_MARGIN;
  const top = y0 + BANQI_MARGIN;
  const right = left + BANQI_COLS * BANQI_CELL;
  const bottom = top + BANQI_ROWS * BANQI_CELL;
  const parts: string[] = [
    `<rect x="${x0}" y="${y0}" width="${BANQI_BOARD_W}" height="${BANQI_BOARD_H}" rx="${XQ_BOARD_RADIUS}" class="xq-diagram-bg"/>`,
  ];
  for (let c = 0; c <= BANQI_COLS; c += 1) {
    const x = left + c * BANQI_CELL;
    parts.push(`<line x1="${x}" y1="${top}" x2="${x}" y2="${bottom}" class="xq-diagram-line" stroke-width="1"/>`);
  }
  for (let r = 0; r <= BANQI_ROWS; r += 1) {
    const y = top + r * BANQI_CELL;
    parts.push(`<line x1="${left}" y1="${y}" x2="${right}" y2="${y}" class="xq-diagram-line" stroke-width="1"/>`);
  }
  // A plain 4x8 grid — deliberately no palace diagonals or soldier/cannon start
  // brackets. Banqi keeps none of those rules, the article prose says pieces sit
  // in the squares (not on xiangqi intersections), and the live board
  // (renderBanqiBoardSvg) draws no furniture either. Keep these consistent.
  return parts.join('');
}

export function banqiPiece(spec: BanqiPieceSpec, col: number, row: number, x0: number, y0: number): string {
  const { x, y } = banqiCellCenter(col, row, x0, y0);
  const piece: XiangqiPiece = {
    color: spec.color ?? 'black',
    role: spec.role ?? 'soldier',
  };
  return renderXiangqiPieceGlyphed(piece, activeXiangqiPieceSet, {
    x: x - BANQI_PIECE_SIZE / 2,
    y: y - BANQI_PIECE_SIZE / 2,
    size: BANQI_PIECE_SIZE,
    shrouded: spec.shrouded,
    shroudedStyle: spec.shrouded ? 'back' : undefined,
    ariaLabel: spec.shrouded ? 'face-down Banqi piece' : undefined,
  });
}

export function banqiBackPieces(
  x0: number,
  y0: number,
  revealed?: { col: number; row: number; piece: XiangqiPiece },
): string {
  const parts: string[] = [];
  for (let row = 0; row < BANQI_ROWS; row += 1) {
    for (let col = 0; col < BANQI_COLS; col += 1) {
      if (revealed && revealed.col === col && revealed.row === row) {
        parts.push(banqiPiece(revealed.piece, col, row, x0, y0));
      } else {
        parts.push(banqiPiece({ shrouded: true }, col, row, x0, y0));
      }
    }
  }
  return parts.join('');
}

const BANQI_MOVE_TOKEN = /^([a-h][1-4])([a-h][1-4])$/;

function banqiMoveFromToken(token: string): BanqiMove | null {
  const match = BANQI_MOVE_TOKEN.exec(token);
  if (!match) return null;
  return { from: match[1] as BanqiSquare, to: match[2] as BanqiSquare };
}

export function banqiReplayViewAt(deal: BanqiDeal, moves: string, ply: number): BanqiPlayerView {
  let state = createInitialBanqiState('banqi-engine-thumbnail', deal);
  const parsedMoves = moves.trim().split(/\s+/).map(banqiMoveFromToken);
  for (const move of parsedMoves.slice(0, ply)) {
    if (move) state = applyBanqiMove(state, move);
  }
  return getBanqiPlayerView(state, 'red');
}

export function banqiPiecesFromView(view: BanqiPlayerView, x0: number, y0: number): string {
  return Object.entries(view.board)
    .map(([square, entry]) => {
      if (!entry) return '';
      const col = square.charCodeAt(0) - 97;
      const row = 4 - Number(square[1]);
      return entry.faceDown
        ? banqiPiece({ shrouded: true }, col, row, x0, y0)
        : banqiPiece({ color: entry.color, role: entry.role }, col, row, x0, y0);
    })
    .join('');
}

export function banqiArrow(
  from: { col: number; row: number },
  to: { col: number; row: number },
  x0: number,
  y0: number,
  id: string,
  // Pull the arrowhead back from the target cell centre by this many px, so the
  // pointy end lands on the OUTER edge of the captured piece rather than its middle.
  endInset = 0,
): string {
  const start = banqiCellCenter(from.col, from.row, x0, y0);
  const rawEnd = banqiCellCenter(to.col, to.row, x0, y0);
  const dx = rawEnd.x - start.x;
  const dy = rawEnd.y - start.y;
  const length = Math.hypot(dx, dy) || 1;
  const end = {
    x: rawEnd.x - (dx / length) * endInset,
    y: rawEnd.y - (dy / length) * endInset,
  };
  return [
    `<defs><marker id="${id}" markerWidth="4" markerHeight="4" refX="2.05" refY="2" orient="auto" overflow="visible" markerUnits="strokeWidth"><path d="M0,0 V4 L3,2 Z" fill="#15781B"/></marker></defs>`,
    `<line x1="${start.x}" y1="${start.y}" x2="${end.x}" y2="${end.y}" stroke="#15781B" stroke-width="5.25" stroke-linecap="round" opacity="0.38" marker-end="url(#${id})"/>`,
  ].join('');
}

export const BANQI_SETUP_BOARD = () => xqSvg(
  BANQI_PAIR_W,
  BANQI_BOARD_H + 52,
  [
    `<text x="${BANQI_PAIR_W / 2}" y="14" font-family="system-ui, sans-serif" font-size="13" font-weight="700" class="xq-diagram-title" text-anchor="middle">FIRST FLIP ASSIGNS COLOR</text>`,
    banqiBoardGrid(BANQI_CENTER_X, 28),
    banqiBackPieces(BANQI_CENTER_X, 28, {
      col: 3,
      row: 1,
      piece: { color: 'red', role: 'elephant' },
    }),
  ].join(''),
);

export const BANQI_RULES_THUMBNAIL = () => xqSvg(
  BANQI_BOARD_W,
  BANQI_BOARD_H,
  [
    banqiBoardGrid(0, 0),
    banqiBackPieces(0, 0, {
      col: 3,
      row: 1,
      piece: { color: 'red', role: 'horse' },
    }),
  ].join(''),
);

// Distinct thumbnail for the "How MistyBanqi Plays" engine article: a full real
// position from the article's conversion game, after enough flips that the card
// reads as Banqi instead of a wall of backs. Full-board rendering keeps the card
// honest: no generated or cropped board geometry.
export const BANQI_ENGINE_THUMBNAIL = () => {
  const view = banqiReplayViewAt(
    BANQI_CONVERSION_GAME.deal,
    BANQI_CONVERSION_GAME.moves,
    BANQI_ENGINE_THUMB_PLY,
  );
  return (
  xqSvg(
    BANQI_BOARD_W,
    BANQI_ENGINE_THUMB_H,
    [
      `<g data-banqi-thumbnail-layout="engine-full-board">`,
      banqiBoardGrid(0, BANQI_ENGINE_THUMB_Y),
      banqiPiecesFromView(view, 0, BANQI_ENGINE_THUMB_Y),
      `</g>`,
    ].join(''),
  )
  );
};

export const BANQI_RANK_ORDER: Array<{ role: XiangqiPiece['role']; label: string }> = [
  { role: 'general', label: 'General' },
  { role: 'advisor', label: 'Advisor' },
  { role: 'elephant', label: 'Elephant' },
  { role: 'chariot', label: 'Chariot' },
  { role: 'horse', label: 'Horse' },
  { role: 'soldier', label: 'Soldier' },
];

export const BANQI_RANK_LADDER = () => {
  // Same footprint as the half-xiangqi board diagrams: a BANQI_BOARD_W x
  // BANQI_BOARD_H panel centred at BANQI_CENTER_X, with the title above it.
  // The cannon is drawn set apart (dashed slot) between horse and soldier: it
  // never captures by this ladder (screen jump, ignores rank), but as a TARGET
  // it ranks there, above only the soldier. The caption states the dual nature
  // so the horse-takes-cannon / soldier-cannot boundary is visible, not just
  // buried in the prose. Cannon ink-coloured dashing adapts to every board
  // theme (all three diagram backgrounds are light).
  const L = BANQI_CENTER_X;
  const T = 28;
  const ladder: Array<{ role: XiangqiPiece['role']; label: string; targetOnly?: boolean }> = [
    ...BANQI_RANK_ORDER.slice(0, -1),
    { role: 'cannon', label: 'Cannon', targetOnly: true },
    BANQI_RANK_ORDER[BANQI_RANK_ORDER.length - 1],
  ];
  const count = ladder.length;
  const step = 56;
  const boardCenterX = L + BANQI_BOARD_W / 2;
  const pieceX = (index: number): number => boardCenterX + (index - (count - 1) / 2) * step;
  return xqSvg(
    BANQI_PAIR_W,
    BANQI_BOARD_H + 80,
    [
      `<text x="${BANQI_PAIR_W / 2}" y="14" font-family="system-ui, sans-serif" font-size="13" font-weight="700" class="xq-diagram-title" text-anchor="middle">CAPTURE RANK LADDER</text>`,
      `<rect x="${L}" y="${T}" width="${BANQI_BOARD_W}" height="${BANQI_BOARD_H}" rx="${XQ_BOARD_RADIUS}" class="xq-diagram-bg"/>`,
      ...ladder.map(({ role, label, targetOnly }, index) => {
        const cx = pieceX(index);
        const marker = targetOnly
          ? `<rect x="${cx - 25}" y="${T + 38}" width="50" height="134" rx="12" fill="var(--xq-diagram-ink, #4b3c2a)" fill-opacity="0.06" stroke="var(--xq-diagram-ink, #4b3c2a)" stroke-width="1.5" stroke-dasharray="5 3"/>`
          : '';
        return [
          marker,
          renderXiangqiPieceGlyphed({ color: 'red', role }, activeXiangqiPieceSet, {
            x: cx - 18,
            y: T + 44,
            size: 36,
          }),
          renderXiangqiPieceGlyphed({ color: 'black', role }, activeXiangqiPieceSet, {
            x: cx - 18,
            y: T + 94,
            size: 36,
          }),
          `<text x="${cx}" y="${T + 164}" font-family="system-ui, sans-serif" font-size="11" class="xq-diagram-ink" text-anchor="middle">${label}</text>`,
        ].join('');
      }),
      `<text x="${L + 60}" y="${T + 206}" font-family="system-ui, sans-serif" font-size="12" font-weight="700" class="xq-diagram-ink" text-anchor="middle">HIGH</text>`,
      `<text x="${L + BANQI_BOARD_W - 60}" y="${T + 206}" font-family="system-ui, sans-serif" font-size="12" font-weight="700" class="xq-diagram-ink" text-anchor="middle">LOW</text>`,
      `<text x="${BANQI_PAIR_W / 2}" y="${T + 252}" font-family="system-ui, sans-serif" font-size="11" class="xq-diagram-outside-text" text-anchor="middle">Attacking, the cannon jumps a screen and ignores rank.</text>`,
      `<text x="${BANQI_PAIR_W / 2}" y="${T + 269}" font-family="system-ui, sans-serif" font-size="11" class="xq-diagram-outside-text" text-anchor="middle">As a target it ranks here: taken by horse and up, never by a soldier.</text>`,
    ].join(''),
  );
};

export const BANQI_CANNON_CAPTURE = () => xqSvg(
  BANQI_PAIR_W,
  BANQI_BOARD_H + 52,
  [
    `<text x="${BANQI_PAIR_W / 2}" y="14" font-family="system-ui, sans-serif" font-size="13" font-weight="700" class="xq-diagram-title" text-anchor="middle">CANNON SCREEN CAPTURE</text>`,
    banqiBoardGrid(BANQI_CENTER_X, 28),
    banqiArrow(
      { col: 1, row: 2 },
      { col: 6, row: 2 },
      BANQI_CENTER_X,
      28,
      'banqi-cannon-screen-capture',
      BANQI_PIECE_SIZE / 2 + 4,
    ),
    banqiPiece({ color: 'red', role: 'cannon' }, 1, 2, BANQI_CENTER_X, 28),
    banqiPiece({ shrouded: true }, 3, 2, BANQI_CENTER_X, 28),
    banqiPiece({ color: 'black', role: 'general' }, 6, 2, BANQI_CENTER_X, 28),
    // Red ring marks the capture target (the revealed enemy beyond the screen).
    `<circle cx="${banqiCellCenter(6, 2, BANQI_CENTER_X, 28).x}" cy="${banqiCellCenter(6, 2, BANQI_CENTER_X, 28).y}" r="${BANQI_PIECE_SIZE / 2 + 4}" fill="none" stroke="#b91c1c" stroke-width="2.5"/>`,
  ].join(''),
);

export const BANQI_TUNNEL_READING = () => {
  const wallCells = [
    [0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [5, 0], [6, 0], [7, 0],
    [0, 1], [1, 1], [2, 1], [3, 1], [4, 1], [5, 1], [6, 1], [7, 1],
    [0, 2], [7, 2],
    [0, 3], [1, 3], [2, 3], [3, 3], [4, 3], [5, 3], [6, 3], [7, 3],
  ] as const;
  return xqSvg(
    BANQI_PAIR_W,
    BANQI_BOARD_H + 52,
    [
      `<text x="${BANQI_PAIR_W / 2}" y="14" font-family="system-ui, sans-serif" font-size="13" font-weight="700" class="xq-diagram-title" text-anchor="middle">FACE-DOWN PIECES SHAPE THE BOARD</text>`,
      banqiBoardGrid(BANQI_CENTER_X, 28),
      ...wallCells.map(([col, row]) => banqiPiece({ shrouded: true }, col, row, BANQI_CENTER_X, 28)),
      banqiArrow(
        { col: 2, row: 2 },
        { col: 5, row: 2 },
        BANQI_CENTER_X,
        28,
        'banqi-tunnel-chase',
      ),
      banqiPiece({ color: 'black', role: 'chariot' }, 2, 2, BANQI_CENTER_X, 28),
      banqiPiece({ color: 'red', role: 'horse' }, 5, 2, BANQI_CENTER_X, 28),
    ].join(''),
  );
};

export const XQ_FACING_GENERAL_BEFORE: XiangqiGameState = {
  id: 'xq-facing-general-before',
  board: {
    e1: { color: 'red', role: 'general' },
    d10: { color: 'black', role: 'general' },
  },
  status: { type: 'playing', turn: 'black' },
  moveNumber: 12,
  progressClock: 0,
  positionCounts: {},
};
export const XQ_FACING_GENERAL_EXPOSED = applyXiangqiMove(XQ_FACING_GENERAL_BEFORE, {
  from: 'd10' as XiangqiSquare,
  to: 'e10' as XiangqiSquare,
});
export const XQ_FACING_GENERAL_CAPTURED = applyXiangqiMove(XQ_FACING_GENERAL_EXPOSED, {
  from: 'e1' as XiangqiSquare,
  to: 'e10' as XiangqiSquare,
});
export const XQ_FACING_GENERAL_CAPTURED_RED = xqViewWithExtraVisibleSquares(
  getXiangqiPlayerView(XQ_FACING_GENERAL_CAPTURED, 'red', 'D'),
  ['d10', 'e9', 'f10'] as XiangqiSquare[],
);
export const XQ_FACING_GENERAL_STEPS = [
  {
    svg: () => xqSvg(
      XQ_BOARD_W * 2 + 28,
      XQ_BOARD_H + 52,
      [
        xqBoardSvg({
          state: XQ_FACING_GENERAL_BEFORE,
          view: getXiangqiPlayerView(XQ_FACING_GENERAL_BEFORE, 'red', 'D'),
          x: 0,
          y: 0,
          label: "RED'S VIEW",
          perspective: 'red',
        }),
        xqBoardSvg({
          state: XQ_FACING_GENERAL_BEFORE,
          x: XQ_BOARD_W + 28,
          y: 0,
          label: 'SERVER TRUTH',
          perspective: 'red',
        }),
      ].join(''),
    ),
  },
  {
    svg: () => xqSvg(
      XQ_BOARD_W * 2 + 28,
      XQ_BOARD_H + 52,
      [
        xqBoardSvg({
          state: XQ_FACING_GENERAL_EXPOSED,
          view: getXiangqiPlayerView(XQ_FACING_GENERAL_EXPOSED, 'red', 'D'),
          x: 0,
          y: 0,
          label: "RED'S VIEW",
          perspective: 'red',
        }),
        xqBoardSvg({
          state: XQ_FACING_GENERAL_EXPOSED,
          x: XQ_BOARD_W + 28,
          y: 0,
          label: 'SERVER TRUTH',
          perspective: 'red',
          arrows: [{ from: 'd10' as XiangqiSquare, to: 'e10' as XiangqiSquare }],
        }),
      ].join(''),
    ),
  },
  {
    svg: () => xqSvg(
      XQ_BOARD_W * 2 + 28,
      XQ_BOARD_H + 52,
      [
        xqBoardSvg({
          state: XQ_FACING_GENERAL_CAPTURED,
          view: XQ_FACING_GENERAL_CAPTURED_RED,
          x: 0,
          y: 0,
          label: "RED'S VIEW",
          perspective: 'red',
        }),
        xqBoardSvg({
          state: XQ_FACING_GENERAL_CAPTURED,
          x: XQ_BOARD_W + 28,
          y: 0,
          label: 'SERVER TRUTH',
          perspective: 'red',
          arrows: [{ from: 'e1' as XiangqiSquare, to: 'e10' as XiangqiSquare }],
        }),
      ].join(''),
    ),
  },
];

export const XQ_BLOCKED_HORSE_LEGS_STATE = xqVisionDemoState('xq-blocked-horse-legs', {
  c8: { color: 'red', role: 'horse' },
  g9: { color: 'red', role: 'horse' },
  c7: { color: 'black', role: 'soldier' },
  d8: { color: 'black', role: 'advisor' },
  f9: { color: 'black', role: 'general' },
  g8: { color: 'black', role: 'horse' },
});
export const XQ_BLOCKED_HORSE_LEGS_PAIR = () => xqSvg(
  XQ_BOARD_W * 2 + 28,
  XQ_BOARD_H + 52,
  [
    xqBoardSvg({
      state: XQ_BLOCKED_HORSE_LEGS_STATE,
      view: getXiangqiPlayerView(XQ_BLOCKED_HORSE_LEGS_STATE, 'red', 'D'),
      x: 0,
      y: 0,
      label: "RED'S VIEW",
      perspective: 'red',
    }),
    xqBoardSvg({
      state: XQ_BLOCKED_HORSE_LEGS_STATE,
      x: XQ_BOARD_W + 28,
      y: 0,
      label: 'SERVER TRUTH',
      perspective: 'red',
    }),
  ].join(''),
);

export const XQ_BLOCKED_ELEPHANT_EYES_STATE = xqVisionDemoState('xq-blocked-elephant-eyes', {
  c5: { color: 'red', role: 'elephant' },
  e3: { color: 'red', role: 'elephant' },
  b4: { color: 'black', role: 'soldier' },
  f4: { color: 'black', role: 'soldier' },
});
export const XQ_BLOCKED_ELEPHANT_EYES_PAIR = () => xqSvg(
  XQ_BOARD_W * 2 + 28,
  XQ_BOARD_H + 52,
  [
    xqBoardSvg({
      state: XQ_BLOCKED_ELEPHANT_EYES_STATE,
      view: getXiangqiPlayerView(XQ_BLOCKED_ELEPHANT_EYES_STATE, 'red', 'D'),
      x: 0,
      y: 0,
      label: "RED'S VIEW",
      perspective: 'red',
    }),
    xqBoardSvg({
      state: XQ_BLOCKED_ELEPHANT_EYES_STATE,
      x: XQ_BOARD_W + 28,
      y: 0,
      label: 'SERVER TRUTH',
      perspective: 'red',
    }),
  ].join(''),
);

export const XQ_GENERAL_CAPTURE_BEFORE: XiangqiGameState = {
  id: 'xq-general-capture-before',
  board: {
    c1: { color: 'red', role: 'elephant' },
    d1: { color: 'red', role: 'advisor' },
    e1: { color: 'red', role: 'general' },
    f1: { color: 'red', role: 'advisor' },
    g1: { color: 'red', role: 'elephant' },
    h1: { color: 'red', role: 'horse' },
    b3: { color: 'red', role: 'cannon' },
    c4: { color: 'red', role: 'soldier' },
    g4: { color: 'red', role: 'soldier' },
    e7: { color: 'red', role: 'chariot' },
    c7: { color: 'black', role: 'soldier' },
    g7: { color: 'black', role: 'soldier' },
    b8: { color: 'black', role: 'cannon' },
    h8: { color: 'black', role: 'cannon' },
    b10: { color: 'black', role: 'horse' },
    d10: { color: 'black', role: 'advisor' },
    e10: { color: 'black', role: 'general' },
    f10: { color: 'black', role: 'advisor' },
    g10: { color: 'black', role: 'elephant' },
    h10: { color: 'black', role: 'horse' },
  },
  status: { type: 'playing', turn: 'red' },
  moveNumber: 34,
  progressClock: 5,
  positionCounts: {},
};
export const XQ_GENERAL_CAPTURE_AFTER = applyXiangqiMove(XQ_GENERAL_CAPTURE_BEFORE, {
  from: 'e7' as XiangqiSquare,
  to: 'e10' as XiangqiSquare,
});
export const XQ_GENERAL_CAPTURE_BEFORE_RED = getXiangqiPlayerView(XQ_GENERAL_CAPTURE_BEFORE, 'red', 'D');
export const XQ_GENERAL_CAPTURE_AFTER_RED = getXiangqiPlayerView(XQ_GENERAL_CAPTURE_AFTER, 'red', 'D');
export const XQ_GENERAL_CAPTURE_PAIR = () => xqSvg(
  XQ_BOARD_W * 2 + 28,
  XQ_BOARD_H + 52,
  [
    xqBoardSvg({
      state: XQ_GENERAL_CAPTURE_BEFORE,
      view: XQ_GENERAL_CAPTURE_BEFORE_RED,
      x: 0,
      y: 0,
      label: "RED'S VIEW BEFORE",
      perspective: 'red',
    }),
    xqBoardSvg({
      state: XQ_GENERAL_CAPTURE_AFTER,
      view: XQ_GENERAL_CAPTURE_AFTER_RED,
      x: XQ_BOARD_W + 28,
      y: 0,
      label: "RED'S VIEW AFTER",
      perspective: 'red',
      arrows: [{ from: 'e7' as XiangqiSquare, to: 'e10' as XiangqiSquare }],
    }),
  ].join(''),
);

// ── Kriegspiel diagrams ────────────────────────────────────────────────────
// Kriegspiel vision is own pieces only: no derived cones, no opponent
// silhouettes. The fog complement is every square the player's pieces do not
// stand on, so the dark-chess visibility kernel is deliberately not involved.
export const ALL_CHESS_SQUARES: Square[] = [];
for (const file of 'abcdefgh') {
  for (let rank = 1; rank <= 8; rank += 1) {
    ALL_CHESS_SQUARES.push(`${file}${rank}` as Square);
  }
}

export function kriegspielFog(board: Board, player: 'white' | 'black'): Square[] {
  return ALL_CHESS_SQUARES.filter((square) => board[square]?.color !== player);
}

// A quiet Giuoco Pianissimo middlegame (1.e4 e5 2.Nf3 Nc6 3.Bc4 Bc5 4.c3 Nf6
// 5.d3 d6 6.O-O O-O 7.Nbd2): all thirty-two pieces alive, so the gap between
// the umpire's board and a player's board is at its widest.
export const KRIEGSPIEL_HERO_BOARD: Board = {
  a1: { color: 'white', role: 'rook' },
  d1: { color: 'white', role: 'queen' },
  f1: { color: 'white', role: 'rook' },
  g1: { color: 'white', role: 'king' },
  c1: { color: 'white', role: 'bishop' },
  d2: { color: 'white', role: 'knight' },
  f3: { color: 'white', role: 'knight' },
  c4: { color: 'white', role: 'bishop' },
  a2: { color: 'white', role: 'pawn' },
  b2: { color: 'white', role: 'pawn' },
  c3: { color: 'white', role: 'pawn' },
  d3: { color: 'white', role: 'pawn' },
  e4: { color: 'white', role: 'pawn' },
  f2: { color: 'white', role: 'pawn' },
  g2: { color: 'white', role: 'pawn' },
  h2: { color: 'white', role: 'pawn' },
  a8: { color: 'black', role: 'rook' },
  d8: { color: 'black', role: 'queen' },
  f8: { color: 'black', role: 'rook' },
  g8: { color: 'black', role: 'king' },
  c8: { color: 'black', role: 'bishop' },
  c5: { color: 'black', role: 'bishop' },
  c6: { color: 'black', role: 'knight' },
  f6: { color: 'black', role: 'knight' },
  a7: { color: 'black', role: 'pawn' },
  b7: { color: 'black', role: 'pawn' },
  c7: { color: 'black', role: 'pawn' },
  d6: { color: 'black', role: 'pawn' },
  e5: { color: 'black', role: 'pawn' },
  f7: { color: 'black', role: 'pawn' },
  g7: { color: 'black', role: 'pawn' },
  h7: { color: 'black', role: 'pawn' },
};
export const KRIEGSPIEL_HERO_FOG_W = kriegspielFog(KRIEGSPIEL_HERO_BOARD, 'white');

// Check-direction taxonomy: the checked king alone on c3, everything else
// fogged. Each panel highlights the full line or region the checker could be
// on; the announcement gives the direction, never the square, so the marking
// covers every square it could come from. c3 is chosen so the long diagonal
// (a1-h8, 8 squares) reads visibly longer than the short (a5-e1, 5 squares).
export const KRIEGSPIEL_CHECK_BOARD: Board = {
  c3: { color: 'white', role: 'king' },
};
export const KRIEGSPIEL_CHECK_FOG = kriegspielFog(KRIEGSPIEL_CHECK_BOARD, 'white');

// Highlighted squares per announced direction, all measured from the king on
// c3 and excluding c3 itself.
export const KRIEGSPIEL_CHECK_RANK: Square[] = ['a3', 'b3', 'd3', 'e3', 'f3', 'g3', 'h3'];
export const KRIEGSPIEL_CHECK_FILE: Square[] = ['c1', 'c2', 'c4', 'c5', 'c6', 'c7', 'c8'];
export const KRIEGSPIEL_CHECK_LONG_DIAG: Square[] = ['a1', 'b2', 'd4', 'e5', 'f6', 'g7', 'h8'];
export const KRIEGSPIEL_CHECK_SHORT_DIAG: Square[] = ['a5', 'b4', 'd2', 'e1'];
export const KRIEGSPIEL_CHECK_KNIGHT: Square[] = ['a2', 'a4', 'b1', 'b5', 'd1', 'd5', 'e2', 'e4'];
