import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import {
  CORRESPONDENCE_ELIGIBLE_SPEC_IDS,
  correspondenceTimeControl,
  DAY_MS,
  type GomokuColor,
  type GomokuOpening,
  getGomokuLegalMoves,
  isCorrespondenceAllowlistedSpec,
} from '@mistboard/game';
import { gomokuRooms } from './gomoku-registration.js';
import { type GomokuRuntimeRoom, gomokuTenant } from './gomoku-tenant.js';
import type { UserAccount } from './persistence.js';
import { createSeekResult, ratedSeekError, seeksVisibleTo } from './routes/correspondence-seeks.js';
import type { HttpApiContext } from './routes/lib.js';
import { tenantDurableDeadlineFor } from './variant-tenant/lifecycle.js';
import { correspondenceTenantForSpecId } from './variant-tenant/registry.js';
import {
  appendTenantRuntimeEvent,
  createTenantRuntimeRoomFromEvents,
  tenantSnapshotPayload,
} from './variant-tenant/runtime.js';
import { tenantTurnOrder } from './variant-tenant/tenant.js';

const priorFlag = process.env.MISTBOARD_GOMOKU_ENABLED;
const originalSetup = gomokuTenant.rules.createSetup;
afterEach(() => {
  gomokuTenant.rules.createSetup = originalSetup;
  if (priorFlag === undefined) delete process.env.MISTBOARD_GOMOKU_ENABLED;
  else process.env.MISTBOARD_GOMOKU_ENABLED = priorFlag;
  gomokuRooms.clear();
});

function registration() {
  const found = correspondenceTenantForSpecId('gomoku');
  assert.ok(found, 'Gomoku has a correspondence factory and deadline sweeper');
  return found;
}

const terms = {
  timeControl: correspondenceTimeControl(3),
  first: { userId: 'gomoku-first' },
  second: { userId: 'gomoku-second' },
};

// Recorded deals for both move orders, independent of the current screened pool.
const OPENINGS: Record<GomokuColor, GomokuOpening> = {
  black: {
    stones: [
      { square: 'h8', color: 'black' },
      { square: 'i8', color: 'white' },
    ],
    turn: 'black',
  },
  white: {
    stones: [
      { square: 'h8', color: 'black' },
      { square: 'i8', color: 'white' },
      { square: 'i9', color: 'black' },
    ],
    turn: 'white',
  },
};

async function acceptSeek(first: GomokuColor) {
  process.env.MISTBOARD_GOMOKU_ENABLED = 'true';
  const opening = OPENINGS[first];
  gomokuTenant.rules.createSetup = () => opening;
  const registered = registration();
  assert.equal(typeof registered.sweepDueDeadline, 'function');
  const created = await registered.createCorrespondenceGameForSeek!(terms);
  assert.ok(created.ok);
  const second = gomokuTenant.oppositeColor(first);
  assert.deepEqual(created.seats, { first, second });
  assert.equal(created.room.rated, false);
  const room = gomokuRooms.get(created.room.id)!;
  assert.ok(room);
  assert.equal(room.seatTokens[first]?.userId, terms.first.userId);
  assert.equal(room.seatTokens[second]?.userId, terms.second.userId);
  assert.deepEqual(room.projection.state.opening, { stones: opening.stones, turn: opening.turn });
  assert.equal(room.projection.timeControl?.daysPerMove, 3);
  assert.equal(tenantDurableDeadlineFor(gomokuTenant, room)?.seat, first);
  assert.equal(registered.activeGameCount(), 0, 'correspondence never holds the deploy drain');
  return room;
}

function play(room: GomokuRuntimeRoom, at: number) {
  const state = room.projection.state;
  assert.equal(state.status.type, 'playing');
  if (state.status.type !== 'playing') throw new Error('expected a playing room');
  const move = getGomokuLegalMoves({ ...state, status: state.status })[0]!;
  assert.notEqual(
    appendTenantRuntimeEvent(gomokuTenant, room, {
      type: 'move-played',
      at,
      roomId: room.id,
      color: state.status.turn,
      move,
    }),
    -1,
  );
}

