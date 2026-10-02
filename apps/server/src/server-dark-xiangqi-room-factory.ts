/**
 * Thin adapter over the generic tenant room factory
 * (variant-tenant/room-factory.ts) for hidden Dark Xiangqi. No running-game
 * record (recordGameStart omitted) and no rated options, matching the
 * pre-migration factory. PvE can pre-seat a local/dev engine through the generic
 * tenant room factory.
 */

import type { RoomTimeControl, XiangqiColor } from '@mistboard/game';
import type {
  DarkXiangqiCreatorPreference,
  DarkXiangqiEvent,
  DarkXiangqiRuntimeRoom,
} from './dark-xiangqi-runtime.js';
import { darkXiangqiTenant } from './dark-xiangqi-tenant.js';
import type { DarkXiangqiLiveRoom } from './server-ws-dark-xiangqi.js';
import { createTenantLiveRoom, type TenantRoomEngineSeat } from './variant-tenant/room-factory.js';

export type DarkXiangqiRoomEngineSeat = TenantRoomEngineSeat<XiangqiColor>;

export type DarkXiangqiLiveRoomCreation =
  | { ok: true; room: DarkXiangqiLiveRoom }
  | { ok: false; error: 'dark_xiangqi_disabled' | 'persistence_failure' | 'room_id_collision' };

export type DarkXiangqiLiveRoomFactoryContext = {
  darkXiangqiRooms: Map<string, DarkXiangqiLiveRoom>;
  // Collision check across rooms living outside this tenant's own map.
  isRoomIdTaken(roomId: string): boolean;
  appendRoomEvent(roomId: string, seq: number, event: DarkXiangqiEvent): Promise<void>;
  createRoomId?: () => string;
  isPersistenceEnabled(): boolean;
  recordPersistenceError(roomId: string, seq: number, eventType: string, err: Error): void;
};

export async function createDarkXiangqiLiveRoom(
  ctx: DarkXiangqiLiveRoomFactoryContext,
  timeControl?: RoomTimeControl,
  creatorPreference?: DarkXiangqiCreatorPreference,
  engine?: DarkXiangqiRoomEngineSeat,
  rated = false,
): Promise<DarkXiangqiLiveRoomCreation> {
  const created = await createTenantLiveRoom(
    darkXiangqiTenant,
    {
      // The live map stores rooms with connected-client sets; the factory only
      // ever inserts freshly created rooms (empty client set), same as the
      // pre-migration cast.
      rooms: ctx.darkXiangqiRooms as unknown as Map<string, DarkXiangqiRuntimeRoom>,
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
      ? { ok: false, error: 'dark_xiangqi_disabled' }
      : { ok: false, error: created.error };
  }
  return { ok: true, room: created.room as DarkXiangqiLiveRoom };
}
