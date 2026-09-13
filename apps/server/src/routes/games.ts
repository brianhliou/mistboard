import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Color, GameEvent, GameExportFormat, TimeClass } from '@mistboard/game';
import { currentAccountUser } from './../account-session.js';
import { buildCrosstable, CROSSTABLE_GAME_LIMIT, resolveCrosstablePair } from './../crosstable.js';
import {
  type DarkChessAnalysisPublication,
  resolveDarkChessAnalysis,
} from './../dark-chess-analysis.js';
import { resolveDarkChessDecisions } from './../dark-chess-decisions.js';
import {
  decisionLogAvailable,
  devArtifactPayloads,
  devArtifactSummaries,
} from './../dev-decision-log-artifacts.js';
import { FinishedGameCache } from './../finished-game-cache.js';
import { attachFlipFirstColors } from './../flip-first-color.js';
import { resolveGameExport } from './../game-export-tenant.js';
import { internalEngineAnalysisConfigured } from './../internal-engine-client.js';
import * as persistence from './../persistence.js';
import { LIVE_ENGINE_DECISION_ARTIFACT_TYPE } from './../persistence-game-lifecycle.js';
import type { RecentEveGameRecord } from './../persistence-games.js';
import { eventReplayResponse, parsePositiveInteger } from './../server-policy.js';
import { listWatchChannels, type WatchChannel, watchChannelForId } from './../watch-channels.js';
import {
  collectLiveTvCandidates,
  electLiveTvFeatured,
  isLiveTvChannelId,
  LIVE_TV_TOP_CHANNEL_ID,
  liveWatchPayloadForFeatured,
} from './../watch-live.js';
import {
  cachedWatchRail,
  storeWatchRail,
  type WatchRailRow,
  withFreshRow,
} from './../watch-rail-cache.js';
import { createGameAnalysisRoutes } from './game-analysis-route.js';
import {
  type HttpApiContext,
  isHttpAdminAuthorized,
  isHttpAdminSession,
  type PostgamePlayer,
  postgamePlayers,
  requireAdminSession,
  requireMethod,
  requirePersistence,
  writeJson,
} from './lib.js';

// The first three come from the EvE/bakeoff path; the shared constant is the
// LIVE PvE writer's type. Omitting it made every live PvE artifact
// unrequestable — see #287.
type ReviewArtifactType =
  | 'belief-snapshot'
  | 'trace-row'
  | 'engine-move-choice'
  | typeof LIVE_ENGINE_DECISION_ARTIFACT_TYPE;

const WATCH_REPLAY_LIMIT = 64;
const WATCH_SEALED_ACTIVITY_WINDOW_MS = 24 * 60 * 60 * 1000;

type WatchChannelTopPlayer = { name: string; rating: number | null };

// Bot and engine seats. Everything else ('guest', 'user', and the 'manual' /
// 'imported' seats carried by historical games) is a person.
const MACHINE_SUBJECT_TYPES: ReadonlySet<string> = new Set(['bot', 'engine-version']);

type ChannelSeat = { name: string; rating: number | null; machine: boolean };

// Highest-rated seat, else the first named one, over whichever pool it is given.
function pickHeadlineSeat(seats: ChannelSeat[]): WatchChannelTopPlayer | null {
  let best: WatchChannelTopPlayer | null = null;
  let fallback: WatchChannelTopPlayer | null = null;
  for (const seat of seats) {
    fallback ??= { name: seat.name, rating: seat.rating };
    if (seat.rating != null && (best === null || seat.rating > best.rating!)) {
      best = { name: seat.name, rating: seat.rating };
    }
  }
  return best ?? fallback;
}

// The headline seat for a channel's rail row (lichess shows the featured game's
// top player under the channel name).
//
// People come first. Ranking purely by rating put the BOT on most PvE channels'
// rail rows, because a bot carries a calibrated rating while its human opponent
// is usually an unrated guest, so the rail advertised "Misty" across half the
// variants. A channel with any human seat now names a human; only a channel
// with no human seat at all (Engines, which is EvE by construction) falls back
// to naming the machine.
//
// Within the chosen pool the old rule stands: highest-rated seat, else the
// freshest named one. null for an empty channel, so the row renders name-only.
export function channelTopPlayer(games: RecentEveGameRecord[]): WatchChannelTopPlayer | null {
  const seats: ChannelSeat[] = [];
  for (const game of games) {
    const gameSeats: ChannelSeat[] =
      game.participants.length > 0
        ? game.participants.map((participant) => ({
            name: participant.displayName?.trim() || '',
            rating: participant.ratingAfter ?? participant.ratingBefore ?? null,
            machine: MACHINE_SUBJECT_TYPES.has(participant.subjectType),
          }))
        : // Legacy/imported rows carry no participant subjects; both seats are
          // people as far as this rail is concerned.
          [
            { name: game.whiteName?.trim() || '', rating: null, machine: false },
            { name: game.blackName?.trim() || '', rating: null, machine: false },
          ];
    for (const seat of gameSeats) {
      if (seat.name) seats.push(seat);
    }
  }
  const humans = seats.filter((seat) => !seat.machine);
  return pickHeadlineSeat(humans.length > 0 ? humans : seats);
}

