import { BANQI_SPEC_ID, JUNGLE_FLIP_SPEC_ID, THREE_KINGDOMS_BANQI_SPEC_ID } from '@mistboard/game';
import { banqiTenant } from './banqi-tenant.js';
import { FinishedGameCache } from './finished-game-cache.js';
import { jungleFlipTenant } from './jungle-flip-tenant.js';
import * as persistence from './persistence.js';
import type { PersistedRoomEvent } from './persistence-game-lifecycle.js';
import { threeKingdomsBanqiTenant } from './three-kingdoms-banqi-tenant.js';
import { isTenantEventLog, replayTenantEvents } from './variant-tenant/runtime.js';

// The flip variants (Banqi, Flip Jungle, Three Kingdoms Banqi) record their result by SEAT ('red-wins' =
// the first-mover seat won), but those seats are decoupled from piece ink, which
// binds on the opening flip and is NOT a stored column. List surfaces (the watch
// queue + its seat rows) need that bound ink to label results and paint player
// discs correctly, so we replay the event log to recover `firstColor`.
//
// firstColor is immutable once a game is finished, so cache it per room: the feed
// is polled, and a full replay on every poll would be wasteful. LRU + TTL
// (the FinishedGameCache pattern) keeps the cache bounded: room ids rotate
// forever, so a plain Map would grow monotonically with every room ever served.
// Correctness never depends on eviction (the value is immutable); an evicted or
// expired room just replays once more. Null (unreplayable log) is a valid cached
// value; the TTL retries it eventually.

export type FlipInkColor = 'red' | 'black';

const firstColorCache = new FinishedGameCache<FlipInkColor | null>(512);

// One replay per flip spec. Each entry closes over its own concrete tenant so
// isTenantEventLog narrows the untyped log to that tenant's event union — no casts,
// and a non-flip spec simply has no entry (its rows are skipped, never guessed at).
const FIRST_COLOR_BY_SPEC: Record<
  string,
  (roomId: string, events: readonly unknown[]) => FlipInkColor | null
> = {
  [BANQI_SPEC_ID]: (roomId, events) =>
    isTenantEventLog(banqiTenant, events, roomId)
      ? replayTenantEvents(banqiTenant, events).state.firstColor
      : null,
  [JUNGLE_FLIP_SPEC_ID]: (roomId, events) =>
    isTenantEventLog(jungleFlipTenant, events, roomId)
      ? replayTenantEvents(jungleFlipTenant, events).state.firstColor
      : null,
  [THREE_KINGDOMS_BANQI_SPEC_ID]: (roomId, events) =>
    isTenantEventLog(threeKingdomsBanqiTenant, events, roomId)
      ? replayTenantEvents(threeKingdomsBanqiTenant, events).state.firstColor
      : null,
};

/** True when the variant's seats are move-order slots whose ink binds on a flip. */
export function isFlipInkVariant(variant: string): boolean {
  return variant in FIRST_COLOR_BY_SPEC;
}

// Injectable so the derivation can be unit-tested without a database, mirroring
// the flip postgame routes.
export type FlipFirstColorDeps = {
  loadRoomEvents(roomId: string): Promise<readonly unknown[] | null>;
};

const defaultDeps: FlipFirstColorDeps = {
  loadRoomEvents: (roomId) => persistence.loadRoomEvents<PersistedRoomEvent>(roomId),
};

async function deriveFlipFirstColor(
  roomId: string,
  variant: string,
  deps: FlipFirstColorDeps,
): Promise<FlipInkColor | null> {
  const resolve = FIRST_COLOR_BY_SPEC[variant];
  if (!resolve) return null;
  const events = await deps.loadRoomEvents(roomId);
  if (!events) return null;
  return resolve(roomId, events);
}

export async function flipFirstColorForRoom(
  roomId: string,
  variant: string,
  deps: FlipFirstColorDeps = defaultDeps,
): Promise<FlipInkColor | null> {
  // `undefined` = miss; a cached null (unreplayable log) is a hit and short-circuits.
  const cached = firstColorCache.get(roomId);
  if (cached !== undefined) return cached;
  const firstColor = await deriveFlipFirstColor(roomId, variant, deps);
  firstColorCache.set(roomId, firstColor);
  return firstColor;
}

// Fill in `firstColor` for the flip-variant rows of a feed page, in place. Rows of
// any other variant (the common case) are skipped entirely — their seat IS their ink.
export async function attachFlipFirstColors(
  records: Array<{ roomId: string; variant: string; firstColor?: FlipInkColor | null }>,
  deps: FlipFirstColorDeps = defaultDeps,
): Promise<void> {
  await Promise.all(
    records
      .filter((record) => isFlipInkVariant(record.variant))
      .map(async (record) => {
        record.firstColor = await flipFirstColorForRoom(record.roomId, record.variant, deps);
      }),
  );
}
