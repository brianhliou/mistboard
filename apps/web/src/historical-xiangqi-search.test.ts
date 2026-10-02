import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_MIN_PLIES,
  eventLine,
  gamesSearchPageUrl,
  type HistoricalXiangqiGameListItem,
  historicalXiangqiOutcomeLabel,
  historicalXiangqiResultLabel,
  historicalXiangqiReviewUrl,
  historicalXiangqiSearchApiUrl,
  mountHistoricalXiangqiSearch,
  resultChip,
  roundLabel,
} from './historical-xiangqi-search.js';

describe('historical xiangqi search page', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/games/search');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('builds archive URLs and result labels', () => {
    expect(historicalXiangqiReviewUrl('hxq game')).toBe('/historical-xiangqi/game/hxq%20game');
    expect(
      historicalXiangqiSearchApiUrl({
        sort: 'recent',
        variant: '',
        player: 'Hu Ronghua',
        event: '',
        source: 'xqbase',
        result: '1-0',
        from: '1970-01-01',
        to: '',
        plyMin: '20',
        plyMax: '',
        offset: 50,
        limit: 100,
      }),
    ).toBe(
      '/api/historical-xiangqi/games?player=Hu+Ronghua&source=xqbase&result=1-0&from=1970-01-01&plyMin=20&offset=50&limit=100',
    );
    expect(historicalXiangqiResultLabel('1-0')).toBe('Red');
    expect(historicalXiangqiResultLabel('0-1')).toBe('Black');
    expect(historicalXiangqiResultLabel('1/2-1/2')).toBe('Draw');
    expect(historicalXiangqiOutcomeLabel('1-0')).toBe('Red wins');
    expect(historicalXiangqiOutcomeLabel('0-1')).toBe('Black wins');
    expect(historicalXiangqiOutcomeLabel('1/2-1/2')).toBe('Draw');
    expect(historicalXiangqiOutcomeLabel('*')).toBe('Unfinished');
  });

  it('renders filters and links result rows to the historical review route', async () => {
    const fetchSpy = vi.fn(async () =>
      jsonResponse({
        total: 1,
        offset: 0,
        limit: 50,
        games: [
          {
            id: 'hxq_1',
            kind: 'historical',
            reviewUrl: '/historical-xiangqi/game/hxq_1',
            sourceSlug: 'xqbase',
            sourceName: 'XQBase',
            sourceGameId: '123',
            sourceUrl: null,
            eventName: 'Wuyang Cup',
            site: 'Guangzhou',
            round: '1',
            board: null,
            playedOn: '1982-01-04',
            redNameRaw: 'Hu Ronghua',
            blackNameRaw: 'Liu Dahua',
            result: '1-0',
            plyCount: 83,
            sortAt: '1982-01-04',
            moveFormat: 'wxf',
          },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchSpy);
    const root = document.createElement('div');

    await mountHistoricalXiangqiSearch(root);

    expect(fetchSpy).toHaveBeenCalledWith('/api/historical-xiangqi/games?limit=50', {
      headers: { accept: 'application/json' },
    });
    expect(root.querySelector<HTMLInputElement>('input[type="search"]')).not.toBeNull();
    expect(root.textContent).toContain('1 game found');
    expect(root.textContent).toContain('Hu Ronghua vs Liu Dahua');
    expect(root.textContent).toContain('Wuyang Cup');
    expect(root.textContent).toContain('Archive');
    expect(root.querySelector<HTMLAnchorElement>('.historical-xiangqi-row')?.pathname).toBe(
      '/historical-xiangqi/game/hxq_1',
    );
  });

  it('renders broadcast rows English primary with the Chinese as a secondary span', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          total: 1,
          offset: 0,
          limit: 50,
          games: [
            {
              id: 'bcast_1',
              kind: 'broadcast',
              reviewUrl: '/broadcast/xiangqi/board/bcast_1',
              sourceSlug: 'broadcast',
              sourceName: 'Broadcast',
              sourceGameId: 'b1',
              sourceUrl: null,
              eventName: '2026全国象棋团体赛',
              eventNameEn: '2026 National Xiangqi Team Championship',
              site: null,
              round: '第3轮',
              roundNameEn: 'Round 3',
              board: '1',
              playedOn: '2026-07-01',
              redNameRaw: '徐腾飞',
              redNameEn: 'Xu Tengfei',
              blackNameRaw: '唐丹',
              blackNameEn: 'Tang Dan',
              result: '1-0',
              plyCount: 88,
              sortAt: '2026-07-01',
              moveFormat: 'broadcast',
            },
          ],
        }),
      ),
    );
    const root = document.createElement('div');

    await mountHistoricalXiangqiSearch(root);

    // English primary line, Chinese preserved in the secondary span.
    const matchup = root.querySelector('.historical-xiangqi-matchup');
    expect(matchup?.textContent).toContain('Xu Tengfei vs Tang Dan');
    expect(matchup?.querySelector('.historical-xiangqi-zh')?.textContent).toBe('徐腾飞 vs 唐丹');

    const event = root.querySelector('.historical-xiangqi-event');
    expect(event?.textContent).toContain('2026 National Xiangqi Team Championship');
    expect(event?.textContent).toContain('Round 3');
    expect(event?.querySelector('.historical-xiangqi-zh')?.textContent).toContain(
      '2026全国象棋团体赛',
    );
    expect(event?.querySelector('.historical-xiangqi-zh')?.textContent).toContain('第3轮');
  });

  // Applying a filter used to rewrite the bar to `/historical-xiangqi/games`,
  // a retired path that 301s back here, so a copied or reloaded filtered URL
  // took a redirect hop and lost its query.
  it('keeps the canonical /games/search path when filters are applied', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ total: 0, offset: 0, limit: 50, games: [] })),
    );
    const root = document.createElement('div');

    await mountHistoricalXiangqiSearch(root);
    const form = root.querySelector<HTMLFormElement>('form.historical-xiangqi-filters');
    const player = form?.querySelector<HTMLInputElement>('input[type="search"]');
    if (!form || !player) throw new Error('filter form did not render');
    player.value = 'Hu Ronghua';
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await Promise.resolve();

    expect(window.location.pathname).toBe('/games/search');
    expect(window.location.search).toBe('?player=Hu+Ronghua');
  });

  it('round-trips a non-default sort through the URL and the API call', async () => {
    window.history.replaceState(null, '', '/games/search?sort=longest');
    const requested: string[] = [];
    const fetchSpy = vi.fn(async (url: string) => {
      requested.push(url);
      return jsonResponse({ total: 0, offset: 0, limit: 50, games: [] });
    });
    vi.stubGlobal('fetch', fetchSpy);
    const root = document.createElement('div');

    await mountHistoricalXiangqiSearch(root);

    expect(requested[0]).toContain('sort=longest');
    expect(window.location.search).toContain('sort=longest');
    // The default stays out of the URL so a plain /games/search link is still canonical.
    const select = [...root.querySelectorAll<HTMLSelectElement>('select')].find((el) =>
      [...el.options].some((option) => option.value === 'shortest'),
    );
    expect(select?.value).toBe('longest');
  });

  // Regression: every select was built by setting `selected` on a detached
  // option before appending it, which the selectedness reset discards for
  // anything past the second position. Every result past "Red wins" rendered as
  // "Red wins" while the rows below were filtered correctly.
  it('renders the saved filter in every select, not just the first two options', async () => {
    window.history.replaceState(null, '', '/games/search?result=1%2F2-1%2F2&sort=shortest');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ total: 0, offset: 0, limit: 50, games: [] })),
    );
    const root = document.createElement('div');

    await mountHistoricalXiangqiSearch(root);

    const selects = [...root.querySelectorAll<HTMLSelectElement>('select')];
    const byOption = (value: string): HTMLSelectElement | undefined =>
      selects.find((el) => [...el.options].some((option) => option.value === value));
    expect(byOption('1/2-1/2')?.value).toBe('1/2-1/2');
    expect(byOption('shortest')?.value).toBe('shortest');
  });

  it('uses server-provided review URLs for non-archive rows', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          total: 1,
          offset: 0,
          limit: 50,
          games: [
            {
              id: 'mist_1',
              kind: 'mistboard',
              reviewUrl: '/xiangqi/game/mist_1',
              sourceSlug: 'mistboard',
              sourceName: 'Mistboard',
              sourceGameId: 'mist_1',
              sourceUrl: null,
              eventName: null,
              site: null,
              round: null,
              board: null,
              playedOn: '2026-07-09',
              redNameRaw: 'Red',
              blackNameRaw: 'Black',
              result: '1/2-1/2',
              plyCount: 42,
              sortAt: '2026-07-09T12:00:00.000Z',
              moveFormat: 'mistboard',
            },
          ],
        }),
      ),
    );
    const root = document.createElement('div');

    await mountHistoricalXiangqiSearch(root);

    expect(root.querySelector<HTMLAnchorElement>('.historical-xiangqi-row')?.pathname).toBe(
      '/xiangqi/game/mist_1',
    );
    expect(root.textContent).toContain('Mistboard');
  });
});

