/**
 * Correspondence on every variant against real Postgres (2026-10-02): for each
 * newly eligible variant, accepting a seek writes the room_deadlines row for the
 * first mover, two moves through the persistent writer move it back to the
 * first mover, and once the (compressed) allowance lapses a cold-cache sweep
 * (nothing in memory, so the room hydrates from its event log) forfeits that
 * player on time and clears the row. The dark-chess original is
 * persistence-correspondence-e2e.test.ts; this is the same loop, per tenant.
 */

import { CORRESPONDENCE_ELIGIBLE_SPEC_IDS, DAY_MS, type RoomTimeControl } from '@mistboard/game';
import {
  CORRESPONDENCE_TEST_TENANTS,
  enableCorrespondenceVariantFlags,
  legalMoveFor,
} from './correspondence-test-support.js';
import { createUser, getGameSummary, loadRoom } from './persistence.js';
import {
  assert,
  definePersistenceTests,
  pg,
  TEST_DATABASE_URL,
  test,
} from './persistence-test-support.js';
// Side-effect import: every tenant registers, as the server boots.
import './variant-tenant/register-tenants.js';
import { startTenantDeadlineSweeper } from './variant-tenant/deadline-sweeper.js';
import { appendTenantEvent } from './variant-tenant/events.js';
import { correspondenceTenantForSpecId } from './variant-tenant/registry.js';
import type { TenantGameStateLike, TenantRuntimeRoom } from './variant-tenant/tenant.js';

// Long enough that seating and two moves always fit inside one allowance;
// short enough that the suite waits once, about a second and a half.
const ALLOWANCE_MS = 900;
const SETTLE_MS = 1_400;

const COMPRESSED_TC: RoomTimeControl = {
  initialMs: ALLOWANCE_MS,
  incrementMs: 0,
  daysPerMove: ALLOWANCE_MS / DAY_MS,
};

type AnyRoom = TenantRuntimeRoom<string, string, unknown, TenantGameStateLike<string>, string>;

definePersistenceTests('correspondence variants e2e', () => {
  test('every variant: accept indexes the deadline, a lapsed clock forfeits on a cold sweep', async () => {
    enableCorrespondenceVariantFlags();
    const specs = CORRESPONDENCE_ELIGIBLE_SPEC_IDS.filter((id) => id !== 'dark-chess');
    const started: Array<{ specId: string; roomId: string; first: string; second: string }> = [];

    for (const specId of specs) {
      const { tenant } = CORRESPONDENCE_TEST_TENANTS[specId]!;
      const registration = correspondenceTenantForSpecId(specId);
      assert.ok(registration?.createCorrespondenceGameForSeek, `${specId} registration`);
      const first = await makeUser(`${specId}-a`);
      const second = await makeUser(`${specId}-b`);
      const created = await registration.createCorrespondenceGameForSeek({
        timeControl: COMPRESSED_TC,
        first: { userId: first },
        second: { userId: second },
      });
      assert.ok(created.ok, `${specId}: accept`);
      const roomId = created.room.id;

      // Seated at accept: the first mover owes a move, and the row names them.
      const seated = await deadlineRow(roomId);
      assert.ok(seated, `${specId}: a room_deadlines row once both seats are filled`);
      assert.equal(seated.seat, tenant.colors[0]);
      assert.equal(seated.seat_user_id, first);
      assert.equal(seated.game_spec_id, specId);

      const room = registration.rooms.get(roomId) as unknown as AnyRoom;
      for (let ply = 0; ply < 2; ply += 1) {
        const turn = (room.projection.state as { status: { turn: string } }).status.turn;
        const seq = await appendTenantEvent(
          tenant,
          room as never,
          {
            type: 'move-played',
            at: Date.now(),
            roomId,
            color: turn,
            move: legalMoveFor(specId, room.projection.state as never),
          } as never,
        );
        assert.notEqual(seq, -1, `${specId}: ply ${ply + 1} accepted`);
      }
      const armed = await deadlineRow(roomId);
      assert.ok(armed, `${specId}: a row while the clock runs`);
      assert.equal(armed.seat, tenant.colors[0], `${specId}: back to the first mover`);
      assert.equal(armed.seat_user_id, first);
      started.push({ specId, roomId, first, second });
    }

    // Restart path: nothing in memory when the deadlines lapse.
    for (const { specId } of started) correspondenceTenantForSpecId(specId)?.clearRooms();
    await sleep(SETTLE_MS);
    await sweepOnce();

    for (const { specId, roomId } of started) {
      const { tenant } = CORRESPONDENCE_TEST_TENANTS[specId]!;
      const registration = correspondenceTenantForSpecId(specId)!;
      const hydrated = (await registration.getOrLoadRoom(roomId)) as unknown as AnyRoom | null;
      assert.ok(hydrated, `${specId}: hydrates`);
      const status = hydrated.projection.state.status as {
        type: string;
        winner?: string;
        reason?: string;
      };
      assert.equal(status.type, 'finished', `${specId}: finished`);
      assert.equal(status.reason, 'timeout', `${specId}: on time`);
      assert.equal(status.winner, tenant.colors[1], `${specId}: the waiting player wins`);
      const events = await loadRoom(roomId);
      assert.equal(events?.at(-1)?.type, 'clock-expired', `${specId}: durable timeout`);
      assert.equal(await deadlineRow(roomId), null, `${specId}: row cleared`);
      const summary = await getGameSummary(roomId);
      assert.ok(summary, `${specId}: a completed games row`);
      assert.equal(summary.termination, 'timeout', `${specId}: games row termination`);
      registration.clearRooms();
    }
  });
});

async function sweepOnce(): Promise<void> {
  // Real listDue + real registry routing; only the interval is parked.
  const sweeper = startTenantDeadlineSweeper({ intervalMs: 3_600_000 });
  try {
    await sweeper.tick();
  } finally {
    sweeper.stop();
  }
}

async function makeUser(slug: string): Promise<string> {
  const handle = slug.replace(/[^a-z0-9]/g, '').slice(0, 20);
  const id = `user-${handle}`;
  await createUser({
    id,
    email: `${handle}@example.com`,
    emailVerifiedAt: new Date(),
    handle,
    displayName: handle,
    now: new Date(),
  });
  return id;
}

async function deadlineRow(roomId: string): Promise<{
  seat: string;
  seat_user_id: string | null;
  game_spec_id: string;
  due_at: Date;
} | null> {
  const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
  await client.connect();
  try {
    const { rows } = await client.query(
      `SELECT seat, seat_user_id, game_spec_id, due_at FROM room_deadlines WHERE room_id = $1`,
      [roomId],
    );
    return rows[0] ?? null;
  } finally {
    await client.end();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
