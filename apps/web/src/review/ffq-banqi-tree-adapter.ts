// Recorded masked lines use server snapshots. Study branches replay only their
// explicit public outcomes, with no sampled deal or hidden-identity overlay.
import {
  applyFFQBanqiReplayMove,
  type BanqiMove,
  banqiMoveLabelOnBoard,
  createInitialFFQBanqiReplayState,
  FFQ_BANQI_DAMAGE,
  type FFQBanqiPlayerView,
  type FFQBanqiReplayIdentity,
  type FFQBanqiReplayMove,
  type FFQBanqiReplayState,
  ffqBanqiReplayMoveToUci,
  ffqBanqiStateToFen,
  getFFQBanqiPlayerView,
  parseFFQBanqiReplayMove,
} from '@mistboard/game';
import { ffqBanqiBoardView, ffqBanqiIndex, ffqBanqiSquare } from '../ffq-banqi-board.js';
import type { VariantTreeAdapter } from './game-tree.js';

export type FFQBanqiReviewSnapshot = {
  ply: number;
  view: FFQBanqiPlayerView;
  fen: string;
  damage: { red: number; black: number };
};

// The move alone: a capture's damage shows in the HP bars, not in the move list.
export function ffqBanqiReviewMoveLabel(move: BanqiMove, next: FFQBanqiReviewSnapshot): string {
  return banqiMoveLabelOnBoard(move, ffqBanqiBoardView(next.view).board);
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
    toEngineUci: (move) => {
      const square = (s: string) => {
        const n = ffqBanqiIndex(s);
        return `${String.fromCharCode(97 + (n % 4))}${Math.floor(n / 4)}`;
      };
      return square(move.from) + square(move.to);
    },
    fromUci: (uci, parent) => {
      if (!/^[a-d][0-7][a-d][0-7]$/.test(uci)) return null;
      const square = (s: string) => ffqBanqiSquare(Number(s[1]) * 4 + s.charCodeAt(0) - 97);
      const move = { from: square(uci.slice(0, 2)), to: square(uci.slice(2)) };
      // Decode only recorded continuations; analysis never opens a hidden branch.
      return next(parent, move) ? move : null;
    },
  };
}

/** Study branches replay only the outcomes explicitly recorded on that branch.
 * Every snapshot contains anonymous backs, with no sampled or recovered deal. */
export function makeFFQBanqiStudyTreeAdapter(
  opening: readonly FFQBanqiReplayIdentity[],
): VariantTreeAdapter<BanqiMove, FFQBanqiReviewSnapshot, FFQBanqiPlayerView> {
  const states = new WeakMap<FFQBanqiReviewSnapshot, FFQBanqiReplayState>();
  const observations = new WeakMap<BanqiMove, FFQBanqiReplayMove>();
  const frame = (state: FFQBanqiReplayState, before = state): FFQBanqiReviewSnapshot => {
    const capture = state.captures[before.captures.length];
    const damage = { red: 0, black: 0 };
    if (capture) damage[capture.owner] = FFQ_BANQI_DAMAGE[capture.role];
    const snapshot = {
      ply: state.ply,
      view: getFFQBanqiPlayerView(state, 'observer'),
      fen: ffqBanqiStateToFen(state),
      damage,
    };
    states.set(snapshot, state);
    return snapshot;
  };
  const start = frame(createInitialFFQBanqiReplayState('study', opening));
  const next = (parent: FFQBanqiReviewSnapshot, move: BanqiMove) => {
    const state = states.get(parent),
      observation = observations.get(move);
    if (!state || !observation) throw new Error('Move outside observed study replay');
    return frame(applyFFQBanqiReplayMove(state, observation), state);
  };
  const token = (move: BanqiMove) => ffqBanqiReplayMoveToUci(observations.get(move)!);
  return {
    mode: 'perfect-info',
    initialTruth: () => start,
    isLegal: (parent, move) => {
      try {
        next(parent, move);
        return true;
      } catch {
        return false;
      }
    },
    applyMove: next,
    project: (snapshot) => [{ key: 'truth', label: 'Board', tier: 'primary', view: snapshot.view }],
    moveLabel: (move, parent) => ffqBanqiReviewMoveLabel(move, next(parent, move)),
    moveKey: token,
    toEngineUci: token,
    fromUci: (uci) => {
      const observed = parseFFQBanqiReplayMove(uci);
      if (!observed) return null;
      const move = { from: ffqBanqiSquare(observed.from), to: ffqBanqiSquare(observed.to) };
      observations.set(move, observed);
      return move;
    },
  };
}
