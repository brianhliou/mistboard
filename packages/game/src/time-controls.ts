// Single source of truth for Mistboard time controls.
// Every time control the platform officially supports is defined here once;
// rating buckets, UI pickers, server allowlists, and analytics all derive
// from this list.

import type { RoomTimeControl } from './events.js';
import {
  DARK_CHESS_SPEC_ID,
  DARK_XIANGQI_SPEC_ID,
  DUCK_XIANGQI_SPEC_ID,
  type GameSpecId,
  JIEQI_SPEC_ID,
  XIANGQI_SPEC_ID,
} from './game-specs.js';

// The classes a rating bucket may hold, and the exact mirror of
// user_ratings.time_class CHECK (time_class IN ('bullet','blitz','rapid'))
// (migration 026). scripts/drift-check.mjs compares THIS union against that
// constraint, so the two cannot drift — keep it a plain literal union, since
// the checker reads quoted members and an Exclude<> would hand it the excluded
// value instead.
//
// TimeControlSpec.timeClass uses this rather than TimeClass, which makes a
// rated classical pace a COMPILE error in bucketForGame rather than a runtime
// CHECK violation: whoever adds one has to add the migration with it.
export type RatedTimeClass = 'bullet' | 'blitz' | 'rapid';

// Every class the pace classifier can produce. Wider than the column, because
// timeClassForPace labels arbitrary paces and nothing stops someone asking it
// about 30+0; no preset is classical, so nothing classical can reach the DB.
export type TimeClass = RatedTimeClass | 'classical';

export type TimeControlId = '1m1' | '3m2' | '5m5' | '10m5';

export type TimeControlSpec = {
  id: TimeControlId;
  label: string;
  initialMs: number;
  incrementMs: number;
  timeClass: RatedTimeClass;
  // Whether a game at this pace can be rated. Mirrors the `rated` flag on
  // GameSpec: one source of truth, so the server allowlist and the web time
  // picker derive rather than each hand-maintaining a list (they drifted
  // apart while rated was 3+2-only). A new pace ships casual-only until this
  // is deliberately set.
  rated: boolean;
};

export const TIME_CONTROLS: readonly TimeControlSpec[] = [
  {
    id: '1m1',
    label: '1 + 1',
    initialMs: 60_000,
    incrementMs: 1_000,
    timeClass: 'bullet',
    rated: true,
  },
  {
    id: '3m2',
    label: '3 + 2',
    initialMs: 180_000,
    incrementMs: 2_000,
    timeClass: 'blitz',
    rated: true,
  },
  {
    id: '5m5',
    label: '5 + 5',
    initialMs: 300_000,
    incrementMs: 5_000,
    timeClass: 'rapid',
    rated: true,
  },
  {
    // The deliberate-variant rung. Measured 2026-09-01 over every finished PvE
    // game with a human seat: guests spend a median 17s/move in jieqi and 12s
    // in xiangqi, and a game that reaches a real result runs 30 (p75) to 42
    // (p90) human moves. 3+2 affords 8.0s/move at 30 moves and 5+5 affords
    // 15.0, so a guest on a full xiangqi board cannot finish one — they flagged
    // in 32% of jieqi and 36% of xiangqi games, against 0 of 159 for signed-in
    // players at the same pace. 10+5 affords 25.0s/move, the first rung clear
    // of the measured need. Casual-only for now: it shares the rapid bucket
    // with 5+5, so flipping `rated` later adds no rating pool.
    id: '10m5',
    label: '10 + 5',
    initialMs: 600_000,
    incrementMs: 5_000,
    timeClass: 'rapid',
    rated: false,
  },
];

// Rated eligibility for a live pace. Correspondence never qualifies: at
// days-per-move cadence engine assistance is unenforceable, and the
// perfect-information correspondence allowance (routes/correspondence-rooms.ts)
// rests on correspondence being casual by construction.
export function isRatedTimeControl(tc: RoomTimeControl): boolean {
  if (tc.daysPerMove !== undefined) return false;
  return findTimeControl(tc.initialMs, tc.incrementMs)?.rated === true;
}

export const RATED_TIME_CONTROLS: readonly TimeControlSpec[] = TIME_CONTROLS.filter(
  (tc) => tc.rated,
);

