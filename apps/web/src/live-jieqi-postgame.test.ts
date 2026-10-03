import {
  applyJieqiMove,
  createInitialJieqiState,
  getJieqiLegalMoves,
  getJieqiPlayerView,
  jieqiTruthView,
  STANDARD_JIEQI_DEAL,
} from '@mistboard/game';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { jieqiPostgameApiUrl, mountJieqiPostgame } from './live-jieqi-postgame.js';

// A deterministic legal opening move + its coordinate label, shared by the fixture
// and the assertions (getJieqiLegalMoves is stable, so [0] is a fixed move).
const OPENING = getJieqiLegalMoves(createInitialJieqiState('jq_postgame', STANDARD_JIEQI_DEAL))[0]!;
const OPENING_SAN = `${OPENING.from}-${OPENING.to}`;

describe('Jieqi postgame page', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_JIEQI_ENABLED', 'true');
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
    expect(jieqiPostgameApiUrl('jq room')).toBe('/api/jieqi/games/jq%20room');
  });

  it('reconstructs the deal, renders a single masked board, and lists the opening move', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(postgameFixture()));
    vi.stubGlobal('fetch', fetchSpy);
    const root = document.createElement('div');

    mountJieqiPostgame(root, 'jq_postgame');
    await flushPromises();

    expect(fetchSpy).toHaveBeenCalledWith('/api/jieqi/games/jq_postgame');
    expect(root.textContent).toContain('Jieqi');
    expect(root.textContent).toContain('Red is victorious');
    // The review left column is button-free.
    expect(root.textContent).not.toContain('Play again');
    // Two-column move list: the cell shows the bare coordinate move (jieqi has no
    // flip; every move is from-to).
    expect(root.textContent).toContain(OPENING_SAN);

    // A SINGLE board (no triptych, no perspective picker). Its presence proves the
    // deal reconstructed from history.truth and the tree replayed.
    expect(root.querySelectorAll('.jieqi-board')).toHaveLength(1);
    expect(root.querySelectorAll('.dxq-postgame__view-button')).toHaveLength(0);

    // The board renders MASKED as-played: the still-dark pieces are face-down backs,
    // not identified pieces (branching reveals them; the tree does not spoil the deal).
    const boardHtml = () => root.querySelector('.jieqi-board')?.innerHTML ?? '';
    expect(boardHtml()).toContain('hidden piece');

    // Opens at the final ply (the opening move is the mainline tip): the highlighted
    // current cell is that move.
    const currentSan = () =>
      root
        .querySelector('.review-move-list__move--current')
        ?.querySelector('.review-move-list__san')?.textContent ?? null;
    expect(currentSan()).toBe(OPENING_SAN);

    // Arrow keys scrub the replay: ArrowLeft from the final ply steps back to the
    // root (ply 0), where no move is highlighted.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    expect(root.querySelector('.review-move-list__move--current')).toBeNull();
  });

  it('opens on the ply a ?ply= link names, not the final position', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(postgameFixture())),
    );
    window.history.replaceState(null, '', '/?ply=0');
    const root = document.createElement('div');

    mountJieqiPostgame(root, 'jq_postgame');
    await flushPromises();

    expect(root.textContent).toContain(OPENING_SAN);
    // ply 0 is the start position: no move is current, though the game has one.
    expect(root.querySelector('.review-move-list__move--current')).toBeNull();
  });
});

function postgameFixture() {
  // Build a REAL 1-ply jieqi game with the kernel so the tree can reconstruct the
  // deal (from history.truth's ply-0 board) and replay it: the standard fixed deal,
  // a deterministic legal opening move, then black resigns. Generating from the
  // kernel keeps the fixture legal.
  const initial = createInitialJieqiState('jq_postgame', STANDARD_JIEQI_DEAL);
  const afterMove = applyJieqiMove(initial, OPENING);
  return {
    game: {
      roomId: 'jq_postgame',
      variant: 'jieqi',
      mode: 'pvp',
      result: 'red-wins',
      termination: 'resignation',
      plyCount: 1,
      startedAt: '2026-06-13T12:00:00.000Z',
      endedAt: '2026-06-13T12:05:00.000Z',
      rated: false,
      visibility: 'private',
      initialMs: 180000,
      incrementMs: 2000,
    },
    state: {
      status: { type: 'finished', winner: 'red', reason: 'resignation' },
      moveNumber: afterMove.moveNumber,
      timeControl: { initialMs: 180000, incrementMs: 2000 },
    },
    timeline: [
      { type: 'move-played', at: 4, color: 'red', move: OPENING, ply: 1 },
      { type: 'seat-resigned', at: 5, color: 'black', winner: 'red' },
    ],
    view: getJieqiPlayerView(afterMove, 'red'),
    history: {
      // Full-identity spoiler stream; the ply-0 board is the deal the adapter
      // reconstructs from (jieqi's spoiler key is 'truth', not 'revealed').
      truth: [
        { ply: 0, view: jieqiTruthView(initial) },
        { ply: 1, view: jieqiTruthView(afterMove) },
      ],
    },
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
