import {
  applyJungleFlipMove,
  createInitialJungleFlipState,
  getJungleFlipPlayerView,
  type JungleFlipMove,
  jungleFlipTruthView,
  STANDARD_JUNGLE_FLIP_DEAL,
} from '@mistboard/game';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { jungleFlipResultLabel, jungleFlipSeatInk } from './jungle-flip-result-label.js';
import {
  initialPlyFromSearch,
  jungleFlipPostgameApiUrl,
  mountJungleFlipPostgame,
} from './live-jungle-flip-postgame.js';

describe('jungleFlipResultLabel maps the winning seat to its flip-bound ink', () => {
  it('resolves seat -> ink once the opening flip binds', () => {
    // First-mover ('red') seat flipped the navy ink → displays "Blue" (internal
    // ink id stays 'black').
    expect(jungleFlipResultLabel('red-wins', 'black')).toBe('Blue wins');
    expect(jungleFlipResultLabel('black-wins', 'black')).toBe('Red wins');
    expect(jungleFlipResultLabel('red-wins', 'red')).toBe('Red wins');
    expect(jungleFlipResultLabel('black-wins', 'red')).toBe('Blue wins');
    expect(jungleFlipSeatInk('red', 'black')).toBe('black');
    expect(jungleFlipSeatInk('black', 'black')).toBe('red');
  });

  it('keeps draws ink-agnostic and falls back to move order before the flip binds', () => {
    expect(jungleFlipResultLabel('draw', 'red')).toBe('Draw');
    expect(jungleFlipResultLabel('red-wins', null)).toBe('First wins');
    expect(jungleFlipResultLabel('black-wins', null)).toBe('Second wins');
  });
});

describe('Flip Jungle postgame page', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_JUNGLE_FLIP_ENABLED', 'true');
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
    expect(jungleFlipPostgameApiUrl('jgf room')).toBe('/api/jungle-flip/games/jgf%20room');
  });

  it('reads the initial ply from the query string', () => {
    expect(initialPlyFromSearch('?ply=2')).toBe(2);
    expect(initialPlyFromSearch('?ply=x')).toBeNull();
  });

  it('renders a single review board, info rail, and move rows', async () => {
    const fetchSpy = vi.fn(async (input: RequestInfo | URL) =>
      String(input).endsWith('/analysis')
        ? new Response(null, { status: 204 })
        : jsonResponse(postgameFixture()),
    );
    vi.stubGlobal('fetch', fetchSpy);
    const root = document.createElement('div');

    mountJungleFlipPostgame(root, 'jgf_postgame');
    await flushPromises();

    expect(fetchSpy).toHaveBeenCalledWith('/api/jungle-flip/games/jgf_postgame');
    expect(root.textContent).toContain('Spectator room');
    expect(root.textContent).toContain('Flip Jungle');
    expect(root.textContent).toContain('Blue is victorious');
    expect(root.querySelectorAll('.jungle-flip-postgame-board')).toHaveLength(1);
    expect(root.querySelector('.review-shell--game')).not.toBeNull();
    expect(root.querySelector('.review-shell--analysis')).toBeNull();
    expect(root.querySelector('.review-stage')?.classList).toContain('review-stage--board-only');
    expect(root.querySelector('.review-shell__right .captures-strip')).toBeNull();

    // The opening action was a flip (self-move): the move list reads it as the bare square
    // "a1" (no dash = a flip; board moves are "a1-b2"), in the left cell (first ply, `firstMover: 'a'`).
    const firstMove = root.querySelector<HTMLButtonElement>(
      '.review-move-list__row .review-move-list__move',
    );
    expect(firstMove?.querySelector('.review-move-list__san')?.textContent).toBe('a1');
    // Opens at the final ply (the flip is the mainline tip): the highlighted current
    // cell is that flip move. (The tree move list highlights via --current.)
    const current = root.querySelector('.review-move-list__move--current');
    expect(current?.querySelector('.review-move-list__san')?.textContent).toBe('a1');
    // Server-side computer analysis underboard is wired: a signed-out visitor sees the
    // sign-in CTA (the account-gated compute button) rather than nothing.
    const analyseButton = root.querySelector<HTMLButtonElement>('.xiangqi-review__analyse');
    expect(analyseButton).not.toBeNull();
    expect(analyseButton?.textContent).toContain('Sign in to request analysis');
  });

  it('displays first-mover analysis in the black ink revealed by the opening flip', async () => {
    const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/analysis')) {
        return jsonResponse({
          engineId: 'test',
          depth: 1,
          plies: [
            { ply: 0, cp: 0, mate: null, best: null },
            { ply: 1, cp: 100, mate: null, best: null },
          ],
          chancePlies: [1],
        });
      }
      // The decision-vs-luck tier fetches alongside analysis; a chance variant shows a "pending"
      // note until it resolves, then renders the merged summary. Empty decisions is a valid result
      // (the opening flip stays unjudged) and still renders the player summary this test asserts on.
      if (url.endsWith('/decisions')) {
        return jsonResponse({ engineId: 'test', depth: 1, decisions: [] });
      }
      return jsonResponse(postgameFixture());
    });
    vi.stubGlobal('fetch', fetchSpy);
    const root = document.createElement('div');

    mountJungleFlipPostgame(root, 'jgf_postgame');
    await flushPromises();
    // The decisions fetch is chained after analysis; flush again so applyDecisions renders the
    // merged summary (replacing the pending note) before we assert on it.
    await flushPromises();

    const playerRows = root.querySelectorAll('.game-meta-card__player');
    expect(playerRows[0]?.textContent).toContain('First player');
    expect(playerRows[0]?.querySelector('.game-meta-card__disc')?.classList).toContain(
      'seat-disc--black',
    );
    expect(playerRows[1]?.querySelector('.game-meta-card__disc')?.classList).toContain(
      'seat-disc--red',
    );

    const analysisPlayers = root.querySelectorAll('.analysis-summary__player');
    expect(analysisPlayers[0]?.textContent).toContain('First player');
    expect(analysisPlayers[0]?.querySelector('.analysis-summary__dot')?.classList).toContain(
      'seat-disc--black',
    );
    expect(analysisPlayers[1]?.querySelector('.analysis-summary__dot')?.classList).toContain(
      'seat-disc--red',
    );
    expect(root.querySelector('.advantage-chart__zone')?.classList).toContain(
      'advantage-chart__zone--black',
    );
    expect(root.querySelector('.review-move-times__bar')?.classList).toContain(
      'review-move-times__bar--black',
    );
  });
});

