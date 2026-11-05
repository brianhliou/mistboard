import assert from 'node:assert/strict';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { afterEach, test } from 'node:test';
import { gameSpecForId, getGomokuPlayerView } from '@mistboard/game';
import { gomokuRooms } from './gomoku-registration.js';
import { gomokuTenant } from './gomoku-tenant.js';
import { collectLiveRoomStats } from './live-room-stats.js';
import type { UserAccount } from './persistence.js';
import { countedPublicGame } from './persistence-counted-games.js';
import { gomokuLiveWatchPayload, gomokuPostgameForApi, tryHandle } from './routes/gomoku-games.js';
import type { HttpApiContext } from './routes/lib.js';
import { resolveWebSocketLiveRuntime } from './server-ws-connection.js';
import { type TenantCreateHttpContext, variantTenantForSpecId } from './variant-tenant/registry.js';
import { appendTenantRuntimeEvent, createTenantRuntimeRoom } from './variant-tenant/runtime.js';
import { listWatchChannels } from './watch-channels.js';
import { collectLiveTvCandidates } from './watch-live.js';

const FLAG = 'MISTBOARD_GOMOKU_ENABLED';
const originalFlag = process.env[FLAG];
const ADMIN = { id: 'admin-1', accountRole: 'admin', playDisabledAt: null } as UserAccount;
const PLAYER = { id: 'player-1', accountRole: 'player', playDisabledAt: null } as UserAccount;
const USERS = [null, PLAYER, ADMIN];
const TC = { initialMs: 300_000, incrementMs: 5_000 };
const ctx = { rooms: new Map() } as HttpApiContext;
const createCtx: TenantCreateHttpContext = {
  databaseRequired: false,
  refusesCreate: () => false,
  drainDeadlineMs: () => null,
  reserveLiveEngineSeat: async () => null,
  releaseLiveEngineReservation: () => undefined,
};

afterEach(() => {
  if (originalFlag === undefined) delete process.env[FLAG];
  else process.env[FLAG] = originalFlag;
  gomokuRooms.clear();
});

function response() {
  const captured = { status: 0, body: '' };
  const res = {
    writeHead: (status: number) => {
      captured.status = status;
    },
    end: (body: string) => {
      captured.body = body;
    },
  } as unknown as ServerResponse;
  return { captured, res };
}

function room(finished = false) {
  const now = Date.now();
  const created = createTenantRuntimeRoom({ ...gomokuTenant, enabled: () => true }, 'gmk_gate', {
    now,
    timeControl: TC,
  });
  assert.ok(created.ok);
  const live = created.room;
  for (const [seat, id] of [
    ['black', 'human'],
    ['white', 'opponent'],
  ] as const) {
    appendTenantRuntimeEvent(gomokuTenant, live, {
      type: 'seat-assigned',
      roomId: live.id,
      at: now,
      seat,
      clientId: id,
    });
  }
  if (finished)
    appendTenantRuntimeEvent(gomokuTenant, live, {
      type: 'seat-resigned',
      roomId: live.id,
      at: now + 1,
      color: 'white',
    });
  gomokuRooms.set(live.id, live);
  return live;
}

