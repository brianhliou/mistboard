// Three Kingdoms banqi (#628) adapter for the shared GameTree spine, the study
// board's rules seam. The same hidden-deal model as banqi's adapter
// (banqi-tree-adapter.ts): the tree is rooted at a parsed dealt position
// (config.root, from the chapter's stored dealt FEN), so every face-down tile
// already holds the identity the deal placed there and branching is
// deterministic. A flip in any line turns up the same piece.
//
// The board is projected MASKED (getThreeKingdomsBanqiPlayerView): a face-down
// tile shows its back until a flip in THIS line reveals it. A flip is the
// self-move { from: X, to: X }, so from+to is a stable, reversible key ("e2e2").

import {
  ALL_THREE_KINGDOMS_BANQI_SQUARES,
  applyThreeKingdomsBanqiMove,
  type BanqiDeal,
  getThreeKingdomsBanqiPlayerView,
  isThreeKingdomsBanqiLegalMove,
  THREE_KINGDOMS_BANQI_SETUP_SQUARES,
  type ThreeKingdomsBanqiMove,
  type ThreeKingdomsBanqiPlayerView,
  type ThreeKingdomsBanqiSquare,
  type ThreeKingdomsBanqiState,
  threeKingdomsBanqiMoveLabel,
  threeKingdomsBanqiSeatToMove,
} from '@mistboard/game';
import type { ProjectedView, VariantTreeAdapter } from './game-tree.js';

const SQUARE_SET = new Set<string>(ALL_THREE_KINGDOMS_BANQI_SQUARES);

/** A finished game's deal, read off its ply-0 revealed board (the postgame's
 *  history.revealed[0]) in setup-square order, the order the room dealt it.
 *  Throws on a face-down or empty setup square rather than guess a tile, so a
 *  bad payload renders an error, never a wrong board. */
export function recoverThreeKingdomsBanqiDeal(revealed: ThreeKingdomsBanqiPlayerView): BanqiDeal {
  return THREE_KINGDOMS_BANQI_SETUP_SQUARES.map((square) => {
    const entry = revealed.board[square];
    if (!entry || entry.faceDown) {
      throw new Error(`three kingdoms banqi deal recovery: square ${square} is not revealed`);
    }
    return { color: entry.color, role: entry.role };
  });
}

function parseSquare(token: string): ThreeKingdomsBanqiSquare | null {
  return SQUARE_SET.has(token) ? (token as ThreeKingdomsBanqiSquare) : null;
}

/** A tree adapter over a parsed position. There is no recorded game to replay
 *  from, so initialTruth throws: a mount without config.root is a wiring bug,
 *  never a silently fresh deal. */
export function makeThreeKingdomsBanqiTreeAdapter(): VariantTreeAdapter<
  ThreeKingdomsBanqiMove,
  ThreeKingdomsBanqiState,
  ThreeKingdomsBanqiPlayerView
> {
  return {
    mode: 'perfect-info',
    initialTruth: () => {
      throw new Error('three kingdoms banqi tree adapter: no deal; mount with config.root');
    },
    isLegal: (truth, move) =>
      truth.status.type === 'playing' && isThreeKingdomsBanqiLegalMove(truth, move),
    applyMove: (truth, move) => applyThreeKingdomsBanqiMove(truth, move),
    project: (truth): ProjectedView<ThreeKingdomsBanqiPlayerView>[] => [
      {
        key: 'truth',
        label: 'Board',
        tier: 'primary',
        // Masked, and projected for the seat to move so its legal moves (the
        // flips included) populate whichever side the board is about to play.
        view: getThreeKingdomsBanqiPlayerView(truth, threeKingdomsBanqiSeatToMove(truth)),
      },
    ],
    // A flip names what it turned up: the parent's face-down tile already
    // holds its dealt identity. The label appears only once the flip is played.
    moveLabel: (move, parentTruth) =>
      threeKingdomsBanqiMoveLabel(move, parentTruth.board[move.from]),
    moveKey: (move) => `${move.from}${move.to}`,
    toEngineUci: (move) => `${move.from}${move.to}`,
    fromUci: (uci) => {
      if (uci.length !== 4) return null;
      const from = parseSquare(uci.slice(0, 2));
      const to = parseSquare(uci.slice(2, 4));
      return from && to ? { from, to } : null;
    },
  };
}
