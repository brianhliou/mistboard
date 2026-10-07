// A cold join (fresh load or reload) to a FINISHED mahjong room must list every
// move. Before the fix the client filed the final view as ply 1 (it had captured
// nothing), so the list showed one move. Stepping back is not rebuilt: the wall
// stays a server secret, so the earlier plies cannot be reconstructed here.
// A LIVE cold join is unchanged.
//
// Drives the real mahjong room module (live-mahjong.ts) through a stubbed
// socket, with moves played through the mahjong kernel.

import {
  applyMahjongMove,
  createMahjongState,
  type MahjongMove,
  type MahjongTenantState,
  mahjongIsLegalMove,
  mahjongRevealedView,
  mahjongViewFor,
  orderedWall,
  seatName,
  shuffleWall,
} from '@mistboard/mahjong';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TenantLiveEvent } from './variant-tenant/live-client.js';
import type { TenantSocketClientOptions } from './variant-tenant/socket-client.js';

const socket = vi.hoisted(() => ({ options: null as TenantSocketClientOptions | null }));

vi.mock('./feature-flags.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./feature-flags.js')>();
  return { ...actual, mahjongEnabled: () => true };
});

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
        send: () => true,
        startPing: () => {},
        connection: () => 'connected',
        noticeTier: () => 'none',
        closeReason: () => '',
        clientId: () => 'test-client',
        latencyMs: () => null,
        reconnectAttempt: () => 0,
      };
    },
  };
});

const ROOM = 'mj_coldjoin';

function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Draw, discard the first tile held, let every claim window time out.
function nextMove(state: MahjongTenantState, at: number): MahjongMove {
  const by = seatName(state.game.turn);
  const phase = state.game.phase.type;
  if (phase === 'draw') return { action: 'draw', by, at };
  if (phase === 'claim-window') return { action: 'timeout', by, at };
  const hand = state.game.hands[state.game.turn] ?? [];
  const tile = hand.findIndex((count) => count > 0);
  return { action: 'discard', tile, by, at } as MahjongMove;
}

function play(plies: number): { states: MahjongTenantState[]; moves: MahjongMove[] } {
  let state = createMahjongState(shuffleWall(seededRng(3), orderedWall()), ROOM);
  const states = [state];
  const moves: MahjongMove[] = [];
  while (moves.length < plies && state.status.type === 'playing') {
    const move = nextMove(state, moves.length);
    if (!mahjongIsLegalMove(state, move)) throw new Error(`illegal ${move.action}`);
    state = applyMahjongMove(state, move);
    moves.push(move);
    states.push(state);
  }
  return { states, moves };
}

const GAME = play(24);
const PLIES = GAME.moves.length;
const FINAL: MahjongTenantState = {
  ...GAME.states[PLIES]!,
  status: { type: 'finished', winner: 'east', reason: 'resignation' },
};

function moveEvents(count: number): TenantLiveEvent[] {
  return GAME.moves.slice(0, count).map((move, index) => ({
    type: 'move-played',
    color: move.by,
    move,
    at: index,
    ply: index + 1,
  }));
}

const CREATED: TenantLiveEvent = { type: 'room-created', roomId: ROOM, at: 0 };
const FINISHED: TenantLiveEvent = {
  type: 'game-finished',
  winner: 'east',
  reason: 'resignation',
  at: 999,
};

async function mount(): Promise<TenantSocketClientOptions> {
  document.body.innerHTML = '<div id="app"></div>';
  window.history.replaceState(null, '', `/room/${ROOM}`);
  socket.options = null;
  vi.resetModules();
  const { bootstrapMahjongLiveRoom } = await import('./live-mahjong.js');
  bootstrapMahjongLiveRoom();
  if (!socket.options) throw new Error('socket was not created');
  return socket.options;
}

function frame(type: 'hello' | 'snapshot', extra: Record<string, unknown>) {
  return { type, seat: 'east', seats: {}, ...extra };
}

// Every played ply renders a cell with text (a move label, or '...' for a seat
// the two-column list has no column for); unplayed cells are empty.
function playedCells(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('.mahjong-move-row__move')].filter(
    (cell) => cell.textContent !== '',
  );
}

beforeEach(() => {
  document.body.innerHTML = '';
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{}', { status: 404 })),
  );
});

describe('cold join to a finished mahjong room', () => {
  it('lists every move', async () => {
    expect(PLIES).toBe(24);
    const options = await mount();
    options.applyHello(
      frame('hello', {
        seat: 'spectator',
        state: mahjongRevealedView(FINAL, 'spectator'),
        events: [CREATED, ...moveEvents(PLIES), FINISHED],
      }),
    );
    options.render();
    expect(playedCells()).toHaveLength(PLIES);
  });

  it('a seated player reloading a finished room gets the same list', async () => {
    const options = await mount();
    options.applySnapshot(
      frame('snapshot', {
        seat: 'south',
        state: mahjongRevealedView(FINAL, 'south'),
        events: [CREATED, ...moveEvents(PLIES), FINISHED],
      }),
    );
    options.render();
    expect(playedCells()).toHaveLength(PLIES);
  });
});

describe('cold join to a LIVE mahjong room is unchanged', () => {
  it('a seat keeps the single view it was sent', async () => {
    const options = await mount();
    const mid = PLIES / 2;
    options.applyHello(
      frame('hello', {
        seat: 'east',
        state: mahjongViewFor(GAME.states[mid]!, 'east'),
        events: [CREATED, ...moveEvents(mid)],
      }),
    );
    options.render();
    expect(playedCells()).toHaveLength(1);
    const prev = document.querySelector<HTMLButtonElement>('[data-replay="prev"]');
    expect(prev?.disabled).toBe(true);
  });
});
