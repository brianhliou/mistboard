// Shared one-pass scan over every live room, feeding the presence surfaces
// (/api/players/online, /api/live-stats, /api/relations/online-following).
//
// "online" counts distinct humans connected, not distinct sockets. A signed-in
// user spanning several tabs/rooms/devices shares one userId, so collapse on
// that; anonymous connections fall back to the per-room client id (already
// shared across tabs of the same room via localStorage). The u:/c: prefixes
// keep the two id spaces from colliding. Engines never enter room.clients, so
// they don't inflate this.

import { isStaleLiveRoom } from './current-games.js';
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
  // A live room also drops out once its last move is older than its time
  // class's window (isStaleLiveRoom, the rule /games lists by), so the count
  // matches the page it links to. Before that, abandoned rapid games stayed in
  // the count for up to 10 minutes after /games had dropped them at 5.
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
  // Seated human -> the room a spectator can open to watch them (the friends
  // menu's Watch link). A user seated in several playing rooms gets one that
  // is genuinely in play over one that is paused or idle. A tenant room is
  // linked only while its tenant is enabled, so the link never lands on a
  // closed surface. The id only: what a spectator then sees is the room's own
  // public view (roomViewPolicy), so no game state rides on this map.
  playingRoomByUserId: Map<string, string>;
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
  const playingRoomByUserId = new Map<string, string>();
  // Users whose linked room above is genuinely in play; a later in-play room
  // never displaces one of these, and an idle one never displaces anything.
  const linkedInPlay = new Set<string>();
  const linkRoom = (userId: string, roomId: string, inPlay: boolean) => {
    if (linkedInPlay.has(userId)) return;
    if (inPlay) {
      playingRoomByUserId.set(userId, roomId);
      linkedInPlay.add(userId);
    } else if (!playingRoomByUserId.has(userId)) {
      playingRoomByUserId.set(userId, roomId);
    }
  };
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
      inPlay =
        isGameInPlay(room, nowMs) && !isStaleLiveRoom(room.timeControl, room.events ?? [], nowMs);
      if (inPlay) playing += 1;
    }
    let seatedHuman = false;
    for (const client of room.clients) {
      onlineIdentities.add(client.userId ? `u:${client.userId}` : `c:${client.id}`);
      if (client.seat !== 'spectator') seatedHuman = true;
      if (roomPlaying && client.userId && client.seat !== 'spectator') {
        playingUserIds.add(client.userId);
        linkRoom(client.userId, roomId, inPlay);
      }
    }
    if (inPlay && seatedHuman) countSpec(room.projection.variant);
  }
  for (const tenant of registeredVariantTenants()) {
    const linkable = tenant.enabled();
    for (const [roomId, room] of tenant.rooms.entries()) {
      const roomPlaying = room.projection?.state.status.type === 'playing';
      let inPlay = false;
      if (roomPlaying) {
        playingRoomIds.add(roomId);
        inPlay =
          isGameInPlay(room as Parameters<typeof isGameInPlay>[0], nowMs) &&
          !isStaleLiveRoom(room.projection?.timeControl, room.events ?? [], nowMs);
        if (inPlay) playing += 1;
      }
      let seatedHuman = false;
      for (const client of room.clients) {
        if (client.seat && client.seat !== 'spectator') seatedHuman = true;
        if (client.userId) {
          onlineIdentities.add(`u:${client.userId}`);
          if (roomPlaying && client.seat && client.seat !== 'spectator') {
            playingUserIds.add(client.userId);
            if (linkable) linkRoom(client.userId, roomId, inPlay);
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
    playingRoomByUserId,
    anonymousOnline,
  };
}
