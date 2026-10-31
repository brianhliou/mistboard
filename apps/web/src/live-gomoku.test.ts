import {
  applyGomokuRoomMove,
  createGomokuRoomState,
  type GomokuColor,
  type GomokuMove,
  type GomokuRoomState,
  getGomokuPlayerView,
} from '@mistboard/game';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { gomokuBoardSvg } from './gomoku-board.js';
import type {
  TenantSocketClientOptions,
  TenantSocketFrame,
} from './variant-tenant/socket-client.js';

const socket = vi.hoisted(() => ({
  options: null as TenantSocketClientOptions | null,
  sent: [] as unknown[],
  connection: 'connected',
}));
vi.mock('./variant-tenant/socket-client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./variant-tenant/socket-client.js')>();
  return {
    ...actual,
    createTenantSocketClient: (options: TenantSocketClientOptions) => {
      socket.options = options;
      return {
        connect: () => {},
        close: () => {},
        reconnectNow: () => {},
        startPing: () => {},
        send: (payload: unknown) => {
          socket.sent.push(payload);
          return true;
        },
        connection: () => socket.connection,
        noticeTier: () => 'none',
        closeReason: () => '',
        clientId: () => 'test-client',
        latencyMs: () => null,
        reconnectAttempt: () => 0,
      };
    },
  };
});

const ROOM = 'gmk_webtest';
const CREATED = { type: 'room-created', roomId: ROOM, gameSpecId: 'gomoku', at: 0 };
const line = ['a1', 'a2', 'b1', 'b2', 'c1', 'c2', 'd1', 'd2', 'e1'] as const;
const moves = line.map((to) => ({ to }));
const events = (count: number) => [
  CREATED,
  ...moves.slice(0, count).map((move, index) => ({
    type: 'move-played',
    color: index % 2 === 0 ? 'black' : 'white',
    move,
    at: index + 1,
    ply: index + 1,
  })),
];
function position(count: number) {
  return moves
    .slice(0, count)
    .reduce((state, move) => applyGomokuRoomMove(state, move), createGomokuRoomState(ROOM));
}

async function mount(state: GomokuRoomState, seat: GomokuColor | 'spectator', count = state.ply) {
  document.body.innerHTML = '<div id="app"></div>';
  window.history.replaceState(null, '', `/room/${ROOM}`);
  socket.sent = [];
  socket.options = null;
  socket.connection = 'connected';
  vi.resetModules();
  const { bootstrapGomokuLiveRoom } = await import('./live-gomoku.js');
  bootstrapGomokuLiveRoom();
  const options = socket.options as TenantSocketClientOptions | null;
  if (!options) throw new Error('no socket');
  options.applyHello({
    type: 'hello',
    seat,
    seats: { black: 'black-player', white: 'white-player' },
    state: getGomokuPlayerView(state, seat === 'white' ? 'white' : 'black', seat === 'spectator'),
    events: events(count),
    timeControl: { initialMs: 180_000, incrementMs: 2_000 },
    roomMode: 'pvp',
  } as TenantSocketFrame);
  options.render();
  return options;
}

function click(square: string) {
  document
    .querySelector<SVGElement>(`[data-square="${square}"] .gomoku-hit`)
    ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}
const sentMoves = () => socket.sent.filter((value) => (value as { type?: string }).type === 'move');

