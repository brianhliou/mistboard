// A cold join (fresh load or reload) to a FINISHED Flip Jungle room must get the
// whole game back: every move in the list, a stepper that walks every ply, and
// a review link at the final ply. Before the fix a cold join held only the final
// view, so the stepper went back one move at most. A LIVE cold join must not
// change: its deal is a server secret, so it keeps the single masked view.
//
// Drives the real Flip Jungle room module (live-jungle-flip.ts) through a
// stubbed socket. There is no sample game, so the game is seeded random play
// through the kernel, chosen to include an equal-rank trade (the one capture the
// move log does not mark, which deal recovery has to read both ways).

import {
  ALL_JUNGLE_FLIP_SQUARES,
  applyJungleFlipMove,
  createInitialJungleFlipState,
  createJungleFlipDeal,
  getJungleFlipLegalMoves,
  getJungleFlipPlayerView,
  type JungleFlipDeal,
  type JungleFlipGameState,
  type JungleFlipMove,
  type JungleFlipSeat,
  jungleFlipSeatToMove,
  jungleFlipTruthView,
} from '@mistboard/game';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { recoverFlipDeals } from './flip-deal-recovery.js';
import type { JungleFlipWireView } from './live-jungle-flip.js';
import { rebuildFinishedJungleFlipHistory } from './live-jungle-flip-replay-history.js';
import type { TenantLiveEvent } from './variant-tenant/live-client.js';
import type { TenantSocketClientOptions } from './variant-tenant/socket-client.js';

const socket = vi.hoisted(() => ({ options: null as TenantSocketClientOptions | null }));

vi.mock('./feature-flags.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./feature-flags.js')>();
  return { ...actual, jungleFlipEnabled: () => true };
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

const ROOM = 'jgf_coldjoin';

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Game = {
  deal: JungleFlipDeal;
  moves: JungleFlipMove[];
  seats: JungleFlipSeat[];
  states: JungleFlipGameState[];
  trades: number;
};

// Seeded random play; a ply that removes two pieces is an equal-rank trade.
function playRandom(seed: number, maxPlies: number): Game {
  const rng = mulberry32(seed);
  const deal = createJungleFlipDeal(rng);
  let state = createInitialJungleFlipState(ROOM, deal);
  const game: Game = { deal, moves: [], seats: [], states: [state], trades: 0 };
  while (state.status.type === 'playing' && game.moves.length < maxPlies) {
    const legal = getJungleFlipLegalMoves(state);
    if (legal.length === 0) break;
    // Prefer captures so the game reaches trades quickly.
    const captures = legal.filter((m) => m.from !== m.to && state.board[m.to]);
    const pool = captures.length > 0 && rng() < 0.7 ? captures : legal;
    const move = pool[Math.floor(rng() * pool.length)]!;
    const seat = jungleFlipSeatToMove(state);
    const next = applyJungleFlipMove(state, move);
    if (next === state) throw new Error(`kernel rejected ${move.from}-${move.to}`);
    if (next.captures.length - state.captures.length === 2) game.trades += 1;
    game.moves.push(move);
    game.seats.push(seat);
    game.states.push(next);
    state = next;
  }
  return game;
}

function findGame(): Game {
  for (let seed = 1; seed < 500; seed += 1) {
    const game = playRandom(seed, 60);
    if (game.trades >= 1 && game.moves.length >= 20) return game;
  }
  throw new Error('no seeded game with a trade');
}

const GAME = findGame();
const PLIES = GAME.moves.length;
const MID = Math.floor(PLIES / 2);

function finished(state: JungleFlipGameState): JungleFlipGameState {
  if (state.status.type === 'finished') return state;
  return { ...state, status: { type: 'finished', winner: 'red', reason: 'resignation' } };
}

// What the server serves a finished room (jungle-flip-tenant getJungleFlipTruthView).
function truthView(state: JungleFlipGameState): JungleFlipWireView {
  return jungleFlipTruthView(finished(state)) as JungleFlipWireView;
}

function seatView(state: JungleFlipGameState, seat: JungleFlipSeat): JungleFlipWireView {
  return getJungleFlipPlayerView(state, seat) as JungleFlipWireView;
}

function moveEvents(count: number): TenantLiveEvent[] {
  return GAME.moves.slice(0, count).map((move, index) => ({
    type: 'move-played',
    color: GAME.seats[index]!,
    move,
    at: index,
    ply: index + 1,
  }));
}

const CREATED: TenantLiveEvent = { type: 'room-created', roomId: ROOM, at: 0 };
const FINISHED: TenantLiveEvent = {
  type: 'game-finished',
  winner: 'red',
  reason: 'resignation',
  at: 999,
};

async function mount(): Promise<TenantSocketClientOptions> {
  document.body.innerHTML = '<div id="app"></div>';
  window.history.replaceState(null, '', `/room/${ROOM}`);
  socket.options = null;
  vi.resetModules();
  const { bootstrapJungleFlipLiveRoom } = await import('./live-jungle-flip.js');
  bootstrapJungleFlipLiveRoom();
  if (!socket.options) throw new Error('socket was not created');
  return socket.options;
}

function frame(type: 'hello' | 'snapshot' | 'event-appended', extra: Record<string, unknown>) {
  return { type, seat: 'red', seats: {}, ...extra };
}

function moveCells(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('.xiangqi-move-row__move')].filter(
    (cell) => cell.textContent !== '',
  );
}

function reviewHref(): string | null {
  return (
    document.querySelector<HTMLAnchorElement>('[data-replay-analysis]')?.getAttribute('href') ??
    null
  );
}

