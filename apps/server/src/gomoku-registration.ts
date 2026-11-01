// Built-hidden, flag-gated casual play. Rapfi runs only in the human's browser.
import {
  GOMOKU_SPEC_ID,
  type GomokuColor,
  type GomokuOpeningMode,
  getGomokuPlayerView,
  type RoomTimeControl,
} from '@mistboard/game';
import { gomokuEnabled } from './feature-flags.js';
import {
  type GomokuEvent,
  type GomokuRuntimeRoom,
  gomokuTenant,
  isGomokuEngineClientId,
} from './gomoku-tenant.js';
import * as persistence from './persistence.js';
import { isAllowedFullTimeControl, writeJson } from './routes/lib.js';
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
export const gomokuWs = createTenantWsRuntime(gomokuTenant, { allowBrowserEngineMoves: true });
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
  opening: GomokuOpeningMode = 'balanced',
) {
  if (opening !== 'balanced' && opening !== 'free') throw new Error('gomoku: invalid opening mode');
  if (
    engine &&
    (!isGomokuEngineClientId(engine.engineId) || !gomokuTenant.rules.isColor(engine.seat))
  )
    throw new Error('gomoku: invalid browser engine seat');
  const created = await createTenantLiveRoom(
    opening === 'free'
      ? {
          ...gomokuTenant,
          rules: { ...gomokuTenant.rules, createSetup: () => ({ stones: [], turn: 'black' }) },
        }
      : gomokuTenant,
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
      rated: false,
    },
  );
  if (!created.ok && created.error === 'disabled')
    return { ok: false as const, error: 'gomoku_disabled' as const };
  return created;
}

// The shared factory persists the bot seat; it schedules no server engine work.
const route = createTenantRoomsRoute<
  TenantRoomCreateBaseContext & { createGomokuRoom: typeof createGomokuRoom },
  GomokuColor | 'random',
  GomokuColor
>({
  gameSpecId: GOMOKU_SPEC_ID,
  errorPrefix: 'gomoku',
  hasDisabledFlag: true,
  preferredColors: ['black', 'white', 'random'],
  engine: {
    kind: 'seated',
    defaultEngineId: 'rapfi-level-1',
    isEngineClientId: isGomokuEngineClientId,
    seats: ['black', 'white'],
  },
  createRoom: (ctx, { timeControl, preferredColor, engine }) =>
    ctx.createGomokuRoom(timeControl, preferredColor, engine),
});
export async function handleGomokuCreate(...args: Parameters<typeof route.handleCreate>) {
  const [ctx, response, body, accountUser] = args;
  const opening = body.opening === undefined ? 'balanced' : body.opening;
  if (opening !== 'balanced' && opening !== 'free') {
    writeJson(response, 400, { error: 'gomoku_invalid_opening' });
    return;
  }
  // Keep per-request setup local to the factory; concurrent requests must not
  // mutate the registered tenant's random deal policy.
  return route.handleCreate(
    {
      ...ctx,
      createGomokuRoom: (timeControl, preferredColor, engine) =>
        ctx.createGomokuRoom(timeControl, preferredColor, engine, opening),
    },
    response,
    body,
    accountUser,
  );
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
  admitsConnection: gomokuEnabled,
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
    handleCreate: (ctx, _request, response, body, accountUser) =>
      handleGomokuCreate({ ...ctx, createGomokuRoom }, response, body, accountUser),
  },
  lobby: {
    supportsRated: false,
    allowsTimeControl: isAllowedFullTimeControl,
    createRoom: async (timeControl, rated) => {
      if (rated) throw new Error('gomoku_unsupported_surface');
      const created = await createGomokuRoom(timeControl, 'random');
      if (!created.ok) throw new Error(`gomoku_room_create_failed:${created.error}`);
      return { id: created.room.id, region: 'global' };
    },
  },
  finishedGameOpensRoom: true,
  watch: {
    channelId: 'gomoku',
    family: 'gomoku',
    label: 'Gomoku',
    legacyVariants: ['gomoku'],
  },
  export: null,
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
  sweepDueDeadline: null,
  createCorrespondenceGameForSeek: null,
});
