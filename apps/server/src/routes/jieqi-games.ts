import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  getJieqiPlayerView,
  JIEQI_SPEC_ID,
  type JieqiColor,
  type JieqiDeal,
  type JieqiGameState,
  type JieqiMove,
  type JieqiPlayerView,
  jieqiMaskedBoard,
  jieqiTruthView,
  oppositeJieqiColor,
} from '@mistboard/game';
import { jieqiEnabled } from './../feature-flags.js';
import { FinishedGameCache } from './../finished-game-cache.js';
import {
  jieqiChancePlies,
  resolveJieqiAnalysis,
  resolveJieqiDecisions,
} from './../jieqi-analysis.js';
import { jieqiEngineBinaryAvailable } from './../jieqi-engine.js';
import { jieqiRooms } from './../jieqi-registration.js';
import type { JieqiEvent, JieqiProjection } from './../jieqi-runtime.js';
import { jieqiTenant } from './../jieqi-tenant.js';
import * as persistence from './../persistence.js';
import type { JieqiLiveRoom } from './../server-ws-jieqi.js';
import {
  applyTenantEvent,
  isTenantEventLog,
  replayTenantEvents,
} from './../variant-tenant/runtime.js';
import { registerLiveWatchPayloadBuilder } from './../watch-live.js';
import { createGameAnalysisRoutes } from './game-analysis-route.js';
import {
  type HttpApiContext,
  postgameGameSummary,
  requireMethod,
  requirePersistence,
  writeJson,
} from './lib.js';

type JieqiPostgameViewKey = JieqiColor | 'truth';

type JieqiPostgameViews = Partial<Record<JieqiPostgameViewKey, JieqiPlayerView>>;
type JieqiPostgameSnapshot = {
  ply: number;
  view: JieqiPlayerView;
};
type JieqiPostgameHistory = Partial<Record<JieqiPostgameViewKey, JieqiPostgameSnapshot[]>>;

type JieqiPostgameMove = {
  type: 'move-played';
  at: number;
  color: JieqiColor;
  move: { from: string; to: string };
  ply: number;
};

type JieqiPostgameTerminal =
  | { type: 'clock-expired'; at: number; color: JieqiColor; winner: JieqiColor }
  | { type: 'seat-resigned'; at: number; color: JieqiColor; winner: JieqiColor }
  | { type: 'seat-forfeited'; at: number; color: JieqiColor; winner: JieqiColor }
  | { type: 'game-aborted'; at: number; reason: string };

// Injectable so the route can be unit-tested without a live database, mirroring
// the Dark Mini Xiangqi route.
export type JieqiPostgamePersistence = {
  getGameSummary(roomId: string): ReturnType<typeof persistence.getGameSummary>;
  loadRoomEvents(roomId: string): Promise<JieqiEvent[] | null>;
};

const defaultPersistence: JieqiPostgamePersistence = {
  getGameSummary: (roomId) => persistence.getGameSummary(roomId),
  loadRoomEvents: (roomId) => persistence.loadRoomEvents<JieqiEvent>(roomId),
};

// Mistboard TV shows one finished-game server-truth board and no capture pool.
// Its passive replay must not pay for the richer review endpoint's Red + Black
// player projections (which calculate full legal move lists at every ply).
// Finished games are immutable, so cache only successful production projections;
// injected test dependencies bypass the cache to stay deterministic.
const jieqiWatchPostgameCache = new FinishedGameCache<
  NonNullable<Awaited<ReturnType<typeof buildJieqiWatchPostgame>>>
>();

export function clearJieqiWatchPostgameCache(): void {
  jieqiWatchPostgameCache.clear();
}

