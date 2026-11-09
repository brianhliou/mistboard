import assert from 'node:assert/strict';
import { type TestContext, test } from 'node:test';
import {
  type BanqiDeal,
  CORRESPONDENCE_RESTRICTED_SPEC_IDS,
  correspondenceTimeControl,
  isCorrespondenceRatedSpec,
} from '@mistboard/game';
import { mayPlayCorrespondence, mayPlayCorrespondenceByUserId } from './correspondence-access.js';
import { CORRESPONDENCE_TEST_TENANTS, legalMoveFor } from './correspondence-test-support.js';
import type { UserAccount } from './persistence.js';
import { close, getPool, init } from './persistence-db.js';
import {
  correspondenceGamesForUser,
  correspondenceSeatBoard,
} from './routes/correspondence-games.js';
import {
  acceptSeekResult,
  createSeekResult,
  ratedSeekError,
  seeksVisibleTo,
} from './routes/correspondence-seeks.js';
import { tenantDurableDeadlineFor } from './variant-tenant/lifecycle.js';
import {
  correspondenceTenantForSpecId,
  type TenantManagedRoom,
} from './variant-tenant/registry.js';
import {
  appendTenantRuntimeEvent,
  createTenantRuntimeRoomFromEvents,
  tenantEventsForClient,
  tenantLiveHistoryExtras,
  tenantSnapshotPayload,
} from './variant-tenant/runtime.js';
import type { TenantGameStateLike, TenantRuntimeRoom } from './variant-tenant/tenant.js';
import './variant-tenant/register-tenants.js';

type Room = TenantRuntimeRoom<string, string, unknown, TenantGameStateLike<string>, string>;
const specs = ['ffq-banqi', 'three-kingdoms-banqi'] as const;
const admin = { id: 'admin', accountRole: 'admin' } as UserAccount;
const player = { id: 'player', accountRole: 'player' } as UserAccount;
const ctx = { refusesCreate: () => false, drainDeadlineMs: () => null };

function flags(t: TestContext, enabled: boolean) {
  for (const name of ['MISTBOARD_FFQ_BANQI_ENABLED', 'MISTBOARD_THREE_KINGDOMS_BANQI_ENABLED']) {
    const prior = process.env[name];
    process.env[name] = String(enabled);
    t.after(() => {
      if (prior === undefined) delete process.env[name];
      else process.env[name] = prior;
    });
  }
}

test('restricted correspondence membership is derived, casual and fail-closed', () => {
  assert.deepEqual(CORRESPONDENCE_RESTRICTED_SPEC_IDS, specs);
  for (const spec of specs) {
    assert.equal(isCorrespondenceRatedSpec(spec), false);
    assert.equal(
      ratedSeekError(spec, correspondenceTimeControl(3), true),
      'rated_unsupported_spec',
    );
    const registration = correspondenceTenantForSpecId(spec)!;
    assert.equal(typeof registration.createCorrespondenceGameForSeek, 'function');
    assert.equal(typeof registration.sweepDueDeadline, 'function');
  }
  assert.equal(correspondenceTenantForSpecId('unknown-banqi'), null);
});

test('picker/seek access follows each existing room door, including TK admins with the flag off', async (t) => {
  flags(t, false);
  const seeks = specs.map((gameSpecId) => ({ gameSpecId }));
  assert.deepEqual(await seeksVisibleTo(seeks, null), []);
  assert.deepEqual(await seeksVisibleTo(seeks, player), []);
  assert.deepEqual(await seeksVisibleTo(seeks, admin), [seeks[1]]);
  assert.equal(await mayPlayCorrespondence(admin, 'unknown-banqi'), false);
  for (const spec of specs) {
    assert.equal(await mayPlayCorrespondence(null, spec), false);
    const refused = await createSeekResult(
      ctx,
      player,
      { gameSpecId: spec, daysPerMove: 3 },
      'board',
    );
    assert.equal(refused.status, 403);
  }
  process.env.MISTBOARD_FFQ_BANQI_ENABLED = 'true';
  process.env.MISTBOARD_THREE_KINGDOMS_BANQI_ENABLED = 'true';
  assert.deepEqual(await seeksVisibleTo(seeks, admin), seeks);
  assert.deepEqual(await seeksVisibleTo(seeks, player), [seeks[1]]);
  assert.equal(await mayPlayCorrespondence(admin, specs[0]), true);
  assert.equal(await mayPlayCorrespondence(player, specs[0]), false);
  for (const spec of specs) {
    assert.deepEqual(
      await createSeekResult(ctx, admin, { gameSpecId: spec, daysPerMove: 0 }, 'board'),
      {
        status: 400,
        body: { error: 'invalid_days_per_move' },
      },
    );
  }
  assert.equal(
    (await createSeekResult(ctx, admin, { gameSpecId: 'unknown-banqi' }, 'board')).status,
    501,
  );
});

