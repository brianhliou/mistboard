import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  type BanqiSeat,
  FFQ_BANQI_SPEC_ID,
  getFFQBanqiPlayerView,
  oppositeBanqiSeat,
} from '@mistboard/game';
import { currentAccountUser } from './../account-session.js';
import { ffqBanqiAdmits } from './../ffq-banqi-access.js';
import { ffqBanqiPostgameHistory } from '../ffq-banqi-replay.js';
import { type FFQBanqiEvent, ffqBanqiTenant } from './../ffq-banqi-tenant.js';
import * as persistence from './../persistence.js';
import { isTenantEventLog, replayTenantEvents } from './../variant-tenant/runtime.js';
import { type HttpApiContext, postgameGameSummary, requireMethod, writeJson } from './lib.js';

// Admin-only finished replay. All snapshots are observer-masked, even after
// game end. The deal and the old flip variants' revealed track never leave here.

type FFQBanqiPostgameMove = {
  type: 'move-played';
  at: number;
  color: BanqiSeat;
  move: { from: number; to: number };
  ply: number;
};

type FFQBanqiPostgameTerminal =
  | { type: 'clock-expired'; at: number; color: BanqiSeat; winner: BanqiSeat }
  | { type: 'seat-resigned'; at: number; color: BanqiSeat; winner: BanqiSeat }
  | { type: 'seat-forfeited'; at: number; color: BanqiSeat; winner: BanqiSeat }
  | { type: 'game-aborted'; at: number; reason: string };

export type FFQBanqiPostgamePersistence = {
  getGameSummary(roomId: string): ReturnType<typeof persistence.getGameSummary>;
  loadRoomEvents(roomId: string): Promise<FFQBanqiEvent[] | null>;
};

/** Everything the handler reads from outside, injectable for the route tests. */
export type FFQBanqiPostgameRouteDeps = FFQBanqiPostgamePersistence & {
  persistenceReady(): boolean;
  admits(request: IncomingMessage): Promise<boolean>;
};

const defaultDeps: FFQBanqiPostgameRouteDeps = {
  getGameSummary: (roomId) => persistence.getGameSummary(roomId),
  loadRoomEvents: (roomId) => persistence.loadRoomEvents<FFQBanqiEvent>(roomId),
  persistenceReady: () => persistence.isInitialized(),
  admits: async (request) => ffqBanqiAdmits(await currentAccountUser(request)),
};

const POSTGAME_ROUTE = /^\/api\/ffq-banqi\/games\/([^/]+)$/;

export async function tryHandle(
  _ctx: HttpApiContext,
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  _parsedUrl: URL,
): Promise<boolean> {
  return handleFFQBanqiPostgame(request, response, pathname);
}

export async function handleFFQBanqiPostgame(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  deps: FFQBanqiPostgameRouteDeps = defaultDeps,
): Promise<boolean> {
  const match = pathname.match(POSTGAME_ROUTE);
  if (!match) return false;
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('x-robots-tag', 'noindex');
  if (!requireMethod(request, response, 'GET')) return true;
  // The gate comes before persistence and the lookup: a refused caller learns
  // nothing, not even whether the database is up.
  if (!(await deps.admits(request))) {
    writeJson(response, 404, { error: 'not_found' });
    return true;
  }
  if (!deps.persistenceReady()) {
    writeJson(response, 503, { error: 'persistence_disabled' });
    return true;
  }
  const payload = await ffqBanqiPostgameForApi(decodeURIComponent(match[1]!), deps);
  if (!payload) {
    writeJson(response, 404, { error: 'not_found' });
    return true;
  }
  writeJson(response, 200, payload);
  return true;
}

export async function ffqBanqiPostgameForApi(
  roomId: string,
  deps: FFQBanqiPostgamePersistence = defaultDeps,
) {
  const [game, events] = await Promise.all([
    deps.getGameSummary(roomId),
    deps.loadRoomEvents(roomId),
  ]);
  if (!game || game.variant !== FFQ_BANQI_SPEC_ID) return null;
  if (!events || !isTenantEventLog(ffqBanqiTenant, events, roomId)) return null;

  const projection = replayTenantEvents(ffqBanqiTenant, events);
  if (projection.state.status.type !== 'finished') return null;

  return {
    game: postgameGameSummary(game),
    state: {
      status: projection.state.status,
      moveNumber: projection.state.moveNumber,
      ...(projection.clock ? { clock: projection.clock } : {}),
      ...(projection.timeControl ? { timeControl: projection.timeControl } : {}),
    },
    timeline: ffqBanqiPostgameTimeline(events),
    view: getFFQBanqiPlayerView(projection.state, 'observer'),
    history: ffqBanqiPostgameHistory(events),
  };
}

function ffqBanqiPostgameTimeline(
  events: readonly FFQBanqiEvent[],
): Array<FFQBanqiPostgameMove | FFQBanqiPostgameTerminal> {
  const timeline: Array<FFQBanqiPostgameMove | FFQBanqiPostgameTerminal> = [];
  let ply = 0;
  for (const event of events) {
    if (event.type === 'move-played') {
      ply += 1;
      timeline.push({
        type: event.type,
        at: event.at,
        color: event.color,
        move: { from: event.move.from, to: event.move.to },
        ply,
      });
      continue;
    }
    if (
      event.type === 'clock-expired' ||
      event.type === 'seat-resigned' ||
      event.type === 'seat-forfeited'
    ) {
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