// Computer analysis (Layer 1): fixed-strength eval of every ply, red-seat POV, cached +
// coalesced. Decision-vs-luck decomposition (Layer 2): the heavier, opt-in tier on top —
// per REVEAL ply it returns {best, played, realized} EVs (mover POV) so the client can
// split the swing into decision quality vs luck. Jieqi hides face-down IDENTITIES, so
// reconstruction needs the per-game DEAL (events[0].setup) — we replay the raw event log
// (which retains the server-secret deal), not the client payload. Gates/envelopes: the
// shared factory.
const handleAnalysisRoutes = createGameAnalysisRoutes({
  routeId: 'jieqi',
  logPrefix: 'jieqi',
  variantLabel: 'Jieqi',
  enabled: jieqiEnabled,
  requiresPersistence: true,
  // Fail closed, not open: the analysis engine is the PikaJieQi binary ONLY. A missing
  // binary is a broken deploy, so surface it (alertable log + 503) instead of a weaker eval.
  engineBinary: { available: jieqiEngineBinaryAvailable, label: 'PikaJieQi binary' },
  loadInputs: loadFinishedJieqiGameInputs,
  countPlies: (inputs) => inputs.moves.length,
  resolveAnalysis: (roomId, inputs, computeIfMissing) =>
    resolveJieqiAnalysis(roomId, inputs.moves, inputs.deal, undefined, undefined, computeIfMissing),
  // Mark the REVEAL (chance) plies so the client leaves them unjudged. Unlike banqi's
  // from===to flip, a jieqi reveal is a normal move of a face-down piece, so we detect it by
  // replaying the deal (jieqiChancePlies), not by move shape.
  analysisExtras: (inputs) => ({ chancePlies: jieqiChancePlies(inputs.moves, inputs.deal) }),
  resolveDecisions: (roomId, inputs, computeIfMissing) =>
    resolveJieqiDecisions(
      roomId,
      inputs.moves,
      inputs.deal,
      undefined,
      undefined,
      computeIfMissing,
    ),
});

export async function tryHandle(
  _ctx: HttpApiContext,
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  _parsedUrl: URL,
): Promise<boolean> {
  if (await handleAnalysisRoutes(request, response, pathname)) return true;

  const watchPostgameMatch = pathname.match(/^\/api\/jieqi\/games\/([^/]+)\/watch$/);
  const postgameMatch = pathname.match(/^\/api\/jieqi\/games\/([^/]+)$/);
  if (!watchPostgameMatch && !postgameMatch) return false;

  if (!requireMethod(request, response, 'GET')) return true;
  if (!jieqiEnabled()) {
    writeJson(response, 404, { error: 'not_found' });
    return true;
  }
  if (!requirePersistence(response)) return true;

  const roomId = decodeURIComponent((watchPostgameMatch ?? postgameMatch)![1]!);
  const payload = watchPostgameMatch
    ? await jieqiWatchPostgameForApi(roomId)
    : await jieqiPostgameForApi(roomId);
  if (!payload) {
    writeJson(response, 404, { error: 'not_found' });
    return true;
  }
  writeJson(response, 200, payload);
  return true;
}

export async function jieqiWatchPostgameForApi(
  roomId: string,
  deps: JieqiPostgamePersistence = defaultPersistence,
) {
  const useCache = deps === defaultPersistence;
  if (useCache) {
    const cached = jieqiWatchPostgameCache.get(roomId);
    if (cached) return cached;
  }
  const payload = await buildJieqiWatchPostgame(roomId, deps);
  if (payload && useCache) jieqiWatchPostgameCache.set(roomId, payload);
  return payload;
}

