// A cold join (fresh load or reload) to a FINISHED jieqi room must get the whole
// game back: every move in the list, a stepper that walks every ply, and a
// review link at the final ply. Before the fix the client filed the final view
// as ply 1 (it had captured nothing), so the list showed one move and REVIEW
// GAME linked ?ply=1. A LIVE cold join must not change: its deal is a server
// secret, so it keeps the single masked view it was sent.
//
// Drives the real jieqi room module (live-jieqi.ts) through a stubbed socket,
// with a real game: the rules article's sample deal and its first 29 plies.

import {
  applyJieqiMove,
  createInitialJieqiState,
  getJieqiPlayerView,
  getJieqiPublicView,
  type JieqiColor,
  type JieqiGameState,
  type JieqiMove,
  type JieqiSquare,
  jieqiMaskedBoard,
  jieqiTruthBoard,
  jieqiTruthCaptures,
} from '@mistboard/game';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { JIEQI_SAMPLE_GAME } from './jieqi-sample-game.js';
import type { JieqiWireView } from './live-jieqi.js';
import {
  rebuildFinishedJieqiHistory,
  rebuildLiveJieqiHistory,
  recoverJieqiDealFromFinish,
} from './live-jieqi-replay-history.js';
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

const ROOM = 'jq_coldjoin';
const PLIES = 29;

function parseMoves(text: string): JieqiMove[] {
  return text
    .trim()
    .split(/\s+/)
    .map((token) => {
      const match = /^([a-i](?:10|[1-9]))([a-i](?:10|[1-9]))$/.exec(token);
      if (!match) throw new Error(`bad move ${token}`);
      return { from: match[1] as JieqiSquare, to: match[2] as JieqiSquare };
    });
}

const MOVES = parseMoves(JIEQI_SAMPLE_GAME.moves).slice(0, PLIES);

// Kernel states after each ply (index = ply), from the real deal.
function playedStates(): JieqiGameState[] {
  let state = createInitialJieqiState(ROOM, JIEQI_SAMPLE_GAME.deal);
  const states = [state];
  for (const move of MOVES) {
    const next = applyJieqiMove(state, move);
    if (next === state) throw new Error(`sample move rejected: ${move.from}-${move.to}`);
    state = next;
    states.push(state);
  }
  return states;
}

const STATES = playedStates();

function resigned(state: JieqiGameState): JieqiGameState {
  return { ...state, status: { type: 'finished', winner: 'red', reason: 'resignation' } };
}

// What the server serves a finished room (jieqi-tenant getJieqiTruthView).
function truthView(state: JieqiGameState): JieqiWireView {
  return {
    ...getJieqiPlayerView(state, 'red'),
    board: jieqiTruthBoard(state),
    captured: jieqiTruthCaptures(state),
    legalMoves: [],
  } as JieqiWireView;
}

function seatView(state: JieqiGameState, seat: JieqiColor): JieqiWireView {
  return getJieqiPlayerView(state, seat) as JieqiWireView;
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
  at: 99,
};

// A fresh room module per test, as a page load gets: the client is module
// state, and a second bootstrap of the same instance would still hold the
// previous test's room view.
async function mount(): Promise<TenantSocketClientOptions> {
  document.body.innerHTML = '<div id="app"></div>';
  window.history.replaceState(null, '', `/room/${ROOM}`);
  socket.options = null;
  vi.resetModules();
  const { bootstrapJieqiLiveRoom } = await import('./live-jieqi.js');
  bootstrapJieqiLiveRoom();
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

// The board on screen, read from the rendered pieces' labels.
function boardOnScreen(): Record<string, string> {
  const pieces: Record<string, string> = {};
  for (const slot of document.querySelectorAll<SVGGElement>('[data-piece-square]')) {
    const label = slot.querySelector('[aria-label]')?.getAttribute('aria-label') ?? '';
    pieces[slot.dataset.pieceSquare ?? ''] = label;
  }
  return pieces;
}

function expectedMasked(state: JieqiGameState): Record<string, string> {
  const pieces: Record<string, string> = {};
  for (const [square, entry] of Object.entries(jieqiMaskedBoard(state))) {
    if (!entry) continue;
    pieces[square] = entry.faceDown
      ? `${entry.color} hidden piece`
      : `${entry.color} ${entry.role}`;
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
  // The room chrome asks the server about the session; nothing here answers.
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{}', { status: 404 })),
  );
});

