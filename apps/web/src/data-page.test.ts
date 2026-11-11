import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  currentMonthKey,
  type DataListing,
  dataOpponents,
  formatBytes,
  formatMonth,
  monthAfter,
  mountDataAbout,
  mountDataPage,
  readVariant,
} from './data-page.js';

const LISTING: DataListing = {
  license: 'CC BY 4.0',
  schemaVersion: '1.1',
  variants: ['xiangqi', 'jieqi'],
  months: [
    {
      month: '2026-09',
      games: 12,
      files: [
        {
          format: 'jsonl',
          path: '/api/data/monthly/2026-09/all.jsonl.gz',
          fileName: 'mistboard_all_2026-09.jsonl.gz',
          games: 12,
          built: null,
        },
      ],
      variants: [
        {
          variant: 'xiangqi',
          games: 10,
          files: [
            {
              format: 'pgn',
              path: '/api/data/monthly/2026-09/xiangqi.pgn.gz',
              fileName: 'mistboard_xiangqi_2026-09.pgn.gz',
              games: 10,
              built: null,
            },
            {
              format: 'jsonl',
              path: '/api/data/monthly/2026-09/xiangqi.jsonl.gz',
              fileName: 'mistboard_xiangqi_2026-09.jsonl.gz',
              games: 10,
              built: { bytes: 2560, sha256: 'a'.repeat(64), builtAt: '2026-10-01T00:00:00Z' },
            },
          ],
        },
        {
          variant: 'jieqi',
          games: 2,
          files: [
            {
              format: 'jsonl',
              path: '/api/data/monthly/2026-09/jieqi.jsonl.gz',
              fileName: 'mistboard_jieqi_2026-09.jsonl.gz',
              games: 2,
              built: null,
            },
          ],
        },
      ],
    },
  ],
  collections: [
    {
      id: 'ab-jchess-vs-pikajieqi-4s-2026-09',
      event: 'AB-JChess vs PikaJieQi · 4 s · 2026-09',
      credit: {
        work: 'AB-JChess',
        authors: ['Huorongrong', 'Laoxu (Kouza)'],
        url: 'https://github.com/lxsgx23/AB-JChess',
        permission: true,
      },
      variant: 'jieqi',
      games: 400,
      firstStartedAt: '2026-09-29T10:00:00Z',
      lastEndedAt: '2026-09-30T10:00:00Z',
      files: [
        {
          format: 'jsonl',
          path: '/api/data/collections/ab-jchess-vs-pikajieqi-4s-2026-09.jsonl.gz',
          fileName: 'mistboard_ab-jchess-vs-pikajieqi-4s-2026-09.jsonl.gz',
          games: 400,
          built: null,
        },
      ],
    },
  ],
};

async function mounted(search = ''): Promise<HTMLElement> {
  window.history.replaceState(null, '', `/data${search}`);
  const root = document.createElement('main');
  document.body.append(root);
  await mountDataPage(root);
  return root;
}

function rowCells(root: HTMLElement, section: string): string[][] {
  return [...root.querySelectorAll(`${section} .data-table tbody tr`)].map((row) =>
    [...row.children].map((cell) => cell.textContent ?? ''),
  );
}

