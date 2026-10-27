// Three Kingdoms banqi (#628) local-playtest room: drives the real room module
// (live-three-kingdoms-banqi.ts) through a stubbed socket. The board draws all
// 45 points with a hit target each, a click on a face-down tile sends the flip,
// a click on an own piece then a target sends the move, and a live reload steps
// through the server's per-ply masked views without ever seeing an identity.

import {
  applyThreeKingdomsBanqiMove,
  type BanqiSeat,
  createThreeKingdomsBanqiSetup,
  createThreeKingdomsBanqiStateFromSetup,
  getThreeKingdomsBanqiLegalMoves,
  getThreeKingdomsBanqiPlayerView,
  type ThreeKingdomsBanqiMove,
  type ThreeKingdomsBanqiState,
} from '@mistboard/game';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ThreeKingdomsBanqiWireView } from './live-three-kingdoms-banqi.js';
import type { TenantLiveEvent } from './variant-tenant/live-client.js';
import type {
  TenantSocketClientOptions,
  TenantSocketFrame,
} from './variant-tenant/socket-client.js';

const socket = vi.hoisted(() => ({
  options: null as TenantSocketClientOptions | null,
  sent: [] as unknown[],
}));

vi.mock('./feature-flags.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./feature-flags.js')>();
  return { ...actual, threeKingdomsBanqiEnabled: () => true };
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
        send: (payload: unknown) => {
          socket.sent.push(payload);
          return true;
        },
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

const ROOM = 'tkb_webtest';

function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

// A short line: flips until each side has a piece up, then quiet moves.
function playLine(plies: number): {
  states: ThreeKingdomsBanqiState[];
  moves: ThreeKingdomsBanqiMove[];
} {
  let state = createThreeKingdomsBanqiStateFromSetup(
    ROOM,
    createThreeKingdomsBanqiSetup(seeded(7)),
  );
  const states = [state];
  const moves: ThreeKingdomsBanqiMove[] = [];
  for (let ply = 0; ply < plies && state.status.type === 'playing'; ply += 1) {
    const legal = getThreeKingdomsBanqiLegalMoves(state);
    const move = legal.find((m) => m.from !== m.to) ?? legal[0]!;
    state = applyThreeKingdomsBanqiMove(state, move);
    moves.push(move);
    states.push(state);
  }
  return { states, moves };
}

function view(state: ThreeKingdomsBanqiState, seat: BanqiSeat): ThreeKingdomsBanqiWireView {
  return getThreeKingdomsBanqiPlayerView(state, seat) as ThreeKingdomsBanqiWireView;
}

async function mount(): Promise<TenantSocketClientOptions> {
  document.body.innerHTML = '<div id="app"></div>';
  window.history.replaceState(null, '', `/room/${ROOM}`);
  socket.options = null;
  socket.sent = [];
  vi.resetModules();
  const { bootstrapThreeKingdomsBanqiLiveRoom } = await import('./live-three-kingdoms-banqi.js');
  bootstrapThreeKingdomsBanqiLiveRoom();
  if (!socket.options) throw new Error('socket was not created');
  return socket.options;
}

// The wire hello carries the tenant view and events beyond the core frame type.
function hello(frame: Record<string, unknown>): TenantSocketFrame {
  return frame as TenantSocketFrame;
}

const CREATED: TenantLiveEvent = { type: 'room-created', roomId: ROOM, at: 0 };

function moveEvents(moves: readonly ThreeKingdomsBanqiMove[]): TenantLiveEvent[] {
  return moves.map((move, index) => ({
    type: 'move-played',
    color: index % 2 === 0 ? 'red' : 'black',
    move,
    at: index + 1,
    ply: index + 1,
  }));
}

function click(square: string): void {
  const hit = document.querySelector(`[data-square="${square}"] rect`);
  if (!hit) throw new Error(`no hit target on ${square}`);
  hit.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, isPrimary: true }));
  hit.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, isPrimary: true }));
  hit.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

function moveMessages(): unknown[] {
  return socket.sent.filter((p) => (p as { type?: string }).type === 'move');
}

beforeEach(() => {
  document.body.innerHTML = '';
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{}', { status: 404 })),
  );
});

describe('Three Kingdoms banqi live room', () => {
  it('draws 45 points, every setup tile face down, and the score line', async () => {
    const { states } = playLine(0);
    const options = await mount();
    options.applyHello(
      hello({
        type: 'hello',
        seat: 'red',
        state: view(states[0]!, 'red'),
        events: [CREATED],
      }),
    );
    options.render();
    expect(document.querySelectorAll('[data-square]')).toHaveLength(45);
    const pieces = document.querySelectorAll('[data-piece-square]');
    expect(pieces.length).toBe(Object.keys(states[0]!.board).length);
    expect(document.querySelectorAll('[data-piece-square] image')).toHaveLength(0);
    expect(document.querySelector('.tk-banqi-scores')?.textContent).toContain('first to 100');
  });

  it('a click on a face-down tile sends that flip', async () => {
    const { states } = playLine(0);
    const options = await mount();
    options.applyHello(
      hello({
        type: 'hello',
        seat: 'red',
        state: view(states[0]!, 'red'),
        events: [CREATED],
      }),
    );
    options.render();
    const flip = getThreeKingdomsBanqiLegalMoves(states[0]!).find((m) => m.from === m.to)!;
    click(flip.from);
    expect(moveMessages()).toContainEqual({ type: 'move', from: flip.from, to: flip.to });
  });

  it('own piece then a target sends the move; the other seat sends nothing', async () => {
    const { states } = playLine(12);
    // A ply where red is on turn with a board move available.
    const index = states.findIndex(
      (s) =>
        s.status.type === 'playing' &&
        s.status.turn === 'red' &&
        getThreeKingdomsBanqiLegalMoves(s).some((m) => m.from !== m.to),
    );
    expect(index).toBeGreaterThan(0);
    const state = states[index]!;
    const move = getThreeKingdomsBanqiLegalMoves(state).find((m) => m.from !== m.to)!;

    const options = await mount();
    options.applyHello(
      hello({
        type: 'hello',
        seat: 'black',
        state: view(state, 'black'),
        events: [CREATED],
      }),
    );
    options.render();
    click(move.from);
    click(move.to);
    expect(moveMessages()).toEqual([]);

    const red = await mount();
    red.applyHello(
      hello({
        type: 'hello',
        seat: 'red',
        state: view(state, 'red'),
        events: [CREATED],
      }),
    );
    red.render();
    click(move.from);
    click(move.to);
    expect(moveMessages()).toContainEqual({ type: 'move', from: move.from, to: move.to });
  });

  it('a live reload steps back through the per-ply masked views it was sent', async () => {
    const { states, moves } = playLine(10);
    const last = moves.length;
    const liveHistory = states.map((s, ply) => ({ ply, view: view(s, 'red') }));
    const options = await mount();
    options.applyHello(
      hello({
        type: 'hello',
        seat: 'red',
        state: view(states[last]!, 'red'),
        events: [CREATED, ...moveEvents(moves)],
        liveHistory,
      }),
    );
    options.render();
    // Revealed pieces draw their art, so the face-down check below is not vacuous.
    expect(document.querySelectorAll('[data-piece-square] image').length).toBeGreaterThan(0);
    const first = document.querySelector<HTMLButtonElement>('[data-replay="first"]');
    expect(first?.disabled).toBe(false);
    first?.click();
    expect(document.querySelectorAll('[data-piece-square] image')).toHaveLength(0);
  });
});