// The board on screen: a revealed piece as "<ink>-<role>" from its art, a
// face-down tile (a bare disc, no art) as ''.
function boardOnScreen(): Record<string, string> {
  const pieces: Record<string, string> = {};
  for (const slot of document.querySelectorAll<SVGGElement>('[data-piece-square]')) {
    const href = slot.querySelector('image')?.getAttribute('href') ?? '';
    const match = /\/(red|black)-([a-z]+)\.png/.exec(href);
    pieces[slot.dataset.pieceSquare ?? ''] = match ? `${match[1]}-${match[2]}` : '';
  }
  return pieces;
}

function expectedMasked(state: JungleFlipGameState): Record<string, string> {
  const pieces: Record<string, string> = {};
  for (const [square, piece] of Object.entries(state.board)) {
    if (!piece) continue;
    pieces[square] = piece.faceDown ? '' : `${piece.color}-${piece.role}`;
  }
  return pieces;
}

function controlButton(action: string): HTMLButtonElement {
  const button = document.querySelector<HTMLButtonElement>(`[data-replay="${action}"]`);
  if (!button) throw new Error(`no ${action} control`);
  return button;
}

beforeEach(() => {
  document.body.innerHTML = '';
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{}', { status: 404 })),
  );
});

describe('Flip Jungle deal recovery from a finished room', () => {
  it('recovers the deal through an unmarked equal-rank trade', () => {
    expect(GAME.trades).toBeGreaterThanOrEqual(1);
    const deals = [
      ...recoverFlipDeals(ALL_JUNGLE_FLIP_SQUARES, GAME.moves, truthView(GAME.states[PLIES]!), {
        trades: true,
      }),
    ];
    expect(deals).toContainEqual(GAME.deal);
    const rebuilt = rebuildFinishedJungleFlipHistory(
      GAME.moves,
      truthView(GAME.states[PLIES]!),
      'red',
    );
    expect(rebuilt).toHaveLength(PLIES + 1);
  });

  it('refuses anything but a finished view (a live room keeps its secret deal)', () => {
    const live = seatView(GAME.states[PLIES - 1]!, 'red');
    expect(rebuildFinishedJungleFlipHistory(GAME.moves.slice(0, -1), live, 'red')).toBeNull();
  });

  it('drops a recovery whose replay does not reach the served board', () => {
    const view = truthView(GAME.states[PLIES]!);
    expect(rebuildFinishedJungleFlipHistory(GAME.moves.slice(0, -1), view, 'red')).toBeNull();
  });
});

describe('cold join to a finished Flip Jungle room', () => {
  it('lists every move, links review at the final ply, and steps to any ply', async () => {
    const options = await mount();
    options.applyHello(
      frame('hello', {
        seat: 'spectator',
        state: truthView(GAME.states[PLIES]!),
        events: [CREATED, ...moveEvents(PLIES), FINISHED],
      }),
    );
    options.render();

    expect(moveCells()).toHaveLength(PLIES);
    expect(reviewHref()).toBe(`/jungle-flip/game/${ROOM}?ply=${PLIES}`);
    expect(Object.values(boardOnScreen())).not.toContain('');

    moveCells()[MID - 1]!.click();
    expect(boardOnScreen()).toEqual(expectedMasked(GAME.states[MID]!));
    expect(reviewHref()).toBe(`/jungle-flip/game/${ROOM}?ply=${MID}`);

    controlButton('first').click();
    expect(boardOnScreen()).toEqual(expectedMasked(GAME.states[0]!));
  });

  it('a seated player reloading a finished room gets the same history', async () => {
    const options = await mount();
    options.applySnapshot(
      frame('snapshot', {
        seat: 'black',
        state: truthView(GAME.states[PLIES]!),
        events: [CREATED, ...moveEvents(PLIES), FINISHED],
      }),
    );
    options.render();
    expect(moveCells()).toHaveLength(PLIES);
    controlButton('prev').click();
    controlButton('prev').click();
    expect(boardOnScreen()).toEqual(expectedMasked(GAME.states[PLIES - 2]!));
  });
});

describe('cold join to a LIVE Flip Jungle room is unchanged (hidden-info regression)', () => {
  it('a seat holds only the masked view it was sent: no rebuild, no stepping', async () => {
    const options = await mount();
    const served = seatView(GAME.states[MID]!, 'black');
    options.applyHello(
      frame('hello', { seat: 'black', state: served, events: [CREATED, ...moveEvents(MID)] }),
    );
    options.render();

    expect(boardOnScreen()).toEqual(expectedMasked(GAME.states[MID]!));
    expect(Object.values(boardOnScreen())).toContain('');
    expect(controlButton('prev').disabled).toBe(true);
    expect(controlButton('first').disabled).toBe(true);
    expect(reviewHref()).toBeNull();
  });

  it('a spectator cold join likewise keeps the public view', async () => {
    const options = await mount();
    const served = { ...seatView(GAME.states[MID]!, 'red'), legalMoves: [] } as JungleFlipWireView;
    options.applyHello(
      frame('hello', { seat: 'spectator', state: served, events: [CREATED, ...moveEvents(MID)] }),
    );
    options.render();
    expect(boardOnScreen()).toEqual(expectedMasked(GAME.states[MID]!));
    expect(Object.values(boardOnScreen())).toContain('');
    expect(controlButton('prev').disabled).toBe(true);
    expect(reviewHref()).toBeNull();
  });
});
