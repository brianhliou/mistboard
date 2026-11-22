import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  gameSpecForLegacyLiveRoom,
  isRetiredGameSpec,
  JIEQI_SPEC_ID,
  type RoomTimeControl,
  XIANGQI_SPEC_ID,
} from '@mistboard/game';
import { currentAccountUser } from './../account-session.js';
import { captureServerEvent } from '../analytics-server.js';
import { isFairPlayMarked } from '../fair-play.js';
import { ratedEnabled } from './../feature-flags.js';
import { ffqBanqiAdmits, isFFQBanqiRequest } from './../ffq-banqi-access.js';
import { gateGameSpecRequest } from './../game-spec-request-gate.js';
import { liveGameIdentityForRequest } from '../live-game-admission.js';
import * as persistence from './../persistence.js';
import { createWithPairing } from './../room-pairing.js';
import type { LobbyTicket, Room } from './../server-types.js';
import {
  type VariantTenantRegistration,
  variantTenantForSpecId,
} from './../variant-tenant/registry.js';
import { createAsLobbyMatch } from './../variant-tenant/room-factory.js';
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
// An unmatched seek is alive only while its tab keeps polling GET
// /api/lobby/:id (every lobbyPollAfterMs). A closed tab or a backgrounded phone
// stops polling without sending the DELETE, and such a ticket used to stay listed
// and matchable for the whole TTL: whoever took it landed in a room its creator
// never entered (prod, 2026-10-02). Ten polls of slack covers a slow network or
// a throttled background timer; a seeker that misses all ten is gone.
export const LOBBY_TICKET_STALE_MS = 10_000;
// The variants whose bot setup shows an open casual seek (#1194; xiangqi added
// with jieqi, decided 2026-11-16). `GET /api/lobby?prompt=<id>` answers only
// for these, so the gate is one list on the server.
export const SEEK_PROMPT_GAME_SPECS: ReadonlySet<string> = new Set([
  JIEQI_SPEC_ID,
  XIANGQI_SPEC_ID,
]);
// Why a seek ended. `left` is a closed or backgrounded page; `bot_accepted` is
// the seeker taking the 15 s bot offer; `offer_taken` is a join that found the
// listed seek already gone and withdrew the ticket it had just made.
export type LobbySeekEndReason =
  | 'matched'
  | 'cancelled'
  | 'left'
  | 'expired'
  | 'bot_accepted'
  | 'offer_taken';
const CLIENT_SEEK_END_REASONS: ReadonlySet<string> = new Set([
  'left',
  'bot_accepted',
  'offer_taken',
]);
const seekTimers = new WeakMap<LobbyTicket, ReturnType<typeof setTimeout>>();

function scheduleSeekExpiry(ctx: HttpApiContext, ticket: LobbyTicket): void {
  clearTimeout(seekTimers.get(ticket));
  if (ticket.roomId !== null) return;
  const deadline = Math.min(
    ticket.createdAt + lobbyTicketTtlMs,
    ticket.lastPolledAt + LOBBY_TICKET_STALE_MS,
  );
  const timer = setTimeout(
    () => pruneLobbyTickets(ctx, lobbyNow(ctx)),
    Math.max(0, deadline - lobbyNow(ctx)),
  );
  timer.unref();
  seekTimers.set(ticket, timer);
}

function lobbyNow(ctx: HttpApiContext): number {
  return ctx.now?.() ?? Date.now();
}

// Matched tickets are exempt: the matched ticket is how a seeker who comes back
// finds its room, so it keeps the TTL however long it went quiet.
function isLiveSeek(ticket: LobbyTicket, now: number): boolean {
  return ticket.roomId === null && now - ticket.lastPolledAt < LOBBY_TICKET_STALE_MS;
}