for (const first of ['black', 'white'] as const) {
  test(`Gomoku ${first}-to-move correspondence seats by move order, replays its opening and resets each deadline`, async () => {
    const room = await acceptSeek(first);
    const second = gomokuTenant.oppositeColor(first);
    const start = Date.now();
    for (let ply = 1; ply <= 3; ply += 1) {
      const at = start + ply * 1_000;
      play(room, at);
      assert.deepEqual(tenantDurableDeadlineFor(gomokuTenant, room), {
        seat: ply % 2 === 1 ? second : first,
        dueAt: at + 3 * DAY_MS,
      });
      const restored = createTenantRuntimeRoomFromEvents(
        gomokuTenant,
        JSON.parse(JSON.stringify(room.events)),
      );
      assert.ok(restored.ok);
      assert.deepEqual(restored.room.projection, room.projection);
      assert.deepEqual(
        tenantDurableDeadlineFor(gomokuTenant, restored.room),
        tenantDurableDeadlineFor(gomokuTenant, room),
      );
      const snapshot = tenantSnapshotPayload(gomokuTenant, restored.room, {
        id: room.seatTokens[second]!.clientId,
        seat: second,
        solo: false,
      });
      assert.equal(snapshot.timeControl?.daysPerMove, 3);
      assert.deepEqual(snapshot.state.board, room.projection.state.board);
    }
  });

  for (const plies of [0, 1, 2, 3]) {
    test(`Gomoku ${first}-to-move correspondence expires the right seat after ${plies} plies`, async () => {
      const accepted = await acceptSeek(first);
      const events = accepted.events.map((event, index) => ({
        ...event,
        at: 1_000 + index * 1_000,
      }));
      const restored = createTenantRuntimeRoomFromEvents(gomokuTenant, events);
      assert.ok(restored.ok);
      const room = restored.room;
      for (let ply = 0; ply < plies; ply += 1) play(room, 10_000 + ply * 1_000);
      const overdue = tenantDurableDeadlineFor(gomokuTenant, room);
      assert.ok(overdue);
      const expected = plies % 2 === 0 ? first : gomokuTenant.oppositeColor(first);
      assert.equal(overdue.seat, expected);
      gomokuRooms.set(room.id, room);
      await registration().sweepDueDeadline!(room.id);
      assert.deepEqual(
        room.projection.state.status,
        plies < 2
          ? { type: 'aborted', reason: 'pregame-timeout' }
          : { type: 'finished', winner: gomokuTenant.oppositeColor(expected), reason: 'timeout' },
      );
      assert.equal(tenantDurableDeadlineFor(gomokuTenant, room), null);
      const count = room.events.length;
      await registration().sweepDueDeadline!(room.id);
      assert.equal(room.events.length, count, 'an expired game cannot finish twice');
    });
  }
}

test('a tenant cannot name a first mover outside its seats', () => {
  assert.throws(
    () => tenantTurnOrder({ colors: ['black'], firstMover: () => 'white' }, {}),
    /not one of/,
  );
});

test('Gomoku correspondence factory and seek creation remain behind the Gomoku flag', async () => {
  process.env.MISTBOARD_GOMOKU_ENABLED = 'false';
  assert.equal(registration().enabled(), false);
  assert.deepEqual(await registration().createCorrespondenceGameForSeek!(terms), {
    ok: false,
    error: 'disabled',
  });
  assert.equal(gomokuRooms.size, 0);
  // Public correspondence stays held off even for an admin, regardless of the flag.
  const admin = { id: 'admin', accountRole: 'admin' } as UserAccount;
  const ctx = {} as HttpApiContext;
  const body = { gameSpecId: 'gomoku', daysPerMove: 0 };
  assert.deepEqual(await createSeekResult(ctx, admin, body, 'board'), {
    status: 501,
    body: { error: 'correspondence_unsupported_spec' },
  });
  process.env.MISTBOARD_GOMOKU_ENABLED = 'true';
  assert.deepEqual(await createSeekResult(ctx, admin, body, 'board'), {
    status: 501,
    body: { error: 'correspondence_unsupported_spec' },
  });
});

test('public Gomoku has no correspondence seeks or rating pool', async () => {
  assert.equal(CORRESPONDENCE_ELIGIBLE_SPEC_IDS.includes('gomoku'), false);
  assert.equal(isCorrespondenceAllowlistedSpec('gomoku'), false);
  const seeks = [{ gameSpecId: 'xiangqi' }, { gameSpecId: 'gomoku' }];
  const user = { id: 'reader' } as UserAccount;
  for (const reader of [null, user]) {
    assert.deepEqual(await seeksVisibleTo(seeks, reader, async () => ['gomoku']), [seeks[0]]);
  }
  assert.equal(ratedSeekError('gomoku', terms.timeControl, true), 'rated_unsupported_spec');
});
