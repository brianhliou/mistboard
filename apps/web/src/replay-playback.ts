import type { GameEvent } from '@mistboard/game';
import { FALLBACK_PLAY_MS } from './replay-wall-clock.js';

// Pure replay-pacing math, factored out of the mountReplay closure so the
// per-move autoplay delay can be reasoned about (and unit-tested) without a
// DOM mount. Mirrors replay-wall-clock.ts, which holds the wall-clock-loop
// half of the same timing problem. Nothing here touches the DOM or mutable
// replay state — every function is a pure projection over the event log.

const COMPUTE_SCALE = 50;
const LEGACY_RECORDED_TIME_SCALE = 0.12;
const MIN_RECORDED_DELTA_MS = 150;
const MIN_PLAY_MS = 700;
const MAX_PLAY_MS = 2500;
const MIN_THINKING_BUDGET_PLAY_MS = 700;

type MovePlayedEvent = Extract<GameEvent, { type: 'move-played' }>;
type MovePlayedExt = MovePlayedEvent & { compute_ms?: number; thinkTimeMs?: number };

/** The `ply`-th move-played event (1-indexed), or null if out of range. */
export function moveEventAtPly(events: GameEvent[], ply: number): GameEvent | null {
  if (ply < 1) return null;
  let seen = 0;
  for (const event of events) {
    if (event.type !== 'move-played') continue;
    seen += 1;
    if (seen === ply) return event;
  }
  return null;
}

/** Clamp a raw delay into the watchable [MIN_PLAY_MS, MAX_PLAY_MS] band. */
export function clampPlay(ms: number): number {
  return Math.min(MAX_PLAY_MS, Math.max(MIN_PLAY_MS, ms));
}

/**
 * The think duration recorded on a move (engine `thinkTimeMs`, else
 * `compute_ms`), or null when the move carries neither. Used to drive the
 * count-up clock animation, not the autoplay delay.
 */
export function thinkingDurationForPly(events: GameEvent[], ply: number): number | null {
  const event = moveEventAtPly(events, ply);
  if (event?.type !== 'move-played') return null;
  const ext = event as MovePlayedExt;
  if (typeof ext.thinkTimeMs === 'number' && ext.thinkTimeMs >= 0) {
    return ext.thinkTimeMs;
  }
  if (typeof ext.compute_ms === 'number' && ext.compute_ms >= 0) {
    return ext.compute_ms;
  }
  return null;
}

/**
 * Per-move autoplay delay for `ply`, in priority order:
 * recorded engine think time → recorded wall-clock delta (scaled) → compute
 * time (scaled) → fixed fallback. `budgetMs` is the resolved thinking budget
 * for the active game (null when none); when present the think-time path is
 * floored at MIN_THINKING_BUDGET_PLAY_MS so flat-budget games still animate.
 * `clampPace` bounds the raw think-time path into the watchable band.
 */
export function delayForPly(
  events: GameEvent[],
  ply: number,
  budgetMs: number | null,
  clampPace: boolean,
): number {
  const raw =
    thinkTimeDelayForPly(events, ply, budgetMs) ??
    recordedDelayForPly(events, ply) ??
    computeDelayForPly(events, ply) ??
    FALLBACK_PLAY_MS;
  return clampPace ? clampPlay(raw) : raw;
}

function thinkTimeDelayForPly(
  events: GameEvent[],
  ply: number,
  budgetMs: number | null,
): number | null {
  const event = moveEventAtPly(events, ply);
  if (event?.type !== 'move-played') return null;
  const ext = event as MovePlayedExt;
  if (typeof ext.thinkTimeMs !== 'number' || ext.thinkTimeMs < 0) return null;
  const thinkMs = Math.max(0, ext.thinkTimeMs);
  if (budgetMs !== null) {
    return Math.max(MIN_THINKING_BUDGET_PLAY_MS, thinkMs);
  }
  return thinkMs;
}

function recordedDelayForPly(events: GameEvent[], ply: number): number | null {
  const event = moveEventAtPly(events, ply);
  if (event?.type !== 'move-played') return null;
  const previousAt = ply > 1 ? moveEventAtPly(events, ply - 1)?.at : replayStartAt(events);
  if (typeof previousAt !== 'number') return null;

  const elapsed = event.at - previousAt;
  if (!Number.isFinite(elapsed) || elapsed < MIN_RECORDED_DELTA_MS) return null;
  return clampPlay(elapsed * LEGACY_RECORDED_TIME_SCALE);
}

function computeDelayForPly(events: GameEvent[], ply: number): number | null {
  const event = moveEventAtPly(events, ply);
  if (event?.type !== 'move-played') return null;
  const ext = event as MovePlayedExt;
  if (typeof ext.compute_ms === 'number' && ext.compute_ms >= 0) {
    return clampPlay(ext.compute_ms * COMPUTE_SCALE);
  }
  return null;
}

function replayStartAt(events: GameEvent[]): number | null {
  let startedAt: number | null = null;
  for (const event of events) {
    if (event.type === 'move-played') break;
    if (event.type === 'clock-started' || event.type === 'room-created') {
      startedAt = event.at;
    }
  }
  return startedAt;
}