export async function tryHandle(
  ctx: HttpApiContext,
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
): Promise<boolean> {
  const method = request.method ?? 'GET';

  if (pathname === '/api/lobby') {
    if (method === 'GET') {
      pruneLobbyTickets(ctx, lobbyNow(ctx));
      const prompt = new URL(request.url ?? '/api/lobby', 'http://localhost').searchParams.get(
        'prompt',
      );
      if (prompt !== null && !SEEK_PROMPT_GAME_SPECS.has(prompt)) {
        writeJson(response, 200, { requests: [] });
        return true;
      }
      writeJson(response, 200, { requests: await lobbyOpenRequests(ctx, request, prompt) });
      return true;
    }
    if (!requireMethod(request, response, 'POST')) return true;
    let body = await readJsonBody(request);
    if (isFFQBanqiRequest(body)) {
      const gate = gateGameSpecRequest(body, await currentAccountUser(request));
      if (gate.type === 'reject') {
        writeJson(response, gate.httpStatus, { error: gate.error });
        return true;
      }
      // The private admin playtest never posts public seeks.
      if (!ffqBanqiAdmits(null)) {
        writeJson(response, 501, { error: 'ffq_banqi_unsupported_surface' });
        return true;
      }
      if ([body.gameSpecId, body.variant].some((id) => id != null && id !== 'ffq-banqi')) {
        writeJson(response, 404, { error: 'unknown_game_spec' });
        return true;
      }
      if ((body.mode !== undefined && body.mode !== 'pvp') || body.daysPerMove !== undefined) {
        writeJson(response, 501, { error: 'ffq_banqi_unsupported_surface' });
        return true;
      }
      body = { ...body, gameSpecId: 'ffq-banqi' };
    }
    // Variant tenants join the lobby on their own path; the chess gate would
    // 501 them as not-integrated, so the registry is consulted before it.
    const registration =
      typeof body.gameSpecId === 'string' ? variantTenantForSpecId(body.gameSpecId) : null;
    if (registration) {
      // A retired variant keeps its tenant for replays but joins no lobby.
      if (isRetiredGameSpec(registration.gameSpecId)) {
        writeJson(response, 410, { error: 'retired_game_spec' });
        return true;
      }
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
      // An allowlisted variant (139) seeks only for an account holding the
      // grant. Without this a stranger's seek could pair a granted player into
      // a room whose other seat nobody is allowed to take.
      if (persistence.isAllowlistedGameSpec(registration.gameSpecId)) {
        const seeker = await currentAccountUser(request);
        if (!(await persistence.mayPlayVariant(seeker, registration.gameSpecId))) {
          writeJson(response, 403, { error: 'variant_not_granted' });
          return true;
        }
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
    const accountUser = await currentAccountUser(request);
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
    // A stats-excluded account (operator, QA) is not counted, so it never rates:
    // refused before a ticket exists, so it can neither post nor accept a rated
    // seek, and the rated room's seat gate refuses it again for a stale client.
    if (body.rated === true && persistence.isStatsExcluded(accountUser)) {
      writeJson(response, 403, { error: 'rated_requires_counted_account' });
      return true;
    }
    if (body.rated === true && isFairPlayMarked(accountUser)) {
      writeJson(response, 403, { error: 'rated_account_marked' });
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
    if (ctx.refusesCreate()) {
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
      liveGameIdentityForRequest(request, accountUser),
    );
    writeJson(response, ticket.roomId ? 201 : 202, lobbyTicketResponse(ticket));
    return true;
  }

  const lobbyMatch = pathname.match(/^\/api\/lobby\/([^/]+)$/);
  if (lobbyMatch) {
    const now = lobbyNow(ctx);
    pruneLobbyTickets(ctx, now);
    const ticketId = decodeURIComponent(lobbyMatch[1]!);
    const ticket = ctx.lobbyTickets.get(ticketId);
    if (!ticket) {
      writeJson(response, 404, { error: 'not_found' });
      return true;
    }
    if (method === 'GET') {
      // The seeker's own poll is the heartbeat that keeps its seek listed.
      ticket.lastPolledAt = now;
      scheduleSeekExpiry(ctx, ticket);
      writeJson(response, 200, lobbyTicketResponse(ticket));
      return true;
    }
    if (method === 'DELETE') {
      const how = new URL(request.url ?? '/api/lobby', 'http://localhost').searchParams.get('how');
      cancelLobbyTicket(
        ctx,
        ticketId,
        how !== null && CLIENT_SEEK_END_REASONS.has(how)
          ? (how as LobbySeekEndReason)
          : 'cancelled',
      );
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
  owner: LobbyTicket['owner'] = undefined,
): Promise<LobbyTicket> {
  const now = lobbyNow(ctx);
  pruneLobbyTickets(ctx, now);
  const timeKey = timeControlKey(timeControl);
  // Tickets only match within the same game spec, so chess and variant-tenant
  // seekers never pair with each other even at the same time control. A seek
  // whose tab stopped polling is never a match (pruned above; re-checked here so
  // the rule holds even if the prune changes).
  const matchedTicket = ctx.lobbyQueue.find(
    (ticket) =>
      isLiveSeek(ticket, now) &&
      !sameLobbyPlayer(ticket.owner, owner) &&
      ticket.gameSpecId === gameSpecId &&
      ticket.rated === rated &&
      timeControlKey(ticket.timeControl) === timeKey,
  );
  const ticket: LobbyTicket = {
    id: randomUUID(),
    seekId: randomUUID(),
    owner,
    createdAt: now,
    lastPolledAt: now,
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
    scheduleSeekExpiry(ctx, ticket);
    return ticket;
  }

  let room: { id: string; region: string };
  // Claim the waiting seek before the asynchronous room factory, so concurrent
  // acceptances cannot pair the same waiting player twice.
  const matchedIndex = ctx.lobbyQueue.indexOf(matchedTicket);
  if (matchedIndex >= 0) ctx.lobbyQueue.splice(matchedIndex, 1);
  try {
    room = await createLobbyRoom(ctx, registration, timeControl, rated);
  } catch (err) {
    ctx.lobbyTickets.delete(ticket.id);
    if (ctx.lobbyTickets.has(matchedTicket.id)) ctx.lobbyQueue.push(matchedTicket);
    throw err;
  }
  const matchedAt = lobbyNow(ctx);
  matchedTicket.matchedAt = matchedAt;
  matchedTicket.roomId = room.id;
  matchedTicket.region = room.region;
  ticket.matchedAt = matchedAt;
  ticket.roomId = room.id;
  ticket.region = room.region;
  endLobbySeek(ctx, matchedTicket, 'matched', matchedAt);
  // The joining ticket never waited: mark it, so a match counts once.
  endLobbySeek(ctx, ticket, 'matched', matchedAt, true);
  return ticket;
}

export function sameLobbyPlayer(a: LobbyTicket['owner'], b: LobbyTicket['owner']): boolean {
  return Boolean(
    (a?.userId && a.userId === b?.userId) || (a?.deviceId && a.deviceId === b?.deviceId),
  );
}

function endLobbySeek(
  ctx: HttpApiContext,
  ticket: LobbyTicket,
  reason: LobbySeekEndReason,
  now: number,
  joined = false,
): void {
  if (ticket.seekEnded) return;
  ticket.seekEnded = true;
  clearTimeout(seekTimers.get(ticket));
  seekTimers.delete(ticket);
  const initialMs = ticket.timeControl?.initialMs ?? ctx.liveClockInitialMs;
  const incrementMs = ticket.timeControl?.incrementMs ?? ctx.liveClockIncrementMs;
  const waitMs = Math.max(0, now - ticket.createdAt);
  // One line per seek end, so the queue can be read from the deploy logs when
  // analytics is off or blocked. No account or browser id: the line is not
  // attribution.
  (ctx.logLobbySeekEnd ?? console.log)(
    `[lobby] seek ended reason=${reason} gameSpecId=${ticket.gameSpecId} rated=${ticket.rated} clock=${initialMs}+${incrementMs} waitMs=${waitMs} joined=${joined} seekId=${ticket.seekId ?? 'none'}`,
  );
  void captureServerEvent({
    event: 'lobby_seek_ended',
    // Never ticket.id, not even as the fallback identity: it is the private
    // token that polls and withdraws the seek, and a matched ticket still
    // answers with its room. The public seekId stands in for a browserless seek.
    distinctId:
      ticket.owner?.userId ?? ticket.owner?.deviceId ?? ticket.seekId ?? 'lobby-anonymous',
    properties: {
      seekId: ticket.seekId,
      gameSpecId: ticket.gameSpecId,
      rated: ticket.rated,
      initialMs,
      incrementMs,
      reason,
      waitMs,
      joined,
    },
  });
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
  // Both paths mark the room as a lobby match: it gets the short no-show window
  // instead of an invite room's long join window, and its client shows no
  // invite prompt (lifecycle-windows.ts LOBBY_NO_SHOW_ABORT_MS).
  // Both also carry the 'lobby' pairing for game_started (#1229).
  return createWithPairing('lobby', async () => {
    const lobby = registration?.lobby;
    if (lobby) {
      return createAsLobbyMatch(() => lobby.createRoom(timeControl, rated));
    }
    const room: Room = await ctx.createRoom(
      'pvp',
      'dark-chess',
      ctx.pveBuiltinEngineClientId,
      timeControl,
      rated,
      { randomSeating: true, lobbyMatch: true },
    );
    return { id: room.id, region: room.region ?? 'global' };
  });
}

function cancelLobbyTicket(ctx: HttpApiContext, ticketId: string, how: LobbySeekEndReason): void {
  const ticket = ctx.lobbyTickets.get(ticketId);
  if (!ticket || ticket.roomId !== null) return;
  endLobbySeek(ctx, ticket, how, lobbyNow(ctx));
  ctx.lobbyTickets.delete(ticketId);
  const queueIndex = ctx.lobbyQueue.findIndex((candidate) => candidate.id === ticketId);
  if (queueIndex >= 0) ctx.lobbyQueue.splice(queueIndex, 1);
}

function pruneLobbyTickets(ctx: HttpApiContext, now: number): void {
  for (const [ticketId, ticket] of ctx.lobbyTickets) {
    const expired = now - ticket.createdAt >= lobbyTicketTtlMs;
    const abandonedSeek = ticket.roomId === null && !isLiveSeek(ticket, now);
    if (expired || abandonedSeek) {
      if (ticket.roomId === null) {
        const expiresAt = ticket.createdAt + lobbyTicketTtlMs;
        const leftAt = ticket.lastPolledAt + LOBBY_TICKET_STALE_MS;
        // A quiet lobby may not be read until long after the owner left. Use
        // the first deadline crossed, rather than reporting an idle tab as a
        // five-minute expiry or counting idle time until the next visitor.
        endLobbySeek(
          ctx,
          ticket,
          expiresAt <= leftAt ? 'expired' : 'left',
          Math.min(expiresAt, leftAt),
        );
      }
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

// The public seek list. A seek on an allowlisted variant (139) is listed only to
// a reader who may play it: to everyone else the variant does not exist yet, so
// its name must not reach them through the lobby either.
async function lobbyOpenRequests(
  ctx: HttpApiContext,
  request: IncomingMessage,
  prompt: string | null = null,
): Promise<Array<Record<string, unknown>>> {
  const now = lobbyNow(ctx);
  const viewer = prompt
    ? liveGameIdentityForRequest(request, await currentAccountUser(request))
    : undefined;
  const identifiedViewer = Boolean(viewer?.userId || viewer?.deviceId);
  const live = ctx.lobbyQueue.filter(
    (ticket) =>
      isLiveSeek(ticket, now) &&
      (!prompt ||
        (identifiedViewer &&
          ticket.gameSpecId === prompt &&
          !ticket.rated &&
          Boolean(ticket.owner?.userId || ticket.owner?.deviceId) &&
          !sameLobbyPlayer(ticket.owner, viewer))),
  );
  const gated = [
    ...new Set(
      live
        .map((ticket) => ticket.gameSpecId as string)
        .filter((specId) => persistence.isAllowlistedGameSpec(specId)),
    ),
  ];
  const visible = new Set<string>();
  if (gated.length > 0) {
    const reader = await currentAccountUser(request);
    for (const specId of gated) {
      if (await persistence.mayPlayVariant(reader, specId)) visible.add(specId);
    }
  }
  return live
    .filter(
      (ticket) =>
        (ticket.gameSpecId !== 'ffq-banqi' || ffqBanqiAdmits(null)) &&
        (!persistence.isAllowlistedGameSpec(ticket.gameSpecId) || visible.has(ticket.gameSpecId)),
    )
    .slice(0, 20)
    .map((ticket) => ({
      // ticket.id authorizes heartbeat and withdrawal; it stays private to the
      // creator. The separate public id only deduplicates prompt impressions.
      ...(prompt ? { seekId: ticket.seekId } : {}),
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
