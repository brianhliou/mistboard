// Batch archive catalog + reviewed fixture-pack preparation. No DB writes.
// npm run broadcast:archive -- catalog --years 2026,2025,2019 --out /tmp/catalog
// npm run broadcast:archive -- prepare --manifest /private/batch.json --out /tmp/packs
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import {
  validateXiangqiBroadcastBoard,
  validateXiangqiBroadcastTour,
  type XiangqiBroadcastTour,
} from '@mistboard/game';
import {
  type ArchiveCatalogEntry,
  type ArchiveSourceException,
  archiveSourceUrl,
  assignArchiveRounds,
  elephantChessArchiveBoard,
  iqipuArchiveBoard,
  parseElephantChessCatalog,
  parseElephantChessEvent,
  parseElephantChessMoves,
  parseIqipuCatalog,
  parseIqipuGame,
  parseIqipuGameLinks,
} from './xiangqi-broadcast-archive.js';
import {
  translatedXiangqiBroadcastBoard,
  translateXiangqiEventName,
} from './xiangqi-broadcast-translate.js';

type EventSpec = {
  tour: XiangqiBroadcastTour;
  roundSourceUrl: string;
  iqipuEventUrl?: string;
  expectedGames: number;
  expectedRounds: number;
  sourceExceptions?: ArchiveSourceException[];
  /** Source-stated section; omit for individual events. Teams come from records. */
  teamSection?: string;
};

export function createArchiveFetcher(cacheDir: string, spacingMs = 1000) {
  let lastFetch = 0;
  return async (raw: string): Promise<string> => {
    const url = archiveSourceUrl(raw).href;
    const cache = join(cacheDir, `${createHash('sha256').update(url).digest('hex')}.json`);
    try {
      const cached = JSON.parse(await readFile(cache, 'utf8')) as { url?: string; body?: unknown };
      if (cached.url !== url || typeof cached.body !== 'string')
        throw new Error('Invalid source cache');
      const retrievedAt = (cached as { retrievedAt?: string }).retrievedAt;
      const age = Date.now() - Date.parse(retrievedAt ?? '');
      const immutableRecord = /\/game\/games\/|\/game-moves\?/.test(url);
      const maxAgeMs = (immutableRecord ? 7 * 24 : 6) * 60 * 60_000;
      if (Number.isFinite(age) && age >= 0 && age < maxAgeMs) return cached.body;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    let body: string | undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
      const pause = spacingMs - (Date.now() - lastFetch);
      if (pause > 0) await new Promise((r) => setTimeout(r, pause));
      lastFetch = Date.now();
      try {
        const response = await fetch(url, {
          signal: AbortSignal.timeout(20000),
          redirect: 'error',
          headers: { 'User-Agent': 'MistboardArchive/1.0 (+https://mistboard.com)' },
        });
        if (!response.ok) throw new Error(`Archive fetch ${response.status}: ${url}`);
        body = await response.text();
        break;
      } catch (error) {
        if (attempt) throw error;
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
    if (body === undefined) throw new Error('Archive fetch failed');
    await mkdir(cacheDir, { recursive: true });
    await writeFile(
      cache,
      `${JSON.stringify({ url, retrievedAt: new Date().toISOString(), body })}\n`,
    );
    return body;
  };
}

export async function prepareArchiveEvent(spec: EventSpec, get: (url: string) => Promise<string>) {
  const valid = validateXiangqiBroadcastTour(spec.tour);
  if (!valid.ok) throw new Error(valid.errors.join('; '));
  if (
    !Number.isSafeInteger(spec.expectedGames) ||
    spec.expectedGames < 1 ||
    !Number.isSafeInteger(spec.expectedRounds) ||
    spec.expectedRounds < 1
  )
    throw new Error('Explicit positive expectedGames and expectedRounds are required');
  const roundUrl = archiveSourceUrl(spec.roundSourceUrl);
  if (roundUrl.hostname !== 'elephantchess.io' || roundUrl.pathname !== '/database/event')
    throw new Error('Unsupported round source');
  const event = parseElephantChessEvent(await get(roundUrl.href));
  if (
    event.pairings.length !== spec.expectedGames ||
    new Set(event.pairings.map((p) => p.round)).size !== spec.expectedRounds
  )
    throw new Error('Listed game/round count differs from reviewed expectation');
  const pairings = [];
  for (const pairing of event.pairings) {
    const movesUrl = `https://elephantchess.io/api/game-data/game-moves?gameType=DB&gameId=${pairing.id}`;
    pairings.push({ ...pairing, moves: parseElephantChessMoves(await get(movesUrl)) });
  }
  const games = [];
  if (spec.iqipuEventUrl) {
    const url = archiveSourceUrl(spec.iqipuEventUrl);
    if (url.hostname !== 'www.iqipu.com' || !/^\/events\/\d+$/.test(url.pathname))
      throw new Error('Unsupported iqipu event');
    const links = parseIqipuGameLinks(await get(url.href));
    if (links.length !== spec.expectedGames)
      throw new Error(
        'iqipu page does not list every expected game; review its pagination before proceeding',
      );
    const sourceEvents = new Set<string>();
    for (const link of links) {
      const game = parseIqipuGame(await get(link), link);
      sourceEvents.add(game.event);
      games.push(iqipuArchiveBoard(game, spec.tour));
    }
    if (sourceEvents.size !== 1) throw new Error('Mixed events in iqipu records');
  } else {
    for (const pairing of pairings)
      games.push(elephantChessArchiveBoard(pairing, pairing.moves, spec.tour));
  }
  const pack = assignArchiveRounds({
    tour: spec.tour,
    games,
    pairings,
    exceptions: spec.sourceExceptions,
  });
  pack.rounds = pack.rounds.map((r) => ({ ...r, sourceUrl: spec.roundSourceUrl }));
  pack.boards = pack.boards.map((board) =>
    translatedXiangqiBroadcastBoard({
      ...board,
      ...(spec.teamSection ? { details: { ...board.details, match: spec.teamSection } } : {}),
    }),
  );
  for (const board of pack.boards) {
    const checked = validateXiangqiBroadcastBoard(board);
    if (!checked.ok) throw new Error(checked.errors.join('; '));
  }
  return {
    pack,
    audit: {
      sourceEvent: event.name,
      sourceUrls: [spec.roundSourceUrl, spec.iqipuEventUrl].filter(Boolean),
      games: pack.boards.length,
      rounds: pack.rounds.length,
      plies: pack.boards.reduce((n, b) => n + b.moves.length, 0),
      sourceExceptions: spec.sourceExceptions ?? [],
      imported: false,
      note: 'Source credits retained. Source upload dates and unstated round start times are omitted.',
    },
  };
}

function normalized(value: string) {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\p{P}\p{Z}\p{S}]/gu, '');
}

