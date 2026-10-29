import {
  applyBanqiMove,
  type BanqiMove,
  banqiTruthView,
  createInitialBanqiState,
  getBanqiPlayerView,
  STANDARD_BANQI_DEAL,
} from '@mistboard/game';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { banqiResultLabel } from './banqi-result-label.js';
import { banqiPostgameApiUrl, mountBanqiPostgame } from './live-banqi-postgame.js';

describe('banqiResultLabel translates the seat-keyed result to the bound ink', () => {
  // The reported bug: a game black-ink-wins (red side eaten), but the recorded
  // result is seat-keyed 'red-wins' (the first-mover seat survived) and the
  // notification read "Red wins" because the first-mover seat owns the black ink.
  it('maps the winning SEAT to its flip-bound ink', () => {
    // First-mover ('red') seat flipped black → owns black ink.
    expect(banqiResultLabel('red-wins', 'black')).toBe('Black wins');
    expect(banqiResultLabel('black-wins', 'black')).toBe('Red wins');
    // First-mover seat flipped red → seat == ink (the existing common case).
    expect(banqiResultLabel('red-wins', 'red')).toBe('Red wins');
    expect(banqiResultLabel('black-wins', 'red')).toBe('Black wins');
  });

  it('keeps draws ink-agnostic and falls back to move order before the flip binds', () => {
    expect(banqiResultLabel('draw', 'red')).toBe('Draw');
    expect(banqiResultLabel('red-wins', null)).toBe('First wins');
    expect(banqiResultLabel('black-wins', null)).toBe('Second wins');
  });
});

