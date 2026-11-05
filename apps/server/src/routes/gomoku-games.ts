import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  GOMOKU_SPEC_ID,
  type GomokuColor,
  type GomokuMove,
  type GomokuPlayerView,
  getGomokuPlayerView,
} from '@mistboard/game';
import { currentAccountUser } from '../account-session.js';
import { gomokuAdmits } from '../gomoku-access.js';
import { resolveGomokuAnalysis } from '../gomoku-analysis.js';
import { gomokuRooms } from '../gomoku-registration.js';
import {
  type GomokuEvent,
  type GomokuRuntimeRoom,
  gomokuTenant,
  isGomokuEngineClientId,
} from '../gomoku-tenant.js';
import * as persistence from '../persistence.js';
import { buildTenantGameSummary } from '../variant-tenant/events.js';
import { guardTenantReplay, UnreplayableTenantGameError } from '../variant-tenant/replay-guard.js';
import {
  applyTenantEvent,
  isTenantEventLog,
  replayTenantEvents,
  tenantEventWasAccepted,
} from '../variant-tenant/runtime.js';
import type { TenantClockState } from '../variant-tenant/tenant.js';
import { registerLiveWatchPayloadBuilder } from '../watch-live.js';
import { createGameAnalysisRoutes } from './game-analysis-route.js';
import {
  type HttpApiContext,
  type PostgameGameSummary,
  postgameGameSummary,
  postgamePlayers,
  requireMethod,
  writeJson,
} from './lib.js';

// Gomoku replay. Both read paths require runtime admission; merely
// registering the live builder does not opt the tenant into watch election.
export type GomokuPostgamePersistence = {
  getGameSummary(roomId: string): ReturnType<typeof persistence.getGameSummary>;
  loadRoomEvents(roomId: string): Promise<readonly unknown[] | null>;
  isPersistenceEnabled?(): boolean;
  getLiveRoom?(roomId: string): GomokuRuntimeRoom | null;
};

const defaultPersistence: GomokuPostgamePersistence = {
  getGameSummary: persistence.getGameSummary,
  loadRoomEvents: (roomId) => persistence.loadRoomEvents<GomokuEvent>(roomId),
  isPersistenceEnabled: persistence.isInitialized,
  getLiveRoom: (roomId) => gomokuRooms.get(roomId) ?? null,
};

type GomokuPostgameRouteDeps = GomokuPostgamePersistence & {
  currentAccountUser: typeof currentAccountUser;
  resolveAnalysis?: typeof resolveGomokuAnalysis;
};

const defaultRouteDeps: GomokuPostgameRouteDeps = { ...defaultPersistence, currentAccountUser };

export async function tryHandle(
  _ctx: HttpApiContext,
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  _parsedUrl: URL,
  deps: GomokuPostgameRouteDeps = defaultRouteDeps,
): Promise<boolean> {
  if (/^\/api\/gomoku\/games\/[^/]+\/analysis(?:\/jobs\/[^/]+)?$/.test(pathname)) {
    const user = await deps.currentAccountUser(request);
    // Cover cached reads AND job polls with the same playtest admission as
    // replay; the generic route's enabled() alone cannot admit an admin.
    if (!gomokuAdmits(user)) {
      writeJson(response, 404, { error: 'not_found' });
      return true;
    }
    try {
      // Refuse malformed escapes before the shared route decodes the segments.
      decodeURIComponent(pathname);
    } catch {
      writeJson(response, 404, { error: 'not_found' });
      return true;
    }
    const handleAnalysis = createGameAnalysisRoutes(
      {
        routeId: 'gomoku',
        logPrefix: 'gomoku',
        variantLabel: 'Gomoku',
        enabled: () => true, // Admission was checked above, including every poll.
        requiresPersistence: false, // Finished memory-only rooms use the same log.
        loadInputs: async (roomId: string) => {
          const replay = await gomokuPostgameForApi(roomId, deps, user);
          if (!replay) return null;
          return {
            opening: replay.history.truth[0]?.view.opening,
            moves: replay.timeline.flatMap((e) => (e.type === 'move-played' ? [e.move] : [])),
          };
        },
        countPlies: (inputs) => inputs.moves.length,
        resolveAnalysis: (roomId, inputs, compute) =>
          (deps.resolveAnalysis ?? resolveGomokuAnalysis)(
            roomId,
            inputs.moves,
            inputs.opening,
            undefined,
            undefined,
            compute,
          ),
      },
      { currentUser: async () => user },
    );
    return handleAnalysis(request, response, pathname);
  }
  const match = pathname.match(/^\/api\/gomoku\/games\/([^/]+)$/);
  if (!match) return false;
  if (!requireMethod(request, response, 'GET')) return true;
  let roomId: string;
  try {
    roomId = decodeURIComponent(match[1]!);
  } catch {
    writeJson(response, 404, { error: 'not_found' });
    return true;
  }
  const payload = await gomokuPostgameForApi(roomId, deps, await deps.currentAccountUser(request));
  if (!payload) writeJson(response, 404, { error: 'not_found' });
  else writeJson(response, 200, payload);
  return true;
}

