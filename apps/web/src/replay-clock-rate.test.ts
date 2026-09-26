// A CLOCK ONLY EVER TICKS AT ONE SECOND PER SECOND.
//
// The homepage TV and /watch clocks, in every state this file pins:
//
//   live     — the server's clock projected against Date.now(): ticks at real speed.
//   playing  — a recorded game playing back at its TRUE timing: the mover counts down at
//              real speed through the recorded think and lands on the recorded value.
//   still    — paused or scrubbed: the ply's recorded value, static.
//
// History: until 2026-09-04 a replay drained the mover's clock by the real time the move
// cost across a CLAMPED playback window ([700, 2500] ms), so the rate was the ratio (1.61x
// for a bot, 1.00x-7.60x for a human on one homepage game); the fix then was a static
// label. On 2026-09-26 the clamp itself was retired ("always true timing, never faked"):
// each move now plays for exactly its recorded think, so a real-rate tick is honest. The
// suite was green through both bugs because nothing asserted the RATE, only the
// endpoints. So: assert the rate.
import {
  createClock,
  type GameEvent,
  type JieqiColor,
  type JieqiMove,
  type JieqiPlayerBoard,
  type JieqiPlayerView,
} from '@mistboard/game';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JieqiPostgameResponse } from './live-jieqi-postgame.js';
import { mountReplay } from './replay.js';
import { mountJieqiWatchReplay } from './watch-jieqi-replay.js';

// Fixed epoch so the timestamp arithmetic is exact under fake timers.
const NOW = Date.UTC(2026, 8, 4, 12, 0, 0);

describe('replay clock tick rate (tenant renderer)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('plays each move for its recorded think and ticks the mover at one second per second', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(replayFixture())),
    );
    const root = document.createElement('div');
    const handle = await mountJieqiWatchReplay(root, 'jq_rate', { autoplay: true, compact: true });

    // Ply 2 lands exactly 3 s in (its recorded timestamp), not after a clamped window.
    await vi.advanceTimersByTimeAsync(2_900);
    expect(handle.clockAtPly?.()).toMatchObject({ toMove: 'second' });
    await vi.advanceTimersByTimeAsync(100);
    expect(handle.clockAtPly?.()).toEqual({ first: 605_000, second: 605_000, toMove: 'first' });

    // Red now thinks for NINETEEN seconds, and the board sits on ply 2 for all of it. Her
    // clock drops by exactly the real time elapsed, sampled every second: rate 1.00x.
    let previous = 605_000;
    for (let second = 1; second <= 18; second += 1) {
      await vi.advanceTimersByTimeAsync(1_000);
      const readout = handle.clockAtPly?.();
      expect(readout).toEqual({
        first: 605_000 - second * 1_000,
        second: 605_000,
        toMove: 'first',
      });
      expect(previous - readout!.first).toBe(1_000);
      previous = readout!.first;
    }
    // The seats render the same ticking value.
    expect(seatClockText(root)).toContain('9:47');

    // The move lands at 22 s on its recorded value: 605_000 - 19_000 + 5_000 increment.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(handle.clockAtPly?.()).toEqual({ first: 591_000, second: 605_000, toMove: 'second' });
    handle.destroy();
  });

  it('holds each side still through its first move, which the server never charged', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(replayFixture())),
    );
    const root = document.createElement('div');
    const handle = await mountJieqiWatchReplay(root, 'jq_rate', { autoplay: true, compact: true });

    await vi.advanceTimersByTimeAsync(1_200); // ply 1 on, black's first think under way
    expect(handle.clockAtPly?.()).toEqual({ first: 605_000, second: 600_000, toMove: 'second' });
    await vi.advanceTimersByTimeAsync(1_500);
    expect(handle.clockAtPly?.()).toEqual({ first: 605_000, second: 600_000, toMove: 'second' });
    handle.destroy();
  });

  it('shows the recorded value, static, on a paused or scrubbed replay', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(replayFixture())),
    );
    const root = document.createElement('div');
    const handle = await mountJieqiWatchReplay(root, 'jq_rate', { autoplay: true, compact: true });
    await vi.advanceTimersByTimeAsync(8_000);
    expect(handle.clockAtPly?.()).toMatchObject({ first: 600_000 });

    // A manual jump pauses playback: the clock parks on the ply's recorded value.
    handle.jumpToPly?.(2);
    expect(handle.clockAtPly?.()).toEqual({ first: 605_000, second: 605_000, toMove: 'first' });
    const rendered = seatClockText(root);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(handle.clockAtPly?.()).toEqual({ first: 605_000, second: 605_000, toMove: 'first' });
    expect(seatClockText(root)).toEqual(rendered);
    handle.destroy();
  });

  it('ticks a LIVE clock at exactly one second per second', async () => {
    // Live games count down against the wall, not against a window.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(liveFixture())),
    );
    const root = document.createElement('div');
    const handle = await mountJieqiWatchReplay(root, 'jq_live', {
      autoplay: false,
      compact: true,
      live: true,
    });

    expect(handle.clockAtPly?.()).toMatchObject({ first: 300_000, second: 240_000 });

    await vi.advanceTimersByTimeAsync(3_000);
    // Red is on the clock: exactly 3 s gone. Black is idle and unmoved.
    expect(handle.clockAtPly?.()).toMatchObject({ first: 297_000, second: 240_000 });

    await vi.advanceTimersByTimeAsync(7_000);
    expect(handle.clockAtPly?.()).toMatchObject({ first: 290_000, second: 240_000 });

    handle.destroy();
  });
});

