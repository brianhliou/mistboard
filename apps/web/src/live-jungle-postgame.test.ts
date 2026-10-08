import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  initialPlyFromSearch,
  junglePostgameApiUrl,
  mountJunglePostgame,
} from './live-jungle-postgame.js';

describe('Jungle postgame page', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_JUNGLE_ENABLED', 'true');
    window.history.replaceState(null, '', '/');
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: memoryStorage(),
    });
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  it('builds the family-native public postgame API URL', () => {
    expect(junglePostgameApiUrl('jgl room')).toBe('/api/jungle/games/jgl%20room');
  });

  it('reads the initial ply from the query string', () => {
    expect(initialPlyFromSearch('?ply=3')).toBe(3);
    expect(initialPlyFromSearch('?ply=-1')).toBeNull();
    expect(initialPlyFromSearch('')).toBeNull();
  });

  it('renders a single perfect-info review board, info rail, and move rows', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(postgameFixture()));
    vi.stubGlobal('fetch', fetchSpy);
    const root = document.createElement('div');

    mountJunglePostgame(root, 'jgl_postgame');
    await flushPromises();

    expect(fetchSpy).toHaveBeenCalledWith('/api/jungle/games/jgl_postgame');
    expect(root.textContent).toContain('Spectator room');
    expect(root.textContent).toContain('Jungle');
    expect(root.textContent).toContain('Red is victorious');
    expect(root.textContent).not.toContain('Play again');
    // Perfect-info: one board, and no reveal toggle (nothing was ever hidden).
    expect(root.querySelectorAll('.jungle-postgame-board')).toHaveLength(1);
    expect(root.querySelector('.jungle-postgame-board')?.innerHTML).toContain('<svg');
    expect(root.querySelector('.review-stage')?.classList).toContain('review-stage--board-only');
    expect(
      root
        .querySelector<HTMLElement>('.review-shell__cluster')
        ?.style.getPropertyValue('--uni-board-aspect'),
    ).toBe((336 / 432).toFixed(4));
    expect(
      [...root.querySelectorAll('button')].some((el) => el.textContent === 'Reveal tiles'),
    ).toBe(false);

    const row = root.querySelector('.review-move-list__row');
    expect(row?.querySelector('.review-move-list__number')?.textContent).toBe('1');
    expect(row?.querySelector<HTMLButtonElement>('.review-move-list__move')?.textContent).toBe(
      'a3-a4',
    );
    // Shared lichess control bar (not the old ply-count scrubber).
    expect(root.querySelector('.review-controls')).not.toBeNull();
    // Server-side computer analysis underboard is wired: a signed-out visitor sees
    // the sign-in CTA (the account-gated compute button) rather than nothing.
    const analyseButton = root.querySelector<HTMLButtonElement>('.xiangqi-review__analyse');
    expect(analyseButton).not.toBeNull();
    expect(analyseButton?.textContent).toContain('Sign in to request analysis');
  });

  it('steps through plies with the arrow keys', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(postgameFixture()));
    vi.stubGlobal('fetch', fetchSpy);
    const root = document.createElement('div');

    mountJunglePostgame(root, 'jgl_postgame');
    await flushPromises();

    // The control bar disables first/prev at the start and next/last at the end;
    // arrow keys move the ply, so the bounds flip. (The old scrubber's "Ply X of
    // Y" status was removed with the lichess control bar.)
    const nav = (label: string) =>
      root.querySelector<HTMLButtonElement>(`.move-nav-bar__button[aria-label="${label}"]`);
    // Opens at the final ply (1 of 1): next/last disabled.
    expect(nav('Next move')?.disabled).toBe(true);
    expect(nav('Previous move')?.disabled).toBe(false);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    // Ply 0: at the start, first/prev disabled.
    expect(nav('Previous move')?.disabled).toBe(true);
    expect(nav('Next move')?.disabled).toBe(false);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    // Back at the final ply.
    expect(nav('Next move')?.disabled).toBe(true);
  });
});

function postgameFixture() {
  // Red rat a3 -> a4 (a quiet step), then Black resigns. Perfect-information: a
  // single history array, no masked/revealed split.
  return {
    game: {
      roomId: 'jgl_postgame',
      variant: 'jungle',
      mode: 'pvp',
      result: 'red-wins',
      termination: 'resignation',
      plyCount: 1,
      startedAt: '2026-06-24T12:00:00.000Z',
      endedAt: '2026-06-24T12:05:00.000Z',
      rated: false,
      visibility: 'private',
      initialMs: 180000,
      incrementMs: 2000,
    },
    state: {
      status: { type: 'finished', winner: 'red', reason: 'resignation' },
      moveNumber: 1,
      timeControl: { initialMs: 180000, incrementMs: 2000 },
    },
    timeline: [
      { type: 'move-played', at: 4, color: 'red', move: { from: 'a3', to: 'a4' }, ply: 1 },
      { type: 'seat-resigned', at: 5, color: 'black', winner: 'red' },
    ],
    view: view(1),
    history: [
      { ply: 0, view: view(0) },
      { ply: 1, view: view(1) },
    ],
  };
}

const finished = { type: 'finished', winner: 'red', reason: 'resignation' } as const;
const playing = { type: 'playing', turn: 'black' } as const;

function view(ply: number) {
  return {
    id: `jgl_${ply}`,
    perspective: 'red',
    board:
      ply === 0 ? { a3: { color: 'red', role: 'rat' } } : { a4: { color: 'red', role: 'rat' } },
    visibleSquares: [],
    legalMoves: [],
    status: ply === 0 ? playing : finished,
    moveNumber: 1,
    lastMove: ply === 0 ? undefined : { from: 'a3', to: 'a4' },
  };
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    status: init.status ?? 200,
  });
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => Array.from(values.keys())[index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}
