// A cold join (fresh load or reload) to a FINISHED Fog Xiangqi room must get the
// whole game back: every move in the list, a stepper that walks every ply, and
// a review link at the final ply. Before the fix a cold join held only the final
// view, so the list showed one move. A LIVE cold join must not change: a seat
// keeps exactly its fog view and a spectator its empty board, with no stepping.
//
// Drives the real Fog Xiangqi room module (live-dark-xiangqi.ts) through a
// stubbed socket, with a seeded random game played through the kernel.

import {
  applyMove,
  createInitialXiangqiState,
  getLegalMoves,
  getPlayerView,
  type XiangqiColor,
  type XiangqiGameState,
  type XiangqiMove,
  type XiangqiSquare,
} from '@mistboard/game';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DarkXiangqiWireView } from './live-dark-xiangqi.js';
import { rebuildFinishedDarkXiangqiHistory } from './live-dark-xiangqi-replay-history.js';
import type { TenantLiveEvent } from './variant-tenant/live-client.js';
import type { TenantSocketClientOptions } from './variant-tenant/socket-client.js';

const socket = vi.hoisted(() => ({ options: null as TenantSocketClientOptions | null }));

vi.mock('./feature-flags.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./feature-flags.js')>();
  return { ...actual, darkXiangqiEnabled: () => true };
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

const ROOM = 'dxq_coldjoin';

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

type Captures = DarkXiangqiWireView['captures'];
type Game = {
  moves: XiangqiMove[];
  colors: XiangqiColor[];
  states: XiangqiGameState[];
  captures: Captures[];
};

// Seeded random play through the kernel, captures preferred, to 60 plies.
function playRandom(seed: number): Game {
  const rng = mulberry32(seed);
  let state = createInitialXiangqiState(ROOM);
  let captures: Captures = { red: [], black: [] };
  const game: Game = { moves: [], colors: [], states: [state], captures: [captures] };
  while (state.status.type === 'playing' && game.moves.length < 60) {
    const legal = getLegalMoves(state);
    if (legal.length === 0) break;
    const takes = legal.filter((m) => state.board[m.to]);
    const pool = takes.length > 0 && rng() < 0.6 ? takes : legal;
    const move = pool[Math.floor(rng() * pool.length)]!;
    const color = state.status.turn;
    const victim = state.board[move.to];
    const next = applyMove(state, move);
    if (next === state) throw new Error(`kernel rejected ${move.from}-${move.to}`);
    if (victim) {
      captures = { ...captures, [victim.color]: [...captures[victim.color], victim.role] };
    }
    game.moves.push(move);
    game.colors.push(color);
    game.states.push(next);
    game.captures.push(captures);
    state = next;
  }
  return game;
}

const GAME = playRandom(7);
const PLIES = GAME.moves.length;
const MID = Math.floor(PLIES / 2);

function finished(state: XiangqiGameState): XiangqiGameState {
  if (state.status.type === 'finished') return state;
  return { ...state, status: { type: 'finished', winner: 'red', reason: 'resignation' } };
}

const ALL_SQUARES = Array.from(
  { length: 90 },
  (_, index) => `${'abcdefghi'[index % 9]}${Math.floor(index / 9) + 1}` as XiangqiSquare,
);

// What the server serves a finished room (dark-xiangqi-tenant darkXiangqiTruthView).
function truthView(ply: number): DarkXiangqiWireView {
  const state = finished(GAME.states[ply]!);
  const board: DarkXiangqiWireView['board'] = {};
  for (const [square, piece] of Object.entries(state.board)) {
    if (piece) board[square as XiangqiSquare] = { piece, shrouded: false };
  }
  return {
    id: state.id,
    perspective: 'red',
    board,
    visibleSquares: ALL_SQUARES,
    legalMoves: [],
    status: state.status,
    moveNumber: state.moveNumber,
    lastMove: state.lastMove,
    captures: GAME.captures[ply]!,
  };
}

// A live seat's fog view (dark-xiangqi-tenant redactShroudedXiangqiView).
function seatView(ply: number, seat: XiangqiColor): DarkXiangqiWireView {
  const view = getPlayerView(GAME.states[ply]!, seat);
  const board: DarkXiangqiWireView['board'] = {};
  for (const [square, entry] of Object.entries(view.board)) {
    if (!entry) continue;
    board[square as XiangqiSquare] = entry.shrouded
      ? { color: entry.piece.color, shrouded: true }
      : { piece: entry.piece, shrouded: false };
  }
  return { ...view, board, captures: GAME.captures[ply]! } as DarkXiangqiWireView;
}

// A live spectator's view (dark-xiangqi-tenant emptyDarkXiangqiView).
function spectatorView(ply: number): DarkXiangqiWireView {
  const state = GAME.states[ply]!;
  return {
    id: state.id,
    perspective: 'red',
    board: {},
    visibleSquares: [],
    legalMoves: [],
    status: state.status,
    moveNumber: state.moveNumber,
    captures: { red: [], black: [] },
  };
}

