/*
 * TypeScript port of native/chase.cpp and native/repetition.cpp from
 * https://github.com/devinokeefe/jieqi
 * Commit: 331a6e612a038c4a04cf980f7b9482910fd50078
 *
 * MIT License
 *
 * Copyright (c) 2026 Devin O'Keefe
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

import type {
  JieqiBoard,
  JieqiColor,
  JieqiMove,
  JieqiPlayerBoard,
  JieqiSquare,
} from './variants-jieqi.js';
import {
  coordOf,
  createInitialXiangqiBoard,
  squareOf,
  type XiangqiPieceRole,
} from './variants-xiangqi.js';

type Piece = { color: JieqiColor; role: XiangqiPieceRole };
type Board = Array<Piece | undefined>;
export type JieqiChasePosition = {
  board: JieqiPlayerBoard;
  ids: Partial<Record<JieqiSquare, JieqiSquare>>;
};
const HOME = createInitialXiangqiBoard();
const index = (square: JieqiSquare): number => {
  const { file, rank } = coordOf(square);
  return (rank - 1) * 9 + file;
};
const point = (s: number): JieqiSquare => squareOf(s % 9, Math.floor(s / 9) + 1);
const x = (s: number): number => s % 9;
const y = (s: number): number => Math.floor(s / 9);
const major = (role: XiangqiPieceRole): boolean => ['chariot', 'horse', 'cannon'].includes(role);

/** Mask before retaining history: no hidden role, capture pool or deal enters chase. */
export function createJieqiChasePosition(
  board: JieqiBoard | JieqiPlayerBoard,
  prior?: JieqiChasePosition,
  move?: JieqiMove,
): JieqiChasePosition {
  const masked: JieqiPlayerBoard = {};
  const ids: JieqiChasePosition['ids'] = prior ? { ...prior.ids } : {};
  for (const [sq, piece] of Object.entries(board)) {
    if (!piece) continue;
    const square = sq as JieqiSquare;
    masked[square] = piece.faceDown
      ? { color: piece.color, faceDown: true }
      : { color: piece.color, role: piece.role, faceDown: false };
    if (!prior) ids[square] = square;
  }
  if (prior) {
    if (!move || !prior.ids[move.from]) throw new Error('missing jieqi chase physical identity');
    ids[move.to] = prior.ids[move.from];
    delete ids[move.from];
  }
  return { board: masked, ids };
}

function publicTypes(input: JieqiBoard | JieqiPlayerBoard): Board {
  const board: Board = Array(90).fill(undefined);
  for (const [sq, piece] of Object.entries(input)) {
    if (!piece) continue;
    const square = sq as JieqiSquare;
    // Deliberately discard darkness for hypothetical geometry, as jqe does.
    // Dark advisors/elephants get positional types without ordinary confinement.
    const role = piece.faceDown ? HOME[square]?.role : piece.role;
    if (!role || (piece.faceDown && (HOME[square]?.color !== piece.color || role === 'general')))
      throw new Error('invalid jieqi chase dark point');
    board[index(square)] = { color: piece.color, role };
  }
  return board;
}

function intervening(board: Board, from: number, to: number): number {
  if (from === to || (x(from) !== x(to) && y(from) !== y(to))) return -1;
  const step = Math.sign(x(to) - x(from)) + 9 * Math.sign(y(to) - y(from));
  let count = 0;
  for (let s = from + step; s !== to; s += step) if (board[s]) count++;
  return count;
}

function geometry(board: Board, from: number, to: number): boolean {
  const p = board[from];
  if (!p || from === to) return false;
  const dx = x(to) - x(from),
    dy = y(to) - y(from);
  const ax = Math.abs(dx),
    ay = Math.abs(dy);
  switch (p.role) {
    case 'general':
      return (
        ax + ay === 1 && x(to) >= 3 && x(to) <= 5 && (p.color === 'red' ? y(to) <= 2 : y(to) >= 7)
      );
    case 'chariot':
      return intervening(board, from, to) === 0;
    case 'cannon':
      return intervening(board, from, to) === (board[to] ? 1 : 0);
    case 'horse':
      return (
        ((ax === 2 && ay === 1) || (ax === 1 && ay === 2)) &&
        !board[from + (ax === 2 ? Math.sign(dx) : 9 * Math.sign(dy))]
      );
    case 'elephant':
      return ax === 2 && ay === 2 && !board[from + dx / 2 + 9 * (dy / 2)];
    case 'advisor':
      return ax === 1 && ay === 1;
    case 'soldier':
      return (
        (dx === 0 && dy === (p.color === 'red' ? 1 : -1)) ||
        (dy === 0 && ax === 1 && (p.color === 'red' ? y(from) >= 5 : y(from) <= 4))
      );
  }
}
function kingSquare(board: Board, color: JieqiColor): number {
  const square = board.findIndex((p) => p?.color === color && p.role === 'general');
  if (square < 0) throw new Error('jieqi chase general missing');
  return square;
}
function relocate(board: Board, from: number, to: number): Board {
  const next = [...board];
  next[to] = next[from];
  next[from] = undefined;
  return next;
}
function attacked(board: Board, color: JieqiColor): boolean {
  const king = kingSquare(board, color);
  return board.some(
    (p, s) =>
      p &&
      p.color !== color &&
      (p.role === 'general' ? intervening(board, s, king) === 0 : geometry(board, s, king)),
  );
}
function safeCapture(board: Board, from: number, to: number): boolean {
  const p = board[from],
    victim = board[to];
  return (
    !!p &&
    !!victim &&
    victim.role !== 'general' &&
    p.color !== victim.color &&
    geometry(board, from, to) &&
    !attacked(relocate(board, from, to), p.color)
  );
}
function pins(board: Board, actor: JieqiColor): { blocked: Set<number>; pinning: Set<number> } {
  const king = kingSquare(board, actor);
  const paths = new Map<number, Set<number>>(),
    omitted = new Set<number>();
  for (let s = 0; s < 90; s++) {
    const p = board[s];
    if (!p || p.color === actor) continue;
    const dx = x(king) - x(s),
      dy = y(king) - y(s);
    const ax = Math.abs(dx),
      ay = Math.abs(dy);
    const path = new Set<number>();
    if (['chariot', 'cannon', 'general'].includes(p.role) && (dx === 0 || dy === 0)) {
      const step = Math.sign(dx) + 9 * Math.sign(dy);
      for (let q = s + step; q !== king; q += step) path.add(q);
    } else if (p.role === 'horse' && ((ax === 2 && ay === 1) || (ax === 1 && ay === 2))) {
      path.add(s + (ax === 2 ? Math.sign(dx) : 9 * Math.sign(dy)));
    } else if (p.role === 'elephant' && ax === 2 && ay === 2) {
      path.add(s + dx / 2 + 9 * (dy / 2));
    } else continue;
    paths.set(s, path);
    if (p.role !== 'cannon') omitted.add(s);
  }
  const blocked = new Set<number>(),
    pinning = new Set<number>();
  for (const [s, path] of paths) {
    const cannon = board[s]!.role === 'cannon';
    const screens = [...path].filter((q) => board[q] && (cannon || !omitted.has(q)));
    if (screens.length === (cannon ? 2 : 1)) {
      for (const q of screens) blocked.add(q);
      if (screens.some((q) => board[q]!.color === actor)) pinning.add(s);
    }
  }
  return { blocked, pinning };
}

