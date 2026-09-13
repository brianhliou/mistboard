import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { track } from '../analytics.js';
import { setRestartBanner } from '../restart-banner.js';
import {
  createTenantSocketClient,
  SOCKET_FALLBACK_AFTER_FAILED_OPENS,
  SOCKET_OPEN_TIMEOUT_MS,
  type TenantSocketClientOptions,
  tenantReconnectDelayMs,
} from './socket-client.js';

vi.mock('../restart-banner.js', () => ({ setRestartBanner: vi.fn() }));
vi.mock('../analytics.js', () => ({ track: vi.fn() }));

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

function makeClient(overrides: Partial<TenantSocketClientOptions> = {}) {
  const calls = {
    hello: [] as unknown[],
    snapshot: [] as unknown[],
    event: [] as unknown[],
    rematch: [] as unknown[],
    renders: 0,
  };
  const client = createTenantSocketClient({
    room: 'dchess_socket-test',
    applyHello: (frame) => calls.hello.push(frame),
    applySnapshot: (frame) => calls.snapshot.push(frame),
    applyEvent: (frame) => calls.event.push(frame),
    onRematchState: (message) => calls.rematch.push(message),
    render: () => {
      calls.renders += 1;
    },
    ...overrides,
  });
  return { client, calls };
}

function lastSocket(): FakeWebSocket {
  const socket = FakeWebSocket.instances.at(-1);
  if (!socket) throw new Error('no socket created');
  return socket;
}

function memoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (key) => store.get(key) ?? null,
    key: (index) => [...store.keys()][index] ?? null,
    removeItem: (key) => {
      store.delete(key);
    },
    setItem: (key, value) => {
      store.set(key, value);
    },
  };
}