describe('games search variant picker', () => {
  const LAUNCHED = ['xiangqi', 'jieqi', 'banqi', 'dark-chess', 'jungle'];

  beforeEach(() => {
    window.history.replaceState(null, '', '/games/search');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubSearch(games: unknown[] = []): string[] {
    const requested: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        requested.push(url);
        return jsonResponse({
          total: games.length,
          offset: 0,
          limit: 50,
          games,
          variants: LAUNCHED,
        });
      }),
    );
    return requested;
  }

  async function settle(): Promise<void> {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  }

  function railLink(root: HTMLElement, variant: string): HTMLAnchorElement {
    const link = root.querySelector<HTMLAnchorElement>(`a[data-variant="${variant}"]`);
    if (!link) throw new Error(`no rail link for '${variant}'`);
    return link;
  }

  it('reads the variant from the URL, sends it, and marks it in the rail', async () => {
    window.history.replaceState(null, '', '/games/search?variant=jieqi&event=AB-JChess');
    const requested = stubSearch();
    const root = document.createElement('div');

    await mountHistoricalXiangqiSearch(root);

    expect(requested[0]).toBe(
      '/api/historical-xiangqi/games?variant=jieqi&event=AB-JChess&limit=50',
    );
    expect(window.location.search).toBe('?variant=jieqi&event=AB-JChess');
    expect(root.querySelector('h1')?.textContent).toBe('Jieqi games');
    // "All variants" first, then the server's list in its (canonical) order.
    const rail = [...root.querySelectorAll<HTMLAnchorElement>('.historical-xiangqi-rail a')];
    expect(rail.map((link) => link.dataset.variant)).toEqual(['', ...LAUNCHED]);
    expect(rail.find((link) => link.classList.contains('active'))?.dataset.variant).toBe('jieqi');
    expect(railLink(root, 'jieqi').getAttribute('aria-current')).toBe('page');
  });

  it('round-trips a rail pick through the URL, keeping the other filters', async () => {
    window.history.replaceState(null, '', '/games/search?variant=jieqi&event=AB-JChess&offset=50');
    const requested = stubSearch();
    const root = document.createElement('div');
    await mountHistoricalXiangqiSearch(root);

    // A real link: shareable and middle-clickable, back on page one.
    expect(railLink(root, 'dark-chess').getAttribute('href')).toBe(
      '/games/search?variant=dark-chess&event=AB-JChess',
    );
    railLink(root, 'dark-chess').click();
    await settle();
    expect(window.location.search).toBe('?variant=dark-chess&event=AB-JChess');
    expect(requested.at(-1)).toBe(
      '/api/historical-xiangqi/games?variant=dark-chess&event=AB-JChess&limit=50',
    );
    expect(root.querySelector('h1')?.textContent).toBe('Fog Chess games');

    railLink(root, '').click();
    await settle();
    expect(window.location.search).toBe('?event=AB-JChess');
    expect(root.querySelector('h1')?.textContent).toBe('Game search');
  });

  it('drops a xiangqi-only source when another variant is picked', async () => {
    window.history.replaceState(null, '', '/games/search?source=broadcast');
    stubSearch();
    const root = document.createElement('div');
    await mountHistoricalXiangqiSearch(root);

    railLink(root, 'jieqi').click();
    await settle();
    expect(window.location.search).toBe('?variant=jieqi');
    // Broadcasts and the archive are not offered for a non-xiangqi variant.
    const source = [...root.querySelectorAll<HTMLSelectElement>('select')].find((el) =>
      [...el.options].some((option) => option.value === 'engine-match'),
    );
    expect(source?.value).toBe('');
    expect([...(source?.options ?? [])].map((option) => option.value)).toEqual([
      '',
      'mistboard',
      'engine-match',
      'engine-game',
    ]);
    // The bots' scheduled games are their own source, offered for any variant.
    expect(
      [...(source?.options ?? [])].find((option) => option.value === 'engine-game')?.textContent,
    ).toBe('Engine games');
  });

  it('names the result options in the picked variant colours', async () => {
    window.history.replaceState(null, '', '/games/search?variant=dark-chess');
    stubSearch();
    const root = document.createElement('div');
    await mountHistoricalXiangqiSearch(root);
    const result = [...root.querySelectorAll<HTMLSelectElement>('select')].find((el) =>
      [...el.options].some((option) => option.value === '1-0'),
    );
    expect([...(result?.options ?? [])].map((option) => option.textContent)).toEqual([
      'Any result',
      'White wins',
      'Black wins',
      'Draw',
      'Unfinished',
    ]);
  });

  it('falls back to every variant when the server refuses a stale one', async () => {
    window.history.replaceState(null, '', '/games/search?variant=mini-xiangqi');
    const requested: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        requested.push(url);
        if (url.includes('variant=')) {
          return new Response(JSON.stringify({ error: 'invalid_variant' }), { status: 400 });
        }
        return jsonResponse({ total: 0, offset: 0, limit: 50, games: [], variants: LAUNCHED });
      }),
    );
    const root = document.createElement('div');
    await mountHistoricalXiangqiSearch(root);

    expect(requested).toEqual([
      '/api/historical-xiangqi/games?variant=mini-xiangqi&limit=50',
      '/api/historical-xiangqi/games?limit=50',
    ]);
    expect(window.location.search).toBe('');
    expect(root.textContent).not.toContain('Search failed');
  });

  it('links every row to the review URL the server routed it to', async () => {
    // The server resolves each row to its own variant's game page (checked
    // against the web tenant registry in variant-registry-sync.test.ts); the
    // page must link exactly there, whatever the variant.
    const urls: Record<string, string> = {
      xiangqi: '/xiangqi/game/r-xiangqi',
      jieqi: '/jieqi/game/r-jieqi',
      banqi: '/banqi/game/r-banqi',
      'dark-chess': '/game/r-dark-chess',
      jungle: '/jungle/game/r-jungle',
    };
    stubSearch(
      Object.entries(urls).map(([variant, reviewUrl]) =>
        listItem({ id: `r-${variant}`, variant, reviewUrl }),
      ),
    );
    const root = document.createElement('div');
    await mountHistoricalXiangqiSearch(root);

    const rows = [...root.querySelectorAll<HTMLAnchorElement>('.historical-xiangqi-row')];
    expect(rows.map((row) => row.pathname)).toEqual(Object.values(urls));
    // Each row names its variant.
    expect(
      rows.map((row) => row.querySelector('.historical-xiangqi-pill-variant')?.textContent),
    ).toEqual(['Xiangqi', 'Jieqi', 'Banqi', 'Fog Chess', 'Jungle Chess']);
  });

  it('paints the result in the row variant own colours', () => {
    const chip = (overrides: Partial<HistoricalXiangqiGameListItem>) =>
      resultChip(listItem(overrides));
    expect(chip({ variant: 'xiangqi', result: '1-0' })).toEqual({ label: 'Red', tone: 'red' });
    expect(chip({ variant: 'jieqi', result: '0-1' })).toEqual({ label: 'Black', tone: 'black' });
    expect(chip({ variant: 'dark-chess', result: '1-0' })).toEqual({
      label: 'White',
      tone: 'white',
    });
    expect(chip({ variant: 'dark-chess', result: '0-1' })).toEqual({
      label: 'Black',
      tone: 'black',
    });
    expect(chip({ variant: 'jungle', result: '0-1' })).toEqual({ label: 'Blue', tone: 'blue' });
    // Flip variants: the first seat played whatever its opening flip bound.
    expect(chip({ variant: 'banqi', result: '1-0', firstColor: 'black' })).toEqual({
      label: 'Black',
      tone: 'black',
    });
    expect(chip({ variant: 'jungle-flip', result: '0-1', firstColor: 'black' })).toEqual({
      label: 'Red',
      tone: 'red',
    });
    expect(chip({ variant: 'banqi', result: '1-0', firstColor: null })).toEqual({
      label: 'First',
      tone: 'neutral',
    });
    expect(chip({ variant: 'jieqi', result: '1/2-1/2' })).toEqual({ label: 'Draw', tone: 'draw' });
    // Older responses carried no variant: they were xiangqi.
    expect(chip({ variant: undefined, result: '1-0' })).toEqual({ label: 'Red', tone: 'red' });
  });

  it('labels a round once, whether it is stored as a number or as a label', () => {
    expect(roundLabel('5')).toBe('Round 5');
    expect(roundLabel('Round 5')).toBe('Round 5');
    expect(roundLabel('第5轮')).toBe('第5轮');
    expect(roundLabel('  ')).toBeNull();
    expect(
      eventLine(
        listItem({ kind: 'broadcast', eventName: 'National Team Championship', round: 'Round 5' }),
      ),
    ).toBe('National Team Championship · Round 5');
    // A game played here has no event; its room id is not one.
    expect(eventLine(listItem({ kind: 'mistboard', eventName: null, sourceGameId: 'jq_1' }))).toBe(
      '',
    );
    expect(
      eventLine(
        listItem({ kind: 'engine-match', eventName: 'AB-JChess vs PikaJieQi · 4 s · 2026-09' }),
      ),
    ).toBe('AB-JChess vs PikaJieQi · 4 s · 2026-09');
    // An engine game has no event either: two of the site's bots, on a schedule.
    expect(
      eventLine(listItem({ kind: 'engine-game', eventName: null, sourceGameId: 'jq_eve_1' })),
    ).toBe('');
  });
});

