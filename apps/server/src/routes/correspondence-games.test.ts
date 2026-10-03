// Hidden-information regression tests for the /correspondence inbox's
// per-seat board (GET /api/correspondence/games `seatBoard`). The payload for a
// seat must be exactly the board that seat's own room snapshot carries, and
// must never hold a piece on a square that seat cannot see.

import assert from 'node:assert/strict';
import test from 'node:test';
import type { Board, Color, Move, PlayerView, Square } from '@mistboard/game';
import { correspondenceTimeControl } from '@mistboard/game';
import {
  createDarkChessCorrespondenceGameForSeek,
  darkChessSeatBoard,
  darkChessTenantRooms,
} from '../dark-chess-registration.js';
import { darkChessTenant } from '../dark-chess-tenant.js';
import type { CorrespondenceGameSummary } from '../persistence-room-deadlines.js';
import { appendTenantRuntimeEvent, tenantSnapshotPayload } from '../variant-tenant/runtime.js';
import {
  type CorrespondenceGamesDeps,
  correspondenceGamesForUser,
  correspondenceSeatBoard,
} from './correspondence-games.js';

process.env.MISTBOARD_CORRESPONDENCE_ENABLED = 'true';

const ALICE = 'user-alice';
const BOB = 'user-bob';
const CAROL = 'user-carol';

// 1.e4 d5 2.Nf3 Nc6: White's e4 pawn eyes d5, so some Black pieces are in view
// and most are not; enough to tell a redacted board from the truth.
const MOVES: Array<{ color: Color; move: Move }> = [
  { color: 'white', move: { from: 'e2', to: 'e4' } },
  { color: 'black', move: { from: 'd7', to: 'd5' } },
  { color: 'white', move: { from: 'g1', to: 'f3' } },
  { color: 'black', move: { from: 'b8', to: 'c6' } },
];

async function seatedGameWithMoves() {
  const created = await createDarkChessCorrespondenceGameForSeek({
    timeControl: correspondenceTimeControl(3),
    first: { userId: ALICE },
    second: { userId: BOB },
  });
  assert.ok(created.ok);
  const room = darkChessTenantRooms.get(created.room.id);
  assert.ok(room);
  let at = Date.now();
  for (const { color, move } of MOVES) {
    at += 1_000;
    const index = appendTenantRuntimeEvent(darkChessTenant, room, {
      type: 'move-played',
      at,
      roomId: room.id,
      color,
      move,
    });
    assert.notEqual(index, -1, `move ${move.from}${move.to} must be legal`);
  }
  return room;
}

// The persistence query, mirrored over the live room: a user's games are the
// rooms where they hold a seat token, keyed to that seat. (The SQL itself is
// covered in persistence-room-deadlines.test.ts, including "a user seated in
// nothing gets an empty list".)
function listFromRoom(room: NonNullable<ReturnType<typeof darkChessTenantRooms.get>>) {
  return async (userId: string): Promise<CorrespondenceGameSummary[]> => {
    const games: CorrespondenceGameSummary[] = [];
    for (const color of darkChessTenant.colors) {
      if (room.seatTokens[color]?.userId !== userId) continue;
      const status = room.projection.state.status;
      games.push({
        roomId: room.id,
        gameSpecId: room.gameSpecId,
        mySeat: color,
        isYourMove: status.type === 'playing' && status.turn === color,
        opponentName: null,
        dueAt: new Date(Date.now() + 86_400_000),
      });
    }
    return games;
  };
}

function seatSnapshotState(
  room: NonNullable<ReturnType<typeof darkChessTenantRooms.get>>,
  seat: Color,
): unknown {
  return tenantSnapshotPayload(darkChessTenant, room, {
    id: room.seatTokens[seat]?.clientId ?? `seat-board:${seat}`,
    seat,
    solo: false,
  }).state;
}

const json = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