async function buildJieqiWatchPostgame(roomId: string, deps: JieqiPostgamePersistence) {
  const [game, events] = await Promise.all([
    deps.getGameSummary(roomId),
    deps.loadRoomEvents(roomId),
  ]);
  if (!game || game.variant !== JIEQI_SPEC_ID) return null;
  if (!events || !isTenantEventLog(jieqiTenant, events, roomId)) return null;

  const created = events[0];
  if (created?.type !== 'room-created') return null;

  // One replay pass, two cheap projections per move. The richer postgame
  // path below replays again and builds per-color views because review may grow
  // player-knowledge POVs later; TV deliberately does neither.
  //
  // Two tracks, because TV shows the game as it was PLAYED: `masked` keeps a
  // never-moved piece face-down (the default board), and `truth` is the spoiler
  // the Reveal control swaps in. Before 2026-08-27 only `truth` shipped, so a
  // finished game replayed on /watch and on the homepage with every identity
  // already face-up, which the review page never did.
  let projection = replayTenantEvents(jieqiTenant, [created]);
  let ply = 0;
  const truth = [{ ply, view: jieqiWatchTruthView(projection.state) }];
  const masked = [{ ply, view: jieqiWatchMaskedView(projection.state) }];
  for (const event of events.slice(1)) {
    projection = applyTenantEvent(jieqiTenant, projection, event);
    if (event.type !== 'move-played') continue;
    ply += 1;
    truth.push({ ply, view: jieqiWatchTruthView(projection.state) });
    masked.push({ ply, view: jieqiWatchMaskedView(projection.state) });
  }

  // This check is the truth-release boundary. Never cache or return an
  // in-progress projection, even though it was reconstructed above.
  if (projection.state.status.type !== 'finished') return null;

  const view = truth.at(-1)?.view ?? jieqiWatchTruthView(projection.state);
  return {
    game: postgameGameSummary(game),
    state: {
      status: projection.state.status,
      moveNumber: projection.state.moveNumber,
      ...(projection.clock ? { clock: projection.clock } : {}),
      ...(projection.timeControl ? { timeControl: projection.timeControl } : {}),
    },
    timeline: jieqiPostgameTimeline(events),
    view,
    history: { truth, masked },
  };
}

// Keep the renderer-compatible shape without transmitting any captured-piece
// knowledge. jieqiTruthView already emits no legal moves; clearing captured
// keeps TV independent of the future per-player knowledge presentation.
function jieqiWatchTruthView(state: JieqiGameState): JieqiPlayerView {
  return { ...jieqiTruthView(state), captured: [] };
}

// The as-played board for the same ply: identical envelope, masked squares. Built
// from the shared jieqiMaskedBoard so TV hides exactly what the live per-color view
// hid, and no legal moves are generated (this pass runs once per ply per game).
function jieqiWatchMaskedView(state: JieqiGameState): JieqiPlayerView {
  return { ...jieqiWatchTruthView(state), board: jieqiMaskedBoard(state) };
}

// The masked per-ply track alone, for an IN-PROGRESS room. The finished builder
// above walks the same events and adds the truth track beside it; this one must
// never, because the truth track is the deal (every face-down identity at every
// ply) and the game is still being played.
function jieqiLiveMaskedHistory(events: readonly JieqiEvent[]): JieqiPostgameSnapshot[] {
  const created = events[0];
  if (created?.type !== 'room-created') return [];
  let projection = replayTenantEvents(jieqiTenant, [created]);
  let ply = 0;
  const masked: JieqiPostgameSnapshot[] = [{ ply, view: jieqiWatchMaskedView(projection.state) }];
  for (const event of events.slice(1)) {
    projection = applyTenantEvent(jieqiTenant, projection, event);
    if (event.type !== 'move-played') continue;
    ply += 1;
    masked.push({ ply, view: jieqiWatchMaskedView(projection.state) });
  }
  return masked;
}