// Paces an engine cannot honor, pinned to the slowest one it can.
//
// Misty's per-move cost in fog has a floor of roughly 5s: belief enumeration
// runs before the search's time budget applies, so the clock does not govern
// it. A 1s or 2s increment cannot cover that, the bank drains a few seconds
// per move, and the engine loses on time in any long enough game — measured in
// prod game 14f0ca10 at 3+2, where Misty flagged while the guest still held
// 117s of 180. The fog engines are pinned to 5+5 until the floor is bounded
// (#283).
//
// PvE only, and per game spec: the floor belongs to the engine, not to the
// variant, so human games keep every pace their landing config offers, and
// bots with bounded per-move cost (Fairy-Stockfish, Pikafish, the banqi and
// jungle engines) are absent from this map and accept all of them.
//
// One source for both sides: the web picker narrows to this (landing-play.ts
// allowedTimePresetIds) and each create route rejects against it (routes/
// rooms.ts for fog chess, routes/dark-xiangqi-rooms.ts for fog xiangqi), so a
// hand-crafted POST cannot start a pace the picker refuses.
//
// A pin MUST be a pace the variant itself offers, or the picker narrows to an
// empty set while the create route rejects everything, which strands the
// surface. `variant-registry-sync.test.ts` holds that invariant.
const ENGINE_TIME_CONTROL_PINS: Readonly<Partial<Record<GameSpecId, TimeControlId>>> = {
  [DARK_CHESS_SPEC_ID]: '5m5',
  // Fog xiangqi (python-fdx) runs its own belief stack rather than the fog
  // chess time manager, so its floor is not separately measured; pinned on the
  // shared-mechanism argument while #283 is open, not on its own flag evidence.
  [DARK_XIANGQI_SPEC_ID]: '5m5',
};

/** Every spec carrying an engine pin. Exported so conformance tests can assert
 *  each pin is a pace its own variant offers. */
export const ENGINE_PINNED_GAME_SPEC_IDS: readonly GameSpecId[] = Object.keys(
  ENGINE_TIME_CONTROL_PINS,
) as GameSpecId[];

// The pace a variant PRESELECTS, for variants that want something other than
// the house 3+2. A preference, not a constraint: every pace the variant offers
// stays selectable, and a player's stored choice outranks this.
//
// Deliberate variants sit here because a full xiangqi board at 3+2 is a pace
// guests could not finish a game in. Measured 2026-09-01 across every finished
// PvE game with a human seat: guests flagged in 32% of jieqi and 36% of xiangqi
// games while signed-in players flagged 0 of 159 at the same pace, and the
// arithmetic agrees — guests spend 12-17s a move where 3+2 affords 8.0.
//
// Lives here rather than in the web tenant registry because BOTH sides need it:
// the picker preselects it (landing-play.ts), the Lobby/Quick-Pairing chip
// advertises it (landing-bot-policy.ts offerPace), and the server applies it
// when a bot-id create omits a time control (routes/rooms.ts). Those three
// disagreeing is how a chip advertises one clock and starts another.
//
// A default MUST be a pace the variant offers; variant-registry-sync.test.ts
// holds that against each tenant's timePresetIds.
const VARIANT_DEFAULT_TIME_CONTROLS: Readonly<Partial<Record<GameSpecId, TimeControlId>>> = {
  [XIANGQI_SPEC_ID]: '10m5',
  [JIEQI_SPEC_ID]: '10m5',
  // Duck offers 3+2, 5+5 and 10+5 (registry.ts). This entry is a PREFERENCE,
  // not a guard: a turn is a move plus a duck placement, so 3+2 buys 1.8s per
  // decision at the long end and 5+5 buys 3.8s. Both are playable, so 3+2 is
  // selectable, but the pace a first-time player is dropped into should be the
  // one that lets them see the board.
  //
  // It was a guard until 2026-09-12, when 3+2 was added to the picker: before
  // that, the house 3+2 would have been preselected and advertised on a
  // variant whose picker did not render it.
  [DUCK_XIANGQI_SPEC_ID]: '5m5',
};

/** The house pace, for every variant that does not name its own. */
export const DEFAULT_TIME_CONTROL_ID: TimeControlId = '3m2';

export const VARIANT_DEFAULT_GAME_SPEC_IDS: readonly GameSpecId[] = Object.keys(
  VARIANT_DEFAULT_TIME_CONTROLS,
) as GameSpecId[];

/**
 * The pace a new game on this spec should start at when nobody picked one.
 * Precedence is the caller's job: an explicit request wins, then the engine pin
 * (a hard constraint), then this.
 */
export function variantDefaultTimeControl(gameSpecId: GameSpecId | string): TimeControlSpec {
  const id = VARIANT_DEFAULT_TIME_CONTROLS[gameSpecId as GameSpecId] ?? DEFAULT_TIME_CONTROL_ID;
  const spec = TIME_CONTROLS.find((tc) => tc.id === id);
  if (!spec) throw new Error(`variant default ${id} is not a known time control`);
  return spec;
}

/**
 * The pace a PvE game on this spec starts at absent an explicit request: the
 * engine pin if the engine cannot honor anything else, otherwise the variant
 * default. One function so the web chip and the server create route cannot
 * drift into advertising one clock and starting another.
 */
