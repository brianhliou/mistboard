import { currentAccountUser } from './account-session.js';
import { internalEngineTestFor, isInternalEngineTestLog } from './internal-engine-test.js';
/**
 * Banqi WebSocket handler — thin adapter over the generic tenant ws runtime
 * (variant-tenant/ws.ts). Banqi positions are public, so the generic host needs
 * no fog-specific wiring; the tenant's clientEventFor/viewForClient perform the
 * deal redaction and seat masking. PvE: the Tier-B MistyBanqi scheduler
 * (server-banqi-engine.ts) is wired into the post-connect / post-move hook, so an
 * engine move flows through the same append+broadcast path as a human move.
 */

import type { IncomingMessage } from 'node:http';
import type { BanqiSeat } from '@mistboard/game';
import type { WebSocket } from 'ws';
import type { BanqiRuntimeRoom } from './banqi-runtime.js';
import { banqiTenant } from './banqi-tenant.js';
import { scheduleBanqiEngineMove } from './server-banqi-engine.js';
import { clearTenantRuntimeTimers } from './variant-tenant/lifecycle.js';
import { createTenantWsRuntime, type TenantLiveClient } from './variant-tenant/ws.js';

export type BanqiLiveClient = TenantLiveClient<BanqiSeat>;

export type BanqiLiveRoom = Omit<BanqiRuntimeRoom, 'clients'> & {
  clients: Set<BanqiLiveClient>;
};

export type BanqiWebSocketContext = {
  defaultRoomRegion: string;
  wsMessageLimit: number;
  wsMessageWindowMs: number;
};

export const banqiWs = createTenantWsRuntime(banqiTenant, {
  scheduleEngineMove: (ctx, room) => scheduleBanqiEngineMove(ctx, room),
});

export async function handleBanqiWebSocketConnection(
  ctx: BanqiWebSocketContext,
  socket: WebSocket,
  request: IncomingMessage,
  room: BanqiLiveRoom,
): Promise<void> {
  if (isInternalEngineTestLog(room.events)) {
    const stamp = internalEngineTestFor(room.events);
    const user = await currentAccountUser(request);
    if (!stamp || user?.accountRole !== 'admin' || user.id !== stamp.ownerUserId) {
      socket.close(1008, 'private test room');
      return;
    }
  }
  return banqiWs.handleConnection(
    {
      wsMessageLimit: ctx.wsMessageLimit,
      wsMessageWindowMs: ctx.wsMessageWindowMs,
      defaultRoomRegion: ctx.defaultRoomRegion,
    },
    socket,
    request,
    room,
  );
}

export function scheduleBanqiLifecycleTimers(room: BanqiLiveRoom): void {
  banqiWs.scheduleLifecycleTimers(room);
}

export function clearBanqiRuntimeTimers(room: BanqiLiveRoom): void {
  clearTenantRuntimeTimers(room);
}
