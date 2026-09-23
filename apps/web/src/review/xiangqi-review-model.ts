// Pure (no-DOM) reconstruction of a standard-xiangqi game from a bare move list.
// This is the seam that lets the review board run off ANY move sequence — an
// imported game, a study line, a variation — instead of only a persisted room's
// server-sent per-ply snapshots. It mirrors exactly what the server does over a
// room's event history (apply move -> snapshot getStandardXiangqiPlayerView(
// state, 'red')), but drives it from moves the client already holds, so no
// round-trip is needed. Open information, so the perspective is always 'red'.

import {
  applyStandardXiangqiMove,
  createInitialXiangqiState,
  fsfUciToXiangqiSquares,
  getStandardXiangqiPlayerView,
  isStandardXiangqiLegalMove,
  type StandardXiangqiPlayerView,
  type XiangqiGameState,
  type XiangqiMove,
} from '@mistboard/game';
import { resumeAdjudicatedDraw } from './xiangqi-tree-adapter.js';

export interface XiangqiReplay {
  /** Per-ply truth views; index === ply. `views[0]` is the start position, so
   *  the length is `maxPly + 1`. */
  views: StandardXiangqiPlayerView[];
  /** Moves that were legally applied (shorter than the input if an illegal move
   *  stopped reconstruction). */
  moves: XiangqiMove[];
  /** Highest reachable ply (=== moves.length). */
  maxPly: number;
  /** Present when reconstruction stopped early: the 1-based ply and the move
   *  that was rejected as illegal from that position. */
  illegalAt?: { ply: number; move: XiangqiMove };
}

/** Replay a move list from the standard opening (or a hand-set `startState` — a
 *  FEN-seeded composition), snapshotting the truth view at every ply. Stops (and
 *  reports `illegalAt`) at the first illegal move rather than throwing, so a bad
 *  import degrades to "the legal prefix" instead of a crash. */
export function buildXiangqiReplayFromMoves(
  moves: readonly XiangqiMove[],
  startState?: XiangqiGameState,
  options: { record?: boolean } = {},
): XiangqiReplay {
  let state = startState ?? createInitialXiangqiState('analysis');
  const views: StandardXiangqiPlayerView[] = [getStandardXiangqiPlayerView(state, 'red')];
  const applied: XiangqiMove[] = [];
  for (let i = 0; i < moves.length; i++) {
    const move = moves[i]!;
    // A played record resumes past an arbiter-adjudicated draw; see
    // resumeAdjudicatedDraw.
    if (options.record) state = resumeAdjudicatedDraw(state);
    if (state.status.type !== 'playing' || !isStandardXiangqiLegalMove(state, move)) {
      return { views, moves: applied, maxPly: applied.length, illegalAt: { ply: i + 1, move } };
    }
    state = applyStandardXiangqiMove(state, move);
    applied.push(move);
    views.push(getStandardXiangqiPlayerView(state, 'red'));
  }
  return { views, moves: applied, maxPly: applied.length };
}

/** Clamp a ply into range and return its truth view (never null). */
export function xiangqiReplayViewAtPly(
  replay: XiangqiReplay,
  ply: number,
): StandardXiangqiPlayerView {
  const clamped = Math.max(0, Math.min(replay.maxPly, Math.trunc(ply)));
  return replay.views[clamped] ?? replay.views[replay.views.length - 1]!;
}

export interface ParsedXiangqiMoves {
  moves: XiangqiMove[];
  /** Set when a token could not be parsed; `moves` holds the prefix parsed so far. */
  error?: string;
}

const MOVE_NUMBER = /^\d+\.$/; // "1." "23." — PGN-style ordinals, skipped

/** Parse a whitespace/comma-separated coordinate move list into moves. Each move
 *  is two squares in our notation (= Fairy-Stockfish xiangqi UCI): `b3e3`, or
 *  with a readable dash `b3-e3`. Bare move-number ordinals ("1.") are skipped so
 *  a pasted numbered score works. Returns the parsed prefix plus an error on the
 *  first unparseable token; legality is NOT checked here (that is the replay's
 *  job — parsing only validates the coordinate shape). */
export function parseXiangqiCoordinateMoves(input: string): ParsedXiangqiMoves {
  const tokens = input
    .split(/[\s,]+/)
    .map((token) => token.trim())
    .filter(Boolean);
  const moves: XiangqiMove[] = [];
  for (const token of tokens) {
    if (MOVE_NUMBER.test(token)) continue;
    const squares = fsfUciToXiangqiSquares(token.replace(/-/g, ''));
    if (!squares) return { moves, error: `could not parse move: "${token}"` };
    moves.push({ from: squares.from, to: squares.to });
  }
  return { moves };
}
