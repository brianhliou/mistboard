import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Color } from '@mistboard/game';
import { isPlayDisabled, type UserAccount } from './persistence.js';
import {
  appendEvent,
  persistSeatToken,
  type RoomManagerContext,
  startLiveClockIfReady,
  touchSeatToken,
} from './room-manager.js';
import { authorizeExistingSeat, seatsShareAuthority } from './seat-auth.js';
import { isServerEngineClient } from './server-policy.js';
import type { Client, Room, SeatAssignment, SeatTokenState } from './server-types.js';

export async function assignSeat(
  ctx: RoomManagerContext,
  room: Room,
  clientId: string,
  suppliedSeatToken: string | undefined,
  accountUser: UserAccount | null,
  deviceId: string | null = null,
): Promise<SeatAssignment> {
  // Credential gate for claiming an EXISTING seat. authorizeExistingSeat owns
  // the policy (token vs account identity); see seat-auth.ts. A denial means a
  // valid token was presented for an account-bound seat by the wrong (or no)
  // identity, so the connection becomes a spectator and never cancels forfeits.
  const tokenSeat = verifySeatToken(room, suppliedSeatToken);
  const decision = authorizeExistingSeat(room.seatTokens, tokenSeat, accountUser?.id ?? null);
  if (decision.kind === 'deny') return { seat: 'spectator' };
  if (decision.kind === 'grant') {
    const state = room.seatTokens[decision.seat];
    if (state) {
      state.lastSeenAt = new Date();
      // A seat pre-issued by rematch (or minted before migration 137) learns
      // its device on the first reconnect that carries one.
      if (!state.deviceId && deviceId) {
        state.deviceId = deviceId;
        await persistSeatToken(ctx, room, state);
      } else {
        await touchSeatToken(ctx, room, state);
      }
    }
    await startLiveClockIfReady(ctx, room);
    // Identity reclaim issues no new raw token (the holder re-authenticates by
    // session each connect); the hash still flows so displacement can match.
    return { seat: decision.seat, seatTokenHash: decision.tokenHash };
  }
  // Hard account-gate for rated rooms. A playing seat in a rated game must be
  // bound to a durable account — we refuse a guest a color seat outright rather
  // than seating them and silently demoting the game to casual at game end (a
  // bad surprise: you accept a "rated" game and only learn afterward it didn't
  // count). Reached only on `fallthrough`, so an account holder reclaiming their
  // own seat by token or identity has already returned above; a logged-out
  // reconnect that would otherwise re-derive an account seat as anonymous is
  // caught here too. Server-engine clients are exempt (an engine seat already
  // forces casual at game end and is never a rated participant). The caller
  // turns this denial into a clear close so the client can prompt sign-in.
  if (room.rated && !accountUser && !isServerEngineClient(clientId)) {
    return { seat: 'spectator', deniedReason: 'rated-requires-account' };
  }
  // Per-account play lock (126). Placed on the fallthrough path on purpose: the
  // grant/reclaim branches above have already returned, so locking an account
  // stops it taking a NEW seat without stranding a game it is already sitting
  // in. Every tenant and the legacy stack reach a seat through this function,
  // so this one check is the whole games-side enforcement.
  if (isPlayDisabled(accountUser)) {
    return { seat: 'spectator', deniedReason: 'play-disabled' };
  }
  if (room.projection.seats.white === clientId) {
    await startLiveClockIfReady(ctx, room);
    return await existingSeatAssignment(ctx, room, 'white', clientId, accountUser, deviceId);
  }
  if (room.projection.seats.black === clientId) {
    await startLiveClockIfReady(ctx, room);
    return await existingSeatAssignment(ctx, room, 'black', clientId, accountUser, deviceId);
  }
  if (room.randomSeating && !room.projection.seats.white && !room.projection.seats.black) {
    const seat: Color = randomBytes(1)[0]! < 128 ? 'white' : 'black';
    await appendSeatAssigned(ctx, room, clientId, seat);
    return await newSeatAssignment(ctx, room, seat, clientId, accountUser, deviceId);
  }
  if (room.creatorPreference && !room.projection.seats.white && !room.projection.seats.black) {
    const seat = room.creatorPreference;
    await appendSeatAssigned(ctx, room, clientId, seat);
    return await newSeatAssignment(ctx, room, seat, clientId, accountUser, deviceId);
  }
  if (!room.projection.seats.white) {
    await appendSeatAssigned(ctx, room, clientId, 'white');
    return await newSeatAssignment(ctx, room, 'white', clientId, accountUser, deviceId);
  }
  if (!room.projection.seats.black) {
    await appendSeatAssigned(ctx, room, clientId, 'black');
    return await newSeatAssignment(ctx, room, 'black', clientId, accountUser, deviceId);
  }
  return { seat: 'spectator' };
}

