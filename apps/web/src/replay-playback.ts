import type { GameEvent } from '@mistboard/game';
import { offsetsFromDurations } from './recorded-playback.js';
import { FALLBACK_PLAY_MS } from './replay-wall-clock.js';

// Pure replay-timing math, factored out of the mountReplay closure so the
// per-move playback time can be reasoned about (and unit-tested) without a DOM
// mount. Nothing here touches the DOM or mutable replay state: every function is
// a pure projection over the event log.
//
// TRUE TIMING (Brian, 2026-09-26: "always true timing, never faked"): each move
// plays for the time it really took. There is no clamp into a watchable band, no
// scale factor and no floor. The one fixed step left, FALLBACK_PLAY_MS, is for a
// move that carries no timing record at all, where there is nothing to be true to.

// Imported engine self-play logs stamp moves 1 ms apart; a gap below this is a
// sequence number, not a recorded think.
const MIN_RECORDED_DELTA_MS = 150;

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

/**
 * The think duration recorded on a move (engine `thinkTimeMs`, else
 * `compute_ms`), or null when the move carries neither. Caps the clockless
 * per-move budget countdown where the engine actually moved.
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
 * How long ply `ply` really took, which is how long playback shows the position
 * before it.
 *
 * A game on a real clock (`clocked`) uses the gap between the recorded move
 * timestamps (from the start for ply 1), because that gap is exactly what its
 * clock was charged: playback that long lets the mover's clock tick at one second
 * per second and land on the recorded value. A clockless game (engine self-play)
 * uses the engine's recorded think (`thinkTimeMs`), then a real timestamp gap,
 * then `compute_ms`; a move with none of them steps at FALLBACK_PLAY_MS.
 */
export function recordedDurationForPly(events: GameEvent[], ply: number, clocked: boolean): number {
  const event = moveEventAtPly(events, ply);
  if (event?.type !== 'move-played') return FALLBACK_PLAY_MS;
  const delta = recordedDeltaForPly(events, ply, event);
  if (clocked && delta !== null) return Math.max(0, delta);
  const ext = event as MovePlayedExt;
  if (typeof ext.thinkTimeMs === 'number' && ext.thinkTimeMs >= 0) return ext.thinkTimeMs;
  if (delta !== null && delta >= MIN_RECORDED_DELTA_MS) return delta;
  if (typeof ext.compute_ms === 'number' && ext.compute_ms >= 0) return ext.compute_ms;
  return FALLBACK_PLAY_MS;
}

/**
 * offsets[p] = ms after the game's start at which ply p is on the board, for the
 * wall-anchored player in recorded-playback.ts. Length is the move count + 1.
 */
export function recordedPlyOffsets(events: GameEvent[], clocked: boolean): number[] {
  const moveCount = events.filter((event) => event.type === 'move-played').length;
  const durations: number[] = [];
  for (let ply = 1; ply <= moveCount; ply += 1) {
    durations.push(recordedDurationForPly(events, ply, clocked));
  }
  return offsetsFromDurations(durations);
}

/** The wall timestamp the game's clock reads from before ply 1: the last room/clock start. */
export function replayStartAt(events: GameEvent[]): number | null {
  let startedAt: number | null = null;
  for (const event of events) {
    if (event.type === 'move-played') break;
    if (event.type === 'clock-started' || event.type === 'room-created') {
      startedAt = event.at;
    }
  }
  return startedAt;
}

function recordedDeltaForPly(
  events: GameEvent[],
  ply: number,
  event: MovePlayedEvent,
): number | null {
  const previousAt = ply > 1 ? moveEventAtPly(events, ply - 1)?.at : replayStartAt(events);
  if (typeof previousAt !== 'number') return null;
  const elapsed = event.at - previousAt;
  return Number.isFinite(elapsed) ? elapsed : null;
}
