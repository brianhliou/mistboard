import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { gameSpecForLegacyLiveRoom, type RoomTimeControl } from '@mistboard/game';
import { currentAccountUser } from './../account-session.js';
import { ratedEnabled } from './../feature-flags.js';
import { gateGameSpecRequest } from './../game-spec-request-gate.js';
import * as persistence from './../persistence.js';
import type { LobbyTicket, Room } from './../server-types.js';
import {
  type VariantTenantRegistration,
  variantTenantForSpecId,
} from './../variant-tenant/registry.js';
import {
  type HttpApiContext,
  isAllowedRatedTimeControl,
  isAllowedTimeControl,
  parseRoomTimeControl,
  readJsonBody,
  requireMethod,
  writeJson,
} from './lib.js';

const lobbyTicketTtlMs = 5 * 60 * 1000;
const lobbyPollAfterMs = 1_000;

export async function tryHandle(
  ctx: HttpApiContext,
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
): Promise<boolean> {
  const method = request.method ?? 'GET';

  if (pathname === '/api/lobby') {
    if (method === 'GET') {
      pruneLobbyTickets(ctx);
      writeJson(response, 200, { requests: lobbyOpenRequests(ctx) });
      return true;
    }
    if (!requireMethod(request, response, 'POST')) return true;
    const body = await readJsonBody(request);
    // Variant tenants join the lobby on their own path; the chess gate would
    // 501 them as not-integrated, so the registry is consulted before it.
    const registration =
      typeof body.gameSpecId === 'string' ? variantTenantForSpecId(body.gameSpecId) : null;
    if (registration) {
      if (!registration.enabled()) {
        writeJson(response, 404, { error: `${registration.errorPrefix}_disabled` });
        return true;
      }
      if (!registration.lobby) {
        // Enabled but no matchmaking surface (Dark Xiangqi): same answer the
        // chess gate used to give for an enabled-but-unrouted spec.
        writeJson(response, 501, { error: `${registration.errorPrefix}_not_integrated` });
        return true;
      }
    } else {
      const gameSpecGate = gateGameSpecRequest({
        gameSpecId: body.gameSpecId,
        variant: body.variant,
      });
      if (gameSpecGate.type === 'reject') {
        writeJson(response, gameSpecGate.httpStatus, { error: gameSpecGate.error });
        return true;
      }
    }
    const tenantLobby = registration?.lobby ?? null;
    const timeControl =
      body.timeControl === undefined ? undefined : parseRoomTimeControl(body.timeControl);
    // Rated requires the flag on AND a signed-in requester. Reject explicit
    // guest/off-surface rated requests instead of silently creating casual
    // tickets that looked rated in the setup UI.
    const accountUser = body.rated === true ? await currentAccountUser(request) : null;
    if (body.rated === true && tenantLobby && !tenantLobby.supportsRated) {
      writeJson(response, 501, { error: 'rated_unsupported_surface' });
      return true;
    }
    if (body.rated === true && !ratedEnabled()) {
      writeJson(response, 403, { error: 'rated_disabled' });
      return true;
    }
    if (body.rated === true && !accountUser) {
      writeJson(response, 401, { error: 'rated_requires_account' });
      return true;
    }
    const lobbyRated = body.rated === true && accountUser !== null;
    if (body.timeControl !== undefined && !timeControl) {
      response.writeHead(400, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'invalid_time_control' }));
      return true;
    }
    // Matchmaking is scoped to official playable TCs so the queue can't fragment
    // into off-menu buckets; each tenant declares its own allowlist.
    if (
      timeControl &&
      (tenantLobby
        ? !tenantLobby.allowsTimeControl(timeControl)
        : !isAllowedTimeControl(timeControl))
    ) {
      response.writeHead(400, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'time_control_unsupported' }));
      return true;
    }
    if (lobbyRated && timeControl && !isAllowedRatedTimeControl(timeControl)) {
      response.writeHead(400, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'rated_time_control_unsupported' }));
      return true;
    }
    if (ctx.databaseRequired && !persistence.isInitialized()) {
      response.writeHead(503, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'persistence_disabled' }));
      return true;
    }
    if (ctx.isDraining()) {
      response.writeHead(503, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'server_draining', restartAt: ctx.drainDeadlineMs() }));
      return true;
    }
    // Registrations carry their tenant's typed gameSpecId; the registry holds
    // it erased to string.
    const gameSpecId = registration
      ? (registration.gameSpecId as LobbyTicket['gameSpecId'])
      : gameSpecForLegacyLiveRoom({ variant: 'dark-chess' }).id;
    const ticket = await joinLobby(
      ctx,
      gameSpecId,
      registration ?? null,
      timeControl ?? undefined,
      lobbyRated,
    );
    writeJson(response, ticket.roomId ? 201 : 202, lobbyTicketResponse(ticket));
    return true;
  }

  const lobbyMatch = pathname.match(/^\/api\/lobby\/([^/]+)$/);
  if (lobbyMatch) {
    pruneLobbyTickets(ctx);
    const ticketId = decodeURIComponent(lobbyMatch[1]!);
    const ticket = ctx.lobbyTickets.get(ticketId);
    if (!ticket) {
      writeJson(response, 404, { error: 'not_found' });
      return true;
    }
    if (method === 'GET') {
      writeJson(response, 200, lobbyTicketResponse(ticket));
      return true;
    }
    if (method === 'DELETE') {
      cancelLobbyTicket(ctx, ticketId);
      writeJson(response, 200, { ok: true });
      return true;
    }
    response.writeHead(405, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: 'method_not_allowed' }));
    return true;
  }

  return false;
}

