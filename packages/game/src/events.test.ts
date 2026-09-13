import assert from 'node:assert/strict';
import test from 'node:test';
import { advanceClock, createClock, expireClock } from './clocks.js';
import { type GameEvent, replayGameEvents } from './events.js';
import { DARK_CHESS_SPEC_ID } from './game-specs.js';
import { correspondenceTimeControl, DAY_MS } from './time-controls.js';
import type { ClockState } from './types.js';

// A clock already armed and ticking for white — the post-first-moves state that
// pause/expire/advance mechanics operate on. createClock now starts frozen
// (no ticking until both players complete their first move), so tests that
// exercise mid-game clock behavior inject an armed clock directly.
function armedClock(at: number, initialMs?: number, incrementMs?: number): ClockState {
  return { ...createClock(at, initialMs, incrementMs), activeColor: 'white', runningSince: at };
}

test('replays move events through the standard chess rules adapter', () => {
  const events: GameEvent[] = [
    {
      type: 'room-created',
      at: 1,
      roomId: 'move-room',
      variant: 'chess',
    },
    {
      type: 'move-played',
      at: 5,
      roomId: 'move-room',
      color: 'white',
      move: { from: 'e2', to: 'e4' },
    },
  ];

  const projection = replayGameEvents(events);

  assert.equal(projection.state.board.e2, undefined);
  assert.deepEqual(projection.state.board.e4, { color: 'white', role: 'pawn' });
  assert.deepEqual(projection.state.status, { type: 'playing', turn: 'black' });
  assert.deepEqual(projection.state.lastMove, { from: 'e2', to: 'e4' });
});

test('vacates Fog of War seats before the first move', () => {
  const events: GameEvent[] = [
    {
      type: 'room-created',
      at: 1,
      roomId: 'fresh-fog-room',
      variant: 'dark-chess',
    },
    {
      type: 'seat-assigned',
      at: 2,
      roomId: 'fresh-fog-room',
      clientId: 'white-client',
      seat: 'white',
    },
    {
      type: 'seat-vacated',
      at: 3,
      roomId: 'fresh-fog-room',
      clientId: 'white-client',
      seat: 'white',
    },
  ];

  const projection = replayGameEvents(events);

  assert.deepEqual(projection.seats, {});
});

test('keeps Fog of War seats after play starts', () => {
  const events: GameEvent[] = [
    {
      type: 'room-created',
      at: 1,
      roomId: 'active-fog-room',
      variant: 'dark-chess',
    },
    {
      type: 'seat-assigned',
      at: 2,
      roomId: 'active-fog-room',
      clientId: 'white-client',
      seat: 'white',
    },
    {
      type: 'move-played',
      at: 3,
      roomId: 'active-fog-room',
      color: 'white',
      move: { from: 'e2', to: 'e4' },
    },
    {
      type: 'seat-vacated',
      at: 4,
      roomId: 'active-fog-room',
      clientId: 'white-client',
      seat: 'white',
    },
  ];

  const projection = replayGameEvents(events);

  assert.deepEqual(projection.seats, { white: 'white-client' });
});

