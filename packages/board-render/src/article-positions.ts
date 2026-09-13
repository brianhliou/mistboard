// Article share-card / thumbnail fixtures, shared between two render paths:
//   • the article-list thumbnails in apps/web (articles-data.ts), and
//   • the per-article OG cards rendered server-side (apps/server/og-image.ts).
//
// Owning the positions here (rather than in the web bundle, which the server
// won't import) keeps the list thumbnail and the share card a single source of
// truth — they can't drift apart. The board fixtures the article *bodies* also
// use (CONE_QUEEN_BOARD, DISCOVERY_BOARD) are exported so the
// web file imports them back instead of keeping its own copies.

import type { Color, Square } from '@mistboard/game';
import { type Board, darkChessVariant, type GameState } from '@mistboard/game';
import type { PieceOnBoard } from './board-svg.js';
import { boardToPieces, fogSquaresFromVisible } from './positions.js';

export type ArticleOgPosition = {
  pieces: PieceOnBoard[];
  fogSquares?: Square[];
  orientation?: Color;
};

function fogFor(state: GameState, player: Color): Square[] {
  return fogSquaresFromVisible(darkChessVariant.getPlayerView(state, player).visibleSquares);
}

// A static board with no clocks/history — enough for visibility + rendering.
// moveNumber is irrelevant to fog (visibility derives only from the board), so
// any playing-turn state yields the same thumbnail.
function demoState(id: string, board: Board): GameState {
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

// ── Shared board fixtures (also used in the article bodies) ───────────────────
export const CONE_QUEEN_BOARD: Board = {
  e4: { color: 'white', role: 'queen' },
};

export const DISCOVERY_BOARD: Board = {
  g1: { color: 'white', role: 'king' },
  d1: { color: 'white', role: 'rook' },
  d3: { color: 'white', role: 'rook' },
  h7: { color: 'black', role: 'king' },
  b7: { color: 'black', role: 'queen' },
};

const DARK_CHESS_CONCEPTS_BOARD: Board = {
  g1: { color: 'white', role: 'king' },
  d5: { color: 'white', role: 'pawn' },
  h3: { color: 'white', role: 'bishop' },
  g8: { color: 'black', role: 'king' },
  c6: { color: 'black', role: 'pawn' },
  e6: { color: 'black', role: 'pawn' },
  c7: { color: 'black', role: 'knight' },
  d7: { color: 'black', role: 'rook' },
};

// Position after 1. e4 e5 2. Nf3 Nc6 3. Bc4 Nf6 — the same opening the
// server-enforced-fog article replays for its views-vs-truth figure (see
// SERVER_FOG_TRUTH_STATE in apps/web/src/articles-data.ts). The OG card
// renders it as a triptych: White's view, the canonical board, Black's view.
const SERVER_FOG_BOARD: Board = {
  a1: { color: 'white', role: 'rook' },
  b1: { color: 'white', role: 'knight' },
  c1: { color: 'white', role: 'bishop' },
  d1: { color: 'white', role: 'queen' },
  e1: { color: 'white', role: 'king' },
  h1: { color: 'white', role: 'rook' },
  a2: { color: 'white', role: 'pawn' },
  b2: { color: 'white', role: 'pawn' },
  c2: { color: 'white', role: 'pawn' },
  d2: { color: 'white', role: 'pawn' },
  f2: { color: 'white', role: 'pawn' },
  g2: { color: 'white', role: 'pawn' },
  h2: { color: 'white', role: 'pawn' },
  f3: { color: 'white', role: 'knight' },
  c4: { color: 'white', role: 'bishop' },
  e4: { color: 'white', role: 'pawn' },
  e5: { color: 'black', role: 'pawn' },
  c6: { color: 'black', role: 'knight' },
  f6: { color: 'black', role: 'knight' },
  a7: { color: 'black', role: 'pawn' },
  b7: { color: 'black', role: 'pawn' },
  c7: { color: 'black', role: 'pawn' },
  d7: { color: 'black', role: 'pawn' },
  f7: { color: 'black', role: 'pawn' },
  g7: { color: 'black', role: 'pawn' },
  h7: { color: 'black', role: 'pawn' },
  a8: { color: 'black', role: 'rook' },
  c8: { color: 'black', role: 'bishop' },
  d8: { color: 'black', role: 'queen' },
  e8: { color: 'black', role: 'king' },
  f8: { color: 'black', role: 'bishop' },
  h8: { color: 'black', role: 'rook' },
};

// ── Per-slug OG / thumbnail positions ─────────────────────────────────────────
const DARK_CHESS_START = darkChessVariant.createInitialState('dark-chess-rules-start');
const CONE_QUEEN = demoState('cone-queen', CONE_QUEEN_BOARD);
const DARK_CHESS_CONCEPTS = demoState('dark-chess-concepts-deduction', DARK_CHESS_CONCEPTS_BOARD);

const SERVER_FOG = demoState('server-fog-og', SERVER_FOG_BOARD);

// Boards for the server-enforced-fog triptych card. Full truth pieces are
// safe to pass for the fogged views: solid fog draws over hidden squares,
// and this is a fixed demo position from a published article, not live
// game state.
export const SERVER_FOG_TRIPTYCH: {
  pieces: PieceOnBoard[];
  whiteFog: Square[];
  blackFog: Square[];
} = {
  pieces: boardToPieces(SERVER_FOG_BOARD),
  whiteFog: fogFor(SERVER_FOG, 'white'),
  blackFog: fogFor(SERVER_FOG, 'black'),
};

export const ARTICLE_OG_POSITIONS: Record<string, ArticleOgPosition> = {
  // The chess primer is perfect-information: the start position, no fog.
  chess: {
    pieces: boardToPieces(DARK_CHESS_START.board),
    orientation: 'white',
  },
  'dark-chess': {
    pieces: boardToPieces(DARK_CHESS_START.board),
    fogSquares: fogFor(DARK_CHESS_START, 'white'),
    orientation: 'white',
  },
  'dark-chess-concepts': {
    pieces: boardToPieces(DARK_CHESS_CONCEPTS.board),
    fogSquares: fogFor(DARK_CHESS_CONCEPTS, 'white'),
    orientation: 'white',
  },
  'server-enforced-fog': {
    pieces: boardToPieces(CONE_QUEEN_BOARD),
    fogSquares: fogFor(CONE_QUEEN, 'white'),
    orientation: 'white',
  },
};
