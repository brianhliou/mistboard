/** Hidden FFQ PvP playtest. Every network door requires the flag AND an admin. */
import { type BanqiColor, FFQ_BANQI_SPEC_ID, type RoomTimeControl } from '@mistboard/game';
import { currentAccountUser } from './account-session.js';
import { ffqBanqiEnabled } from './feature-flags.js';
import { ffqBanqiAdmits, isFFQBanqiRequest } from './ffq-banqi-access.js';
import {
  ffqBanqiCardFen,
  ffqBanqiPlyReveal,
  ffqBanqiRecordSquare,
  writeFFQBanqiPgn,
} from './ffq-banqi-publication.js';
import { ffqBanqiPostgameHistory } from './ffq-banqi-replay.js';
import { type FFQBanqiRuntimeRoom, ffqBanqiTenant } from './ffq-banqi-tenant.js';
import { tenantCardBinding } from './game-card-tenant.js';
import { flipOrBoardMoveUci, tenantExportBinding } from './game-export-tenant.js';
import { gateGameSpecRequest } from './game-spec-request-gate.js';
import * as persistence from './persistence.js';
import { writeJson } from './routes/lib.js';
import { recordTenantPersistenceError } from './variant-tenant/events.js';
import { getOrLoadTenantRoom } from './variant-tenant/hydration.js';
import { pauseTenantRoomsOnShutdown } from './variant-tenant/lifecycle.js';
import {
  registerVariantTenant,
  type TenantCreateHttpContext,
  type TenantManagedRoom,
  variantTenantRoomIdTaken,
} from './variant-tenant/registry.js';
import { createTenantLiveRoom } from './variant-tenant/room-factory.js';
import { createTenantRoomsRoute } from './variant-tenant/rooms-route.js';
import { countActiveTenantGames, tenantReplayCheck } from './variant-tenant/runtime.js';
import { clearTenantRuntimeTimers, createTenantWsRuntime } from './variant-tenant/ws.js';

export const ffqBanqiRooms = new Map<string, FFQBanqiRuntimeRoom>();
export const ffqBanqiWs = createTenantWsRuntime(ffqBanqiTenant);

export async function createFFQBanqiRoom(
  accountUser: Pick<persistence.UserAccount, 'accountRole'> | null,
  timeControl?: RoomTimeControl,
  creatorPreference?: BanqiColor | 'random',
) {
  if (!ffqBanqiAdmits(accountUser)) {
    return { ok: false, error: 'ffq_banqi_disabled' } as const;
  }
  return createTenantLiveRoom(
    ffqBanqiTenant,
    {
      rooms: ffqBanqiRooms,
      isRoomIdTaken: (id) => variantTenantRoomIdTaken(id, ffqBanqiTenant.kind),
      appendRoomEvent: persistence.appendRoomEvent,
      isPersistenceEnabled: persistence.isInitialized,
      recordPersistenceError: (id, seq, type, err) =>
        recordTenantPersistenceError(ffqBanqiTenant, id, seq, type, err),
    },
    { timeControl, creatorPreference, rated: false },
  );
}

export function getOrLoadFFQBanqiRoom(roomId: string) {
  return getOrLoadTenantRoom(ffqBanqiTenant, ffqBanqiRooms, roomId);
}

// Keep the route beside its registration: no bots, rated games or other create surface.
const route = createTenantRoomsRoute<
  TenantCreateHttpContext & { accountUser: persistence.UserAccount | null },
  BanqiColor | 'random',
  BanqiColor
>({
  gameSpecId: FFQ_BANQI_SPEC_ID,
  errorPrefix: 'ffq_banqi',
  hasDisabledFlag: true,
  admits: ffqBanqiAdmits,
  preferredColors: ['red', 'black', 'random'],
  engine: { kind: 'none', rejectEngineId: true },
  createRoom: (ctx, { timeControl, preferredColor }) =>
    createFFQBanqiRoom(ctx.accountUser, timeControl, preferredColor),
});