const PROMOTION_LETTER: Record<string, string> = {
  queen: 'q',
  rook: 'r',
  bishop: 'b',
  knight: 'n',
};

// The variant values fog chess games are PERSISTED under. This is the DB
// spelling, which is NOT the event log's kernel label ('fog-of-war') — matching
// on that returns null for every game, so the route 404s everywhere. 'fog' is
// the legacy value carried by rooms recorded before the rename; both are the
// same variant and both analyse.
const FOG_CHESS_PERSISTED_VARIANTS = new Set(['dark-chess', 'fog']);

/** Exported for tests: the DB-spelling gate that decides whether a finished game is a
 *  fog chess game. The original wiring matched 'fog-of-war' (the event log's kernel
 *  label, never a persisted value) and so 404'd for every game. */
export function isFogChessPersistedVariant(variant: string): boolean {
  return FOG_CHESS_PERSISTED_VARIANTS.has(variant);
}

// Analysis inputs: a minimal publication-shaped payload (game id + ordered
// UCI move list) for a FINISHED fog game. getGameSummary only returns rows with
// status='completed', so a recorded summary IS the finished-gate — same trust as
// the postgame page.
async function loadFinishedDarkChessGameInputs(
  roomId: string,
): Promise<DarkChessAnalysisPublication | null> {
  const summary = await persistence.getGameSummary(roomId);
  if (!summary || !FOG_CHESS_PERSISTED_VARIANTS.has(summary.variant)) return null;
  const events = await persistence.loadRoomEvents<GameEvent>(roomId);
  if (!events) return null;
  const plies: DarkChessAnalysisPublication['plies'] = [];
  for (const event of events) {
    if (event.type !== 'move-played') continue;
    const move = event.move;
    const promo = move.promotion ? (PROMOTION_LETTER[move.promotion] ?? '') : '';
    plies.push({
      ply: plies.length + 1,
      mover: event.color,
      uci: `${move.from}${move.to}${promo}`,
    });
  }
  if (plies.length === 0) return null;
  return {
    schema_version: 'route/1',
    game_id: roomId,
    variant: 'fog-of-war',
    plies,
  };
}

// Computer analysis for finished fog games: the standard eval track plus the
// fog layer (belief/sample/decision verdicts), computed on the engine-worker
// via the internal analyze endpoint. Gates/envelopes/queue: the shared
// factory — GET/POST /api/dark-chess/games/:id/analysis (+ /jobs/:jobId).
const handleAnalysisRoutes = createGameAnalysisRoutes({
  routeId: 'dark-chess',
  logPrefix: 'dark-chess',
  variantLabel: 'Fog of War',
  enabled: () => true,
  requiresPersistence: true,
  // Fail closed: analysis is the misty engine service only. Missing config is
  // a broken deploy — surface 503, never a weaker eval.
  engineBinary: {
    available: internalEngineAnalysisConfigured,
    label: 'internal engine service (misty)',
  },
  loadInputs: loadFinishedDarkChessGameInputs,
  countPlies: (inputs) => inputs.plies.length,
  // EVERY fog ply is a chance ply. jieqi marks only its reveals, because only
  // there is the outcome decided by something the mover could not see; under fog
  // that is true of every move. Marking them stops the truth eval from judging
  // (it keeps the chart and the per-move eval) and hands grading to the decision
  // layer, so the glyph, the label and the alternatives all come from Misty and
  // can no longer disagree. Before this, ply 21 was labelled an Inaccuracy by
  // Stockfish while Misty scored its decision loss at 0.0 — the page accused the
  // player of an error it had already decided was unavoidable.
  analysisExtras: (inputs) => ({ chancePlies: inputs.plies.map((ply) => ply.ply) }),
  resolveAnalysis: (roomId, inputs, computeIfMissing) =>
    resolveDarkChessAnalysis(roomId, inputs, undefined, undefined, computeIfMissing),
  // Ranked alternatives per ply. Free relative to the analysis: Misty's solve already scores
  // every root move, so this only projects the cached row — no second pass, no second cache
  // entry. Presence of this resolver is what enables /api/dark-chess/games/:id/decisions.
  resolveDecisions: (roomId, inputs, computeIfMissing) =>
    resolveDarkChessDecisions(roomId, inputs, computeIfMissing),
});

