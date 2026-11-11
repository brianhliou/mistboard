// Dates come from the public records shown by a server body, never request time.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { CANONICAL_VARIANT_ORDER } from '@mistboard/game';
import { historicalBoardPage, puzzleBoardBody, puzzleHeading } from './board-pages.js';
import { dataPageBody, dataRouteBody } from './data-page-body.js';
import { type DataListing, isDataVariantKey } from './game-data-files.js';
import { COUNTED_USER, countedPublicGame } from './persistence-counted-games.js';
import { getPool, isInitialized } from './persistence-db.js';
import { publishedEngineGame, publishedGame } from './persistence-game-data.js';
import {
  type HistoricalXiangqiGame,
  listHistoricalSitemapGames,
} from './persistence-historical-xiangqi.js';
import { discoverablePuzzles, getPuzzleStore } from './puzzle-store.js';
import { loadDataListing } from './routes/data.js';
import { type SitemapEntry, sitemapContract, sitemapPathIsTracked } from './sitemap-content.js';

export function bodyMeetsSitemapFloor(path: string, body: string): boolean {
  const contract = sitemapContract(path);
  const text = body
    .replace(/<[^>]*>/g, '')
    .replace(/&(?:amp|quot|lt|gt|apos|#\d+|#x[\da-f]+);/gi, 'x')
    .replace(/\s+/gu, ' ')
    .trim();
  // Match scripts/lib/crawler-text.mjs: CJK ideographs/kana count twice in every locale.
  const chars = Array.from(text).reduce(
    (count, char) =>
      count + (/[\p{Unified_Ideograph}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(char) ? 2 : 1),
    0,
  );
  return (
    !!contract &&
    sitemapPathIsTracked(path) &&
    chars >= Math.max(150, contract.minChars, Math.floor(contract.baselineChars * 0.6)) &&
    /<h1[\s>]/.test(body) &&
    (contract.routeId !== path ||
      text
        .replace(/\s+/gu, '')
        .toLowerCase()
        .includes(contract.phrase.replace(/\s+/gu, '').toLowerCase()))
  );
}

export async function serverBodyDates(): Promise<Map<string, string>> {
  if (!isInitialized()) return new Map();
  const pool = getPool();
  const { rows } = await pool.query<{ path: string; lastmod: Date | null }>(
    `
    SELECT '/stats' AS path, GREATEST(
      (SELECT MAX(g.ended_at) FROM games g WHERE ${countedPublicGame('g')}),
      (SELECT MAX(created_at) FROM users WHERE ${COUNTED_USER})
    ) AS lastmod
    UNION ALL
    SELECT '/coach', MAX(updated_at) FROM (
      SELECT cp.updated_at FROM coach_profiles cp JOIN users u ON u.id = cp.user_id
      WHERE cp.published = true AND u.title IS NOT NULL
      ORDER BY cp.accepting_students DESC, cp.created_at DESC, cp.user_id DESC LIMIT 200
    ) shown_coaches
    UNION ALL
    SELECT '/data', MAX(g.ended_at) FROM games g
      WHERE (${publishedGame('g')} OR ${publishedEngineGame('g')})
        AND g.ended_at < (date_trunc('month', CURRENT_TIMESTAMP AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')
        AND g.variant = ANY($1::text[])
    UNION ALL
    SELECT '/forum', MAX(p.created_at) FROM forum_posts p JOIN forum_topics t ON t.id = p.topic_id WHERE p.hidden_at IS NULL AND t.hidden_at IS NULL
  `,
    [[...CANONICAL_VARIANT_ORDER].filter(isDataVariantKey)],
  );
  const listing = await loadDataListing();
  const data = rows.find((row) => row.path === '/data');
  if (data) data.lastmod = dataListingLastmod(listing, data.lastmod);
  return datedServerBodies(rows, (path) =>
    path === '/data' ? Promise.resolve(dataPageBody(listing, 'en')) : dataRouteBody(path, 'en'),
  );
}

export function dataListingLastmod(
  listing: DataListing,
  monthlyRecordDate: Date | null,
): Date | null {
  const times = [
    monthlyRecordDate?.getTime(),
    ...listing.collections.map((collection) => Date.parse(collection.lastEndedAt)),
    ...[...listing.months, ...listing.engineMonths, ...listing.collections].flatMap((entry) =>
      entry.files.map((file) => (file.built ? Date.parse(file.built.builtAt) : NaN)),
    ),
    ...[...listing.months, ...listing.engineMonths].flatMap((month) =>
      month.variants.flatMap((variant) =>
        variant.files.map((file) => (file.built ? Date.parse(file.built.builtAt) : NaN)),
      ),
    ),
  ].filter((time): time is number => time !== undefined && Number.isFinite(time));
  return times.length ? new Date(Math.max(...times)) : null;
}

export async function datedServerBodies(
  rows: readonly { path: string; lastmod: Date | null }[],
  body: (path: string) => Promise<string | null>,
): Promise<Map<string, string>> {
  const dates = new Map<string, string>();
  for (const row of rows) {
    const html = row.lastmod && (await body(row.path));
    if (html && bodyMeetsSitemapFloor(row.path, html))
      dates.set(row.path, row.lastmod!.toISOString().slice(0, 10));
  }
  return dates;
}

export type ArchiveSitemapSources = {
  historical: (afterId: string) => Promise<HistoricalXiangqiGame[]>;
  puzzleDates: () => Promise<Map<string, Date>>;
  puzzles: typeof getPuzzleStore;
};

export function puzzleContentDate(
  sourceKind: string,
  createdAt: Date,
  seedLastmod?: string,
): Date | null {
  if (sourceKind !== 'seed') return createdAt;
  if (!seedLastmod || !/^\d{4}-\d{2}-\d{2}$/.test(seedLastmod)) return null;
  return new Date(Math.max(createdAt.getTime(), Date.parse(seedLastmod)));
}

const archiveCache = new Map<string, { at: number; entries: Promise<SitemapEntry[]> }>();

function liveArchiveSources(staticDir: string): ArchiveSitemapSources {
  return {
    // The index structure is unchanged. Bound each new file by the sitemap limit.
    historical: listHistoricalSitemapGames,
    puzzleDates: async () => {
      const { rows } = await getPool().query<{ id: string; created_at: Date; source_kind: string }>(
        'SELECT id, created_at, source_kind FROM puzzles WHERE hidden_reason IS NULL ORDER BY seq, id LIMIT 50000',
      );
      const seed = await readFile(resolve(staticDir, 'puzzle-content-date.json'), 'utf8')
        .then((json) => JSON.parse(json) as { lastmod: string })
        .catch(() => null);
      return new Map(
        rows.flatMap((row) => {
          const date = puzzleContentDate(row.source_kind, row.created_at, seed?.lastmod);
          return date ? [[row.id, date] as const] : [];
        }),
      );
    },
    puzzles: getPuzzleStore,
  };
}

export async function archiveSitemapEntries(
  section: 'historical' | 'puzzles',
  sources?: ArchiveSitemapSources,
  staticDir = '',
): Promise<SitemapEntry[]> {
  if (!sources && !isInitialized()) return [];
  if (!sources) {
    const key = `${staticDir}\n${section}`;
    const cached = archiveCache.get(key);
    if (cached && Date.now() - cached.at < 60_000) return cached.entries;
    const entries = archiveSitemapEntries(section, liveArchiveSources(staticDir), staticDir);
    archiveCache.set(key, { at: Date.now(), entries });
    entries.catch(() => archiveCache.delete(key));
    return entries;
  }
  const load = sources;
  const entries: SitemapEntry[] = [];
  if (section === 'historical') {
    let afterId = '';
    let scanned = 0;
    while (scanned < 50000) {
      const games = await load.historical(afterId);
      if (!games.length) break;
      for (const game of games) {
        if (game.visibility !== 'public') continue;
        const path = `/historical-xiangqi/game/${encodeURIComponent(game.id)}`;
        const page = await historicalBoardPage(path, 'en', async () => game);
        if (page?.body && bodyMeetsSitemapFloor(path, page.body))
          entries.push({ path, lastmod: game.updatedAt.toISOString().slice(0, 10) });
      }
      const next = games.at(-1)!.id;
      if (next <= afterId) throw new Error('historical sitemap cursor did not advance');
      afterId = next;
      scanned += games.length;
    }
  } else {
    const store = await load.puzzles();
    const dates = await load.puzzleDates();
    for (const puzzle of discoverablePuzzles(store)) {
      const date = dates.get(puzzle.id);
      if (!date) continue;
      const path = `/puzzles/${encodeURIComponent(puzzle.id)}`;
      // A conservative floor: provenance can only add text on the served page.
      const body = await puzzleBoardBody(puzzle, puzzleHeading(puzzle, 'en'), 'en', null);
      if (bodyMeetsSitemapFloor(path, body))
        entries.push({ path, lastmod: date.toISOString().slice(0, 10) });
    }
  }
  return entries;
}
