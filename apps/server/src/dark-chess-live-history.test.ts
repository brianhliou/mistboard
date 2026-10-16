/**
 * Hidden-info regression for a live Fog Chess seat's per-ply history: the
 * views its hello frame carries (dark-chess-live-history.ts, sent by
 * server-ws-connection.ts) so that, after a reload, it can step back through a
 * live game its fog-filtered event log cannot rebuild.
 *
 * Pins, against the real kernel and the real payload builders (no socket):
 *   a. each ply's view is exactly the seat's own fog view of that ply
 *      (variant.getPlayerView, legal moves aside), the tip its live snapshot;
 *   b. no ply shows an opponent piece off the seat's visible squares;
 *   c. eventsLen never decreases, steps only on the seat's own moves, and
 *      points at that move in the seat's own filtered log;
 *   d. spectators, solo sandboxes, finished rooms and other variants get {}.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  type Color,
  type GameEvent,
  type Move,
  replayGameEvents,
  variantForId,
} from '@mistboard/game';
import { darkChessLiveHistoryExtras } from './dark-chess-live-history.js';
import { type SnapshotClient, type SnapshotRoom, snapshotPayload } from './payloads.js';

const ROOM_ID = 'dark-live-history';
const PLIES = 24;

function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function header(variant: 'dark-chess' | 'chess'): GameEvent[] {
  return [
    {
      type: 'room-created',
      at: 1_000,
      roomId: ROOM_ID,
      variant,
      gameSpecId: variant,
      region: 'global',
    },
    { type: 'seat-assigned', at: 2_000, roomId: ROOM_ID, clientId: 'client-white', seat: 'white' },
    { type: 'seat-assigned', at: 3_000, roomId: ROOM_ID, clientId: 'client-black', seat: 'black' },
  ] as GameEvent[];
}

// Seeded play through the kernel, captures preferred so the fog opens and
// closes; stops while the game is still live.
function playedEvents(variantId: 'dark-chess' | 'chess', plies = PLIES): GameEvent[] {
  const rng = seeded(11);
  const events = header(variantId);
  const variant = variantForId(variantId);
  for (let i = 0; i < plies; i += 1) {
    const state = replayGameEvents(events).state;
    if (state.status.type !== 'playing') break;
    const turn = (state.status as { turn: Color }).turn;
    const legal: Move[] = [...variant.getLegalMoves(state, turn)];
    const takes = legal.filter((move) => state.board[move.to]);
    const pool = takes.length > 0 && rng() < 0.6 ? takes : legal;
    const move = pool[Math.floor(rng() * pool.length)]!;
    const next = [
      ...events,
      { type: 'move-played', at: 10_000 + i * 1_000, roomId: ROOM_ID, color: turn, move },
    ] as GameEvent[];
    // Keep the room live: a move that ends the game is not played.
    if (replayGameEvents(next).state.status.type !== 'playing') break;
    events.splice(0, events.length, ...next);
  }
  return events;
}

function room(events: GameEvent[]): SnapshotRoom {
  return {
    id: ROOM_ID,
    clients: {
      size: 2,
      [Symbol.iterator]: () =>
        [
          { seat: 'white' as const, displaced: false },
          { seat: 'black' as const, displaced: false },
        ][Symbol.iterator](),
    },
    events,
    projection: replayGameEvents(events),
    rated: false,
    region: 'global',
    rematch: { offers: {} },
  };
}

function client(seat: SnapshotClient['seat'], solo = false): SnapshotClient {
  return { devViews: false, id: `client-${seat}`, seat, solo };
}

const EVENTS = playedEvents('dark-chess');
const MOVES = EVENTS.filter((event) => event.type === 'move-played') as Extract<
  GameEvent,
  { type: 'move-played' }
>[];

test('dark chess live history: the scripted game is long and live', () => {
  assert.ok(MOVES.length >= 16, `only ${MOVES.length} plies`);
  assert.equal(room(EVENTS).projection.state.status.type, 'playing');
});

for (const seat of ['white', 'black'] as const) {
  test(`dark chess live history: ${seat} gets its own fog view at every ply, nothing more`, () => {
    const live = room(EVENTS);
    const extras = darkChessLiveHistoryExtras(live, client(seat));
    // As it crosses the wire.
    const history = JSON.parse(JSON.stringify(extras.liveHistory ?? null)) as Array<{
      ply: number;
      view: {
        board: Record<string, { color: string }>;
        visibleSquares: string[];
        legalMoves: unknown[];
        perspective: string;
      };
      eventsLen: number;
    }> | null;
    assert.ok(history, `${seat} got no history`);
    assert.equal(history.length, MOVES.length + 1);
    assert.deepEqual(
      history.map((entry) => entry.ply),
      history.map((_, index) => index),
    );

    const variant = variantForId('dark-chess');
    const snapshot = JSON.parse(JSON.stringify(snapshotPayload(live, client(seat)))) as {
      state: unknown;
      events: GameEvent[];
    };
    let previousEventsLen = 0;
    for (const { ply, view, eventsLen } of history) {
      const where = `${seat} ply ${ply}`;
      // (a) exactly this seat's fog view of the position after `ply` moves.
      const cut = EVENTS.slice(0, ply === 0 ? 3 : EVENTS.indexOf(MOVES[ply - 1]!) + 1);
      const expected = variant.getPlayerView(replayGameEvents(cut).state, seat);
      assert.deepStrictEqual(view, JSON.parse(JSON.stringify({ ...expected, legalMoves: [] })));
      assert.equal(view.perspective, seat, where);
      assert.deepStrictEqual(view.legalMoves, [], where);
      // (b) no opponent piece off the seat's visible squares.
      const visible = new Set(view.visibleSquares);
      for (const [square, piece] of Object.entries(view.board)) {
        if (piece.color === seat) continue;
        assert.ok(visible.has(square), `${where}: hidden opponent piece on ${square}`);
      }
      // (c) eventsLen steps only on the seat's own moves, onto that move.
      assert.ok(eventsLen >= previousEventsLen, `${where}: eventsLen went backwards`);
      assert.ok(eventsLen <= snapshot.events.length, `${where}: eventsLen past the log`);
      if (ply > 0) {
        const mover = MOVES[ply - 1]!.color;
        if (mover === seat) {
          assert.equal(eventsLen, previousEventsLen + 1, `${where}: own move not counted`);
          const event = snapshot.events[eventsLen - 1] as { type: string; color?: string };
          assert.equal(event.type, 'move-played', where);
          assert.equal(event.color, seat, where);
        } else {
          assert.equal(eventsLen, previousEventsLen, `${where}: counted a move it never got`);
        }
      }
      previousEventsLen = eventsLen;
    }
    // The tip is the live snapshot view itself (legal moves aside).
    assert.deepStrictEqual(history.at(-1)!.view, {
      ...(snapshot.state as object),
      legalMoves: [],
    });
    // The opponent's view never appears: the two seats' histories differ.
    const other = darkChessLiveHistoryExtras(live, client(seat === 'white' ? 'black' : 'white'));
    assert.notDeepStrictEqual(
      history.map((entry) => entry.view.board),
      JSON.parse(JSON.stringify(other.liveHistory!.map((entry) => entry.view.board))),
    );
  });
}

test('dark chess live history: spectators, sandboxes, finished rooms and other variants get none', () => {
  const live = room(EVENTS);
  assert.deepEqual(darkChessLiveHistoryExtras(live, client('spectator')), {});
  assert.deepEqual(darkChessLiveHistoryExtras(live, client('white', true)), {});

  const resigned = room([
    ...EVENTS,
    { type: 'seat-resigned', at: 99_000, roomId: ROOM_ID, color: 'white' } as GameEvent,
  ]);
  assert.equal(resigned.projection.state.status.type, 'finished');
  for (const seat of ['white', 'black', 'spectator'] as const) {
    assert.deepEqual(darkChessLiveHistoryExtras(resigned, client(seat)), {}, seat);
  }

  const chess = room(playedEvents('chess', 6));
  assert.equal(chess.projection.state.status.type, 'playing');
  assert.deepEqual(darkChessLiveHistoryExtras(chess, client('white')), {});

  const unstarted = room(header('dark-chess'));
  for (const seat of ['white', 'black'] as const) {
    assert.deepEqual(darkChessLiveHistoryExtras(unstarted, client(seat)), {}, seat);
  }
});
