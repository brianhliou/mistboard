/**
 * #1056: a correspondence room held in memory by one server process while
 * another process, sharing the database, sweeps its deadline. Every server runs
 * the deadline sweeper, so this is the shape whenever two processes overlap: a
 * Railway deploy (the new container is up before the old one drains), or two
 * local dev pairs on the one shared Postgres.
 *
 * The other process is simulated in-process: the live room object is taken out
 * of the tenant map, the sweep hydrates its own copy from the event log and ends
 * the game there, and the stale object goes back into the map with its socket,
 * as process A still holds it. Before the fix, A's next write (the seat-assigned
 * of a reconnect) reused a sequence number the sweep had taken, failed on
 * events_pkey, closed the socket with 1011, and the browser redialled every
 * 0.75s forever; the player who kept the room open never saw the result.
 */

import type { IncomingMessage } from 'node:http';
import { DAY_MS, type RoomTimeControl } from '@mistboard/game';
import type { WebSocket } from 'ws';
import {
  CORRESPONDENCE_TEST_TENANTS,
  enableCorrespondenceVariantFlags,
  legalMoveFor,
} from './correspondence-test-support.js';
import {
  type AccountSession,
  createAccountSession,
  createUser,
  listRecentFinishedCorrespondenceGames,
} from './persistence.js';
import {
  assert,
  definePersistenceTests,
  pg,
  sha256,
  TEST_DATABASE_URL,
  test,
} from './persistence-test-support.js';
// Side-effect import: every tenant registers, as the server boots.
import './variant-tenant/register-tenants.js';
import { startTenantDeadlineSweeper } from './variant-tenant/deadline-sweeper.js';
import { appendTenantEvent } from './variant-tenant/events.js';
import {
  correspondenceTenantForSpecId,
  type TenantManagedRoom,
  type VariantTenantRegistration,
} from './variant-tenant/registry.js';
import { tenantLiveHistoryExtras, tenantSnapshotPayload } from './variant-tenant/runtime.js';
import type { TenantGameStateLike, TenantRuntimeRoom } from './variant-tenant/tenant.js';

enableCorrespondenceVariantFlags();

type AnyRoom = TenantRuntimeRoom<string, string, unknown, TenantGameStateLike<string>, string>;
type Frame = Record<string, unknown> & { type: string };
type Status = { type: string; winner?: string; reason?: string };

const ALLOWANCE_MS = 900;
const SETTLE_MS = 1_400;
const COMPRESSED_TC: RoomTimeControl = {
  initialMs: ALLOWANCE_MS,
  incrementMs: 0,
  daysPerMove: ALLOWANCE_MS / DAY_MS,
};
const WS_CTX = { defaultRoomRegion: 'test', wsMessageLimit: 100, wsMessageWindowMs: 1_000 };

class FakeSocket {
  sent: Frame[] = [];
  closes: { code?: number; reason?: string }[] = [];
  send(data: string): void {
    this.sent.push(JSON.parse(data) as Frame);
  }
  close(code?: number, reason?: string): void {
    this.closes.push({ code, reason });
  }
  on(): this {
    return this;
  }
  asWebSocket(): WebSocket {
    return this as unknown as WebSocket;
  }
  lastStatus(): Status | null {
    for (let index = this.sent.length - 1; index >= 0; index -= 1) {
      const status = statusOf(this.sent[index]!);
      if (status) return status;
    }
    return null;
  }
}

function statusOf(frame: Frame): Status | null {
  const state = frame.state as { status?: Status } | undefined;
  if (state?.status) return state.status;
  const event = frame.event as { type?: string } | undefined;
  if (event?.type === 'game-aborted') return { type: 'aborted' };
  return null;
}

function request(clientId: string, cookie: string): IncomingMessage {
  return {
    url: `/?client=${clientId}`,
    headers: { host: 'localhost', cookie },
  } as unknown as IncomingMessage;
}

