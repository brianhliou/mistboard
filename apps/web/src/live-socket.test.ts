import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { connectSocket, initSocket } from './live-socket.js';
import { liveState, noteRematchCancel } from './live-state.js';

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static OPEN = 1;
  url: string;
  protocols?: string[];
  readyState = 0;
  sent: string[] = [];
  private listeners = new Map<string, Set<(event: unknown) => void>>();

  constructor(url: string, protocols?: string[]) {
    this.url = url;
    this.protocols = protocols;
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

  send(data: string): void {
    this.sent.push(data);
  }

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

  closeWith(code: number, reason: string): void {
    this.emit('close', { code, reason });
  }
}

function lastSocket(): FakeWebSocket {
  const socket = FakeWebSocket.instances.at(-1);
  if (!socket) throw new Error('no socket created');
  return socket;
}

const calls = {
  renders: 0,
  reconciles: 0,
  snapshotSounds: 0,
};

function bootChessSocket(): void {
  initSocket({
    render: () => {
      calls.renders += 1;
    },
    reconcileInteractionState: () => {
      calls.reconciles += 1;
    },
    maybePlaySnapshotSound: () => {
      calls.snapshotSounds += 1;
    },
  });
  connectSocket();
  lastSocket().open();
}

function helloFrame(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'hello',
    clientId: 'client-1',
    clients: 2,
    seat: 'white',
    solo: false,
    events: [{ type: 'room-created' }],
    state: { moveNumber: 0 },
    ...extra,
  };
}

describe('chess liveState socket adapter', () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeWebSocket);
    vi.useFakeTimers();
    calls.renders = 0;
    calls.reconciles = 0;
    calls.snapshotSounds = 0;
    liveState.room = 'adapter-test';
    liveState.socketUrl = 'ws://test.local/?room=adapter-test';
    liveState.clientId = '';
    liveState.connectionState = 'connecting';
    liveState.connectionNoticeTier = 'none';
    liveState.gameSpecId = null;
    liveState.seat = 'spectator';
    liveState.state = null;
    liveState.events = [];
    liveState.reconnectAttempt = 0;
    liveState.rematch = { offers: { white: false, black: false }, finalizedRoomId: null };
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('projects a hello frame into liveState and mirrors connection truth', () => {
    bootChessSocket();
    lastSocket().message(
      helloFrame({ paused: true, pauseReason: 'admin', abortDeadline: 123, rated: false }),
    );
    expect(liveState.connectionState).toBe('connected');
    expect(liveState.clientId).toBe('client-1');
    expect(liveState.seat).toBe('white');
    expect(liveState.clientCount).toBe(2);
    expect(liveState.events).toHaveLength(1);
    expect(liveState.state).toEqual({ moveNumber: 0 });
    expect(liveState.paused).toBe(true);
    expect(liveState.pauseReason).toBe('admin');
    expect(liveState.abortDeadline).toBe(123);
    expect(liveState.rated).toBe(false);
    expect(calls.reconciles).toBeGreaterThan(0);
    expect(calls.renders).toBeGreaterThan(0);
  });

  it('appends event-appended deltas to the event log', () => {
    bootChessSocket();
    lastSocket().message(helloFrame());
    lastSocket().message({
      type: 'event-appended',
      seq: 4,
      event: { type: 'move-played' },
      clients: 2,
      seat: 'white',
      solo: false,
      state: { moveNumber: 1 },
    });
    expect(liveState.events).toHaveLength(2);
    expect(liveState.state).toEqual({ moveNumber: 1 });
  });

  it('routes sounds by game spec: chess plays snapshot, dark xiangqi does not', () => {
    bootChessSocket();
    lastSocket().message(helloFrame());
    expect(calls.snapshotSounds).toBe(1);
    lastSocket().message(helloFrame({ gameSpecId: 'dark-xiangqi' }));
    expect(calls.snapshotSounds).toBe(1);
  });

  it('marks a vanished own offer as declined unless the player cancelled', () => {
    bootChessSocket();
    lastSocket().message(helloFrame());
    liveState.rematch = { offers: { white: true, black: false }, finalizedRoomId: null };
    lastSocket().message({ type: 'rematch:state', offers: {}, finalizedRoomId: null });
    expect(liveState.rematch.declined).toBe(true);

    liveState.rematch = { offers: { white: true, black: false }, finalizedRoomId: null };
    noteRematchCancel();
    lastSocket().message({ type: 'rematch:state', offers: {}, finalizedRoomId: null });
    expect(liveState.rematch.declined).toBeFalsy();
  });

  it('mirrors reconnect progress and notice tier into liveState', () => {
    bootChessSocket();
    lastSocket().message(helloFrame());
    lastSocket().closeWith(1006, '');
    expect(liveState.connectionState).toBe('reconnecting');
    expect(liveState.reconnectAttempt).toBe(1);
    vi.advanceTimersByTime(1_500);
    expect(liveState.connectionNoticeTier).toBe('dot');
    lastSocket().open();
    lastSocket().message(helloFrame());
    expect(liveState.connectionState).toBe('connected');
    expect(liveState.connectionNoticeTier).toBe('none');
  });
});