beforeEach(() => {
  vi.stubEnv('VITE_GOMOKU_ENABLED', 'true');
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{}', { status: 404 })),
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('hidden Gomoku live room', () => {
  it.each(['black', 'white'] as const)(
    'places one stone from the %s seat with a click or keyboard',
    async (seat) => {
      const state = position(seat === 'black' ? 0 : 1);
      await mount(state, seat);
      expect(document.querySelectorAll('[data-square]')).toHaveLength(225);
      expect(document.getElementById('app')?.classList.contains('live-route--gomoku')).toBe(true);
      click('h8');
      expect(sentMoves()).toEqual([{ type: 'move', to: 'h8' }]);
      const target = document.querySelector('[data-square="i8"] .gomoku-hit');
      target?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      expect(sentMoves()).toContainEqual({ type: 'move', to: 'i8' });
      // No speculative placement: only the next server frame can put a stone down.
      expect(document.querySelectorAll('[data-piece-square]')).toHaveLength(state.ply);
    },
  );

  it('blocks occupied points, the other turn, spectators, disconnected sockets and finished games', async () => {
    await mount(position(1), 'white');
    click('a1');
    expect(sentMoves()).toEqual([]);
    socket.connection = 'reconnecting';
    click('h8');
    expect(sentMoves()).toEqual([]);
    for (const seat of ['black', 'spectator'] as const) {
      await mount(position(1), seat);
      click('h8');
      expect(sentMoves()).toEqual([]);
    }
    await mount(position(9), 'black');
    click('h8');
    expect(sentMoves()).toEqual([]);
  });

  it('marks the latest placement and only highlights a completed winning line', async () => {
    await mount(position(8), 'black');
    expect(document.querySelectorAll('.gomoku-winning')).toHaveLength(0);
    const options = await mount(position(9), 'white');
    expect(document.querySelectorAll('.gomoku-winning')).toHaveLength(5);
    expect(document.querySelector('[data-square="e1"] .gomoku-last')).not.toBeNull();
    expect(document.querySelectorAll('[data-piece-square]')).toHaveLength(9);
    expect(document.querySelector('[data-replay="first"]')).not.toBeNull();
    document.querySelector<HTMLButtonElement>('[data-replay="first"]')?.click();
    expect(document.querySelectorAll('[data-piece-square]')).toHaveLength(0);
    click('h8');
    expect(sentMoves()).toEqual([]);
    // A reconnect rebuilds history and restores the terminal board, including its marks.
    options.applyHello({
      type: 'hello',
      seat: 'white',
      state: getGomokuPlayerView(position(9), 'white'),
      events: events(9),
    } as TenantSocketFrame);
    options.render();
    document.querySelector<HTMLButtonElement>('[data-replay="latest"]')?.click();
    expect(document.querySelectorAll('.gomoku-winning')).toHaveLength(5);
  });

  it('rebuilds every public ply after a live reload', async () => {
    await mount(position(6), 'black');
    expect(document.querySelectorAll('[data-piece-square]')).toHaveLength(6);
    document.querySelector<HTMLButtonElement>('[data-replay="first"]')?.click();
    expect(document.querySelectorAll('[data-piece-square]')).toHaveLength(0);
    document.querySelector<HTMLButtonElement>('[data-replay="next"]')?.click();
    expect(document.querySelector('[data-piece-square="a1"]')).not.toBeNull();
    expect(document.querySelector('[data-square="a1"] .gomoku-last')).not.toBeNull();
    click('h8');
    expect(sentMoves()).toEqual([]);
  });

  it('shows an overline in full and preserves every edge hit target when flipped', () => {
    let state = createGomokuRoomState(ROOM);
    for (const to of ['a1', 'a2', 'b1', 'b2', 'c1', 'c2', 'e1', 'e2', 'f1', 'f2', 'd1'])
      state = applyGomokuRoomMove(state, { to } as GomokuMove);
    const view = getGomokuPlayerView(state, 'black');
    expect(view.winningLine).toEqual(['a1', 'b1', 'c1', 'd1', 'e1', 'f1']);
    document.body.innerHTML = gomokuBoardSvg(view, false, true);
    expect(document.querySelectorAll('.gomoku-winning')).toHaveLength(6);
    expect(document.querySelectorAll('[data-square]')).toHaveLength(225);
    expect(document.querySelector('[data-square="o15"] .gomoku-hit')?.getAttribute('x')).toBe('16');
  });
});