for (const spec of specs) {
  test(`${spec}: directed target and both accepting accounts are rechecked before consuming the seek`, async (t) => {
    flags(t, false);
    process.env.MISTBOARD_FFQ_BANQI_ENABLED = 'true';
    init('postgres://mistboard@127.0.0.1:9/never-connect');
    t.after(close);
    let creatorRole = 'player';
    let consumed = false;
    t.mock.method(getPool(), 'query', async (sql: string, args: unknown[]) => {
      if (sql.includes('account_role AS')) {
        assert.ok(sql.includes('closed_at IS NULL'));
        return {
          rows: [{ accountRole: args[0] === 'creator' ? creatorRole : 'player' }],
          rowCount: 1,
        };
      }
      if (sql.includes('SELECT 1 AS one FROM users')) return { rows: [{ one: 1 }], rowCount: 1 };
      if (sql.includes('FROM user_relations')) return { rows: [], rowCount: 0 };
      if (sql.includes('FROM correspondence_seeks'))
        return {
          rows: [
            {
              id: 'seek_gate',
              creator_user_id: 'creator',
              game_spec_id: spec,
              days_per_move: 3,
              preferred_color: 'first',
              target_user_id: null,
              visibility: 'public',
              expires_at: new Date(Date.now() + 86_400_000),
              rated: false,
            },
          ],
          rowCount: 1,
        };
      if (sql.startsWith('DELETE')) consumed = true;
      assert.fail(`unexpected SQL: ${sql}`);
    });
    assert.equal(await mayPlayCorrespondenceByUserId('target', spec), false);
    assert.deepEqual(
      await createSeekResult(
        ctx,
        admin,
        { gameSpecId: spec, daysPerMove: 3, targetUserId: 'target' },
        'board',
      ),
      {
        status: 403,
        body: { error: 'target_variant_not_granted' },
      },
    );
    assert.deepEqual(await acceptSeekResult(ctx, player, 'seek_gate'), {
      status: 403,
      body: { error: 'variant_not_granted' },
    });
    assert.deepEqual(await acceptSeekResult(ctx, admin, 'seek_gate'), {
      status: 409,
      body: { error: 'opponent_variant_not_granted' },
    });
    assert.equal(consumed, false);
    creatorRole = 'admin';
    assert.equal(await mayPlayCorrespondenceByUserId('creator', spec), true);
  });

  test(`${spec}: cold replay, room/history and inbox payloads preserve every covered identity`, async (t) => {
    flags(t, true);
    const registration = correspondenceTenantForSpecId(spec)!;
    t.after(() => registration.clearRooms());
    const { tenant } = CORRESPONDENCE_TEST_TENANTS[spec]!;
    const created = await registration.createCorrespondenceGameForSeek!({
      timeControl: correspondenceTimeControl(3),
      first: { userId: 'first' },
      second: { userId: 'second' },
      rated: true,
    });
    assert.ok(created.ok);
    assert.equal(created.room.rated, false, 'even an internal caller cannot rate the playtest');
    const room = registration.rooms.get(created.room.id) as unknown as Room;
    for (let ply = 0; ply < 2; ply++) {
      assert.notEqual(
        appendTenantRuntimeEvent(tenant, room, {
          type: 'move-played',
          roomId: room.id,
          at: Date.now() + ply * 1_000,
          color: ply === 0 ? 'red' : 'black',
          move: legalMoveFor(spec, room.projection.state),
        }),
        -1,
      );
    }
    const log = JSON.parse(JSON.stringify(room.events)) as Room['events'];
    const hydrated = createTenantRuntimeRoomFromEvents(tenant, log);
    assert.ok(hydrated.ok);
    assert.deepEqual(hydrated.room.projection, room.projection);
    assert.deepEqual(
      tenantDurableDeadlineFor(tenant, hydrated.room),
      tenantDurableDeadlineFor(tenant, room),
    );
    const state = room.projection.state as unknown as {
      board: Record<string, { faceDown: boolean }>;
    };
    const covered = Object.entries(state.board)
      .filter(([, piece]) => piece?.faceDown)
      .map(([square]) => square);
    const setup = log[0]!.type === 'room-created' ? (log[0].setup as { deal: BanqiDeal }) : null;
    assert.ok(setup);
    // TK stores its deal in setup-square order; FFQ stores the numeric index.
    const game = await import('@mistboard/game');
    const index = (square: string) =>
      spec === 'ffq-banqi'
        ? Number(square)
        : game.THREE_KINGDOMS_BANQI_SETUP_SQUARES.indexOf(square as never);
    const i = index(covered[0]!);
    const j = covered
      .map(index)
      .find(
        (k) =>
          setup.deal[k]!.role !== setup.deal[i]!.role ||
          setup.deal[k]!.color !== setup.deal[i]!.color,
      )!;
    assert.ok(j !== undefined);
    [setup.deal[i], setup.deal[j]] = [setup.deal[j]!, setup.deal[i]!];
    assert.notDeepEqual(log[0], room.events[0], 'the secret permutation is real');
    const swapped = createTenantRuntimeRoomFromEvents(tenant, log);
    assert.ok(swapped.ok);
    const serialize = (candidate: Room, seat: string) => {
      const client = { id: 'reader', seat, solo: false };
      const { serverAt: _serverAt, ...snapshot } = tenantSnapshotPayload(tenant, candidate, client);
      const payload = {
        snapshot,
        events: tenantEventsForClient(tenant, candidate, client),
        ...tenantLiveHistoryExtras(tenant, candidate, client),
      };
      const json = JSON.stringify(payload);
      JSON.parse(json, (key, value) => {
        assert.ok(!['setup', 'deal', 'seed'].includes(key));
        if (value?.faceDown === true) assert.deepEqual(value, { faceDown: true });
        return value;
      });
      return json;
    };
    for (const finished of [false, true]) {
      if (finished) {
        for (const candidate of [room, swapped.room])
          appendTenantRuntimeEvent(tenant, candidate, {
            type: 'seat-resigned',
            roomId: room.id,
            color: 'black',
            at: Date.now() + 10_000,
          });
      }
      for (const seat of ['red', 'black', 'spectator']) {
        assert.equal(serialize(room, seat), serialize(swapped.room, seat));
      }
      for (const seat of ['red', 'black']) {
        const inbox = async (candidate: Room) => {
          (registration.rooms as Map<string, TenantManagedRoom>).set(
            room.id,
            candidate as unknown as TenantManagedRoom,
          );
          return correspondenceGamesForUser(seat, {
            list: async () => [
              {
                roomId: room.id,
                gameSpecId: spec,
                mySeat: seat,
                isYourMove: true,
                dueAt: new Date(10_000),
                opponentName: 'Opponent',
              } as never,
            ],
            seatBoard: correspondenceSeatBoard,
          });
        };
        assert.equal(JSON.stringify(await inbox(room)), JSON.stringify(await inbox(swapped.room)));
      }
    }
    assert.equal(registration.seatBoard!(room as unknown as TenantManagedRoom, 'spectator'), null);
  });
}