definePersistenceTests('correspondence room behind another process’s sweep (#1056)', () => {
  for (const specId of ['xiangqi', 'dark-xiangqi', 'jieqi', 'banqi']) {
    for (const scenario of ['abort', 'timeout'] as const) {
      test(`${specId} ${scenario}: a reconnect gets the finished room, the open seat sees it`, async () => {
        const game = await staleRoomAfterForeignSweep(specId, scenario);
        try {
          const { registration, stale, firstSocket, firstUser, secondCookie, expected } = game;

          // The reconnect the issue caught: no 1011, no retry; a hello carrying
          // the result the sweep wrote.
          const socket = new FakeSocket();
          await registration.attachWebSocket(
            WS_CTX,
            socket.asWebSocket(),
            request('second-reconnect', secondCookie),
            stale as unknown as TenantManagedRoom,
          );
          assert.deepEqual(socket.closes, [], `${specId}: the reconnect was refused`);
          const hello = socket.sent.find((frame) => frame.type === 'hello');
          assert.ok(hello, `${specId}: the reconnect got a hello`);
          assertStatus(statusOf(hello), expected, `${specId} reconnect hello`);

          // The seat that never left learns it too.
          assertStatus(firstSocket.lastStatus(), expected, `${specId} open seat`);

          // Whole payload: the hello is exactly what a cold load of the room
          // from the database sends that seat, its own per-ply views included,
          // so the post-sweep path keeps every masking rule a cold load applies
          // (fog sight, jieqi and banqi face-down pieces). Only connection
          // bookkeeping differs: the cold copy has no sockets.
          const rooms = registration.rooms as Map<string, TenantManagedRoom>;
          rooms.delete(stale.id);
          const fresh = (await registration.getOrLoadRoom(stale.id)) as unknown as AnyRoom | null;
          rooms.set(stale.id, stale as unknown as TenantManagedRoom);
          assert.ok(fresh && fresh !== stale);
          assert.equal(fresh.events.length, stale.events.length, 'the store has every event');
          const client = { id: String(hello.clientId), seat: String(hello.seat), solo: false };
          const tenant = CORRESPONDENCE_TEST_TENANTS[specId]!.tenant;
          const coldHello = {
            ...tenantSnapshotPayload(tenant, fresh as never, client as never),
            type: 'hello',
            ...tenantLiveHistoryExtras(tenant, fresh as never, client as never),
          };
          assert.deepEqual(
            comparable(hello),
            comparable(coldHello as Frame),
            `${specId}: the resynced room serves the cold-load payload`,
          );

          // The inbox's Recently finished list links a game's review page. An
          // aborted game has no review (as for a live abort, the room offers no
          // Review link), so it is not listed; a game lost on time is.
          const finished = await listRecentFinishedCorrespondenceGames(firstUser, {
            since: new Date(Date.now() - DAY_MS),
            limit: 10,
          });
          assert.equal(
            finished.some((row) => row.roomId === stale.id),
            scenario === 'timeout',
            `${specId}: the finished list links only a game with a result`,
          );
        } finally {
          game.registration.clearRooms();
        }
      });
    }
  }

  test('xiangqi: the process holding the room ends it on its own next sweep tick', async () => {
    const game = await staleRoomAfterForeignSweep('xiangqi', 'timeout');
    try {
      const before = game.firstSocket.sent.length;
      await sweepOnce();
      assert.ok(game.firstSocket.sent.length > before, 'the open seat got a frame');
      assertStatus(game.firstSocket.lastStatus(), game.expected, 'open seat after tick');
      assertStatus(
        game.stale.projection.state.status as Status,
        game.expected,
        'the room in memory',
      );
      // Nothing was written twice: the log has the one terminal event.
      const types = await eventTypes(game.stale.id);
      assert.equal(types.filter((type) => type === 'clock-expired').length, 1);
    } finally {
      game.registration.clearRooms();
    }
  });
});

