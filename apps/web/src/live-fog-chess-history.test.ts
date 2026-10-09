// A LIVE Fog Chess seat that reloads (the correspondence case) must be able to
// click back through the game. Its event log is fog-filtered (no opponent
// moves), so it cannot rebuild the plies it saw; before the fix it held one
// snapshot and every earlier move was a dead click. The server's seated hello
// now carries the seat's own per-ply fog views (`liveHistory`, server
// dark-chess-live-history.ts), which live-socket hands to seedFogViewHistory.
//
// Drives the real socket adapter (live-socket.ts) and replay state
// (live-replay.ts) through a fake WebSocket, with a seeded game played through
// the kernel and the views the server would build for that seat.

import {
  type Color,
  type GameEvent,
  type GameState,
  type Move,
  type PlayerView,
  replayGameEvents,
  variantForId,
} from '@mistboard/game';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  captureFogView,
  getFogViewHistory,
  handleMoveListClick,
  handleReplayButtonClick,
  isLive,
  replayMetaLabel,
  resetReplayState,
  seedFogViewHistory,
} from './live-replay.js';
import { connectSocket, initSocket } from './live-socket.js';
import { liveState } from './live-state.js';
import { currentView } from './live-view.js';

vi.mock('./live-sound.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./live-sound.js')>();
  return { ...actual, playSound: vi.fn() };
});

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static OPEN = 1;
  readyState = 0;
  private listeners = new Map<string, Set<(event: unknown) => void>>();
  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }
  addEventListener(type: string, fn: (event: unknown) => void): void {
    const set = this.listeners.get(type) ?? new Set();
    set.add(fn);
    this.listeners.set(type, set);
  }
  removeEventListener(type: string, fn: (event: unknown) => void): void {
    this.listeners.get(type)?.delete(fn);
  }
  send(): void {}
  close(): void {}
  emit(type: string, event: unknown): void {
    for (const fn of this.listeners.get(type) ?? []) fn(event);
  }
  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.emit('open', {});
  }
  message(payload: unknown): void {
    this.emit('message', { data: JSON.stringify(payload) });
  }
}

const ROOM = 'fog-chess-live-history';
const variant = variantForId('dark-chess');

function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

type Played = { move: Move; color: Color };

// Seeded play through the kernel, captures preferred; stays live.
function playGame(plies: number): { played: Played[]; states: GameState[] } {
  const rng = seeded(5);
  const created: GameEvent = { type: 'room-created', at: 1, roomId: ROOM, variant: 'dark-chess' };
  const events: GameEvent[] = [created];
  const states = [replayGameEvents(events).state];
  const played: Played[] = [];
  while (played.length < plies) {
    const state = states.at(-1)!;
    const turn = (state.status as { turn: Color }).turn;
    const legal = [...variant.getLegalMoves(state, turn)];
    const takes = legal.filter((m) => state.board[m.to]);
    const pool = takes.length > 0 && rng() < 0.6 ? takes : legal;
    const move = pool[Math.floor(rng() * pool.length)]!;
    events.push({ type: 'move-played', at: played.length + 2, roomId: ROOM, color: turn, move });
    const next = replayGameEvents(events).state;
    if (next.status.type !== 'playing') break;
    played.push({ move, color: turn });
    states.push(next);
  }
  return { played, states };
}

const GAME = playGame(16);
const PLIES = GAME.played.length;

// What the server sends the white seat: room-created plus its own moves.
const CREATED: GameEvent = { type: 'room-created', at: 1, roomId: ROOM, variant: 'dark-chess' };
const WHITE_EVENTS: GameEvent[] = [
  CREATED,
  ...GAME.played.flatMap(({ move, color }, index) =>
    color === 'white'
      ? [{ type: 'move-played', at: index + 2, roomId: ROOM, color, move } as GameEvent]
      : [],
  ),
];

function whiteView(ply: number): PlayerView {
  return variant.getPlayerView(GAME.states[ply]!, 'white');
}

// The server's history for white (dark-chess-live-history.ts): its fog view at
// every ply, legal moves stripped, keyed to how many of its events had arrived.
function whiteHistory(through = PLIES) {
  return Array.from({ length: through + 1 }, (_, ply) => ({
    ply,
    view: { ...whiteView(ply), legalMoves: [] },
    eventsLen: 1 + GAME.played.slice(0, ply).filter(({ color }) => color === 'white').length,
  }));
}

// The move-list click target for white's nth own move (live-move-list:
// eventIndex = its index in the event log + 1), and the ply it was played at.
function whiteMove(nth: number): { eventIndex: number; ply: number } {
  const ply =
    GAME.played.flatMap(({ color }, index) => (color === 'white' ? [index + 1] : []))[nth - 1] ??
    Number.NaN;
  return { eventIndex: 1 + nth, ply };
}

