// In-memory "who is online" tracker behind /api/players/online.
//
// Fed from currentAccountUser (the single choke point every authed HTTP
// request and both WebSocket upgrade paths resolve through), so an entry
// carries the identity fields the endpoint needs and no DB round trip happens
// at read time. Entries age out after PRESENCE_TTL_MS; live room connections
// are re-touched by the endpoint (see routes/meta.ts) so a player mid-game
// with an open socket but no HTTP traffic stays listed.
//
// Deliberately process-local: presence is a soft signal, losing it on restart
// is fine (the next authed request repopulates it).

import type { PlayerTitle } from './persistence-titles.js';

export type PresenceVisibility = 'public' | 'unlisted' | 'private';

export type PresenceEntry = {
  userId: string;
  handle: string;
  displayName: string;
  // Verified player title (088), null for everyone else. Carried so the online
  // rails can badge a titled player without a second lookup per row.
  title: PlayerTitle | null;
  profileVisibility: PresenceVisibility;
  lastSeenMs: number;
};

export const PRESENCE_TTL_MS = 5 * 60 * 1000;

// An explicit polling heartbeat, independent of general HTTP/socket presence.
// A closed or suspended tab stops being invite-reachable within fifteen seconds.
export const LIVE_INVITE_LEASE_MS = 15_000;
const MAX_INVITE_LEASES = 10_000;
const inviteLeases = new Map<string, number>();

export function heartbeatLiveInvites(userId: string, nowMs = Date.now()): boolean {
  for (const [id, expiresAt] of inviteLeases) {
    if (expiresAt <= nowMs) inviteLeases.delete(id);
  }
  if (!inviteLeases.has(userId) && inviteLeases.size >= MAX_INVITE_LEASES) return false;
  inviteLeases.set(userId, nowMs + LIVE_INVITE_LEASE_MS);
  return true;
}

export function liveInviteReachable(userId: string, nowMs = Date.now()): boolean {
  const expiresAt = inviteLeases.get(userId) ?? 0;
  if (expiresAt <= nowMs) {
    inviteLeases.delete(userId);
    return false;
  }
  return true;
}

export function leaveLiveInvites(userId: string): void {
  inviteLeases.delete(userId);
}

// Sweep threshold: prune-on-read handles steady state; this bounds the map if
// many distinct users touch between reads.
const PRUNE_SIZE_THRESHOLD = 2000;

const entries = new Map<string, PresenceEntry>();

export function touchPresence(
  user: {
    id: string;
    handle: string;
    displayName: string;
    title?: PlayerTitle | null;
    profileVisibility: PresenceVisibility;
  },
  nowMs: number = Date.now(),
): void {
  entries.set(user.id, {
    userId: user.id,
    handle: user.handle,
    displayName: user.displayName,
    title: user.title ?? null,
    profileVisibility: user.profileVisibility,
    lastSeenMs: nowMs,
  });
  if (entries.size > PRUNE_SIZE_THRESHOLD) pruneExpired(nowMs);
}

// Bump lastSeen for a user already known to presence (identity fields were
// captured when their session resolved). Used for open-socket holders; a miss
// is ignored because a connected account must have resolved a session at
// upgrade time, so misses only happen for entries dropped by TTL after a very
// long silent game plus a restartless eviction, and the next touch restores it.
export function refreshPresence(userId: string, nowMs: number = Date.now()): void {
  const entry = entries.get(userId);
  if (entry) entry.lastSeenMs = nowMs;
}

export function onlinePresence(nowMs: number = Date.now()): PresenceEntry[] {
  pruneExpired(nowMs);
  return [...entries.values()];
}

export function clearPresence(): void {
  entries.clear();
  inviteLeases.clear();
}

function pruneExpired(nowMs: number): void {
  for (const [userId, entry] of entries) {
    if (nowMs - entry.lastSeenMs > PRESENCE_TTL_MS) entries.delete(userId);
  }
}
