// Atomic Xiangqi notation glue for the tenant exporter.
//
// Same honesty rule as xiangqi-game-export.ts: WXF is a RELATIVE notation, so
// every label depends on the position before the move, and the position is
// derived by replaying the line. Here the replay runs through the ATOMIC kernel
// (a capture removes the capturer, the target and the pieces beside it), so the
// board each label is written against is the board the game actually had; the
// standard replay diverges at the first capture and, being stuck, would spell
// every later ply against a stale board without an error. When the whole line
// does not replay (it always should for a persisted game), the export falls
// back to ICCS coordinates, which read nothing from the position.

import {
  type AtomicXiangqiGameState,
  applyAtomicXiangqiMove,
  createInitialAtomicXiangqiState,
  formatXiangqiMove,
  isAtomicXiangqiLegalMove,
  writeXiangqiPgn,
  type XiangqiGameState,
  type XiangqiMove,
  type XiangqiNotationStyle,
  type XiangqiPgnNode,
} from '@mistboard/game';
import type { TenantExportGame } from './variant-tenant/registry.js';

// The atomic state is the xiangqi state with the aftermath fields added; the
// notation formatter reads only the board and the turn.
function asXiangqiState(state: AtomicXiangqiGameState): XiangqiGameState {
  return state as unknown as XiangqiGameState;
}

// The per-ply positions of a line, or null when a move is not legal from the
// position the atomic kernel reached.
function replayAtomicXiangqiLine(moves: readonly XiangqiMove[]): AtomicXiangqiGameState[] | null {
  let state = createInitialAtomicXiangqiState('export-replay');
  const states: AtomicXiangqiGameState[] = [];
  for (const move of moves) {
    if (state.status.type !== 'playing' || !isAtomicXiangqiLegalMove(state, move)) return null;
    states.push(state);
    state = applyAtomicXiangqiMove(state, move);
  }
  return states;
}

export function atomicXiangqiLineReplays(moves: readonly XiangqiMove[]): boolean {
  return replayAtomicXiangqiLine(moves) !== null;
}

// WXF labels for the JSON `san` field, or null for every ply when the line does
// not replay (a coordinate pair is not a notation, so it is not offered as one).
export function atomicXiangqiWxfLabels(moves: readonly XiangqiMove[]): readonly (string | null)[] {
  const states = replayAtomicXiangqiLine(moves);
  if (!states) return moves.map(() => null);
  return moves.map((move, index) => formatXiangqiMove(asXiangqiState(states[index]!), move, 'wxf'));
}

// The PGN movetext style a line can honestly carry.
export function atomicXiangqiPgnStyle(moves: readonly XiangqiMove[]): XiangqiNotationStyle {
  return atomicXiangqiLineReplays(moves) ? 'wxf' : 'iccs';
}

// A flat mainline as the writer's node tree (no variations, no comments).
function pgnMainline(moves: readonly XiangqiMove[]): XiangqiPgnNode[] {
  const root: XiangqiPgnNode[] = [];
  let tail = root;
  for (const move of moves) {
    const node: XiangqiPgnNode = {
      move,
      token: `${move.from}-${move.to}`,
      nags: [],
      children: [],
    };
    tail.push(node);
    tail = node.children;
  }
  return root;
}

// Bind a move list to the shared PGN writer, replaying positions with the
// atomic kernel (its own start state: the same array, the kernel's shape).
export function atomicXiangqiPgnWriter(
  moves: readonly XiangqiMove[],
  style: XiangqiNotationStyle,
): NonNullable<TenantExportGame['writePgn']> {
  const children = pgnMainline(moves);
  const replay = {
    start: asXiangqiState(createInitialAtomicXiangqiState('pgn-export')),
    apply: (state: XiangqiGameState, move: XiangqiMove): XiangqiGameState =>
      asXiangqiState(applyAtomicXiangqiMove(state as unknown as AtomicXiangqiGameState, move)),
  };
  return (tags, result) =>
    writeXiangqiPgn({ tags: { ...tags }, result, children }, { style, replay });
}
