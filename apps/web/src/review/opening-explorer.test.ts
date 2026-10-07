import {
  applyStandardXiangqiMove,
  createInitialXiangqiState,
  parseStandardXiangqiFen,
  type XiangqiGameState,
  type XiangqiMove,
  type XiangqiTablebaseResponse,
} from '@mistboard/game';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createOpeningExplorer } from './opening-explorer.js';
import { createXiangqiTablebasePanel } from './xiangqi-tablebase-panel.js';

const START_KEY = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR r';

describe('opening explorer', () => {
  afterEach(() => {
    document.body.replaceChildren();
    vi.unstubAllGlobals();
  });

  it('looks up the position key, not an engine-dialect FEN', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(payload()));
    vi.stubGlobal('fetch', fetchSpy);

    const explorer = createOpeningExplorer();
    document.body.append(explorer.el);
    explorer.setActive(true);
    explorer.setState(createInitialXiangqiState('t'));
    await flushPromises();

    // The stored key spells red as 'r'. Passing the engine's 'w' dialect would
    // miss every row silently, so this pin is the contract with the API.
    expect(fetchSpy).toHaveBeenCalledWith(
      `/api/xiangqi/explorer?fen=${encodeURIComponent(START_KEY)}`,
      expect.anything(),
    );
  });

  it('renders each move with its share of decided games', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(payload())),
    );

    const explorer = createOpeningExplorer();
    document.body.append(explorer.el);
    explorer.setActive(true);
    explorer.setState(createInitialXiangqiState('t'));
    await flushPromises();

    const rows = [...explorer.el.querySelectorAll('.opening-explorer__row')];
    expect(rows).toHaveLength(2);
    expect(rows[0]?.querySelector('.opening-explorer__count-games')?.textContent).toBe('7');
    // 6 red wins + 1 black win = 7 decided, so red takes 85.7% of the bar.
    const redPart = rows[0]?.querySelector<HTMLElement>('.opening-explorer__bar-part--red');
    expect(redPart?.style.width).toBe('85.7%');
    expect(explorer.el.textContent).toContain('10 games');
  });

  it('says a position is unplayed instead of rendering an empty table', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          position: START_KEY,
          opening: null,
          total: 0,
          moves: [],
          topGames: [],
          build: null,
        }),
      ),
    );

    const explorer = createOpeningExplorer();
    document.body.append(explorer.el);
    explorer.setActive(true);
    explorer.setState(createInitialXiangqiState('t'));
    await flushPromises();

    expect(explorer.el.textContent).toContain('No corpus games reached this position');
    expect(explorer.el.querySelectorAll('.opening-explorer__row')).toHaveLength(0);
  });

  it('treats a 200 that is not an explorer payload as unavailable', async () => {
    // A proxy or edge error page can answer 200 with anything. Reading it
    // optimistically used to throw inside render and take the panel down.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ lines: [], canPost: true })),
    );

    const explorer = createOpeningExplorer();
    document.body.append(explorer.el);
    explorer.setActive(true);
    explorer.setState(createInitialXiangqiState('t'));
    await flushPromises();

    expect(explorer.el.textContent).toContain('Opening statistics are unavailable');
    expect(explorer.el.querySelectorAll('.opening-explorer__row')).toHaveLength(0);
  });

  it('does not refetch a position it is already showing', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(payload()));
    vi.stubGlobal('fetch', fetchSpy);

    const explorer = createOpeningExplorer();
    document.body.append(explorer.el);
    explorer.setActive(true);
    const start = createInitialXiangqiState('t');
    explorer.setState(start);
    await flushPromises();
    // Scrubbing back and forth revisits positions constantly; each revisit must
    // be free, not another request.
    explorer.setState(start);
    explorer.setState(start);
    await flushPromises();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('follows the board to a new position', async () => {
    const fetchSpy = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse(payload()),
    );
    vi.stubGlobal('fetch', fetchSpy);

    const explorer = createOpeningExplorer();
    document.body.append(explorer.el);
    explorer.setActive(true);
    const start = createInitialXiangqiState('t');
    explorer.setState(start);
    await flushPromises();
    explorer.setState(applyStandardXiangqiMove(start, { from: 'h3', to: 'e3' } as XiangqiMove));
    await flushPromises();

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(String(fetchSpy.mock.calls[1]?.[0])).not.toContain(encodeURIComponent(START_KEY));
  });

  it('queries nothing until its tab is on screen', async () => {
    const fetchSpy = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse(payload()),
    );
    vi.stubGlobal('fetch', fetchSpy);

    const explorer = createOpeningExplorer();
    document.body.append(explorer.el);
    // The underboard opens on Computer analysis, so this is the common case:
    // a reader scrubs a whole game and never opens the explorer.
    const start = createInitialXiangqiState('t');
    explorer.setState(start);
    explorer.setState(applyStandardXiangqiMove(start, { from: 'h3', to: 'e3' } as XiangqiMove));
    await flushPromises();

    expect(fetchSpy).not.toHaveBeenCalled();

    // Opening the tab catches up to wherever the board now is, in one request.
    explorer.setActive(true);
    await flushPromises();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0]?.[0])).not.toContain(encodeURIComponent(START_KEY));
  });

  it('de-emphasizes a result bar backed by too few decided games', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          position: START_KEY,
          opening: null,
          total: 2,
          moves: [
            {
              from: 'h3',
              to: 'e3',
              games: 2,
              redWins: 2,
              blackWins: 0,
              draws: 0,
              unknowns: 0,
            },
          ],
          build: null,
        }),
      ),
    );

    const explorer = createOpeningExplorer();
    document.body.append(explorer.el);
    explorer.setActive(true);
    explorer.setState(createInitialXiangqiState('t'));
    await flushPromises();

    // 2 decided games would otherwise render an unqualified 100% red bar.
    const bar = explorer.el.querySelector('.opening-explorer__bar');
    expect(bar?.classList.contains('opening-explorer__bar--thin')).toBe(true);
  });
  it('lists top games by rating and plays a clicked move', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(payload())),
    );
    const played: XiangqiMove[] = [];

    const explorer = createOpeningExplorer();
    explorer.onPlayMove((move) => played.push(move));
    document.body.append(explorer.el);
    explorer.setActive(true);
    explorer.setState(createInitialXiangqiState('t'));
    await flushPromises();

    const top = [...explorer.el.querySelectorAll('.opening-explorer__top-row')];
    expect(top).toHaveLength(2);
    expect(top[0]?.textContent).toContain('2450');
    expect(top[0]?.textContent).toContain('2350');
    // Corpus games open at the historical review route, not the live /xiangqi one.
    expect(top[0]?.getAttribute('href')).toBe('/historical-xiangqi/game/hxq_top');

    // The explorer is a navigation surface: a row click plays its move.
    explorer.el.querySelector<HTMLButtonElement>('.opening-explorer__row')?.click();
    expect(played).toEqual([{ from: 'h3', to: 'e3' }]);
  });

  // Broadcast games are the second source in the build. They carry names rather
  // than ratings, and their ids resolve at the board route: sending one to the
  // historical route would 404 a game that exists.
  it('shows a broadcast top game by name and links it to its board', async () => {
    const base = payload();
    const withBroadcast = {
      ...base,
      // A broadcast sample carries no ratings at all: the identity is the names.
      topGames: [
        {
          id: 'xqb_board_1',
          kind: 'broadcast',
          rating: null,
          redRating: null,
          blackRating: null,
          redName: '孟辰',
          blackName: '李彦阳',
          event: '2026 National Xiangqi Team Championship',
          result: '1-0',
          playedOn: '2026-08-02',
        },
        ...base.topGames,
      ],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(withBroadcast)),
    );

    const explorer = createOpeningExplorer();
    document.body.append(explorer.el);
    explorer.setActive(true);
    explorer.setState(createInitialXiangqiState('t'));
    await flushPromises();

    const top = [...explorer.el.querySelectorAll('.opening-explorer__top-row')];
    expect(top[0]?.getAttribute('href')).toBe('/broadcast/xiangqi/board/xqb_board_1');
    expect(top[0]?.textContent).toContain('孟辰');
    expect(top[0]?.textContent).toContain('李彦阳');
    expect(top[0]?.getAttribute('title')).toBe('2026 National Xiangqi Team Championship');

    // A corpus row is unchanged: no kind, ratings, historical route.
    expect(top[1]?.getAttribute('href')).toBe('/historical-xiangqi/game/hxq_top');
    expect(top[1]?.textContent).toContain('2450');
  });

  it('shows the share of games each move took', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(payload())),
    );

    const explorer = createOpeningExplorer();
    document.body.append(explorer.el);
    explorer.setActive(true);
    explorer.setState(createInitialXiangqiState('t'));
    await flushPromises();

    const shares = [...explorer.el.querySelectorAll('.opening-explorer__count-share')].map(
      (el) => el.textContent,
    );
    expect(shares).toEqual(['70%', '30%']);
  });

  it('names the current position in a header, lichess style', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(payload())),
    );

    const explorer = createOpeningExplorer();
    document.body.append(explorer.el);
    explorer.setActive(true);
    explorer.setState(createInitialXiangqiState('t'));
    await flushPromises();

    const header = explorer.el.querySelector<HTMLElement>('.opening-explorer__opening');
    expect(header?.hidden).toBe(false);
    expect(header?.querySelector('.opening-explorer__opening-en')?.textContent).toBe(
      'Central Cannon',
    );
    expect(header?.querySelector('.opening-explorer__opening-zh')?.textContent).toBe('中炮');
  });

  it('hides the header on an unnamed position', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          position: START_KEY,
          opening: null,
          total: 0,
          moves: [],
          topGames: [],
          build: null,
        }),
      ),
    );

    const explorer = createOpeningExplorer();
    document.body.append(explorer.el);
    explorer.setActive(true);
    explorer.setState(createInitialXiangqiState('t'));
    await flushPromises();

    expect(explorer.el.querySelector<HTMLElement>('.opening-explorer__opening')?.hidden).toBe(true);
  });

  it('previews a hovered book move in the book tone', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(payload())),
    );
    const explorer = createOpeningExplorer();
    const hovered: [XiangqiMove | null, string | null][] = [];
    explorer.onHoverMove((move, tone) => hovered.push([move, tone]));
    explorer.setActive(true);
    explorer.setState(createInitialXiangqiState('t'));
    await flushPromises();

    const row = explorer.el.querySelector<HTMLElement>('.opening-explorer__row');
    row?.dispatchEvent(new MouseEvent('mouseenter'));
    row?.dispatchEvent(new MouseEvent('mouseleave'));
    expect(hovered[0]?.[1]).toBe('book');
    expect(hovered[1]).toEqual([null, null]);
  });
});

