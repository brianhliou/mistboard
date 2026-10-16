/**
 * Thin adapter over the generic tenant room factory (variant-tenant/room-factory.ts)
 * for Jungle. PvP + PvE (the in-process Misty Jungle alpha-beta engine seat); no
 * running-game record (recordGameStart omitted), matching the banqi/jieqi factories.
 */

import type { JungleColor, RoomTimeControl } from '@mistboard/game';
import type { JungleCreatorPreference, JungleEvent, JungleRuntimeRoom } from './jungle-runtime.js';
import { jungleTenant } from './jungle-tenant.js';
import type { JungleLiveRoom } from './server-ws-jungle.js';
import { createTenantLiveRoom } from './variant-tenant/room-factory.js';

// In-process engine: no reservationId (the Misty Jungle alpha-beta runs in-band, with
// no engine-service seat reservation).
export type JungleRoomEngineSeat = {
  engineId: string;
  seat: JungleColor;
  botId?: string;
};

export type JungleLiveRoomCreation =
  | { ok: true; room: JungleLiveRoom }
  | { ok: false; error: 'jungle_disabled' | 'persistence_failure' | 'room_id_collision' };

export type JungleLiveRoomFactoryContext = {
  jungleRooms: Map<string, JungleLiveRoom>;
  isRoomIdTaken(roomId: string): boolean;
  appendRoomEvent(roomId: string, seq: number, event: JungleEvent): Promise<void>;
  createRoomId?: () => string;
  isPersistenceEnabled(): boolean;
  recordPersistenceError(roomId: string, seq: number, eventType: string, err: Error): void;
};

export async function createJungleLiveRoom(
  ctx: JungleLiveRoomFactoryContext,
  timeControl?: RoomTimeControl,
  creatorPreference?: JungleCreatorPreference,
  engine?: JungleRoomEngineSeat,
  rated = false,
): Promise<JungleLiveRoomCreation> {
  const created = await createTenantLiveRoom(
    jungleTenant,
    {
      rooms: ctx.jungleRooms as unknown as Map<string, JungleRuntimeRoom>,
      isRoomIdTaken: ctx.isRoomIdTaken,
      appendRoomEvent: ctx.appendRoomEvent,
      createRoomId: ctx.createRoomId,
      isPersistenceEnabled: ctx.isPersistenceEnabled,
      recordPersistenceError: ctx.recordPersistenceError,
    },
    { timeControl, creatorPreference, engine, rated },
  );
  if (!created.ok) {
    return created.error === 'disabled'
      ? { ok: false, error: 'jungle_disabled' }
      : { ok: false, error: created.error };
  }
  return { ok: true, room: created.room as JungleLiveRoom };
}
