// Skip stored tenant games that no longer replay (variant-tenant/replay-guard.ts).
//
// Every surface that lists or picks finished games (the homepage TV pool,
// /watch, recent games, profile history, share cards) reads summary rows, which
// never replay; the game behind a row is replayed only when someone opens it.
// A game whose variant's rules changed under it would therefore be listed and
// then fail to load. These helpers check the row first: one batched event load
// for the rows not yet verified, the registration's own replay (`replays`),
// and a per-process cache either way, so a finished game is replayed for this
// purpose at most once. Rows with no tenant registration (the chess stack) or
// no `replays` binding pass through unless already known to fail.

import * as persistence from './persistence.js';
import {
  type VariantTenantRegistration,
  variantTenantForRoomId,
} from './variant-tenant/registry.js';
import { isKnownReplayableGame, isKnownUnreplayableGame } from './variant-tenant/replay-guard.js';

export type ReplayableGameDeps = {
  registrationForRoomId: (roomId: string) => Pick<VariantTenantRegistration, 'replays'> | null;
  loadRoomsEvents: (roomIds: readonly string[]) => Promise<ReadonlyMap<string, readonly unknown[]>>;
};

const liveDeps: ReplayableGameDeps = {
  registrationForRoomId: variantTenantForRoomId,
  loadRoomsEvents: (roomIds) => persistence.loadRoomsEvents(roomIds),
};

/** The rows whose games still replay, in their original order. */
export async function filterReplayableGames<T extends { roomId: string }>(
  rows: readonly T[],
  deps: ReplayableGameDeps = liveDeps,
): Promise<T[]> {
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
  return rows.filter((row) => !failed.has(row.roomId) && !isKnownUnreplayableGame(row.roomId));
}

/** One game: false when its stored log is known, or now found, not to replay. */
export async function isReplayableGame(
  roomId: string,
  deps: ReplayableGameDeps = liveDeps,
): Promise<boolean> {
  return (await filterReplayableGames([{ roomId }], deps)).length === 1;
}