function listItem(
  overrides: Partial<HistoricalXiangqiGameListItem>,
): HistoricalXiangqiGameListItem {
  return {
    id: 'g1',
    kind: 'mistboard',
    variant: 'xiangqi',
    reviewUrl: '/xiangqi/game/g1',
    sourceSlug: 'mistboard',
    sourceName: 'Mistboard',
    sourceGameId: 'g1',
    sourceUrl: null,
    eventName: null,
    site: null,
    round: null,
    board: null,
    playedOn: '2026-09-20',
    redNameRaw: 'A',
    blackNameRaw: 'B',
    result: '1-0',
    plyCount: 40,
    sortAt: '2026-09-20T10:00:00.000Z',
    moveFormat: 'mistboard',
    ...overrides,
  };
}

// Most short rows are openings a guest abandoned against a bot. The default
// floor hides them from games played here; the form shows it, it stays out of
// the URL while it is the default, and clearing it is a choice the URL keeps.
describe('the default minimum length', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/games/search');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const minPliesInput = (root: HTMLElement) =>
    root.querySelector<HTMLInputElement>('input[type="number"]');

  it('shows in the form and the summary, but not in the URL or the query', async () => {
    const requested: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        requested.push(url);
        return jsonResponse({ total: 3, offset: 0, limit: 50, games: [], playedPlyFloor: 10 });
      }),
    );
    const root = document.createElement('div');
    await mountHistoricalXiangqiSearch(root);

    expect(requested[0]).toBe('/api/historical-xiangqi/games?limit=50');
    expect(window.location.search).toBe('');
    expect(minPliesInput(root)?.value).toBe(DEFAULT_MIN_PLIES);
    expect(root.querySelector('.historical-xiangqi-floor')?.textContent).toContain(
      'Games played here shorter than 10 plies are hidden.',
    );
  });

  it('clears to no minimum from the summary, and the URL keeps the choice', async () => {
    const requested: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        requested.push(url);
        const floored = !url.includes('plyMin=');
        return jsonResponse({
          total: 0,
          offset: 0,
          limit: 50,
          games: [],
          playedPlyFloor: floored ? 10 : null,
        });
      }),
    );
    const root = document.createElement('div');
    await mountHistoricalXiangqiSearch(root);
    root.querySelector<HTMLButtonElement>('.historical-xiangqi-floor-clear')?.click();
    await vi.waitFor(() => expect(requested).toHaveLength(2));

    expect(requested[1]).toBe('/api/historical-xiangqi/games?plyMin=0&limit=50');
    expect(window.location.search).toBe('?plyMin=0');
    await vi.waitFor(() => expect(root.querySelector('.historical-xiangqi-floor')).toBeNull());
    expect(minPliesInput(root)?.value).toBe('0');
  });

  it('reads an emptied field as no minimum, and Reset brings the default back', async () => {
    const requested: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        requested.push(url);
        return jsonResponse({ total: 0, offset: 0, limit: 50, games: [] });
      }),
    );
    const root = document.createElement('div');
    await mountHistoricalXiangqiSearch(root);
    const form = root.querySelector<HTMLFormElement>('form.historical-xiangqi-filters');
    const input = minPliesInput(root);
    if (!form || !input) throw new Error('filter form did not render');
    input.value = '';
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(requested).toHaveLength(2));
    expect(window.location.search).toBe('?plyMin=0');

    const reset = Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent === 'Reset',
    );
    reset?.click();
    await vi.waitFor(() => expect(requested).toHaveLength(3));
    expect(requested[2]).toBe('/api/historical-xiangqi/games?limit=50');
    expect(window.location.search).toBe('');
    expect(minPliesInput(root)?.value).toBe(DEFAULT_MIN_PLIES);
  });

  it('a link that names its own minimum keeps it', () => {
    expect(
      gamesSearchPageUrl({
        sort: 'recent',
        variant: 'jieqi',
        player: '',
        event: '',
        source: '',
        result: '',
        from: '',
        to: '',
        plyMin: '20',
        plyMax: '',
        offset: 0,
        limit: 50,
      }),
    ).toBe('/games/search?variant=jieqi&plyMin=20');
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    status: 200,
  });
}
