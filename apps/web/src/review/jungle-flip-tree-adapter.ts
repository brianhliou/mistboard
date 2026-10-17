// Flip Jungle (jungle-flip) adapter for the shared GameTree spine. Structurally the
// banqi pattern on a 4×4 / 16 animals: a symmetric hidden deal, revealed by flip
// self-moves ({ from: X, to: X }). Post-game the deal is KNOWN — recovered from the
// fully-revealed history (history.revealed) and baked into the truth — so branching
// is deterministic and the adapter is a FACTORY over that deal. See
// banqi-tree-adapter.ts for the shared rationale; this is the same shape over the
// jungle-flip kernel. The board is projected MASKED (getJungleFlipPlayerView); a
// flip in a line reveals what the fixed deal placed there.

import {
  ALL_JUNGLE_FLIP_SQUARES,
  applyJungleFlipMove,
  createInitialJungleFlipState,
  getJungleFlipPlayerView,
  isJungleFlipLegalMove,
  type JungleFlipDeal,
  type JungleFlipGameState,
  type JungleFlipMove,
  type JungleFlipPlayerView,
  type JungleFlipSquare,
  jungleFlipMoveLabel,
  jungleFlipSquareFromIndex,
} from '@mistboard/game';
import type { ProjectedView, VariantTreeAdapter } from './game-tree.js';

const JUNGLE_FLIP_SQUARE_SET = new Set<string>(ALL_JUNGLE_FLIP_SQUARES);

function parseJungleFlipSquare(token: string): JungleFlipSquare | null {
  return JUNGLE_FLIP_SQUARE_SET.has(token) ? (token as JungleFlipSquare) : null;
}

/** Recover the fixed deal from a fully-revealed board — the earliest snapshot in
 *  the postgame `history.revealed` stream. Throws if a square is missing/masked so
 *  the caller degrades to an error rather than a wrong board (the earliest revealed
 *  snapshot is the pre-move deal and is complete). */
export function recoverJungleFlipDeal(revealed: JungleFlipPlayerView): JungleFlipDeal {
  return ALL_JUNGLE_FLIP_SQUARES.map((square, index) => {
    const entry = revealed.board[jungleFlipSquareFromIndex(index)];
    if (!entry || entry.faceDown) {
      throw new Error(`jungle-flip deal recovery: square ${square} is not revealed`);
    }
    return { color: entry.color, role: entry.role };
  });
}

export function makeJungleFlipTreeAdapter(
  gameId: string,
  // Null when the caller roots the tree at a parsed position (TreeReviewConfig
  // `root`), in which case initialTruth is never consulted; asking anyway is a
  // wiring bug, so it throws rather than minting a deal the URL does not carry.
  deal: JungleFlipDeal | null,
): VariantTreeAdapter<JungleFlipMove, JungleFlipGameState, JungleFlipPlayerView> {
  return {
    mode: 'perfect-info',
    initialTruth: () => {
      if (!deal) throw new Error('jungle-flip tree adapter: no deal; mount with config.root');
      return createInitialJungleFlipState(gameId, deal);
    },
    isLegal: (truth, move) => truth.status.type === 'playing' && isJungleFlipLegalMove(truth, move),
    applyMove: (truth, move) => applyJungleFlipMove(truth, move),
    project: (truth): ProjectedView<JungleFlipPlayerView>[] => [
      {
        key: 'truth',
        label: 'Board',
        tier: 'primary',
        // Masked as-played view, projected for the SIDE TO MOVE so legalMoves
        // (incl. flips) populate for the color the board is about to play.
        view: getJungleFlipPlayerView(
          truth,
          truth.status.type === 'playing' ? truth.status.turn : 'red',
        ),
      },
    ],
    // The site's one Flip Jungle label (flip-move-label.ts): "a1-b2" for a move, "a1(E)" for a
    // flip, named from the parent's truth, whose face-down tile already holds its dealt identity.
    moveLabel: (move, parentTruth) => jungleFlipMoveLabel(move, parentTruth.board[move.from]),
    moveKey: (move) => `${move.from}${move.to}`,
    toEngineUci: (move) => `${move.from}${move.to}`,
    fromUci: (uci) => {
      if (uci.length !== 4) return null;
      const from = parseJungleFlipSquare(uci.slice(0, 2));
      const to = parseJungleFlipSquare(uci.slice(2, 4));
      return from && to ? { from, to } : null;
    },
  };
}
