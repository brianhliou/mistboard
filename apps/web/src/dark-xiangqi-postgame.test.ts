import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { darkXiangqiPostgameApiUrl, mountDarkXiangqiPostgame } from './dark-xiangqi-postgame.js';

describe('Dark Xiangqi postgame page', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_DARK_XIANGQI_ENABLED', 'true');
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
    expect(darkXiangqiPostgameApiUrl('dxq room')).toBe('/api/dark-xiangqi/games/dxq%20room');
  });

  it('renders one interactive fog board plus a Red | Truth | Black perspective toggle', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(postgameFixture()));
    vi.stubGlobal('fetch', fetchSpy);
    const root = document.createElement('div');

    mountDarkXiangqiPostgame(root, 'dxq_postgame');
    await flushPromises();

    expect(fetchSpy).toHaveBeenCalledWith('/api/dark-xiangqi/games/dxq_postgame');
    expect(root.querySelector('.site-nav')).not.toBeNull();
    expect(root.textContent).toContain('Spectator room');
    expect(root.textContent).toContain('Red is victorious');
    // The interactive tree renders ONE board plus a segmented perspective toggle
    // (the same control the watch page uses), defaulting to the revealed truth.
    const povButtons = [...root.querySelectorAll<HTMLButtonElement>('.review-pov__button')];
    expect(povButtons.map((b) => b.textContent)).toEqual(['Red', 'Truth', 'Black']);
    expect(povButtons.find((b) => b.classList.contains('active'))?.textContent).toBe('Truth');
    expect(root.textContent).not.toContain('Play again');
    expect(root.querySelectorAll('.xq-live-svg')).toHaveLength(1);

    // Moves render in the shared branching move tree, paired two per numbered row
    // (Red move, then Black move), each a jump-to-node button.
    const firstMoveRow = root.querySelector('.review-move-list__row');
    expect(firstMoveRow?.textContent).toContain('b3-b4');
    expect(firstMoveRow?.textContent).toContain('b8-b7');
    const moveButtons = root.querySelectorAll<HTMLButtonElement>('.move-tree__move');
    expect(moveButtons).toHaveLength(2);

    // Current node is read off the highlighted move's SAN; the root (start) has no
    // highlighted move. The tree loads at the mainline tip (final ply).
    const currentSan = () =>
      root.querySelector('.review-move-list__move--current .review-move-list__san')?.textContent ??
      null;

    // Hidden-info invariant: the single board is fully revealed on Truth (no fog
    // layer, no shrouded piece) and fogs when toggled to a seat's POV. The
    // positions are reconstructed CLIENT-side from the true move list through the
    // fog kernel, not from the server per-ply snapshots.
    const boardHost = (): HTMLElement => {
      const el = root.querySelector<HTMLElement>('.dxq-postgame__board');
      if (!el) throw new Error('Missing board host');
      return el;
    };
    const pov = (label: string): HTMLButtonElement => {
      const button = povButtons.find((b) => b.textContent === label);
      if (!button) throw new Error(`Missing POV button: ${label}`);
      return button;
    };
    expect(boardHost().querySelector('.xq-live-fog-mask')).toBeNull();
    expect(boardHost().innerHTML).not.toContain('hidden piece');
    pov('Red').click();
    expect(boardHost().querySelector('.xq-live-fog-mask')).not.toBeNull();
    pov('Black').click();
    expect(boardHost().querySelector('.xq-live-fog-mask')).not.toBeNull();
    // Back to Truth: the fog clears and the board is interactive again.
    pov('Truth').click();
    expect(boardHost().querySelector('.xq-live-fog-mask')).toBeNull();

    // Clicking a move jumps the whole triptych to that node.
    moveButtons[0]?.click();
    expect(currentSan()).toBe('b3-b4');
    moveButtons[1]?.click();
    expect(currentSan()).toBe('b8-b7');

    // Flip lives in the control bar's menu overlay (present in the DOM even while
    // the menu is closed). Flipping re-orients the board.
    const truthSvg = () => boardHost().querySelector('.xq-live-svg')?.innerHTML ?? '';
    const beforeFlip = truthSvg();
    const menuFlip = [...root.querySelectorAll<HTMLButtonElement>('.move-nav-menu__item')].find(
      (b) => b.textContent?.includes('Flip board'),
    );
    menuFlip?.click();
    expect(truthSvg()).not.toBe(beforeFlip);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'f' }));
    expect(truthSvg()).toBe(beforeFlip);

    // Keyboard navigation walks the mainline / jumps to the ends.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    expect(currentSan()).toBe('b3-b4');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }));
    expect(currentSan()).toBeNull();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    expect(currentSan()).toBe('b3-b4');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    expect(currentSan()).toBe('b8-b7');

    root
      .querySelector<HTMLButtonElement>('.move-nav-bar__button[aria-label="Previous move"]')
      ?.click();
    expect(currentSan()).toBe('b3-b4');
  });
});

