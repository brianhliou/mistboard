// A cold join (fresh load or reload) to a FINISHED banqi room must get the whole
// game back: every move in the list, a stepper that walks every ply, and a
// review link at the final ply. Before the fix the client filed the final view
// as ply 1 (it had captured nothing), so the list showed one move and REVIEW
// GAME linked ?ply=1. A LIVE cold join must not change: its deal is a server
// secret, so it keeps the single masked view it was sent.
//
// Drives the real banqi room module (live-banqi.ts) through a stubbed socket,
// with a real game: the rules article's sample deal and all of its moves.

import {
  ALL_BANQI_SQUARES,
  applyBanqiMove,
  type BanqiGameState,
  type BanqiMove,
  type BanqiSeat,
  type BanqiSquare,
  banqiTruthView,
  createInitialBanqiState,
  getBanqiPlayerView,
} from '@mistboard/game';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BANQI_SAMPLE_GAME } from './banqi-sample-game.js';
import { recoverFlipDeals } from './flip-deal-recovery.js';
import type { BanqiWireView } from './live-banqi.js';
import { rebuildFinishedBanqiHistory } from './live-banqi-replay-history.js';
import type { TenantLiveEvent } from './variant-tenant/live-client.js';
import type { TenantSocketClientOptions } from './variant-tenant/socket-client.js';

const socket = vi.hoisted(() => ({ options: null as TenantSocketClientOptions | null }));

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

const ROOM = 'bq_coldjoin';

function parseMoves(text: string): BanqiMove[] {
  return text
    .trim()
    .split(/\s+/)
    .map((token) => {
      const match = /^([a-h][1-4])([a-h][1-4])$/.exec(token);
      if (!match) throw new Error(`bad move ${token}`);
      return { from: match[1] as BanqiSquare, to: match[2] as BanqiSquare };
    });
}

const MOVES = parseMoves(BANQI_SAMPLE_GAME.moves);
const PLIES = MOVES.length;
const MID = 40;

// Kernel states after each ply (index = ply), from the real deal.
function playedStates(): BanqiGameState[] {
  let state = createInitialBanqiState(ROOM, BANQI_SAMPLE_GAME.deal);
  const states = [state];
  for (const move of MOVES) {
    const next = applyBanqiMove(state, move);
    if (next === state) throw new Error(`sample move rejected: ${move.from}-${move.to}`);
    state = next;
    states.push(state);
  }
  return states;
}

const STATES = playedStates();

function resigned(state: BanqiGameState): BanqiGameState {
  return { ...state, status: { type: 'finished', winner: 'red', reason: 'resignation' } };
}

// What the server serves a finished room (banqi-tenant getBanqiTruthView).
function truthView(state: BanqiGameState): BanqiWireView {
  return banqiTruthView(state) as BanqiWireView;
}

function seatView(state: BanqiGameState, seat: BanqiSeat): BanqiWireView {
  return getBanqiPlayerView(state, seat) as BanqiWireView;
}

