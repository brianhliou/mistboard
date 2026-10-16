/**
 * Thin adapter over the generic tenant room factory for Flip Jungle. PvP + PvE
 * (Tier-B MistyJungleFlip UCI engine, jungle-flip-engine.ts); no running-game record,
 * matching the banqi/jungle factories. The per-game deal is minted by the tenant's
 * rules.createSetup inside the runtime, not here.
 */

import type { RoomTimeControl } from '@mistboard/game';
import type {
  JungleFlipCreatorPreference,
  JungleFlipEvent,
  JungleFlipRuntimeRoom,
} from './jungle-flip-runtime.js';
import { jungleFlipTenant } from './jungle-flip-tenant.js';
import type { JungleFlipLiveRoom } from './server-ws-jungle-flip.js';
import { createTenantLiveRoom } from './variant-tenant/room-factory.js';

export type JungleFlipRoomEngineSeat = {
  engineId: string;
  seat: 'red' | 'black';
  botId?: string;
};

export type JungleFlipLiveRoomCreation =
  | { ok: true; room: JungleFlipLiveRoom }
  | { ok: false; error: 'jungle_flip_disabled' | 'persistence_failure' | 'room_id_collision' };

export type JungleFlipLiveRoomFactoryContext = {
  jungleFlipRooms: Map<string, JungleFlipLiveRoom>;
  isRoomIdTaken(roomId: string): boolean;
  appendRoomEvent(roomId: string, seq: number, event: JungleFlipEvent): Promise<void>;
  createRoomId?: () => string;
  isPersistenceEnabled(): boolean;
  recordPersistenceError(roomId: string, seq: number, eventType: string, err: Error): void;
};

export async function createJungleFlipLiveRoom(
  ctx: JungleFlipLiveRoomFactoryContext,
  timeControl?: RoomTimeControl,
  creatorPreference?: JungleFlipCreatorPreference,
  engine?: JungleFlipRoomEngineSeat,
  rated = false,
): Promise<JungleFlipLiveRoomCreation> {
  const created = await createTenantLiveRoom(
    jungleFlipTenant,
    {
      rooms: ctx.jungleFlipRooms as unknown as Map<string, JungleFlipRuntimeRoom>,
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
      ? { ok: false, error: 'jungle_flip_disabled' }
      : { ok: false, error: created.error };
  }
  return { ok: true, room: created.room as JungleFlipLiveRoom };
}