export async function gomokuPostgameForApi(
  roomId: string,
  deps: GomokuPostgamePersistence = defaultPersistence,
  accountUser: Pick<persistence.UserAccount, 'accountRole'> | null = null,
) {
  // Refused callers learn nothing about the room or persistence availability.
  if (!gomokuAdmits(accountUser)) return null;
  const persistent = deps.isPersistenceEnabled?.() ?? true;
  const [record, events] = await Promise.all([
    persistent ? deps.getGameSummary(roomId) : null,
    persistent ? deps.loadRoomEvents(roomId) : null,
  ]);
  if (record && (record.roomId !== roomId || record.variant !== GOMOKU_SPEC_ID || record.rated))
    return null;
  // Invalid persisted data must not be rescued by a different in-memory log.
  let replay = events ? gomokuReplayForApi(roomId, events) : null;
  if (events && !replay) return null;
  let game: PostgameGameSummary;
  if (record && replay) {
    game = postgameGameSummary(record);
  } else {
    // Memory-only development and the interval before a finished room's game
    // record is durable use the same event truth, after pending writes settle.
    const room = deps.getLiveRoom?.(roomId);
    if (!room || room.id !== roomId) return null;
    await room.pendingWrites.catch(() => undefined);
    replay = gomokuReplayForApi(roomId, room.events);
    if (replay?.projection.state.status.type !== 'finished') return null;
    const summary = buildTenantGameSummary(gomokuTenant, {
      ...room,
      projection: replay.projection,
    });
    game = {
      roomId,
      variant: GOMOKU_SPEC_ID,
      mode: summary.mode ?? 'pvp',
      result: summary.result,
      termination: summary.termination,
      plyCount: summary.plyCount,
      startedAt: summary.startedAt.toISOString(),
      endedAt: summary.endedAt.toISOString(),
      rated: false,
      visibility: summary.visibility ?? 'public',
      initialMs: summary.initialMs ?? null,
      incrementMs: summary.incrementMs ?? null,
      players: postgamePlayers(summary.participants ?? []),
    };
  }
  // A finished record cannot turn an unfinished or aborted log into a replay.
  if (replay.projection.state.status.type !== 'finished') return null;
  return {
    game: { ...game, ...(replay.pveEngineId ? { pveEngineId: replay.pveEngineId } : {}) },
    ...replay.payload,
  };
}

export async function gomokuLiveWatchPayload(
  roomId: string,
  accountUser: Pick<persistence.UserAccount, 'accountRole'> | null = null,
) {
  // Public TV calls without an account and remains closed when the flag is
  // off. Admin admission here never opts a room into the public election.
  if (!gomokuAdmits(accountUser)) return null;
  const room = gomokuRooms.get(roomId);
  if (!room || room.id !== roomId) return null;
  await room.pendingWrites.catch(() => undefined);
  const replay = gomokuReplayForApi(roomId, room.events);
  if (replay?.projection.state.status.type !== 'playing') return null;
  const { projection, payload, pveEngineId } = replay;
  return {
    game: {
      roomId,
      variant: GOMOKU_SPEC_ID,
      mode: pveEngineId ? 'pve' : 'pvp',
      result: 'in-progress',
      termination: 'in-progress',
      plyCount: payload.history.truth.length - 1,
      startedAt: new Date(room.events[0]!.at).toISOString(),
      endedAt: null,
      rated: false,
      visibility: 'public',
      initialMs: projection.timeControl?.initialMs ?? null,
      incrementMs: projection.timeControl?.incrementMs ?? null,
      ...(pveEngineId ? { pveEngineId } : {}),
    },
    ...payload,
  };
}