test('starts a frozen Fog of War clock after seats are ready (arms after both first moves)', () => {
  const clock = createClock(4, 30_000, 2_000);
  const baseEvents: GameEvent[] = [
    {
      type: 'room-created',
      at: 1,
      roomId: 'clocked-fog-room',
      variant: 'dark-chess',
    },
    {
      type: 'seat-assigned',
      at: 2,
      roomId: 'clocked-fog-room',
      clientId: 'white-client',
      seat: 'white',
    },
    {
      type: 'seat-assigned',
      at: 3,
      roomId: 'clocked-fog-room',
      clientId: 'black-client',
      seat: 'black',
    },
    {
      type: 'clock-started',
      at: 4,
      roomId: 'clocked-fog-room',
      clock,
    },
  ];

  // Frozen at start: neither side ticks before move 1.
  const atStart = replayGameEvents(baseEvents);
  assert.equal(atStart.state.clock?.initialMs, 30_000);
  assert.equal(atStart.state.clock?.incrementMs, 2_000);
  assert.equal(atStart.state.clock?.activeColor, null);
  assert.equal(atStart.state.clock?.runningSince, null);

  // White's first move spends no time but is granted the increment; still frozen.
  const afterWhite = replayGameEvents([
    ...baseEvents,
    {
      type: 'move-played',
      at: 10_000,
      roomId: 'clocked-fog-room',
      color: 'white',
      move: { from: 'e2', to: 'e4' },
    },
  ]);
  assert.equal(afterWhite.state.clock?.activeColor, null);
  assert.equal(afterWhite.state.clock?.runningSince, null);
  assert.equal(afterWhite.state.clock?.remainingMs.white, 32_000);
  assert.equal(afterWhite.state.clock?.remainingMs.black, 30_000);

  // Black's first move arms the clock: white (next to move) begins ticking.
  const afterBlack = replayGameEvents([
    ...baseEvents,
    {
      type: 'move-played',
      at: 10_000,
      roomId: 'clocked-fog-room',
      color: 'white',
      move: { from: 'e2', to: 'e4' },
    },
    {
      type: 'move-played',
      at: 20_000,
      roomId: 'clocked-fog-room',
      color: 'black',
      move: { from: 'e7', to: 'e5' },
    },
  ]);
  assert.equal(afterBlack.state.clock?.activeColor, 'white');
  assert.equal(afterBlack.state.clock?.runningSince, 20_000);
  assert.equal(afterBlack.state.clock?.remainingMs.white, 32_000);
  assert.equal(afterBlack.state.clock?.remainingMs.black, 32_000);
});

test('replays room-created time control metadata', () => {
  const events: GameEvent[] = [
    {
      type: 'room-created',
      at: 1,
      roomId: 'custom-clock-room',
      variant: 'dark-chess',
      timeControl: {
        initialMs: 180_000,
        incrementMs: 2_000,
      },
    },
  ];

  const projection = replayGameEvents(events);

  assert.deepEqual(projection.timeControl, {
    initialMs: 180_000,
    incrementMs: 2_000,
  });
});

test('replays room-created game spec metadata', () => {
  const projection = replayGameEvents([
    {
      type: 'room-created',
      at: 1,
      roomId: 'spec-room',
      variant: 'dark-chess',
      gameSpecId: DARK_CHESS_SPEC_ID,
    },
  ]);

  assert.equal(projection.gameSpecId, DARK_CHESS_SPEC_ID);
});

test('replays room-created region metadata', () => {
  const projection = replayGameEvents([
    {
      type: 'room-created',
      at: 1,
      roomId: 'regional-room',
      variant: 'dark-chess',
      region: 'asia',
    },
  ]);

  assert.equal(projection.region, 'asia');
});

test('replays clock snapshots on start and move events', () => {
  const startedClock = armedClock(4);
  const movedClock = advanceClock(startedClock, 1504, 'white', { type: 'playing', turn: 'black' });
  const events: GameEvent[] = [
    {
      type: 'room-created',
      at: 1,
      roomId: 'clock-room',
      variant: 'chess',
    },
    {
      type: 'clock-started',
      at: 4,
      roomId: 'clock-room',
      clock: startedClock,
    },
    {
      type: 'move-played',
      at: 1504,
      roomId: 'clock-room',
      color: 'white',
      clock: movedClock,
      move: { from: 'e2', to: 'e4' },
    },
  ];

  const projection = replayGameEvents(events);

  assert.equal(projection.state.clock?.activeColor, 'black');
  assert.equal(projection.state.clock?.remainingMs.white, 298500);
  assert.equal(projection.state.clock?.remainingMs.black, 300000);
  assert.equal(projection.state.clock?.runningSince, 1504);
});

test('replays timeout events into a finished game', () => {
  const startedClock = armedClock(4, 1000, 0);
  const expiredClock = expireClock(startedClock, 1004, 'white');
  assert.ok(expiredClock);
  const events: GameEvent[] = [
    {
      type: 'room-created',
      at: 1,
      roomId: 'timeout-room',
      variant: 'chess',
    },
    {
      type: 'clock-started',
      at: 4,
      roomId: 'timeout-room',
      clock: startedClock,
    },
    {
      type: 'clock-expired',
      at: 1004,
      roomId: 'timeout-room',
      clock: expiredClock,
      color: 'white',
    },
  ];

  const projection = replayGameEvents(events);

  assert.deepEqual(projection.state.status, {
    type: 'finished',
    winner: 'black',
    reason: 'timeout',
  });
  assert.equal(projection.state.clock?.activeColor, null);
  assert.equal(projection.state.clock?.remainingMs.white, 0);
});

