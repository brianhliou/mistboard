/**
 * The replay boundary's failure mode: a stored event log that no longer
 * replays under the current rules.
 *
 * A tenant game is its event log, re-applied through the tenant's rules on
 * every read. When a variant's rules change (Crazyhouse Xiangqi's start and
 * drop rules, 2026-10-02), a game played under the old rules can hold a move
 * the new rules call illegal, and the replay throws. Before this guard that
 * throw reached the API's catch-all as a 500 and the homepage TV painted "This
 * game could not be loaded".
 *
 * The rule: such a game no longer exists as far as any surface is concerned.
 * replayTenantEvents wraps any throw in UnreplayableTenantGameError, which the
 * API catch-all answers as 404 not_found, and records the room id here (one
 * warn per id per process) so every surface that lists or picks games can drop
 * it (filterReplayableGames in replayable-games.ts). Rules are not version-
 * stamped: the game is skipped, never replayed under old rules.
 */

import { logger } from '../obs.js';

export class UnreplayableTenantGameError extends Error {
  readonly tenantKind: string;
  readonly roomId: string;

  constructor(tenantKind: string, roomId: string, cause: unknown) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    super(`${tenantKind} game ${roomId} does not replay: ${reason}`, { cause });
    this.name = 'UnreplayableTenantGameError';
    this.tenantKind = tenantKind;
    this.roomId = roomId;
  }
}

// Bounded: past the cap the oldest half is dropped (Set iterates in insertion
// order). A dropped bad id is re-found on its next replay and warns once more;
// a dropped good id is re-verified. Neither is wrong, only repeated work.
const MAX_TRACKED_IDS = 20_000;
const unreplayable = new Set<string>();
const replayable = new Set<string>();

function addBounded(set: Set<string>, roomId: string): void {
  if (set.size >= MAX_TRACKED_IDS) {
    let drop = Math.floor(MAX_TRACKED_IDS / 2);
    for (const id of set) {
      if (drop-- <= 0) break;
      set.delete(id);
    }
  }
  set.add(roomId);
}

/** Record a game whose log does not replay; warns once per room id. */
export function noteUnreplayableTenantGame(
  tenantKind: string,
  roomId: string,
  cause: unknown,
): void {
  replayable.delete(roomId);
  if (unreplayable.has(roomId)) return;
  addBounded(unreplayable, roomId);
  logger.warn(
    {
      kind: 'tenant_game_unreplayable',
      tenant: tenantKind,
      room_id: roomId,
      error: cause instanceof Error ? cause.message : String(cause),
    },
    `${tenantKind} game ${roomId} does not replay under the current rules; skipped everywhere`,
  );
}

export function isKnownUnreplayableGame(roomId: string): boolean {
  return unreplayable.has(roomId);
}

/** Cache a verified replay (a listed game is finished, so its log is final). */
export function noteReplayableTenantGame(roomId: string): void {
  if (unreplayable.has(roomId)) return;
  addBounded(replayable, roomId);
}

export function isKnownReplayableGame(roomId: string): boolean {
  return replayable.has(roomId);
}

/**
 * Run a replay of `roomId`'s log; any throw is recorded and rethrown as
 * UnreplayableTenantGameError. Without a room id (a log with no events) the
 * error passes through untouched.
 */
export function guardTenantReplay<T>(
  tenantKind: string,
  roomId: string | undefined,
  replay: () => T,
): T {
  try {
    return replay();
  } catch (err) {
    if (err instanceof UnreplayableTenantGameError || roomId === undefined) throw err;
    noteUnreplayableTenantGame(tenantKind, roomId, err);
    throw new UnreplayableTenantGameError(tenantKind, roomId, err);
  }
}

export function resetTenantReplayGuardForTests(): void {
  unreplayable.clear();
  replayable.clear();
}
