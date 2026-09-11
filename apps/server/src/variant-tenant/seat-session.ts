/**
 * Generic seat assignment + seat-token lifecycle for tenant rooms.
 *
 * Seat-token model shared by every live stack: a raw token is minted on first
 * claim (hash stored server-side), reconnects re-attach by token hash, signed-
 * in users re-attach by account id, and a newer connection for the same seat
 * displaces older ones. Color choice walks the tenant's move-order tuple.
 */

import { randomBytes, randomUUID } from 'node:crypto';
import { clockPolicyKindFor } from '@mistboard/game';
import { isPlayDisabled, type UserAccount } from '../persistence.js';
import { hashSeatToken } from '../server-seat-session.js';
import type { TenantSeat, TenantSeatTokenState } from './tenant.js';

export type TenantSeatClient<C extends string> = {
  displaced: boolean;
  // A live client's seat may be 'spectator' (debug-authorized read-only viewer);
  // displacement only ever matches on a real color, so a spectator never
  // displaces or is displaced. See TenantLiveClient in ws.ts.
  seat: TenantSeat<C>;
  socket: { close(code?: number, reason?: string): unknown };
};

// Seat assignment reads only displaced + seat off clients (seat is widened to
// string so spectator refs pass through; only colors are probed for occupancy).
// The full client shape (socket) is demanded only by
// displaceOlderTenantSeatClients.
export type TenantSeatRoom<
  C extends string,
  Client extends { displaced: boolean; seat: string } = TenantSeatClient<C>,
> = {
  clients: Set<Client>;
  projection: {
    creatorPreference?: C | 'random';
    seats: Partial<Record<C, string>>;
    timeControl?: { daysPerMove?: number } | null;
  };
  rated?: boolean;
  seatTokens: Partial<Record<C, TenantSeatTokenState<C>>>;
};

export type TenantSeatAssignment<C extends string> =
  | {
      ok: true;
      seat: C;
      seatToken?: string;
      seatTokenHash: string;
      tokenState: TenantSeatTokenState<C>;
      previousTokenState?: TenantSeatTokenState<C>;
    }
  | {
      ok: false;
      reason:
        | 'private room'
        | 'rated requires account'
        | 'correspondence requires account'
        | 'play disabled';
    };

export function assignTenantSeat<
  C extends string,
  Client extends { displaced: boolean; seat: string },
>(
  tenant: { colors: readonly [C, C] },
  room: TenantSeatRoom<C, Client>,
  clientId: string,
  rawToken: string | undefined,
  accountUser: UserAccount | null,
  deviceId: string | null = null,
): TenantSeatAssignment<C> {
  const tokenHash = rawToken ? hashSeatToken(rawToken) : undefined;
  if (tokenHash) {
    for (const color of tenant.colors) {
      const state = room.seatTokens[color];
      if (state && state.revokedAt === null && state.tokenHash === tokenHash) {
        if (state.userId !== null && state.userId !== accountUser?.id) {
          return { ok: false, reason: 'private room' };
        }
        // A pre-issued seat (rematch, or minted before migration 137) learns
        // its device on the first reconnect that carries one.
        const tokenState = {
          ...state,
          clientId,
          deviceId: state.deviceId ?? deviceId,
          lastSeenAt: new Date(),
        };
        room.seatTokens[color] = tokenState;
        return {
          ok: true,
          seat: color,
          seatTokenHash: tokenHash,
          tokenState,
          previousTokenState: state,
        };
      }
    }
  }

  if (accountUser) {
    for (const color of tenant.colors) {
      const state = room.seatTokens[color];
      if (state && state.revokedAt === null && state.userId === accountUser.id) {
        const tokenState = {
          ...state,
          clientId,
          deviceId: state.deviceId ?? deviceId,
          lastSeenAt: new Date(),
        };
        room.seatTokens[color] = tokenState;
        return {
          ok: true,
          seat: color,
          seatTokenHash: state.tokenHash,
          tokenState,
          previousTokenState: state,
        };
      }
    }
  }

  const occupiedSeats = new Set<string>(
    [...room.clients].filter((client) => !client.displaced).map((client) => client.seat),
  );
  for (const color of tenant.colors) {
    if (room.projection.seats[color] || room.seatTokens[color]) occupiedSeats.add(color);
  }
  const seat = nextAvailableTenantSeat(tenant, room.projection.creatorPreference, occupiedSeats);
  if (!seat) return { ok: false, reason: 'private room' };
  // Per-account play lock (126). Only the new-seat path: both reclaim branches
  // above have already returned, so locking an account never strands it in a
  // game it is already sitting in.
  if (isPlayDisabled(accountUser)) return { ok: false, reason: 'play disabled' };
  if (room.rated && !accountUser) return { ok: false, reason: 'rated requires account' };
  // Correspondence (days-per-move) seats are account-required on BOTH sides:
  // notifications, deadline rows, and cross-device reseat all key off the seat's
  // user id. The create route gates the creator; this gates the invitee. Keyed
  // off the clock policy, not a room mode, so every future tenant inherits it.
  if (!accountUser && clockPolicyKindFor(room.projection.timeControl) === 'days-per-move') {
    return { ok: false, reason: 'correspondence requires account' };
  }

  const seatToken = randomBytes(32).toString('base64url');
  const seatTokenHash = hashSeatToken(seatToken);
  const now = new Date();
  const tokenState: TenantSeatTokenState<C> = {
    clientId,
    deviceId,
    seat,
    tokenHash: seatTokenHash,
    userId: accountUser?.id ?? null,
    userHandle: accountUser?.handle ?? null,
    userDisplayName: accountUser?.displayName ?? null,
    issuedAt: now,
    lastSeenAt: now,
    revokedAt: null,
  };
  room.seatTokens[seat] = tokenState;
  return { ok: true, seat, seatToken, seatTokenHash, tokenState };
}