export async function tryHandle(
  ctx: HttpApiContext,
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  parsedUrl: URL,
): Promise<boolean> {
  const url = request.url ?? '/';

  if (await handleAnalysisRoutes(request, response, pathname)) return true;

  if (pathname === '/api/games/favorites') {
    if (!requireMethod(request, response, 'GET')) return true;
    if (!requirePersistence(response)) return true;
    const user = await currentAccountUser(request);
    if (!user) {
      writeJson(response, 401, { error: 'authentication_required' });
      return true;
    }
    const offset = boundedInt(parsedUrl.searchParams.get('offset'), 0, 0, Number.MAX_SAFE_INTEGER);
    const limit = boundedInt(parsedUrl.searchParams.get('limit'), 15, 1, 50);
    const page = await persistence.listFavoriteGames(user.id, offset, limit);
    writeJson(response, 200, page);
    return true;
  }

  const favoriteMatch = pathname.match(/^\/api\/games\/([^/]+)\/favorite$/);
  if (favoriteMatch) {
    const roomId = decodeURIComponent(favoriteMatch[1]!);
    const user = await currentAccountUser(request);
    if (request.method === 'GET' && !user) {
      writeJson(response, 200, { authenticated: false, favorited: false });
      return true;
    }
    if (!requirePersistence(response)) return true;
    if (!user) {
      writeJson(response, 401, { error: 'authentication_required' });
      return true;
    }

    if (request.method === 'GET') {
      const state = await persistence.getGameFavoriteState(roomId, user.id);
      if (!state.accessible) {
        writeJson(response, 404, { error: 'not_found' });
        return true;
      }
      writeJson(response, 200, { authenticated: true, favorited: state.favorited });
      return true;
    }

    if (request.method === 'PUT' || request.method === 'DELETE') {
      const state = await persistence.setGameFavorite(roomId, user.id, request.method === 'PUT');
      if (!state.accessible) {
        writeJson(response, 404, { error: 'not_found' });
        return true;
      }
      writeJson(response, 200, { authenticated: true, favorited: state.favorited });
      return true;
    }

    response.setHeader('allow', 'GET, PUT, DELETE');
    writeJson(response, 405, { error: 'method_not_allowed' });
    return true;
  }

  // Mistboard TV live feed: the featured in-progress game for a channel (or the
  // cross-channel 'top' default), carrying the tenant's postgame-shaped live
  // payload so the existing watch renderers can draw it. Only open-visibility
  // games with a registered live-payload builder are ever featured
  // (watch-live.ts is fail-closed on fog / hidden-identity, and
  // capability-gated on rendering). In-memory rooms only — no persistence
  // required, so the surface works identically under dev:memory. A client
  // already following the featured room passes `?room=<id>&ply=<n>` and the
  // payload is omitted while the position is unchanged.
  if (pathname === '/api/watch/live') {
    if (!requireMethod(request, response, 'GET')) return true;
    const channelId = parsedUrl.searchParams.get('channel') ?? LIVE_TV_TOP_CHANNEL_ID;
    if (!isLiveTvChannelId(channelId)) {
      writeJson(response, 404, { error: 'unknown_watch_channel' });
      return true;
    }
    const now = new Date();
    const featured = electLiveTvFeatured(channelId, collectLiveTvCandidates(ctx, now.getTime()));
    if (!featured) {
      writeJson(response, 200, { channel: channelId, featured: null, now: now.toISOString() });
      return true;
    }
    const knownRoom = parsedUrl.searchParams.get('room');
    const knownPly = parseNonNegativeInt(parsedUrl.searchParams.get('ply'));
    const unchanged =
      knownRoom === featured.roomId && knownPly !== null && knownPly >= featured.ply;
    let payload: Record<string, unknown> | null = null;
    if (!unchanged) {
      payload = await liveWatchPayloadForFeatured(featured);
      if (!payload) {
        // The room moved on between election and payload build (e.g. it just
        // finished): withhold the moment this poll rather than serve a stale
        // board; the finished game reaches the client via the replay pool.
        writeJson(response, 200, { channel: channelId, featured: null, now: now.toISOString() });
        return true;
      }
    }
    writeJson(response, 200, {
      channel: channelId,
      featured: { ...featured, kind: 'live', ...(payload ? { payload } : {}) },
      now: now.toISOString(),
    });
    return true;
  }

  if (pathname === '/api/watch') {
    if (!requireMethod(request, response, 'GET')) return true;
    if (!requirePersistence(response)) return true;
    const channel = watchChannelForId(parsedUrl.searchParams.get('channel'));
    if (!channel) {
      writeJson(response, 404, { error: 'unknown_watch_channel' });
      return true;
    }
    const now = new Date();
    const loadChannel = async (candidate: WatchChannel) => {
      const [sealedCount, unlocked] = await Promise.all([
        persistence.countWatchSealedGames({
          activeWindowMs: WATCH_SEALED_ACTIVITY_WINDOW_MS,
          modes: candidate.modes,
          now,
          variants: candidate.legacyVariants,
        }),
        persistence.listWatchUnlockedGames({
          // Featured only: the curated cut that matches the homepage board.
          curated: candidate.curated,
          limit: WATCH_REPLAY_LIMIT,
          modes: candidate.modes,
          now,
          variants: candidate.legacyVariants,
        }),
      ]);
      return { channel: candidate, sealedCount, topPlayer: channelTopPlayer(unlocked), unlocked };
    };
    const railRow = (result: Awaited<ReturnType<typeof loadChannel>>): WatchRailRow => ({
      family: result.channel.family,
      gameSpecIds: result.channel.gameSpecIds,
      id: result.channel.id,
      label: result.channel.label,
      sealedCount: result.sealedCount,
      unlockedCount: result.unlocked.length,
      topPlayer: result.topPlayer,
    });

    // The active channel is ALWAYS computed live — it owns the response's game
    // list and must not be served from a cache. The rest of the rail is the same
    // for every channel, so it comes from the short-lived rail cache when warm:
    // 2 queries instead of 20 on a click-through, which is the whole browsing
    // pattern this surface is for.
    const active = await loadChannel(channel);
    const cachedRail = cachedWatchRail(now.getTime());
    let rail: readonly WatchRailRow[];
    if (cachedRail) {
      rail = withFreshRow(cachedRail, railRow(active));
    } else {
      const others = await Promise.all(
        listWatchChannels()
          .filter((candidate) => candidate.id !== channel.id)
          .map(loadChannel),
      );
      // Rebuilt in canonical rail order, not completion order.
      const byId = new Map([active, ...others].map((result) => [result.channel.id, result]));
      rail = listWatchChannels().map((candidate) => railRow(byId.get(candidate.id)!));
      storeWatchRail(rail, now.getTime());
    }
    // Flip-variant results are seat-keyed; attach each flip game's derived firstColor
    // so the queue can label them by ink AND paint the seat rows' discs with the
    // colour actually on the board. Only the active channel's list is sent.
    await attachFlipFirstColors(active.unlocked);
    // Embed the events for the first replay so the client paints pieces on the
    // initial board without a second round trip to /api/games/:id/events. Only
    // the default (unlocked[0]) board is seeded; deep links to other games fall
    // back to the per-game fetch.
    const initialReplay = await watchInitialReplay(ctx, active.unlocked);
    writeJson(response, 200, {
      activeChannel: channel.id,
      channels: rail,
      now: now.toISOString(),
      sealedActivityWindowMs: WATCH_SEALED_ACTIVITY_WINDOW_MS,
      unlockLimit: WATCH_REPLAY_LIMIT,
      sealedCount: active.sealedCount,
      unlocked: active.unlocked,
      ...(initialReplay ? { initialReplay } : {}),
    });
    return true;
  }

  if (pathname === '/api/games/recent') {
    if (!requirePersistence(response)) return true;
    const games = await persistence.listRecentPublicGames(10);
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ games }));
    return true;
  }

  // Homepage hero pool — quality-filtered, PvP-first dark-chess games.
  if (pathname === '/api/games/showcase') {
    if (!requirePersistence(response)) return true;
    // Span every watchable variant (the union of the channels' persisted variant
    // strings) so the homepage viewer cycles the whole catalog, not just chess.
    const variants = [
      ...new Set(listWatchChannels().flatMap((channel) => [...channel.legacyVariants])),
    ];
    const games = await persistence.listShowcaseGames({ variants });
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ games }));
    return true;
  }

  // Admin game browser: faceted query + win-rate aggregates over completed
  // games. Session-admin gated (works from a logged-in admin browser); open in
  // local dev. Powers the unlisted /database surface.
  if (pathname === '/api/admin/games/query') {
    if (!requireMethod(request, response, 'GET')) return true;
    if (!requirePersistence(response)) return true;
    if (!(await requireAdminSession(request, response))) return true;
    const parsed = parseGameQueryFilters(parsedUrl.searchParams);
    if ('error' in parsed) {
      writeJson(response, 400, { error: parsed.error });
      return true;
    }
    const [page, aggregates, facets] = await Promise.all([
      persistence.queryGames(parsed.value),
      persistence.gameAggregates(parsed.value),
      persistence.gameFacets(),
    ]);
    writeJson(response, 200, {
      games: page.games,
      total: page.total,
      aggregates,
      facets,
      offset: parsed.value.offset ?? 0,
      limit: parsed.value.limit ?? 50,
    });
    return true;
  }

  // Admin engine tracker: win/loss/draw record per engine version across
  // completed engine-vs-engine games. Session-admin gated; open in local dev.
  // Powers the unlisted /engines surface.
  if (pathname === '/api/admin/engines') {
    if (!requireMethod(request, response, 'GET')) return true;
    if (!requirePersistence(response)) return true;
    if (!(await requireAdminSession(request, response))) return true;
    const engines = await persistence.listEngineVersionStats();
    writeJson(response, 200, { engines });
    return true;
  }

  // Per-engine profile: PvE (vs-humans) headline record + EvE (vs other engines)
  // secondary + recent PvE games. Same admin gate as the roster.
  const engineProfileMatch = pathname.match(/^\/api\/admin\/engines\/([^/]+)$/);
  if (engineProfileMatch) {
    if (!requireMethod(request, response, 'GET')) return true;
    if (!requirePersistence(response)) return true;
    if (!(await requireAdminSession(request, response))) return true;
    const engineId = decodeURIComponent(engineProfileMatch[1]!);
    const profile = await persistence.getEngineProfile(engineId);
    if (!profile) {
      writeJson(response, 404, { error: 'engine_not_found' });
      return true;
    }
    writeJson(response, 200, { profile });
    return true;
  }

  const reviewMatch = url.match(/^\/api\/games\/([^/]+)\/review$/);
  if (reviewMatch) {
    if (!requireMethod(request, response, 'GET')) return true;
    const roomId = decodeURIComponent(reviewMatch[1]!);
    const review = await gameReviewForApi(ctx, roomId, request);
    if (!review) {
      writeJson(response, 404, { error: 'not_found' });
      return true;
    }
    writeJson(response, 200, review);
    return true;
  }

  const artifactsMatch = pathname.match(/^\/api\/games\/([^/]+)\/artifacts$/);
  if (artifactsMatch) {
    if (!requireMethod(request, response, 'GET')) return true;
    const artifactType = parseReviewArtifactType(parsedUrl.searchParams.get('type'));
    if (!artifactType) {
      writeJson(response, 400, { error: 'invalid_artifact_type' });
      return true;
    }
    const color = parseOptionalColor(parsedUrl.searchParams.get('color'));
    if (parsedUrl.searchParams.has('color') && !color) {
      writeJson(response, 400, { error: 'invalid_color' });
      return true;
    }
    const roomId = decodeURIComponent(artifactsMatch[1]!);
    const artifactResponse = await gameArtifactsForApi(ctx, roomId, artifactType, color, request);
    if (!artifactResponse) {
      writeJson(response, 404, { error: 'not_found' });
      return true;
    }
    if (artifactResponse.status === 403) {
      writeJson(response, 403, { error: 'forbidden' });
      return true;
    }
    writeJson(response, 200, artifactResponse.body);
    return true;
  }

  const exportMatch = pathname.match(/^\/api\/games\/([^/]+)\/export\.(pgn|json)$/);
  if (exportMatch) {
    if (!requireMethod(request, response, 'GET')) return true;
    const roomId = decodeURIComponent(exportMatch[1]!);
    const format = exportMatch[2] as GameExportFormat;
    // Chess-family logs take the legacy builders; every variant tenant resolves
    // through its registry export binding (see game-export-tenant.ts).
    const [summary, events] = await Promise.all([
      gameSummaryForApi(ctx, roomId),
      gameEventsForApi(ctx, roomId),
    ]);
    const resolved = resolveGameExport({ roomId, format, summary, events });
    if (resolved.status !== 200) {
      writeJson(response, resolved.status, resolved.body);
      return true;
    }
    response.writeHead(200, {
      'content-type': resolved.contentType,
      'content-disposition': `inline; filename="mistboard-${roomId}.${resolved.format}"`,
    });
    response.end(resolved.body);
    return true;
  }

  // Head-to-head record of this room's two seats in this variant (the review
  // page's crosstable). Persisted games only: the record is a game_participants
  // self-join, so there is nothing to answer from the in-memory rooms.
  const crosstableMatch = pathname.match(/^\/api\/games\/([^/]+)\/crosstable$/);
  if (crosstableMatch) {
    if (!requireMethod(request, response, 'GET')) return true;
    if (!requirePersistence(response)) return true;
    const roomId = decodeURIComponent(crosstableMatch[1]!);
    const game = await persistence.getGameSummary(roomId);
    if (!game) {
      writeJson(response, 404, { error: 'not_found' });
      return true;
    }
    const resolution = resolveCrosstablePair({
      roomId,
      variant: game.variant,
      participants: game.participants ?? [],
    });
    if (!resolution.ok) {
      writeJson(response, 200, { available: false, reason: resolution.reason });
      return true;
    }
    const { a, b } = resolution.pair;
    const [games, tallies] = await Promise.all([
      persistence.queryHeadToHeadGames(a, b, game.variant, CROSSTABLE_GAME_LIMIT),
      persistence.tallyHeadToHeadGames(a, b, game.variant),
    ]);
    writeJson(
      response,
      200,
      buildCrosstable({ variant: game.variant, players: resolution.players, games, tallies }),
    );
    return true;
  }

  const summaryMatch = url.match(/^\/api\/games\/([^/]+)$/);
  if (summaryMatch) {
    const roomId = decodeURIComponent(summaryMatch[1]!);
    const game = await gameSummaryForApi(ctx, roomId);
    if (!game) {
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'not_found' }));
      return true;
    }
    // Flip-variant results are seat-keyed; attach the bound ink the same way the
    // watch feed does, so a consumer of the summary alone (the game embed) can
    // say "Black wins" rather than "First wins". No-op for every other variant.
    await attachFlipFirstColors([game]);
    // Additively expose the shaped seat roster (name/rating/kind, with private-seat
    // redaction + corpus-name override) that every per-variant postgame endpoint
    // already returns, so the flagship /game/:id review left rail reads identical
    // player rows. Existing consumers ignore the extra key; the raw record fields
    // (whiteName/blackName/timeControl) stay in place.
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ game: gameWithPostgamePlayers(game) }));
    return true;
  }

  const eventsMatch = url.match(/^\/api\/games\/([^/]+)\/events$/);
  if (eventsMatch) {
    const roomId = decodeURIComponent(eventsMatch[1]!);
    const events = await gameEventsForApi(ctx, roomId);
    const replayResponse = eventReplayResponse(events);
    response.writeHead(replayResponse.status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(replayResponse.body));
    return true;
  }

  if (pathname === '/api/games') {
    if (!requireMethod(request, response, 'GET')) return true;
    if (!requirePersistence(response)) return true;
    if (!isHttpAdminAuthorized(request)) {
      response.writeHead(403, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'admin_required' }));
      return true;
    }

    const date = parseUtcDateParam(parsedUrl.searchParams.get('date'));
    const mode = parseGameModeParam(parsedUrl.searchParams.get('mode'));
    const limit = parsePositiveInteger(parsedUrl.searchParams.get('limit') ?? undefined);
    if (!date) {
      response.writeHead(400, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'invalid_date' }));
      return true;
    }
    if (parsedUrl.searchParams.has('mode') && !mode) {
      response.writeHead(400, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'invalid_mode' }));
      return true;
    }

    const endedFrom = date;
    const endedTo = new Date(endedFrom.getTime() + 24 * 60 * 60 * 1000);
    const games = await persistence.listCompletedGames({
      endedFrom,
      endedTo,
      ...(limit ? { limit } : {}),
      ...(mode ? { mode } : {}),
    });
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify({
        games,
        range: {
          date: parsedUrl.searchParams.get('date'),
          endedFrom: endedFrom.toISOString(),
          endedTo: endedTo.toISOString(),
        },
      }),
    );
    return true;
  }

  if (pathname === '/api/eve-games/recent') {
    if (!requirePersistence(response)) return true;
    const games = await persistence.listRecentEveGames();
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ games }));
    return true;
  }

  return false;
}