export function compareArchiveCatalog(
  entries: ArchiveCatalogEntry[],
  index: {
    tours: Array<{
      tour: { slug: string; name: string; nameEn?: string };
      recordedBoardCount: number;
    }>;
  },
) {
  const names = new Map<string, typeof index.tours>();
  for (const entry of index.tours)
    for (const name of [entry.tour.name, entry.tour.nameEn].filter((v): v is string => !!v)) {
      const key = normalized(name);
      const found = names.get(key) ?? [];
      if (!found.includes(entry)) found.push(entry);
      names.set(key, found);
    }
  return entries.map((entry) => {
    const keys = [
      normalized(entry.name),
      normalized(translateXiangqiEventName(entry.name) ?? entry.name),
    ];
    const matches = [...new Set(keys.flatMap((key) => names.get(key) ?? []))];
    const match = matches.length === 1 ? matches[0] : undefined;
    return {
      ...entry,
      match: match?.tour.slug ?? null,
      recordedGames: match?.recordedBoardCount ?? null,
      status: !match
        ? 'unmatched-review'
        : entry.games > match.recordedBoardCount
          ? 'possible-gap-review'
          : 'matched',
      // A source's count can combine sections, omit games or duplicate uploads.
      // It is a review signal, never an instruction to create/import a tour.
      note:
        matches.length > 1
          ? 'Ambiguous existing event name'
          : 'Count/name comparison only; review sections and game identities before import',
    };
  });
}