describe('jieqi deal recovery from a finished room', () => {
  it('recovers the dealt roles from the truth view and the move list', () => {
    expect(STATES.at(-1)?.captures.length).toBeGreaterThan(0);
    const deal = recoverJieqiDealFromFinish(MOVES, truthView(resigned(STATES.at(-1)!)));
    expect(deal).toEqual(JIEQI_SAMPLE_GAME.deal);
  });

  it('refuses anything but a finished view (a live room keeps its secret deal)', () => {
    const live = seatView(STATES.at(-1)!, 'red');
    expect(rebuildFinishedJieqiHistory(MOVES, live, 'red')).toBeNull();
  });

  it('drops a recovery whose replay does not reach the served board', () => {
    const view = truthView(resigned(STATES.at(-1)!));
    // A log one move short leaves the pieces where the board says they are not.
    expect(rebuildFinishedJieqiHistory(MOVES.slice(0, -1), view, 'red')).toBeNull();
  });
});

describe('cold join to a finished jieqi room', () => {
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
    expect(reviewHref()).toBe(`/jieqi/game/${ROOM}?ply=${PLIES}`);
    // The live tip is the server's fully revealed board.
    expect(Object.values(boardOnScreen()).some((label) => label.includes('hidden'))).toBe(false);

    moveCells()[9]!.click(); // ply 10
    expect(boardOnScreen()).toEqual(expectedMasked(STATES[10]!));
    expect(reviewHref()).toBe(`/jieqi/game/${ROOM}?ply=10`);

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
    expect(reviewHref()).toBe(`/jieqi/game/${ROOM}?ply=${PLIES}`);
    controlButton('prev').click();
    expect(boardOnScreen()).toEqual(expectedMasked(STATES[PLIES - 1]!));
  });
});

