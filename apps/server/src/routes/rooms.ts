import { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  DARK_CHESS_SPEC_ID,
  defaultEngineTimeControl,
  engineTimeControlPin,
  type GameSpecId,
  isAllowedEngineTimeControl,
} from '@mistboard/game';
import { currentAccountUser } from './../account-session.js';
import { isBotSpecPlayable, parsePublicBotId } from './../bot-profile-policy.js';
import { playableLiveEngines } from './../engine-registry.js';
import { ratedEnabled } from './../feature-flags.js';
import { firstPartyBotEngineFor, firstPartyBotForId } from './../first-party-bots.js';
import { gateGameSpecRequest } from './../game-spec-request-gate.js';
import { InternalEngineClientError } from './../internal-engine-client.js';
import { engineCounters, logger } from './../obs.js';
import * as persistence from './../persistence.js';
import { registeredVariantTenants } from './../variant-tenant/registry.js';
import {
  type HttpApiContext,
  isAllowedRatedTimeControl,
  isAllowedTimeControl,
  parseRoomTimeControl,
  parseVariantId,
  readJsonBody,
  requireMethod,
  writeJson,
} from './lib.js';

export async function tryHandle(
  ctx: HttpApiContext,
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
): Promise<boolean> {
  if (pathname === '/api/rooms') {
    if (!requireMethod(request, response, 'POST')) return true;
    const rawBody = await readJsonBody(request);
    const body = await resolveBotRoomRequest(response, rawBody);
    if (!body) return true;
    // Variant tenants claim their create requests via the registry; each
    // tenant's handler owns its flag/rated/engine gates and error strings.
    // A registry miss falls through to the chess path below.
    for (const registration of registeredVariantTenants()) {
      if (registration.http.matchesCreateRequest(body)) {
        await registration.http.handleCreate(ctx, request, response, body);
        return true;
      }
    }
    const gameSpecGate = gateGameSpecRequest({
      gameSpecId: body.gameSpecId,
      variant: body.variant,
    });
    if (gameSpecGate.type === 'reject') {
      writeJson(response, gameSpecGate.httpStatus, { error: gameSpecGate.error });
      return true;
    }
    const mode = parseRoomMode(body);
    const variant = parseVariantId(typeof body.variant === 'string' ? body.variant : null);
    const engineId = mode === 'pve' ? parsePlayablePveEngineId(body.engineId) : null;
    // preferredColor: caller's requested side. Three explicit values
    // ('white' | 'black' | 'random') OR omitted entirely:
    //   - 'white' / 'black' → deterministic. PvE pre-seats engine on the
    //     opposite side; PvP stores creatorPreference so first arrival
    //     gets the requested color and second arrival gets the other.
    //   - 'random' → coinflip. PvE picks engine seat at creation; PvP
    //     uses randomSeating on connect.
    //   - omitted → backward-compat. Legacy first-come-first-served:
    //     creator (first arrival) gets white, invitee gets black. PvE
    //     falls through to the legacy engineColor body field (still
    //     accepted for smoke scripts/bots), then seats the HUMAN as the
    //     first mover — matching resolveFirstMoverHumanSeat, which every
    //     tenant route uses. An omitted side means "nobody asked", and
    //     nobody asking should not cost the player the opening move.
    // Distinguishing omitted from explicit 'random' is load-bearing for
    // the documented backward-compat contract.
    const preferredColor: 'white' | 'black' | 'random' | undefined =
      body.preferredColor === 'white' ||
      body.preferredColor === 'black' ||
      body.preferredColor === 'random'
        ? body.preferredColor
        : undefined;
    let engineColor: 'white' | 'black';
    if (mode === 'pve') {
      if (preferredColor === 'white') engineColor = 'black';
      else if (preferredColor === 'black') engineColor = 'white';
      else if (preferredColor === 'random')
        engineColor = randomBytes(1)[0]! < 128 ? 'white' : 'black';
      else if (body.engineColor === 'white') engineColor = 'white';
      else if (body.engineColor === 'black') engineColor = 'black';
      else engineColor = 'black';
    } else {
      engineColor = 'black';
    }
    const pvpRandomSeating = mode === 'pvp' && preferredColor === 'random';
    const pvpCreatorPreference: 'white' | 'black' | undefined =
      mode === 'pvp' && (preferredColor === 'white' || preferredColor === 'black')
        ? preferredColor
        : undefined;
    const timeControl =
      body.timeControl === undefined ? undefined : parseRoomTimeControl(body.timeControl);
    if (!mode) {
      response.writeHead(400, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'invalid_mode' }));
      return true;
    }
    // Engine games are never rated. Explicit rated requests are account-gated
    // before room creation so guests cannot accidentally start a casual room
    // that looked rated in the setup UI.
    const accountUser = mode === 'pve' ? null : await currentAccountUser(request);
    if (body.rated === true && mode === 'pve') {
      response.writeHead(501, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'rated_unsupported_surface' }));
      return true;
    }
    if (body.rated === true && !ratedEnabled()) {
      response.writeHead(403, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'rated_disabled' }));
      return true;
    }
    if (body.rated === true && !accountUser) {
      response.writeHead(401, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'rated_requires_account' }));
      return true;
    }
    const rated =
      mode === 'pve' ? false : ratedEnabled() && body.rated !== false && accountUser !== null;
    if (body.timeControl !== undefined && !timeControl) {
      response.writeHead(400, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'invalid_time_control' }));
      return true;
    }
    if (mode === 'pve' && body.engineId !== undefined && !engineId) {
      response.writeHead(400, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'invalid_engine' }));
      return true;
    }
    // Dark-chess (PvE + PvP) is scoped to the three official live time controls:
    // server-side defense in depth so a hand-crafted POST can't create an
    // off-menu pace or matchmaking/rating bucket; the UI picker mirrors it.
    // (Xiangqi variants are delegated above, so this only sees dark-chess.)
    if (timeControl && !isAllowedTimeControl(timeControl)) {
      response.writeHead(400, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'time_control_unsupported' }));
      return true;
    }
    if (rated && timeControl && !isAllowedRatedTimeControl(timeControl)) {
      response.writeHead(400, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'rated_time_control_unsupported' }));
      return true;
    }
    // An engine that cannot honor a pace must not be handed one. Fog Chess Misty
    // loses on time at 3+2 and worse at 1+1 (#283), so PvE there is pinned to
    // 5+5 by the shared policy the picker narrows to. Same defense-in-depth as
    // the off-menu check above: the UI mirrors this, it does not enforce it.
    // (Tenant variants delegate before this point; none is pinned today, so
    // their own create handlers do not need the check yet.)
    //
    // An OMITTED time control resolves to the pin rather than falling through to
    // the room factory's default clock, which is the house 3+2 — the very pace
    // the pin exists to refuse. Callers that name no pace (the prod engine
    // smokes, bot clients) would otherwise bypass the pin entirely. An EXPLICIT
    // off-pin pace is still refused, because the caller asked for something the
    // engine cannot play.
    const createdGameSpecId: GameSpecId = DARK_CHESS_SPEC_ID;
    const enginePin = mode === 'pve' ? engineTimeControlPin(createdGameSpecId) : null;
    if (
      mode === 'pve' &&
      timeControl &&
      !isAllowedEngineTimeControl(createdGameSpecId, timeControl)
    ) {
      response.writeHead(400, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'engine_time_control_unsupported' }));
      return true;
    }
    const effectiveTimeControl =
      timeControl ??
      (enginePin ? { initialMs: enginePin.initialMs, incrementMs: enginePin.incrementMs } : null);
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
    const selectedEngineId = engineId ?? ctx.pveBuiltinEngineClientId;
    const selectedBotId = mode === 'pve' && typeof body.botId === 'string' ? body.botId : null;
    let engineReservationId: string | null = null;
    try {
      if (mode === 'pve') {
        engineReservationId = await ctx.reserveLiveEngineSeat(selectedEngineId, engineColor);
      }
      const room = await ctx.createRoom(
        mode,
        variant,
        selectedEngineId,
        effectiveTimeControl ?? undefined,
        rated,
        {
          engineColor,
          ...(engineReservationId ? { engineReservationId } : {}),
          ...(selectedBotId ? { botId: selectedBotId } : {}),
          ...(pvpRandomSeating ? { randomSeating: true } : {}),
          ...(pvpCreatorPreference ? { creatorPreference: pvpCreatorPreference } : {}),
        },
      );
      response.writeHead(201, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          roomId: room.id,
          url: `/room/${encodeURIComponent(room.id)}`,
          mode: room.mode,
          gameSpecId: room.gameSpecId,
          region: room.region ?? 'global',
        }),
      );
      return true;
    } catch (err) {
      if (engineReservationId) {
        ctx.releaseLiveEngineReservation(engineReservationId, 'room-create-failed');
      }
      if (err instanceof InternalEngineClientError) {
        const busy = err.reason === 'http_error' && err.status === 429;
        engineCounters.recordReservationFailure({ busy });
        logger.warn(
          {
            kind: 'live_engine_reservation_failed',
            engine_id: selectedEngineId,
            color: engineColor,
            engine_error_reason: err.reason,
            status: err.status ?? null,
            timeout_ms: err.timeoutMs ?? null,
            message: err.message,
          },
          'live engine reservation failed',
        );
        writeJson(response, 503, {
          error: busy ? 'engine_busy' : 'engine_unavailable',
        });
        return true;
      }
      throw err;
    }
  }

  const abandonMatch = pathname.match(/^\/api\/rooms\/([^/]+)\/abandon$/);
  if (abandonMatch) {
    if (!requireMethod(request, response, 'POST')) return true;
    const roomId = decodeURIComponent(abandonMatch[1]!);
    const body = await readJsonBody(request);
    const seatToken = typeof body.seatToken === 'string' ? body.seatToken : '';
    if (!seatToken) {
      writeJson(response, 400, { error: 'missing_seat_token' });
      return true;
    }
    const result = await ctx.abandonRoom(roomId, seatToken);
    if (result.ok) {
      writeJson(response, 200, { ok: true });
      return true;
    }
    const statusByError = { not_found: 404, unauthorized: 401, already_terminal: 409 } as const;
    writeJson(response, statusByError[result.error], { error: result.error });
    return true;
  }

  return false;
}

