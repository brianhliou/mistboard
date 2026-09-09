// Duck Xiangqi adapter for the shared GameTree spine. Duck Xiangqi is
// PERFECT-INFORMATION, so like the xiangqi/fortress/jungle adapters `project`
// returns a single truth view (length 1) and the client reconstructs every
// position from the move list.
//
// THE ONE THING THAT IS NOT LIKE THE OTHERS: A PLY IS A TWO-PART TURN.
//
// Everywhere else in this codebase a tree node's move is one {from, to}. Here it
// is {from, to, duckTo} - a xiangqi move AND a duck placement, always in that
// order (see the D-rules in packages/game/src/variants-duck-xiangqi.ts). That
// forces three decisions, and they are recorded here because this file is where
// they are actually true.
//
//   1. THE DUCK IS IN THE NODE KEY. `moveKey` is `from + to + '@' + duckTo`, so
//      two turns that move the same piece to the same point and put the duck in
//      different places are DIFFERENT NODES.
//
//      This is not a nicety. The duck is part of the position: it screens for
//      cannons, blocks the horse's leg and the elephant's eye, and breaks a
//      flying-general file, so every piece's move set depends on it - the
//      kernel's own repetition key counts a board with the duck elsewhere as a
//      different position. Keying on `from + to` alone would make createGameTree
//      MERGE the two into one node (addMove returns the existing child on a key
//      match), and the reader would click a variation and get a board with the
//      duck somewhere they never put it. A merge is silent, which is what makes
//      it the dangerous option.
//
//      The one turn with no duck half is the one that CAPTURES THE GENERAL: the
//      game ends on the capture, so the duck never moves and the kernel demands
//      `duckTo: null`. Its key is the bare `from + to`, with no '@'. That cannot
//      collide with a duck-carrying key, because a key with no '@' can only be
//      produced by a turn that ended the game and therefore has no siblings
//      worth distinguishing.
//
//   2. THE LABEL IS THE LIVE CLIENT'S. `e2-e5@c7`, and `e2xe5#` for a general
//      capture - the same two spellings `duckTurnLabel` writes in
//      live-duck-xiangqi.ts, so the move list in a review reads exactly like the
//      move list beside the live board. The label is deliberately NOT the key:
//      the key is dash-free (a UCI-shaped token) because the tree's NodeId ends
//      up in URLs and serialized studies.
//
//   3. `fromUci` TAKES BOTH SPELLINGS. A persisted study tree stores keys, but
//      the analysis board's `?moves=` param and its import box hand this the
//      DISPLAY labels (tree-review mirrors `lineLabels` into that box). So the
//      parser strips the cosmetic '-', 'x' and '#' first - none of which can be
//      a file letter (files are a-i) - and then reads `from`, `to`, and an
//      optional '@duck'. A token with no '@' parses to `duckTo: null`, which is
//      legal only for a general capture; anything else is rejected by `isLegal`
//      at the tree boundary rather than being guessed at here.
//
// There is no Duck Xiangqi engine, so `toEngineUci` returns the node key: the
// review's EnginePresentation is null (duck-xiangqi-review.ts), nothing consumes
// the string, and it stays identical to the key so the two can never disagree if
// an engine ever does arrive.

import {
  applyDuckXiangqiTurn,
  createInitialDuckXiangqiState,
  type DuckXiangqiGameState,
  type DuckXiangqiPlayerView,
  type DuckXiangqiSquare,
  type DuckXiangqiTurn,
  getDuckXiangqiPlayerView,
  isDuckXiangqiLegalTurn,
} from '@mistboard/game';
import type { ProjectedView, VariantTreeAdapter } from './game-tree.js';

/** Synthetic game id for a tree's own truth state (state identity only, no room). */
const DUCK_TREE_GAME_ID = 'analysis';

/** 'a1'..'i10'. Structural rather than an enumerated set: the square union has
 *  90 members and the rank can be two digits. */
function parseDuckSquare(token: string): DuckXiangqiSquare | null {
  return /^[a-i](?:[1-9]|10)$/.test(token) ? (token as DuckXiangqiSquare) : null;
}

/** Split a from+to token where each square is 'a1'..'i10'. The file letters are
 *  the only unambiguous split points: 'to' starts at the second [a-i]. */
