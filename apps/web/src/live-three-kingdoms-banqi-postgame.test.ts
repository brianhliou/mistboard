import {
  applyThreeKingdomsBanqiMove,
  createThreeKingdomsBanqiSetup,
  createThreeKingdomsBanqiStateFromSetup,
  getThreeKingdomsBanqiPlayerView,
  THREE_KINGDOMS_BANQI_SETUP_SQUARES,
  type ThreeKingdomsBanqiMove,
  type ThreeKingdomsBanqiPlayerView,
  type ThreeKingdomsBanqiState,
  threeKingdomsBanqiStateToDealtFen,
} from '@mistboard/game';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  mountThreeKingdomsBanqiPostgame,
  type ThreeKingdomsBanqiPostgameResponse,
  threeKingdomsBanqiPostgameApiUrl,
  threeKingdomsBanqiPostgameRoot,
} from './live-three-kingdoms-banqi-postgame.js';
import { recoverThreeKingdomsBanqiDeal } from './review/three-kingdoms-banqi-tree-adapter.js';
import { setResolvedSignedIn } from './signed-in-state.js';

const ROOM = 'tkb_postgame';

function seeded(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 0x100000000;
  };
}

// The server's truth view (every identity face up), built here from the state so
// the fixture does not depend on server code.
function truthView(state: ThreeKingdomsBanqiState): ThreeKingdomsBanqiPlayerView {
  const masked = getThreeKingdomsBanqiPlayerView(state, 'red');
  const board: ThreeKingdomsBanqiPlayerView['board'] = {};
  for (const [square, piece] of Object.entries(state.board)) {
    if (!piece) continue;
    board[square as keyof typeof board] = { color: piece.color, role: piece.role, faceDown: false };
  }
  return { ...masked, board };
}

function postgameFixture(): ThreeKingdomsBanqiPostgameResponse {
  const deal = createThreeKingdomsBanqiSetup(seeded(11)).deal;
  const initial = createThreeKingdomsBanqiStateFromSetup(ROOM, { deal });
  const flip = {
    from: THREE_KINGDOMS_BANQI_SETUP_SQUARES[0],
    to: THREE_KINGDOMS_BANQI_SETUP_SQUARES[0],
  } as ThreeKingdomsBanqiMove;
  const after = applyThreeKingdomsBanqiMove(initial, flip);
  return {
    game: {
      roomId: ROOM,
      variant: 'three-kingdoms-banqi',
      mode: 'pve',
      result: 'red-wins',
      termination: 'resignation',
      plyCount: 1,
      startedAt: '2026-10-30T12:00:00.000Z',
      endedAt: '2026-10-30T12:05:00.000Z',
      rated: false,
      visibility: 'private',
      initialMs: 300000,
      incrementMs: 5000,
      players: [
        { color: 'red', name: 'Admin', rating: null, kind: 'account' },
        { color: 'black', name: 'Misty', rating: null, kind: 'engine' },
      ],
    },
    state: {
      status: { type: 'finished', winner: 'red', reason: 'resignation' },
      moveNumber: after.moveNumber,
      timeControl: { initialMs: 300000, incrementMs: 5000 },
    },
    timeline: [
      { type: 'move-played', at: 4, color: 'red', move: flip, ply: 1 },
      { type: 'seat-resigned', at: 5, color: 'black', winner: 'red' },
    ],
    view: truthView(after),
    history: {
      truth: [
        { ply: 0, view: getThreeKingdomsBanqiPlayerView(initial, 'red') },
        { ply: 1, view: getThreeKingdomsBanqiPlayerView(after, 'red') },
      ],
      revealed: [
        { ply: 0, view: truthView(initial) },
        { ply: 1, view: truthView(after) },
      ],
    },
  };
}