describe('Banqi postgame page', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_BANQI_ENABLED', 'true');
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
    expect(banqiPostgameApiUrl('bq room')).toBe('/api/banqi/games/bq%20room');
  });

  it('reconstructs the deal, renders one review board, and lists the flip move', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(postgameFixture()));
    vi.stubGlobal('fetch', fetchSpy);
    const root = document.createElement('div');

    mountBanqiPostgame(root, 'bq_postgame');
    await flushPromises();

    expect(fetchSpy).toHaveBeenCalledWith('/api/banqi/games/bq_postgame');
    // Single clean left rail (meta card + spectator room) — no action buttons.
    expect(root.textContent).toContain('Spectator room');
    expect(root.textContent).toContain('Banqi');
    expect(root.textContent).toContain('Black is victorious');
    expect(root.querySelector('.game-meta-card')).not.toBeNull();
    expect(root.querySelector('[role="separator"][aria-label="Resize chat"]')).not.toBeNull();
    const playerRows = root.querySelectorAll('.game-meta-card__player');
    expect(playerRows[0]?.textContent).toContain('MistyBanqi');
    expect(playerRows[0]?.querySelector('.game-meta-card__disc')?.classList).toContain(
      'seat-disc--black',
    );
    expect(playerRows[1]?.textContent).toContain('Guest');
    expect(playerRows[1]?.querySelector('.game-meta-card__disc')?.classList).toContain(
      'seat-disc--red',
    );
    expect(root.textContent).not.toContain('Play again');
    // Exactly one board (banqi is symmetric — no per-seat split). Its presence
    // proves the deal reconstructed from history.revealed and the tree replayed.
    expect(root.querySelectorAll('.banqi-board')).toHaveLength(1);
    // The board renders MASKED as-played: the still-face-down tiles are backs, not
    // identified pieces (branching reveals them; the tree does not spoil the deal).
    const board = root.querySelector('.banqi-postgame-board') as HTMLElement;
    expect(board.innerHTML).toContain('banqi-back');

    // The move list shows the opening ply (a flip — a real banqi game's first move
    // is always a flip) in the numbered row's left cell.
    const row = root.querySelector('.review-move-list__row');
    expect(row).not.toBeNull();
    expect(row?.querySelector('.review-move-list__number')?.textContent).toBe('1');
    const firstMove = row?.querySelector<HTMLButtonElement>('.review-move-list__move');
    expect(firstMove?.querySelector('.review-move-list__san')?.textContent).toBe('a1(g)');
    // Opens at the final ply (the flip is the mainline tip): the highlighted current
    // cell is that flip move. (The tree move list highlights via --current, not the
    // linear list's data-ply.)
    const current = root.querySelector('.review-move-list__move--current');
    expect(current?.querySelector('.review-move-list__san')?.textContent).toBe('a1(g)');
    // Server-side computer analysis underboard is wired: a signed-out visitor sees the
    // sign-in CTA (the account-gated compute button) rather than nothing.
    const analyseLink = root.querySelector<HTMLAnchorElement>('.xiangqi-review__analyse');
    expect(analyseLink).not.toBeNull();
    expect(analyseLink?.tagName).toBe('A');
    expect(analyseLink?.getAttribute('href')).toBe('/account?tab=login&referrer=%2F');
    expect(analyseLink?.textContent).toContain('Sign in to request analysis');
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

    mountBanqiPostgame(root, 'bq_postgame');
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

    mountBanqiPostgame(root, 'bq_postgame');
    await flushPromises();

    const labels = [...root.querySelectorAll<HTMLButtonElement>('.move-nav-menu__item')].map(
      (item) => item.textContent?.trim(),
    );
    // Engine analysis, Game info and Chat show at 600px and under only (CSS).
    expect(labels).toEqual([
      'Flip board',
      'Tablebase',
      'Show alternatives',
      'Engine analysis',
      'Game info',
      'Chat',
    ]);
    root.remove();
  });

  it('steps through plies with the arrow keys', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(postgameFixture()));
    vi.stubGlobal('fetch', fetchSpy);
    const root = document.createElement('div');

    mountBanqiPostgame(root, 'bq_postgame');
    await flushPromises();

    // The control bar disables next/last at the final ply and first/prev at the
    // start; the shared review layout binds the keyboard on the mount root. (The
    // scrubber's "Ply X of Y" status was removed with the lichess control bar.)
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
    expect(nav('Next move')?.disabled).toBe(true);
  });

  it('attributes first-mover analysis and move time to the opening flip’s black ink', async () => {
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
      if (url.endsWith('/decisions')) {
        return jsonResponse({ engineId: 'test', depth: 1, decisions: [] });
      }
      return jsonResponse(postgameFixture());
    });
    vi.stubGlobal('fetch', fetchSpy);
    const root = document.createElement('div');

    mountBanqiPostgame(root, 'bq_postgame');
    await flushPromises();
    await flushPromises();

    const analysisPlayers = root.querySelectorAll('.analysis-summary__player');
    expect(analysisPlayers[0]?.textContent).toContain('MistyBanqi');
    expect(analysisPlayers[0]?.querySelector('.analysis-summary__dot')?.classList).toContain(
      'seat-disc--black',
    );
    expect(analysisPlayers[1]?.textContent).toContain('Guest');
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
  // Build a REAL 1-ply banqi game with the kernel so the tree can reconstruct the
  // deal (from history.revealed's ply-0 truth board) and replay it: the deal is the
  // standard fixed arrangement, the opening move is the a1 flip (a real banqi game
  // always opens with a flip), then black resigns. Generating from the kernel keeps
  // the fixture legal — the tree replays through the same isBanqiLegalMove gate.
  const deal = [...STANDARD_BANQI_DEAL];
  const blackIndex = deal.findIndex((piece) => piece.color === 'black');
  [deal[0], deal[blackIndex]] = [deal[blackIndex]!, deal[0]!];
  const initial = createInitialBanqiState('bq_postgame', deal);
  const flip: BanqiMove = { from: 'a1', to: 'a1' };
  const afterFlip = applyBanqiMove(initial, flip);
  return {
    game: {
      roomId: 'bq_postgame',
      variant: 'banqi',
      mode: 'pvp',
      result: 'red-wins',
      termination: 'resignation',
      plyCount: 1,
      startedAt: '2026-06-14T12:00:00.000Z',
      endedAt: '2026-06-14T12:05:00.000Z',
      rated: false,
      visibility: 'private',
      initialMs: 180000,
      incrementMs: 2000,
      players: [
        { color: 'red', name: 'MistyBanqi', rating: null, kind: 'engine' },
        { color: 'black', name: 'Guest', rating: null, kind: 'guest' },
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
    // Final masked view (as-played) — the tree renders its own reconstruction, but
    // the payload still carries this for the watch adapter.
    view: getBanqiPlayerView(afterFlip, 'red'),
    history: {
      // Spoiler overlay: every identity unmasked per ply. The ply-0 board is the
      // full deal the adapter reconstructs from.
      revealed: [
        { ply: 0, view: banqiTruthView(initial) },
        { ply: 1, view: banqiTruthView(afterFlip) },
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