function noHiddenBlackPiece(view: PlayerView | null): void {
  expect(view).not.toBeNull();
  const visible = new Set(view!.visibleSquares);
  for (const [square, piece] of Object.entries(view!.board)) {
    if (piece?.color === 'black') expect(visible.has(square as never)).toBe(true);
  }
}

function boot(): FakeWebSocket {
  // The real render captures a fog view on every frame (live-render.ts).
  initSocket({
    render: () => captureFogView(),
    reconcileInteractionState: () => {},
    maybePlaySnapshotSound: () => {},
  });
  connectSocket();
  const socket = FakeWebSocket.instances.at(-1)!;
  socket.open();
  return socket;
}

function frame(type: 'hello' | 'snapshot', extra: Record<string, unknown> = {}) {
  return {
    type,
    clientId: 'client-white',
    clients: 2,
    seat: 'white',
    solo: false,
    gameSpecId: 'dark-chess',
    events: WHITE_EVENTS,
    state: whiteView(PLIES),
    ...extra,
  };
}

beforeEach(() => {
  FakeWebSocket.instances = [];
  vi.stubGlobal('WebSocket', FakeWebSocket);
  vi.useFakeTimers();
  resetReplayState();
  liveState.room = ROOM;
  liveState.socketUrl = `ws://test.local/?room=${ROOM}`;
  liveState.socketUrls = [];
  liveState.gameSpecId = null;
  liveState.seat = 'spectator';
  liveState.state = null;
  liveState.events = [];
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  resetReplayState();
});

describe('cold load into a LIVE Fog Chess room as a seat', () => {
  it('the scripted game is long enough to step back through', () => {
    expect(PLIES).toBeGreaterThanOrEqual(12);
    expect(whiteMove(2).ply).toBe(3);
  });

  it('without a history an earlier move is a dead click (the bug)', () => {
    const socket = boot();
    socket.message(frame('hello'));
    expect(getFogViewHistory().size).toBe(1);
    handleMoveListClick(whiteMove(2).eventIndex);
    expect(currentView()).toEqual(whiteView(PLIES));
  });

  it("with the seat's history every ply is clickable and still fogged", () => {
    const socket = boot();
    socket.message(frame('hello', { liveHistory: whiteHistory() }));
    // The broadcast snapshot that follows every join carries no history (and
    // a fresh state object) and must not drop or extend the one installed.
    socket.message(frame('snapshot'));

    expect(getFogViewHistory().size).toBe(PLIES + 1);
    expect(replayMetaLabel()).toBe(`Live · ply ${PLIES} of ${PLIES}`);
    const live = currentView();
    expect(live).toEqual(whiteView(PLIES));

    // Clicking white's second move shows exactly the position white saw then.
    const { eventIndex, ply } = whiteMove(2);
    handleMoveListClick(eventIndex);
    expect(isLive()).toBe(false);
    expect(currentView()).toEqual({ ...whiteView(ply), legalMoves: [] });
    expect(currentView()!.board).not.toEqual(live!.board);
    expect(replayMetaLabel()).toBe(`Replay · ply ${ply} of ${PLIES}`);

    // Every ply, stepped from the start: one ply per press, never a hidden piece.
    handleReplayButtonClick('first');
    expect(currentView()).toEqual({ ...whiteView(0), legalMoves: [] });
    for (let step = 1; step < PLIES; step += 1) {
      handleReplayButtonClick('next');
      expect(currentView()).toEqual({ ...whiteView(step), legalMoves: [] });
      noHiddenBlackPiece(currentView());
    }
    handleReplayButtonClick('next');
    expect(isLive()).toBe(true);
    expect(currentView()).toEqual(whiteView(PLIES));
  });

  it("ignores a history that is not this seat's or does not fit the live room", () => {
    const blackHistory = whiteHistory().map((entry, ply) => ({
      ...entry,
      view: { ...variant.getPlayerView(GAME.states[ply]!, 'black'), legalMoves: [] },
    }));
    const pastTheLog = whiteHistory().map((entry) => ({
      ...entry,
      eventsLen: entry.eventsLen + 5,
    }));
    for (const liveHistory of [
      blackHistory,
      whiteHistory(PLIES - 1),
      pastTheLog,
      [{ ply: 0 }, { ply: 2 }],
    ]) {
      const socket = boot();
      socket.message(frame('hello', { liveHistory }));
      expect(getFogViewHistory().size).toBe(1);
      resetReplayState();
    }

    // Not a playing seat: a spectator, and a finished room.
    liveState.seat = 'spectator';
    liveState.state = whiteView(PLIES);
    liveState.events = WHITE_EVENTS;
    expect(seedFogViewHistory(whiteHistory())).toBe(false);
    liveState.seat = 'white';
    liveState.state = {
      ...whiteView(PLIES),
      status: { type: 'finished', winner: 'white', reason: 'resignation' },
    };
    expect(seedFogViewHistory(whiteHistory())).toBe(false);
    expect(getFogViewHistory().size).toBe(0);
  });
});
