import assert from 'node:assert/strict';
import test from 'node:test';
import {
  type AtomicXiangqiGameState,
  type BanqiGameState,
  type CrazyhouseXiangqiGameState,
  correspondenceTimeControl,
  DAY_MS,
  type DuckXiangqiColor,
  type DuckXiangqiGameState,
  type DuckXiangqiTurn,
  type FortressXiangqiGameState,
  type JieqiGameState,
  type JungleFlipGameState,
  type JungleGameState,
  type XiangqiGameState,
} from '@mistboard/game';
import type { MahjongTenantState } from '@mistboard/mahjong';
import type { DarkChessTenantState } from '../dark-chess-tenant.js';
import { type DuckXiangqiEvent, duckXiangqiTenant } from '../duck-xiangqi-tenant.js';
import { hashSeatToken } from '../server-seat-session.js';
import { appendTenantEvent, type TenantEventWriterPersistence } from './events.js';
import {
  sweepTenantRoomDeadline,
  tenantAbortPhaseFor,
  tenantDurableDeadlineFor,
} from './lifecycle.js';
import { createTenantRuntimeRoomFromEvents } from './runtime.js';
import type { TenantSeatTokenState } from './tenant.js';

// Duck Xiangqi's turn is a piece move plus a duck placement in one event. The
// generic lifecycle decides "has the first mover moved yet" from the state's
// `lastMove`; the duck kernel once named that field `lastTurn`, so after Red's
// whole first turn the room still read as "Red to make move 1". The durable
// row then named Red as the seat on move (black's /correspondence card sat in
// "Waiting on opponent"), anchored at seat fill, and the sweeper would have
// aborted the game at that deadline while Black still had a day to answer.

const TC = correspondenceTimeControl(1);
const ALLOWANCE_MS = DAY_MS;
const SEAT_FILL_AT = 5_000;
const RED_TURN_AT = 60 * 60 * 1000; // an hour after the seats filled

function roomEvents(roomId: string): DuckXiangqiEvent[] {
  return [
    { type: 'room-created', at: 1_000, roomId, gameSpecId: 'duck-xiangqi', timeControl: TC },
    {
      type: 'clock-started',
      at: 1_000,
      roomId,
      clock: {
        activeColor: null,
        incrementMs: TC.incrementMs,
        initialMs: TC.initialMs,
        remainingMs: { red: TC.initialMs, black: TC.initialMs },
        runningSince: null,
      },
    },
    { type: 'seat-assigned', at: 2_000, roomId, clientId: 'red-client', seat: 'red' },
    { type: 'seat-assigned', at: SEAT_FILL_AT, roomId, clientId: 'black-client', seat: 'black' },
  ];
}

function turn(roomId: string, at: number, color: DuckXiangqiColor, move: DuckXiangqiTurn) {
  return { type: 'move-played', at, roomId, color, move } satisfies DuckXiangqiEvent;
}

// Red: central cannon, then the duck enters. Black: mirrored cannon, duck moves.
const RED_CANNON: DuckXiangqiTurn = { from: 'h3', to: 'e3', duckTo: 'e5' };
const BLACK_CANNON: DuckXiangqiTurn = { from: 'h8', to: 'e8', duckTo: 'd5' };
const RED_HORSE: DuckXiangqiTurn = { from: 'b1', to: 'c3', duckTo: 'e6' };

function hydrate(events: DuckXiangqiEvent[]) {
  const hydrated = createTenantRuntimeRoomFromEvents(duckXiangqiTenant, events);
  assert.ok(hydrated.ok, 'fixture event log must hydrate');
  return hydrated.room;
}

function seatTokenState(seat: DuckXiangqiColor): TenantSeatTokenState<DuckXiangqiColor> {
  return {
    clientId: `${seat}-client`,
    seat,
    tokenHash: hashSeatToken(`${seat}-token`),
    userId: `${seat}-user`,
    userHandle: `${seat}-handle`,
    userDisplayName: `${seat} player`,
    issuedAt: new Date(1_000),
    lastSeenAt: new Date(1_000),
    revokedAt: null,
  };
}

// Compile-time guard for the whole family: TenantGameStateLike declares
// `lastMove?: unknown`, so a kernel state that names the field anything else
// still satisfies the contract and silently breaks the first-move phase. Every
// tenant state must declare the key itself; a new tenant goes on this list.
type DeclaresLastMove<S> = 'lastMove' extends keyof S ? true : false;
const EVERY_TENANT_STATE_DECLARES_LAST_MOVE: [
  DeclaresLastMove<AtomicXiangqiGameState>,
  DeclaresLastMove<BanqiGameState>,
  DeclaresLastMove<CrazyhouseXiangqiGameState>,
  DeclaresLastMove<DarkChessTenantState>,
  DeclaresLastMove<DuckXiangqiGameState>,
  DeclaresLastMove<FortressXiangqiGameState>,
  DeclaresLastMove<JieqiGameState>,
  DeclaresLastMove<JungleFlipGameState>,
  DeclaresLastMove<JungleGameState>,
  DeclaresLastMove<MahjongTenantState>,
  DeclaresLastMove<XiangqiGameState>,
] = [true, true, true, true, true, true, true, true, true, true, true];

