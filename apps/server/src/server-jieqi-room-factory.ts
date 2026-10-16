/**
 * Thin adapter over the generic tenant room factory
 * (variant-tenant/room-factory.ts) for jieqi. PvP only — no PvE/rated options
 * and no running-game record (recordGameStart omitted), matching the dxq factory.
 */

import type { RoomTimeControl } from '@mistboard/game';
import type { JieqiCreatorPreference, JieqiEvent, JieqiRuntimeRoom } from './jieqi-runtime.js';
import { jieqiTenant } from './jieqi-tenant.js';
import type { JieqiLiveRoom } from './server-ws-jieqi.js';
import { createTenantLiveRoom } from './variant-tenant/room-factory.js';

export type JieqiRoomEngineSeat = {
  engineId: string;
  seat: 'red' | 'black';
  botId?: string;
};

export type JieqiLiveRoomCreation =
  | { ok: true; room: JieqiLiveRoom }
  | { ok: false; error: 'jieqi_disabled' | 'persistence_failure' | 'room_id_collision' };

export type JieqiLiveRoomFactoryContext = {
  jieqiRooms: Map<string, JieqiLiveRoom>;
  isRoomIdTaken(roomId: string): boolean;
  appendRoomEvent(roomId: string, seq: number, event: JieqiEvent): Promise<void>;
  createRoomId?: () => string;
  isPersistenceEnabled(): boolean;
  recordPersistenceError(roomId: string, seq: number, eventType: string, err: Error): void;
};

export async function createJieqiLiveRoom(
  ctx: JieqiLiveRoomFactoryContext,
  timeControl?: RoomTimeControl,
  creatorPreference?: JieqiCreatorPreference,
  engine?: JieqiRoomEngineSeat,
  rated = false,
): Promise<JieqiLiveRoomCreation> {
  const created = await createTenantLiveRoom(
    jieqiTenant,
    {
      rooms: ctx.jieqiRooms as unknown as Map<string, JieqiRuntimeRoom>,
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
      ? { ok: false, error: 'jieqi_disabled' }
      : { ok: false, error: created.error };
  }
  return { ok: true, room: created.room as JieqiLiveRoom };
}