const ffqExport = tenantExportBinding(ffqBanqiTenant, {
  gameRouteBase: '/ffq-banqi/game',
  uci: (move) =>
    flipOrBoardMoveUci({
      from: ffqBanqiRecordSquare(move.from),
      to: ffqBanqiRecordSquare(move.to),
    }),
  hiddenPieces: { variant: 'banqi', reveal: ffqBanqiPlyReveal },
});

registerVariantTenant({
  kind: ffqBanqiTenant.kind,
  gameSpecId: ffqBanqiTenant.gameSpecId,
  roomIdPrefix: ffqBanqiTenant.roomIdPrefix,
  ownsSpecRouting: true,
  isEngineClientId: () => false,
  replays: tenantReplayCheck(ffqBanqiTenant),
  errorPrefix: 'ffq_banqi',
  enabled: ffqBanqiEnabled,
  admitsConnection: ffqBanqiAdmits,
  rooms: ffqBanqiRooms as unknown as ReadonlyMap<string, TenantManagedRoom>,
  activeGameCount: () => countActiveTenantGames(ffqBanqiRooms.values(), ffqBanqiTenant),
  getOrLoadRoom: (id) => getOrLoadFFQBanqiRoom(id) as Promise<TenantManagedRoom | null>,
  attachWebSocket: async (ctx, socket, request, room) => {
    // Also guard direct attaches; the outer resolver gates before hydration.
    if (!ffqBanqiAdmits(await currentAccountUser(request))) {
      socket.close(1008, 'game spec disabled');
      return;
    }
    await ffqBanqiWs.handleConnection(
      ctx,
      socket,
      request,
      room as unknown as Parameters<typeof ffqBanqiWs.handleConnection>[3],
    );
  },
  clearRuntimeTimers: (room) => clearTenantRuntimeTimers(room as unknown as FFQBanqiRuntimeRoom),
  pauseOnShutdown: (at) =>
    pauseTenantRoomsOnShutdown(ffqBanqiTenant, ffqBanqiRooms.values(), ffqBanqiWs.lifecycleCtx, at),
  clearRooms: () => ffqBanqiRooms.clear(),
  http: {
    matchesCreateRequest: isFFQBanqiRequest,
    handleCreate: async (ctx, request, response, body, accountUser) => {
      const account = accountUser ?? (await currentAccountUser(request));
      const gate = gateGameSpecRequest(body, account);
      if (gate.type === 'reject') {
        writeJson(response, gate.httpStatus, { error: gate.error });
        return;
      }
      if (!isFFQBanqiRequest(body)) {
        writeJson(response, 404, { error: 'unknown_game_spec' });
        return;
      }
      if ([body.gameSpecId, body.variant].some((id) => id != null && id !== FFQ_BANQI_SPEC_ID)) {
        writeJson(response, 404, { error: 'unknown_game_spec' });
        return;
      }
      if (body.botId !== undefined) {
        writeJson(response, 501, { error: 'ffq_banqi_unsupported_surface' });
        return;
      }
      await route.handleCreate(
        { ...ctx, accountUser: account },
        response,
        { ...body, gameSpecId: FFQ_BANQI_SPEC_ID },
        account,
      );
    },
  },
  watch: null,
  lobby: null,
  reviewRouteBase: '/ffq-banqi/game',
  export: {
    gameRouteBase: ffqExport.gameRouteBase,
    finishedGame: (events, roomId) => {
      const game = ffqExport.finishedGame(events, roomId);
      if (!game) return null;
      const frames = ffqBanqiPostgameHistory(events as FFQBanqiRuntimeRoom['events']).truth;
      return {
        ...game,
        initialFen: frames[0]!.fen,
        plies: game.plies.map((ply, index) => ({
          ...ply,
          hpAfter: frames[index + 1]!.view.hp,
          damage: frames[index + 1]!.damage,
        })),
        writePgn: (tags, result) => writeFFQBanqiPgn(tags, result, game, frames),
      };
    },
  },
  card: tenantCardBinding(ffqBanqiTenant, {
    variant: 'banqi',
    analysis: null,
    fen: ffqBanqiCardFen,
  }),
  sweepDueDeadline: null,
  createCorrespondenceGameForSeek: null,
});
