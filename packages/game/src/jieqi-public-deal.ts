// The deal of a FINISHED jieqi game as everyone may know it.
//
// Rule (Brian, 2026-10-16): a piece captured face-down is known only to the
// player who captured it, in every byte sent anywhere, during the game and after
// it; a piece never turned face-up stays unknown to everyone after the game. So
// a finished game is never replayed for a reader from its real deal. Every
// surface that shows or grades it (the review API, the watch replay, exports,
// analysis) replays this deal instead: the identity of every piece that moved
// (each was revealed to both seats the moment it moved), and nothing else.
//
// Every other home square becomes `undetermined`, exactly like an imported
// game's never-dealt piece, so every view shows it as unknown. The kernel still
// needs a whole deal, so those squares hold placeholders: what the standard set
// has left once the known roles are taken, assigned in home-square order. The
// placeholders are a function of the known roles alone, so two deals that
// differ only in hidden identities give the SAME public deal, byte for byte,
// and so does everything built from it.
//
// What this cannot hide: when a side's only never-revealed pieces were all
// captured face-down, the set minus its revealed roles names them as a
// multiset. That follows from the rules and the public move list, not from
// anything we send.

import {
  type JieqiColor,
  type JieqiDeal,
  type JieqiMove,
  type JieqiPieceRole,
  type JieqiSquare,
  jieqiHomeSquares,
  STANDARD_JIEQI_DEAL,
} from './variants-jieqi.js';

const COLORS: readonly JieqiColor[] = ['red', 'black'];

/** The home squares whose piece moved at some point in `moves` (so its identity
 *  was revealed to both seats). A piece is named by the square it started on. */
export function jieqiMovedOrigins(moves: readonly JieqiMove[]): Set<JieqiSquare> {
  const homes = new Set<JieqiSquare>([...jieqiHomeSquares('red'), ...jieqiHomeSquares('black')]);
  const originAt = new Map<JieqiSquare, JieqiSquare>();
  for (const square of homes) originAt.set(square, square);
  const moved = new Set<JieqiSquare>();
  for (const move of moves) {
    const origin = originAt.get(move.from);
    originAt.delete(move.to);
    if (!origin) continue; // a general, or a malformed log: nothing to reveal
    moved.add(origin);
    originAt.delete(move.from);
    originAt.set(move.to, origin);
  }
  return moved;
}

/** `deal` reduced to what a reader who saw no dark capture knows after `moves`. */
export function jieqiPublicDeal(deal: JieqiDeal, moves: readonly JieqiMove[]): JieqiDeal {
  const moved = jieqiMovedOrigins(moves);
  const out: JieqiDeal = { red: [], black: [] };
  const undetermined: Record<JieqiColor, JieqiSquare[]> = { red: [], black: [] };
  for (const color of COLORS) {
    const squares = jieqiHomeSquares(color);
    const wasUndetermined = new Set(deal.undetermined?.[color] ?? []);
    const roles = squares.map((square, index): JieqiPieceRole | null =>
      moved.has(square) && !wasUndetermined.has(square) ? (deal[color][index] ?? null) : null,
    );
    const left = [...STANDARD_JIEQI_DEAL[color]];
    for (const role of roles) {
      if (!role) continue;
      const index = left.indexOf(role);
      if (index >= 0) left.splice(index, 1);
    }
    out[color] = roles.map((role, index) => {
      if (role) return role;
      undetermined[color].push(squares[index]!);
      return left.shift()!;
    });
  }
  if (undetermined.red.length + undetermined.black.length > 0) out.undetermined = undetermined;
  return out;
}
