import type { IncomingMessage, ServerResponse } from 'node:http';
import { BANQI_SPEC_ID, banqiTruthView } from '@mistboard/game';
import type { BanqiEvent } from './banqi-runtime.js';
import { banqiTenant } from './banqi-tenant.js';
import { banqiEnabled } from './feature-flags.js';
import * as persistence from './persistence.js';
import { writeJson } from './routes/lib.js';
import {
  applyTenantEvent,
  isTenantEventLog,
  replayTenantEvents,
} from './variant-tenant/runtime.js';

export type BanqiFinalRevealPersistence = {
  getGameSummary(roomId: string): ReturnType<typeof persistence.getGameSummary>;
  loadRoomEvents(roomId: string): Promise<BanqiEvent[] | null>;
};

const liveStore: BanqiFinalRevealPersistence = {
  getGameSummary: (roomId) => persistence.getGameSummary(roomId),
  loadRoomEvents: (roomId) => persistence.loadRoomEvents<BanqiEvent>(roomId),
};

/** A completed summary AND its authoritative event history must agree. A
 * client-side clock, a finished in-memory projection awaiting persistence, or
 * a stale summary alone never authorizes disclosure. Private provider rooms
 * have no anonymous reveal policy and fail closed here. */
export async function finalizedBanqiForReveal(
  roomId: string,
  store: BanqiFinalRevealPersistence = liveStore,
) {
  const [game, events] = await Promise.all([
    store.getGameSummary(roomId),
    store.loadRoomEvents(roomId),
  ]);
  if (
    !game ||
    game.roomId !== roomId ||
    game.variant !== BANQI_SPEC_ID ||
    game.visibility !== 'public' ||
    !Number.isFinite(game.endedAt?.getTime()) ||
    !events ||
    !isTenantEventLog(banqiTenant, events, roomId)
  )
    return null;

  let projection = replayTenantEvents(banqiTenant, events.slice(0, 1));
  // Summary endedAt is the event tail when the row was recorded, which can
  // follow the terminal move. Later seat/clock bookkeeping may follow that
  // anchor too, so neither the first finish nor today's log tail is sufficient.
  let finalizedAnchor = false;
  for (const event of events.slice(1)) {
    projection = applyTenantEvent(banqiTenant, projection, event);
    const status = projection.state.status;
    if (
      event.at === game.endedAt.getTime() &&
      status.type === 'finished' &&
      game.result === banqiTenant.persistence.resultForWinner(status.winner) &&
      game.termination === banqiTenant.persistence.termination(status.reason)
    )
      finalizedAnchor = true;
  }
  const status = projection.state.status;
  const moveCount = events.filter((event) => event.type === 'move-played').length;
  if (
    status.type !== 'finished' ||
    !finalizedAnchor ||
    game.plyCount !== moveCount ||
    game.result !== banqiTenant.persistence.resultForWinner(status.winner) ||
    game.termination !== banqiTenant.persistence.termination(status.reason)
  )
    return null;

  return { roomId, finalizedAt: game.endedAt.toISOString(), state: projection.state };
}

export function createBanqiFinalRevealRoutes(
  deps: {
    store?: BanqiFinalRevealPersistence;
    enabled?(): boolean;
    persistenceReady?(): boolean;
  } = {},
) {
  return async (
    request: IncomingMessage,
    response: ServerResponse,
    pathname: string,
  ): Promise<boolean> => {
    const match = /^\/api\/banqi\/games\/([^/]+)\/reveal$/.exec(pathname);
    if (!match) return false;
    response.setHeader('Cache-Control', 'no-store');
    const notFound = () => {
      if (request.method === 'HEAD') response.writeHead(404).end();
      else writeJson(response, 404, { error: 'not_found' });
    };
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      writeJson(response, 405, { error: 'method_not_allowed' });
      return true;
    }
    if (
      !(deps.enabled ?? banqiEnabled)() ||
      !(deps.persistenceReady ?? persistence.isInitialized)()
    ) {
      notFound();
      return true;
    }
    let roomId: string;
    try {
      roomId = decodeURIComponent(match[1]!);
    } catch {
      notFound();
      return true;
    }
    const finalized = await finalizedBanqiForReveal(roomId, deps.store);
    if (!finalized) {
      notFound();
      return true;
    }
    // HEAD is readiness only. The default room flow never downloads identities
    // merely to decide whether its menu item may be enabled.
    if (request.method === 'HEAD') response.writeHead(204).end();
    else
      writeJson(response, 200, {
        roomId: finalized.roomId,
        finalizedAt: finalized.finalizedAt,
        view: banqiTruthView(finalized.state),
      });
    return true;
  };
}