test('replays Fog of War room and move events through the Fog rules adapter', () => {
  const events: GameEvent[] = [
    {
      type: 'room-created',
      at: 1,
      roomId: 'fog-event-room',
      variant: 'dark-chess',
    },
    {
      type: 'move-played',
      at: 2,
      roomId: 'fog-event-room',
      color: 'white',
      move: { from: 'e2', to: 'e4' },
    },
  ];

  const projection = replayGameEvents(events);

  assert.equal(projection.variant, 'dark-chess');
  assert.deepEqual(projection.state.board.e4, { color: 'white', role: 'pawn' });
  assert.deepEqual(projection.state.status, { type: 'playing', turn: 'black' });
});

test('replays bounded event slices for timeline traversal', () => {
  const events: GameEvent[] = [
    {
      type: 'room-created',
      at: 1,
      roomId: 'timeline-room',
      variant: 'chess',
    },
    {
      type: 'move-played',
      at: 5,
      roomId: 'timeline-room',
      color: 'white',
      move: { from: 'e2', to: 'e4' },
    },
    {
      type: 'move-played',
      at: 6,
      roomId: 'timeline-room',
      color: 'black',
      move: { from: 'e7', to: 'e5' },
    },
  ];

  const created = replayGameEvents(events.slice(0, 1));
  assert.deepEqual(created.state.status, { type: 'playing', turn: 'white' });
  assert.equal(created.state.lastMove, undefined);

  const afterWhiteMove = replayGameEvents(events.slice(0, 2));
  assert.deepEqual(afterWhiteMove.state.status, { type: 'playing', turn: 'black' });
  assert.deepEqual(afterWhiteMove.state.lastMove, { from: 'e2', to: 'e4' });

  const afterBlackMove = replayGameEvents(events);
  assert.deepEqual(afterBlackMove.state.status, { type: 'playing', turn: 'white' });
  assert.deepEqual(afterBlackMove.state.lastMove, { from: 'e7', to: 'e5' });
});

test('seat-resigned ends the game with opposite color winning', () => {
  const events: GameEvent[] = [
    { type: 'room-created', at: 1, roomId: 'resign-room', variant: 'dark-chess' },
    { type: 'seat-assigned', at: 2, roomId: 'resign-room', clientId: 'wc', seat: 'white' },
    { type: 'seat-assigned', at: 3, roomId: 'resign-room', clientId: 'bc', seat: 'black' },
    {
      type: 'move-played',
      at: 4,
      roomId: 'resign-room',
      color: 'white',
      move: { from: 'e2', to: 'e4' },
    },
    { type: 'seat-resigned', at: 5, roomId: 'resign-room', color: 'white' },
  ];
  const projection = replayGameEvents(events);
  assert.deepEqual(projection.state.status, {
    type: 'finished',
    winner: 'black',
    reason: 'resignation',
  });
});

test('seat-forfeited ends the game for the opponent with reason abandonment', () => {
  const events: GameEvent[] = [
    { type: 'room-created', at: 1, roomId: 'forfeit-room', variant: 'dark-chess' },
    { type: 'seat-assigned', at: 2, roomId: 'forfeit-room', clientId: 'wc', seat: 'white' },
    { type: 'seat-assigned', at: 3, roomId: 'forfeit-room', clientId: 'bc', seat: 'black' },
    {
      type: 'move-played',
      at: 4,
      roomId: 'forfeit-room',
      color: 'white',
      move: { from: 'e2', to: 'e4' },
    },
    {
      type: 'move-played',
      at: 5,
      roomId: 'forfeit-room',
      color: 'black',
      move: { from: 'e7', to: 'e5' },
    },
    // White abandons; black wins by abandonment.
    { type: 'seat-forfeited', at: 6, roomId: 'forfeit-room', color: 'white' },
  ];
  const projection = replayGameEvents(events);
  assert.deepEqual(projection.state.status, {
    type: 'finished',
    winner: 'black',
    reason: 'abandonment',
  });
});

