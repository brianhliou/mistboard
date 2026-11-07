// Flag-gated Gomoku rooms. Rapfi replies are computed on the server.
import {
  GOMOKU_SPEC_ID,
  type GomokuColor,
  getGomokuPlayerView,
  type RoomTimeControl,
} from '@mistboard/game';
import { currentAccountUser } from './account-session.js';
import { gomokuEnabled } from './feature-flags.js';
import { tenantExportBinding } from './game-export-tenant.js';
import { gomokuAdmits } from './gomoku-access.js';
import { scheduleGomokuEngineMove } from './gomoku-engine.js';
import {
  type GomokuEvent,
  type GomokuRuntimeRoom,
  gomokuTenant,
  isGomokuEngineClientId,
} from './gomoku-tenant.js';
import * as persistence from './persistence.js';
import { isAllowedFullTimeControl, writeJson } from './routes/lib.js';
import { tenantCorrespondenceBinding } from './variant-tenant/correspondence.js';
import { recordTenantPersistenceError } from './variant-tenant/events.js';
import { getOrLoadTenantRoom } from './variant-tenant/hydration.js';
import { pauseTenantRoomsOnShutdown } from './variant-tenant/lifecycle.js';
import {
  registerVariantTenant,
  type TenantManagedRoom,
  variantTenantRoomIdTaken,
} from './variant-tenant/registry.js';
import { createTenantLiveRoom, type TenantRoomEngineSeat } from './variant-tenant/room-factory.js';
import {
  createTenantRoomsRoute,
  type TenantRoomCreateBaseContext,
} from './variant-tenant/rooms-route.js';
import {
  countActiveTenantGames,
  isTenantEventLog,
  replayTenantEvents,
  tenantReplayCheck,
} from './variant-tenant/runtime.js';
import {
  clearTenantRuntimeTimers,
  createTenantWsRuntime,
  type TenantLiveRoom,
} from './variant-tenant/ws.js';

export const gomokuRooms = new Map<string, GomokuRuntimeRoom>();
export const gomokuWs = createTenantWsRuntime(gomokuTenant, {
  scheduleEngineMove: (ctx, room) => scheduleGomokuEngineMove(ctx, room),
});
const gomokuCorrespondence = tenantCorrespondenceBinding(
  // Live admin playtests bypass the flag at their own admission doors. Async
  // seeks use the registration flag and the shared per-account grant checks;
  // the factory must also refuse while the Gomoku flag is off.
  { ...gomokuTenant, enabled: gomokuEnabled },
  {
    factoryContext: () => ({
      rooms: gomokuRooms,
      isRoomIdTaken: (roomId) => variantTenantRoomIdTaken(roomId, gomokuTenant.kind),
      appendRoomEvent: persistence.appendRoomEvent,
      isPersistenceEnabled: persistence.isInitialized,
      recordPersistenceError: (roomId, seq, eventType, err) =>
        recordTenantPersistenceError(gomokuTenant, roomId, seq, eventType, err),
    }),
    getOrLoadRoom: (roomId) => getOrLoadTenantRoom(gomokuTenant, gomokuRooms, roomId),
    lifecycleCtx: gomokuWs.lifecycleCtx,
  },
);
const gomokuExport = tenantExportBinding(gomokuTenant, {
  gameRouteBase: '/gomoku/game',
  uci: (move) => move.to,
  opening: (state) => state.opening ?? { stones: [], turn: 'black' },
});
type LiveRoom = TenantLiveRoom<
  'gomoku',
  GomokuColor,
  import('@mistboard/game').GomokuMove,
  import('@mistboard/game').GomokuRoomState,
  typeof gomokuTenant.gameSpecId
>;

export async function createGomokuRoom(
  timeControl?: RoomTimeControl,
  creatorPreference?: GomokuColor | 'random',
  engine?: TenantRoomEngineSeat<GomokuColor>,
  rated = false,
) {
  if (
    engine &&
    (!isGomokuEngineClientId(engine.engineId) || !gomokuTenant.rules.isColor(engine.seat))
  )
    throw new Error('gomoku: invalid engine seat');
  const created = await createTenantLiveRoom(
    gomokuTenant,
    {
      rooms: gomokuRooms,
      isRoomIdTaken: (roomId) => variantTenantRoomIdTaken(roomId, gomokuTenant.kind),
      appendRoomEvent: (roomId, seq, event: GomokuEvent) =>
        persistence.appendRoomEvent(roomId, seq, event),
      isPersistenceEnabled: persistence.isInitialized,
      recordPersistenceError: (roomId, seq, eventType, err) =>
        recordTenantPersistenceError(gomokuTenant, roomId, seq, eventType, err),
    },
    {
      timeControl,
      creatorPreference,
      engine: engine ? { engineId: engine.engineId, seat: engine.seat } : undefined,
      rated: engine ? false : rated,
    },
  );
  if (!created.ok && created.error === 'disabled')
    return { ok: false as const, error: 'gomoku_disabled' as const };
  return created;
}

