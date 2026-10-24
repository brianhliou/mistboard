// Xiangqi-family notation glue for the tenant exporters (standard xiangqi, fog
// xiangqi, jieqi all move {from, to} on the 9x10 board).
//
// Honesty rule: WXF is a RELATIVE notation, so every label depends on the
// position before the move. writeXiangqiPgn and formatXiangqiMoves both replay
// the line under STANDARD rules to derive that position, and a move those rules
// reject (fog xiangqi lets a player walk into check or capture the general
// outright) leaves the replay stuck, after which every later label is written
// against a stale board without any error. So WXF is offered only when the whole
// line replays; otherwise the export falls back to ICCS coordinates, which read
// nothing from the position. Fog xiangqi never asks for WXF.

import {
  applyXiangqiRecordMove,
  createInitialXiangqiState,
  formatXiangqiMoves,
  isStandardXiangqiLegalMove,
  writeXiangqiPgn,
  type XiangqiMove,
  type XiangqiNotationStyle,
  type XiangqiPgnNode,
  xiangqiMoveToPikafishUci,
} from '@mistboard/game';
import type { TenantExportGame } from './variant-tenant/registry.js';

// ICCS: the 0-indexed-rank UCI dialect Pikafish speaks and the PGN reader
// accepts ('h2e2' for our h3-e3). This is the real "uci" of a xiangqi move.
export function xiangqiExportUci(move: XiangqiMove): string {
  return xiangqiMoveToPikafishUci(move);
}

// True when the whole line is legal under standard xiangqi rules from the
// opening position, so position-relative notation can be trusted for every ply.
export function standardXiangqiLineReplays(moves: readonly XiangqiMove[]): boolean {
  let state = createInitialXiangqiState('export-replay');
  for (const move of moves) {
    if (state.status.type !== 'playing' || !isStandardXiangqiLegalMove(state, move)) return false;
    state = applyXiangqiRecordMove(state, move);
  }
  return true;
}

// WXF labels for the JSON `san` field, or null for every ply when the line does
// not replay (a coordinate pair is not a notation, so it is not offered as one).
export function xiangqiWxfLabels(moves: readonly XiangqiMove[]): readonly (string | null)[] {
  if (!standardXiangqiLineReplays(moves)) return moves.map(() => null);
  return formatXiangqiMoves(moves, 'wxf');
}

// The PGN movetext style a line can honestly carry.
export function xiangqiPgnStyle(moves: readonly XiangqiMove[]): XiangqiNotationStyle {
  return standardXiangqiLineReplays(moves) ? 'wxf' : 'iccs';
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

// Bind a move list to the shared PGN writer. The writer owns the tag block
// order (Red/Black, never White/Black) and escaping; the caller supplies the
// tag values.
export function xiangqiPgnWriter(
  moves: readonly XiangqiMove[],
  style: XiangqiNotationStyle,
): NonNullable<TenantExportGame['writePgn']> {
  const children = pgnMainline(moves);
  return (tags, result) => writeXiangqiPgn({ tags: { ...tags }, result, children }, { style });
}
