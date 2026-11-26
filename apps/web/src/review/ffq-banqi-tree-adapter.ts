// Recorded masked lines use server snapshots. A branch off them replays only
// moves whose outcome the masked board already shows; study branches replay
// their explicit public outcomes. Neither has a sampled deal or identity overlay.
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
  isFFQBanqiLegalMove,
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

/** The public replay state a masked observer frame describes. Its covered tiles
 * are occupancy alone, so nothing played from it can name a covered piece. */
function publicReplayState(frame: FFQBanqiReviewSnapshot): FFQBanqiReplayState {
  const { view } = frame;
  return {
    id: view.id,
    board: view.board.map((piece) => (piece ? { ...piece } : null)),
    status: view.status,
    ply: view.ply,
    moveNumber: view.moveNumber,
    hp: { ...view.hp },
    noProgressClock: view.noProgressClock,
    chaseCounts: { ...view.chaseCounts },
    captures: view.captured.map((capture) => ({ ...capture })),
    ...(view.lastMove ? { lastMove: { ...view.lastMove } } : {}),
  };
}

function snapshotOf(
  state: FFQBanqiReplayState,
  before: FFQBanqiReplayState,
): FFQBanqiReviewSnapshot {
  const capture = state.captures[before.captures.length];
  const damage = { red: 0, black: 0 };
  if (capture) damage[capture.owner] = FFQ_BANQI_DAMAGE[capture.role];
  return {
    ply: state.ply,
    view: getFFQBanqiPlayerView(state, 'observer'),
    fen: ffqBanqiStateToFen(state),
    damage,
  };
}

/** A move off the recorded line whose result the masked board already shows: a
 * face-up piece stepping to an empty square or taking a face-up piece. A flip
 * or a capture of a covered tile would draw from the hidden pool, so it has no
 * outcome here and is refused, as are moves after the game ended. */
export function ffqBanqiPublicBranch(
  parent: FFQBanqiReviewSnapshot,
  move: BanqiMove,
): FFQBanqiReviewSnapshot | null {
  if (parent.view.status.type !== 'playing') return null;
  const from = ffqBanqiIndex(move.from);
  const to = ffqBanqiIndex(move.to);
  const state = publicReplayState(parent);
  const piece = state.board[from];
  const target = state.board[to];
  if (from === to || !piece || piece.faceDown || target?.faceDown) return null;
  if (!isFFQBanqiLegalMove(state, { from, to })) return null;
  return snapshotOf(applyFFQBanqiReplayMove(state, { from, to }), state);
}

export function makeFFQBanqiTreeAdapter(
  snapshots: readonly FFQBanqiReviewSnapshot[],
  moves: readonly BanqiMove[],
): VariantTreeAdapter<BanqiMove, FFQBanqiReviewSnapshot, FFQBanqiPlayerView> {
  const key = (move: BanqiMove) => `${move.from}${move.to}`;
  const recorded = new Set(snapshots);
  // Branch frames are made once per parent and move, so stepping back and forth
  // through a grafted line keeps one frame per node.
  const branches = new WeakMap<
    FFQBanqiReviewSnapshot,
    Map<string, FFQBanqiReviewSnapshot | null>
  >();
  const next = (parent: FFQBanqiReviewSnapshot, move: BanqiMove) => {
    if (recorded.has(parent)) {
      const expected = moves[parent.ply];
      const frame = snapshots[parent.ply + 1];
      if (expected && frame && key(expected) === key(move)) return frame;
    }
    let made = branches.get(parent);
    if (!made) {
      made = new Map();
      branches.set(parent, made);
    }
    if (!made.has(key(move))) made.set(key(move), ffqBanqiPublicBranch(parent, move));
    return made.get(key(move)) ?? null;
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
      if (!frame) throw new Error('Move outside the public replay');
      return frame;
    },
    project: (frame) => [{ key: 'truth', label: 'Board', tier: 'primary', view: frame.view }],
    moveLabel: (move, parent) => {
      const frame = next(parent, move);
      if (!frame) throw new Error('Move outside the public replay');
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
      // The recorded continuation, or a move whose outcome is public; an engine
      // line never opens a flip or a covered capture off the record.
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
    const snapshot = snapshotOf(state, before);
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
