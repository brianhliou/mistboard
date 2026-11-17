import {
  applyJieqiMove,
  createInitialJieqiState,
  getJieqiLegalMoves,
  getJieqiPlayerView,
  jieqiPublicDeal,
  jieqiStateToPikafishFen,
  jieqiTruthView,
  STANDARD_JIEQI_DEAL,
} from '@mistboard/game';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { jieqiPostgameApiUrl, mountJieqiPostgame } from './live-jieqi-postgame.js';
import * as ceval from './review/engine/ceval.js';

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
    window.dispatchEvent(new Event('pagehide'));
    document.body.replaceChildren();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  it.each(['jqe-v1', undefined] as const)(
    'selects the browser review rule from the public game stamp %s',
    async (adjudicationRule) => {
      vi.spyOn(ceval, 'cevalSupported').mockReturnValue(true);
      const evaluate = vi.fn(async (_request: ceval.CevalRequest) => ({
        depth: 0,
        seldepth: 0,
        nodes: 0,
        nps: 0,
        lines: [],
      }));
      vi.spyOn(ceval, 'createCeval').mockReturnValue({
        variant: 'jieqi',
        preload: async () => {},
        evaluate,
        stop: vi.fn(),
        dispose: vi.fn(),
      });
      const fixture = postgameFixture();
      vi.stubGlobal(
        'fetch',
        vi.fn(async () =>
          jsonResponse({
            ...fixture,
            state: { ...fixture.state, ...(adjudicationRule ? { adjudicationRule } : {}) },
          }),
        ),
      );
      const root = document.createElement('div');
      document.body.append(root);
      mountJieqiPostgame(root, 'jq_postgame');
      await flushPromises();
      root.querySelector<HTMLButtonElement>('.engine-panel__switch')!.click();
      await vi.waitFor(() => expect(evaluate).toHaveBeenCalled());
      const request = evaluate.mock.lastCall![0];
      expect(request.jieqiRule).toBe(adjudicationRule ?? 'legacy');
      const publicState = applyJieqiMove(
        createInitialJieqiState('jq_postgame', jieqiPublicDeal(STANDARD_JIEQI_DEAL, [OPENING])),
        OPENING,
      );
      // Serialize the entire transport request: no dealt field or hidden history.
      expect(JSON.parse(JSON.stringify(request))).toEqual({
        movesUci: [],
        initialFen: jieqiStateToPikafishFen(publicState, { public: true }),
        jieqiRule: adjudicationRule ?? 'legacy',
        multiPv: 3,
        effort: 'standard',
      });
      root.querySelector<HTMLButtonElement>('[data-replay="first"]')!.click();
      await vi.waitFor(() => expect(evaluate).toHaveBeenCalledTimes(2));
      expect(evaluate.mock.lastCall![0].jieqiRule).toBe(adjudicationRule ?? 'legacy');
    },
  );

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

  // #619: on a phone the game card, the analysis summary and the Move times
  // and Share tabs are in a Game info sheet and the chat in a Chat sheet, both
  // from the bar's menu; the engine card stays on the page. Each goes back
  // where it was on close.
  it('lends the game card to a Game info sheet and the chat to a Chat sheet', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(postgameFixture())),
    );
    const root = document.createElement('div');
    document.body.append(root);

    mountJieqiPostgame(root, 'jq_postgame');
    await flushPromises();

    expect(root.classList.contains('has-review-info-sheet')).toBe(true);
    const card = root.querySelector<HTMLElement>('.game-meta-card');
    const summary = root.querySelector<HTMLElement>('.review-analysis-summary-slot');
    const tabs = root.querySelector<HTMLElement>('.review-underboard-panel');
    const engine = root.querySelector<HTMLElement>('.engine-panel');
    const chat = root.querySelector<HTMLElement>('.review-spectator-chat');
    for (const el of [card, summary, tabs, engine, chat]) expect(el).not.toBeNull();

    const rows = [
      ...root.querySelectorAll<HTMLButtonElement>('.review-controls [data-review-info]'),
    ];
    expect(rows.map((row) => [row.dataset.reviewInfo, row.textContent?.trim()])).toEqual([
      ['game', 'Game info'],
      ['chat', 'Chat'],
    ]);
    const gameSheet = root.querySelector<HTMLElement>(
      '.review-info-sheet[data-review-info="game"]',
    );
    const chatSheet = root.querySelector<HTMLElement>(
      '.review-info-sheet[data-review-info="chat"]',
    );
    expect(gameSheet?.hidden).toBe(true);
    expect(chatSheet?.hidden).toBe(true);

    rows[0]?.click();
    expect(gameSheet?.hidden).toBe(false);
    for (const el of [card, summary, tabs]) expect(gameSheet?.contains(el ?? null)).toBe(true);
    for (const el of [engine, chat]) expect(gameSheet?.contains(el ?? null)).toBe(false);
    // It opens on a tab it shows (Move times, else Share & export).
    const active = gameSheet?.querySelector<HTMLElement>('.review-underboard-tab--active');
    expect(['times', 'share']).toContain(active?.dataset.tab);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(gameSheet?.hidden).toBe(true);
    expect(card?.closest('.review-rail-group')).not.toBeNull();
    expect(tabs?.closest('[data-col1-area="under"]')).not.toBeNull();
    expect(summary?.closest('.review-info-sheet')).toBeNull();

    rows[1]?.click();
    expect(chatSheet?.hidden).toBe(false);
    expect(chatSheet?.contains(chat)).toBe(true);
    expect(chatSheet?.contains(card)).toBe(false);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(chatSheet?.hidden).toBe(true);
    expect(chat?.closest('.review-rail-group')).not.toBeNull();
    expect(engine?.closest('.review-rail-main')).not.toBeNull();
    root.remove();
  });

  // #619: the board editor and the analysis board hand-offs left the game
  // review menu; /analysis keeps both.
  it('offers no Board editor or Analyse from here in the review menu', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(postgameFixture())),
    );
    const root = document.createElement('div');
    document.body.append(root);

    mountJieqiPostgame(root, 'jq_postgame');
    await flushPromises();

    const labels = [...root.querySelectorAll<HTMLButtonElement>('.move-nav-menu__item')].map(
      (item) => item.textContent?.trim(),
    );
    expect(labels).toEqual([
      'Flip board',
      'Reveal identities',
      'Show alternatives',
      'Game info',
      'Chat',
    ]);
    root.remove();
  });
});

function postgameFixture() {
  // Build a REAL 1-ply jieqi game with the kernel so the tree can reconstruct the
  // deal (from history.truth's ply-0 board) and replay it: the standard fixed deal,
  // a deterministic legal opening move, then black resigns. Generating from the
  // kernel keeps the fixture legal.
  const initial = createInitialJieqiState(
    'jq_postgame',
    jieqiPublicDeal(STANDARD_JIEQI_DEAL, [OPENING]),
  );
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
      // Public deal: only the opening mover is determined; every other
      // identity stays unknown when the adapter reconstructs its placeholders.
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