async function joinLobby(
  ctx: HttpApiContext,
  gameSpecId: LobbyTicket['gameSpecId'],
  registration: VariantTenantRegistration | null,
  timeControl: RoomTimeControl | undefined,
  rated = false,
): Promise<LobbyTicket> {
  pruneLobbyTickets(ctx);
  const timeKey = timeControlKey(timeControl);
  // Tickets only match within the same game spec, so chess and variant-tenant
  // seekers never pair with each other even at the same time control.
  const matchedTicket = ctx.lobbyQueue.find(
    (ticket) =>
      ticket.roomId === null &&
      ticket.gameSpecId === gameSpecId &&
      ticket.rated === rated &&
      timeControlKey(ticket.timeControl) === timeKey,
  );
  const ticket: LobbyTicket = {
    id: randomUUID(),
    createdAt: Date.now(),
    gameSpecId,
    rated,
    region: null,
    matchedAt: null,
    roomId: null,
    timeControl,
  };
  ctx.lobbyTickets.set(ticket.id, ticket);

  if (!matchedTicket) {
    ctx.lobbyQueue.push(ticket);
    return ticket;
  }

  let room: { id: string; region: string };
  try {
    room = await createLobbyRoom(ctx, registration, timeControl, rated);
  } catch (err) {
    ctx.lobbyTickets.delete(ticket.id);
    throw err;
  }
  const matchedAt = Date.now();
  matchedTicket.matchedAt = matchedAt;
  matchedTicket.roomId = room.id;
  matchedTicket.region = room.region;
  ticket.matchedAt = matchedAt;
  ticket.roomId = room.id;
  ticket.region = room.region;
  const matchedIndex = ctx.lobbyQueue.findIndex((candidate) => candidate.id === matchedTicket.id);
  if (matchedIndex >= 0) ctx.lobbyQueue.splice(matchedIndex, 1);
  return ticket;
}

// Dispatch lobby room creation by game spec. Chess goes through the shared room
// factory exactly as before; variant tenants create through their registered
// lobby factory (PvP, random seating). A failure throws so the caller deletes
// the unmatched ticket.
async function createLobbyRoom(
  ctx: HttpApiContext,
  registration: VariantTenantRegistration | null,
  timeControl: RoomTimeControl | undefined,
  rated: boolean,
): Promise<{ id: string; region: string }> {
  if (registration?.lobby) {
    return registration.lobby.createRoom(timeControl, rated);
  }
  const room: Room = await ctx.createRoom(
    'pvp',
    'dark-chess',
    ctx.pveBuiltinEngineClientId,
    timeControl,
    rated,
    { randomSeating: true },
  );
  return { id: room.id, region: room.region ?? 'global' };
}

function cancelLobbyTicket(ctx: HttpApiContext, ticketId: string): void {
  const ticket = ctx.lobbyTickets.get(ticketId);
  if (!ticket || ticket.roomId !== null) return;
  ctx.lobbyTickets.delete(ticketId);
  const queueIndex = ctx.lobbyQueue.findIndex((candidate) => candidate.id === ticketId);
  if (queueIndex >= 0) ctx.lobbyQueue.splice(queueIndex, 1);
}

function pruneLobbyTickets(ctx: HttpApiContext, now = Date.now()): void {
  for (const [ticketId, ticket] of ctx.lobbyTickets) {
    if (now - ticket.createdAt >= lobbyTicketTtlMs) {
      ctx.lobbyTickets.delete(ticketId);
    }
  }
  for (let index = ctx.lobbyQueue.length - 1; index >= 0; index -= 1) {
    const ticket = ctx.lobbyQueue[index];
    if (!ticket || !ctx.lobbyTickets.has(ticket.id) || ticket.roomId !== null) {
      ctx.lobbyQueue.splice(index, 1);
    }
  }
}

function lobbyTicketResponse(ticket: LobbyTicket): Record<string, unknown> {
  return {
    ticketId: ticket.id,
    status: ticket.roomId ? 'matched' : 'waiting',
    gameSpecId: ticket.gameSpecId,
    pollAfterMs: lobbyPollAfterMs,
    ...(ticket.roomId
      ? {
          roomId: ticket.roomId,
          url: `/room/${encodeURIComponent(ticket.roomId)}`,
          region: ticket.region ?? 'global',
        }
      : {}),
  };
}

function lobbyOpenRequests(ctx: HttpApiContext): Array<Record<string, unknown>> {
  const now = Date.now();
  return ctx.lobbyQueue
    .filter((ticket) => ticket.roomId === null)
    .slice(0, 20)
    .map((ticket) => ({
      gameSpecId: ticket.gameSpecId,
      rated: ticket.rated,
      timeControl: ticket.timeControl ?? {
        initialMs: ctx.liveClockInitialMs,
        incrementMs: ctx.liveClockIncrementMs,
      },
      waitingMs: Math.max(0, now - ticket.createdAt),
    }));
}

function timeControlKey(timeControl: RoomTimeControl | undefined): string {
  return timeControl ? `${timeControl.initialMs}:${timeControl.incrementMs}` : 'default';
}