function boundedInt(raw: string | null, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(raw ?? '', 10);
  return Number.isNaN(parsed) ? fallback : Math.max(min, Math.min(parsed, max));
}

async function gameSummaryForApi(
  ctx: HttpApiContext,
  roomId: string,
): Promise<persistence.RecentEveGameRecord | null> {
  const persisted = persistence.isInitialized() ? await persistence.getGameSummary(roomId) : null;
  return persisted ?? ctx.inMemoryGameSummary(roomId);
}

// Attach the public seat roster (name/rating/kind, with private-seat redaction +
// corpus-name override) to a persisted game record. EVERY endpoint that serves a
// finished-game envelope to a postgame page must carry it: the web review loader
// (review.ts loadGameForReview) PREFERS /api/games/:id/review and only falls back
// to /api/games/:id, so shaping `players` on the summary alone left the review
// payload without it — and buildReviewMeta reads `game.players`, so the Fog Chess
// left rail rendered with zero player rows (no names, no seat colors) for every
// game. Shape it in one place so the two endpoints cannot drift again.
function gameWithPostgamePlayers(
  game: persistence.RecentEveGameRecord,
): persistence.RecentEveGameRecord & { players: PostgamePlayer[] } {
  return {
    ...game,
    players: postgamePlayers(game.participants ?? [], {
      whiteName: game.whiteName,
      blackName: game.blackName,
    }),
  };
}

