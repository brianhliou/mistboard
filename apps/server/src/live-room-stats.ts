// Shared one-pass scan over every live room, feeding the presence surfaces
// (/api/players/online, /api/live-stats, /api/relations/online-following).
//
// "online" counts distinct humans connected, not distinct sockets. A signed-in
// user spanning several tabs/rooms/devices shares one userId, so collapse on
// that; anonymous connections fall back to the per-room client id (already
// shared across tabs of the same room via localStorage). The u:/c: prefixes
// keep the two id spaces from colliding. Engines never enter room.clients, so
// they don't inflate this.

import { isGameInPlay } from './deploy-gate.js';
import type { HttpApiContext } from './routes/lib.js';
import { registeredVariantTenants } from './variant-tenant/registry.js';

export interface LiveRoomStats {
  // Games genuinely in play, per the shared isGameInPlay predicate — NOT the
  // size of playingRoomIds below. A room stays `status: 'playing'` while paused
  // and while abandoned (the reapers cannot claim every abandoned room; see
  // variant-tenant/reaper-coverage.test.ts), so counting raw status advertised
  // dead rooms on the landing page: prod showed "7 games in play" against 0
  // players online and nothing featurable on TV.
  playing: number;
  // Per game spec id: rooms counted in `playing` above that also hold at least
  // one connected human in a seat (not a spectator). The homepage's "N playing"
  // per variant reads it, so an engine-vs-engine room (bakeoff, ladder runs)
  // that nobody sits in does not advertise a variant as busy. Zero entries are
  // absent. Legacy rooms key on the projection's variant id, which is the game
  // spec id ('dark-chess'); tenant rooms on the tenant's gameSpecId.
  playingBySpec: Record<string, number>;
  // Room ids of every room whose status is 'playing', INCLUDING the paused and
  // abandoned ones excluded from `playing` above. This is a dedupe key, not a
  // count: callers fold in durable sources (e.g. active correspondence games)
  // and must not re-add a room that is already represented here.
  playingRoomIds: Set<string>;
  onlineIdentities: Set<string>;
  playingUserIds: Set<string>;
  anonymousOnline: number;
}

// One pass over every live room (legacy dark-chess map + all variant-tenant
// maps) collecting the connection facts the presence surfaces need.
export function collectLiveRoomStats(
  ctx: HttpApiContext,
  nowMs: number = Date.now(),
): LiveRoomStats {
  const onlineIdentities = new Set<string>();
  const playingUserIds = new Set<string>();
  const playingRoomIds = new Set<string>();
  const playingBySpec: Record<string, number> = {};
  let playing = 0;
  const countSpec = (specId: string) => {
    playingBySpec[specId] = (playingBySpec[specId] ?? 0) + 1;
  };
  for (const [roomId, room] of ctx.rooms.entries()) {
    const roomPlaying = room.projection.state.status.type === 'playing';
    // EvE (engine-vs-engine) counts as a game in play: this is an activity
    // count, not a "humans playing now" count. playingUserIds below still
    // tracks only seated humans, for presence.
    let inPlay = false;
    if (roomPlaying) {
      playingRoomIds.add(roomId);
      inPlay = isGameInPlay(room, nowMs);
      if (inPlay) playing += 1;
    }
    let seatedHuman = false;
    for (const client of room.clients) {
      onlineIdentities.add(client.userId ? `u:${client.userId}` : `c:${client.id}`);
      if (client.seat !== 'spectator') seatedHuman = true;
      if (roomPlaying && client.userId && client.seat !== 'spectator') {
        playingUserIds.add(client.userId);
      }
    }
    if (inPlay && seatedHuman) countSpec(room.projection.variant);
  }
  for (const tenant of registeredVariantTenants()) {
    for (const [roomId, room] of tenant.rooms.entries()) {
      const roomPlaying = room.projection?.state.status.type === 'playing';
      let inPlay = false;
      if (roomPlaying) {
        playingRoomIds.add(roomId);
        inPlay = isGameInPlay(room as Parameters<typeof isGameInPlay>[0], nowMs);
        if (inPlay) playing += 1;
      }
      let seatedHuman = false;
      for (const client of room.clients) {
        if (client.seat && client.seat !== 'spectator') seatedHuman = true;
        if (client.userId) {
          onlineIdentities.add(`u:${client.userId}`);
          if (roomPlaying && client.seat && client.seat !== 'spectator') {
            playingUserIds.add(client.userId);
          }
        } else if (client.id) {
          onlineIdentities.add(`c:${client.id}`);
        }
      }
      if (inPlay && seatedHuman) countSpec(tenant.gameSpecId);
    }
  }
  let anonymousOnline = 0;
  for (const identity of onlineIdentities) {
    if (identity.startsWith('c:')) anonymousOnline += 1;
  }
  return {
    playing,
    playingBySpec,
    playingRoomIds,
    onlineIdentities,
    playingUserIds,
    anonymousOnline,
  };
}
