// Three Kingdoms banqi (#628) score copy, shared by the live room
// (live-three-kingdoms-banqi.ts) and the study board
// (review/three-kingdoms-banqi-review.ts) so the two never word it apart.
//
// A seat's points sit beside its name ("45 pts"), the race target is said once
// ("First to 100 points"), and the no-progress counter stays out of sight until
// it is close to deciding the game: from 30 quiet moves on, one line says how
// many are left before the game goes to points.

import {
  THREE_KINGDOMS_BANQI_NO_PROGRESS_LIMIT,
  THREE_KINGDOMS_BANQI_SCORE_TARGET,
} from '@mistboard/game';
import { t } from './i18n/catalog.js';

/** The quiet-move count from which the moves-left line shows. */
export const TK_MOVES_LEFT_FROM = 30;

/** One seat's points, compact for the seat tag: "45 pts". */
export function tkPoints(points: number): string {
  return t('live.tk.points', { count: points });
}

/** The race target, said once per room: "First to 100 points". */
export function tkScoreTarget(): string {
  return t('live.tk.firstTo', { count: THREE_KINGDOMS_BANQI_SCORE_TARGET });
}

/**
 * "N moves left before the game is decided on points", or null while the
 * no-progress counter is under TK_MOVES_LEFT_FROM (or already at the limit,
 * when the game is over and the result line says why).
 */
export function tkMovesLeftLine(noProgressClock: number): string | null {
  if (noProgressClock < TK_MOVES_LEFT_FROM) return null;
  const left = THREE_KINGDOMS_BANQI_NO_PROGRESS_LIMIT - noProgressClock;
  if (left <= 0) return null;
  return left === 1 ? t('live.tk.oneMoveLeft') : t('live.tk.movesLeft', { count: left });
}