export function verifySeatToken(
  room: Room,
  suppliedSeatToken: string | undefined,
): SeatTokenState | null {
  if (!suppliedSeatToken) return null;
  const tokenHash = hashSeatToken(suppliedSeatToken);
  const supplied = Buffer.from(tokenHash, 'hex');
  for (const state of Object.values(room.seatTokens)) {
    if (!state) continue;
    const expected = Buffer.from(state.tokenHash, 'hex');
    if (expected.length === supplied.length && timingSafeEqual(expected, supplied)) {
      return state;
    }
  }
  return null;
}

export function hashSeatToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function displaceOlderSeatClients(room: Room, replacement: Client): void {
  for (const client of room.clients) {
    if (client === replacement) continue;
    if (client.seat !== replacement.seat) continue;
    if (client.seat === 'spectator') continue;
    if (!sameSeatAuthority(client, replacement)) continue;
    client.displaced = true;
    try {
      client.socket.close(4000, 'duplicate session');
    } catch {
      // The close handler will clear already-closed sockets.
    }
  }
}

async function appendSeatAssigned(
  ctx: RoomManagerContext,
  room: Room,
  clientId: string,
  seat: Color,
): Promise<void> {
  await appendEvent(ctx, room, {
    type: 'seat-assigned',
    at: Date.now(),
    roomId: room.id,
    clientId,
    seat,
  });
  await startLiveClockIfReady(ctx, room);
}

async function existingSeatAssignment(
  ctx: RoomManagerContext,
  room: Room,
  seat: Color,
  clientId: string,
  accountUser: UserAccount | null,
  deviceId: string | null,
): Promise<SeatAssignment> {
  const existing = room.seatTokens[seat];
  if (existing) {
    return { seat: 'spectator' };
  }
  return newSeatAssignment(ctx, room, seat, clientId, accountUser, deviceId);
}

async function newSeatAssignment(
  ctx: RoomManagerContext,
  room: Room,
  seat: Color,
  clientId: string,
  accountUser: UserAccount | null,
  deviceId: string | null,
): Promise<SeatAssignment> {
  if (isServerEngineClient(clientId)) return { seat };
  const rawToken = randomBytes(32).toString('base64url');
  const tokenHash = hashSeatToken(rawToken);
  const now = new Date();
  const tokenState: SeatTokenState = {
    clientId,
    deviceId,
    seat,
    tokenHash,
    userId: accountUser?.id ?? null,
    userHandle: accountUser?.handle ?? null,
    userDisplayName: accountUser?.displayName ?? null,
    issuedAt: now,
    lastSeenAt: now,
    revokedAt: null,
  };
  await persistSeatToken(ctx, room, tokenState);
  room.seatTokens[seat] = tokenState;
  return {
    seat,
    seatToken: rawToken,
    seatTokenHash: tokenHash,
  };
}

function sameSeatAuthority(left: Client, right: Client): boolean {
  return seatsShareAuthority(left, right, isServerEngineClient);
}