describe('tenant socket client', () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeWebSocket);
    // Fake Date too: the latency-sample throttle compares Date.now() deltas.
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
    });
    vi.mocked(setRestartBanner).mockClear();
    vi.mocked(track).mockClear();
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: memoryStorage(),
    });
    Object.defineProperty(window, 'sessionStorage', {
      configurable: true,
      value: memoryStorage(),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('caps reconnect backoff at 10 seconds', () => {
    expect([1, 2, 3, 4, 5, 6, 9].map(tenantReconnectDelayMs)).toEqual([
      750, 1_500, 3_000, 6_000, 10_000, 10_000, 10_000,
    ]);
  });

  it('connects, flips to connected on open, and sends only while open', () => {
    const { client } = makeClient();
    client.connect();
    expect(client.connection()).toBe('connecting');
    expect(client.send({ type: 'ping' })).toBe(false);
    lastSocket().open();
    expect(client.connection()).toBe('connected');
    expect(client.send({ type: 'ping', at: 1 })).toBe(true);
    expect(lastSocket().sent).toEqual([JSON.stringify({ type: 'ping', at: 1 })]);
  });

  it('maps duplicate-session and policy closes to terminal states without reconnecting', () => {
    const { client } = makeClient();
    client.connect();
    lastSocket().closeWith(4000, 'duplicate session');
    expect(client.connection()).toBe('displaced');
    vi.advanceTimersByTime(60_000);
    expect(FakeWebSocket.instances).toHaveLength(1);

    const rejected = makeClient().client;
    rejected.connect();
    lastSocket().closeWith(1008, 'private room');
    expect(rejected.connection()).toBe('rejected');
    expect(rejected.closeReason()).toBe('private room');
    vi.advanceTimersByTime(60_000);
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it('reconnects with backoff after an ordinary close', () => {
    const { client } = makeClient();
    client.connect();
    lastSocket().closeWith(1006, '');
    expect(client.connection()).toBe('reconnecting');
    expect(FakeWebSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(750);
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it('captures clientId and persists the seat token from hello', () => {
    const { client, calls } = makeClient();
    client.connect();
    lastSocket().open();
    lastSocket().message({
      type: 'hello',
      clientId: 'client-abc',
      seat: 'red',
      seatToken: 'a'.repeat(40),
    });
    expect(client.clientId()).toBe('client-abc');
    expect(calls.hello).toHaveLength(1);
    const stored = window.localStorage.getItem('mistboard.seatToken.dchess_socket-test');
    expect(stored).toContain('"seat":"red"');
    // The next connect attaches the stored token as the seat subprotocol.
    client.connect();
    expect(lastSocket().protocols).toEqual([`mistboard-seat.${'a'.repeat(40)}`]);
  });

  it('requests a fresh snapshot on an event sequence gap instead of applying it', () => {
    const { client, calls } = makeClient();
    client.connect();
    lastSocket().open();
    lastSocket().message({ type: 'snapshot', seat: 'white' });
    lastSocket().message({ type: 'event-appended', seq: 3, seat: 'white' });
    expect(calls.event).toHaveLength(1);
    lastSocket().message({ type: 'event-appended', seq: 7, seat: 'white' });
    expect(calls.event).toHaveLength(1);
    expect(lastSocket().sent).toContain(JSON.stringify({ type: 'snapshot:request' }));
    // A fresh snapshot resets the sequence and deltas flow again.
    lastSocket().message({ type: 'snapshot', seat: 'white' });
    lastSocket().message({ type: 'event-appended', seq: 8, seat: 'white' });
    expect(calls.event).toHaveLength(2);
  });

  it('routes rematch state to the tenant hook', () => {
    const { client, calls } = makeClient();
    client.connect();
    lastSocket().open();
    lastSocket().message({ type: 'rematch:state', offers: { white: true }, finalizedRoomId: null });
    expect(calls.rematch).toHaveLength(1);
    expect(calls.rematch[0]).toMatchObject({ offers: { white: true } });
  });

  it('marks an errored socket disconnected without scheduling a reconnect', () => {
    const { client } = makeClient();
    client.connect();
    lastSocket().open();
    lastSocket().emit('error', {});
    expect(client.connection()).toBe('disconnected');
    // The close event that follows an error is what schedules the retry.
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it('stages the reconnect notice and clears it on reconnect', () => {
    const { client } = makeClient();
    client.connect();
    lastSocket().open();
    lastSocket().closeWith(1006, '');
    expect(client.noticeTier()).toBe('none');
    vi.advanceTimersByTime(1_500);
    expect(client.noticeTier()).toBe('dot');
    vi.advanceTimersByTime(3_500);
    expect(client.noticeTier()).toBe('banner');
    lastSocket().open();
    expect(client.connection()).toBe('connected');
    expect(client.noticeTier()).toBe('none');
  });

  it('does not re-anchor the notice timers across reconnect churn', () => {
    const { client } = makeClient();
    client.connect();
    lastSocket().open();
    lastSocket().closeWith(1006, '');
    // First retry fires at 750ms and drops again at 1.2s — still inside the
    // original grace window, so the dot lands at 1.5s from the FIRST drop.
    vi.advanceTimersByTime(750);
    lastSocket().closeWith(1006, '');
    vi.advanceTimersByTime(750);
    expect(client.noticeTier()).toBe('dot');
  });

  it('tracks pong latency and throttles latency samples to one per minute', () => {
    const { client } = makeClient();
    client.connect();
    lastSocket().open();
    lastSocket().message({ type: 'pong', at: Date.now() - 42 });
    expect(client.latencyMs()).toBe(42);
    const samples = () =>
      lastSocket().sent.filter(
        (raw) => (JSON.parse(raw) as { type: string }).type === 'latency-sample',
      );
    expect(samples()).toHaveLength(1);
    expect(JSON.parse(samples()[0])).toEqual({ type: 'latency-sample', rttMs: 42 });

    vi.advanceTimersByTime(5_000);
    lastSocket().message({ type: 'pong', at: Date.now() - 17 });
    expect(client.latencyMs()).toBe(17);
    expect(samples()).toHaveLength(1);

    vi.advanceTimersByTime(60_000);
    lastSocket().message({ type: 'pong', at: Date.now() - 17 });
    expect(samples()).toHaveLength(2);
  });

  it('drives the restart banner from drain wire messages', () => {
    const { client } = makeClient();
    client.connect();
    lastSocket().open();
    lastSocket().message({ type: 'server_restart_scheduled', phase: 'pending', restartAt: 1_234 });
    expect(setRestartBanner).toHaveBeenLastCalledWith('pending');
    lastSocket().message({ type: 'server_restart_scheduled', phase: 'restarting' });
    expect(setRestartBanner).toHaveBeenLastCalledWith('restarting');
    lastSocket().message({ type: 'server_restart_cancelled' });
    expect(setRestartBanner).toHaveBeenLastCalledWith(null);
  });

  it('recovers from a silent drop on send', () => {
    const { client } = makeClient();
    client.connect();
    lastSocket().open();
    lastSocket().readyState = 0;
    expect(client.send({ type: 'ping' })).toBe(false);
    expect(client.connection()).toBe('reconnecting');
    vi.advanceTimersByTime(750);
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it('clears a send-armed reconnect once the socket opens', () => {
    const { client } = makeClient();
    client.connect();
    // Send while still CONNECTING arms a reconnect; opening must disarm it so
    // the timer cannot tear down the healthy socket later.
    expect(client.send({ type: 'ping' })).toBe(false);
    lastSocket().open();
    vi.advanceTimersByTime(60_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(client.connection()).toBe('connected');
  });

  it('reconnectNow retries immediately but never from terminal states', () => {
    const { client } = makeClient();
    client.connect();
    lastSocket().open();
    lastSocket().closeWith(1006, '');
    client.reconnectNow();
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(client.reconnectAttempt()).toBe(0);

    lastSocket().closeWith(4000, 'duplicate session');
    client.reconnectNow();
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(client.connection()).toBe('displaced');
  });

  it('close() tears down the pending reconnect', () => {
    const { client } = makeClient();
    client.connect();
    lastSocket().open();
    lastSocket().closeWith(1006, '');
    client.close();
    vi.advanceTimersByTime(60_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  // The socket host fallback. Prod dials socket.mistboard.com (a DNS-only
  // Railway hostname) first and the page origin second; the two paths do not
  // fail together, and on 2026-09-12 a matched correspondence pair in China
  // reached the board and never got a socket. Before this the only trace of
  // that was an unmoved seat row.
  const HOSTS = ['wss://socket.example.test/?room=r', 'wss://www.example.test/?room=r'];

  function hostsDialed(): string[] {
    return FakeWebSocket.instances.map((socket) => new URL(socket.url).host);
  }

  function drainBackoff(): void {
    vi.advanceTimersByTime(tenantReconnectDelayMs(1));
  }

  it('reports a socket that never opens and moves to the fallback host after two', () => {
    const { client } = makeClient({ socketUrls: HOSTS });
    client.connect();
    expect(hostsDialed()).toEqual(['socket.example.test']);

    // First open black-holes: the open timeout counts it and redials the primary.
    vi.advanceTimersByTime(SOCKET_OPEN_TIMEOUT_MS);
    expect(client.connection()).toBe('reconnecting');
    expect(track).toHaveBeenCalledWith(
      'socket_connect_failed',
      expect.objectContaining({ host: 'socket.example.test', failedOpens: 1, timedOut: true }),
    );
    drainBackoff();
    expect(hostsDialed()).toEqual(['socket.example.test', 'socket.example.test']);

    // Second one closes without opening: that is the threshold.
    lastSocket().closeWith(1006, '');
    expect(track).toHaveBeenCalledWith(
      'socket_connect_failed',
      expect.objectContaining({ host: 'socket.example.test', failedOpens: 2, code: 1006 }),
    );
    expect(track).toHaveBeenCalledWith('socket_host_fallback', {
      from: 'socket.example.test',
      to: 'www.example.test',
    });
    drainBackoff();
    expect(hostsDialed().at(-1)).toBe('www.example.test');
    expect(SOCKET_FALLBACK_AFTER_FAILED_OPENS).toBe(2);

    lastSocket().open();
    expect(client.connection()).toBe('connected');
    expect(window.sessionStorage.getItem('mistboard.socket.host')).toBe('fallback');
  });

  it('an open then a drop is not a failed open: a deploy restart stays on the primary', () => {
    const { client } = makeClient({ socketUrls: HOSTS });
    client.connect();
    lastSocket().open();
    lastSocket().closeWith(1006, '');
    drainBackoff();
    lastSocket().open();
    lastSocket().closeWith(1006, '');
    drainBackoff();
    lastSocket().open();
    expect(new Set(hostsDialed())).toEqual(new Set(['socket.example.test']));
    expect(track).not.toHaveBeenCalled();
  });

  it('a single failed open redials the primary, not the fallback', () => {
    const { client } = makeClient({ socketUrls: HOSTS });
    client.connect();
    lastSocket().closeWith(1006, '');
    drainBackoff();
    lastSocket().open();
    expect(hostsDialed()).toEqual(['socket.example.test', 'socket.example.test']);
    expect(track).toHaveBeenCalledTimes(1);
  });

  it('a later room in the same tab starts on the fallback host', () => {
    window.sessionStorage.setItem('mistboard.socket.host', 'fallback');
    const { client } = makeClient({ socketUrls: HOSTS });
    client.connect();
    expect(hostsDialed()).toEqual(['www.example.test']);
  });

  it('with one host there is nowhere to fall back to, and the client keeps redialing it', () => {
    const { client } = makeClient({ socketUrl: HOSTS[0] });
    client.connect();
    lastSocket().closeWith(1006, '');
    drainBackoff();
    lastSocket().closeWith(1006, '');
    vi.advanceTimersByTime(tenantReconnectDelayMs(2));
    expect(hostsDialed()).toEqual(Array(3).fill('socket.example.test'));
    expect(track).not.toHaveBeenCalledWith('socket_host_fallback', expect.anything());
  });

  it('the open timeout is disarmed by a successful open', () => {
    const { client } = makeClient({ socketUrls: HOSTS });
    client.connect();
    lastSocket().open();
    vi.advanceTimersByTime(SOCKET_OPEN_TIMEOUT_MS * 2);
    expect(client.connection()).toBe('connected');
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(track).not.toHaveBeenCalled();
  });
});
