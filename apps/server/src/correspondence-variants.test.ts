/**
 * Correspondence on every variant (2026-10-02), per variant: accepting a seek
 * makes a live days-per-move room seating both accounts, the deadline sweeper
 * forfeits a player who lets the clock lapse, and a no-show first move aborts.
 * Plus the hidden-information boundary: the inbox's per-seat board exists only
 * for the fog games (whose public card is sealed), and is exactly that seat's
 * own room view. The durable half (room_deadlines rows, cold-cache sweep) is
 * persistence-correspondence-variants.test.ts.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CORRESPONDENCE_ELIGIBLE_SPEC_IDS,
  correspondenceTimeControl,
  DAY_MS,
  GAME_SPECS,
} from '@mistboard/game';
import {
  CORRESPONDENCE_TEST_TENANTS,
  enableCorrespondenceVariantFlags,
  legalMoveFor,
} from './correspondence-test-support.js';
import { collectCurrentGames, currentGameBoardPayload } from './current-games.js';
import { correspondenceSeatBoard } from './routes/correspondence-games.js';
import type { HttpApiContext } from './routes/lib.js';
import { liveObservePolicy } from './server-policy.js';
// Side-effect import: every tenant registers, as the server boots.
import './variant-tenant/register-tenants.js';
import { tenantDurableDeadlineFor } from './variant-tenant/lifecycle.js';
import {
  correspondenceTenantForSpecId,
  type TenantManagedRoom,
  type VariantTenantRegistration,
} from './variant-tenant/registry.js';
import {
  appendTenantRuntimeEvent,
  createTenantRuntimeRoomFromEvents,
  tenantSnapshotPayload,
} from './variant-tenant/runtime.js';
import type {
  TenantGameStateLike,
  TenantRoomEvent,
  TenantRuntimeRoom,
} from './variant-tenant/tenant.js';

enableCorrespondenceVariantFlags();

type AnyRoom = TenantRuntimeRoom<string, string, unknown, TenantGameStateLike<string>, string>;

const VARIANT_SPEC_IDS = CORRESPONDENCE_ELIGIBLE_SPEC_IDS.filter((id) => id !== 'dark-chess');

function registrationFor(specId: string): VariantTenantRegistration {
  const registration = correspondenceTenantForSpecId(specId);
  assert.ok(registration, `${specId} has no correspondence registration`);
  return registration;
}

function roomMap(registration: VariantTenantRegistration): Map<string, TenantManagedRoom> {
  // The live map the registration reads; tests seed it the way hydration does.
  return registration.rooms as Map<string, TenantManagedRoom>;
}

async function acceptSeek(specId: string, daysPerMove: 1 | 3 | 7 = 3) {
  const registration = registrationFor(specId);
  const create = registration.createCorrespondenceGameForSeek;
  assert.ok(create);
  const created = await create({
    timeControl: correspondenceTimeControl(daysPerMove),
    first: { userId: `first-${specId}` },
    second: { userId: `second-${specId}` },
  });
  assert.ok(created.ok, `${specId}: accept failed ${created.ok ? '' : created.error}`);
  const room = roomMap(registration).get(created.room.id) as unknown as AnyRoom | undefined;
  assert.ok(room, `${specId}: the room is in the tenant's live map`);
  return { registration, created, room };
}

// The accepted room's own log, moved to epoch-era timestamps so any days-scale
// allowance is long overdue, plus `plies` legal moves. Hydrated exactly the way
// a cold server reads a room back.
function overdueCopy(specId: string, room: AnyRoom, plies: number): AnyRoom {
  const { tenant } = CORRESPONDENCE_TEST_TENANTS[specId]!;
  const events = room.events.map((event, index) => ({ ...event, at: 1_000 + index * 1_000 }));
  const hydrated = createTenantRuntimeRoomFromEvents(
    tenant,
    events as unknown as TenantRoomEvent<string, unknown, string>[],
  );
  assert.ok(hydrated.ok, `${specId}: the accepted log replays`);
  const copy = hydrated.room as unknown as AnyRoom;
  const at = 1_000 + events.length * 1_000;
  for (let ply = 0; ply < plies; ply += 1) {
    const state = copy.projection.state as never;
    const turn = (copy.projection.state as { status: { turn: string } }).status.turn;
    const appended = appendTenantRuntimeEvent(
      tenant,
      copy as never,
      {
        type: 'move-played',
        at: at + (ply + 1) * 1_000,
        roomId: copy.id,
        color: turn,
        move: legalMoveFor(specId, state),
      } as never,
    );
    assert.notEqual(appended, -1, `${specId}: ply ${ply + 1} is legal`);
  }
  return copy;
}

for (const specId of VARIANT_SPEC_IDS) {
  const entry = CORRESPONDENCE_TEST_TENANTS[specId];

  test(`${specId}: has a correspondence test tenant`, () => {
    assert.ok(entry, `add ${specId} to CORRESPONDENCE_TEST_TENANTS`);
  });
  if (!entry) continue;
  const { tenant } = entry;

  test(`${specId}: accepting a seek seats both accounts in a live days-per-move room`, async () => {
    const { registration, created, room } = await acceptSeek(specId, 3);
    try {
      assert.equal(created.room.gameSpecId, specId);
      assert.ok(created.room.id.startsWith(registration.roomIdPrefix));
      // Move order, mapped onto the tenant's own colors.
      assert.deepEqual(created.seats, { first: tenant.colors[0], second: tenant.colors[1] });
      assert.equal(room.seatTokens[tenant.colors[0]!]?.userId, `first-${specId}`);
      assert.equal(room.seatTokens[tenant.colors[1]!]?.userId, `second-${specId}`);
      assert.equal(room.projection.timeControl?.daysPerMove, 3);
      assert.equal(room.rated, false, 'correspondence is casual');
      assert.equal(room.projection.state.status.type, 'playing');
      // The first mover owes a move within the allowance: the value the
      // room_deadlines row and the sweeper both read.
      const deadline = tenantDurableDeadlineFor(tenant, room as never);
      assert.ok(deadline, `${specId}: an enforceable deadline from the start`);
      assert.equal(deadline.seat, tenant.colors[0]);
      assert.ok(Math.abs(deadline.dueAt - (Date.now() + 3 * DAY_MS)) < 60_000);
      // A days-per-move room never pins the deploy drain gate.
      assert.equal(registration.activeGameCount(), 0);
    } finally {
      registration.clearRooms();
    }
  });

  test(`${specId}: the sweeper forfeits the player who let the clock lapse`, async () => {
    const { registration, room } = await acceptSeek(specId, 1);
    try {
      const overdue = overdueCopy(specId, room, 2);
      const deadline = tenantDurableDeadlineFor(tenant, overdue as never);
      assert.ok(deadline);
      assert.equal(deadline.seat, tenant.colors[0], 'back to the first mover after two plies');
      roomMap(registration).set(overdue.id, overdue as unknown as TenantManagedRoom);
      await registration.sweepDueDeadline?.(overdue.id);
      const status = overdue.projection.state.status as {
        type: string;
        winner?: string;
        reason?: string;
      };
      assert.equal(status.type, 'finished');
      assert.equal(status.reason, 'timeout');
      assert.equal(status.winner, tenant.colors[1]);
      assert.equal(overdue.events.at(-1)?.type, 'clock-expired');
    } finally {
      registration.clearRooms();
    }
  });

  test(`${specId}: a first move never made aborts the game, no result`, async () => {
    const { registration, room } = await acceptSeek(specId, 1);
    try {
      const overdue = overdueCopy(specId, room, 0);
      roomMap(registration).set(overdue.id, overdue as unknown as TenantManagedRoom);
      await registration.sweepDueDeadline?.(overdue.id);
      assert.equal(overdue.projection.state.status.type, 'aborted');
    } finally {
      registration.clearRooms();
    }
  });
}

// ---- Hidden information ------------------------------------------------------------

test('the inbox seat board is opted in exactly for the sealed (fog) correspondence games', () => {
  for (const specId of CORRESPONDENCE_ELIGIBLE_SPEC_IDS) {
    const spec = GAME_SPECS.find((candidate) => candidate.id === specId);
    assert.ok(spec);
    const sealed = liveObservePolicy(spec.visibility, spec.id) !== 'open';
    assert.equal(
      typeof registrationFor(specId).seatBoard === 'function',
      sealed,
      `${specId}: a seat board ${sealed ? 'is needed' : 'must not exist'}; its public card is ${sealed ? 'sealed' : 'open'}`,
    );
  }
});

test('dark-xiangqi: seat A’s inbox board is exactly A’s room view, and never B’s', async () => {
  const { tenant } = CORRESPONDENCE_TEST_TENANTS['dark-xiangqi']!;
  const { registration, room } = await acceptSeek('dark-xiangqi');
  try {
    // A few plies so the two fogs differ in more than the starting ranks.
    const at = Date.now();
    for (let ply = 0; ply < 4; ply += 1) {
      const turn = (room.projection.state as { status: { turn: string } }).status.turn;
      const index = appendTenantRuntimeEvent(
        tenant,
        room as never,
        {
          type: 'move-played',
          at: at + (ply + 1) * 1_000,
          roomId: room.id,
          color: turn,
          move: legalMoveFor('dark-xiangqi', room.projection.state as never),
        } as never,
      );
      assert.notEqual(index, -1);
    }
    const json = (value: unknown): unknown => JSON.parse(JSON.stringify(value));
    const boards: Record<string, unknown> = {};
    for (const seat of tenant.colors) {
      const board = await correspondenceSeatBoard({
        roomId: room.id,
        gameSpecId: 'dark-xiangqi',
        mySeat: seat,
      });
      assert.ok(board, `${seat} gets a board`);
      const snapshot = tenantSnapshotPayload(tenant, room as never, {
        id: room.seatTokens[seat]?.clientId ?? `seat-board:${seat}`,
        seat,
        solo: false,
      }).state;
      assert.deepEqual(json(board), json(snapshot), `${seat}: byte-for-byte the room view`);
      assert.equal((board as { perspective: string }).perspective, seat);
      // Every opponent piece outside this seat's sight is shrouded: identity
      // never reaches the wire.
      const view = board as {
        board: Record<string, { piece?: { color: string }; shrouded: boolean }>;
        visibleSquares: string[];
      };
      const visible = new Set(view.visibleSquares);
      for (const [square, entry] of Object.entries(view.board)) {
        if (entry.shrouded || entry.piece?.color === seat) continue;
        assert.ok(visible.has(square), `${seat} sees an unshrouded piece on hidden ${square}`);
      }
      boards[seat] = json(board);
    }
    assert.notDeepEqual(boards.red, boards.black, 'each seat gets its own fog, not a shared truth');
    // Anything that is not a seat of this game gets nothing.
    for (const seat of ['white', 'spectator', '', 'RED']) {
      assert.equal(
        await correspondenceSeatBoard({
          roomId: room.id,
          gameSpecId: 'dark-xiangqi',
          mySeat: seat,
        }),
        null,
      );
    }
    // A spec mismatch (a forged index row) is no board either.
    assert.equal(
      await correspondenceSeatBoard({ roomId: room.id, gameSpecId: 'xiangqi', mySeat: 'red' }),
      null,
    );
  } finally {
    registration.clearRooms();
  }
});

test('every other new variant serves no seat board: the inbox reads the public card', async () => {
  for (const specId of VARIANT_SPEC_IDS) {
    if (specId === 'dark-xiangqi') continue;
    const { tenant } = CORRESPONDENCE_TEST_TENANTS[specId]!;
    const { registration, room } = await acceptSeek(specId);
    try {
      for (const seat of tenant.colors) {
        assert.equal(
          await correspondenceSeatBoard({ roomId: room.id, gameSpecId: specId, mySeat: seat }),
          null,
          `${specId}/${seat}`,
        );
      }
    } finally {
      registration.clearRooms();
    }
  }
});

test('the public current-games card of a Fog Xiangqi correspondence game is sealed, no board', async () => {
  const { tenant } = CORRESPONDENCE_TEST_TENANTS['dark-xiangqi']!;
  const { registration, room } = await acceptSeek('dark-xiangqi');
  try {
    const at = Date.now();
    for (let ply = 0; ply < 2; ply += 1) {
      const turn = (room.projection.state as { status: { turn: string } }).status.turn;
      appendTenantRuntimeEvent(
        tenant,
        room as never,
        {
          type: 'move-played',
          at: at + (ply + 1) * 1_000,
          roomId: room.id,
          color: turn,
          move: legalMoveFor('dark-xiangqi', room.projection.state as never),
        } as never,
      );
    }
    const ctx = { rooms: new Map() } as unknown as HttpApiContext;
    const game = collectCurrentGames(ctx, Date.now()).find((entry) => entry.roomId === room.id);
    assert.ok(game, 'the game is listed');
    assert.equal(game.timeClass, 'correspondence');
    assert.equal(game.observe, 'sealed');
    assert.equal(await currentGameBoardPayload(game), null);
    assert.equal('payload' in game, false);
  } finally {
    registration.clearRooms();
  }
});