function moveEvents(count: number): TenantLiveEvent[] {
  return GAME.moves.slice(0, count).map((move, index) => ({
    type: 'move-played',
    color: GAME.colors[index]!,
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
  const { bootstrapDarkXiangqiLiveRoom } = await import('./live-dark-xiangqi.js');
  bootstrapDarkXiangqiLiveRoom();
  if (!socket.options) throw new Error('socket was not created');
  return socket.options;
}

function frame(type: 'hello' | 'snapshot', extra: Record<string, unknown>) {
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

// Every piece label on the board, sorted ("red chariot", "black hidden piece").
function piecesOnScreen(): string[] {
  const board = document.querySelector('.board, [aria-label="Fog Xiangqi board"]');
  return [...(board ?? document).querySelectorAll('[aria-label]')]
    .map((node) => node.getAttribute('aria-label') ?? '')
    .filter((label) => /^(red|black) /.test(label))
    .sort();
}

function truthLabels(ply: number): string[] {
  return Object.values(GAME.states[ply]!.board)
    .flatMap((piece) => (piece ? [`${piece.color} ${piece.role}`] : []))
    .sort();
}

function seatLabels(view: DarkXiangqiWireView): string[] {
  return Object.values(view.board)
    .flatMap((entry) =>
      entry
        ? [
            entry.shrouded
              ? `${entry.color} hidden piece`
              : `${entry.piece.color} ${entry.piece.role}`,
          ]
        : [],
    )
    .sort();
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

describe('Fog Xiangqi history rebuild from a finished room', () => {
  it('replays every ply as the truth board with captures accumulated', () => {
    expect(PLIES).toBeGreaterThanOrEqual(20);
    expect(GAME.captures[PLIES]!.red.length + GAME.captures[PLIES]!.black.length).toBeGreaterThan(
      0,
    );
    const rebuilt = rebuildFinishedDarkXiangqiHistory(GAME.moves, truthView(PLIES));
    expect(rebuilt).toHaveLength(PLIES + 1);
    const mid = rebuilt![MID]!.view;
    expect(Object.values(mid.board).every((entry) => !entry.shrouded)).toBe(true);
    expect(mid.visibleSquares).toHaveLength(90);
    expect(mid.captures).toEqual(GAME.captures[MID]);
  });

  it('refuses a live seat view, a spectator view, and a fog view marked finished', () => {
    expect(
      rebuildFinishedDarkXiangqiHistory(GAME.moves.slice(0, MID), seatView(MID, 'red')),
    ).toBeNull();
    expect(
      rebuildFinishedDarkXiangqiHistory(GAME.moves.slice(0, MID), spectatorView(MID)),
    ).toBeNull();
    const fogFinished = { ...seatView(MID, 'red'), status: finished(GAME.states[MID]!).status };
    expect(rebuildFinishedDarkXiangqiHistory(GAME.moves.slice(0, MID), fogFinished)).toBeNull();
  });

  it('drops a replay that does not reach the served board', () => {
    expect(rebuildFinishedDarkXiangqiHistory(GAME.moves.slice(0, -1), truthView(PLIES))).toBeNull();
  });
});

describe('cold join to a finished Fog Xiangqi room', () => {
  it('lists every move, links review at the final ply, and steps to any ply', async () => {
    const options = await mount();
    options.applyHello(
      frame('hello', {
        seat: 'spectator',
        state: truthView(PLIES),
        events: [CREATED, ...moveEvents(PLIES), FINISHED],
      }),
    );
    options.render();

    expect(moveCells()).toHaveLength(PLIES);
    expect(reviewHref()).toBe(`/dark-xiangqi/game/${ROOM}?ply=${PLIES}`);
    expect(piecesOnScreen()).toEqual(truthLabels(PLIES));

    moveCells()[MID - 1]!.click();
    expect(piecesOnScreen()).toEqual(truthLabels(MID));
    expect(reviewHref()).toBe(`/dark-xiangqi/game/${ROOM}?ply=${MID}`);

    controlButton('first').click();
    expect(piecesOnScreen()).toEqual(truthLabels(0));
  });

  it('a seated player reloading a finished room gets the same history', async () => {
    const options = await mount();
    options.applySnapshot(
      frame('snapshot', {
        seat: 'black',
        state: truthView(PLIES),
        events: [CREATED, ...moveEvents(PLIES), FINISHED],
      }),
    );
    options.render();
    expect(moveCells()).toHaveLength(PLIES);
    controlButton('prev').click();
    controlButton('prev').click();
    expect(piecesOnScreen()).toEqual(truthLabels(PLIES - 2));
  });
});

describe('cold join to a LIVE Fog Xiangqi room is unchanged (hidden-info regression)', () => {
  it('a seat holds only the fog view it was sent: no rebuild, no stepping', async () => {
    const options = await mount();
    const served = seatView(MID, 'black');
    options.applyHello(
      frame('hello', { seat: 'black', state: served, events: [CREATED, ...moveEvents(MID)] }),
    );
    options.render();

    expect(piecesOnScreen()).toEqual(seatLabels(served));
    expect(piecesOnScreen()).toContain('red hidden piece');
    expect(controlButton('prev').disabled).toBe(true);
    expect(controlButton('first').disabled).toBe(true);
    expect(reviewHref()).toBeNull();
  });

  it('a spectator cold join keeps the empty board', async () => {
    const options = await mount();
    options.applyHello(
      frame('hello', {
        seat: 'spectator',
        state: spectatorView(MID),
        events: [CREATED, ...moveEvents(MID)],
      }),
    );
    options.render();
    expect(piecesOnScreen()).toEqual([]);
    expect(controlButton('prev').disabled).toBe(true);
    expect(reviewHref()).toBeNull();
  });
});