// The shared factory persists the bot seat; the WebSocket runtime schedules replies.
const route = createTenantRoomsRoute<
  TenantRoomCreateBaseContext & { createGomokuRoom: typeof createGomokuRoom },
  GomokuColor | 'random',
  GomokuColor
>({
  gameSpecId: GOMOKU_SPEC_ID,
  errorPrefix: 'gomoku',
  hasDisabledFlag: true,
  admits: gomokuAdmits,
  preferredColors: ['black', 'white', 'random'],
  engine: {
    kind: 'seated',
    defaultEngineId: 'rapfi-level-1',
    isEngineClientId: isGomokuEngineClientId,
    seats: ['black', 'white'],
  },
  createRoom: (ctx, { timeControl, preferredColor, engine, rated }) =>
    ctx.createGomokuRoom(timeControl, preferredColor, engine, rated),
});
export async function handleGomokuCreate(...args: Parameters<typeof route.handleCreate>) {
  const [, response, body] = args;
  // Opening selection is no longer a supported surface.
  if (body.opening !== undefined) {
    writeJson(response, 501, { error: 'gomoku_unsupported_surface' });
    return;
  }
  return route.handleCreate(...args);
}

registerVariantTenant({
  kind: gomokuTenant.kind,
  gameSpecId: gomokuTenant.gameSpecId,
  roomIdPrefix: gomokuTenant.roomIdPrefix,
  isEngineClientId: isGomokuEngineClientId,
  engineDisplayName: (clientId) => (isGomokuEngineClientId(clientId) ? 'Rapfi' : null),
  ownsSpecRouting: true,
  replays: tenantReplayCheck(gomokuTenant),
  errorPrefix: 'gomoku',
  enabled: gomokuEnabled,
  admitsConnection: gomokuAdmits,
  rooms: gomokuRooms as unknown as ReadonlyMap<string, TenantManagedRoom>,
  activeGameCount: () => countActiveTenantGames(gomokuRooms.values(), gomokuTenant),
  getOrLoadRoom: (roomId) =>
    getOrLoadTenantRoom(gomokuTenant, gomokuRooms, roomId) as Promise<TenantManagedRoom | null>,
  attachWebSocket: (ctx, socket, request, room) =>
    gomokuWs.handleConnection(ctx, socket, request, room as unknown as LiveRoom),
  clearRuntimeTimers: (room) => clearTenantRuntimeTimers(room as unknown as LiveRoom),
  pauseOnShutdown: (at) =>
    pauseTenantRoomsOnShutdown(gomokuTenant, gomokuRooms.values(), gomokuWs.lifecycleCtx, at),
  clearRooms: () => gomokuRooms.clear(),
  http: {
    matchesCreateRequest: route.matchesCreateRequest,
    // The dispatcher resolves accounts only for rated requests; the playtest
    // needs the real account on casual creates too, like Three Kingdoms.
    handleCreate: async (ctx, request, response, body, accountUser) =>
      handleGomokuCreate(
        { ...ctx, createGomokuRoom },
        response,
        body,
        accountUser ?? (await currentAccountUser(request)),
      ),
  },
  lobby: {
    supportsRated: true,
    allowsTimeControl: isAllowedFullTimeControl,
    createRoom: async (timeControl, rated) => {
      const created = await createGomokuRoom(timeControl, 'random', undefined, rated);
      if (!created.ok) throw new Error(`gomoku_room_create_failed:${created.error}`);
      return { id: created.room.id, region: 'global' };
    },
  },
  reviewRouteBase: '/gomoku/game',
  watch: {
    channelId: 'gomoku',
    family: 'gomoku',
    label: 'Gomoku',
    legacyVariants: ['gomoku'],
  },
  export: {
    gameRouteBase: gomokuExport.gameRouteBase,
    // Unlike a public variant's export, the playtest download stays behind
    // its flag even for a finished, durable game with a known room id.
    finishedGame: (events, roomId) =>
      gomokuEnabled() ? gomokuExport.finishedGame(events, roomId) : null,
  },
  card: {
    layout: 'gomoku',
    variant: GOMOKU_SPEC_ID,
    // The Chinese name is identical in Simplified and Traditional Chinese.
    label: 'Gomoku · 五子棋',
    finalPosition(events, roomId) {
      if (!gomokuEnabled() || !isTenantEventLog(gomokuTenant, events, roomId)) return null;
      const { state } = replayTenantEvents(gomokuTenant, events);
      if (state.status.type !== 'finished') return null;
      const { board, lastMove, winningLine } = getGomokuPlayerView(state, 'black', true);
      return { board, lastMove, winningLine };
    },
  },
  ...gomokuCorrespondence,
});