test('every tenant state declares the lastMove field the lifecycle reads', () => {
  assert.ok(EVERY_TENANT_STATE_DECLARES_LAST_MOVE.every(Boolean));
});

test('duck xiangqi: after red completes its first turn, black owes the move', () => {
  const roomId = 'dkx_deadline_after_red';
  const seated = hydrate(roomEvents(roomId));
  assert.deepEqual(tenantDurableDeadlineFor(duckXiangqiTenant, seated), {
    seat: 'red',
    dueAt: SEAT_FILL_AT + ALLOWANCE_MS,
  });

  const afterRed = hydrate([...roomEvents(roomId), turn(roomId, RED_TURN_AT, 'red', RED_CANNON)]);
  assert.equal(afterRed.projection.state.status.type, 'playing');
  assert.equal(tenantAbortPhaseFor(duckXiangqiTenant, afterRed), 'black-1');
  assert.deepEqual(tenantDurableDeadlineFor(duckXiangqiTenant, afterRed), {
    seat: 'black',
    dueAt: RED_TURN_AT + ALLOWANCE_MS,
  });
});

test('duck xiangqi: mid-game the durable deadline follows the side to move', () => {
  const roomId = 'dkx_deadline_mid_game';
  const blackAt = RED_TURN_AT + 1_000;
  const afterBlack = hydrate([
    ...roomEvents(roomId),
    turn(roomId, RED_TURN_AT, 'red', RED_CANNON),
    turn(roomId, blackAt, 'black', BLACK_CANNON),
  ]);
  assert.equal(tenantAbortPhaseFor(duckXiangqiTenant, afterBlack), null);
  assert.deepEqual(tenantDurableDeadlineFor(duckXiangqiTenant, afterBlack), {
    seat: 'red',
    dueAt: blackAt + ALLOWANCE_MS,
  });

  const redAgainAt = blackAt + 2_000;
  const afterRedAgain = hydrate([
    ...roomEvents(roomId),
    turn(roomId, RED_TURN_AT, 'red', RED_CANNON),
    turn(roomId, blackAt, 'black', BLACK_CANNON),
    turn(roomId, redAgainAt, 'red', RED_HORSE),
  ]);
  assert.deepEqual(tenantDurableDeadlineFor(duckXiangqiTenant, afterRedAgain), {
    seat: 'black',
    dueAt: redAgainAt + ALLOWANCE_MS,
  });
});

test('duck xiangqi: the event writer hands the room_deadlines row to black after red turns', async () => {
  const roomId = 'dkx_deadline_row';
  const room = hydrate(roomEvents(roomId));
  room.seatTokens.red = seatTokenState('red');
  room.seatTokens.black = seatTokenState('black');
  const upserts: Array<{ seat: string; seatUserId: string | null; dueAt: number }> = [];
  const persistence: TenantEventWriterPersistence<
    DuckXiangqiColor,
    DuckXiangqiTurn,
    'duck-xiangqi'
  > = {
    abortRunningGame: async () => true,
    appendRoomEvent: async () => {},
    deleteRoomDeadline: async () => {},
    isInitialized: () => true,
    recordGameEnd: async () => {},
    upsertRoomDeadline: async (record) => {
      upserts.push({
        seat: record.seat,
        seatUserId: record.seatUserId,
        dueAt: record.dueAt.getTime(),
      });
    },
    upsertRoomSeatToken: async () => {},
  };

  await appendTenantEvent(duckXiangqiTenant, room, turn(roomId, RED_TURN_AT, 'red', RED_CANNON), {
    persistence,
  });
  assert.deepEqual(upserts.at(-1), {
    seat: 'black',
    seatUserId: 'black-user',
    dueAt: RED_TURN_AT + ALLOWANCE_MS,
  });

  const blackAt = RED_TURN_AT + 1_000;
  await appendTenantEvent(duckXiangqiTenant, room, turn(roomId, blackAt, 'black', BLACK_CANNON), {
    persistence,
  });
  assert.deepEqual(upserts.at(-1), {
    seat: 'red',
    seatUserId: 'red-user',
    dueAt: blackAt + ALLOWANCE_MS,
  });
});

test('duck xiangqi: the sweeper does not abort at the seat-fill deadline once red has turned', async () => {
  const roomId = 'dkx_deadline_sweep';
  const room = hydrate([...roomEvents(roomId), turn(roomId, RED_TURN_AT, 'red', RED_CANNON)]);
  const appended: DuckXiangqiEvent[] = [];
  const ctx = {
    appendEvent: async (_room: unknown, event: DuckXiangqiEvent) => {
      appended.push(event);
      return 0;
    },
    broadcastEventAppended: () => {},
  };

  // Just past red's old (seat-fill) window: black still has most of a day.
  const early = await sweepTenantRoomDeadline(duckXiangqiTenant, room, {
    ...ctx,
    now: () => SEAT_FILL_AT + ALLOWANCE_MS + 1,
  });
  assert.equal(early, 'not-due');
  assert.equal(appended.length, 0);

  // Black's own window, anchored at red's turn, is what the sweeper enforces.
  const late = await sweepTenantRoomDeadline(duckXiangqiTenant, room, {
    ...ctx,
    now: () => RED_TURN_AT + ALLOWANCE_MS + 1,
  });
  assert.equal(late, 'aborted');
});