// Mistboard TV live payload for an IN-PROGRESS jieqi room. Jieqi is ASYMMETRIC
// hidden-identity (the capturer alone learns a dark capture), so no seat's view
// is honest for a spectator; TV serves the public view instead: the shared
// masked board, and no captures at all (the compact TV product never draws
// them). The finished route's `view` (truth) and `history.truth` ARE the deal
// and are excluded here; the client's Reveal control is inert for a live game.
// Regression: jieqi-games.test.ts.
export function jieqiLiveWatchPayloadFor(
  roomId: string,
  room: Pick<JieqiLiveRoom, 'id' | 'events' | 'projection'>,
): Record<string, unknown> | null {
  if (room.id !== roomId) return null;
  const projection = room.projection;
  if (projection.state.status.type !== 'playing') return null;
  if (!isTenantEventLog(jieqiTenant, room.events, roomId)) return null;
  const timeline = jieqiPostgameTimeline(room.events);
  const isEngine = jieqiTenant.engine?.isEngineClientId ?? (() => false);
  const hasEngineSeat = Object.values(projection.seats).some((clientId) => isEngine(clientId));
  const masked = jieqiLiveMaskedHistory(room.events);
  return {
    game: {
      roomId,
      variant: JIEQI_SPEC_ID,
      mode: hasEngineSeat ? 'pve' : 'pvp',
      result: 'in-progress',
      termination: 'in-progress',
      plyCount: timeline.filter((entry) => entry.type === 'move-played').length,
      startedAt: new Date(room.events[0]?.at ?? Date.now()).toISOString(),
      endedAt: null,
      rated: projection.rated,
      visibility: 'public',
      initialMs: projection.timeControl?.initialMs ?? null,
      incrementMs: projection.timeControl?.incrementMs ?? null,
    },
    state: {
      status: projection.state.status,
      moveNumber: projection.state.moveNumber,
      ...(projection.clock ? { clock: projection.clock } : {}),
      ...(projection.timeControl ? { timeControl: projection.timeControl } : {}),
    },
    timeline,
    // The masked board, NOT jieqiTruthView.
    view: masked.at(-1)?.view ?? jieqiWatchMaskedView(projection.state),
    // Masked track only; no `truth` track exists for a live game.
    history: { masked },
  };
}

async function jieqiLiveWatchPayload(roomId: string): Promise<Record<string, unknown> | null> {
  if (!jieqiEnabled()) return null;
  const room = jieqiRooms.get(roomId) ?? null;
  if (!room) return null;
  await room.pendingWrites.catch(() => undefined);
  return jieqiLiveWatchPayloadFor(roomId, room);
}

registerLiveWatchPayloadBuilder('jieqi', jieqiLiveWatchPayload);

// Shared loader for the analysis tiers (both `/analysis` and `/decisions`): the per-game deal
// (from the room-created event) + the move list, but only for a FINISHED game. Returns null for
// a missing / non-jieqi / unfinished game or a log with no deal.
// Exported for the off-box backfill script (scripts/backfill-jieqi-analysis.mjs),
// which warms the analysis cache from a workstation instead of burning the single
// global compute lane on prod. It must reuse THIS loader rather than re-deriving the
// deal from events[0].setup: a second copy of that extraction is exactly the kind of
// drift that silently produces a differently-keyed cache row.
export async function loadFinishedJieqiGameInputs(
  roomId: string,
): Promise<{ deal: JieqiDeal; moves: JieqiMove[] } | null> {
  const events = await persistence.loadRoomEvents<JieqiEvent>(roomId);
  if (!events || !isTenantEventLog(jieqiTenant, events, roomId)) return null;
  const projection = replayTenantEvents(jieqiTenant, events);
  if (projection.state.status.type !== 'finished') return null;
  const created = events[0];
  const deal =
    created && created.type === 'room-created'
      ? (created.setup as JieqiDeal | undefined)
      : undefined;
  if (!deal) return null;
  const moves = events
    .filter(
      (event): event is Extract<JieqiEvent, { type: 'move-played' }> =>
        event.type === 'move-played',
    )
    .map((event) => event.move as JieqiMove);
  return { deal, moves };
}

