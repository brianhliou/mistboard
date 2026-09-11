// The remaining face-down pool of a hidden-deal variant, derived from a MASKED
// player view and nothing else: start multiset minus what is revealed on the
// board minus what has been captured. This is the figure a flip-variant player
// actually reasons with ("what can that tile still be?"), and it is public by
// construction in banqi and flip jungle (a face-down tile can never be captured,
// so every capture is of a piece both seats already saw). The engine FEN
// writers emit the same multiset as their pool field, but they compute it from
// the truth board; this module is the one that may run on a client.
//
// Jieqi is the asymmetric case. A dark piece CAN be captured, and only the
// capturer learns its role, so the former owner's own pool still contains the
// captured piece (they cannot subtract what they never saw). That is reported
// as `unknownCaptured`: of the `total` pieces listed, that many are already off
// the board, identity unknown to this viewer. The opponent's pool, as seen by
// the capturer, is always exact.

import {
  BANQI_PIECE_COUNTS,
  type BanqiCapturedView,
  type BanqiColor,
  type BanqiPieceRole,
  type BanqiPlayerBoard,
} from './variants-banqi.js';
import {
  type JieqiCapturedView,
  type JieqiColor,
  type JieqiPieceRole,
  type JieqiPlayerBoard,
  STANDARD_JIEQI_DEAL,
} from './variants-jieqi.js';
import { JUNGLE_RANK, type JunglePieceRole } from './variants-jungle.js';
import type {
  JungleFlipCapture,
  JungleFlipColor,
  JungleFlipPlayerBoard,
} from './variants-jungle-flip.js';

export type HiddenPoolEntry<Role extends string> = { role: Role; count: number };

export type HiddenPoolSide<Role extends string> = {
  /** Roles still unaccounted for by this viewer, canonical order, count > 0 only. */
  entries: HiddenPoolEntry<Role>[];
  /** Sum of the entry counts. */
  total: number;
  /**
   * Pieces of this ink captured while face-down whose identity this viewer never
   * learned. They are still inside `entries` (the viewer cannot subtract them),
   * so `total - unknownCaptured` is the number still face-down on the board.
   * Always 0 for banqi and flip jungle.
   */
  unknownCaptured: number;
};

export type HiddenPool<Color extends string, Role extends string> = Record<
  Color,
  HiddenPoolSide<Role>
>;

const INKS = ['red', 'black'] as const;
type Ink = (typeof INKS)[number];

/** Strongest first: the order a player scans a pool in. */
export const BANQI_POOL_ROLE_ORDER: readonly BanqiPieceRole[] = [
  'general',
  'advisor',
  'elephant',
  'chariot',
  'horse',
  'cannon',
  'soldier',
];

export const JIEQI_POOL_ROLE_ORDER: readonly JieqiPieceRole[] = [
  'chariot',
  'cannon',
  'horse',
  'elephant',
  'advisor',
  'soldier',
];

export const JUNGLE_FLIP_POOL_ROLE_ORDER: readonly JunglePieceRole[] = (
  Object.keys(JUNGLE_RANK) as JunglePieceRole[]
).sort((a, b) => JUNGLE_RANK[b] - JUNGLE_RANK[a]);

// Jieqi's per-side dark multiset is whatever the standard deal holds (15 pieces,
// no general); read it from the deal so this never drifts from the kernel.
const JIEQI_START: Record<JieqiPieceRole, number> = (() => {
  const counts = {} as Record<JieqiPieceRole, number>;
  for (const role of JIEQI_POOL_ROLE_ORDER) counts[role] = 0;
  for (const role of STANDARD_JIEQI_DEAL.red) counts[role] = (counts[role] ?? 0) + 1;
  return counts;
})();

const JUNGLE_FLIP_START: Record<JunglePieceRole, number> = (() => {
  const counts = {} as Record<JunglePieceRole, number>;
  for (const role of JUNGLE_FLIP_POOL_ROLE_ORDER) counts[role] = 1;
  return counts;
})();

type Seen<Role extends string> = { color: Ink; role: Role | null };