export async function resolveBotRoomRequest(
  response: ServerResponse,
  body: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  if (body.botId === undefined) return body;
  const requestedBotId = parsePublicBotId(body.botId);
  if (!requestedBotId) {
    writeJson(response, 400, { error: 'invalid_bot_id' });
    return null;
  }
  if (!persistence.isInitialized()) {
    writeJson(response, 503, { error: 'persistence_disabled' });
    return null;
  }
  if (body.mode !== undefined && body.mode !== 'pve') {
    writeJson(response, 400, { error: 'bot_requires_pve' });
    return null;
  }
  if (body.engineId !== undefined) {
    writeJson(response, 400, { error: 'bot_engine_conflict' });
    return null;
  }
  // Pre-consolidation bot ids keep working: canonicalize before the DB lookup
  // (the merged profile is the public row; legacy rows are unlisted).
  const botId = firstPartyBotForId(requestedBotId)?.id ?? requestedBotId;
  const bot = await persistence.getPublicBotForPlay(botId);
  if (!bot) {
    writeJson(response, 404, { error: 'bot_not_found' });
    return null;
  }
  // A multi-variant bot accepts any of its supported specs; omitted picks the
  // bot's default. The per-spec engine comes from the first-party profile;
  // single-variant (community) bots keep their stored engine.
  const gameSpecId = body.gameSpecId === undefined ? bot.play.gameSpecId : body.gameSpecId;
  if (
    typeof gameSpecId !== 'string' ||
    !(gameSpecId === bot.play.gameSpecId || bot.supportedGameSpecIds.includes(gameSpecId))
  ) {
    writeJson(response, 400, { error: 'bot_game_spec_conflict' });
    return null;
  }
  if (!isBotSpecPlayable(gameSpecId)) {
    writeJson(response, 404, { error: 'bot_not_found' });
    return null;
  }
  const engineId =
    firstPartyBotEngineFor(botId, gameSpecId) ??
    (gameSpecId === bot.play.gameSpecId ? bot.play.engineId : null);
  if (!engineId) {
    writeJson(response, 400, { error: 'bot_game_spec_conflict' });
    return null;
  }
  // The caller may pick any pace the target surface allows (the tenant/chess
  // time-control gates downstream stay authoritative); omitted resolves to
  // shared policy, NOT to the bot's stored clock.
  //
  // bot_profiles.play_initial_ms/play_increment_ms is DB state that predates
  // both the engine pin and the per-variant defaults, and every row still reads
  // the house 3+2. It is also the wrong SHAPE: one pace per BOT, where the
  // right pace belongs to the VARIANT — fairy-stockfish-level-N serves xiangqi
  // (10+5) and fortress-xiangqi (3+2), which one column cannot express. So the
  // profile is not the authority on what pace to start, and migrating the rows
  // would only re-create this drift the next time a default moves.
  //
  // defaultEngineTimeControl applies the pin first (a hard constraint: the fog
  // engines lose on time at 3+2, #283), then the variant default. An EXPLICIT
  // off-pin request still falls through to the create gate and is refused
  // there.
  const resolved = defaultEngineTimeControl(gameSpecId);
  let timeControl = { initialMs: resolved.initialMs, incrementMs: resolved.incrementMs };
  if (body.timeControl !== undefined) {
    const requested = parseRoomTimeControl(body.timeControl);
    if (!requested) {
      writeJson(response, 400, { error: 'bot_time_control_conflict' });
      return null;
    }
    timeControl = requested;
  }
  return {
    ...body,
    botId,
    mode: 'pve',
    gameSpecId,
    engineId,
    timeControl,
    // preferredColor is deliberately NOT defaulted here: `...body` carries an
    // explicit request through, and an absent one stays absent so the seat
    // resolvers seat the human as the first mover. bot.play.preferredColor is a
    // hardcoded 'random' advertised on the profile, and reading it here is what
    // used to coin-flip every one-click bot start.
    rated: body.rated ?? false,
    ...(gameSpecId === 'dark-chess' ? { variant: 'dark-chess' } : {}),
  };
}

function parseRoomMode(body: Record<string, unknown>): 'pvp' | 'pve' | null {
  if (body.mode === 'pvp' || body.mode === 'pve') return body.mode;
  return null;
}

function parsePlayablePveEngineId(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  return playableLiveEngines().some((engine) => engine.id === value) ? value : null;
}
