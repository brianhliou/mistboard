/**
 * Hidden-info / wire-safety suite for the Kriegspiel live-room runtime — the
 * leak-safety guard the architecture requires for any payload/replay/observer
 * change to a hidden tenant. Built on the Dark Shogi golden harness, but written
 * as explicit property assertions (no byte-exact fixture): Kriegspiel's redaction
 * is the UMPIRE-ANNOUNCEMENT model, so the invariants — not a recorded blob —
 * are what matter.
 *
 * It constructs a room, seats white + black, plays real moves (white e2e4, a
 * black reply, then a white capture), and asserts:
 *   - the mover's own move-played event carries the full move (from/to) and the
 *     umpire announcement;
 *   - the OPPONENT's move-played event has NO from and NO to — only
 *     move.announcement (capture + check) survives;
 *   - the opponent's player view board contains only their own-color pieces
 *     (zero enemy pieces) and visibleSquares matches the own-piece squares;
 *   - the spectator view is empty (board {}, legalMoves []).
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import type { Color, Move } from '@mistboard/game';
import type {
  KriegspielEvent,
  KriegspielRuntimeRoom,
  KriegspielSeat,
} from './kriegspiel-runtime.js';
import {
  type KriegspielWireMove,
  kriegspielClientEventFor,
  kriegspielTenant,
} from './kriegspiel-tenant.js';
import {
  appendTenantRuntimeEvent,
  createTenantRuntimeRoomFromEvents,
  tenantPlyAtEventIndex,
  tenantSnapshotPayload,
} from './variant-tenant/runtime.js';

const ROOM_ID = 'kr_golden-a';
const SEATS: readonly KriegspielSeat[] = ['black', 'white', 'spectator'];

type WirePlayerView = {
  board: Record<string, { color: string }>;
  visibleSquares: string[];
  legalMoves: unknown[];
  pawnTries?: number;
  lastMove?: unknown;
};

type ClientMovePlayed = {
  type: string;
  color?: Color;
  move?: KriegspielWireMove;
};

function hydrate(): KriegspielRuntimeRoom {
  const timeControl = { initialMs: 180_000, incrementMs: 2_000 };
  const created = createTenantRuntimeRoomFromEvents(kriegspielTenant, [
    {
      type: 'room-created',
      at: 1_000,
      roomId: ROOM_ID,
      gameSpecId: 'kriegspiel',
      creatorPreference: 'white',
      timeControl,
    },
    {
      type: 'clock-started',
      at: 1_000,
      roomId: ROOM_ID,
      clock: {
        activeColor: null,
        incrementMs: timeControl.incrementMs,
        initialMs: timeControl.initialMs,
        remainingMs: { black: timeControl.initialMs, white: timeControl.initialMs },
        runningSince: null,
      },
    },
    { type: 'seat-assigned', at: 2_000, roomId: ROOM_ID, clientId: 'client-white', seat: 'white' },
    { type: 'seat-assigned', at: 3_000, roomId: ROOM_ID, clientId: 'client-black', seat: 'black' },
  ] satisfies KriegspielEvent[]);
  assert.ok(created.ok, 'golden script event log must hydrate');
  return created.room;
}

function playingTurn(room: KriegspielRuntimeRoom): Color {
  const status = room.projection.state.status;
  assert.equal(status.type, 'playing');
  return (status as { turn: Color }).turn;
}

// Stamp the umpire announcement the way the WS layer does (canonicalMove sees
// the before-state), then append the resulting move-played event.
function play(
  room: KriegspielRuntimeRoom,
  at: number,
  color: Color,
  raw: Move,
): { event: KriegspielEvent; seq: number } {
  const canonical = kriegspielTenant.rules.canonicalMove?.(room.projection.state, raw, 'white') ?? raw;
  assert.ok(canonical, `move ${raw.from}->${raw.to} must be legal`);
  const event: KriegspielEvent = {
    type: 'move-played',
    at,
    roomId: ROOM_ID,
    color,
    move: canonical,
  };
  const seq = appendTenantRuntimeEvent(kriegspielTenant, room, event);
  return { event, seq };
}

function snapshotState(room: KriegspielRuntimeRoom, seat: KriegspielSeat): WirePlayerView {
  const payload = tenantSnapshotPayload(kriegspielTenant, room, {
    id: `client-${seat}`,
    seat,
    solo: false,
  });
  return JSON.parse(JSON.stringify(payload.state)) as WirePlayerView;
}

function clientEvent(
  room: KriegspielRuntimeRoom,
  appended: { event: KriegspielEvent; seq: number },
  seat: KriegspielSeat,
): ClientMovePlayed | null {
  const ply = tenantPlyAtEventIndex(room.events, appended.seq);
  const event = kriegspielClientEventFor(appended.event, seat, ply);
  return event ? (JSON.parse(JSON.stringify(event)) as ClientMovePlayed) : null;
}

test('kriegspiel wire: a mover sees their own full move; the opponent only the announcement', () => {
  const room = hydrate();

  // 1. white e2 -> e4 (quiet move). The umpire announcement is silent (no
  //    capture, no check), but the redaction shape must still hold.
  assert.equal(playingTurn(room), 'white');
  const w1 = play(room, 10_000, 'white', { from: 'e2', to: 'e4' });

  const w1ForWhite = clientEvent(room, w1, 'white');
  const w1ForBlack = clientEvent(room, w1, 'black');
  const w1ForSpec = clientEvent(room, w1, 'spectator');

  // Mover: full move survives (from + to present).
  assert.equal(w1ForWhite?.type, 'move-played');
  assert.equal(w1ForWhite?.move?.from, 'e2');
  assert.equal(w1ForWhite?.move?.to, 'e4');

  // Opponent: from/to redacted entirely; only announcement (here, empty) remains.
  assert.equal(w1ForBlack?.type, 'move-played');
  assert.equal(w1ForBlack?.move?.from, undefined, 'black must not learn the from-square');
  assert.equal(w1ForBlack?.move?.to, undefined, 'black must not learn the to-square');

  // Spectator: no move broadcast at all.
  assert.equal(w1ForSpec, null, 'spectator must not see any move broadcast');

  // 2. black d7 -> d5 — sets up a capture for white on the next ply.
  assert.equal(playingTurn(room), 'black');
  const b1 = play(room, 15_000, 'black', { from: 'd7', to: 'd5' });
  assert.equal(clientEvent(room, b1, 'black')?.move?.from, 'd7', 'black sees its own from');
  assert.equal(
    clientEvent(room, b1, 'white')?.move?.from,
    undefined,
    'white must not see black from',
  );
  assert.equal(clientEvent(room, b1, 'white')?.move?.to, undefined, 'white must not see black to');

  // 3. white e4 x d5 — a real capture, so the umpire announcement carries a
  //    capture call that DOES survive redaction (the public part), while the
  //    coordinates still vanish for the opponent.
  assert.equal(playingTurn(room), 'white');
  const w2 = play(room, 20_000, 'white', { from: 'e4', to: 'd5' });

  const w2ForWhite = clientEvent(room, w2, 'white');
  assert.equal(w2ForWhite?.move?.from, 'e4');
  assert.equal(w2ForWhite?.move?.to, 'd5');
  assert.ok(w2ForWhite?.move?.announcement?.capture, 'mover sees the capture announcement');
  assert.equal(w2ForWhite?.move?.announcement?.capture?.square, 'd5');

  const w2ForBlack = clientEvent(room, w2, 'black');
  assert.equal(w2ForBlack?.move?.from, undefined, 'capture: black still must not see from');
  assert.equal(w2ForBlack?.move?.to, undefined, 'capture: black still must not see to');
  // The public umpire announcement (capture square + kind) survives.
  assert.ok(w2ForBlack?.move?.announcement?.capture, 'black hears the capture announcement');
  assert.equal(w2ForBlack?.move?.announcement?.capture?.square, 'd5');
  // Nothing beyond the announcement leaks: the redacted move has ONLY the
  // announcement key.
  assert.deepEqual(
    Object.keys(w2ForBlack?.move ?? {}),
    ['announcement'],
    'redacted opponent move carries only the announcement',
  );
});

test('kriegspiel wire: a seat sees only its own pieces, never an enemy square', () => {
  const room = hydrate();
  play(room, 10_000, 'white', { from: 'e2', to: 'e4' });
  play(room, 15_000, 'black', { from: 'd7', to: 'd5' });
  play(room, 20_000, 'white', { from: 'e4', to: 'd5' });

  for (const seat of ['white', 'black'] as const) {
    const view = snapshotState(room, seat);
    const enemy = Object.entries(view.board).filter(([, piece]) => piece.color !== seat);
    assert.deepEqual(enemy, [], `${seat} must see zero enemy pieces`);

    // visibleSquares is exactly the set of own-piece squares (own pieces only).
    const ownSquares = new Set(Object.keys(view.board));
    const visible = new Set(view.visibleSquares);
    assert.deepEqual(
      [...visible].sort(),
      [...ownSquares].sort(),
      `${seat} visibleSquares must match its own-piece squares`,
    );

    // The view never carries an enemy from/to via lastMove (the opponent's
    // lastMove is stripped unless this seat moved last).
    if (playingTurn(room) === seat) {
      // It is this seat's turn → the opponent moved last → lastMove stripped.
      assert.equal(view.lastMove, undefined, `${seat} must not see the opponent's lastMove`);
    }
  }
});

test('kriegspiel wire: the spectator view is empty', () => {
  const room = hydrate();
  play(room, 10_000, 'white', { from: 'e2', to: 'e4' });
  play(room, 15_000, 'black', { from: 'd7', to: 'd5' });

  const spectator = snapshotState(room, 'spectator');
  assert.deepEqual(spectator.board, {});
  assert.deepEqual(spectator.legalMoves, []);
  assert.deepEqual(spectator.visibleSquares, []);
  assert.equal(spectator.lastMove, undefined);

  // And no move event ever reaches a spectator snapshot.
  const payload = tenantSnapshotPayload(kriegspielTenant, room, {
    id: 'client-spectator',
    seat: 'spectator',
    solo: false,
  });
  for (const event of payload.events as Array<{ type: string }>) {
    assert.notEqual(
      event.type,
      'move-played',
      'spectator snapshot must carry no move-played event',
    );
  }
});

// A drift guard on the snapshot event stream. Kriegspiel's redaction model is
// the umpire announcement, NOT suppression: a foreign move-played DOES appear
// in a seat's stream (the opponent must learn a move happened), but with the
// coordinates stripped — only move.announcement survives. The leak-safe
// invariant is therefore "any foreign move in my stream carries no from/to",
// and spectators get no move-played at all.
test('kriegspiel wire: a foreign move in a seat stream is coordinate-redacted', () => {
  const room = hydrate();
  play(room, 10_000, 'white', { from: 'e2', to: 'e4' });
  play(room, 15_000, 'black', { from: 'd7', to: 'd5' });
  play(room, 20_000, 'white', { from: 'e4', to: 'd5' });

  for (const seat of SEATS) {
    const payload = tenantSnapshotPayload(kriegspielTenant, room, {
      id: `client-${seat}`,
      seat,
      solo: false,
    });
    for (const event of payload.events as ClientMovePlayed[]) {
      if (event.type !== 'move-played') continue;
      if (event.color === seat) {
        // The seat's own move keeps full coordinates.
        assert.ok(event.move?.from !== undefined, `${seat} must keep its own from-square`);
        assert.ok(event.move?.to !== undefined, `${seat} must keep its own to-square`);
      } else {
        // A foreign move is coordinate-redacted: no from, no to ever.
        assert.equal(event.move?.from, undefined, `${seat} must not see a foreign from-square`);
        assert.equal(event.move?.to, undefined, `${seat} must not see a foreign to-square`);
      }
    }
    // Spectators get no move-played in their stream at all.
    if (seat === 'spectator') {
      for (const event of payload.events as ClientMovePlayed[]) {
        assert.notEqual(event.type, 'move-played');
      }
    }
  }
});