function postgameFixture() {
  // Build a REAL 1-ply flip-jungle game with the kernel so the tree can reconstruct
  // the deal (from history.revealed's ply-0 truth board) and replay it: a valid
  // fixed deal with black on a1, an opening a1 flip, then the second seat resigning.
  // Generating from the kernel keeps the fixture legal.
  const deal = [...STANDARD_JUNGLE_FLIP_DEAL];
  [deal[0], deal[8]] = [deal[8]!, deal[0]!]; // a1 reveals black, binding first mover to black
  const initial = createInitialJungleFlipState('jgf_postgame', deal);
  const flip: JungleFlipMove = { from: 'a1', to: 'a1' };
  const afterFlip = applyJungleFlipMove(initial, flip);
  return {
    game: {
      roomId: 'jgf_postgame',
      variant: 'jungle-flip',
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
      players: [
        { color: 'red', name: 'First player', rating: 2100, kind: 'account' },
        { color: 'black', name: 'Second player', rating: null, kind: 'engine' },
      ],
    },
    state: {
      status: { type: 'finished', winner: 'red', reason: 'resignation' },
      moveNumber: afterFlip.moveNumber,
      timeControl: { initialMs: 180000, incrementMs: 2000 },
    },
    timeline: [
      { type: 'room-created', at: 0 },
      { type: 'move-played', at: 4, color: 'red', move: flip, ply: 1 },
      { type: 'seat-resigned', at: 5, color: 'black', winner: 'red' },
    ],
    view: getJungleFlipPlayerView(afterFlip, 'red'),
    history: {
      // Spoiler overlay: the ply-0 board is the full deal the adapter reconstructs from.
      revealed: [
        { ply: 0, view: jungleFlipTruthView(initial) },
        { ply: 1, view: jungleFlipTruthView(afterFlip) },
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