// Election and channel listings remain governed by the flag and publicSurface.
registerLiveWatchPayloadBuilder('gomoku', gomokuLiveWatchPayload);

type GomokuSnapshot = {
  ply: number;
  at: number;
  view: GomokuPlayerView;
  clock?: TenantClockState<GomokuColor>;
};
type GomokuTimelineEntry =
  | {
      type: 'move-played';
      at: number;
      color: GomokuColor;
      move: GomokuMove;
      ply: number;
    }
  | {
      type: 'clock-expired' | 'seat-resigned' | 'seat-forfeited';
      at: number;
      color: GomokuColor;
      winner: GomokuColor;
    }
  | { type: 'draw-agreed'; at: number; color: GomokuColor; winner: null };

function gomokuReplayForApi(roomId: string, events: readonly unknown[]) {
  if (!isTenantEventLog(gomokuTenant, events, roomId)) return null;
  try {
    return guardTenantReplay(gomokuTenant.kind, roomId, () => {
      const created = events[0]!;
      let projection = replayTenantEvents(gomokuTenant, [created]);
      if (projection.rated) return null;
      let ply = 0;
      const snapshot = (at: number): GomokuSnapshot => ({
        ply,
        at,
        view: getGomokuPlayerView(projection.state, 'black', true),
        ...(projection.clock ? { clock: projection.clock } : {}),
      });
      const truth = [snapshot(created.at)];
      const timeline: GomokuTimelineEntry[] = [];
      for (const event of events.slice(1)) {
        if (event.type === 'room-created') throw new Error('duplicate room-created');
        const next = applyTenantEvent(gomokuTenant, projection, event);
        if (!tenantEventWasAccepted(projection, next, event))
          throw new Error(`rejected ${event.type}`);
        projection = next;
        if (event.type === 'move-played') {
          // Kernel ply includes dealt stones; replay ply counts only events.
          ply += 1;
          timeline.push({
            type: event.type,
            at: event.at,
            color: event.color,
            move: { to: event.move.to },
            ply,
          });
          truth.push(snapshot(event.at));
        } else {
          // Include clock start/pause/resume and EVERY terminal event in the
          // current ply, even without a clock. Never add a fictitious move.
          truth[truth.length - 1] = snapshot(event.at);
          if (
            event.type === 'clock-expired' ||
            event.type === 'seat-resigned' ||
            event.type === 'seat-forfeited'
          )
            timeline.push({
              type: event.type,
              at: event.at,
              color: event.color,
              winner: gomokuTenant.oppositeColor(event.color),
            });
          else if (event.type === 'draw-agreed')
            timeline.push({ type: event.type, at: event.at, color: event.color, winner: null });
        }
      }
      const view = getGomokuPlayerView(projection.state, 'black', true);
      const pveEngineId = gomokuTenant.colors
        .map((color) => projection.seats[color])
        .find((clientId) => isGomokuEngineClientId(clientId));
      return {
        projection,
        pveEngineId,
        payload: {
          state: {
            status: projection.state.status,
            moveNumber: projection.state.moveNumber,
            ...(projection.clock ? { clock: projection.clock } : {}),
            ...(projection.timeControl ? { timeControl: projection.timeControl } : {}),
          },
          view,
          views: { truth: view },
          history: { truth },
          timeline,
        },
      };
    });
  } catch (err) {
    if (err instanceof UnreplayableTenantGameError) return null;
    throw err;
  }
}
