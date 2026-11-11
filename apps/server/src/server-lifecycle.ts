import type { Server } from 'node:http';
import type { WebSocketServer } from 'ws';
import type { RoomManagerContext } from './room-manager.js';
import { clearAbortTimer, clearForfeitTimer, pauseRoomOnShutdown } from './room-manager.js';
import type { Room } from './server-types.js';

type ClosableRuntimeClient = {
  socket: {
    send: (data: string) => void;
    close: (code: number, reason: string) => void;
  };
};

type RuntimeRoomWithClients = {
  clients: Iterable<ClosableRuntimeClient>;
};

type RuntimeRoomWithWrites = {
  pendingWrites: Promise<void>;
};

export type RoomTimerCleanupOptions = {
  clearPendingVacates?: boolean;
  releaseEngineReservation?: (reservationId: string, reason: string) => void;
  reservationReleaseReason?: string;
};

export function clearRoomRuntimeTimers(
  room: Room,
  {
    clearPendingVacates = false,
    releaseEngineReservation,
    reservationReleaseReason = 'room-reset',
  }: RoomTimerCleanupOptions = {},
): void {
  if (room.clockTimer) clearTimeout(room.clockTimer);
  if (room.engineTimer) clearTimeout(room.engineTimer);
  clearAbortTimer(room);
  clearForfeitTimer(room);
  if (room.pauseGraceTimer) clearTimeout(room.pauseGraceTimer);
  if (clearPendingVacates) {
    for (const timer of Object.values(room.pendingVacates)) {
      if (timer) clearTimeout(timer);
    }
  }
  if (room.engineReservationId && releaseEngineReservation) {
    releaseEngineReservation(room.engineReservationId, reservationReleaseReason);
    room.engineReservationId = null;
  }
}

export async function pauseActiveRoomsOnShutdown(
  rooms: Iterable<Room>,
  ctx: RoomManagerContext,
): Promise<void> {
  const activeRooms = [...rooms];
  if (activeRooms.length === 0) return;
  const at = Date.now();
  const results = await Promise.allSettled(
    activeRooms.map((room) => pauseRoomOnShutdown(ctx, room, at)),
  );
  for (const [idx, result] of results.entries()) {
    if (result.status === 'rejected') {
      const room = activeRooms[idx];
      console.error(
        JSON.stringify({
          level: 'error',
          kind: 'pause_on_shutdown_failure',
          roomId: room?.id,
          error: (result.reason as Error)?.message,
          at: Date.now(),
        }),
      );
    }
  }
}

export function closeRoomClients(rooms: Iterable<RuntimeRoomWithClients>): void {
  const notice = JSON.stringify({ type: 'server_restart_scheduled', phase: 'restarting' });
  for (const client of [...rooms].flatMap((room) => [...room.clients])) {
    try {
      client.socket.send(notice);
    } catch {
      /* socket already closed; still attempt the close handshake */
    }
    try {
      client.socket.close(1001, 'server shutting down');
    } catch {
      /* socket already closed */
    }
  }
}

export function waitForRoomWrites(
  rooms: Iterable<RuntimeRoomWithWrites>,
): Promise<Array<PromiseSettledResult<void>>> {
  return Promise.allSettled([...rooms].map((room) => room.pendingWrites));
}

export function closeWebSocketServer(wss: WebSocketServer | null): Promise<void> {
  return new Promise((resolve) => {
    if (!wss) {
      resolve();
      return;
    }
    wss.close(() => resolve());
  });
}

export function closeHttpServer(server: Server | null): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!server) {
      resolve();
      return;
    }
    server.close((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}