// Pre-issue a fresh seat token for a specific seat (used by rematch finalize to
// reserve the swapped-color seats on the new room before either player
// connects). Mirrors the mint in assignTenantSeat but for a chosen seat and
// identity. The caller persists the token; this only sets the in-memory
// reservation so a connecting client with the raw token re-attaches to the seat.
export function mintTenantSeatToken<C extends string>(
  room: Pick<TenantSeatRoom<C>, 'seatTokens'>,
  seat: C,
  identity: { userId: string | null; userHandle: string | null; userDisplayName: string | null },
): { rawToken: string; state: TenantSeatTokenState<C> } {
  const rawToken = randomBytes(32).toString('base64url');
  const now = new Date();
  const state: TenantSeatTokenState<C> = {
    clientId: randomUUID(),
    // The holder has not connected yet; assignTenantSeat fills this in.
    deviceId: null,
    seat,
    tokenHash: hashSeatToken(rawToken),
    userId: identity.userId,
    userHandle: identity.userHandle,
    userDisplayName: identity.userDisplayName,
    issuedAt: now,
    lastSeenAt: now,
    revokedAt: null,
  };
  room.seatTokens[seat] = state;
  return { rawToken, state };
}

function nextAvailableTenantSeat<C extends string>(
  tenant: { colors: readonly [C, C] },
  creatorPreference: C | 'random' | undefined,
  occupiedSeats: ReadonlySet<string>,
): C | null {
  if (creatorPreference !== undefined && creatorPreference !== 'random') {
    if (!occupiedSeats.has(creatorPreference)) return creatorPreference;
  }
  if (creatorPreference === 'random' && occupiedSeats.size === 0) {
    return randomBytes(1)[0]! < 128 ? tenant.colors[0] : tenant.colors[1];
  }
  for (const color of tenant.colors) {
    if (!occupiedSeats.has(color)) return color;
  }
  return null;
}

export function rollbackTenantSeatAssignment<C extends string>(
  room: TenantSeatRoom<C>,
  assignment: Extract<TenantSeatAssignment<C>, { ok: true }>,
): void {
  const current = room.seatTokens[assignment.seat];
  if (
    !current ||
    current.clientId !== assignment.tokenState.clientId ||
    current.tokenHash !== assignment.tokenState.tokenHash
  ) {
    return;
  }
  if (assignment.previousTokenState) {
    room.seatTokens[assignment.seat] = assignment.previousTokenState;
    return;
  }
  delete room.seatTokens[assignment.seat];
}

export function displaceOlderTenantSeatClients<
  C extends string,
  Client extends TenantSeatClient<C>,
>(room: TenantSeatRoom<C, Client>, newest: Client): void {
  for (const client of room.clients) {
    if (client === newest) continue;
    if (client.displaced) continue;
    if (client.seat !== newest.seat) continue;
    client.displaced = true;
    try {
      client.socket.close(4000, 'duplicate session');
    } catch {
      /* socket already closed */
    }
  }
}