// Lichess's model: one book button, one pane; a covered endgame shows the exact
// table in that pane instead of the opening book.
describe('opening explorer with the tablebase', () => {
  const ENDGAME = '3k5/9/5N3/9/2b6/9/9/9/4K4/9 w';
  const EXACT: XiangqiTablebaseResponse = {
    status: 'exact',
    result: 'win',
    dtm: 9,
    moves: [
      { from: 'f8', to: 'd7', result: 'win', dtm: 9 },
      { from: 'f8', to: 'e6', result: 'draw', dtm: null },
    ],
  };

  function endgame(): XiangqiGameState {
    const parsed = parseStandardXiangqiFen(ENDGAME);
    if (!parsed.ok) throw new Error('bad fen');
    return parsed.state;
  }

  function book(el: HTMLElement): HTMLElement | null {
    return el.querySelector<HTMLElement>('.opening-explorer__book');
  }

  afterEach(() => {
    document.body.replaceChildren();
    vi.unstubAllGlobals();
  });

  it('shows the table in place of the book, and never asks the book', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(payload()));
    vi.stubGlobal('fetch', fetchSpy);
    const tablebase = createXiangqiTablebasePanel(async () => EXACT);
    const explorer = createOpeningExplorer({ tablebase });
    document.body.append(explorer.el);
    explorer.setActive(true);
    explorer.setState(endgame());
    await flushPromises();

    expect(tablebase.el.parentElement).toBe(explorer.el);
    expect(tablebase.el.hidden).toBe(false);
    expect(book(explorer.el)?.hidden).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('falls back to the book when the tablebase has no answer', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(payload()));
    vi.stubGlobal('fetch', fetchSpy);
    const tablebase = createXiangqiTablebasePanel(async () => ({ status: 'none' }));
    const explorer = createOpeningExplorer({ tablebase });
    explorer.setActive(true);
    explorer.setState(endgame());
    await flushPromises();

    expect(tablebase.el.hidden).toBe(true);
    expect(book(explorer.el)?.hidden).toBe(false);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('shows the book for an opening without asking the tablebase', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(payload())),
    );
    const lookup = vi.fn(async () => EXACT);
    const explorer = createOpeningExplorer({ tablebase: createXiangqiTablebasePanel(lookup) });
    explorer.setActive(true);
    explorer.setState(createInitialXiangqiState('t'));
    await flushPromises();

    expect(lookup).not.toHaveBeenCalled();
    expect(explorer.el.querySelectorAll('.opening-explorer__row')).toHaveLength(2);
  });

  it('stays closed and asks nothing while the pane is closed; opening catches up', async () => {
    const lookup = vi.fn(async () => EXACT);
    const tablebase = createXiangqiTablebasePanel(lookup);
    const explorer = createOpeningExplorer({ tablebase });
    explorer.setState(endgame());
    await flushPromises();
    expect(explorer.el.hidden).toBe(true);
    expect(lookup).not.toHaveBeenCalled();

    explorer.setActive(true);
    await flushPromises();
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(tablebase.el.hidden).toBe(false);

    // Close and reopen on the same position: the table is still there.
    explorer.setActive(false);
    expect(explorer.el.hidden).toBe(true);
    explorer.setActive(true);
    await flushPromises();
    expect(tablebase.el.hidden).toBe(false);
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it('plays and previews table rows through the pane, inked by result', async () => {
    const tablebase = createXiangqiTablebasePanel(async () => EXACT);
    const explorer = createOpeningExplorer({ tablebase });
    const played: XiangqiMove[] = [];
    const hovered: [XiangqiMove | null, string | null][] = [];
    explorer.onPlayMove((move) => played.push(move));
    explorer.onHoverMove((move, tone) => hovered.push([move, tone]));
    explorer.setActive(true);
    explorer.setState(endgame());
    await flushPromises();

    const rows = [...tablebase.el.querySelectorAll<HTMLElement>('.xq-tablebase__row')];
    rows[1]?.dispatchEvent(new MouseEvent('mouseenter'));
    rows[0]?.click();
    expect(hovered).toEqual([[{ from: 'f8', to: 'e6' }, 'draw']]);
    expect(played).toEqual([{ from: 'f8', to: 'd7' }]);
  });
});

function payload() {
  return {
    position: START_KEY,
    opening: { en: 'Central Cannon', zh: '中炮' },
    total: 10,
    moves: [
      {
        from: 'h3',
        to: 'e3',
        games: 7,
        redWins: 6,
        blackWins: 1,
        draws: 0,
        unknowns: 0,
      },
      {
        from: 'b3',
        to: 'e3',
        games: 3,
        redWins: 0,
        blackWins: 0,
        draws: 0,
        unknowns: 3,
      },
    ],
    topGames: [
      {
        id: 'hxq_top',
        rating: 2400,
        redRating: 2450,
        blackRating: 2350,
        result: '1-0',
        playedOn: '2026-03-06',
      },
      {
        id: 'hxq_next',
        rating: 1200,
        redRating: 1180,
        blackRating: 1220,
        result: '0-1',
        playedOn: '2026-02-01',
      },
    ],
    build: {
      gameCount: 10,
      maxPly: 24,
      sources: ['elephantchess-pvp'],
      builtAt: '2026-07-23T00:00:00.000Z',
    },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    status,
  });
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}