async function gameEventsForApi(ctx: HttpApiContext, roomId: string): Promise<GameEvent[] | null> {
  const persisted = persistence.isInitialized() ? await persistence.loadRoom(roomId) : null;
  return persisted ?? ctx.rooms.get(roomId)?.events ?? null;
}

// The first replay's events ride along in every /api/watch response, so a
// finished game's full event log is loaded + replay-validated on each watch
// load and each channel switch. Finished games are immutable, so memoize the
// validated seed by room id; only the 200 (finished + exposable) case is
// stored, never an in-progress log. Bound by the cache's own TTL/size.
const watchInitialReplayCache = new FinishedGameCache<{ events: GameEvent[]; roomId: string }>();

export function clearWatchInitialReplayCache(): void {
  watchInitialReplayCache.clear();
}

// Events for the first unlocked watch replay, gated by the same public/finished
// policy as /api/games/:id/events. Returns null when there is nothing to seed
// or the game is not exposable, in which case the client fetches per-game.
async function watchInitialReplay(
  ctx: HttpApiContext,
  unlocked: readonly persistence.RecentEveGameRecord[],
): Promise<{ events: GameEvent[]; roomId: string } | null> {
  const first = unlocked[0];
  if (!first) return null;
  const cached = watchInitialReplayCache.get(first.roomId);
  if (cached) return cached;
  const events = await gameEventsForApi(ctx, first.roomId);
  if (!events || eventReplayResponse(events).status !== 200) return null;
  const seed = { events, roomId: first.roomId };
  watchInitialReplayCache.set(first.roomId, seed);
  return seed;
}