/** jqe qualifying hypothetical captures, indexed by CURRENT point, not physical ID. */
export function jieqiChaseTargets(
  input: JieqiBoard | JieqiPlayerBoard,
  actor: JieqiColor,
): Set<JieqiSquare> {
  if (actor !== 'red' && actor !== 'black') throw new Error('invalid jieqi chase actor');
  const board = publicTypes(input);
  const { blocked, pinning } = pins(board, actor);
  const result = new Set<JieqiSquare>();
  for (let target = 0; target < 90; target++) {
    const victim = board[target];
    if (!victim || victim.role === 'general' || victim.color === actor) continue;
    for (let attacker = 0; attacker < 90; attacker++) {
      const p = board[attacker];
      if (!p || p.color !== actor || p.role === 'general' || p.role === 'soldier') continue;
      if (blocked.has(attacker)) {
        if (!pinning.has(target)) continue;
      } else if (
        victim.role === 'soldier' &&
        (victim.color === 'red' ? y(target) <= 4 : y(target) >= 5)
      )
        continue;
      if (!safeCapture(board, attacker, target)) continue;
      const protectedException =
        ((p.role === 'horse' || p.role === 'cannon') && victim.role === 'chariot') ||
        ((p.role === 'advisor' || p.role === 'elephant') && major(victim.role));
      if (!protectedException) {
        const captured = relocate(board, attacker, target);
        if (
          captured.some(
            (defender, s) => defender?.color === victim.color && safeCapture(captured, s, target),
          )
        )
          continue;
        if (p.role === victim.role && safeCapture(board, target, attacker)) continue;
      }
      result.add(point(target));
      break;
    }
  }
  return result;
}

export type JieqiChasePly = { mover?: JieqiColor; gaveCheck?: boolean; chase?: JieqiChasePosition };
/** New threats concern a physical piece; renewing an existing threat does not count. */
export function jieqiNewChaseTargets(
  before: JieqiChasePosition,
  after: JieqiChasePosition,
  actor: JieqiColor,
): Set<JieqiSquare> {
  const ids = (position: JieqiChasePosition): Set<JieqiSquare> =>
    new Set(
      [...jieqiChaseTargets(position.board, actor)].map((sq) => {
        const id = position.ids[sq];
        if (!id) throw new Error('missing jieqi chase target identity');
        return id;
      }),
    );
  const old = ids(before);
  return new Set([...ids(after)].filter((id) => !old.has(id)));
}

/** Reduce complete interval evidence (jqe with_chase_evidence), validating ownership. */
export function jieqiChaseResponsibility(
  interval: readonly JieqiChasePly[],
  supplied?: readonly ReadonlySet<JieqiSquare>[],
): JieqiColor | null {
  if (interval.slice(1).some((entry) => entry.gaveCheck))
    throw new Error('chase evidence requires an unchecked repetition interval');
  if (interval.length < 2 || (supplied && supplied.length !== interval.length - 1))
    throw new Error('chase evidence must cover the complete repeated interval');
  const common: Partial<Record<JieqiColor, Set<JieqiSquare>>> = {};
  for (let i = 1; i < interval.length; i++) {
    const before = interval[i - 1]!.chase,
      after = interval[i]!.chase,
      actor = interval[i]!.mover;
    if (!before || !after || !actor) throw new Error('missing jieqi chase history');
    const targets = supplied?.[i - 1] ?? jieqiNewChaseTargets(before, after, actor);
    const allowed = new Set(
      Object.entries(after.board).flatMap(([sq, p]) =>
        p && p.color !== actor && (p.faceDown || p.role !== 'general')
          ? [after.ids[sq as JieqiSquare]]
          : [],
      ),
    );
    if ([...targets].some((id) => !allowed.has(id)))
      throw new Error('chase evidence contains absent, friendly or general IDs');
    const prior = common[actor];
    common[actor] = prior ? new Set([...prior].filter((id) => targets.has(id))) : new Set(targets);
  }
  const red = !!common.red?.size,
    black = !!common.black?.size;
  return red === black ? null : red ? 'red' : 'black';
}