describe('replay clock tick rate (chess renderer)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('ticks a timed fog chess replay at one second per second and lands on the recorded value', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    const replay = await mountReplay(root, 'timed-chess', {
      autoplay: true,
      showControls: false,
      loaderForId: async () => timedChessEvents,
    });
    try {
      // Ply 2 (black's first move, which arms the clock) lands 2 s in.
      await vi.advanceTimersByTimeAsync(2_000);
      expect(replay.clockAtPly?.()).toEqual({ first: 60_000, second: 60_000, toMove: 'first' });

      // White's 10 s think: one second off per second of playback.
      await vi.advanceTimersByTimeAsync(3_000);
      expect(replay.clockAtPly?.()).toEqual({ first: 57_000, second: 60_000, toMove: 'first' });
      await vi.advanceTimersByTimeAsync(4_000);
      expect(replay.clockAtPly?.()).toEqual({ first: 53_000, second: 60_000, toMove: 'first' });

      // The move lands at 12 s on the recorded value (no increment in this time control).
      await vi.advanceTimersByTimeAsync(3_000);
      expect(replay.clockAtPly?.()).toEqual({ first: 50_000, second: 60_000, toMove: 'second' });
    } finally {
      replay.destroy();
      root.remove();
    }
  });
});

// Playback is a function of the wall clock (recorded-playback.ts): the homepage TV joins a
// delayed air at the ply it is on now, and a tab whose timers stalled catches up in one
// step instead of resuming where it stopped.
describe('wall-anchored playback', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('joins a delayed air at the ply and clock the broadcast is on now (tenant)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(replayFixture())),
    );
    const root = document.createElement('div');
    // The air went on 10 s ago: ply 2 landed at 3 s, so red is 7 s into her 19 s think.
    const handle = await mountJieqiWatchReplay(root, 'jq_rate', {
      autoplay: true,
      compact: true,
      airStartMs: NOW - 10_000,
    });
    expect(handle.clockAtPly?.()).toEqual({ first: 598_000, second: 605_000, toMove: 'first' });
    await vi.advanceTimersByTimeAsync(12_000);
    expect(handle.clockAtPly?.()).toEqual({ first: 591_000, second: 605_000, toMove: 'second' });
    handle.destroy();
  });

  it('catches up in one step when the tab comes back from a stall (tenant)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(replayFixture())),
    );
    const root = document.createElement('div');
    const plies: number[] = [];
    const handle = await mountJieqiWatchReplay(root, 'jq_rate', {
      autoplay: true,
      compact: true,
      onPlyChange: (ply) => plies.push(ply),
    });
    expect(plies).toEqual([0]);

    // A hidden tab: 23 s pass and not one timer fires.
    vi.setSystemTime(NOW + 23_000);
    document.dispatchEvent(new Event('visibilitychange'));

    // Straight to ply 3 (landed at 22 s), black 1 s into his think; no replay of 1 and 2.
    expect(plies).toEqual([0, 3]);
    expect(handle.clockAtPly?.()).toEqual({ first: 591_000, second: 604_000, toMove: 'second' });
    handle.destroy();
  });

  it('joins a delayed air at the ply and clock the broadcast is on now (chess)', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    // 7 s into the air: ply 2 landed at 2 s, white is 5 s into a 10 s think.
    const replay = await mountReplay(root, 'timed-chess', {
      autoplay: true,
      showControls: false,
      airStartMs: NOW - 7_000,
      loaderForId: async () => timedChessEvents,
    });
    try {
      expect(root.dataset.ply).toBe('2');
      expect(replay.clockAtPly?.()).toEqual({ first: 55_000, second: 60_000, toMove: 'first' });

      // Stall past the next move, then come back: one step to ply 3.
      vi.setSystemTime(NOW + 5_500);
      document.dispatchEvent(new Event('visibilitychange'));
      expect(root.dataset.ply).toBe('3');
    } finally {
      replay.destroy();
      root.remove();
    }
  });
});