async function gameReviewForApi(
  ctx: HttpApiContext,
  roomId: string,
  request: IncomingMessage,
): Promise<Record<string, unknown> | null> {
  const game = await gameSummaryForApi(ctx, roomId);
  const events = await gameEventsForApi(ctx, roomId);
  const replayResponse = eventReplayResponse(events);
  if (!game || replayResponse.status !== 200) return null;

  const devReview = !persistence.isInitialized() && decisionLogAvailable(roomId);
  const canViewEngineArtifacts = (await canViewEngineArtifactsForRequest(request)) || devReview;
  let artifactSummaries = persistence.isInitialized()
    ? await persistence.listGameDebugArtifactSummaries(roomId)
    : [];
  let engineColors = engineParticipantColors(game);
  if (devReview) {
    const devArtifacts = devArtifactSummaries(roomId, replayResponse.body.events);
    if (devArtifacts) {
      artifactSummaries = devArtifacts.summaries;
      if (engineColors.length === 0) engineColors = devArtifacts.engineColors;
    }
  }
  const hasEngineParticipant = engineColors.length > 0;
  const beliefArtifacts = artifactSummaries.filter(
    (artifact) => artifact.artifactType === 'belief-snapshot',
  );
  const traceArtifacts = artifactSummaries.filter(
    (artifact) =>
      artifact.artifactType === 'engine-move-choice' || artifact.artifactType === 'trace-row',
  );
  const beliefColors = intersectionColors(engineColors, artifactColors(beliefArtifacts));
  const traceColors = intersectionColors(engineColors, artifactColors(traceArtifacts));

  return {
    game: gameWithPostgamePlayers(game),
    events: replayResponse.body.events,
    capabilities: {
      canViewEngineArtifacts,
      canAnnotate: false,
      canManageEngineArtifacts: canViewEngineArtifacts,
    },
    panels: {
      belief: {
        available:
          canViewEngineArtifacts &&
          hasEngineParticipant &&
          beliefArtifacts.length > 0 &&
          beliefColors.length > 0,
        defaultOpen: false,
        seats: beliefColors,
        snapshotKinds: uniqueStrings(beliefArtifacts.flatMap((artifact) => artifact.snapshotKinds)),
      },
      trace: {
        available:
          canViewEngineArtifacts &&
          hasEngineParticipant &&
          traceArtifacts.length > 0 &&
          traceColors.length > 0,
        defaultOpen: false,
        seats: traceColors,
      },
      annotations: {
        available: false,
        writable: false,
      },
    },
    artifacts: canViewEngineArtifacts ? artifactSummaries : [],
  };
}

