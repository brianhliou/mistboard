// Banqi adapter for the shared GameTree spine. Banqi is a
// HIDDEN-DEAL variant: the 32 pieces are shuffled face-down at the start and
// revealed by flip moves as the game plays. In post-game review the game is over,
// so the deal is KNOWN — recovered from the fully-revealed history stream and
// baked into the truth state (every piece carries its true color+role from move 0,
// just faceDown:true). Given that FIXED deal, branching is fully deterministic:
// flipping a tile in an alternate line reveals whatever the deal placed there, so
// the tree behaves exactly like a perfect-information variant. The only difference
// from jungle's adapter is initialTruth — it closes over the recovered deal, so
// this adapter is a FACTORY, not a singleton constant.
//
// The board is projected MASKED (getBanqiPlayerView): face-down tiles stay hidden
// until a flip in THIS line reveals them, preserving the as-played experience; the
// analyst uncovers the deal by playing, in any reveal order. A flip is the
// self-move { from: X, to: X } (present in view.legalMoves), so from+to is still a
// stable, reversible move key ("e2e2" for a flip).

import {
  ALL_BANQI_SQUARES,
  applyBanqiMove,
  type BanqiDeal,
  type BanqiGameState,
  type BanqiMove,
  type BanqiPlayerView,
  type BanqiRules,
  type BanqiSquare,
  banqiSquareFromIndex,
  createInitialBanqiState,
  getBanqiPlayerView,
  isBanqiLegalMove,
} from '@mistboard/game';
import type { ProjectedView, VariantTreeAdapter } from './game-tree.js';

const BANQI_SQUARE_SET = new Set<string>(ALL_BANQI_SQUARES);

/** A BanqiSquare is exactly `${file}${rank}` (2 chars); validate against the
 *  enumerated set rather than trusting a substring. */
function parseBanqiSquare(token: string): BanqiSquare | null {
  return BANQI_SQUARE_SET.has(token) ? (token as BanqiSquare) : null;
}

/** Recover the fixed deal from a fully-revealed board — the earliest snapshot in
 *  the postgame `history.revealed` stream, where every square shows its true
 *  color+role (`faceDown: false`). The deal is a per-square list in square-index
 *  order (a1=0…h4=31), exactly what createInitialBanqiState consumes. Throws if a
 *  square is missing/masked so the caller degrades to an error rather than
 *  reconstructing a wrong board (mid-game snapshots would be incomplete; the
 *  earliest revealed snapshot is the pre-move deal and always complete). */
export function recoverBanqiDeal(revealed: BanqiPlayerView): BanqiDeal {
  return ALL_BANQI_SQUARES.map((square, index) => {
    const entry = revealed.board[banqiSquareFromIndex(index)];
    if (!entry || entry.faceDown) {
      throw new Error(`banqi deal recovery: square ${square} is not revealed`);
    }
    return { color: entry.color, role: entry.role };
  });
}

/** A finished game's start: the recovered deal and the rules it was played under
 *  (banqiRulesFromView on the postgame view; a game from before the 長捉 rule has
 *  it off, and replaying it under the rule could drop its chase moves). */
export type BanqiReviewStart = { deal: BanqiDeal; rules: BanqiRules };

/** Build a banqi tree adapter over a recovered deal. `mode: 'perfect-info'` — with
 *  the deal known, hidden-deal branching is deterministic and needs no server
 *  engine (there is no client ceval for banqi, so no engine bundle either). */
export function makeBanqiTreeAdapter(
  gameId: string,
  // Null when the caller roots the tree at a parsed position (TreeReviewConfig
  // `root`), in which case initialTruth is never consulted; asking anyway is a
  // wiring bug, so it throws rather than minting a deal the URL does not carry.
  start: BanqiReviewStart | null,
): VariantTreeAdapter<BanqiMove, BanqiGameState, BanqiPlayerView> {
  return {
    mode: 'perfect-info',
    initialTruth: () => {
      if (!start) throw new Error('banqi tree adapter: no deal; mount with config.root');
      return createInitialBanqiState(gameId, start.deal, start.rules);
    },
    isLegal: (truth, move) => truth.status.type === 'playing' && isBanqiLegalMove(truth, move),
    // applyBanqiMove returns `state` unchanged on an illegal move; the tree only
    // calls this after isLegal, so the successor is always the real move result.
    applyMove: (truth, move) => applyBanqiMove(truth, move),
    project: (truth): ProjectedView<BanqiPlayerView>[] => [
      {
        key: 'truth',
        label: 'Board',
        tier: 'primary',
        // Masked as-played view. Project for the SIDE TO MOVE so legalMoves (incl.
        // the flip self-moves) populate for the color the board is about to play; a
        // fixed projection would leave the other seat with no legal moves at odd
        // plies, rejecting every one of its moves.
        view: getBanqiPlayerView(
          truth,
          truth.status.type === 'playing' ? truth.status.turn : 'red',
        ),
      },
    ],
    // A flip (self-move) reads as the bare square ("e2"); a board move/capture as "e2-e3". The
    // absence of a dash unambiguously marks a flip, and dropping the " flip" word keeps the move
    // notation from truncating next to the decision glyph + luck badge in the move-list cell.
    moveLabel: (move) => (move.from === move.to ? move.from : `${move.from}-${move.to}`),
    // No client engine → no UCI dialect to honor: a from+to concatenation is a
    // stable, reversible key (a flip is "e2e2") for the NodeId + sibling dedup.
    moveKey: (move) => `${move.from}${move.to}`,
    toEngineUci: (move) => `${move.from}${move.to}`,
    fromUci: (uci) => {
      if (uci.length !== 4) return null;
      const from = parseBanqiSquare(uci.slice(0, 2));
      const to = parseBanqiSquare(uci.slice(2, 4));
      return from && to ? { from, to } : null;
    },
  };
}