function postgameFixture() {
  return {
    game: {
      roomId: 'dxq_postgame',
      variant: 'dark-xiangqi',
      mode: 'pvp',
      result: 'red-wins',
      termination: 'resignation',
      plyCount: 2,
      startedAt: '2026-05-29T12:00:00.000Z',
      endedAt: '2026-05-29T12:05:00.000Z',
      rated: false,
      visibility: 'private',
      initialMs: 180000,
      incrementMs: 2000,
    },
    state: {
      status: { type: 'finished', winner: 'red', reason: 'resignation' },
      moveNumber: 2,
      timeControl: { initialMs: 180000, incrementMs: 2000 },
    },
    timeline: [
      { type: 'move-played', at: 2, color: 'red', move: { from: 'b3', to: 'b4' }, ply: 1 },
      {
        type: 'move-played',
        at: 3,
        color: 'black',
        move: { from: 'b8', to: 'b7' },
        ply: 2,
      },
    ],
    view: {
      id: 'dxq_postgame',
      perspective: 'red',
      board: {
        b4: { piece: { color: 'red', role: 'cannon' }, shrouded: false },
        b7: { piece: { color: 'black', role: 'cannon' }, shrouded: false },
      },
      visibleSquares: allFixtureSquares(),
      legalMoves: [],
      status: { type: 'finished', winner: 'red', reason: 'resignation' },
      moveNumber: 2,
    },
    history: {
      red: [
        {
          ply: 0,
          view: {
            id: 'dxq_postgame_red_0',
            perspective: 'red',
            board: {
              b3: { piece: { color: 'red', role: 'cannon' }, shrouded: false },
              b8: { color: 'black', shrouded: true },
            },
            visibleSquares: ['b3', 'b8'],
            legalMoves: [],
            status: { type: 'playing', turn: 'red' },
            moveNumber: 1,
          },
        },
        {
          ply: 1,
          view: {
            id: 'dxq_postgame_red_1',
            perspective: 'red',
            board: {
              b4: { piece: { color: 'red', role: 'cannon' }, shrouded: false },
              b8: { color: 'black', shrouded: true },
            },
            visibleSquares: ['b4', 'b8'],
            legalMoves: [],
            status: { type: 'playing', turn: 'black' },
            moveNumber: 1,
          },
        },
        {
          ply: 2,
          view: {
            id: 'dxq_postgame_red_2',
            perspective: 'red',
            board: {
              b4: { piece: { color: 'red', role: 'cannon' }, shrouded: false },
              b7: { color: 'black', shrouded: true },
            },
            visibleSquares: ['b4', 'b7'],
            legalMoves: [],
            status: { type: 'finished', winner: 'red', reason: 'resignation' },
            moveNumber: 2,
          },
        },
      ],
      truth: [
        {
          ply: 0,
          view: truthView('dxq_postgame_truth_0', {
            b3: { piece: { color: 'red', role: 'cannon' }, shrouded: false },
            b8: { piece: { color: 'black', role: 'cannon' }, shrouded: false },
          }),
        },
        {
          ply: 1,
          view: truthView('dxq_postgame_truth_1', {
            b4: { piece: { color: 'red', role: 'cannon' }, shrouded: false },
            b8: { piece: { color: 'black', role: 'cannon' }, shrouded: false },
          }),
        },
        {
          ply: 2,
          view: truthView('dxq_postgame_truth_2', {
            b4: { piece: { color: 'red', role: 'cannon' }, shrouded: false },
            b7: { piece: { color: 'black', role: 'cannon' }, shrouded: false },
          }),
        },
      ],
      black: [
        {
          ply: 0,
          view: {
            id: 'dxq_postgame_black_0',
            perspective: 'black',
            board: {
              b3: { color: 'red', shrouded: true },
              b8: { piece: { color: 'black', role: 'cannon' }, shrouded: false },
            },
            visibleSquares: ['b3', 'b8'],
            legalMoves: [],
            status: { type: 'playing', turn: 'red' },
            moveNumber: 1,
          },
        },
        {
          ply: 1,
          view: {
            id: 'dxq_postgame_black_1',
            perspective: 'black',
            board: {
              b4: { color: 'red', shrouded: true },
              b8: { piece: { color: 'black', role: 'cannon' }, shrouded: false },
            },
            visibleSquares: ['b4', 'b8'],
            legalMoves: [],
            status: { type: 'playing', turn: 'black' },
            moveNumber: 1,
          },
        },
        {
          ply: 2,
          view: {
            id: 'dxq_postgame_black_2',
            perspective: 'black',
            board: {
              b4: { color: 'red', shrouded: true },
              b7: { piece: { color: 'black', role: 'cannon' }, shrouded: false },
            },
            visibleSquares: ['b4', 'b7'],
            legalMoves: [],
            status: { type: 'finished', winner: 'red', reason: 'resignation' },
            moveNumber: 2,
          },
        },
      ],
    },
    views: {
      red: {
        id: 'dxq_postgame_red',
        perspective: 'red',
        board: {
          b4: { piece: { color: 'red', role: 'cannon' }, shrouded: false },
          b8: { color: 'black', shrouded: true },
        },
        visibleSquares: ['b4', 'b8'],
        legalMoves: [],
        status: { type: 'finished', winner: 'red', reason: 'resignation' },
        moveNumber: 2,
      },
      truth: truthView('dxq_postgame_truth', {
        b4: { piece: { color: 'red', role: 'cannon' }, shrouded: false },
        b7: { piece: { color: 'black', role: 'cannon' }, shrouded: false },
      }),
      black: {
        id: 'dxq_postgame_black',
        perspective: 'black',
        board: {
          b4: { color: 'red', shrouded: true },
          b7: { piece: { color: 'black', role: 'cannon' }, shrouded: false },
        },
        visibleSquares: ['b4', 'b7'],
        legalMoves: [],
        status: { type: 'finished', winner: 'red', reason: 'resignation' },
        moveNumber: 2,
      },
    },
  };
}

function truthView(id: string, board: Record<string, unknown>) {
  return {
    id,
    perspective: 'red',
    board,
    visibleSquares: allFixtureSquares(),
    legalMoves: [],
    status: { type: 'finished', winner: 'red', reason: 'resignation' },
    moveNumber: 2,
  };
}

function allFixtureSquares(): string[] {
  const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'];
  const squares: string[] = [];
  for (let rank = 1; rank <= 10; rank += 1) {
    for (const file of files) squares.push(`${file}${rank}`);
  }
  return squares;
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
