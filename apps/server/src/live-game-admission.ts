import type { IncomingMessage } from 'node:http';
import { isInitialized } from './persistence-db.js';
import { listLiveRoomIdsForIdentity } from './persistence-seat-tokens.js';
import { registeredVariantTenants } from './variant-tenant/registry.js';

export type LiveGameIdentity = {
  userId?: string | null;
  deviceId?: string | null;
};

// The HTTP guest id uses exactly the grammar of the socket's ?device= id.
// Account identity must come from the authenticated session, never the body
// or a header. A device id is attribution, not seat/reconnect authority.
export function liveGameIdentityForRequest(
  request: Pick<IncomingMessage, 'headers'>,
  account: { id: string } | null,
): LiveGameIdentity {
  const device = request.headers['x-mistboard-device-id'];
  return {
    userId: account?.id ?? null,
    deviceId: typeof device === 'string' && /^[a-zA-Z0-9:_-]{8,80}$/.test(device) ? device : null,
  };
}

// Shared structural slice of both live stacks. Seat tokens, rather than live
// sockets, include disconnected players and pre-issued seats.
export type AdmissionRoom = {
  id: string;
  timeControl?: { daysPerMove?: number };
  projection?: {
    state: { status: { type: string } };
    timeControl?: { daysPerMove?: number };
  };
  seatTokens?: Partial<Record<string, LiveGameIdentity & { revokedAt?: Date | null }>>;
};

type AdmissionOptions = {
  rooms: ReadonlyMap<string, AdmissionRoom>;
  tenantRooms?: () => Iterable<ReadonlyMap<string, AdmissionRoom>>;
  persistedRoomIds?: (identity: LiveGameIdentity) => Promise<readonly string[]>;
};

export type LiveGameReservation = {
  roomId: string;
  // Release only after the room and its seat ownership are published (and
  // persisted when enabled), or after creation fails. Safe to call twice.
  release(): void;
};

export type LiveGameAdmissionResult =
  | { ok: true; reservation: LiveGameReservation }
  | { ok: false; roomId: string };

function identityKeys(identity: LiveGameIdentity): string[] {
  return [
    ...(identity.userId ? [`user:${identity.userId}`] : []),
    ...(identity.deviceId ? [`device:${identity.deviceId}`] : []),
  ];
}

function samePlayer(a: LiveGameIdentity, b: LiveGameIdentity): boolean {
  return !!((a.userId && a.userId === b.userId) || (a.deviceId && a.deviceId === b.deviceId));
}

/**
 * One service per server, shared by all admission paths. No create/seat path
 * invokes it yet (#776). Reservations bridge the async gap between checking
 * ownership and publishing a new room; they are local to this server process.
 * Existing ownership is always read from rooms and the durable seat/event
 * store, so a restart needs no reservation cache to find a running game.
 */
export class LiveGameAdmission {
  private readonly reservations = new Map<string, LiveGameReservation>();
  private reservationTail: Promise<void> = Promise.resolve();

  constructor(private readonly options: AdmissionOptions) {}

  async find(identity: LiveGameIdentity): Promise<string | null> {
    const keys = identityKeys(identity);
    if (keys.length === 0) return null;
    for (const key of keys) {
      const pending = this.reservations.get(key);
      if (pending) return pending.roomId;
    }
    const knownRooms = new Set<string>();
    const tenantRooms: Iterable<ReadonlyMap<string, AdmissionRoom>> =
      this.options.tenantRooms?.() ?? registeredVariantTenants().map((tenant) => tenant.rooms);
    for (const rooms of [this.options.rooms, ...tenantRooms]) {
      for (const [roomId, room] of rooms) {
        knownRooms.add(roomId);
        if (
          room.projection?.state.status.type !== 'playing' ||
          room.projection.timeControl?.daysPerMove ||
          room.timeControl?.daysPerMove
        )
          continue;
        for (const seat of Object.values(room.seatTokens ?? {})) {
          if (seat && !seat.revokedAt && samePlayer(identity, seat)) return roomId;
        }
      }
    }
    const persisted = this.options.persistedRoomIds
      ? await this.options.persistedRoomIds(identity)
      : isInitialized()
        ? await listLiveRoomIdsForIdentity(identity)
        : [];
    // A loaded finished room wins over a lagging running row in the database.
    return persisted.find((roomId) => !knownRooms.has(roomId)) ?? null;
  }

  async reserve(identity: LiveGameIdentity, roomId: string): Promise<LiveGameAdmissionResult> {
    const keys = identityKeys(identity);
    if (keys.length === 0 || !roomId)
      throw new Error('live game reservation requires identity and room');
    // Serialize check + publication, including the async persistence read.
    // Both account and device aliases participate in the same critical section.
    const prior = this.reservationTail;
    let unlock = () => {};
    this.reservationTail = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    await prior;
    try {
      const existing = await this.find(identity);
      if (existing) return { ok: false, roomId: existing };
      const reservation: LiveGameReservation = {
        roomId,
        release: () => {
          for (const key of keys) {
            if (this.reservations.get(key) === reservation) this.reservations.delete(key);
          }
        },
      };
      for (const key of keys) this.reservations.set(key, reservation);
      return { ok: true, reservation };
    } finally {
      unlock();
    }
  }
}
