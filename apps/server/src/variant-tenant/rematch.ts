/**
 * Generic mutual-confirm rematch over tenant rooms: each seat can offer; when
 * both seats have an active offer from the players who still hold the seat
 * tokens, a new room is created with colors swapped (carrying the time control
 * forward) and each side gets a pre-issued seat token + redirect.
 * pendingRedirects is keyed by OLD-room seat so a player who reconnects after
 * finalize still gets routed forward.
 *
 * Identity rule: only the players whose seat tokens are still the active
 * tokens for their color (tokenHash match) can offer or be finalized.
 */

import type { RoomTimeControl } from '@mistboard/game';
import type {
  TenantGameStateLike,
  TenantRuntimeRoom,
  TenantSeat,
  TenantSeatTokenState,
} from './tenant.js';

export type TenantRematchClient<C extends string> = {
  // 'spectator' clients never own a seat token, so every rematch operation
  // returns early for them (see the spectator guards below); only real colors
  // index seatTokens / pendingRedirects.
  seat: TenantSeat<C>;
  seatTokenHash?: string;
};

export type TenantRematchRoom<
  Kind extends string,
  C extends string,
  M,
  State extends TenantGameStateLike<C>,
  Spec extends string,
  Client extends TenantRematchClient<C>,
> = Omit<TenantRuntimeRoom<Kind, C, M, State, Spec>, 'clients'> & {
  clients: Iterable<Client>;
};

export type TenantRematchContext<
  Kind extends string,
  C extends string,
  M,
  State extends TenantGameStateLike<C>,
  Spec extends string,
  Client extends TenantRematchClient<C>,
> = {
  send: (client: Client, payload: unknown) => void;
  createRoom: (
    timeControl: RoomTimeControl | undefined,
    rated: boolean,
  ) => Promise<
    { ok: true; room: TenantRuntimeRoom<Kind, C, M, State, Spec> } | { ok: false; error: string }
  >;
  issueSeatToken: (
    room: TenantRuntimeRoom<Kind, C, M, State, Spec>,
    seat: C,
    identity: { userId: string | null; userHandle: string | null; userDisplayName: string | null },
  ) => Promise<{ rawToken: string; state: TenantSeatTokenState<C> }>;
  buildRoomUrl: (roomId: string) => string;
};

function activeSeatTokenForClient<
  Kind extends string,
  C extends string,
  M,
  State extends TenantGameStateLike<C>,
  Spec extends string,
  Client extends TenantRematchClient<C>,
>(
  room: TenantRematchRoom<Kind, C, M, State, Spec, Client>,
  client: Client,
): TenantSeatTokenState<C> | null {
  if (client.seat === 'spectator') return null;
  const token = room.seatTokens[client.seat];
  if (!token) return null;
  if (token.tokenHash !== client.seatTokenHash) return null;
  return token;
}

// The only gate is a real, not-yet-finalized finished game. Aborted games fall
// back to instant play-again.
function isRematchAllowed(room: {
  projection: { state: { status: { type: string } } };
  rematch: { finalizedRoomId?: string };
}): boolean {
  if (room.projection.state.status.type !== 'finished') return false;
  if (room.rematch.finalizedRoomId) return false;
  return true;
}

export function broadcastTenantRematchState<
  Kind extends string,
  C extends string,
  M,
  State extends TenantGameStateLike<C>,
  Spec extends string,
  Client extends TenantRematchClient<C>,
>(
  tenant: { colors: readonly C[] },
  ctx: TenantRematchContext<Kind, C, M, State, Spec, Client>,
  room: TenantRematchRoom<Kind, C, M, State, Spec, Client>,
): void {
  const offers = {} as Record<C, boolean>;
  for (const color of tenant.colors) offers[color] = room.rematch.offers[color] !== undefined;
  const payload = {
    type: 'rematch:state' as const,
    offers,
    finalizedRoomId: room.rematch.finalizedRoomId ?? null,
  };
  for (const client of room.clients) {
    ctx.send(client, payload);
  }
}

export function offerTenantRematch<
  Kind extends string,
  C extends string,
  M,
  State extends TenantGameStateLike<C>,
  Spec extends string,
  Client extends TenantRematchClient<C>,
>(
  tenant: { colors: readonly C[] },
  ctx: TenantRematchContext<Kind, C, M, State, Spec, Client>,
  room: TenantRematchRoom<Kind, C, M, State, Spec, Client>,
  client: Client,
): void {
  if (!isRematchAllowed(room)) return;
  const token = activeSeatTokenForClient(room, client);
  if (!token) return;
  if (room.rematch.offers[token.seat]) return;
  room.rematch.offers[token.seat] = {
    tokenHash: token.tokenHash,
    userId: token.userId,
    at: Date.now(),
  };
  broadcastTenantRematchState(tenant, ctx, room);
}

export function cancelTenantRematch<
  Kind extends string,
  C extends string,
  M,
  State extends TenantGameStateLike<C>,
  Spec extends string,
  Client extends TenantRematchClient<C>,