async function main() {
  const command = process.argv[2];
  const { values } = parseArgs({
    args: process.argv.slice(3),
    options: {
      out: { type: 'string' },
      cache: { type: 'string' },
      manifest: { type: 'string' },
      years: { type: 'string', default: '2026,2025' },
      pages: { type: 'string', default: '4' },
      'existing-index': { type: 'string' },
      'skip-existing': { type: 'boolean', default: false },
    },
  });
  if (!values.out || !['prepare', 'catalog'].includes(command ?? ''))
    throw new Error(
      'Usage: broadcast:archive <prepare --manifest FILE | catalog --years 2026,2025 --existing-index FILE> --out DIR [--cache DIR]',
    );
  const out = resolve(values.out);
  const get = createArchiveFetcher(resolve(values.cache ?? join(out, 'source-cache')));
  await mkdir(out, { recursive: true });
  if (command === 'prepare') {
    if (!values.manifest) throw new Error('--manifest is required');
    const manifest = JSON.parse(await readFile(resolve(values.manifest), 'utf8')) as {
      events?: EventSpec[];
    };
    if (!Array.isArray(manifest.events) || !manifest.events.length)
      throw new Error('Manifest needs events[]');
    const slugs = manifest.events.map((e) => e.tour?.slug);
    if (new Set(slugs).size !== slugs.length) throw new Error('Duplicate tour slugs in batch');
    const index = values['existing-index']
      ? (JSON.parse(await readFile(resolve(values['existing-index']), 'utf8')) as {
          tours: Array<{ tour: { slug: string } }>;
        })
      : null;
    const results = [];
    for (const spec of manifest.events) {
      const slug = spec.tour?.slug;
      try {
        if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug ?? '')) throw new Error('Unsafe tour slug');
        if (index?.tours.some((e) => e.tour.slug === slug)) {
          if (!values['skip-existing'])
            throw new Error(
              'Tour already exists; review reconciliation instead of creating a duplicate',
            );
          results.push({ slug, status: 'already-tracked' });
          console.log(`already tracked ${slug}; no write`);
          continue;
        }
        const { pack, audit } = await prepareArchiveEvent(spec, get);
        const dir = join(out, slug);
        await mkdir(dir, { recursive: true });
        for (const [name, value] of Object.entries({ ...pack, audit }))
          await writeFile(join(dir, `${name}.json`), `${JSON.stringify(value, null, 2)}\n`);
        results.push({ slug, status: 'prepared', ...audit });
        console.log(
          `prepared ${slug}: ${audit.games} games / ${audit.rounds} rounds; no database write`,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        results.push({ slug, status: 'needs-review', error: message });
        console.error(`needs review ${slug}: ${message}`);
      }
    }
    await writeFile(join(out, 'batch-report.json'), `${JSON.stringify(results, null, 2)}\n`);
    if (results.some((r) => r.status === 'needs-review')) process.exitCode = 1;
  } else {
    const years = values.years!.split(',');
    const pages = Number(values.pages);
    if (
      years.some((y) => !/^\d{4}$/.test(y)) ||
      !Number.isInteger(pages) ||
      pages < 1 ||
      pages > 10
    )
      throw new Error('Use YYYY years and 1..10 pages per year');
    const catalog = new Map<string, ArchiveCatalogEntry>();
    for (const year of years) {
      for (let page = 1; page <= pages; page++) {
        const url = `https://www.iqipu.com/events/year/${year}${page === 1 ? '' : `/page/${page}`}`;
        const html = await get(url);
        const entries = parseIqipuCatalog(html);
        if (!entries.length) throw new Error(`No archive rows parsed: ${url}`);
        for (const entry of entries) catalog.set(entry.url, entry);
        if (!html.includes(`/events/year/${year}/page/${page + 1}`)) break;
      }
    }
    for (const entry of parseElephantChessCatalog(
      await get('https://elephantchess.io/database/events'),
    ))
      catalog.set(entry.url, entry);
    const existing = values['existing-index']
      ? JSON.parse(await readFile(resolve(values['existing-index']), 'utf8'))
      : { tours: [] };
    const rows = compareArchiveCatalog([...catalog.values()], existing);
    await writeFile(
      join(out, 'catalog.json'),
      `${JSON.stringify(
        { scannedAt: new Date().toISOString(), years, maxPagesPerYear: pages, rows },
        null,
        2,
      )}\n`,
    );
    const md = [
      '# Archive coverage review',
      '',
      'Name/count signals only. Unmatched does not mean absent: translations, sections and duplicate uploads need reconciliation. No import or publication.',
      '',
      '| Event | Source games | Existing event | Status |',
      '|---|---:|---|---|',
      ...rows.map(
        (r) =>
          `| [${r.name.replaceAll('|', '/')}](<${r.url}>) | ${r.games} | ${r.match ?? 'Review match'} | ${r.status} |`,
      ),
      '',
    ];
    await writeFile(join(out, 'catalog.md'), md.join('\n'));
    const priority = rows.filter(
      (r) =>
        r.status !== 'matched' &&
        /北美|美国|奇天|加拿大|温哥华|North America|USA|Canada|Vancouver|World|世界/i.test(r.name),
    );
    const summary = [
      '# Broadcast archive audit',
      '',
      `${rows.length} source entries; ${rows.filter((r) => r.status === 'possible-gap-review').length} exact-name count discrepancies. Source entries overlap; unmatched names are not a count of missing tournaments.`,
      '',
      '## Club and international candidates',
      '',
      ...md.slice(4, 6),
      ...priority
        .slice(0, 20)
        .map(
          (r) =>
            `| [${r.name.replaceAll('|', '/')}](<${r.url}>) | ${r.games} | ${r.match ?? 'Review match'} | ${r.status} |`,
        ),
      '',
      'Full inventory is in catalog.json/catalog.md. Preparation is limited to the reviewed manifest; publication is separate.',
      '',
    ];
    await writeFile(join(out, 'catalog-summary.md'), summary.join('\n'));
    console.log(
      `cataloged ${rows.length} source entries; prepared no broadcasts and wrote no database rows`,
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  await main();