async function staleRoomAfterForeignSweep(specId: string, scenario: 'abort' | 'timeout') {
  const entry = CORRESPONDENCE_TEST_TENANTS[specId];
  assert.ok(entry, `${specId}: no correspondence test tenant`);
  const { tenant } = entry;
  const registration = correspondenceTenantForSpecId(specId) as VariantTenantRegistration;
  assert.ok(registration?.createCorrespondenceGameForSeek);
  const firstUser = await makeUser(`${specId}-${scenario}-first`);
  const secondUser = await makeUser(`${specId}-${scenario}-second`);
  const created = await registration.createCorrespondenceGameForSeek({
    timeControl: COMPRESSED_TC,
    first: { userId: firstUser },
    second: { userId: secondUser },
  });
  assert.ok(created.ok, `${specId}: accept failed`);
  const rooms = registration.rooms as Map<string, TenantManagedRoom>;
  const stale = rooms.get(created.room.id) as unknown as AnyRoom;
  assert.ok(stale);

  const plies = scenario === 'abort' ? 0 : (entry.firstReplyPlies ?? 2);
  for (let ply = 0; ply < plies; ply += 1) {
    const state = stale.projection.state as never;
    const turn =
      tenant.clockOwner?.(state) ?? (stale.projection.state.status as { turn: string }).turn;
    const seq = await appendTenantEvent(
      tenant,
      stale as never,
      {
        type: 'move-played',
        at: Date.now(),
        roomId: stale.id,
        color: turn,
        move: legalMoveFor(specId, state),
      } as never,
    );
    assert.notEqual(seq, -1, `${specId}: ply ${ply + 1} is legal`);
  }

  // The side on move when the allowance runs out loses on time.
  const onMove =
    tenant.clockOwner?.(stale.projection.state as never) ??
    (stale.projection.state.status as { turn: string }).turn;
  const winner = tenant.colors.find((color) => color !== onMove);

  // Process A: the first mover has the room open.
  const firstCookie = await makeSessionCookie(firstUser);
  const secondCookie = await makeSessionCookie(secondUser);
  const firstSocket = new FakeSocket();
  await registration.attachWebSocket(
    WS_CTX,
    firstSocket.asWebSocket(),
    request('first-open', firstCookie),
    stale as unknown as TenantManagedRoom,
  );
  assert.ok(firstSocket.sent.some((frame) => frame.type === 'hello'));
  assert.equal(stale.projection.state.status.type, 'playing');

  // Process B: its sweeper hydrates its own copy and ends the game there.
  rooms.delete(stale.id);
  await sleep(SETTLE_MS);
  await sweepOnce();
  const swept = rooms.get(stale.id) as unknown as AnyRoom | undefined;
  assert.ok(swept && swept !== stale, `${specId}: the sweep hydrated its own copy`);
  const expected: Status =
    scenario === 'abort' ? { type: 'aborted' } : { type: 'finished', winner, reason: 'timeout' };
  assertStatus(swept.projection.state.status as Status, expected, `${specId} swept copy`);

  // Back in process A: the stale object is the one its socket is on.
  rooms.set(stale.id, stale as unknown as TenantManagedRoom);
  assert.equal(stale.projection.state.status.type, 'playing', 'precondition: A is behind');
  return { registration, stale, firstSocket, firstUser, secondCookie, expected };
}

function assertStatus(actual: Status | null, expected: Status, label: string): void {
  assert.ok(actual, `${label}: no status`);
  assert.equal(actual.type, expected.type, `${label}: status`);
  if (expected.winner !== undefined) assert.equal(actual.winner, expected.winner, label);
  if (expected.reason !== undefined) assert.equal(actual.reason, expected.reason, label);
}

// Connection bookkeeping differs by construction; everything else must match.
function comparable(frame: Frame): unknown {
  const {
    clientId: _clientId,
    seatToken: _seatToken,
    clients: _clients,
    connectedSeats: _connectedSeats,
    serverAt: _serverAt,
    ...rest
  } = frame;
  return JSON.parse(JSON.stringify(rest));
}

async function sweepOnce(): Promise<void> {
  const sweeper = startTenantDeadlineSweeper({
    intervalMs: 3_600_000,
    warnDeadlines: async () => {},
    digestTurns: async () => {},
    emailInbox: async () => {},
    sweepExpiredSeeks: async () => 0,
  });
  try {
    await sweeper.tick();
  } finally {
    sweeper.stop();
  }
}

async function eventTypes(roomId: string): Promise<string[]> {
  const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
  await client.connect();
  try {
    const result = await client.query<{ type: string }>(
      'SELECT type FROM events WHERE room_id = $1 ORDER BY seq',
      [roomId],
    );
    return result.rows.map((row) => row.type);
  } finally {
    await client.end();
  }
}

let userCounter = 0;
async function makeUser(label: string): Promise<string> {
  userCounter += 1;
  const id = `user_stale_${userCounter}_${Date.now()}`;
  const handle = `st${userCounter}${Date.now() % 100_000}`;
  await createUser({
    id,
    email: `${handle}@example.com`,
    emailVerifiedAt: new Date(),
    handle,
    displayName: label,
    now: new Date(),
  });
  return id;
}

async function makeSessionCookie(userId: string): Promise<string> {
  const sessionId = `sess_${userId}`;
  const token = `tok_${userId}`;
  const session: AccountSession = {
    id: sessionId,
    userId,
    tokenHash: sha256(token),
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  };
  await createAccountSession(session);
  return `mistboard_session=${sessionId}.${token}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
