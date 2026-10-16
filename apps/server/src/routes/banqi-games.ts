import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  BANQI_SPEC_ID,
  type BanqiMove,
  type BanqiPlayerView,
  type BanqiSeat,
  type BanqiStoredSetup,
  banqiTruthView,
  getBanqiPlayerView,
  oppositeBanqiSeat,
} from '@mistboard/game';
import { resolveBanqiAnalysis, resolveBanqiDecisions } from './../banqi-analysis.js';
import { banqiEngineBinaryAvailable } from './../banqi-engine.js';
import { banqiRooms } from './../banqi-registration.js';
import type { BanqiEvent } from './../banqi-runtime.js';
import { banqiTenant } from './../banqi-tenant.js';
import { banqiEnabled } from './../feature-flags.js';
import * as persistence from './../persistence.js';
import type { BanqiLiveRoom } from './../server-ws-banqi.js';
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

// Banqi postgame review. Banqi is SYMMETRIC-information: a face-down tile is
// hidden from BOTH seats equally, and every capture is of an already-revealed
// (face-up) piece, so neither seat ever holds private knowledge the other lacks.
// That collapses jieqi's per-seat (red/black) split — the two masked views would
// be identical — to a SINGLE truth review surface. The web postgame keys off
// `view` + `history.truth` and renders one board with a working per-ply replay.

type BanqiPostgameSnapshot = {
  ply: number;
  view: BanqiPlayerView;
};

type BanqiPostgameMove = {
  type: 'move-played';
  at: number;
  color: BanqiSeat;
  move: { from: string; to: string };
  ply: number;
};

type BanqiPostgameTerminal =
  | { type: 'clock-expired'; at: number; color: BanqiSeat; winner: BanqiSeat }
  | { type: 'seat-resigned'; at: number; color: BanqiSeat; winner: BanqiSeat }
  | { type: 'seat-forfeited'; at: number; color: BanqiSeat; winner: BanqiSeat }
  | { type: 'game-aborted'; at: number; reason: string };

// Injectable so the route can be unit-tested without a live database, mirroring
// the jieqi route.
export type BanqiPostgamePersistence = {
  getGameSummary(roomId: string): ReturnType<typeof persistence.getGameSummary>;
  loadRoomEvents(roomId: string): Promise<BanqiEvent[] | null>;
};

const defaultPersistence: BanqiPostgamePersistence = {
  getGameSummary: (roomId) => persistence.getGameSummary(roomId),
  loadRoomEvents: (roomId) => persistence.loadRoomEvents<BanqiEvent>(roomId),
};