function seatClockText(root: HTMLElement): string[] {
  return [...root.querySelectorAll('.showcase-seat-clock')].map((el) => el.textContent ?? '');
}

// Four plies, 10+5, whose third move is a 19-second think. clockSeries reconstructs (first
// moves are free, the checkmating move earns no increment):
//   [0] 600_000 / 600_000   [1] 605_000 / 600_000   [2] 605_000 / 605_000
//   [3] 591_000 / 605_000   [4] 591_000 / 603_000
function replayFixture(): JieqiPostgameResponse {
  const move: JieqiMove = { from: 'a4', to: 'a5' };
  const playingRed = { type: 'playing' as const, turn: 'red' as const };
  const playingBlack = { type: 'playing' as const, turn: 'black' as const };
  const at = (ply: number): { type: 'playing'; turn: JieqiColor } =>
    ply % 2 === 0 ? playingRed : playingBlack;

  return {
    game: {
      roomId: 'jq_rate',
      variant: 'jieqi',
      mode: 'pve',
      result: 'red-wins',
      termination: 'checkmate',
      plyCount: 4,
      startedAt: '2026-09-04T12:00:00.000Z',
      endedAt: '2026-09-04T12:01:00.000Z',
      rated: false,
      visibility: 'public',
      initialMs: 600_000,
      incrementMs: 5_000,
    },
    state: {
      status: { type: 'finished', winner: 'red', reason: 'checkmate' },
      moveNumber: 3,
      timeControl: { initialMs: 600_000, incrementMs: 5_000 },
    },
    // From the start (NOW): 1 s, 2 s, then NINETEEN, then 2 s.
    timeline: [
      { type: 'move-played', at: NOW + 1_000, color: 'red', move, ply: 1 },
      { type: 'move-played', at: NOW + 3_000, color: 'black', move, ply: 2 },
      { type: 'move-played', at: NOW + 22_000, color: 'red', move, ply: 3 },
      { type: 'move-played', at: NOW + 24_000, color: 'black', move, ply: 4 },
    ],
    view: view('red', board(4), move, at(4)),
    history: {
      truth: [0, 1, 2, 3, 4].map((ply) => ({
        ply,
        view: view('red', board(ply), ply === 0 ? undefined : move, at(ply)),
      })),
      masked: [0, 1, 2, 3, 4].map((ply) => ({
        ply,
        view: view('red', board(ply), ply === 0 ? undefined : move, at(ply)),
      })),
    },
  };
}

// An in-progress game whose server clock has Red running since exactly `NOW`.
function liveFixture(): JieqiPostgameResponse {
  const playingRed = { type: 'playing' as const, turn: 'red' as const };
  return {
    game: {
      roomId: 'jq_live',
      variant: 'jieqi',
      mode: 'pve',
      result: 'in-progress',
      termination: null,
      plyCount: 0,
      startedAt: '2026-09-04T12:00:00.000Z',
      endedAt: null,
      rated: false,
      visibility: 'public',
      initialMs: 300_000,
      incrementMs: 0,
    },
    state: {
      status: playingRed,
      moveNumber: 1,
      timeControl: { initialMs: 300_000, incrementMs: 0 },
      clock: {
        activeColor: 'red',
        incrementMs: 0,
        initialMs: 300_000,
        remainingMs: { red: 300_000, black: 240_000 },
        runningSince: NOW,
      },
    },
    timeline: [],
    view: view('red', board(0), undefined, playingRed),
    history: {
      truth: [{ ply: 0, view: view('red', board(0), undefined, playingRed) }],
      masked: [{ ply: 0, view: view('red', board(0), undefined, playingRed) }],
    },
  } as unknown as JieqiPostgameResponse;
}

// Board contents are irrelevant here; only the piece square moves so each ply's view is
// distinct enough for the renderer to redraw.
function board(ply: number): JieqiPlayerBoard {
  const files = ['a4', 'a5', 'a6', 'a7', 'a8'];
  return {
    e1: { color: 'red', role: 'general', faceDown: false },
    e10: { color: 'black', role: 'general', faceDown: false },
    [files[ply] ?? 'a4']: { color: 'red', role: 'soldier', faceDown: false },
  };
}

function view(
  perspective: JieqiColor,
  pieces: JieqiPlayerBoard,
  lastMove: JieqiMove | undefined,
  status: JieqiPlayerView['status'],
): JieqiPlayerView {
  return {
    id: `${perspective}-${Object.keys(pieces).join('')}`,
    perspective,
    board: pieces,
    legalMoves: [],
    captured: [],
    inCheck: false,
    status,
    moveNumber: 1,
    ...(lastMove ? { lastMove } : {}),
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    status: 200,
  });
}