test('seat-forfeited after the game has finished is a no-op', () => {
  const events: GameEvent[] = [
    { type: 'room-created', at: 1, roomId: 'forfeit-done', variant: 'dark-chess' },
    { type: 'seat-resigned', at: 2, roomId: 'forfeit-done', color: 'black' },
    { type: 'seat-forfeited', at: 3, roomId: 'forfeit-done', color: 'white' },
  ];
  const projection = replayGameEvents(events);
  // First terminal event wins; the forfeit is ignored.
  assert.deepEqual(projection.state.status, {
    type: 'finished',
    winner: 'white',
    reason: 'resignation',
  });
});

test('seat-resigned freezes the clock at the resign timestamp', () => {
  const startedClock = armedClock(1000, 60_000, 0);
  const events: GameEvent[] = [
    { type: 'room-created', at: 1, roomId: 'resign-clock-room', variant: 'dark-chess' },
    { type: 'seat-assigned', at: 2, roomId: 'resign-clock-room', clientId: 'wc', seat: 'white' },
    { type: 'seat-assigned', at: 3, roomId: 'resign-clock-room', clientId: 'bc', seat: 'black' },
    { type: 'clock-started', at: 1000, roomId: 'resign-clock-room', clock: startedClock },
    // White's clock ticks from 1000ms to 4000ms (3s elapsed) before resigning.
    { type: 'seat-resigned', at: 4000, roomId: 'resign-clock-room', color: 'white' },
  ];
  const projection = replayGameEvents(events);
  assert.deepEqual(projection.state.status, {
    type: 'finished',
    winner: 'black',
    reason: 'resignation',
  });
  // Clock must be frozen: no active color, no runningSince. White's remaining reflects elapsed.
  assert.equal(projection.state.clock?.activeColor, null);
  assert.equal(projection.state.clock?.runningSince, null);
  assert.equal(projection.state.clock?.remainingMs.white, 57_000);
  assert.equal(projection.state.clock?.remainingMs.black, 60_000);
});

test('game-aborted before any move ends the game in the aborted state', () => {
  const events: GameEvent[] = [
    { type: 'room-created', at: 1, roomId: 'abort-room', variant: 'dark-chess' },
    { type: 'clock-started', at: 4, roomId: 'abort-room', clock: createClock(4, 60_000, 0) },
    { type: 'game-aborted', at: 5, roomId: 'abort-room', reason: 'pregame-timeout' },
  ];
  const projection = replayGameEvents(events);
  assert.deepEqual(projection.state.status, { type: 'aborted', reason: 'pregame-timeout' });
  // Clock never ticked; remains full and frozen.
  assert.equal(projection.state.clock?.activeColor, null);
  assert.equal(projection.state.clock?.remainingMs.white, 60_000);
});

test('game-aborted after only white has moved is still valid (before both first moves)', () => {
  const events: GameEvent[] = [
    { type: 'room-created', at: 1, roomId: 'abort-w-room', variant: 'dark-chess' },
    { type: 'clock-started', at: 4, roomId: 'abort-w-room', clock: createClock(4, 60_000, 0) },
    {
      type: 'move-played',
      at: 1000,
      roomId: 'abort-w-room',
      color: 'white',
      move: { from: 'e2', to: 'e4' },
    },
    { type: 'game-aborted', at: 2000, roomId: 'abort-w-room', reason: 'user-abort' },
  ];
  const projection = replayGameEvents(events);
  assert.deepEqual(projection.state.status, { type: 'aborted', reason: 'user-abort' });
});