// Computer analysis (Layer 1): fixed-strength eval of every ply, red-seat POV, cached +
// coalesced. Decision-vs-luck decomposition (Layer 2): the heavier, opt-in tier on top —
// per FLIP ply it returns {best, played, realized} EVs (mover POV) so the client can split
// the swing into decision quality vs luck. Banqi is hidden-info, so reconstruction needs
// the per-game DEAL (events[0].setup) — we replay the raw event log (which retains the
// server-secret deal) rather than the client payload. Gates/envelopes: the shared factory.
const handleAnalysisRoutes = createGameAnalysisRoutes({
  routeId: 'banqi',
  logPrefix: 'banqi',
  variantLabel: 'Banqi',
  enabled: banqiEnabled,
  requiresPersistence: true,
  // Fail closed, not open: the analysis engine is the MistyBanqi binary ONLY. A missing
  // binary is a broken deploy, so surface it (alertable log + 503) instead of a weaker eval.
  engineBinary: { available: banqiEngineBinaryAvailable, label: 'banqi-engine binary' },
  loadInputs: loadFinishedBanqiGameInputs,
  countPlies: (inputs) => inputs.moves.length,
  resolveAnalysis: (roomId, inputs, computeIfMissing) =>
    resolveBanqiAnalysis(roomId, inputs.moves, inputs.deal, undefined, undefined, computeIfMissing),
  // Mark the flip (chance) plies so the client leaves them unjudged: a flip is a move with
  // from === to, and the move at index i lands on ply i+1.
  analysisExtras: (inputs) => ({
    chancePlies: inputs.moves.reduce<number[]>((acc, move, i) => {
      if (move.from === move.to) acc.push(i + 1);
      return acc;
    }, []),
  }),
  resolveDecisions: (roomId, inputs, computeIfMissing) =>
    resolveBanqiDecisions(
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

  const postgameMatch = pathname.match(/^\/api\/banqi\/games\/([^/]+)$/);
  if (!postgameMatch) return false;

  if (!requireMethod(request, response, 'GET')) return true;
  if (!banqiEnabled()) {
    writeJson(response, 404, { error: 'not_found' });
    return true;
  }
  if (!requirePersistence(response)) return true;

  const roomId = decodeURIComponent(postgameMatch[1]!);
  const payload = await banqiPostgameForApi(roomId);
  if (!payload) {
    writeJson(response, 404, { error: 'not_found' });
    return true;
  }
  writeJson(response, 200, payload);
  return true;
}

// Shared loader for the analysis tiers (both `/analysis` and `/decisions`): the per-game deal
// (from the room-created event) + the move list, but only for a FINISHED game. Returns null for
// a missing / non-banqi / unfinished game or a log with no deal.
async function loadFinishedBanqiGameInputs(
  roomId: string,
): Promise<{ deal: BanqiStoredSetup; moves: BanqiMove[] } | null> {
  const events = await persistence.loadRoomEvents<BanqiEvent>(roomId);
  if (!events || !isTenantEventLog(banqiTenant, events, roomId)) return null;
  const projection = replayTenantEvents(banqiTenant, events);
  if (projection.state.status.type !== 'finished') return null;
  const created = events[0];
  // The stored setup as-is (deal + the rules the room was created under, or a
  // pre-rule bare deal): analysis reads it the way the tenant's replay does.
  const deal =
    created && created.type === 'room-created'
      ? (created.setup as BanqiStoredSetup | undefined)
      : undefined;
  if (!deal) return null;
  const moves = events
    .filter(
      (event): event is Extract<BanqiEvent, { type: 'move-played' }> =>
        event.type === 'move-played',
    )
    .map((event) => event.move as BanqiMove);
  return { deal, moves };
}

export async function banqiPostgameForApi(
  roomId: string,
  deps: BanqiPostgamePersistence = defaultPersistence,
) {
  const [game, events] = await Promise.all([
    deps.getGameSummary(roomId),
    deps.loadRoomEvents(roomId),
  ]);
  if (!game || game.variant !== BANQI_SPEC_ID) return null;
  if (!events || !isTenantEventLog(banqiTenant, events, roomId)) return null;

  // Replay reconstructs the FULL-TRUTH state: the per-game deal lives in
  // events[0].setup and is applied during createInitialState, so every hidden
  // identity is known to the server here. Banqi has no private capture
  // knowledge, so the truth view IS the review surface.
  const projection = replayTenantEvents(banqiTenant, events);
  if (projection.state.status.type !== 'finished') return null;

  return {
    game: postgameGameSummary(game),
    state: {
      status: projection.state.status,
      moveNumber: projection.state.moveNumber,
      ...(projection.clock ? { clock: projection.clock } : {}),
      ...(projection.timeControl ? { timeControl: projection.timeControl } : {}),
    },
    timeline: banqiPostgameTimeline(events),
    // Truth view: every identity revealed (postgame-only; never on a live wire).
    // This is the final-position "here is the full deal" surface, used as a
    // fallback only — the replay below steps through the masked per-ply history.
    view: banqiTruthView(projection.state),
    // Two per-ply histories: 'truth' is the AS-PLAYED masked replay (unflipped
    // tiles render face-down, reproducing the game as it actually looked);
    // 'revealed' is the spoiler overlay (every face-down identity shown at every
    // ply) that the review's Reveal toggle swaps in. The watch surface only reads
    // the masked 'truth' history, so it never spoils the deal.
    history: banqiPostgameHistory(events),
  };
}

// Per-ply replay snapshots, built in two parallel tracks:
//
//   truth   — the MASKED player view: a tile not yet flipped at a given ply
//             renders face-down, so the replay reproduces the game as it was
//             actually played (tiles turning over one at a time) instead of
//             revealing the whole deal from move 0. Banqi is symmetric, so
//             either seat's mask yields the identical board; 'red' is arbitrary.
//   revealed — the full-truth view: every face-down identity shown at every ply,
//             the spoiler overlay the review's Reveal toggle swaps in.
//
// The misnomer is historical: 'truth' is the canonical as-played replay surface
// (the watch reads it), 'revealed' is the optional overlay.
// `includeRevealed: false` builds ONLY the masked as-played track. That is the
// live-broadcast shape: the spoiler overlay is the whole deal, so it must never
// be built for an IN-PROGRESS game (see banqiLiveWatchPayload).
function banqiPostgameHistory(
  events: readonly BanqiEvent[],
  includeRevealed = true,
): {
  truth: BanqiPostgameSnapshot[];
  revealed?: BanqiPostgameSnapshot[];
} {
  const created = events[0];
  if (created?.type !== 'room-created') {
    return includeRevealed ? { truth: [], revealed: [] } : { truth: [] };
  }
  let projection = replayTenantEvents(banqiTenant, [created]);
  let ply = 0;
  const truth: BanqiPostgameSnapshot[] = [
    { ply, view: getBanqiPlayerView(projection.state, 'red') },
  ];
  const revealed: BanqiPostgameSnapshot[] = includeRevealed
    ? [{ ply, view: banqiTruthView(projection.state) }]
    : [];

  for (const event of events.slice(1)) {
    projection = applyTenantEvent(banqiTenant, projection, event);
    if (event.type !== 'move-played') continue;
    ply += 1;
    truth.push({ ply, view: getBanqiPlayerView(projection.state, 'red') });
    if (includeRevealed) revealed.push({ ply, view: banqiTruthView(projection.state) });
  }
  return includeRevealed ? { truth, revealed } : { truth };
}

// Mistboard TV live payload for an IN-PROGRESS banqi room. Same hidden-info
// boundary as Flip Jungle: banqi is SYMMETRIC hidden-identity, so the masked view
// is what BOTH seats see and a spectator holding it learns nothing — but the
// finished route's `view` (banqiTruthView) and `history.revealed` ARE the deal and
// are excluded here. Regression: watch-live.test.ts.
export function banqiLiveWatchPayloadFor(
  roomId: string,
  room: Pick<BanqiLiveRoom, 'id' | 'events' | 'projection'>,
): Record<string, unknown> | null {
  if (room.id !== roomId) return null;
  const projection = room.projection;
  if (projection.state.status.type !== 'playing') return null;
  if (!isTenantEventLog(banqiTenant, room.events, roomId)) return null;
  const timeline = banqiPostgameTimeline(room.events);
  const isEngine = banqiTenant.engine?.isEngineClientId ?? (() => false);
  const hasEngineSeat = Object.values(projection.seats).some((clientId) => isEngine(clientId));
  return {
    game: {
      roomId,
      variant: BANQI_SPEC_ID,
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
    // Masked view (either seat's — they are identical), NOT banqiTruthView.
    view: getBanqiPlayerView(projection.state, 'red'),
    // Masked track only; no `revealed` overlay exists for a live game.
    history: banqiPostgameHistory(room.events, false),
  };
}

async function banqiLiveWatchPayload(roomId: string): Promise<Record<string, unknown> | null> {
  if (!banqiEnabled()) return null;
  const room = banqiRooms.get(roomId) ?? null;
  if (!room) return null;
  await room.pendingWrites.catch(() => undefined);
  return banqiLiveWatchPayloadFor(roomId, room);
}

registerLiveWatchPayloadBuilder('banqi', banqiLiveWatchPayload);

function banqiPostgameTimeline(
  events: readonly BanqiEvent[],
): Array<BanqiPostgameMove | BanqiPostgameTerminal> {
  const timeline: Array<BanqiPostgameMove | BanqiPostgameTerminal> = [];
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
        winner: oppositeBanqiSeat(event.color),
      });
      continue;
    }
    if (event.type === 'seat-resigned' || event.type === 'seat-forfeited') {
      timeline.push({
        type: event.type,
        at: event.at,
        color: event.color,
        winner: oppositeBanqiSeat(event.color),
      });
      continue;
    }
    if (event.type === 'game-aborted') {
      timeline.push({ type: event.type, at: event.at, reason: event.reason });
    }
  }
  return timeline;
}
