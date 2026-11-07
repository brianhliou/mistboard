// A recorded, masked line. No sampled deal, hidden-identity overlay or local
// rules replay: a branch could only guess the identities under the backs.
import { type BanqiMove, banqiMoveLabelOnBoard, type FFQBanqiPlayerView } from '@mistboard/game';
import { ffqBanqiBoardView } from '../ffq-banqi-board.js';
import type { VariantTreeAdapter } from './game-tree.js';

export type FFQBanqiReviewSnapshot = {
  ply: number;
  view: FFQBanqiPlayerView;
  fen: string;
  damage: { red: number; black: number };
};

export function ffqBanqiReviewMoveLabel(move: BanqiMove, next: FFQBanqiReviewSnapshot): string {
  const label = banqiMoveLabelOnBoard(move, ffqBanqiBoardView(next.view).board);
  const damage = next.damage.red + next.damage.black;
  return damage ? `${label} · ${damage} damage` : label;
}

export function makeFFQBanqiTreeAdapter(
  snapshots: readonly FFQBanqiReviewSnapshot[],
  moves: readonly BanqiMove[],
): VariantTreeAdapter<BanqiMove, FFQBanqiReviewSnapshot, FFQBanqiPlayerView> {
  const key = (move: BanqiMove) => `${move.from}${move.to}`;
  const next = (parent: FFQBanqiReviewSnapshot, move: BanqiMove) => {
    const expected = moves[parent.ply];
    const frame = snapshots[parent.ply + 1];
    return expected && frame && key(expected) === key(move) ? frame : null;
  };
  const start = snapshots[0];
  if (
    start?.ply !== 0 ||
    snapshots.length !== moves.length + 1 ||
    snapshots.some((frame, ply) => frame.ply !== ply || frame.view.ply !== ply)
  ) {
    throw new Error('Incomplete masked replay');
  }
  return {
    mode: 'perfect-info',
    initialTruth: () => start,
    isLegal: (parent, move) => next(parent, move) !== null,
    applyMove: (parent, move) => {
      const frame = next(parent, move);
      if (!frame) throw new Error('Move outside recorded replay');
      return frame;
    },
    project: (frame) => [{ key: 'truth', label: 'Board', tier: 'primary', view: frame.view }],
    moveLabel: (move, parent) => {
      const frame = next(parent, move);
      if (!frame) throw new Error('Move outside recorded replay');
      return ffqBanqiReviewMoveLabel(move, frame);
    },
    moveKey: key,
    toEngineUci: key,
    fromUci: () => null,
  };
}