test('game-aborted after both players have moved is a no-op (abort window closed)', () => {
  const events: GameEvent[] = [
    { type: 'room-created', at: 1, roomId: 'abort-closed-room', variant: 'dark-chess' },
    { type: 'clock-started', at: 4, roomId: 'abort-closed-room', clock: createClock(4, 60_000, 0) },
    {
      type: 'move-played',
      at: 1000,
      roomId: 'abort-closed-room',
      color: 'white',
      move: { from: 'e2', to: 'e4' },
    },
    {
      type: 'move-played',
      at: 2000,
      roomId: 'abort-closed-room',
      color: 'black',
      move: { from: 'e7', to: 'e5' },
    },
    { type: 'game-aborted', at: 3000, roomId: 'abort-closed-room', reason: 'user-abort' },
  ];
  const projection = replayGameEvents(events);
  // Both first moves are in; the game continues rather than aborting.
  assert.deepEqual(projection.state.status, { type: 'playing', turn: 'white' });
});

test('seat-resigned after game already finished is a no-op (only first resignation counts)', () => {
  const events: GameEvent[] = [
    { type: 'room-created', at: 1, roomId: 'r', variant: 'dark-chess' },
    { type: 'seat-resigned', at: 2, roomId: 'r', color: 'white' },
    { type: 'seat-resigned', at: 3, roomId: 'r', color: 'black' },
  ];
  const projection = replayGameEvents(events);
  assert.deepEqual(projection.state.status, {
    type: 'finished',
    winner: 'black',
    reason: 'resignation',
  });
});

test('pause freezes the clock at the pause timestamp and marks the projection paused', () => {
  const startedClock = armedClock(1000, 60_000, 0);
  const events: GameEvent[] = [
    { type: 'room-created', at: 1, roomId: 'pause-room', variant: 'chess' },
    {
      type: 'clock-started',
      at: 1000,
      roomId: 'pause-room',
      clock: startedClock,
    },
    { type: 'pause', at: 3500, roomId: 'pause-room', reason: 'shutdown' },
  ];
  const projection = replayGameEvents(events);

  assert.equal(projection.paused, true);
  assert.equal(projection.pausedAt, 3500);
  assert.equal(projection.pauseReason, 'shutdown');
  assert.equal(projection.state.clock?.activeColor, null);
  assert.equal(projection.state.clock?.runningSince, null);
  // White was ticking from t=1000 to t=3500 — 2500ms elapsed. 60_000 − 2500 = 57_500.
  assert.equal(projection.state.clock?.remainingMs.white, 57_500);
  assert.equal(projection.state.clock?.remainingMs.black, 60_000);
  // Status still 'playing' — pause does not finalize the game.
  assert.deepEqual(projection.state.status, { type: 'playing', turn: 'white' });
});

test('resume rearms the clock for the current turn without altering remaining time', () => {
  // Both players complete their first move so the clock arms (white ticking from
  // t=2000), then a server outage pauses and resumes 10 minutes later.
  const events: GameEvent[] = [
    { type: 'room-created', at: 1, roomId: 'resume-room', variant: 'dark-chess' },
    { type: 'clock-started', at: 4, roomId: 'resume-room', clock: createClock(4, 60_000, 0) },
    {
      type: 'move-played',
      at: 1000,
      roomId: 'resume-room',
      color: 'white',
      move: { from: 'e2', to: 'e4' },
    },
    {
      type: 'move-played',
      at: 2000,
      roomId: 'resume-room',
      color: 'black',
      move: { from: 'e7', to: 'e5' },
    },
    { type: 'pause', at: 4500, roomId: 'resume-room', reason: 'shutdown' },
    // Wall-clock elapsed 10 minutes during server outage; resume at a much later time.
    { type: 'resume', at: 604_500, roomId: 'resume-room', reason: 'both-present' },
  ];
  const projection = replayGameEvents(events);

  assert.equal(projection.paused, false);
  assert.equal(projection.pausedAt, null);
  assert.equal(projection.pauseReason, null);
  assert.equal(projection.state.clock?.activeColor, 'white');
  assert.equal(projection.state.clock?.runningSince, 604_500);
  // White ticked from t=2000 (arm) to t=4500 (pause) = 2500ms. The outage doesn't count.
  assert.equal(projection.state.clock?.remainingMs.white, 57_500);
  assert.equal(projection.state.clock?.remainingMs.black, 60_000);
});

