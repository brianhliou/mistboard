// Skip, or mark, stored tenant games that no longer replay
// (variant-tenant/replay-guard.ts).
//
// Every surface that lists or picks finished games (the homepage TV pool,
// /watch, recent games, profile history, share cards) reads summary rows, which
// never replay; the game behind a row is replayed only when someone opens it.
// A game whose variant's rules changed under it would therefore be listed and
// then fail to load. These helpers check the row first: one batched event load
// for the rows not yet verified, the registration's own replay (`replays`),
// and a per-process cache either way, so a finished game is replayed for this
// purpose at most once. Rows with no tenant registration (the chess stack) or
// no `replays` binding pass through unless already known to fail. Discovery
// surfaces drop such a game (filterReplayableGames); a person's own lists keep
// it, marked, so their history stays whole (markUnavailableGames).

import { crosstableReviewUrl } from './crosstable.js';
import * as persistence from './persistence.js';
import type { GameUnavailableReason } from './persistence-games.js';
import {
  type VariantTenantRegistration,
  variantTenantForRoomId,
} from './variant-tenant/registry.js';
import { isKnownReplayableGame, isKnownUnreplayableGame } from './variant-tenant/replay-guard.js';

export type { GameUnavailableReason };

export type ReplayableGameDeps = {
  registrationForRoomId: (roomId: string) => Pick<VariantTenantRegistration, 'replays'> | null;
  loadRoomsEvents: (roomIds: readonly string[]) => Promise<ReadonlyMap<string, readonly unknown[]>>;
  // Where a finished game of this room and variant opens, or null when no page
  // mounts it (a variant with no postgame route, a deleted variant). Derived
  // from the tenant registry, never a hand-kept list. Defaults to
  // crosstableReviewUrl, whose answers the web registry is held to by
  // apps/web/src/variant-registry-sync.test.ts.
  gamePageUrl?: (roomId: string, variant: string) => string | null;
};

const liveDeps: ReplayableGameDeps = {
  registrationForRoomId: variantTenantForRoomId,
  loadRoomsEvents: (roomIds) => persistence.loadRoomsEvents(roomIds),
  gamePageUrl: (roomId, variant) => crosstableReviewUrl(roomId, variant),
};

/** The rows whose games still replay, in their original order. */
export async function filterReplayableGames<T extends { roomId: string }>(
  rows: readonly T[],
  deps: ReplayableGameDeps = liveDeps,
): Promise<T[]> {
  const failed = await unreplayableRoomIds(rows, deps);
  return rows.filter((row) => !failed.has(row.roomId));
}

/**
 * Every row, in order, with `unavailable` set on the ones that cannot be
 * opened: 'unsupported-variant' when no page mounts the variant's games,
 * else 'old-rules' when the stored log no longer replays. For the lists that
 * belong to a person (their profile, their favorites, a bot's record), where a
 * game that silently vanished would misstate their history; the discovery
 * surfaces keep filterReplayableGames.
 */
export async function markUnavailableGames<T extends { roomId: string; variant: string }>(
  rows: readonly T[],
  deps: ReplayableGameDeps = liveDeps,
): Promise<Array<T & { unavailable?: GameUnavailableReason }>> {
  const gamePageUrl = deps.gamePageUrl ?? liveDeps.gamePageUrl!;
  const unsupported = new Set(
    rows.filter((row) => gamePageUrl(row.roomId, row.variant) === null).map((row) => row.roomId),
  );
  const oldRules = await unreplayableRoomIds(
    rows.filter((row) => !unsupported.has(row.roomId)),
    deps,
  );
  return rows.map((row) => {
    if (unsupported.has(row.roomId)) return { ...row, unavailable: 'unsupported-variant' };
    if (oldRules.has(row.roomId)) return { ...row, unavailable: 'old-rules' };
    return row;
  });
}

// The room ids among `rows` whose stored log is known, or now found, not to
// replay under the current rules.
async function unreplayableRoomIds(
  rows: readonly { roomId: string }[],
  deps: ReplayableGameDeps,
): Promise<Set<string>> {
  const unchecked = new Map<string, NonNullable<VariantTenantRegistration['replays']>>();
  for (const row of rows) {
    if (isKnownUnreplayableGame(row.roomId) || isKnownReplayableGame(row.roomId)) continue;
    const replays = deps.registrationForRoomId(row.roomId)?.replays;
    if (replays) unchecked.set(row.roomId, replays);
  }
  const failed = new Set<string>();
  if (unchecked.size > 0) {
    let eventsByRoom: ReadonlyMap<string, readonly unknown[]>;
    try {
      eventsByRoom = await deps.loadRoomsEvents([...unchecked.keys()]);
    } catch {
      // A failed load proves nothing about the games: list them as before, and
      // the next request checks again.
      eventsByRoom = new Map();
    }
    for (const [roomId, replays] of unchecked) {
      const events = eventsByRoom.get(roomId);
      if (events && !replays(events, roomId)) failed.add(roomId);
    }
  }
  for (const row of rows) {
    if (isKnownUnreplayableGame(row.roomId)) failed.add(row.roomId);
  }
  return failed;
}

/** One game: false when its stored log is known, or now found, not to replay. */
export async function isReplayableGame(
  roomId: string,
  deps: ReplayableGameDeps = liveDeps,
): Promise<boolean> {
  return (await filterReplayableGames([{ roomId }], deps)).length === 1;
}