>(
  tenant: { colors: readonly C[] },
  ctx: TenantRematchContext<Kind, C, M, State, Spec, Client>,
  room: TenantRematchRoom<Kind, C, M, State, Spec, Client>,
  client: Client,
): void {
  const token = activeSeatTokenForClient(room, client);
  if (!token) return;
  if (!room.rematch.offers[token.seat]) return;
  delete room.rematch.offers[token.seat];
  broadcastTenantRematchState(tenant, ctx, room);
}

export function declineTenantRematch<
  Kind extends string,
  C extends string,
  M,
  State extends TenantGameStateLike<C>,
  Spec extends string,
  Client extends TenantRematchClient<C>,
>(
  tenant: { colors: readonly C[] },
  ctx: TenantRematchContext<Kind, C, M, State, Spec, Client>,
  room: TenantRematchRoom<Kind, C, M, State, Spec, Client>,
  client: Client,
): void {
  const token = activeSeatTokenForClient(room, client);
  if (!token) return;
  // Decline clears both offers — the conversation is over.
  const [first, second] = tenant.colors;
  if (!room.rematch.offers[first] && !room.rematch.offers[second]) return;
  room.rematch.offers = {};
  broadcastTenantRematchState(tenant, ctx, room);
}

function identitiesMatch<C extends string>(
  originalToken: TenantSeatTokenState<C>,
  offer: { tokenHash: string; userId: string | null },
): boolean {
  if (originalToken.tokenHash !== offer.tokenHash) return false;
  if (originalToken.userId !== offer.userId) return false;
  return true;
}

export async function finalizeTenantRematchIfReady<
  Kind extends string,
  C extends string,
  M,
  State extends TenantGameStateLike<C>,
  Spec extends string,
  Client extends TenantRematchClient<C>,
>(
  tenant: { colors: readonly C[] },
  ctx: TenantRematchContext<Kind, C, M, State, Spec, Client>,
  room: TenantRematchRoom<Kind, C, M, State, Spec, Client>,
): Promise<TenantRuntimeRoom<Kind, C, M, State, Spec> | null> {
  if (!isRematchAllowed(room)) return null;
  const [first, second] = tenant.colors;
  const firstOffer = room.rematch.offers[first];
  const secondOffer = room.rematch.offers[second];
  if (!firstOffer || !secondOffer) return null;

  const firstToken = room.seatTokens[first];
  const secondToken = room.seatTokens[second];
  if (!firstToken || !secondToken) return null;

  // Identity check: the offers must still come from the players holding the
  // active seat tokens (no rotation), and account-bound users must be unchanged.
  if (!identitiesMatch(firstToken, firstOffer) || !identitiesMatch(secondToken, secondOffer)) {
    room.rematch.offers = {};
    broadcastTenantRematchState(tenant, ctx, room);
    return null;
  }

  const created = await ctx.createRoom(room.projection.timeControl, room.rated);
  if (!created.ok) return null;
  const newRoom = created.room;

  // Mint seat tokens with colors SWAPPED relative to the previous game: the
  // old first-color player takes the second color next, and vice versa.
  const newFirstSeatToken = await ctx.issueSeatToken(newRoom, first, {
    userId: secondToken.userId,
    userHandle: secondToken.userHandle,
    userDisplayName: secondToken.userDisplayName,
  });
  const newSecondSeatToken = await ctx.issueSeatToken(newRoom, second, {
    userId: firstToken.userId,
    userHandle: firstToken.userHandle,
    userDisplayName: firstToken.userDisplayName,
  });

  room.rematch.finalizedRoomId = newRoom.id;

  const url = ctx.buildRoomUrl(newRoom.id);
  // Keyed by OLD-room seat so a reconnecting player who missed the live
  // broadcast still lands in the new room with the right (swapped) seat.
  room.rematch.pendingRedirects = {
    [first]: { roomId: newRoom.id, seat: second, rawToken: newSecondSeatToken.rawToken, url },
    [second]: { roomId: newRoom.id, seat: first, rawToken: newFirstSeatToken.rawToken, url },
  } as typeof room.rematch.pendingRedirects;

  for (const client of room.clients) {
    const previousToken = activeSeatTokenForClient(room, client);
    if (!previousToken) continue;
    const pending = room.rematch.pendingRedirects?.[previousToken.seat];
    if (!pending) continue;
    ctx.send(client, {
      type: 'rematch:redirect',
      url: pending.url,
      roomId: pending.roomId,
      seat: pending.seat,
      seatToken: pending.rawToken,
    });
  }

  broadcastTenantRematchState(tenant, ctx, room);
  return newRoom;
}

// Re-send a previously-finalized redirect to a single client on reconnect, so a
// player who was offline at finalize time still routes to the new room.
export function maybeReplayTenantRematchRedirect<
  Kind extends string,
  C extends string,
  M,
  State extends TenantGameStateLike<C>,
  Spec extends string,
  Client extends TenantRematchClient<C>,
>(
  ctx: TenantRematchContext<Kind, C, M, State, Spec, Client>,
  room: TenantRematchRoom<Kind, C, M, State, Spec, Client>,
  client: Client,
): void {
  if (client.seat === 'spectator') return;
  const pending = room.rematch.pendingRedirects?.[client.seat];
  if (!pending) return;
  ctx.send(client, {
    type: 'rematch:redirect',
    url: pending.url,
    roomId: pending.roomId,
    seat: pending.seat,
    seatToken: pending.rawToken,
  });
}
