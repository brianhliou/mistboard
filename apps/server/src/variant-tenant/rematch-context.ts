/**
 * The rematch context every tenant gets by default (rematch.ts): the new room is
 * made by the tenant registration's own lobby factory, the same one a lobby
 * match uses, so each variant's room rules (a fresh deal for jieqi, banqi and
 * flip jungle, a fresh fog for Fog Xiangqi) apply without any rematch code of
 * its own. Built from the registry by room id, so nothing has to be forwarded
 * through each registration's attachWebSocket.
 *
 * Until 2026-10-14 this was jieqi's own context (jieqi-registration.ts), the
 * only tenant opted in; every other tenant's PvP finished room showed New
 * opponent and no Rematch.
 */

import { isRatedTimeControl, type RoomTimeControl } from '@mistboard/game';
import { ratedEnabled } from '../feature-flags.js';
import { logger } from '../obs.js';
import * as persistence from '../persistence.js';
import { persistenceRecordForTenantSeatToken } from './events.js';
import { variantTenantForRoomId } from './registry.js';
import type { TenantRematchClient, TenantRematchContext } from './rematch.js';
import { mintTenantSeatToken } from './seat-session.js';
import type { TenantGameStateLike, TenantRuntimeRoom } from './tenant.js';

/**
 * Whether a rated game may rematch rated: the room was rated and both seats are
 * accounts (rematch.ts checks those), and a new rated room would be granted
 * today: the rated switch, a lobby that offers rated, and a rated pace.
 */
export function rematchStaysRated(
  rated: boolean,
  lobbySupportsRated: boolean,
  timeControl: RoomTimeControl | undefined,
): boolean {
  return (
    rated &&
    lobbySupportsRated &&
    ratedEnabled() &&
    timeControl !== undefined &&
    isRatedTimeControl(timeControl)
  );
}

export function registeredTenantRematchContext<
  Kind extends string,
  C extends string,
  M,
  State extends TenantGameStateLike<C>,
  Spec extends string,
  Client extends TenantRematchClient<C>,
>(
  roomId: string,
  send: (client: Client, payload: unknown) => void,
): TenantRematchContext<Kind, C, M, State, Spec, Client> | null {
  const registration = variantTenantForRoomId(roomId);
  const lobby = registration?.lobby;
  if (!registration || !lobby) return null;
  type Room = TenantRuntimeRoom<Kind, C, M, State, Spec>;
  return {
    send,
    createRoom: async (timeControl, rated) => {
      const stillRated = rematchStaysRated(rated, lobby.supportsRated, timeControl);
      try {
        const created = await lobby.createRoom(timeControl, stillRated);
        const room = registration.rooms.get(created.id);
        if (!room) return { ok: false, error: 'room_not_live' };
        return { ok: true, room: room as unknown as Room };
      } catch (err) {
        logger.warn(
          { kind: `${registration.errorPrefix}_rematch_create_failed`, roomId, err },
          'rematch room creation failed',
        );
        return { ok: false, error: 'create_failed' };
      }
    },
    buildRoomUrl: (id) => `/room/${encodeURIComponent(id)}`,
    accountMayPlay: async (userId) =>
      !persistence.isInitialized() || !(await persistence.isUserIdPlayDisabled(userId)),
    issueSeatToken: async (room, seat, identity) => {
      const minted = mintTenantSeatToken(room, seat, identity);
      if (persistence.isInitialized()) {
        await persistence.upsertRoomSeatToken(
          room.id,
          persistenceRecordForTenantSeatToken(minted.state),
        );
      }
      return minted;
    },
  };
}