describe('Three Kingdoms banqi deal recovery', () => {
  it('reads the deal off the ply-0 revealed board in setup order', () => {
    const deal = createThreeKingdomsBanqiSetup(seeded(3)).deal;
    const state = createThreeKingdomsBanqiStateFromSetup(ROOM, { deal });
    expect(recoverThreeKingdomsBanqiDeal(truthView(state))).toEqual(deal);
  });

  it('roots the tree at the dealt position the room started from', () => {
    const postgame = postgameFixture();
    const root = threeKingdomsBanqiPostgameRoot(postgame);
    const deal = createThreeKingdomsBanqiSetup(seeded(11)).deal;
    expect(root.fen).toBe(
      threeKingdomsBanqiStateToDealtFen(createThreeKingdomsBanqiStateFromSetup(ROOM, { deal })),
    );
  });

  it('refuses a face-down setup square rather than guess the tile', () => {
    const state = createThreeKingdomsBanqiStateFromSetup(ROOM, {
      deal: createThreeKingdomsBanqiSetup(seeded(3)).deal,
    });
    // The masked view: every tile face down.
    expect(() =>
      recoverThreeKingdomsBanqiDeal(getThreeKingdomsBanqiPlayerView(state, 'red')),
    ).toThrow(/not revealed/);
  });

  it('refuses a payload with no ply-0 revealed board', () => {
    const postgame = postgameFixture();
    postgame.history = { revealed: postgame.history?.revealed?.slice(1) };
    expect(() => threeKingdomsBanqiPostgameRoot(postgame)).toThrow(/ply-0/);
  });
});

