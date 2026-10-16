import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  getJieqiPublicView,
  JIEQI_SPEC_ID,
  type JieqiColor,
  type JieqiDeal,
  type JieqiGameState,
  type JieqiMove,
  type JieqiPlayerView,
  jieqiTruthBoard,
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
import { jieqiAnalysisEngineAvailable } from './../jieqi-engine.js';
import { jieqiRooms } from './../jieqi-registration.js';
import type { JieqiEvent, JieqiProjection } from './../jieqi-runtime.js';
import { jieqiPublicEvents, jieqiTenant } from './../jieqi-tenant.js';
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

type JieqiPostgameViewKey = 'truth';

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
  | { type: 'game-aborted'; at: number; reason: string }
  | { type: 'game-adjudicated'; at: number; winner: JieqiColor | null; reason: string };

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

// Mistboard TV's finished-game replay: the as-played track and the Reveal
// track, both from the public log. Finished games are immutable, so cache only successful production projections;
// injected test dependencies bypass the cache to stay deterministic.
const jieqiWatchPostgameCache = new FinishedGameCache<
  NonNullable<Awaited<ReturnType<typeof buildJieqiWatchPostgame>>>
>();

export function clearJieqiWatchPostgameCache(): void {
  jieqiWatchPostgameCache.clear();
}