export function defaultEngineTimeControl(gameSpecId: GameSpecId | string): TimeControlSpec {
  return engineTimeControlPin(gameSpecId as GameSpecId) ?? variantDefaultTimeControl(gameSpecId);
}

/** The pace an engine game for this spec is pinned to, or null when unpinned. */
export function engineTimeControlPin(gameSpecId: GameSpecId): TimeControlSpec | null {
  const pinned = ENGINE_TIME_CONTROL_PINS[gameSpecId];
  if (pinned === undefined) return null;
  return TIME_CONTROLS.find((tc) => tc.id === pinned) ?? null;
}

/**
 * Whether an engine game for this spec may run at this pace. Unpinned specs
 * accept anything (their own variant allowlist still applies); a pinned spec
 * accepts only its pin. Correspondence is out of scope — no engine plays it.
 */
export function isAllowedEngineTimeControl(gameSpecId: GameSpecId, tc: RoomTimeControl): boolean {
  const pin = engineTimeControlPin(gameSpecId);
  if (pin === null) return true;
  return tc.initialMs === pin.initialMs && tc.incrementMs === pin.incrementMs;
}

export function findTimeControl(
  initialMs: number | null | undefined,
  incrementMs: number | null | undefined,
): TimeControlSpec | null {
  if (initialMs == null || incrementMs == null) return null;
  return (
    TIME_CONTROLS.find((tc) => tc.initialMs === initialMs && tc.incrementMs === incrementMs) ?? null
  );
}

/** How long a game at this pace is assumed to last: 40 moves a side, the same
 *  estimate lichess uses (scalachess Clock.scala estimateTotalSeconds). */
export function estimatedTimeControlSeconds(initialMs: number, incrementMs: number): number {
  return Math.round((initialMs + 40 * incrementMs) / 1000);
}

/**
 * Speed class for ANY pace, official or not. Bands match lila's Speed.scala
 * (bullet <180s, blitz <480s, rapid <1500s, classical above) on the estimate
 * above — the same rule we already ran as an analytics-only fallback in
 * apps/web/src/analytics.ts while this function did an exact preset lookup, so
 * every existing pace keeps the class it had: 1+1 -> 100s bullet, 3+2 -> 260s
 * blitz, 5+5 -> 500s rapid. No stored game is reclassified by the switch.
 *
 * Total by design, so a pace off the preset table still gets a sensible LABEL.
 * It is deliberately NOT the rated gate: rating buckets resolve through
 * findTimeControl plus the spec's `rated` flag (apps/server/src/rating-buckets
 * .ts bucketForGame), so widening this cannot make an unofficial pace rated.
 * Any caller that means "is this pace one of ours" must keep using
 * findTimeControl, not this.
 */
export function timeClassForPace(initialMs: number, incrementMs: number): TimeClass {
  const estimated = estimatedTimeControlSeconds(initialMs, incrementMs);
  if (estimated < 180) return 'bullet';
  if (estimated < 480) return 'blitz';
  if (estimated < 1500) return 'rapid';
  return 'classical';
}

/** Nullable-tolerant wrapper: null in, null out (a game row with no clock). */
export function timeClassFromTimeControl(
  initialMs: number | null | undefined,
  incrementMs: number | null | undefined,
): TimeClass | null {
  if (initialMs == null || incrementMs == null) return null;
  return timeClassForPace(initialMs, incrementMs);
}

export function isOfficialTimeControl(tc: RoomTimeControl): boolean {
  // The live allowlist never admits a correspondence time control, even one
  // whose ms values happen to collide with a live spec.
  if (tc.daysPerMove !== undefined) return false;
  return findTimeControl(tc.initialMs, tc.incrementMs) !== null;
}

// Correspondence (days-per-move) time controls. Kept apart from
// TIME_CONTROLS: live specs feed rating buckets and the PvE allowlist, and
// correspondence is casual-only with no live-engine surface.
export const DAY_MS = 24 * 60 * 60 * 1000;
export const DAYS_PER_MOVE_OPTIONS = [1, 3, 7] as const;
export type DaysPerMove = (typeof DAYS_PER_MOVE_OPTIONS)[number];

export function correspondenceTimeControl(daysPerMove: DaysPerMove): RoomTimeControl {
  return { initialMs: daysPerMove * DAY_MS, incrementMs: 0, daysPerMove };
}

export function isOfficialCorrespondenceTimeControl(tc: RoomTimeControl): boolean {
  return (
    tc.daysPerMove !== undefined &&
    (DAYS_PER_MOVE_OPTIONS as readonly number[]).includes(tc.daysPerMove) &&
    tc.initialMs === tc.daysPerMove * DAY_MS &&
    tc.incrementMs === 0
  );
}
