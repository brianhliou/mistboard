// Three Kingdoms banqi (#628) local-playtest room: drives the real room module
// (live-three-kingdoms-banqi.ts) through a stubbed socket. The board draws all
// 45 points with a hit target each, a click on a face-down tile sends the flip,
// a click on an own piece then a target sends the move, and a live reload steps
// through the server's per-ply masked views without ever seeing an identity.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
import { renderBanqiMaterial } from './banqi-material.js';
import { banqiRevealOdds } from './banqi-reveal-odds.js';
import type { ThreeKingdomsBanqiWireView } from './live-three-kingdoms-banqi.js';
import { TK_LIVE_BOARD_VIEW } from './three-kingdoms-banqi-diagrams.js';
import type { TenantLiveEvent } from './variant-tenant/live-client.js';
import type {
  TenantSocketClientOptions,
  TenantSocketFrame,
} from './variant-tenant/socket-client.js';

const socket = vi.hoisted(() => ({
  options: null as TenantSocketClientOptions | null,
  sent: [] as unknown[],
  connection: 'connected' as string,
  closeReason: '',
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
        connection: () => socket.connection,
        noticeTier: () => 'none',
        closeReason: () => socket.closeReason,
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
  socket.connection = 'connected';
  socket.closeReason = '';
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
  it('draws 45 points, every setup tile face down, the seat points and the tally', async () => {
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
    // Points beside each seat's name, the target once in the game card.
    const tags = [...document.querySelectorAll('.clock-seat-tag')].map((el) => el.textContent);
    expect(tags).toEqual(['0 pts', '0 pts']);
    expect(document.body.textContent).toContain('First to 100 points');
    expect(document.body.textContent?.match(/First to 100 points/g)).toHaveLength(1);
    // Banqi's face-down tally, 16 a side, and no quiet-move line this early.
    expect(document.querySelector('.hidden-pool__row')).not.toBeNull();
    expect(document.querySelector('.tk-banqi-moves-left')).toBeNull();
    expect(document.body.textContent).not.toContain('Quiet moves');
  });

  it('says how many moves are left only from 30 quiet moves on', async () => {
    const { states } = playLine(12);
    const base = view(states[12]!, 'red');
    const lineAt = async (noProgressClock: number) => {
      const options = await mount();
      options.applyHello(
        hello({
          type: 'hello',
          seat: 'red',
          state: { ...base, noProgressClock },
          events: [CREATED],
        }),
      );
      options.render();
      return document.querySelector('.tk-banqi-moves-left')?.textContent ?? null;
    };
    expect(await lineAt(29)).toBeNull();
    expect(await lineAt(30)).toBe('10 moves left before the game is decided on points');
    expect(await lineAt(38)).toBe('2 moves left before the game is decided on points');
    expect(await lineAt(39)).toBe('1 move left before the game is decided on points');
  });

  // The playtest is gated on the server: a non-admin's socket closes 1008
  // 'game spec disabled', and the room says it is admin-only rather than
  // drawing a dead board or calling the room inactive.
  it('a refused socket says the playtest is admin-only', async () => {
    const options = await mount();
    socket.connection = 'rejected';
    socket.closeReason = 'game spec disabled';
    options.render();
    expect(document.body.textContent).toContain('opens only for admin accounts');
    socket.closeReason = 'room unavailable';
    options.render();
    expect(document.body.textContent).not.toContain('opens only for admin accounts');
  });

  // Hidden information: the strips, the tally and its reveal odds are built from
  // the masked view alone. Swapping two face-down tiles of different identity
  // in the truth changes nothing a seat is sent, so nothing drawn may change.
  it('material and reveal odds do not change when two face-down tiles swap', async () => {
    const { states, moves } = playLine(12);
    const truth = states[12]!;
    const down = (
      Object.entries(truth.board) as [
        string,
        NonNullable<(typeof truth.board)[keyof typeof truth.board]>,
      ][]
    ).filter(([, piece]) => piece.faceDown);
    const a = down[0]!;
    const b = down.find(([, p]) => p.color !== a[1].color || p.role !== a[1].role)!;
    expect(b, 'no two face-down tiles differ').toBeDefined();
    const swapped: ThreeKingdomsBanqiState = {
      ...truth,
      board: { ...truth.board, [a[0]]: b[1], [b[0]]: a[1] },
    };
    expect(swapped.board).not.toEqual(truth.board);

    const drawn = (state: ThreeKingdomsBanqiState) => {
      const masked = view(state, 'red');
      const slots = {
        capturesTop: document.createElement('div'),
        capturesBottom: document.createElement('div'),
        hiddenPool: document.createElement('div'),
      };
      renderBanqiMaterial(slots, masked, 'red', moves);
      return {
        view: JSON.stringify(masked),
        odds: banqiRevealOdds(masked),
        html: [slots.capturesTop, slots.capturesBottom, slots.hiddenPool].map((el) => el.innerHTML),
      };
    };
    const before = drawn(truth);
    expect(before.odds.total).toBeGreaterThan(0);
    expect(drawn(swapped)).toEqual(before);

    // And the mounted room, which only ever sees the wire view.
    const roomPool = async (state: ThreeKingdomsBanqiState) => {
      const options = await mount();
      options.applyHello(
        hello({
          type: 'hello',
          seat: 'red',
          state: view(state, 'red'),
          events: [CREATED, ...moveEvents(moves)],
        }),
      );
      options.render();
      return document.querySelector('[data-hidden-pool]')?.innerHTML ?? '';
    };
    const roomBefore = await roomPool(truth);
    expect(roomBefore).toContain('hidden-pool__chip');
    expect(await roomPool(swapped)).toBe(roomBefore);
  });

  // Without banqi's route class the room fell back to the square-board layout:
  // a square stage around the short board, the score line as a column beside
  // it, the table floating off the board's top edge.
  it("takes banqi's room layout, with an aspect that matches its own board", async () => {
    await mount();
    const app = document.getElementById('app');
    expect(app?.classList.contains('live-route--banqi')).toBe(true);
    expect(app?.classList.contains('live-route--three-kingdoms-banqi')).toBe(true);
    const css = readFileSync(resolve(__dirname, 'live-xiangqi.css'), 'utf-8');
    const aspect = css.match(
      /\.live-route--banqi\.live-route--three-kingdoms-banqi\s*\{[^}]*--uni-board-aspect:\s*calc\((\d+)\s*\/\s*(\d+)\)/,
    );
    expect(aspect, 'no Three Kingdoms aspect rule in live-xiangqi.css').not.toBeNull();
    expect([Number(aspect?.[1]), Number(aspect?.[2])]).toEqual([
      TK_LIVE_BOARD_VIEW.width,
      TK_LIVE_BOARD_VIEW.height,
    ]);
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

  // A flip's band says who flipped, in that seat's ink; the tile turned up says
  // nothing about it. The opening flip binds the flipper to the colour it turned
  // up, so it is that colour. A move keeps the gold band.
  it('rings a flip in the flipper ink and a move in gold', async () => {
    const { states, moves } = playLine(12);
    const ringAfter = async (ply: number) => {
      const options = await mount();
      options.applyHello(
        hello({
          type: 'hello',
          seat: 'red',
          state: view(states[ply]!, 'red'),
          events: [CREATED, ...moveEvents(moves.slice(0, ply))],
        }),
      );
      options.render();
      const ring = document.querySelector('.xq-live-lastmove-ring');
      expect(ring, `no band after ply ${ply}`).not.toBeNull();
      return ring?.getAttribute('class') ?? '';
    };
    const opening = states[1]!.firstColor;
    expect(moves[0]!.from).toBe(moves[0]!.to);
    expect(await ringAfter(1)).toContain(`tk-flip-ring--${opening}`);
    const second = moves[1]!;
    expect(second.from).toBe(second.to);
    expect(await ringAfter(2)).toContain(`tk-flip-ring--${opening === 'red' ? 'black' : 'red'}`);
    const quiet = moves.findIndex((m) => m.from !== m.to);
    expect(quiet).toBeGreaterThan(0);
    expect(await ringAfter(quiet + 1)).not.toContain('tk-flip-ring');
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