describe('/data page', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => LISTING })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('loads a bot deep link and preserves its stable ID on variant links', async () => {
    const filtered = {
      ...LISTING,
      botId: 'jqe',
      bots: [{ id: 'jqe', displayName: 'New bot name', variants: ['jieqi'] }],
    };
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => filtered } as Response);
    const root = await mounted('?variant=jieqi&bot=jqe');
    expect(fetch).toHaveBeenCalledWith('/api/data?bot=jqe', { cache: 'no-store' });
    const select = root.querySelector<HTMLSelectElement>('.data-bot-filter select')!;
    expect(select.value).toBe('jqe');
    expect(select.textContent).toContain('New bot name');
    expect(root.querySelector('[data-variant="xiangqi"]')?.getAttribute('href')).toBe(
      '/data?variant=xiangqi&bot=jqe',
    );
    select.value = '';
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ ...LISTING, bots: filtered.bots }),
    } as Response);
    select.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(select.value).toBe(''));
    expect(window.location.search).toBe('?variant=jieqi');
    expect(fetch).toHaveBeenLastCalledWith('/api/data', { cache: 'no-store' });
  });

  it('counts a selected bot scheduled games in the headline and rail', async () => {
    const filtered = {
      ...LISTING,
      botId: 'jqe',
      months: [],
      engineMonths: [
        { ...LISTING.months[0]!, games: 2, variants: [LISTING.months[0]!.variants[1]!] },
      ],
      bots: [{ id: 'jqe', displayName: 'jqe', variants: ['jieqi'] }],
    };
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => filtered } as Response);
    const root = await mounted('?variant=jieqi&bot=jqe');
    expect(root.querySelector('.current-games-count')?.textContent).toBe('2 games in 1 month');
    expect(
      root.querySelector('[data-variant="jieqi"] .current-games-rail-count')?.textContent,
    ).toBe('2');
    expect(root.textContent).not.toContain('No finished month has games yet.');
  });

  it('defaults to All variants: one row per month with the mixed JSONL file', async () => {
    const root = await mounted();
    expect(
      root.querySelector('.current-games-rail-link.active')?.getAttribute('data-variant'),
    ).toBe('all');
    expect(
      [...root.querySelectorAll('.data-months .data-table thead th')].map((th) => th.textContent),
    ).toEqual(['Month', 'Games', 'Download', 'SHA-256']);
    expect(rowCells(root, '.data-months')).toEqual([
      ['September 2026', '12', 'JSONL', 'Built on first download; size and checksum appear after.'],
    ]);
    expect(root.querySelector('.data-months .data-download')?.getAttribute('href')).toBe(
      '/api/data/monthly/2026-09/all.jsonl.gz',
    );
    // The unbuilt file says it in its own row; the note under the table no
    // longer repeats it, and names the open month.
    const notes = root.querySelector('.data-months')?.textContent ?? '';
    expect(notes).not.toContain('first time anyone downloads');
    expect(notes.match(/Built on first download/g)).toHaveLength(1);
    expect(notes).toContain(`${formatMonth(currentMonthKey())} is added when the month ends.`);
    // No collections and no notes on this page: the notes are one link away.
    expect(root.querySelector('.data-collections')).toBeNull();
    expect(root.querySelector('.data-about')).toBeNull();
    expect(root.textContent).not.toContain('AB-JChess');
    const about = root.querySelector<HTMLAnchorElement>('.data-about-link a');
    expect(about?.getAttribute('href')).toBe('/data/about');
    expect(about?.textContent).toBe(
      "What's in the files, the license, and how hidden pieces appear",
    );
    expect(root.querySelector('.data-cite')?.textContent).toContain(
      'Game data from Mistboard, https://mistboard.com/data, CC BY 4.0.',
    );
  });

  it('shows the selected variant with PGN and JSONL, size and hash once built', async () => {
    const root = await mounted('?variant=xiangqi');
    expect(root.querySelector('.data-months h2')?.textContent).toBe('Xiangqi');
    const [row] = rowCells(root, '.data-months');
    expect(row?.[0]).toBe('September 2026');
    expect(row?.[1]).toBe('10');
    expect(row?.[2]).toBe('PGNJSONL2.5 kB');
    expect(row?.[3]).toContain('JSONL');
    const hash = root.querySelector('.data-months button.data-hash');
    expect(hash?.getAttribute('title')).toBe('a'.repeat(64));
    expect(hash?.textContent).toBe('JSONLaaaaaaaCopy');
    // The unbuilt PGN beside it says when its checksum comes, never a made-up one.
    expect(root.querySelector('.data-months .data-hash-pending')?.textContent).toBe(
      'PGN: built on first download',
    );
  });

  it('round-trips the variant through the URL; an unknown value falls back to All', async () => {
    expect(readVariant(LISTING, '?variant=jieqi')).toBe('jieqi');
    expect(readVariant(LISTING, '?variant=mahjong')).toBe('all');
    expect(readVariant(LISTING, '?variant=all')).toBe('all');
    expect(readVariant(LISTING, '')).toBe('all');

    const root = await mounted('?variant=nope');
    expect(
      root.querySelector('.current-games-rail-link.active')?.getAttribute('data-variant'),
    ).toBe('all');
    root
      .querySelector<HTMLAnchorElement>('.current-games-rail-link[data-variant="jieqi"]')
      ?.click();
    expect(window.location.search).toBe('?variant=jieqi');
    expect(rowCells(root, '.data-months')).toEqual([
      ['September 2026', '2', 'JSONL', 'Built on first download; size and checksum appear after.'],
    ]);
    root.querySelector<HTMLAnchorElement>('.current-games-rail-link[data-variant="all"]')?.click();
    expect(window.location.search).toBe('');
  });

  it('lists engine games in their own table under their own heading, never in the human rows', async () => {
    const engineFile = (variant: string, games: number) => ({
      format: 'jsonl' as const,
      path: `/api/data/engine-monthly/2026-09/${variant}.jsonl.gz`,
      fileName: `mistboard_engine_${variant}_2026-09.jsonl.gz`,
      games,
      built: null,
    });
    const withEngine: DataListing = {
      ...LISTING,
      variants: ['xiangqi', 'jieqi', 'duck-xiangqi'],
      engineMonths: [
        {
          month: '2026-09',
          games: 90,
          files: [engineFile('all', 90)],
          variants: [
            { variant: 'xiangqi', games: 60, files: [engineFile('xiangqi', 60)] },
            { variant: 'duck-xiangqi', games: 30, files: [engineFile('duck-xiangqi', 30)] },
          ],
        },
      ],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => withEngine })),
    );
    const root = await mounted();
    const human = [...root.querySelectorAll('.data-months .data-table:not(.data-table-engine) tr')];
    expect(human.map((row) => row.querySelector('a')?.getAttribute('href') ?? null)).toEqual([
      null,
      '/api/data/monthly/2026-09/all.jsonl.gz',
    ]);
    const headings = [...root.querySelectorAll('.data-months h2')].map((h) => h.textContent);
    expect(headings).toEqual(['All variants', 'Engine games']);
    expect(rowCells(root, '.data-months .data-table-engine').length).toBe(0);
    const engineRows = [...root.querySelectorAll('.data-table-engine tbody tr')];
    expect(engineRows.map((row) => row.querySelector('.data-col-games')?.textContent)).toEqual([
      '90',
    ]);
    expect(root.querySelector('.data-table-engine a')?.getAttribute('href')).toBe(
      '/api/data/engine-monthly/2026-09/all.jsonl.gz',
    );
    // The human count line is the human games only.
    expect(root.querySelector('.current-games-count')?.textContent).toBe('12 games in 1 month');

    // A variant with no engine games shows no engine section at all.
    root
      .querySelector<HTMLAnchorElement>('.current-games-rail-link[data-variant="jieqi"]')
      ?.click();
    expect(root.querySelector('.data-table-engine')).toBeNull();
    // One with engine games only: no human month, its engine month below.
    root
      .querySelector<HTMLAnchorElement>('.current-games-rail-link[data-variant="duck-xiangqi"]')
      ?.click();
    expect(root.querySelector('.data-table-engine a')?.getAttribute('href')).toBe(
      '/api/data/engine-monthly/2026-09/duck-xiangqi.jsonl.gz',
    );
  });

  it('lists every offered variant, empty ones included, and names the ones with no downloads', async () => {
    const listing: DataListing = {
      ...LISTING,
      offeredVariants: ['xiangqi', 'jieqi', 'gomoku'],
      firstArchives: [{ variant: 'gomoku', month: '2026-11' }],
      unavailableVariants: [{ variant: 'jungle-flip', reason: 'no-export' }],
    };
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => listing } as Response);
    expect(readVariant(listing, '?variant=jungle-flip')).toBe('jungle-flip');
    expect(readVariant(listing, '?variant=gomoku')).toBe('gomoku');
    const root = await mounted('?variant=gomoku');
    const rail = [...root.querySelectorAll<HTMLElement>('.current-games-rail-link')];
    expect(rail.map((link) => link.dataset.variant)).toEqual([
      'all',
      'xiangqi',
      'jieqi',
      'gomoku',
      'jungle-flip',
    ]);
    expect(
      root.querySelector('[data-variant="gomoku"] .current-games-rail-count')?.textContent,
    ).toBe('0');
    const none = root.querySelector<HTMLAnchorElement>('[data-variant="jungle-flip"]')!;
    expect(none.classList.contains('is-unavailable')).toBe(true);
    expect(none.querySelector('.current-games-rail-count')?.textContent).toBe('');

    const months = () => root.querySelector('.data-months')!;
    expect(months().textContent).toContain(
      'The first Gomoku games were played in November 2026. Their file appears once that month ends, on December 1, 2026.',
    );
    expect(months().querySelector('.data-table')).toBeNull();
    expect(months().querySelector('.data-search-link a')?.getAttribute('href')).toBe(
      '/games/search?variant=gomoku&source=mistboard',
    );

    none.click();
    expect(window.location.search).toBe('?variant=jungle-flip');
    expect(months().textContent).toContain('No downloads for Flip Jungle yet.');
    expect(months().textContent).not.toMatch(/\b20\d\d\b/);
    expect(months().querySelector('.data-table, .data-download')).toBeNull();
    expect(months().textContent).not.toContain('first time anyone downloads');
  });

  it('picks an opponent, then all its levels or one; old and exact bot links land on the level', async () => {
    const bots = [
      {
        id: 'fairy-stockfish-level-1',
        displayName: 'Fairy-Stockfish Level 1',
        variants: ['xiangqi'],
      },
      {
        id: 'fairy-stockfish-level-2',
        displayName: 'Fairy-Stockfish Level 2',
        variants: ['xiangqi'],
      },
      { id: 'jqe', displayName: 'jqe', variants: ['jieqi'] },
      { id: 'someones-bot', displayName: "Someone's bot", variants: ['xiangqi'] },
    ];
    expect(dataOpponents({ bots }).map((o) => [o.key, o.name, o.levelled])).toEqual([
      ['fairy-stockfish', 'Fairy-Stockfish', true],
      ['jqe', 'jqe', false],
      ['someones-bot', "Someone's bot", false],
    ]);
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ ...LISTING, bots, opponentId: 'fairy-stockfish' }),
    } as Response);
    const root = await mounted('?variant=xiangqi&opponent=fairy-stockfish');
    expect(fetch).toHaveBeenCalledWith('/api/data?opponent=fairy-stockfish', { cache: 'no-store' });
    const [opponent, level] = [
      ...root.querySelectorAll<HTMLSelectElement>('.data-bot-filter select'),
    ];
    expect(opponent!.value).toBe('fairy-stockfish');
    expect(level!.hidden).toBe(false);
    expect([...level!.options].map((o) => [o.value, o.textContent])).toEqual([
      ['', 'All levels'],
      ['fairy-stockfish-level-1', 'Level 1'],
      ['fairy-stockfish-level-2', 'Level 2'],
    ]);
    expect(level!.value).toBe('');
    expect(root.querySelector('[data-variant="jieqi"]')?.getAttribute('href')).toBe(
      '/data?variant=jieqi&opponent=fairy-stockfish',
    );
    // No search link: /games/search has no bot filter, so it would show more.
    expect(root.querySelector('.data-search-link')).toBeNull();

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ ...LISTING, bots, botId: 'fairy-stockfish-level-2' }),
    } as Response);
    level!.value = 'fairy-stockfish-level-2';
    level!.dispatchEvent(new Event('change'));
    expect(window.location.search).toBe('?variant=xiangqi&bot=fairy-stockfish-level-2');
    await vi.waitFor(() => expect(level!.value).toBe('fairy-stockfish-level-2'));
    expect(fetch).toHaveBeenLastCalledWith('/api/data?bot=fairy-stockfish-level-2', {
      cache: 'no-store',
    });

    // A one-bot opponent is a plain bot link with no level picker.
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ ...LISTING, bots, botId: 'jqe' }),
    } as Response);
    opponent!.value = 'jqe';
    opponent!.dispatchEvent(new Event('change'));
    expect(window.location.search).toBe('?variant=xiangqi&bot=jqe');
    await vi.waitFor(() => expect(level!.hidden).toBe(true));
    expect(opponent!.value).toBe('jqe');
  });

  it('an old bot id resolves to its opponent and level', async () => {
    const bots = [
      {
        id: 'fairy-stockfish-level-1',
        displayName: 'Fairy-Stockfish Level 1',
        variants: ['xiangqi'],
      },
      {
        id: 'fairy-stockfish-level-2',
        displayName: 'Fairy-Stockfish Level 2',
        variants: ['xiangqi'],
      },
    ];
    // The server answers an old id with the bot's current one.
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ ...LISTING, bots, botId: 'fairy-stockfish-level-2' }),
    } as Response);
    const root = await mounted('?bot=fairy-stockfish-xiangqi-level-2');
    expect(fetch).toHaveBeenCalledWith('/api/data?bot=fairy-stockfish-xiangqi-level-2', {
      cache: 'no-store',
    });
    const [opponent, level] = [
      ...root.querySelectorAll<HTMLSelectElement>('.data-bot-filter select'),
    ];
    expect(opponent!.value).toBe('fairy-stockfish');
    expect(level!.value).toBe('fairy-stockfish-level-2');
  });

  it('links the unfiltered listing to the same games on /games/search', async () => {
    const root = await mounted();
    expect(root.querySelector('.data-search-link a')?.getAttribute('href')).toBe(
      '/games/search?source=mistboard',
    );
    expect(monthAfter('2026-11')).toBe('2026-12');
    expect(monthAfter('2026-12')).toBe('2027-01');
  });

  it('/data/about shows every section openly, with a way back', () => {
    window.history.replaceState(null, '', '/data/about');
    const root = document.createElement('main');
    document.body.append(root);
    mountDataAbout(root);
    expect(root.querySelector('h1')?.textContent).toBe('About the data');
    expect(root.querySelector('details')).toBeNull();
    expect([...root.querySelectorAll('.data-about-section h2')].map((h) => h.textContent)).toEqual([
      'Formats',
      'License',
      'What is included',
      'Hidden information',
      'Engine games',
      'Files and checksums',
    ]);
    expect(root.textContent).toContain('never in the files of games people played');
    expect(root.querySelector('.data-back a')?.getAttribute('href')).toBe('/data');
    expect(root.querySelector('.data-fields')).not.toBeNull();
    expect(root.querySelector('.data-cite')?.textContent).toContain(
      'Game data from Mistboard, https://mistboard.com/data, CC BY 4.0.',
    );
  });
});

describe('/data formatting', () => {
  it('formats months and sizes per locale', () => {
    expect(formatMonth('2026-09', 'en')).toBe('September 2026');
    expect(formatMonth('2026-09', 'zh-Hans')).toBe('2026年9月');
    expect(formatBytes(512, 'en')).toBe('512 B');
    expect(formatBytes(1536, 'en')).toBe('1.5 kB');
    expect(currentMonthKey(new Date('2026-10-01T03:00:00Z'))).toBe('2026-10');
  });
});