test('pause is a no-op after the game has finished', () => {
  const events: GameEvent[] = [
    {
      type: 'room-created',
      at: 1,
      roomId: 'post-finish-pause-room',
      variant: 'dark-chess',
    },
    { type: 'seat-resigned', at: 2, roomId: 'post-finish-pause-room', color: 'white' },
    { type: 'pause', at: 3, roomId: 'post-finish-pause-room', reason: 'shutdown' },
  ];
  const projection = replayGameEvents(events);

  assert.equal(projection.paused, false);
  assert.deepEqual(projection.state.status, {
    type: 'finished',
    winner: 'black',
    reason: 'resignation',
  });
});

test('a second pause while already paused is a no-op (preserves first pause snapshot)', () => {
  const startedClock = armedClock(1000, 60_000, 0);
  const events: GameEvent[] = [
    { type: 'room-created', at: 1, roomId: 'double-pause-room', variant: 'chess' },
    {
      type: 'clock-started',
      at: 1000,
      roomId: 'double-pause-room',
      clock: startedClock,
    },
    { type: 'pause', at: 3500, roomId: 'double-pause-room', reason: 'shutdown' },
    { type: 'pause', at: 4000, roomId: 'double-pause-room', reason: 'admin' },
  ];
  const projection = replayGameEvents(events);

  assert.equal(projection.paused, true);
  assert.equal(projection.pausedAt, 3500);
  assert.equal(projection.pauseReason, 'shutdown');
  assert.equal(projection.state.clock?.remainingMs.white, 57_500);
});

test('resume while not paused is a no-op', () => {
  const startedClock = armedClock(1000, 60_000, 0);
  const events: GameEvent[] = [
    { type: 'room-created', at: 1, roomId: 'stray-resume-room', variant: 'chess' },
    {
      type: 'clock-started',
      at: 1000,
      roomId: 'stray-resume-room',
      clock: startedClock,
    },
    { type: 'resume', at: 2000, roomId: 'stray-resume-room', reason: 'admin' },
  ];
  const projection = replayGameEvents(events);

  assert.equal(projection.paused, false);
  assert.equal(projection.state.clock?.activeColor, 'white');
  assert.equal(projection.state.clock?.runningSince, 1000);
});

test('move after resume continues the game with the unchanged clock', () => {
  // Arm via both first moves (white ticks from t=2000), pause/resume across an
  // outage, then white's second move spends real time.
  const events: GameEvent[] = [
    { type: 'room-created', at: 1, roomId: 'resume-move-room', variant: 'dark-chess' },
    { type: 'clock-started', at: 4, roomId: 'resume-move-room', clock: createClock(4, 60_000, 0) },
    {
      type: 'move-played',
      at: 1000,
      roomId: 'resume-move-room',
      color: 'white',
      move: { from: 'e2', to: 'e4' },
    },
    {
      type: 'move-played',
      at: 2000,
      roomId: 'resume-move-room',
      color: 'black',
      move: { from: 'e7', to: 'e5' },
    },
    { type: 'pause', at: 4500, roomId: 'resume-move-room', reason: 'shutdown' },
    { type: 'resume', at: 604_500, roomId: 'resume-move-room', reason: 'both-present' },
    // White's second move, 500ms after resume.
    {
      type: 'move-played',
      at: 605_000,
      roomId: 'resume-move-room',
      color: 'white',
      move: { from: 'g1', to: 'f3' },
    },
  ];
  const projection = replayGameEvents(events);

  assert.deepEqual(projection.state.status, { type: 'playing', turn: 'black' });
  // White ticked 2500ms before pause + 500ms after resume = 3000ms. 60_000 − 3000 = 57_000.
  assert.equal(projection.state.clock?.remainingMs.white, 57_000);
  // The 10-minute server outage between pause and resume must not appear in either player's clock.
  assert.equal(projection.state.clock?.remainingMs.black, 60_000);
  assert.equal(projection.state.clock?.activeColor, 'black');
});