describe('Three Kingdoms banqi postgame page', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_THREE_KINGDOMS_BANQI_ENABLED', 'true');
    setResolvedSignedIn(true);
  });

  afterEach(() => {
    setResolvedSignedIn(undefined);
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('builds the postgame API URL', () => {
    expect(threeKingdomsBanqiPostgameApiUrl('tkb room')).toBe(
      '/api/three-kingdoms-banqi/games/tkb%20room',
    );
  });

  it('renders the finished game on one review board with its move list and result', async () => {
    const fetchSpy = vi.fn(async (url: string | URL | Request) =>
      String(url).endsWith('/analysis')
        ? new Response(null, { status: 204 })
        : jsonResponse(postgameFixture()),
    );
    vi.stubGlobal('fetch', fetchSpy);
    const root = document.createElement('div');

    mountThreeKingdomsBanqiPostgame(root, ROOM);
    await flushPromises();

    expect(fetchSpy).toHaveBeenCalledWith('/api/three-kingdoms-banqi/games/tkb_postgame');
    expect(root.textContent).toContain('Three Kingdoms Banqi');
    expect(root.querySelector('.game-meta-card')).not.toBeNull();
    const firstMove = root.querySelector('.review-move-list__row .review-move-list__move');
    expect(firstMove?.querySelector('.review-move-list__san')?.textContent).toBeTruthy();
    // Each seat's points, in its seat row under and over the board.
    expect(root.querySelectorAll('.review-seat .tk-banqi-scores')).toHaveLength(2);
    expect(root.querySelector('.review-seat .tk-banqi-scores')?.textContent).toMatch(/^\d+ pts$/);
    // Nothing between the board and the move list: no right-rail material rows.
    expect(root.querySelector('.review-material-row:not(.review-seat__material)')).toBeNull();
    expect(root.textContent).toContain('Request computer analysis');
    expect(fetchSpy).toHaveBeenCalledWith(`${threeKingdomsBanqiPostgameApiUrl(ROOM)}/analysis`, {
      method: 'GET',
    });
  });

  it('shows the not-found page on a 404', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ error: 'not_found' }, { status: 404 })),
    );
    const root = document.createElement('div');

    mountThreeKingdomsBanqiPostgame(root, ROOM);
    await flushPromises();

    expect(root.querySelector('h1')?.textContent).toBe('Game not found');
    expect(root.textContent).toContain('This Three Kingdoms Banqi game is not available.');
  });

  it('runs decisions after analysis, grades flips with luck, and reloads both caches', async () => {
    let cached = false;
    let decisionsCached = false;
    const decisions = {
      engineId: 'tk-decisions@test',
      depth: 12,
      decisions: [
        { ply: 1, mover: 'red', bestWin: 80, playedWin: 40, realizedWin: 25, playedRank: 2 },
      ],
    };
    const analysis = {
      engineId: 'misty-three-kingdoms-banqi-analysis@test',
      depth: 12,
      plies: [
        { ply: 0, cp: 0, mate: null, best: null },
        { ply: 1, cp: -900, mate: null, best: null },
      ],
      chancePlies: [1],
    };
    const fetchSpy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/decisions')) {
        if (init?.method === 'POST') {
          expect(cached).toBe(true);
          decisionsCached = true;
        }
        return decisionsCached ? jsonResponse(decisions) : new Response(null, { status: 204 });
      }
      if (!url.endsWith('/analysis')) return jsonResponse(postgameFixture());
      if (init?.method === 'POST') cached = true;
      return cached ? jsonResponse(analysis) : new Response(null, { status: 204 });
    });
    vi.stubGlobal('fetch', fetchSpy);
    const root = document.createElement('div');
    mountThreeKingdomsBanqiPostgame(root, ROOM);
    await flushPromises();
    expect(root.querySelector('.advantage-chart')).toBeNull();
    root.querySelector<HTMLButtonElement>('.xiangqi-review__analyse')?.click();
    await flushPromises();
    await flushPromises();
    expect(root.querySelector('.advantage-chart__line')).not.toBeNull();
    expect(root.querySelector('.review-move--blunder')).not.toBeNull();
    expect(root.querySelector('.review-move-list__luck')?.textContent).toContain('-15%');
    expect(root.querySelectorAll('.analysis-summary__player')).toHaveLength(2);

    const reloaded = document.createElement('div');
    mountThreeKingdomsBanqiPostgame(reloaded, ROOM);
    await flushPromises();
    await flushPromises();
    expect(reloaded.querySelector('.advantage-chart__line')).not.toBeNull();
    expect(reloaded.querySelector('.xiangqi-review__analyse')).toBeNull();
    expect(reloaded.querySelector('.review-move--blunder')).not.toBeNull();
    expect(reloaded.querySelector('.review-move-list__luck')?.textContent).toContain('-15%');
    expect(fetchSpy.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(2);
    expect(
      fetchSpy.mock.calls.some(
        ([url, init]) => String(url).endsWith('/decisions') && init?.method === 'GET',
      ),
    ).toBe(true);
  });

  it.each([true, false])(
    'signed-out review reads decisions cache (hit=%s) without POST',
    async (hit) => {
      setResolvedSignedIn(false);
      const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/analysis'))
          return jsonResponse({
            engineId: 'tk-analysis@test',
            depth: 12,
            plies: [
              { ply: 0, cp: 0, mate: null, best: null },
              { ply: 1, cp: -900, mate: null, best: null },
            ],
            chancePlies: [1],
          });
        if (url.endsWith('/decisions'))
          return hit
            ? jsonResponse({
                engineId: 'tk-decisions@test',
                depth: 12,
                decisions: [
                  {
                    ply: 1,
                    mover: 'red',
                    bestWin: 80,
                    playedWin: 40,
                    realizedWin: 25,
                    playedRank: 2,
                  },
                ],
              })
            : new Response(null, { status: 204 });
        return jsonResponse(postgameFixture());
      });
      vi.stubGlobal('fetch', fetchSpy);
      const root = document.createElement('div');
      mountThreeKingdomsBanqiPostgame(root, ROOM);
      await flushPromises();
      await flushPromises();
      expect(fetchSpy).toHaveBeenCalledWith(`${threeKingdomsBanqiPostgameApiUrl(ROOM)}/decisions`, {
        method: 'GET',
      });
      expect(
        fetchSpy.mock.calls.every(
          (call) => (call as unknown as [unknown, RequestInit?])[1]?.method !== 'POST',
        ),
      ).toBe(true);
      expect(root.querySelector('.review-move--blunder') !== null).toBe(hit);
    },
  );

  it('offers a sign-in link to a signed-out reviewer', async () => {
    setResolvedSignedIn(false);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: RequestInfo | URL) =>
        String(url).endsWith('/analysis')
          ? new Response(null, { status: 204 })
          : jsonResponse(postgameFixture()),
      ),
    );
    const root = document.createElement('div');
    mountThreeKingdomsBanqiPostgame(root, ROOM);
    await flushPromises();
    const link = root.querySelector<HTMLAnchorElement>('a.xiangqi-review__analyse');
    expect(link?.textContent).toContain('Sign in to request analysis');
    expect(link?.getAttribute('href')).toContain('/account?tab=login');
  });

  it('does not fetch where the variant is not offered', () => {
    vi.stubEnv('VITE_THREE_KINGDOMS_BANQI_ENABLED', 'false');
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const root = document.createElement('div');

    mountThreeKingdomsBanqiPostgame(root, ROOM);

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

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