// #523: a seated player who reloaded a LIVE room saw "last" lit and could not
// step back: the client kept only the served view, so its stepper had one ply.
// The rebuild uses only what that view already shows plus the public move list,
// so every ply must equal what this viewer saw live: the masked board and the
// captured list as THIS seat (or a spectator) knows it, never a role it lacked.
describe('cold join to a LIVE jieqi room steps back through every ply (hidden-info regression)', () => {
  it('rebuilds every ply as this seat saw it: masked board, and only the captures it can name', () => {
    const served = seatView(STATES[PLIES]!, 'black');
    // Dark captures this seat cannot name: the rebuild must keep them masked.
    expect(served.captured.some((entry) => entry.role === null)).toBe(true);
    const snapshots = rebuildLiveJieqiHistory(MOVES, served, 'black');
    expect(snapshots).toHaveLength(PLIES + 1);
    for (const [ply, snapshot] of (snapshots ?? []).entries()) {
      const saw = getJieqiPlayerView(STATES[ply]!, 'black');
      expect(snapshot.ply).toBe(ply);
      expect(snapshot.view.board).toEqual(saw.board);
      expect(snapshot.view.captured).toEqual(saw.captured);
      expect(snapshot.view.legalMoves).toEqual([]);
    }
  });

  it('rebuilds a spectator from the public view, never a seat view', () => {
    const served = getJieqiPublicView(STATES[PLIES]!) as JieqiWireView;
    const snapshots = rebuildLiveJieqiHistory(MOVES, served, null);
    expect(snapshots).toHaveLength(PLIES + 1);
    for (const [ply, snapshot] of (snapshots ?? []).entries()) {
      const saw = getJieqiPublicView(STATES[ply]!);
      expect(snapshot.view.board).toEqual(saw.board);
      expect(snapshot.view.captured).toEqual(saw.captured);
    }
    // A spectator handed a seat's view does not fit the public projection.
    expect(rebuildLiveJieqiHistory(MOVES, seatView(STATES[PLIES]!, 'red'), null)).toBeNull();
  });

  it('drops a rebuild whose moves do not reach the served view', () => {
    const served = seatView(STATES[PLIES]!, 'black');
    expect(rebuildLiveJieqiHistory(MOVES.slice(0, -1), served, 'black')).toBeNull();
    expect(rebuildLiveJieqiHistory(MOVES, truthView(resigned(STATES[PLIES]!)), 'black')).toBeNull();
  });

  it('a seated player reloading at ply 29 can step back, with "last" off at the live position', async () => {
    const options = await mount();
    const served = seatView(STATES[PLIES]!, 'black');
    options.applyHello(
      frame('hello', { seat: 'black', state: served, events: [CREATED, ...moveEvents(PLIES)] }),
    );
    options.render();

    expect(moveCells()).toHaveLength(PLIES);
    expect(boardOnScreen()).toEqual(expectedMasked(STATES[PLIES]!));
    expect(Object.values(boardOnScreen()).some((label) => label.includes('hidden'))).toBe(true);
    // At the live position there is nothing to return to: "last" is off, not lit.
    expect(controlButton('latest').disabled).toBe(true);
    expect(controlButton('prev').disabled).toBe(false);
    expect(controlButton('first').disabled).toBe(false);
    expect(reviewHref()).toBeNull();

    for (let ply = PLIES - 1; ply >= 0; ply -= 1) {
      controlButton('prev').click();
      expect(boardOnScreen()).toEqual(expectedMasked(STATES[ply]!));
    }
    expect(controlButton('prev').disabled).toBe(true);
    // Scrubbed back: now "last" lights as the way home.
    expect(controlButton('latest').disabled).toBe(false);
    controlButton('latest').click();
    expect(boardOnScreen()).toEqual(expectedMasked(STATES[PLIES]!));
  });

  it('a spectator cold join steps back too', async () => {
    const options = await mount();
    const served = getJieqiPublicView(STATES[PLIES]!) as JieqiWireView;
    options.applyHello(
      frame('hello', { seat: 'spectator', state: served, events: [CREATED, ...moveEvents(PLIES)] }),
    );
    options.render();
    expect(boardOnScreen()).toEqual(expectedMasked(STATES[PLIES]!));
    expect(controlButton('latest').disabled).toBe(true);
    controlButton('first').click();
    expect(boardOnScreen()).toEqual(expectedMasked(STATES[0]!));
  });

  it('keeps the single served view, every control off, when the moves do not reach it', async () => {
    const options = await mount();
    options.applyHello(
      frame('hello', {
        seat: 'black',
        state: seatView(STATES[PLIES]!, 'black'),
        events: [CREATED, ...moveEvents(PLIES - 1)],
      }),
    );
    options.render();
    expect(boardOnScreen()).toEqual(expectedMasked(STATES[PLIES]!));
    for (const action of ['first', 'prev', 'next', 'latest']) {
      expect(controlButton(action).disabled).toBe(true);
    }
  });
});

describe('a jieqi room that finishes live, without a reload', () => {
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
    // The opponent resigns: the room opens up to the truth view, no new move.
    options.applyEvent(
      frame('event-appended', { state: truthView(resigned(STATES[PLIES]!)), event: FINISHED }),
    );
    options.render();

    expect(moveCells()).toHaveLength(PLIES);
    expect(document.querySelectorAll('li.xiangqi-move-row')).toHaveLength(Math.ceil(PLIES / 2));
    expect(reviewHref()).toBe(`/jieqi/game/${ROOM}?ply=${PLIES}`);
    moveCells()[9]!.click();
    expect(boardOnScreen()).toEqual(expectedMasked(STATES[10]!));
  });
});