// A clockless engine game has no clock, so its per-move BUDGET is the clock and the row
// counts that allowance down at real seconds. This path once counted UP to the move's real
// think time across a clamped playback window, so a 14 s think ran at 5.6x; the window is
// now the full recorded think.
describe('clockless per-move budget countdown', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('counts the budget down at one second per second', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    // Move 1 took 14 s and now plays for all 14 s.
    const replay = await mountReplay(root, 'think-countdown-test', {
      autoplay: true,
      showControls: false,
      loaderForId: async () => clocklessEvents,
      metadataByRoomId: { 'think-countdown-test': budgetMeta() },
    });

    try {
      // White is to move and has not spent anything yet: full allowance on both rows.
      expect(clockTimes(root)).toEqual(['5.0s', '5s']);

      // 1200 ms of real time must remove exactly 1200 ms of budget. The old count-up read
      // 14000 * (1200/2500) = 6720 ms spent, i.e. already past the whole 5 s allowance.
      await vi.advanceTimersByTimeAsync(1_200);
      expect(clockTimes(root)[0]).toBe('3.8s');

      await vi.advanceTimersByTimeAsync(800);
      expect(clockTimes(root)[0]).toBe('3.0s');
    } finally {
      replay.destroy();
      root.remove();
    }
  });

  it('bottoms out at zero when the engine outruns its own budget', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    const replay = await mountReplay(root, 'think-countdown-test', {
      autoplay: true, // the window is the full 14 s think, so the 5 s budget expires inside it
      showControls: false,
      loaderForId: async () => clocklessEvents,
      metadataByRoomId: { 'think-countdown-test': budgetMeta() },
    });

    try {
      // Misty routinely overshoots. Past the allowance the row reads 0.0s and holds there,
      // rather than counting into a negative remainder.
      await vi.advanceTimersByTimeAsync(6_000);
      expect(clockTimes(root)[0]).toBe('0.0s');
    } finally {
      replay.destroy();
      root.remove();
    }
  });
});

// Engine self-play metadata: the per-move budget is the whole point; the rest is what
// the meta panel needs to render at all.
function budgetMeta() {
  return {
    whiteName: 'Misty',
    blackName: 'Misty',
    result: '1-0',
    termination: 'king-captured',
    plyCount: 2,
    timeControl: { kind: 'per-move', milliseconds: 5_000 },
  };
}

function clockTimes(root: HTMLElement): string[] {
  return [...root.querySelectorAll('.replay-clock-time')].map((el) => el.textContent ?? '');
}

// Clockless (no timeControl on room-created), with the engine's real think time on each move.
const clocklessEvents: GameEvent[] = [
  { type: 'room-created', at: 1, roomId: 'think-countdown-test', variant: 'dark-chess' },
  {
    type: 'move-played',
    at: 2,
    roomId: 'think-countdown-test',
    color: 'white',
    move: { from: 'e2', to: 'e4' },
    thinkTimeMs: 14_000,
  },
  {
    type: 'move-played',
    at: 3,
    roomId: 'think-countdown-test',
    color: 'black',
    move: { from: 'd7', to: 'd5' },
    thinkTimeMs: 3_000,
  },
] as GameEvent[];

// A timed dark chess game, 1+0: black's first move (2 s in) arms the clock, then white
// thinks 10 s.
const TIMED_ROOM = 'timed-chess';
const timedChessEvents: GameEvent[] = [
  {
    type: 'room-created',
    at: NOW,
    roomId: TIMED_ROOM,
    variant: 'dark-chess',
    timeControl: { initialMs: 60_000, incrementMs: 0 },
  },
  { type: 'clock-started', at: NOW, roomId: TIMED_ROOM, clock: createClock(NOW, 60_000, 0) },
  {
    type: 'move-played',
    at: NOW + 1_000,
    roomId: TIMED_ROOM,
    color: 'white',
    move: { from: 'e2', to: 'e4' },
  },
  {
    type: 'move-played',
    at: NOW + 2_000,
    roomId: TIMED_ROOM,
    color: 'black',
    move: { from: 'd7', to: 'd5' },
  },
  {
    type: 'move-played',
    at: NOW + 12_000,
    roomId: TIMED_ROOM,
    color: 'white',
    move: { from: 'e4', to: 'd5' },
  },
  {
    type: 'move-played',
    at: NOW + 13_000,
    roomId: TIMED_ROOM,
    color: 'black',
    move: { from: 'd8', to: 'd5' },
  },
] as GameEvent[];