for (const enabled of [false, true]) {
  for (const user of USERS) {
    const who = user?.accountRole ?? 'guest';
    const admitted = enabled || user === ADMIN;
    test(`Gomoku create: ${who}, flag ${enabled}`, async () => {
      process.env[FLAG] = String(enabled);
      const reg = variantTenantForSpecId('gomoku')!;
      for (const mode of ['pvp', 'pve']) {
        const { res, captured } = response();
        const before = gomokuRooms.size;
        await reg.http.handleCreate(
          createCtx,
          { headers: {} } as IncomingMessage,
          res,
          {
            gameSpecId: 'gomoku',
            mode,
            timeControl: TC,
            rated: false,
          },
          user,
        );
        assert.equal(captured.status, admitted ? 201 : 404, captured.body);
        assert.equal(gomokuRooms.size - before, admitted ? 1 : 0);
        if (admitted) assert.equal(JSON.parse(captured.body).gameSpecId, 'gomoku');
      }
    });

    for (const persisted of [false, true])
      test(`Gomoku socket: ${who}, flag ${enabled}, persisted ${persisted}`, async () => {
        process.env[FLAG] = String(enabled);
        const live = room();
        const reg = variantTenantForSpecId('gomoku')!;
        let hydrations = 0;
        // Use the real registration's gate and a durable-store stand-in. A
        // denied account must never reach hydration, even for a known room id.
        const registration = persisted
          ? {
              ...reg,
              rooms: new Map(),
              getOrLoadRoom: async () => {
                hydrations += 1;
                return reg.rooms.get(live.id) ?? null;
              },
            }
          : reg;
        const result = await resolveWebSocketLiveRuntime([registration], live.id, async () => user);
        assert.equal(result.kind, admitted ? 'variant-tenant' : 'variant-tenant-unavailable');
        if (!admitted)
          assert.deepEqual(result, {
            kind: 'variant-tenant-unavailable',
            reason: 'game spec disabled',
          });
        assert.equal(hydrations, persisted && admitted ? 1 : 0);
      });

    test(`Gomoku GET and replay: ${who}, flag ${enabled}`, async () => {
      process.env[FLAG] = String(enabled);
      const live = room(true);
      let reads = 0;
      const deps = {
        currentAccountUser: async () => user,
        isPersistenceEnabled: () => false,
        getGameSummary: async () => {
          throw new Error('memory only');
        },
        loadRoomEvents: async () => {
          throw new Error('memory only');
        },
        getLiveRoom: () => {
          reads += 1;
          return live;
        },
      };
      const { res, captured } = response();
      const path = `/api/gomoku/games/${live.id}`;
      assert.equal(
        await tryHandle(
          ctx,
          { method: 'GET' } as IncomingMessage,
          res,
          path,
          new URL(path, 'http://localhost'),
          deps,
        ),
        true,
      );
      assert.equal(captured.status, admitted ? 200 : 404, captured.body);
      if (!admitted) assert.equal(reads, 0, 'refused callers must not read the room');
      assert.equal(Boolean(await gomokuPostgameForApi(live.id, deps, user)), admitted);
    });

    test(`Gomoku live payload: ${who}, flag ${enabled}`, async () => {
      process.env[FLAG] = String(enabled);
      const live = room();
      assert.equal(Boolean(await gomokuLiveWatchPayload(live.id, user)), admitted);
    });
  }
}

test('an admitted Gomoku admin stays unlisted and outside public figures', async () => {
  process.env[FLAG] = 'false';
  const reg = variantTenantForSpecId('gomoku')!;
  assert.equal(reg.admitsConnection?.(ADMIN), true);
  assert.equal(reg.enabled(), false);
  assert.equal(gameSpecForId('gomoku').publicSurface, 'hidden');
  assert.ok(countedPublicGame().includes("'gomoku'"));
  // Correspondence exists (s-133b) but its factory refuses while the flag is off.
  assert.deepEqual(await reg.createCorrespondenceGameForSeek!({} as never), {
    ok: false,
    error: 'disabled',
  });
  const live = room();
  const status = live.projection.state.status;
  assert.equal(status.type, 'playing');
  if (status.type !== 'playing') throw new Error('expected a playing room');
  appendTenantRuntimeEvent(gomokuTenant, live, {
    type: 'move-played',
    roomId: live.id,
    at: Date.now(),
    color: status.turn,
    move: getGomokuPlayerView(live.projection.state, status.turn).legalMoves[0]!,
  });
  const client = { id: 'human', userId: ADMIN.id, seat: 'black' as const, displaced: false };
  live.clients.add(client);
  assert.equal(collectLiveRoomStats(ctx).playingBySpec.gomoku, undefined);
  assert.equal(collectLiveRoomStats(ctx).playingRoomByUserId.has(ADMIN.id), false);
  assert.equal(
    listWatchChannels().some((channel) => channel.id === 'gomoku'),
    false,
  );
  assert.equal(
    collectLiveTvCandidates(ctx).some((candidate) => candidate.gameSpecId === 'gomoku'),
    false,
  );
  // Positive control: the room is genuinely in play, so its absence above is the
  // listing gate (flag and publicSurface), not an idle fixture.
  process.env[FLAG] = 'true';
  assert.equal(collectLiveRoomStats(ctx).playing, 1);
  assert.equal(collectLiveRoomStats(ctx).playingBySpec.gomoku, undefined);
});