test('multiple pause/resume cycles do not leak wall-clock time into player clocks', () => {
  // Arm via both first moves (white ticks from t=200), then two long outages.
  const events: GameEvent[] = [
    { type: 'room-created', at: 1, roomId: 'cycle-room', variant: 'dark-chess' },
    { type: 'clock-started', at: 4, roomId: 'cycle-room', clock: createClock(4, 60_000, 0) },
    {
      type: 'move-played',
      at: 100,
      roomId: 'cycle-room',
      color: 'white',
      move: { from: 'e2', to: 'e4' },
    },
    {
      type: 'move-played',
      at: 200,
      roomId: 'cycle-room',
      color: 'black',
      move: { from: 'e7', to: 'e5' },
    },
    // First outage: 1 hour, after 1s of armed play.
    { type: 'pause', at: 1200, roomId: 'cycle-room', reason: 'shutdown' },
    { type: 'resume', at: 3_601_200, roomId: 'cycle-room', reason: 'both-present' },
    // Second outage: another 1 hour, starting after 1s of resumed play.
    { type: 'pause', at: 3_602_200, roomId: 'cycle-room', reason: 'shutdown' },
    { type: 'resume', at: 7_202_200, roomId: 'cycle-room', reason: 'both-present' },
  ];
  const projection = replayGameEvents(events);

  // White's total ticking time: 1000ms (before first pause) + 1000ms (between resume and pause) = 2000ms.
  assert.equal(projection.state.clock?.remainingMs.white, 58_000);
  assert.equal(projection.state.clock?.remainingMs.black, 60_000);
  assert.equal(projection.paused, false);
  assert.equal(projection.state.clock?.activeColor, 'white');
});

test('replays a correspondence log with the days-per-move reset transition', () => {
  const clock = createClock(4, DAY_MS, 0);
  const events: GameEvent[] = [
    {
      type: 'room-created',
      at: 1,
      roomId: 'corr-room',
      variant: 'dark-chess',
      timeControl: correspondenceTimeControl(1),
    },
    { type: 'seat-assigned', at: 2, roomId: 'corr-room', clientId: 'white-client', seat: 'white' },
    { type: 'seat-assigned', at: 3, roomId: 'corr-room', clientId: 'black-client', seat: 'black' },
    { type: 'clock-started', at: 4, roomId: 'corr-room', clock },
    {
      type: 'move-played',
      at: 10_000,
      roomId: 'corr-room',
      color: 'white',
      move: { from: 'e2', to: 'e4' },
    },
    {
      type: 'move-played',
      at: 20_000,
      roomId: 'corr-room',
      color: 'black',
      move: { from: 'e7', to: 'e5' },
    },
  ];

  // Armed after both first moves, exactly like live.
  const armed = replayGameEvents(events);
  assert.equal(armed.state.clock?.activeColor, 'white');
  assert.equal(armed.state.clock?.runningSince, 20_000);

  // White spends six hours, then moves: the allowance resets to the full day
  // instead of banking the remainder (the days-per-move transition, selected
  // from the persisted timeControl during replay).
  const sixHoursLater = 20_000 + DAY_MS / 4;
  const afterReset = replayGameEvents([
    ...events,
    {
      type: 'move-played',
      at: sixHoursLater,
      roomId: 'corr-room',
      color: 'white',
      move: { from: 'd2', to: 'd4' },
    },
  ]);
  assert.equal(afterReset.state.clock?.remainingMs.white, DAY_MS);
  assert.equal(afterReset.state.clock?.activeColor, 'black');
  assert.equal(afterReset.state.clock?.runningSince, sixHoursLater);
});

test('replays a spec-first room-created event (variant-tenant logs omit variant/offer)', () => {
  // The dark-chess tenant writes room-created with gameSpecId only; the chess
  // shell and the /game/:id review both replay such logs through this reducer.
  const events: GameEvent[] = [
    {
      type: 'room-created',
      at: 1,
      roomId: 'dchx_spec_first',
      gameSpecId: 'dark-chess',
      timeControl: { initialMs: 86_400_000, incrementMs: 0, daysPerMove: 1 },
    },
    {
      type: 'move-played',
      at: 2,
      roomId: 'dchx_spec_first',
      color: 'white',
      move: { from: 'e2', to: 'e4' },
    },
  ];
  const projection = replayGameEvents(events);
  assert.equal(projection.variant, 'dark-chess');
  assert.equal(projection.gameSpecId, 'dark-chess');
  assert.equal(projection.state.status.type, 'playing');
  assert.equal(projection.state.board.e4?.role, 'pawn');
  assert.equal(projection.timeControl?.daysPerMove, 1);
});