// Start − seen, per ink. A null role is a piece known to be gone but not which:
// it stays in the multiset and is tallied as unknownCaptured. Counts never go
// below zero: a view that disagrees with the start multiset is a corrupt view,
// and a display helper should not throw mid-render over it.
function remainingPool<Role extends string>(
  roleOrder: readonly Role[],
  start: Readonly<Record<Role, number>>,
  seen: Iterable<Seen<Role>>,
): HiddenPool<Ink, Role> {
  const counts: Record<Ink, Map<Role, number>> = { red: new Map(), black: new Map() };
  const unknown: Record<Ink, number> = { red: 0, black: 0 };
  for (const ink of INKS) {
    for (const role of roleOrder) counts[ink].set(role, start[role] ?? 0);
  }
  for (const piece of seen) {
    if (piece.role === null) {
      unknown[piece.color] += 1;
      continue;
    }
    const bucket = counts[piece.color];
    if (!bucket.has(piece.role)) continue; // a role outside the pool (jieqi's general)
    bucket.set(piece.role, Math.max(0, (bucket.get(piece.role) ?? 0) - 1));
  }
  const side = (ink: Ink): HiddenPoolSide<Role> => {
    const entries: HiddenPoolEntry<Role>[] = [];
    let total = 0;
    for (const role of roleOrder) {
      const count = counts[ink].get(role) ?? 0;
      if (count > 0) {
        entries.push({ role, count });
        total += count;
      }
    }
    return { entries, total, unknownCaptured: unknown[ink] };
  };
  return { red: side('red'), black: side('black') };
}

function* revealedOnBoard<Role extends string>(
  board: Partial<Record<string, { faceDown: boolean; color?: Ink; role?: Role }>>,
): Generator<Seen<Role>> {
  for (const entry of Object.values(board)) {
    if (!entry || entry.faceDown || !entry.color || !entry.role) continue;
    yield { color: entry.color, role: entry.role };
  }
}

/** Banqi: symmetric and exact for both seats; `unknownCaptured` is always 0. */
export function banqiHiddenPool(view: {
  board: BanqiPlayerBoard;
  captured: readonly BanqiCapturedView[];
}): HiddenPool<BanqiColor, BanqiPieceRole> {
  const seen: Seen<BanqiPieceRole>[] = [...revealedOnBoard<BanqiPieceRole>(view.board)];
  for (const c of view.captured) seen.push({ color: c.owner, role: c.role });
  return remainingPool(BANQI_POOL_ROLE_ORDER, BANQI_PIECE_COUNTS, seen);
}

/** Flip jungle: symmetric and exact for both seats; `unknownCaptured` is always 0. */
export function jungleFlipHiddenPool(view: {
  board: JungleFlipPlayerBoard;
  captured: readonly JungleFlipCapture[];
}): HiddenPool<JungleFlipColor, JunglePieceRole> {
  const seen: Seen<JunglePieceRole>[] = [...revealedOnBoard<JunglePieceRole>(view.board)];
  for (const c of view.captured) seen.push({ color: c.owner, role: c.role });
  return remainingPool(JUNGLE_FLIP_POOL_ROLE_ORDER, JUNGLE_FLIP_START, seen);
}

/**
 * Jieqi: per-side pools as THIS viewer knows them. The general is never dark and
 * is excluded. A capture with `role: null` (the viewer's own dark piece, taken by
 * the opponent) stays in the owner's pool and counts toward `unknownCaptured`.
 */
export function jieqiHiddenPool(view: {
  board: JieqiPlayerBoard;
  captured: readonly JieqiCapturedView[];
}): HiddenPool<JieqiColor, JieqiPieceRole> {
  const seen: Seen<JieqiPieceRole>[] = [];
  for (const piece of revealedOnBoard<JieqiPieceRole>(view.board)) {
    if (piece.role !== 'general') seen.push(piece);
  }
  for (const c of view.captured) seen.push({ color: c.owner, role: c.role });
  return remainingPool(JIEQI_POOL_ROLE_ORDER, JIEQI_START, seen);
}