function splitFromTo(token: string): [string, string] | null {
  const secondFile = token.slice(1).search(/[a-i]/);
  if (secondFile < 0) return null;
  const cut = secondFile + 1;
  return [token.slice(0, cut), token.slice(cut)];
}

/**
 * Move-list text for a turn: `e2-e5@c7`, or `e2xe5#` for the general capture
 * that ends the game before the duck would move.
 *
 * Kept in this module rather than imported from live-duck-xiangqi.ts on purpose:
 * that module is the live room's entry point and pulls the whole tenant client
 * in with it, which the review surface must not load. The two spellings are
 * asserted equal in duck-xiangqi-tree-adapter.test.ts.
 */
export function duckXiangqiTurnLabel(turn: DuckXiangqiTurn): string {
  return turn.duckTo === null
    ? `${turn.from}x${turn.to}#`
    : `${turn.from}-${turn.to}@${turn.duckTo}`;
}

/** The canonical node id / UCI-shaped token for a turn: `e2e5@c7`, or `e2e5`
 *  for a general capture. Dash-free, because this ends up in URLs and in a
 *  serialized study tree. */
export function duckXiangqiTurnKey(turn: DuckXiangqiTurn): string {
  return turn.duckTo === null ? `${turn.from}${turn.to}` : `${turn.from}${turn.to}@${turn.duckTo}`;
}

/**
 * The inverse of {@link duckXiangqiTurnKey}, tolerant of the display label.
 *
 * Returns a turn shape, not a LEGAL turn: legality (including "a null duck is
 * only allowed on a general capture") is the kernel's call, made by `isLegal` at
 * the tree boundary. Returning null here means the token is not a turn at all.
 */
export function parseDuckXiangqiTurnToken(token: string): DuckXiangqiTurn | null {
  // '-', 'x' and '#' are cosmetic and none of them can be a file letter.
  const cleaned = token.replace(/[-x#]/g, '');
  const at = cleaned.indexOf('@');
  const movePart = at < 0 ? cleaned : cleaned.slice(0, at);
  const duckPart = at < 0 ? null : cleaned.slice(at + 1);
  const parts = splitFromTo(movePart);
  if (!parts) return null;
  const from = parseDuckSquare(parts[0]);
  const to = parseDuckSquare(parts[1]);
  if (!from || !to) return null;
  if (duckPart === null) return { from, to, duckTo: null };
  const duckTo = parseDuckSquare(duckPart);
  return duckTo ? { from, to, duckTo } : null;
}

export const duckXiangqiTreeAdapter: VariantTreeAdapter<
  DuckXiangqiTurn,
  DuckXiangqiGameState,
  DuckXiangqiPlayerView
> = {
  mode: 'perfect-info',
  initialTruth: () => createInitialDuckXiangqiState(DUCK_TREE_GAME_ID),
  isLegal: (truth, turn) => truth.status.type === 'playing' && isDuckXiangqiLegalTurn(truth, turn),
  // applyDuckXiangqiTurn THROWS on an illegal turn (it does not return the state
  // unchanged the way the fortress kernel does). The tree only calls this after
  // isLegal, so the throw is unreachable by construction; leaving it unguarded is
  // deliberate, because swallowing it would turn a wiring bug into a wrong board.
  applyMove: (truth, turn) => applyDuckXiangqiTurn(truth, turn),
  project: (truth): ProjectedView<DuckXiangqiPlayerView>[] => [
    {
      key: 'truth',
      label: 'Board',
      tier: 'primary',
      // Open information -> project for the SIDE TO MOVE so the view's
      // legalPieceMoves are populated for the colour the interactive board is
      // about to play. (The kernel populates them for either perspective, but
      // asking as the mover keeps this identical to the other adapters.)
      view: getDuckXiangqiPlayerView(
        truth,
        truth.status.type === 'playing' ? truth.status.turn : 'red',
      ),
    },
  ],
  moveLabel: (turn) => duckXiangqiTurnLabel(turn),
  moveKey: (turn) => duckXiangqiTurnKey(turn),
  toEngineUci: (turn) => duckXiangqiTurnKey(turn),
  fromUci: (uci) => parseDuckXiangqiTurnToken(uci),
};