// Computer analysis (Layer 1): fixed-strength eval of every ply, red-seat POV, cached +
// coalesced. Decision-vs-luck decomposition (Layer 2): the heavier, opt-in tier on top —
// per chance ply (a reveal or a face-down capture) it returns {best, played, realized} EVs (mover POV) so the client can
// split the swing into decision quality vs luck. Both replay the PUBLIC deal
// (loadFinishedJieqiGameInputs): a piece captured face-down or never turned over is
// graded from what both seats knew, never from its real identity, so a dark capture
// carries no luck. Gates/envelopes: the shared factory.
const handleAnalysisRoutes = createGameAnalysisRoutes({
  routeId: 'jieqi',
  logPrefix: 'jieqi',
  variantLabel: 'Jieqi',
  enabled: jieqiEnabled,
  requiresPersistence: true,
  // Fail closed, not open: analysis runs on AB-JChess when its binary and net resolve,
  // else on PikaJieQi (jieqiAnalysisEngine). With neither present the deploy is broken,
  // so surface it (alertable log + 503) instead of a weaker eval.
  engineBinary: {
    available: jieqiAnalysisEngineAvailable,
    label: 'jieqi analysis engine (AB-JChess or PikaJieQi)',
  },
  loadInputs: loadFinishedJieqiGameInputs,
  countPlies: (inputs) => inputs.moves.length,
  resolveAnalysis: (roomId, inputs, computeIfMissing) =>
    resolveJieqiAnalysis(roomId, inputs.moves, inputs.deal, undefined, undefined, computeIfMissing),
  // Mark the chance plies (a reveal, or a capture of a face-down piece) so the client leaves
  // them unjudged on the chart and grades them from the decisions layer. Unlike banqi's
  // from===to flip, both are normal moves, so we detect them by replaying the deal
  // (jieqiChancePlies), not by move shape.
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

  // One replay pass, two cheap projections per move, over the PUBLIC log
  // (jieqiPublicEvents): the deal keeps only the identities of pieces that
  // moved. Two tracks, because TV shows the game as it was PLAYED: `masked`
  // keeps a never-moved piece face-down (the default board), and `truth` is the
  // Reveal track. Since 2026-10-16 (Brian's rule: a piece captured face-down is
  // known only to its capturer, after the game too, and a piece never turned
  // over stays unknown to everyone) Reveal turns face-up only what moved, so a
  // never-moved piece stays face-down on both tracks and a dark capture stays
  // `role: null`. Nothing here reads the real deal, so swapping two hidden
  // identities in it changes no byte of the payload.
  const publicEvents = jieqiPublicEvents(events);
  let projection = replayTenantEvents(jieqiTenant, publicEvents.slice(0, 1));
  let ply = 0;
  const masked = [{ ply, view: jieqiWatchMaskedView(projection.state) }];
  const truth = [{ ply, view: jieqiWatchRevealView(projection.state) }];
  for (const event of publicEvents.slice(1)) {
    projection = applyTenantEvent(jieqiTenant, projection, event);
    if (event.type !== 'move-played') continue;
    ply += 1;
    masked.push({ ply, view: jieqiWatchMaskedView(projection.state) });
    truth.push({ ply, view: jieqiWatchRevealView(projection.state) });
  }

  // Never cache or return an in-progress projection.
  if (projection.state.status.type !== 'finished') return null;

  const view = truth.at(-1)?.view ?? jieqiWatchMaskedView(projection.state);
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

// The Reveal track for a FINISHED game, from a PUBLIC-deal state: every piece
// that moved face-up (it was revealed to both seats when it moved), every
// other one face-down and unknown, and the public capture list (a dark capture
// is `role: null`). No legal moves. Never built for an in-progress room.
function jieqiWatchRevealView(publicState: JieqiGameState): JieqiPlayerView {
  return { ...getJieqiPublicView(publicState), board: jieqiTruthBoard(publicState) };
}

// The as-played board for the same ply: the live room's SPECTATOR view
// (getJieqiPublicView), never a projection of canonical state. The shared masked
// board, and captures by owner with a role only where the piece was face-up when
// taken; a dark capture is `role: null`, which is what its victim saw. Under
// capturer-only reveal no seat's pool is honest for a spectator, so this is the
// one capture list TV may carry while a game is on. No legal moves are generated
// (this pass runs once per ply per game).
function jieqiWatchMaskedView(state: JieqiGameState): JieqiPlayerView {
  return getJieqiPublicView(state);
}

// The masked per-ply track alone, for an IN-PROGRESS room. The finished builder
// above walks the same events and adds the Reveal track beside it; this one must
// never, because the Reveal track turns never-moved pieces face-up and the game is
// still being played.
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
// is honest for a spectator; TV serves the public view instead, the same one the
// live room's spectator seat gets: the shared masked board, and the public
// capture list (a dark capture carries no role). The finished route's `view`
// (truth) and `history.truth` ARE the deal and are excluded here; the client's
// Reveal control is inert for a live game. Regression: jieqi-games.test.ts.
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
  return jieqiAnalysisInputsFromEvents(events);
}

// The analysis inputs of a FINISHED game's log, null for an unfinished one. The deal is the
// PUBLIC deal (jieqiPublicEvents): analysis and its decisions are computed and stored from what
// both seats saw, so nothing they send a client derives from a piece captured face-down or
// never turned over. Exported for the whole-payload leak test.
export function jieqiAnalysisInputsFromEvents(
  events: readonly JieqiEvent[],
): { deal: JieqiDeal; moves: JieqiMove[] } | null {
  const projection = replayTenantEvents(jieqiTenant, [...events]);
  if (projection.state.status.type !== 'finished') return null;
  const created = events[0];
  if (created?.type !== 'room-created' || created.setup === undefined) return null;
  const publicCreated = jieqiPublicEvents(events)[0];
  const deal =
    publicCreated?.type === 'room-created'
      ? (publicCreated.setup as JieqiDeal | undefined)
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

  // Replay the PUBLIC log (jieqiPublicEvents), never the stored deal: a piece
  // captured face-down is known only to its capturer and a piece never turned
  // over to no one, after the game too (Brian, 2026-10-16). This route is
  // public (no seat), so every reader gets the same payload, and swapping two
  // hidden identities in the real deal changes none of its bytes. A seat sees
  // its own dark captures named only in its finished live room.
  const publicEvents = jieqiPublicEvents(events);
  const projection = replayTenantEvents(jieqiTenant, publicEvents);
  if (projection.state.status.type !== 'finished') return null;
  // An imported game names its event and credits its source (engine-match-import.ts).
  const created = events[0];
  const origin = created?.type === 'room-created' ? created.origin : undefined;

  return {
    game: { ...postgameGameSummary(game), ...(origin ? { origin } : {}) },
    state: {
      status: projection.state.status,
      moveNumber: projection.state.moveNumber,
      ...(projection.clock ? { clock: projection.clock } : {}),
      ...(projection.timeControl ? { timeControl: projection.timeControl } : {}),
    },
    timeline: jieqiPostgameTimeline(events),
    // Every piece that moved, named; every other one unknown; dark captures
    // `role: null`. The review rebuilds its deal from history.truth[0].
    view: jieqiTruthView(projection.state),
    history: jieqiPostgameHistory(publicEvents),
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
      continue;
    }
    if (event.type === 'game-adjudicated') {
      timeline.push({ type: event.type, at: event.at, winner: event.winner, reason: event.reason });
    }
  }
  return timeline;
}
