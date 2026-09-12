// ── Rematch module ─────────────────────────────────────────────────────────
//
// Mutual-confirm rematch for finished PvP games. Each seat can offer; when both
// seats have an active offer, a new room is created with colors swapped and the
// same variant / timeControl / rated settings. Each client
// receives a pre-issued seat token for the new room and a redirect URL.
//
// Identity rule: only the original players (whose seat tokens are still the
// active tokens for their color) can offer or accept. Enforced by tokenHash
// match in `canOfferRematch`.

import type { Color } from '@mistboard/game';
import type { RoomManagerContext } from './room-manager.js';
import type { Client, Room, SeatTokenState } from './server-types.js';

export type RematchCreateRoom = (spec: {
  variant: Room['variant'];
  gameSpecId: Room['gameSpecId'];
  timeControl: Room['timeControl'];
  rated: boolean;
  region?: string;
  mode: 'pvp' | 'pve';
  pveEngineId: string | null;
}) => Promise<Room>;

export type RematchIssueToken = (
  room: Room,
  seat: Color,
  identity: { userId: string | null; userHandle: string | null; userDisplayName: string | null },
) => Promise<{ rawToken: string; state: SeatTokenState }>;

export type RematchSend = (client: Client, payload: unknown) => void;

export type RematchUrl = (roomId: string) => string;

export interface RematchOrchestrator {
  ctx: RoomManagerContext;
  createRoom: RematchCreateRoom;
  issueSeatToken: RematchIssueToken;
  send: RematchSend;
  buildRoomUrl: RematchUrl;
}

function activeSeatTokenForClient(room: Room, client: Client): SeatTokenState | null {
  if (client.seat === 'spectator') return null;
  const token = room.seatTokens[client.seat];
  if (!token) return null;
  if (token.tokenHash !== client.seatTokenHash) return null;
  return token;
}

function isRematchAllowed(room: Room): boolean {
  if (room.mode !== 'pvp') return false;
  if (room.projection.state.status.type !== 'finished') return false;
  if (room.rematch.finalizedRoomId) return false;
  return true;
}

export function broadcastRematchState(orch: RematchOrchestrator, room: Room): void {
  const payload = {
    type: 'rematch:state' as const,
    offers: {
      white: room.rematch.offers.white !== undefined,
      black: room.rematch.offers.black !== undefined,
    },
    finalizedRoomId: room.rematch.finalizedRoomId ?? null,
  };
  for (const client of room.clients) {
    orch.send(client, payload);
  }
}

export function offerRematch(
  orch: RematchOrchestrator,
  room: Room,
  client: Client,
): { ok: boolean; reason?: string } {
  if (!isRematchAllowed(room)) return { ok: false, reason: 'not_allowed' };
  const token = activeSeatTokenForClient(room, client);
  if (!token) return { ok: false, reason: 'not_seated' };
  const seat = token.seat;
  if (room.rematch.offers[seat]) return { ok: true };
  room.rematch.offers[seat] = {
    tokenHash: token.tokenHash,
    userId: token.userId,
    at: Date.now(),
  };
  broadcastRematchState(orch, room);
  return { ok: true };
}

export function cancelRematch(orch: RematchOrchestrator, room: Room, client: Client): void {
  const token = activeSeatTokenForClient(room, client);
  if (!token) return;
  if (!room.rematch.offers[token.seat]) return;
  delete room.rematch.offers[token.seat];
  broadcastRematchState(orch, room);
}

export function declineRematch(orch: RematchOrchestrator, room: Room, client: Client): void {
  const token = activeSeatTokenForClient(room, client);
  if (!token) return;
  // Decline clears both offers — the conversation is over.
  if (!room.rematch.offers.white && !room.rematch.offers.black) return;
  room.rematch.offers = {};
  broadcastRematchState(orch, room);
}

