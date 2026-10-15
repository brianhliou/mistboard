/**
 * Jieqi WebSocket handler — thin adapter over the generic tenant ws runtime
 * (variant-tenant/ws.ts). Jieqi positions are public, so the generic host needs
 * no fog-specific wiring; the tenant's clientEventFor/viewForClient perform the
 * identity redaction. PvE: the Tier-B PikaJieQi scheduler (server-jieqi-engine.ts)
 * is wired into the post-connect / post-move hook, so an engine move flows through
 * the same append+broadcast path as a human move.
 */

import type { IncomingMessage } from 'node:http';
import type { JieqiColor } from '@mistboard/game';
import type { WebSocket } from 'ws';
import type { JieqiRuntimeRoom } from './jieqi-runtime.js';
import { jieqiTenant } from './jieqi-tenant.js';
import { scheduleJieqiEngineMove } from './server-jieqi-engine.js';
import { clearTenantRuntimeTimers } from './variant-tenant/lifecycle.js';
import { createTenantWsRuntime, type TenantLiveClient } from './variant-tenant/ws.js';

export type JieqiLiveClient = TenantLiveClient<JieqiColor>;

export type JieqiLiveRoom = Omit<JieqiRuntimeRoom, 'clients'> & {
  clients: Set<JieqiLiveClient>;
};

export type JieqiWebSocketContext = {
  defaultRoomRegion: string;
  wsMessageLimit: number;
  wsMessageWindowMs: number;
};

export const jieqiWs = createTenantWsRuntime(jieqiTenant, {
  scheduleEngineMove: (ctx, room) => scheduleJieqiEngineMove(ctx, room),
});

export async function handleJieqiWebSocketConnection(
  ctx: JieqiWebSocketContext,
  socket: WebSocket,
  request: IncomingMessage,
  room: JieqiLiveRoom,
): Promise<void> {
  return jieqiWs.handleConnection(
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

export function scheduleJieqiLifecycleTimers(room: JieqiLiveRoom): void {
  jieqiWs.scheduleLifecycleTimers(room);
}

export function clearJieqiRuntimeTimers(room: JieqiLiveRoom): void {
  clearTenantRuntimeTimers(room);
}
