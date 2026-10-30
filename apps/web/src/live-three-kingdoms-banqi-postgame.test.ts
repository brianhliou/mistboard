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
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('builds the postgame API URL', () => {
    expect(threeKingdomsBanqiPostgameApiUrl('tkb room')).toBe(
      '/api/three-kingdoms-banqi/games/tkb%20room',
    );
  });

  it('renders the finished game on one review board with its move list and result', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(postgameFixture()));
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
    // No engine for TK: no analysis request button.
    expect(root.textContent).not.toContain('Request computer analysis');
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