export async function jieqiPostgameForApi(
  roomId: string,
  deps: JieqiPostgamePersistence = defaultPersistence,
) {
  const [game, events] = await Promise.all([
    deps.getGameSummary(roomId),
    deps.loadRoomEvents(roomId),
  ]);
  if (!game || game.variant !== JIEQI_SPEC_ID) return null;
  if (!events || !isTenantEventLog(jieqiTenant, events, roomId)) return null;

  // Replay reconstructs the FULL-TRUTH state: the per-game deal lives in
  // events[0].setup and is applied during createInitialState, so every hidden
  // identity is known to the server here. Redaction happens below per view.
  const projection = replayTenantEvents(jieqiTenant, events);
  if (projection.state.status.type !== 'finished') return null;

  return {
    game: postgameGameSummary(game),
    state: {
      status: projection.state.status,
      moveNumber: projection.state.moveNumber,
      ...(projection.clock ? { clock: projection.clock } : {}),
      ...(projection.timeControl ? { timeControl: projection.timeControl } : {}),
    },
    timeline: jieqiPostgameTimeline(events),
    // Truth view: every identity revealed (postgame-only; never on a live wire).
    view: jieqiTruthView(projection.state),
    // Per-color views reuse the EXISTING leak-safe redaction: the opponent's
    // face-down pieces stay faceDown, and captured dark pieces the viewer did
    // not take carry role:null. No hand-rolled masking.
    views: jieqiPostgameViews(projection.state),
    history: jieqiPostgameHistory(events),
  };
}

function jieqiPostgameViews(state: JieqiGameState): JieqiPostgameViews {
  return {
    red: getJieqiPlayerView(state, 'red'),
    truth: jieqiTruthView(state),
    black: getJieqiPlayerView(state, 'black'),
  };
}

function jieqiPostgameHistory(events: readonly JieqiEvent[]): JieqiPostgameHistory {
  const created = events[0];
  if (created?.type !== 'room-created') return {};
  let projection = replayTenantEvents(jieqiTenant, [created]);
  let ply = 0;
  const history = postgameHistoryViews(projection, ply);

  for (const event of events.slice(1)) {
    projection = applyTenantEvent(jieqiTenant, projection, event);
    if (event.type !== 'move-played') continue;
    ply += 1;
    appendPostgameHistoryViews(history, projection, ply);
  }
  return history;
}

function postgameHistoryViews(projection: JieqiProjection, ply: number): JieqiPostgameHistory {
  const history: JieqiPostgameHistory = {};
  appendPostgameHistoryViews(history, projection, ply);
  return history;
}

function appendPostgameHistoryViews(
  history: JieqiPostgameHistory,
  projection: JieqiProjection,
  ply: number,
): void {
  history.truth = [...(history.truth ?? []), { ply, view: jieqiTruthView(projection.state) }];
  for (const color of ['red', 'black'] as const) {
    const view = getJieqiPlayerView(projection.state, color);
    history[color] = [...(history[color] ?? []), { ply, view }];
  }
}

function jieqiPostgameTimeline(
  events: readonly JieqiEvent[],
): Array<JieqiPostgameMove | JieqiPostgameTerminal> {
  const timeline: Array<JieqiPostgameMove | JieqiPostgameTerminal> = [];
  let ply = 0;
  for (const event of events) {
    if (event.type === 'move-played') {
      ply += 1;
      timeline.push({
        type: event.type,
        at: event.at,
        color: event.color,
        move: event.move,
        ply,
      });
      continue;
    }
    if (event.type === 'clock-expired') {
      timeline.push({
        type: event.type,
        at: event.at,
        color: event.color,
        winner: oppositeJieqiColor(event.color),
      });
      continue;
    }
    if (event.type === 'seat-resigned' || event.type === 'seat-forfeited') {
      timeline.push({
        type: event.type,
        at: event.at,
        color: event.color,
        winner: oppositeJieqiColor(event.color),
      });
      continue;
    }
    if (event.type === 'game-aborted') {
      timeline.push({ type: event.type, at: event.at, reason: event.reason });
    }
  }
  return timeline;
}