for (const spec of specs) {
  test(`${spec}: registered sweeper cold-loads the event log and handles no-shows and played games`, async (t) => {
    flags(t, true);
    const registration = correspondenceTenantForSpecId(spec)!;
    const { tenant } = CORRESPONDENCE_TEST_TENANTS[spec]!;
    t.after(() => registration.clearRooms());
    const logs = new Map<string, Room['events']>();
    const cases: Array<{ roomId: string; plies: number }> = [];
    for (const plies of [0, 1, 2]) {
      const created = await registration.createCorrespondenceGameForSeek!({
        timeControl: correspondenceTimeControl(1),
        first: { userId: 'first' },
        second: { userId: 'second' },
      });
      assert.ok(created.ok);
      const original = registration.rooms.get(created.room.id) as unknown as Room;
      const restored = createTenantRuntimeRoomFromEvents(
        tenant,
        original.events.map((event, i) => ({ ...event, at: 1_000 + i * 1_000 })),
      );
      assert.ok(restored.ok);
      for (let ply = 0; ply < plies; ply++)
        appendTenantRuntimeEvent(tenant, restored.room, {
          type: 'move-played',
          roomId: original.id,
          at: 10_000 + ply * 1_000,
          color: ply === 0 ? 'red' : 'black',
          move: legalMoveFor(spec, restored.room.projection.state),
        });
      logs.set(original.id, JSON.parse(JSON.stringify(restored.room.events)));
      cases.push({ roomId: original.id, plies });
    }
    registration.clearRooms();
    init('postgres://mistboard@127.0.0.1:9/never-connect');
    t.after(close);
    let reads = 0;
    t.mock.method(getPool(), 'query', async (sql: string, args: unknown[]) => {
      if (sql.includes('SELECT payload FROM events')) {
        reads++;
        return { rows: logs.get(String(args[0]))!.map((payload) => ({ payload })) };
      }
      if (sql.includes('FROM room_seat_tokens')) return { rows: [] };
      assert.fail(`unexpected SQL during cold hydration: ${sql}`);
    });
    // Keep this unit test off a real database. The persistent counterpart drives
    // the same binding through the actual durable event writer and deadline index.
    const ws =
      spec === 'ffq-banqi'
        ? (await import('./ffq-banqi-registration.js')).ffqBanqiWs
        : (await import('./three-kingdoms-banqi-registration.js')).threeKingdomsBanqiWs;
    t.mock.method(
      ws.lifecycleCtx,
      'appendEvent',
      async (room: Room, event: Room['events'][number]) =>
        appendTenantRuntimeEvent(tenant, room, event),
    );
    for (const { roomId, plies } of cases) {
      assert.equal(registration.rooms.has(roomId), false);
      await registration.sweepDueDeadline!(roomId);
      const room = registration.rooms.get(roomId) as unknown as Room;
      assert.deepEqual(
        room.projection.state.status,
        plies < 2
          ? { type: 'aborted', reason: 'pregame-timeout' }
          : { type: 'finished', winner: 'black', reason: 'timeout' },
      );
      assert.equal(tenantDurableDeadlineFor(tenant, room), null);
      const count = room.events.length;
      await registration.sweepDueDeadline!(roomId);
      assert.equal(room.events.length, count);
    }
    assert.equal(reads, cases.length);
  });
}