async function gameArtifactsForApi(
  ctx: HttpApiContext,
  roomId: string,
  artifactType: ReviewArtifactType,
  color: Color | null,
  request: IncomingMessage,
): Promise<{ status: 200; body: Record<string, unknown> } | { status: 403 } | null> {
  if (!persistence.isInitialized()) {
    if (!decisionLogAvailable(roomId)) return null;
    const game = await gameSummaryForApi(ctx, roomId);
    const events = await gameEventsForApi(ctx, roomId);
    const replayResponse = eventReplayResponse(events);
    if (!game || replayResponse.status !== 200) return null;
    const artifacts = devArtifactPayloads(roomId, replayResponse.body.events, artifactType, color);
    if (!artifacts) return null;
    return { status: 200, body: { artifacts } };
  }
  const game = await gameSummaryForApi(ctx, roomId);
  const events = await gameEventsForApi(ctx, roomId);
  const replayResponse = eventReplayResponse(events);
  if (!game || replayResponse.status !== 200) return null;
  if (!(await canViewEngineArtifactsForRequest(request))) return { status: 403 };

  const engineColors = engineParticipantColors(game);
  if (engineColors.length === 0) {
    return { status: 200, body: { artifacts: [] } };
  }
  const requestedColors = color ? [color] : engineColors;
  const allowedColors = intersectionColors(engineColors, requestedColors);
  if (allowedColors.length === 0) {
    return { status: 200, body: { artifacts: [] } };
  }

  const artifacts = await persistence.listGameDebugArtifactPayloads(roomId, {
    artifactType,
    engineColors: allowedColors,
  });
  return {
    status: 200,
    body: {
      artifacts: artifacts.map((artifact) => ({
        id: artifact.id,
        gameId: artifact.gameId,
        ply: artifact.ply,
        engineColor: artifact.engineColor,
        artifactType: artifact.artifactType,
        payload: artifact.payload,
        createdAt: artifact.createdAt.toISOString(),
      })),
    },
  };
}

// Engine artifacts (belief snapshots, trace rows, move choices) are admin-only
// in prod. Same gate as the rest of the admin surface — delegate so it can't
// drift from isHttpAdminSession.
async function canViewEngineArtifactsForRequest(request: IncomingMessage): Promise<boolean> {
  return isHttpAdminSession(request);
}

