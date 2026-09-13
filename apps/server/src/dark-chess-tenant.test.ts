/**
 * Dark-chess tenant parity proof.
 *
 * The tenant module's claim is equivalence with the live stack on the surfaces
 * it packages: projection replay (vs @mistboard/game replayGameEvents, the
 * live reducer) and Model A redaction (vs payloads.ts). Replay parity is
 * checked per event-log PREFIX so a divergence pinpoints the first event that
 * disagrees, across clock arithmetic (arming on the second mover's first move,
 * increment application, freeze-on-terminal), seat assignment/vacation, and
 * every terminal transition. Chess-only event types (pause) must fail
 * CLOSED: the tenant rejects those logs rather than replaying them wrong.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  type Color,
  createClock,
  expireClock,
  type GameEvent,
  type GameState,
  type Move,
  type RoomTimeControl,
  replayGameEvents,
  variantForId,
} from '@mistboard/game';
import {
  type DarkChessTenantEvent,
  type DarkChessTenantState,
  darkChessTenant,
} from './dark-chess-tenant.js';
import {
  createTenantRuntimeRoomFromEvents,
  isTenantEventLog,
  replayTenantEvents,
  tenantEventsForClient,
} from './variant-tenant/runtime.js';

const darkChess = variantForId('dark-chess');
const T0 = 1_750_000_000_000;
const TIME_CONTROL: RoomTimeControl = { initialMs: 180_000, incrementMs: 2_000 };

function at(step: number): number {
  return T0 + step * 1_000;
}

type RoomCreatedOptions = {
  rated?: boolean;
  timeControl?: RoomTimeControl;
};

function roomCreated(roomId: string, options: RoomCreatedOptions = {}): GameEvent {
  return {
    type: 'room-created',
    at: at(0),
    roomId,
    variant: 'dark-chess',
    gameSpecId: 'dark-chess',
    region: 'global',
    ...(options.timeControl ? { timeControl: options.timeControl } : {}),
    ...(options.rated ? { rated: true } : {}),
  };
}

function moveKey(move: Move): string {
  return `${move.from}${move.to}${move.promotion ?? ''}`;
}

function firstLegalMove(state: GameState): Move {
  const status = state.status;
  assert.equal(status.type, 'playing');
  if (status.type !== 'playing') throw new Error('unreachable');
  const moves = [...darkChess.getLegalMoves(state, status.turn)];
  moves.sort((a, b) => moveKey(a).localeCompare(moveKey(b)));
  const move = moves[0];
  assert.ok(move, 'expected at least one legal move');
  return move;
}

// Deterministic script builder: room + clock + seats, then `moveCount`
// lexicographically-first legal moves (no clock field on move events, so BOTH
// reducers exercise their computed-clock path), then an optional terminal.
function buildScript(
  roomId: string,
  options: RoomCreatedOptions & {
    moveCount: number;
    seats?: Partial<Record<Color, string>>;
    withClockStarted?: boolean;
    terminal?: 'resign' | 'expire' | 'forfeit' | 'abort' | null;
  },
): GameEvent[] {
  const events: GameEvent[] = [roomCreated(roomId, options)];
  let step = 1;
  if (options.withClockStarted ?? options.timeControl !== undefined) {
    const timeControl = options.timeControl ?? TIME_CONTROL;
    events.push({
      type: 'clock-started',
      at: at(step),
      roomId,
      clock: createClock(at(step), timeControl.initialMs, timeControl.incrementMs),
    });
    step += 1;
  }
  const seats = options.seats ?? { white: 'client-white', black: 'client-black' };
  for (const color of ['white', 'black'] as const) {
    const clientId = seats[color];
    if (!clientId) continue;
    events.push({ type: 'seat-assigned', at: at(step), roomId, clientId, seat: color });
    step += 1;
  }
  for (let index = 0; index < options.moveCount; index += 1) {
    const projection = replayGameEvents(events);
    const status = projection.state.status;
    assert.equal(status.type, 'playing');
    if (status.type !== 'playing') throw new Error('unreachable');
    events.push({
      type: 'move-played',
      at: at(step),
      roomId,
      color: status.turn,
      move: firstLegalMove(projection.state),
    });
    step += 1;
  }
  const terminal = options.terminal ?? null;
  if (terminal) {
    const projection = replayGameEvents(events);
    const status = projection.state.status;
    assert.equal(status.type, 'playing');
    if (status.type !== 'playing') throw new Error('unreachable');
    if (terminal === 'resign') {
      events.push({ type: 'seat-resigned', at: at(step), roomId, color: status.turn });
    } else if (terminal === 'forfeit') {
      events.push({ type: 'seat-forfeited', at: at(step), roomId, color: status.turn });
    } else if (terminal === 'abort') {
      events.push({ type: 'game-aborted', at: at(step), roomId, reason: 'user-abort' });
    } else {
      const expired = expireClock(projection.state.clock, at(step), status.turn);
      assert.ok(expired, 'expiry script requires an armed clock');
      events.push({
        type: 'clock-expired',
        at: at(step),
        roomId,
        color: status.turn,
        clock: expired,
      });
    }
  }
  return events;
}

function asTenantEvents(events: GameEvent[]): DarkChessTenantEvent[] {
  // The scripts contain only the shared event union; the chess-only extras on
  // room-created (variant/region/offer) are tolerated by tenant validation.
  return events as unknown as DarkChessTenantEvent[];
}

function assertReplayParity(events: GameEvent[]): void {
  assert.equal(isTenantEventLog(darkChessTenant, events), true, 'tenant must accept the log');
  for (let length = 1; length <= events.length; length += 1) {
    const prefix = events.slice(0, length);
    const chessProjection = replayGameEvents(prefix);
    const tenantProjection = replayTenantEvents(darkChessTenant, asTenantEvents(prefix));
    const { clock: chessClock, ...chessState } = chessProjection.state;
    const { clock: tenantStateClock, ...tenantState } = tenantProjection.state;
    const context = `event ${length - 1} (${prefix[length - 1]?.type})`;
    // The tenant keeps the clock on the projection, never folded into state.
    assert.equal(tenantStateClock, undefined, `${context}: tenant state.clock must stay unset`);
    assert.deepEqual(tenantState, chessState, `${context}: state diverged`);
    assert.deepEqual(tenantProjection.clock, chessClock, `${context}: clock diverged`);
    assert.deepEqual(tenantProjection.seats, chessProjection.seats, `${context}: seats diverged`);
    assert.deepEqual(tenantProjection.timeControl, chessProjection.timeControl, context);
    assert.equal(tenantProjection.gameSpecId, chessProjection.gameSpecId, context);
  }
}

test('replay parity: timed PvP through resignation', () => {
  assertReplayParity(
    buildScript('parity-resign', { timeControl: TIME_CONTROL, moveCount: 6, terminal: 'resign' }),
  );
});

test('replay parity: timed PvP through clock expiry', () => {
  assertReplayParity(
    buildScript('parity-expiry', { timeControl: TIME_CONTROL, moveCount: 3, terminal: 'expire' }),
  );
});

test('replay parity: timed PvP through leaver forfeit', () => {
  assertReplayParity(
    buildScript('parity-forfeit', { timeControl: TIME_CONTROL, moveCount: 4, terminal: 'forfeit' }),
  );
});

test('replay parity: pregame abort at move 1', () => {
  assertReplayParity(
    buildScript('parity-abort', { timeControl: TIME_CONTROL, moveCount: 0, terminal: 'abort' }),
  );
});

test('replay parity: untimed room (no clock-started, computed clocks stay unset)', () => {
  assertReplayParity(buildScript('parity-untimed', { moveCount: 4 }));
});

test('replay parity: PvE seating (engine client id on a seat)', () => {
  assertReplayParity(
    buildScript('parity-pve', {
      timeControl: TIME_CONTROL,
      moveCount: 4,
      seats: { white: 'client-human', black: 'python-v2-v1.0' },
      terminal: 'resign',
    }),
  );
});

test('replay parity: pre-first-move seat-vacated clears the seat in both reducers', () => {
  const roomId = 'parity-vacate';
  const events: GameEvent[] = [
    roomCreated(roomId, { timeControl: TIME_CONTROL }),
    {
      type: 'clock-started',
      at: at(1),
      roomId,
      clock: createClock(at(1), TIME_CONTROL.initialMs, TIME_CONTROL.incrementMs),
    },
    { type: 'seat-assigned', at: at(2), roomId, clientId: 'leaver', seat: 'white' },
    { type: 'seat-vacated', at: at(3), roomId, clientId: 'leaver', seat: 'white' },
    { type: 'seat-assigned', at: at(4), roomId, clientId: 'returner', seat: 'white' },
    { type: 'seat-assigned', at: at(5), roomId, clientId: 'client-black', seat: 'black' },
  ];
  assertReplayParity(events);
  const projection = replayTenantEvents(darkChessTenant, asTenantEvents(events));
  assert.equal(projection.seats.white, 'returner');
});

test('rated flag flows from room-created into the tenant projection', () => {
  const events = buildScript('parity-rated', {
    timeControl: TIME_CONTROL,
    rated: true,
    moveCount: 2,
  });
  const projection = replayTenantEvents(darkChessTenant, asTenantEvents(events));
  assert.equal(projection.rated, true);
});

// ── Fail-closed: chess-only event families never replay through the tenant ──

test('pause/resume logs fail closed', () => {
  const events = buildScript('reject-pause', { timeControl: TIME_CONTROL, moveCount: 2 });
  events.push({ type: 'pause', at: at(20), roomId: 'reject-pause', reason: 'shutdown' });
  assert.equal(isTenantEventLog(darkChessTenant, events), false);
});

// ── Model A redaction on the tenant surface ─────────────────────────────────

function hydratedRoom(events: GameEvent[]) {
  const hydration = createTenantRuntimeRoomFromEvents(darkChessTenant, asTenantEvents(events));
  assert.equal(hydration.ok, true);
  if (!hydration.ok) throw new Error('unreachable');
  return hydration.room;
}

test('fog events, live: each seat sees exactly its own moves, with global plies', () => {
  // terminal: null keeps the room PLAYING; a finished room reveals everything
  // (spectator-visibility-matrix.md), which the next test pins.
  const events = buildScript('fog-events', {
    timeControl: TIME_CONTROL,
    moveCount: 6,
    terminal: null,
  });
  const room = hydratedRoom(events);
  const expectedPlies: Record<Color, number[]> = { white: [1, 3, 5], black: [2, 4, 6] };
  for (const seat of ['white', 'black'] as const) {
    const visible = tenantEventsForClient(darkChessTenant, room, { id: 'x', seat, solo: false });
    const moves = visible.filter((event) => event.type === 'move-played');
    assert.deepEqual(
      moves.map((event) => event.color),
      expectedPlies[seat].map(() => seat),
    );
    assert.deepEqual(
      moves.map((event) => event.ply),
      expectedPlies[seat],
    );
  }
});

test('fog events, finished: every seat and the spectator get the whole log', () => {
  // The event half of the finished-game reveal. Before the tenant declared a
  // truthView, the board opened at finish (getClientView reads the real
  // status) while the log stayed filtered against a slice whose status is the
  // initial 'playing': a truth board beside an own-moves-only move list.
  const events = buildScript('fog-events-finished', {
    timeControl: TIME_CONTROL,
    moveCount: 6,
    terminal: 'resign',
  });
  const room = hydratedRoom(events);
  for (const seat of ['white', 'black', 'spectator'] as const) {
    const visible = tenantEventsForClient(darkChessTenant, room, { id: 'x', seat, solo: false });
    const moves = visible.filter((event) => event.type === 'move-played');
    assert.deepEqual(
      moves.map((event) => event.ply),
      [1, 2, 3, 4, 5, 6],
      `${seat} sees every ply once the game is over`,
    );
    assert.ok(!visible.some((event) => event.type === 'room-created' && 'setup' in event));
  }
});

test('fog events, live: spectators get no moves but do keep room/seat events (live-stack parity)', () => {
  const events = buildScript('fog-spectator', {
    timeControl: TIME_CONTROL,
    moveCount: 4,
    terminal: null,
  });
  const room = hydratedRoom(events);
  const visible = tenantEventsForClient(darkChessTenant, room, {
    id: 'x',
    seat: 'spectator',
    solo: false,
  });
  assert.equal(visible.filter((event) => event.type === 'move-played').length, 0);
  assert.equal(visible.filter((event) => event.type === 'seat-assigned').length, 2);
});

test('fog views: hidden opponent pieces stay hidden while the game is live', () => {
  // terminal: null keeps the room PLAYING. This is the live fog invariant and
  // it must never change; the finished counterpart is the next test.
  const events = buildScript('fog-views', {
    timeControl: TIME_CONTROL,
    moveCount: 4,
    terminal: null,
  });
  const room = hydratedRoom(events);
  const canonicalBoard = room.projection.state.board;
  const canonicalSquares = Object.keys(canonicalBoard);
  assert.notEqual(room.projection.state.status.type, 'finished');
  for (const seat of ['white', 'black'] as const) {
    const view = darkChessTenant.visibility.viewForClient(
      room.projection.state,
      { id: 'x', seat, solo: false },
      room.events,
    );
    assert.equal(view.perspective, seat);
    const visibleSet = new Set<string>(view.visibleSquares);
    for (const square of Object.keys(view.board)) {
      assert.ok(visibleSet.has(square), `${seat} view leaked ${square} outside its vision`);
    }
    for (const square of canonicalSquares) {
      const piece = canonicalBoard[square as keyof typeof canonicalBoard];
      if (piece?.color === seat) {
        assert.ok(square in view.board, `${seat} view lost own piece on ${square}`);
      }
    }
    assert.ok(
      Object.keys(view.board).length < canonicalSquares.length,
      `${seat} view revealed the full board mid-game (fog violation)`,
    );
  }
  const spectator = darkChessTenant.visibility.viewForClient(
    room.projection.state,
    { id: 'x', seat: 'spectator', solo: false },
    room.events,
  );
  assert.deepEqual(spectator.board, {});
  assert.deepEqual(spectator.visibleSquares, []);
  assert.deepEqual(spectator.legalMoves, []);
});

test('fog views: a finished room reveals the whole board to every seat', () => {
  // The finished half of the same matrix row. /game/:id already serves this to
  // any signed-out stranger; before this the room was the one surface refusing.
  const events = buildScript('fog-views-finished', {
    timeControl: TIME_CONTROL,
    moveCount: 4,
    terminal: 'resign',
  });
  const room = hydratedRoom(events);
  const canonicalSquares = Object.keys(room.projection.state.board);
  assert.equal(room.projection.state.status.type, 'finished');
  for (const seat of ['white', 'black', 'spectator'] as const) {
    const view = darkChessTenant.visibility.viewForClient(
      room.projection.state,
      { id: 'x', seat, solo: false },
      room.events,
    );
    assert.equal(
      Object.keys(view.board).length,
      canonicalSquares.length,
      `${seat} must see the whole board once the game is finished`,
    );
    assert.equal(
      view.visibleSquares.length,
      64,
      `${seat} must see every square once the game is finished`,
    );
  }
});

// ── Inbound-move handling mirrors the live stack ────────────────────────────

test('moveFromMessage mirrors live parsing: invalid promotion drops, bad squares reject', () => {
  assert.deepEqual(darkChessTenant.rules.moveFromMessage({ from: 'e2', to: 'e4' }), {
    from: 'e2',
    to: 'e4',
    promotion: undefined,
  });
  assert.deepEqual(
    darkChessTenant.rules.moveFromMessage({ from: 'e7', to: 'e8', promotion: 'queen' }),
    { from: 'e7', to: 'e8', promotion: 'queen' },
  );
  // The live stack drops an invalid promotion role instead of rejecting.
  assert.deepEqual(
    darkChessTenant.rules.moveFromMessage({ from: 'e2', to: 'e4', promotion: 'king' }),
    { from: 'e2', to: 'e4', promotion: undefined },
  );
  assert.equal(darkChessTenant.rules.moveFromMessage({ from: 'e9', to: 'e4' }), null);
  assert.equal(darkChessTenant.rules.moveFromMessage({ from: 'e2', to: 'i4' }), null);
  assert.equal(darkChessTenant.rules.moveFromMessage({}), null);
});

test('canonicalMove: legality is applyMove identity; appended move is the applied lastMove', () => {
  const state = darkChessTenant.rules.createInitialState('canonical-move');
  const legal = darkChessTenant.rules.canonicalMove?.(state, { from: 'e2', to: 'e4' }, 'white');
  assert.ok(legal);
  const applied = darkChess.applyMove(state as GameState, { from: 'e2', to: 'e4' });
  assert.deepEqual(legal, applied.lastMove ?? { from: 'e2', to: 'e4' });
  assert.equal(
    darkChessTenant.rules.canonicalMove?.(state, { from: 'e2', to: 'e5' }, 'white'),
    null,
    'an illegal move must reject',
  );
  assert.equal(darkChessTenant.rules.isLegalMove(state, { from: 'e2', to: 'e4' }), true);
  assert.equal(darkChessTenant.rules.isLegalMove(state, { from: 'e2', to: 'e5' }), false);
});

test('terminal constructors mirror the live reducer shapes', () => {
  const state = darkChessTenant.rules.createInitialState('terminal-shapes');
  const finished = darkChessTenant.rules.finish(state, 'white', 'timeout');
  assert.deepEqual(finished.status, { type: 'finished', winner: 'white', reason: 'timeout' });
  const aborted = darkChessTenant.rules.abort(state, 'user-abort');
  assert.deepEqual(aborted.status, { type: 'aborted', reason: 'user-abort' });
});

test('persistence identity rejects unknown termination reasons', () => {
  assert.equal(darkChessTenant.persistence.termination('timeout'), 'timeout');
  assert.throws(() => darkChessTenant.persistence.termination('rage-quit'));
  assert.equal(darkChessTenant.persistence.resultForWinner('white'), 'white-wins');
  assert.equal(darkChessTenant.persistence.resultForWinner('black'), 'black-wins');
  assert.equal(darkChessTenant.persistence.resultForWinner(null), 'draw');
});

// Keep the narrowed-state import meaningful: the tenant state type must never
// regain the pregame arm (the contract the casts in dark-chess-tenant.ts rely
// on).
test('tenant state type excludes pregame', () => {
  const state: DarkChessTenantState = darkChessTenant.rules.createInitialState('type-pin');
  assert.notEqual(state.status.type, 'pregame');
});