function identitiesMatch(
  originalToken: SeatTokenState,
  offer: { tokenHash: string; userId: string | null },
): boolean {
  // Token hash must still match (no rotation happened) AND if either side is
  // account-bound, the userId must match the offer's recorded userId.
  if (originalToken.tokenHash !== offer.tokenHash) return false;
  if (originalToken.userId !== offer.userId) return false;
  return true;
}

export async function finalizeRematchIfReady(
  orch: RematchOrchestrator,
  room: Room,
): Promise<Room | null> {
  if (!isRematchAllowed(room)) return null;
  const whiteOffer = room.rematch.offers.white;
  const blackOffer = room.rematch.offers.black;
  if (!whiteOffer || !blackOffer) return null;

  const whiteToken = room.seatTokens.white;
  const blackToken = room.seatTokens.black;
  if (!whiteToken || !blackToken) return null;

  // Identity check: ensure the offers came from the players still holding the
  // active seat tokens, and that account-bound users haven't changed under us.
  if (!identitiesMatch(whiteToken, whiteOffer)) {
    room.rematch.offers = {};
    broadcastRematchState(orch, room);
    return null;
  }
  if (!identitiesMatch(blackToken, blackOffer)) {
    room.rematch.offers = {};
    broadcastRematchState(orch, room);
    return null;
  }

  // Create the new room with all settings carried forward.
  if (room.mode !== 'pvp' && room.mode !== 'pve') return null;
  const newRoom = await orch.createRoom({
    variant: room.variant,
    gameSpecId: room.gameSpecId,
    timeControl: room.timeControl,
    rated: room.rated,
    region: room.region,
    mode: room.mode,
    pveEngineId: room.pveEngineId,
  });

  // Mint seat tokens with colors SWAPPED relative to the previous game.
  const newWhiteToken = await orch.issueSeatToken(newRoom, 'white', {
    userId: blackToken.userId,
    userHandle: blackToken.userHandle,
    userDisplayName: blackToken.userDisplayName,
  });
  const newBlackToken = await orch.issueSeatToken(newRoom, 'black', {
    userId: whiteToken.userId,
    userHandle: whiteToken.userHandle,
    userDisplayName: whiteToken.userDisplayName,
  });

  room.rematch.finalizedRoomId = newRoom.id;

  const url = orch.buildRoomUrl(newRoom.id);
  // Stash pending redirects keyed by OLD-room seat so reconnecting players
  // who missed the live broadcast still land in the new room.
  room.rematch.pendingRedirects = {
    white: { roomId: newRoom.id, seat: 'black', rawToken: newBlackToken.rawToken, url },
    black: { roomId: newRoom.id, seat: 'white', rawToken: newWhiteToken.rawToken, url },
  };

  // Per-client redirect: each side gets their own seat token (flipped color).
  for (const client of room.clients) {
    const previousToken = activeSeatTokenForClient(room, client);
    if (!previousToken) continue;
    const pending = room.rematch.pendingRedirects[previousToken.seat];
    if (!pending) continue;
    orch.send(client, {
      type: 'rematch:redirect',
      url: pending.url,
      roomId: pending.roomId,
      seat: pending.seat,
      seatToken: pending.rawToken,
    });
  }

  // Final broadcast so any spectators / late-arriving clients see the
  // finalized state (no seatToken for them).
  broadcastRematchState(orch, room);
  return newRoom;
}

// Replays a previously-finalized redirect to a single client. Called on
// reconnect after a rematch finalize so a player who was offline at finalize
// time still gets routed to the new room.
export function maybeReplayRematchRedirect(
  orch: RematchOrchestrator,
  room: Room,
  client: Client,
): void {
  if (client.seat !== 'white' && client.seat !== 'black') return;
  const pending = room.rematch.pendingRedirects?.[client.seat];
  if (!pending) return;
  orch.send(client, {
    type: 'rematch:redirect',
    url: pending.url,
    roomId: pending.roomId,
    seat: pending.seat,
    seatToken: pending.rawToken,
  });
}