// An engine seat is any MACHINE seat, not just 'engine-version'. Live PvE writes
// its bot seats as subjectType 'bot' (room-manager.ts), so an 'engine-version'-only
// filter silently returned zero engine seats for every PvE game and the artifacts
// endpoint answered `{artifacts: []}` instead of the data — see #287.
export function engineParticipantColors(
  game: Pick<persistence.RecentEveGameRecord, 'participants'>,
): Color[] {
  return game.participants
    .filter(
      (participant): participant is persistence.GameParticipant & { color: Color } =>
        MACHINE_SUBJECT_TYPES.has(participant.subjectType) &&
        (participant.color === 'white' || participant.color === 'black'),
    )
    .map((participant) => participant.color);
}

function artifactColors(artifacts: persistence.GameDebugArtifactSummary[]): Color[] {
  return uniqueColors(artifacts.flatMap((artifact) => artifact.engineColors));
}

function intersectionColors(left: Color[], right: Color[]): Color[] {
  const rightSet = new Set(right);
  return uniqueColors(left.filter((color) => rightSet.has(color)));
}

function uniqueColors(values: Color[]): Color[] {
  return values.filter((value, index) => values.indexOf(value) === index);
}

function uniqueStrings(values: string[]): string[] {
  return values.filter((value, index) => values.indexOf(value) === index);
}

export function parseReviewArtifactType(value: string | null): ReviewArtifactType | null {
  return value === 'belief-snapshot' ||
    value === 'trace-row' ||
    value === 'engine-move-choice' ||
    value === LIVE_ENGINE_DECISION_ARTIFACT_TYPE
    ? value
    : null;
}

function parseOptionalColor(value: string | null): Color | null {
  return value === 'white' || value === 'black' ? value : null;
}

function parseGameModeParam(value: string | null): persistence.GameMode | null {
  if (
    value === 'pvp' ||
    value === 'pve' ||
    value === 'eve' ||
    value === 'imported' ||
    value === 'manual'
  ) {
    return value;
  }
  return null;
}

function parseUtcDateParam(value: string | null): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toISOString().startsWith(value) ? date : null;
}

function parseNonNegativeInt(value: string | null): number | null {
  if (value == null || value === '') return null;
  if (!/^\d+$/.test(value)) return null;
  return Number.parseInt(value, 10);
}

const GAME_RESULT_VALUES = new Set(['white-wins', 'black-wins', 'red-wins', 'draw']);
const TIME_CLASS_VALUES = new Set<TimeClass>(['bullet', 'blitz', 'rapid']);

// Parse + validate the /api/admin/games/query string into typed filters. Every
// param is optional; an unrecognized value for a closed-set param is a 400 so
// the UI can't silently send a no-op filter. `to` is widened to an inclusive
// day (end-of-day exclusive) to match the date-only granularity of the input.
// Exported for unit tests.
export function parseGameQueryFilters(
  params: URLSearchParams,
): { value: persistence.GameQueryFilters } | { error: string } {
  const value: persistence.GameQueryFilters = {};

  const variant = params.get('variant');
  if (variant) value.variant = variant;

  if (params.has('mode')) {
    const mode = parseGameModeParam(params.get('mode'));
    if (!mode) return { error: 'invalid_mode' };
    value.mode = mode;
  }

  const result = params.get('result');
  if (result) {
    if (!GAME_RESULT_VALUES.has(result)) return { error: 'invalid_result' };
    value.result = result as persistence.GameResult;
  }

  const termination = params.get('termination');
  if (termination) value.termination = termination as persistence.GameTermination;

  if (params.has('rated')) {
    const rated = params.get('rated');
    if (rated === 'true') value.rated = true;
    else if (rated === 'false') value.rated = false;
    else if (rated) return { error: 'invalid_rated' };
  }

  const timeClass = params.get('timeClass');
  if (timeClass) {
    if (!TIME_CLASS_VALUES.has(timeClass as TimeClass)) return { error: 'invalid_time_class' };
    value.timeClass = timeClass as TimeClass;
  }

  if (params.has('plyMin')) {
    const plyMin = parseNonNegativeInt(params.get('plyMin'));
    if (plyMin == null) return { error: 'invalid_ply_min' };
    value.plyMin = plyMin;
  }
  if (params.has('plyMax')) {
    const plyMax = parseNonNegativeInt(params.get('plyMax'));
    if (plyMax == null) return { error: 'invalid_ply_max' };
    value.plyMax = plyMax;
  }

  if (params.has('from')) {
    const from = parseUtcDateParam(params.get('from'));
    if (!from) return { error: 'invalid_from' };
    value.endedFrom = from;
  }
  if (params.has('to')) {
    const to = parseUtcDateParam(params.get('to'));
    if (!to) return { error: 'invalid_to' };
    value.endedTo = new Date(to.getTime() + 24 * 60 * 60 * 1000);
  }

  const offset = parseNonNegativeInt(params.get('offset'));
  if (offset != null) value.offset = offset;
  const limit = parsePositiveInteger(params.get('limit') ?? undefined);
  if (limit) value.limit = limit;

  return { value };
}
