import {
  createInitialBanqiState,
  createInitialJieqiState,
  getBanqiPlayerView,
  getJieqiPlayerView,
} from '@mistboard/game';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writeAccountPreference } from '../account-preferences.js';
import { track } from '../analytics.js';
import { correspondencePreview, nextCorrespondenceGame } from '../correspondence-room.js';
import { clearRestartingBanner, setRestartBanner } from '../restart-banner.js';
import {
  createTenantSocketClient,
  SOCKET_FALLBACK_AFTER_FAILED_OPENS,
  SOCKET_OPEN_TIMEOUT_MS,
  type TenantSocketClient,
  type TenantSocketClientOptions,
  tenantReconnectDelayMs,
} from './socket-client.js';

vi.mock('../restart-banner.js', () => ({
  setRestartBanner: vi.fn(),
  clearRestartingBanner: vi.fn(),
}));
vi.mock('../analytics.js', () => ({ track: vi.fn() }));

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static OPEN = 1;
  static CONNECTING = 0;
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
    this.readyState = 3;
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
  clients.push(client);
  return { client, calls };
}

const clients: TenantSocketClient[] = [];

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
    document.body.innerHTML = '<div class="board-shell"><div data-board></div></div>';
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
    for (const client of clients.splice(0)) client.close();
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('caps reconnect backoff at 10 seconds', () => {
    expect([1, 2, 3, 4, 5, 6, 9].map(tenantReconnectDelayMs)).toEqual([
      750, 1_500, 3_000, 6_000, 10_000, 10_000, 10_000,
    ]);
  });

  function correspondence(
    view = {
      id: 'confirmation',
      board: { a1: { color: 'red', role: 'chariot' } },
      legalMoves: [{ from: 'a1', to: 'a2' }],
      status: { type: 'playing', turn: 'red' },
    },
    mode = 'correspondence',
  ) {
    const { client } = makeClient();
    client.connect();
    const socket = lastSocket();
    socket.open();
    socket.message({ type: 'hello', mode, seat: 'red', state: view });
    return { client, socket };
  }

  function action(which: 'confirm' | 'cancel') {
    const button = document.querySelector<HTMLButtonElement>(`[data-correspondence-${which}]`);
    if (!button) throw new Error(`missing ${which}`);
    return button;
  }

  it('holds a correspondence move until the player confirms it', () => {
    const { client, socket } = correspondence();
    const move = { type: 'move', from: 'a1', to: 'a2' };
    expect(client.send(move)).toBe(false);
    expect(socket.sent).toEqual([]);
    const confirm = action('confirm');
    confirm.click();
    confirm.click();
    expect(socket.sent.map((message) => JSON.parse(message))).toEqual([move]);
  });

  it('previews the visible piece without changing canonical state and Cancel restores it', () => {
    const { client, socket, calls } = (() => {
      const made = makeClient();
      made.client.connect();
      const socket = lastSocket();
      socket.open();
      return { ...made, socket };
    })();
    socket.message({
      type: 'hello',
      mode: 'correspondence',
      seat: 'red',
      state: {
        id: 'cancel',
        board: { a1: { color: 'red', role: 'chariot' } },
        status: { type: 'playing', turn: 'red' },
        legalMoves: [{ from: 'a1', to: 'a2' }],
      },
    });
    const view = (calls.hello[0] as { state: { board: Record<string, unknown> } }).state;
    const original = JSON.stringify(view);
    client.send({ type: 'move', from: 'a1', to: 'a2' });
    expect(correspondencePreview('dchess_socket-test', view).board).toEqual({ a2: view.board.a1 });
    expect(JSON.stringify(view)).toBe(original);
    expect(document.querySelector<HTMLElement>('[data-board]')!.inert).toBe(true);
    const staleConfirm = action('confirm');
    action('cancel').click();
    staleConfirm.click();
    expect(correspondencePreview('dchess_socket-test', view)).toBe(view);
    expect(document.querySelector<HTMLElement>('[data-board]')!.inert).toBe(false);
    expect(socket.sent).toEqual([]);
  });

  it('puts Confirm and Cancel under the board, never beside it in the center row', () => {
    // The live room layout (live-layout.ts): the center is a flex row, so a box
    // placed next to .board-shell squeezes the board to half width on a phone.
    document.body.innerHTML =
      '<div class="review-shell__center"><div class="board-shell"><div class="board-stage"><div data-board></div></div></div></div>';
    const made = makeClient();
    made.client.connect();
    const socket = lastSocket();
    socket.open();
    socket.message({
      type: 'hello',
      mode: 'correspondence',
      seat: 'red',
      state: {
        id: 'placement',
        board: { a1: { color: 'red', role: 'chariot' } },
        status: { type: 'playing', turn: 'red' },
        legalMoves: [{ from: 'a1', to: 'a2' }],
      },
    });
    made.client.send({ type: 'move', from: 'a1', to: 'a2' });
    const box = document.querySelector('.correspondence-room');
    expect(box?.parentElement?.classList.contains('board-shell')).toBe(true);
    expect(box?.previousElementSibling?.classList.contains('board-stage')).toBe(true);
    expect(document.querySelector('.review-shell__center')!.children).toHaveLength(1);
  });

  it.each(['banqi', 'jieqi'])('never reveals a hidden %s piece in the whole preview', (spec) => {
    const view =
      spec === 'banqi'
        ? getBanqiPlayerView(createInitialBanqiState('masked'), 'red')
        : getJieqiPlayerView(createInitialJieqiState('masked'), 'red');
    const { client, calls } = makeClient();
    client.connect();
    const socket = lastSocket();
    socket.open();
    socket.message({
      type: 'hello',
      mode: 'correspondence',
      gameSpecId: spec,
      seat: 'red',
      state: view,
    });
    const received = (calls.hello[0] as { state: typeof view }).state;
    const move = spec === 'banqi' ? { from: 'a1', to: 'a1' } : view.legalMoves[0];
    const original = JSON.stringify(received);
    client.send({ type: 'move', ...move });
    const preview = correspondencePreview('dchess_socket-test', received);
    const board: Record<string, unknown> = { ...received.board };
    if (move.from !== move.to) {
      board[move.to] = board[move.from];
      delete board[move.from];
    }
    expect(JSON.parse(JSON.stringify(preview))).toEqual(
      JSON.parse(
        JSON.stringify({
          ...received,
          board,
          legalMoves: [],
          lastMove: move,
        }),
      ),
    );
    expect(JSON.stringify(received)).toBe(original);
    expect(socket.sent).toEqual([]);
    action('confirm').click();
    expect(socket.sent.map((message) => JSON.parse(message))).toEqual([{ type: 'move', ...move }]);
  });

  it.each(['preference off', 'timed'])('sends immediately for %s', (kind) => {
    if (kind === 'preference off') writeAccountPreference('confirmCorrespondenceMoves', false);
    const { client, socket } = correspondence(
      undefined,
      kind === 'timed' ? 'pvp' : 'correspondence',
    );
    const move = { type: 'move', from: 'a1', to: 'a2' };
    expect(client.send(move)).toBe(true);
    expect(socket.sent.map((message) => JSON.parse(message))).toEqual([move]);
    expect(document.querySelector('[data-correspondence-confirm]')).toBeNull();
  });

  it.each([
    {
      name: 'Gomoku placement',
      board: Array(225).fill(null),
      move: { to: 'b2' },
      expected: { 16: 'red' },
    },
    {
      name: 'pocket drop',
      board: {},
      move: { drop: 'horse', to: 'b2' },
      expected: { b2: { color: 'red', role: 'horse' } },
    },
    {
      name: 'Duck turn',
      board: { a1: { color: 'red', role: 'chariot' } },
      move: { from: 'a1', to: 'a2', duckTo: 'b2' },
      expected: { a2: { color: 'red', role: 'chariot' } },
    },
    {
      name: 'FFQ flip',
      board: [{ faceDown: true }],
      move: { from: 0, to: 0 },
      expected: { 0: { faceDown: true } },
    },
    {
      name: 'FFQ move',
      board: [{ faceDown: false, color: 'red', role: 'horse' }, null],
      move: { from: 0, to: 1 },
      expected: { 0: null, 1: { faceDown: false, color: 'red', role: 'horse' } },
    },
  ])('previews $name on the shared path', ({ board, move, expected }) => {
    const { client, calls } = makeClient();
    client.connect();
    const socket = lastSocket();
    socket.open();
    socket.message({
      type: 'hello',
      mode: 'correspondence',
      seat: 'red',
      state: {
        id: 'shapes',
        board,
        status: { type: 'playing', turn: 'red' },
        legalMoves: [move],
      },
    });
    const view = (calls.hello[0] as { state: { board: typeof board; duck?: string } }).state;
    client.send({ type: 'move', ...move });
    const preview = correspondencePreview('dchess_socket-test', view);
    expect(preview.board).toMatchObject(expected);
    if ('duckTo' in move) expect(preview.duck).toBe(move.duckTo);
    expect(socket.sent).toEqual([]);
    action('cancel').click();
    expect(correspondencePreview('dchess_socket-test', view)).toBe(view);
  });

  it('renders a Fog Chess move into fog without revealing any other point', () => {
    const { client, calls } = makeClient();
    client.connect();
    const socket = lastSocket();
    socket.open();
    socket.message({
      type: 'hello',
      mode: 'correspondence',
      seat: 'white',
      state: {
        id: 'fog',
        variant: 'dark-chess',
        board: { a1: { role: 'rook', color: 'white' } },
        visibleSquares: ['a1'],
        legalMoves: [{ from: 'a1', to: 'a8' }],
        status: { type: 'playing', turn: 'white' },
      },
    });
    const view = (calls.hello[0] as { state: unknown }).state;
    client.send({ type: 'move', from: 'a1', to: 'a8' });
    expect(JSON.parse(JSON.stringify(correspondencePreview('dchess_socket-test', view)))).toEqual({
      id: 'fog',
      variant: 'dark-chess',
      board: { a8: { role: 'rook', color: 'white' } },
      visibleSquares: ['a1', 'a8'],
      legalMoves: [],
      status: { type: 'playing', turn: 'white' },
      lastMove: { from: 'a1', to: 'a8' },
    });
    expect(socket.sent).toEqual([]);
  });

  it('does not let a detached confirm button send a later selection', () => {
    const { client, socket } = correspondence();
    client.send({ type: 'move', from: 'a1', to: 'a2' });
    const stale = action('confirm');
    action('cancel').click();
    client.send({ type: 'move', from: 'a1', to: 'a3' });
    stale.click();
    expect(socket.sent).toEqual([]);
    action('confirm').click();
    expect(socket.sent.map((message) => JSON.parse(message))).toEqual([
      { type: 'move', from: 'a1', to: 'a3' },
    ]);
  });

  it.each(['snapshot', 'disconnect', 'close'])('invalidates a pending confirm on %s', (change) => {
    const { client, socket } = correspondence();
    client.send({ type: 'move', from: 'a1', to: 'a2' });
    const confirm = action('confirm');
    if (change === 'snapshot') socket.message({ type: 'snapshot', seat: 'red', paused: true });
    else if (change === 'disconnect') socket.closeWith(1006, '');
    else client.close();
    confirm.click();
    expect(socket.sent).toEqual([]);
  });

  it('refreshes the next-game link after the move is accepted, excluding this room', async () => {
    const game = (roomId: string, isYourMove: boolean, dueAt: string) => ({
      roomId,
      isYourMove,
      dueAt,
      url: `/room/${roomId}`,
      gameSpecId: 'xiangqi',
      mySeat: 'red',
      opponentName: null,
    });
    const games = [
      game('later', true, '2026-11-16'),
      game('not-mine', false, '2026-11-13'),
      game('oldest', true, '2026-11-14'),
      game('dchess_socket-test', true, '2026-11-12'),
    ];
    expect(nextCorrespondenceGame(games, 'dchess_socket-test')).toEqual({
      next: games[2],
      count: 2,
    });
    const fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ games, yourMoveCount: 3 }),
    }));
    vi.stubGlobal('fetch', fetch);
    const { client, socket } = correspondence();
    client.send({ type: 'move', from: 'a1', to: 'a2' });
    action('confirm').click();
    expect(fetch).not.toHaveBeenCalled();
    // A presence-only snapshot cannot acknowledge the move.
    socket.message({ type: 'snapshot', seat: 'red' });
    expect(fetch).not.toHaveBeenCalled();
    socket.message({
      type: 'snapshot',
      seat: 'red',
      state: {
        id: 'confirmation',
        board: { a2: { color: 'red', role: 'chariot' } },
        legalMoves: [],
        status: { type: 'playing', turn: 'black' },
      },
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(
      document.querySelector<HTMLAnchorElement>('.correspondence-room a')?.getAttribute('href'),
    ).toBe('/room/oldest');
    expect(document.querySelector('.correspondence-room')?.textContent).toContain(
      'Next game (2 waiting)',
    );
    expect(nextCorrespondenceGame([games[1], games[3]], 'dchess_socket-test')).toEqual({
      next: null,
      count: 0,
    });
    expect(document.querySelector('a[href="/correspondence"]')).not.toBeNull();
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

  it('backs off when a server accepts the socket and closes it before any hello', () => {
    const { client } = makeClient();
    client.connect();
    const delays: number[] = [];
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      lastSocket().open();
      lastSocket().closeWith(1011, 'persistence failure');
      expect(client.reconnectAttempt()).toBe(attempt);
      delays.push(tenantReconnectDelayMs(client.reconnectAttempt()));
      const before = FakeWebSocket.instances.length;
      vi.advanceTimersByTime(delays[delays.length - 1]! - 1);
      expect(FakeWebSocket.instances).toHaveLength(before);
      vi.advanceTimersByTime(1);
      expect(FakeWebSocket.instances).toHaveLength(before + 1);
    }
    expect(delays).toEqual([750, 1_500, 3_000, 6_000]);
    lastSocket().open();
    lastSocket().message({ type: 'hello', clientId: 'served' });
    expect(client.reconnectAttempt()).toBe(0);
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
    expect(setRestartBanner).toHaveBeenLastCalledWith('pending', 1_234);
    lastSocket().message({ type: 'server_restart_scheduled', phase: 'restarting' });
    expect(setRestartBanner).toHaveBeenLastCalledWith('restarting', undefined);
    lastSocket().message({ type: 'server_restart_cancelled' });
    expect(setRestartBanner).toHaveBeenLastCalledWith(null);
  });

  it('clears the restart banner on hello, after the new server accepts the connection', () => {
    const { client } = makeClient();
    client.connect();
    lastSocket().open();
    lastSocket().message({ type: 'server_restart_scheduled', phase: 'restarting' });
    lastSocket().closeWith(1001, 'server shutting down');
    vi.advanceTimersByTime(750);
    lastSocket().open();
    expect(vi.mocked(setRestartBanner).mock.calls.at(-1)?.[0]).toBe('restarting');
    vi.mocked(clearRestartingBanner).mockClear();
    lastSocket().message({ type: 'hello', clientId: 'returned' });
    expect(clearRestartingBanner).toHaveBeenCalledTimes(1);
  });

  it('keeps a pending drain notice when a hello comes from the server still draining', () => {
    const { client } = makeClient();
    client.connect();
    lastSocket().open();
    lastSocket().message({
      type: 'server_restart_scheduled',
      phase: 'pending',
      restartAt: 9_999_999,
    });
    vi.mocked(setRestartBanner).mockClear();
    lastSocket().message({ type: 'hello', clientId: 'same-server' });
    expect(setRestartBanner).not.toHaveBeenCalledWith(null);
  });

  it.each(['visibilitychange', 'online'])('reconnects immediately on %s during backoff', (type) => {
    const { client } = makeClient();
    client.connect();
    lastSocket().open();
    lastSocket().closeWith(1006, '');
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    (type === 'online' ? window : document).dispatchEvent(new Event(type));
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(client.reconnectAttempt()).toBe(0);
    lastSocket().open();
    vi.advanceTimersByTime(750);
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it('also wakes a failed initial open and a silently closed connected socket', () => {
    const { client } = makeClient();
    window.dispatchEvent(new Event('online'));
    expect(FakeWebSocket.instances).toHaveLength(0);
    client.connect();
    lastSocket().closeWith(1006, '');
    window.dispatchEvent(new Event('online'));
    expect(FakeWebSocket.instances).toHaveLength(2);
    lastSocket().open();
    // A sleeping tab can observe CLOSED before receiving the close event.
    lastSocket().readyState = 3;
    window.dispatchEvent(new Event('online'));
    expect(FakeWebSocket.instances).toHaveLength(3);
  });

  it('ignores hidden tabs, healthy sockets, and a wake while a reconnect is already dialing', () => {
    const { client } = makeClient();
    client.connect();
    lastSocket().open();
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('online'));
    expect(FakeWebSocket.instances).toHaveLength(1);
    lastSocket().closeWith(1006, '');
    visibility.mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(FakeWebSocket.instances).toHaveLength(1);
    window.dispatchEvent(new Event('online'));
    expect(FakeWebSocket.instances).toHaveLength(2);
    visibility.mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it.each([4000, 1008])('does not wake a terminal socket closed with %s', (code) => {
    const { client } = makeClient();
    client.connect();
    lastSocket().closeWith(code, code === 4000 ? 'duplicate session' : 'private room');
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('online'));
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it('removes wake listeners on close so an old client cannot reclaim the seat', () => {
    const { client } = makeClient();
    client.connect();
    lastSocket().closeWith(1006, '');
    client.close();
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('online'));
    vi.advanceTimersByTime(10_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
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