function moveEvents(count: number): TenantLiveEvent[] {
  return MOVES.slice(0, count).map((move, index) => ({
    type: 'move-played',
    color: index % 2 === 0 ? 'red' : 'black',
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
  const { bootstrapBanqiLiveRoom } = await import('./live-banqi.js');
  bootstrapBanqiLiveRoom();
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

// The board on screen: a revealed piece by its label, a face-down tile as ''.
function boardOnScreen(): Record<string, string> {
  const pieces: Record<string, string> = {};
  for (const slot of document.querySelectorAll<SVGGElement>('[data-piece-square]')) {
    const label = slot.querySelector('[aria-label]')?.getAttribute('aria-label') ?? '';
    pieces[slot.dataset.pieceSquare ?? ''] = label;
  }
  return pieces;
}

function expectedMasked(state: BanqiGameState): Record<string, string> {
  const pieces: Record<string, string> = {};
  for (const [square, piece] of Object.entries(state.board)) {
    if (!piece) continue;
    pieces[square] = piece.faceDown ? '' : `${piece.color} ${piece.role}`;
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

describe('banqi deal recovery from a finished room', () => {
  it('recovers the dealt tiles from the truth view and the move list', () => {
    expect(STATES.at(-1)?.captures.length).toBeGreaterThan(0);
    const deals = [
      ...recoverFlipDeals(ALL_BANQI_SQUARES, MOVES, truthView(resigned(STATES.at(-1)!)), {
        trades: false,
      }),
    ];
    expect(deals).toEqual([BANQI_SAMPLE_GAME.deal]);
  });

  it('refuses anything but a finished view (a live room keeps its secret deal)', () => {
    const live = seatView(STATES.at(-1)!, 'red');
    expect(rebuildFinishedBanqiHistory(MOVES, live, 'red')).toBeNull();
  });

  it('drops a recovery whose replay does not reach the served board', () => {
    const view = truthView(resigned(STATES.at(-1)!));
    expect(rebuildFinishedBanqiHistory(MOVES.slice(0, -1), view, 'red')).toBeNull();
  });
});

describe('cold join to a finished banqi room', () => {
  it('lists every move, links review at the final ply, and steps to any ply', async () => {
    const options = await mount();
    options.applyHello(
      frame('hello', {
        seat: 'spectator',
        state: truthView(resigned(STATES[PLIES]!)),
        events: [CREATED, ...moveEvents(PLIES), FINISHED],
      }),
    );
    options.render();

    expect(moveCells()).toHaveLength(PLIES);
    expect(document.querySelectorAll('li.xiangqi-move-row')).toHaveLength(Math.ceil(PLIES / 2));
    expect(reviewHref()).toBe(`/banqi/game/${ROOM}?ply=${PLIES}`);
    // The live tip is the server's fully revealed board.
    expect(Object.values(boardOnScreen())).not.toContain('');

    moveCells()[MID - 1]!.click();
    expect(boardOnScreen()).toEqual(expectedMasked(STATES[MID]!));
    expect(reviewHref()).toBe(`/banqi/game/${ROOM}?ply=${MID}`);

    controlButton('first').click();
    expect(boardOnScreen()).toEqual(expectedMasked(STATES[0]!));
  });

  it('a seated player reloading a finished room gets the same history', async () => {
    const options = await mount();
    options.applySnapshot(
      frame('snapshot', {
        seat: 'black',
        state: truthView(resigned(STATES[PLIES]!)),
        events: [CREATED, ...moveEvents(PLIES), FINISHED],
      }),
    );
    options.render();
    expect(moveCells()).toHaveLength(PLIES);
    expect(reviewHref()).toBe(`/banqi/game/${ROOM}?ply=${PLIES}`);
    controlButton('prev').click();
    expect(boardOnScreen()).toEqual(expectedMasked(STATES[PLIES - 1]!));
  });
});

describe('cold join to a LIVE banqi room is unchanged (hidden-info regression)', () => {
  it('a seat holds only the masked view it was sent: no rebuild, no stepping', async () => {
    const options = await mount();
    const served = seatView(STATES[MID]!, 'black');
    options.applyHello(
      frame('hello', { seat: 'black', state: served, events: [CREATED, ...moveEvents(MID)] }),
    );
    options.render();

    // The board is exactly the served masked view: face-down tiles stay hidden.
    expect(boardOnScreen()).toEqual(expectedMasked(STATES[MID]!));
    expect(Object.values(boardOnScreen())).toContain('');
    expect(controlButton('prev').disabled).toBe(true);
    expect(controlButton('first').disabled).toBe(true);
    expect(reviewHref()).toBeNull();
  });

  it('a spectator cold join likewise keeps the public view', async () => {
    const options = await mount();
    const served = { ...seatView(STATES[MID]!, 'red'), legalMoves: [] } as BanqiWireView;
    options.applyHello(
      frame('hello', { seat: 'spectator', state: served, events: [CREATED, ...moveEvents(MID)] }),
    );
    options.render();
    expect(boardOnScreen()).toEqual(expectedMasked(STATES[MID]!));
    expect(Object.values(boardOnScreen())).toContain('');
    expect(controlButton('prev').disabled).toBe(true);
    expect(reviewHref()).toBeNull();
  });
});

describe('a banqi room that finishes live, without a reload', () => {
  it('keeps the captured plies and links review at the last move', async () => {
    const options = await mount();
    options.applyHello(
      frame('hello', { seat: 'red', state: seatView(STATES[0]!, 'red'), events: [CREATED] }),
    );
    options.render();
    const events = moveEvents(PLIES);
    for (let ply = 1; ply <= PLIES; ply += 1) {
      options.applyEvent(
        frame('event-appended', { state: seatView(STATES[ply]!, 'red'), event: events[ply - 1] }),
      );
      options.render();
    }
    options.applyEvent(
      frame('event-appended', { state: truthView(resigned(STATES[PLIES]!)), event: FINISHED }),
    );
    options.render();

    expect(moveCells()).toHaveLength(PLIES);
    expect(reviewHref()).toBe(`/banqi/game/${ROOM}?ply=${PLIES}`);
    moveCells()[MID - 1]!.click();
    expect(boardOnScreen()).toEqual(expectedMasked(STATES[MID]!));
  });
});