test('inbox seat board for seat A is exactly A’s room PlayerView and holds nothing hidden from A', async () => {
  const room = await seatedGameWithMoves();
  try {
    const deps: CorrespondenceGamesDeps = {
      list: listFromRoom(room),
      seatBoard: correspondenceSeatBoard,
    };
    const { games } = await correspondenceGamesForUser(ALICE, deps);
    assert.equal(games.length, 1);
    const payload = games[0]?.seatBoard as PlayerView | undefined;
    assert.ok(payload, 'a seated Fog Chess player gets their own board');

    // Same server code, same seat: byte-for-byte the room snapshot's board.
    assert.deepEqual(json(payload), json(seatSnapshotState(room, 'white')));
    assert.equal(payload.perspective, 'white');

    // No piece on a square White cannot see, other than White's own.
    const visible = new Set<Square>(payload.visibleSquares);
    for (const [square, piece] of Object.entries(payload.board as Board)) {
      if (!piece) continue;
      assert.ok(
        piece.color === 'white' || visible.has(square as Square),
        `${square} (${piece.color} ${piece.role}) is not visible to White`,
      );
    }

    // And the truth really does hide something: Black pieces off White's
    // vision exist on the canonical board and are absent from the payload.
    const truth = room.projection.state.board as Board;
    const hidden = Object.entries(truth).filter(
      ([square, piece]) => piece?.color === 'black' && !visible.has(square as Square),
    );
    assert.ok(hidden.length > 0, 'the position must hide some Black pieces from White');
    for (const [square] of hidden) {
      assert.equal((payload.board as Board)[square as Square], undefined, `${square} leaked`);
    }
    assert.notDeepEqual(json(payload.board), json(truth));
  } finally {
    darkChessTenantRooms.clear();
  }
});

test('inbox seat boards differ per seat: B gets B’s own view, never A’s', async () => {
  const room = await seatedGameWithMoves();
  try {
    const deps: CorrespondenceGamesDeps = {
      list: listFromRoom(room),
      seatBoard: correspondenceSeatBoard,
    };
    const alice = (await correspondenceGamesForUser(ALICE, deps)).games[0]?.seatBoard;
    const bob = (await correspondenceGamesForUser(BOB, deps)).games[0]?.seatBoard as
      | PlayerView
      | undefined;
    assert.ok(bob);
    assert.equal(bob.perspective, 'black');
    assert.deepEqual(json(bob), json(seatSnapshotState(room, 'black')));
    assert.notDeepEqual(json(bob), json(alice));
  } finally {
    darkChessTenantRooms.clear();
  }
});

test('a non-participant gets no game and no board from the inbox', async () => {
  const room = await seatedGameWithMoves();
  try {
    const deps: CorrespondenceGamesDeps = {
      list: listFromRoom(room),
      seatBoard: correspondenceSeatBoard,
    };
    const carol = await correspondenceGamesForUser(CAROL, deps);
    assert.deepEqual(carol, { games: [], yourMoveCount: 0 });

    // Even asked directly, the hook builds nothing for a seat that is not a
    // color (a spectator, a typo).
    for (const seat of ['spectator', 'red', '', 'WHITE']) {
      assert.equal(darkChessSeatBoard(room, seat), null, `seat ${JSON.stringify(seat)}`);
      assert.equal(
        await correspondenceSeatBoard({ roomId: room.id, gameSpecId: 'dark-chess', mySeat: seat }),
        null,
      );
    }
  } finally {
    darkChessTenantRooms.clear();
  }
});

test('the seat board fails closed for unknown rooms, spec mismatches and tenants that do not opt in', async () => {
  const room = await seatedGameWithMoves();
  try {
    // Unknown prefix: no registration, no board.
    assert.equal(
      await correspondenceSeatBoard({
        roomId: 'zzz_nope',
        gameSpecId: 'dark-chess',
        mySeat: 'white',
      }),
      null,
    );
    // The index says another spec than the room's tenant: refuse.
    assert.equal(
      await correspondenceSeatBoard({ roomId: room.id, gameSpecId: 'xiangqi', mySeat: 'white' }),
      null,
    );
    // A dchx_ id with no room behind it: no board (and no throw).
    assert.equal(
      await correspondenceSeatBoard({
        roomId: 'dchx_missing-room',
        gameSpecId: 'dark-chess',
        mySeat: 'white',
      }),
      null,
    );
    // A tenant without the hook (xiangqi rooms keep the public feed's board).
    assert.equal(
      await correspondenceSeatBoard({ roomId: 'xq_any', gameSpecId: 'xiangqi', mySeat: 'red' }),
      null,
    );
  } finally {
    darkChessTenantRooms.clear();
  }
});
