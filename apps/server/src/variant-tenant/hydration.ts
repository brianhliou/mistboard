/**
 * Generic get-or-load for tenant rooms: serve the live map first, otherwise
 * hydrate the persisted event log (validated against the tenant's event
 * schema) and re-attach unrevoked seat tokens. Extracted from the per-variant
 * copies that lived in index.ts; structured-log identity comes from the
 * tenant so failures keep their per-variant kinds
 * (`<prefix>_invalid_event_log`, `<prefix>_hydration_failure`).
 */

import { logger } from '../obs.js';
import * as persistence from '../persistence.js';
import { serverConfig } from '../server-config.js';
import { reserveHydratedLiveEngineSeat } from '../server-live-engine-reservations.js';
import { recordTenantPersistenceError } from './events.js';
import {
  appendTenantRuntimeEvent,
  createTenantRuntimeRoomFromEvents,
  isTenantEventLog,
  tenantOrphanPauseFor,
} from './runtime.js';
import type {
  TenantGameStateLike,
  TenantRuntimeRoom,
  TenantSeatTokenState,
  VariantTenant,
} from './tenant.js';

export async function getOrLoadTenantRoom<
  Kind extends string,
  C extends persistence.RoomSeatTokenSeat,
  M,
  State extends TenantGameStateLike<C>,
  View,
  Spec extends string,
>(
  tenant: VariantTenant<Kind, C, M, State, View, Spec>,
  rooms: Map<string, TenantRuntimeRoom<Kind, C, M, State, Spec>>,
  roomId: string,
): Promise<TenantRuntimeRoom<Kind, C, M, State, Spec> | null> {
  const existing = rooms.get(roomId);
  if (existing) return existing;
  if (!persistence.isInitialized()) return null;

  let events: persistence.PersistedRoomEvent[] | null = null;
  try {
    events = await persistence.loadRoomEvents<persistence.PersistedRoomEvent>(roomId);
  } catch (err) {
    recordTenantPersistenceError(tenant, roomId, -1, 'load-room', err as Error);
    return null;
  }
  if (!events) return null;
  if (!isTenantEventLog(tenant, events, roomId)) {
    logger.error(
      {
        kind: `${tenant.persistence.logKindPrefix}_invalid_event_log`,
        room_id: roomId,
        event_count: events.length,
      },
      `${tenant.persistence.logLabel} invalid event log`,
    );
    return null;
  }

  const hydrated = createTenantRuntimeRoomFromEvents(tenant, events);
  if (!hydrated.ok) {
    logger.error(
      {
        kind: `${tenant.persistence.logKindPrefix}_hydration_failure`,
        room_id: roomId,
        error: hydrated.error,
      },
      `${tenant.persistence.logLabel} hydration failure`,
    );
    return null;
  }
  const room = hydrated.room;
  await pauseOrphanedTenantRoom(tenant, room, Date.now(), serverConfig.orphanThresholdMs);
  room.seatTokens = tenantSeatTokenStatesFromPersistence<C>(
    await persistence.loadRoomSeatTokens<C>(roomId),
  );
  const engineReservationReady = await restoreHydratedTenantEngineReservation(
    tenant,
    room,
    reserveHydratedLiveEngineSeat,
  );
  if (!engineReservationReady) {
    logger.warn(
      {
        kind: `${tenant.persistence.logKindPrefix}_engine_reservation_hydrate_unavailable`,
        room_id: roomId,
      },
      `${tenant.persistence.logLabel} engine reservation unavailable during hydration`,
    );
    return null;
  }
  rooms.set(roomId, room);
  return room;
}

// A live game whose server died without running its shutdown pause (SIGKILL,
// a crash) is paused here, at its last event, so the outage is not charged to
// the side to move. Persisted before the room goes live; a failed write leaves
// the room as it was rather than refusing to load it.
export async function pauseOrphanedTenantRoom<
  Kind extends string,
  C extends string,
  M,
  State extends TenantGameStateLike<C>,
  View,
  Spec extends string,
>(
  tenant: VariantTenant<Kind, C, M, State, View, Spec>,
  room: TenantRuntimeRoom<Kind, C, M, State, Spec>,
  now: number,
  orphanThresholdMs: number,
): Promise<void> {
  const pause = tenantOrphanPauseFor<C, M, Spec>(
    room.projection,
    room.events,
    now,
    orphanThresholdMs,
  );
  if (!pause) return;
  const seq = room.events.length;
  try {
    if (persistence.isInitialized()) await persistence.appendRoomEvent(room.id, seq, pause);
  } catch (err) {
    recordTenantPersistenceError(tenant, room.id, seq, pause.type, err as Error);
    return;
  }
  appendTenantRuntimeEvent(tenant, room, pause);
  logger.warn(
    {
      kind: `${tenant.persistence.logKindPrefix}_orphan_paused`,
      room_id: room.id,
      paused_at: pause.at,
      gap_ms: now - (pause.at - 1),
    },
    `${tenant.persistence.logLabel} live game paused on hydration after an unclean stop`,
  );
}

export async function restoreHydratedTenantEngineReservation<
  Kind extends string,
  C extends string,
  M,
  State extends TenantGameStateLike<C>,
  View,
  Spec extends string,
>(
  tenant: VariantTenant<Kind, C, M, State, View, Spec>,
  room: TenantRuntimeRoom<Kind, C, M, State, Spec>,
  reserve: (reservation: {
    color: 'white' | 'black';
    engineId: string;
    roomId: string;
  }) => Promise<string | null>,
): Promise<boolean> {
  const reservationColor = tenant.engine?.reservationColor;
  const status = room.projection.state.status;
  if (!reservationColor || status.type === 'finished' || status.type === 'aborted') return true;

  for (const color of tenant.colors) {
    const engineId = room.projection.seats[color];
    if (!engineId || !tenant.engine?.isEngineClientId(engineId)) continue;
    const reservationId = await reserve({
      color: reservationColor(color),
      engineId,
      roomId: room.id,
    });
    if (!reservationId) return false;
    room.engineReservationId = reservationId;
    return true;
  }
  return true;
}

export function tenantSeatTokenStatesFromPersistence<C extends persistence.RoomSeatTokenSeat>(
  tokens: Partial<Record<C, persistence.RoomSeatTokenRecord<C>>>,
): Partial<Record<C, TenantSeatTokenState<C>>> {
  const states: Partial<Record<C, TenantSeatTokenState<C>>> = {};
  for (const token of Object.values<persistence.RoomSeatTokenRecord<C> | undefined>(
    tokens as Record<string, persistence.RoomSeatTokenRecord<C> | undefined>,
  )) {
    if (!token || token.revokedAt) continue;
    states[token.seat] = {
      clientId: token.clientId,
      deviceId: token.deviceId ?? null,
      seat: token.seat,
      tokenHash: token.tokenHash,
      userId: token.userId,
      userHandle: token.userHandle,
      userDisplayName: token.userDisplayName,
      issuedAt: token.issuedAt,
      lastSeenAt: token.lastSeenAt,
      revokedAt: token.revokedAt,
    };
  }
  return states;
}
