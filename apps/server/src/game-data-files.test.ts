import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { gunzipSync } from 'node:zlib';
import {
  BUILD_SLICE_MS,
  buildDataFileContent,
  buildDataListing,
  DATA_VARIANTS,
  DATA_WITHHELD_VARIANTS,
  dataFileKey,
  dataFileName,
  dataFormatsForVariant,
  EmptyDataFileError,
  type EnsureDeps,
  ensureDataFile,
  hashedDataFilePath,
  isClosedMonth,
  listableCollections,
  parseDataFilePath,
  parseMonth,
} from './game-data-files.js';
import type { NewDataFile, StoredDataFile } from './persistence-game-data.js';

const NOW = new Date('2026-10-01T09:00:00Z');

test('parseDataFilePath fails closed: malformed month 400, unknown variant or format 404', () => {
  assert.deepEqual(parseDataFilePath('/api/data/monthly/2026-09/xiangqi.pgn.gz'), {
    ok: true,
    target: { kind: 'monthly', month: '2026-09', variant: 'xiangqi', format: 'pgn' },
    hash: null,
  });
  assert.deepEqual(parseDataFilePath('/api/data/collections/some-match-2026-09.jsonl.gz'), {
    ok: true,
    target: { kind: 'collection', corpusId: 'some-match-2026-09', format: 'jsonl' },
    hash: null,
  });
  for (const month of ['2026-13', '2026-9', '26-09', 'latest']) {
    const parsed = parseDataFilePath(`/api/data/monthly/${month}/xiangqi.jsonl.gz`);
    assert.equal(parsed?.ok, false, month);
    assert.equal(parsed && !parsed.ok && parsed.status, 400, month);
  }
  // A variant outside the export table (mahjong, a retired spec, a typo) never
  // falls back to another variant's exporter.
  for (const path of [
    '/api/data/monthly/2026-09/mahjong.jsonl.gz',
    '/api/data/monthly/2026-09/kriegspiel.jsonl.gz',
    '/api/data/monthly/2026-09/jungle.pgn.gz',
    '/api/data/monthly/2026-09/all.pgn.gz',
    '/api/data/monthly/2026-09/everything.jsonl.gz',
    '/api/data/monthly/2026-09/xiangqi.zip',
    '/api/data/collections/../etc.jsonl.gz',
    // A hash is exactly 12 lowercase hex digits.
    '/api/data/monthly/2026-09/xiangqi.abc.jsonl.gz',
    '/api/data/monthly/2026-09/xiangqi.ABCDEF123456.jsonl.gz',
    '/api/data/monthly/2026-09/xiangqi.0123456789abc.jsonl.gz',
  ]) {
    const parsed = parseDataFilePath(path);
    assert.equal(parsed?.ok, false, path);
    assert.equal(parsed && !parsed.ok && parsed.status, 404, path);
  }
  // The hidden-piece variants are offered since #484, in JSONL and PGN.
  for (const variant of ['jieqi', 'banqi', 'jungle-flip']) {
    for (const format of ['jsonl', 'pgn'] as const) {
      assert.deepEqual(parseDataFilePath(`/api/data/monthly/2026-09/${variant}.${format}.gz`), {
        ok: true,
        target: { kind: 'monthly', month: '2026-09', variant, format },
        hash: null,
      });
    }
  }
  assert.deepEqual(parseDataFilePath('/api/data/monthly/2026-09/all.jsonl.gz'), {
    ok: true,
    target: { kind: 'monthly', month: '2026-09', variant: 'all', format: 'jsonl' },
    hash: null,
  });
  // The content-addressed form of the same files.
  assert.deepEqual(parseDataFilePath('/api/data/monthly/2026-09/all.0123456789ab.jsonl.gz'), {
    ok: true,
    target: { kind: 'monthly', month: '2026-09', variant: 'all', format: 'jsonl' },
    hash: '0123456789ab',
  });
  assert.deepEqual(parseDataFilePath('/api/data/collections/a-match.ffffffffffff.pgn.gz'), {
    ok: true,
    target: { kind: 'collection', corpusId: 'a-match', format: 'pgn' },
    hash: 'ffffffffffff',
  });
  assert.equal(parseDataFilePath('/api/games/x/export.json'), null);
});

test('data variants are the export table minus the withheld list, PGN only where the single export has it', () => {
  assert.ok(DATA_VARIANTS.includes('xiangqi'));
  assert.ok(DATA_VARIANTS.includes('jungle'));
  assert.ok(!DATA_VARIANTS.includes('mahjong'));
  // Nothing is withheld since #484: the all-variants file, built from
  // DATA_VARIANTS, holds the hidden-piece games too.
  assert.deepEqual(DATA_WITHHELD_VARIANTS, {});
  for (const variant of ['jieqi', 'banqi', 'jungle-flip']) {
    assert.ok(DATA_VARIANTS.includes(variant), variant);
    assert.deepEqual(dataFormatsForVariant(variant), ['pgn', 'jsonl'], variant);
  }
  assert.deepEqual(dataFormatsForVariant('xiangqi'), ['pgn', 'jsonl']);
  assert.deepEqual(dataFormatsForVariant('mahjong'), []);
});

test('only closed months are offered', () => {
  assert.equal(isClosedMonth(parseMonth('2026-09')!, NOW), true);
  assert.equal(isClosedMonth(parseMonth('2026-10')!, NOW), false);
  assert.equal(isClosedMonth(parseMonth('2026-11')!, NOW), false);
  assert.equal(isClosedMonth(parseMonth('2026-09')!, new Date('2026-09-30T23:59:59Z')), false);
});

test('the listing groups closed months newest first, with built sizes and checksums', () => {
  const listing = buildDataListing({
    counts: [
      { month: '2026-10', variant: 'xiangqi', games: 3 },
      { month: '2026-09', variant: 'jungle', games: 4 },
      { month: '2026-09', variant: 'xiangqi', games: 10 },
      // The hidden-piece variants are listed like any other since #484.
      { month: '2026-09', variant: 'jieqi', games: 7 },
      { month: '2026-09', variant: 'banqi', games: 5 },
      { month: '2026-08', variant: 'jungle-flip', games: 3 },
      { month: '2026-08', variant: 'dark-chess', games: 2 },
      { month: '2026-08', variant: 'mahjong', games: 9 },
    ],
    stored: [
      {
        key: 'monthly/2026-09/xiangqi.jsonl.gz',
        gameCount: 10,
        byteSize: 2048,
        sha256: 'a'.repeat(64),
        builtAt: new Date('2026-10-01T08:00:00Z'),
      },
    ],
    collections: [],
    now: NOW,
  });
  assert.deepEqual(
    listing.months.map((month) => [month.month, month.games, month.variants.map((v) => v.variant)]),
    [
      ['2026-09', 26, ['xiangqi', 'jieqi', 'banqi', 'jungle']],
      ['2026-08', 5, ['dark-chess', 'jungle-flip']],
    ],
  );
  assert.deepEqual(listing.variants, [
    'xiangqi',
    'jieqi',
    'banqi',
    'dark-chess',
    'jungle',
    'jungle-flip',
  ]);
  const xiangqi = listing.months[0]!.variants[0]!;
  assert.deepEqual(
    xiangqi.files.map((file) => [file.format, file.path, file.fileName, file.built?.bytes ?? null]),
    [
      ['pgn', '/api/data/monthly/2026-09/xiangqi.pgn.gz', 'mistboard_xiangqi_2026-09.pgn.gz', null],
      // Built: its content-addressed URL. Not yet built: the plain URL that
      // builds it and redirects there.
      [
        'jsonl',
        '/api/data/monthly/2026-09/xiangqi.aaaaaaaaaaaa.jsonl.gz',
        'mistboard_xiangqi_2026-09.jsonl.gz',
        2048,
      ],
    ],
  );
  assert.deepEqual(
    listing.months.map((month) => month.files.map((file) => [file.path, file.games])),
    [
      [['/api/data/monthly/2026-09/all.jsonl.gz', 26]],
      [['/api/data/monthly/2026-08/all.jsonl.gz', 5]],
    ],
  );
  assert.equal(listing.license, 'CC BY 4.0');
});

test('engine-game files have their own paths, keys and names, and fail closed the same way', () => {
  assert.deepEqual(parseDataFilePath('/api/data/engine-monthly/2026-09/jieqi.jsonl.gz'), {
    ok: true,
    target: { kind: 'engine-monthly', month: '2026-09', variant: 'jieqi', format: 'jsonl' },
    hash: null,
  });
  assert.deepEqual(
    parseDataFilePath('/api/data/engine-monthly/2026-09/all.0123456789ab.jsonl.gz'),
    {
      ok: true,
      target: { kind: 'engine-monthly', month: '2026-09', variant: 'all', format: 'jsonl' },
      hash: '0123456789ab',
    },
  );
  const bad = (path: string) => {
    const parsed = parseDataFilePath(path);
    return parsed && !parsed.ok ? parsed.status : 'ok';
  };
  assert.equal(bad('/api/data/engine-monthly/2026-13/jieqi.jsonl.gz'), 400);
  assert.equal(bad('/api/data/engine-monthly/2026-09/mahjong.jsonl.gz'), 404);
  assert.equal(bad('/api/data/engine-monthly/2026-09/all.pgn.gz'), 404);
  assert.equal(bad('/api/data/engine-monthly/2026-09/duck-xiangqi.pgn.gz'), 404);
  assert.equal(bad('/api/data/engine-monthly/nope'), 404);
  const target = {
    kind: 'engine-monthly',
    month: '2026-09',
    variant: 'jieqi',
    format: 'pgn',
  } as const;
  // Never the human file's key: a human build cannot be served as an engine one.
  assert.equal(dataFileKey(target), 'engine-monthly/2026-09/jieqi.pgn.gz');
  assert.notEqual(dataFileKey(target), dataFileKey({ ...target, kind: 'monthly' }));
  assert.equal(dataFileName(target), 'mistboard_engine_jieqi_2026-09.pgn.gz');
  assert.equal(
    hashedDataFilePath(target, 'b'.repeat(64)),
    '/api/data/engine-monthly/2026-09/jieqi.bbbbbbbbbbbb.pgn.gz',
  );
});

test('engine games are listed in their own months, never folded into the human ones', () => {
  const listing = buildDataListing({
    counts: [{ month: '2026-09', variant: 'xiangqi', games: 10 }],
    engineCounts: [
      { month: '2026-09', variant: 'xiangqi', games: 60 },
      { month: '2026-09', variant: 'duck-xiangqi', games: 30 },
      { month: '2026-10', variant: 'jieqi', games: 2 },
    ],
    stored: [],
    collections: [],
    now: NOW,
  });
  // The human month is untouched by the engine games.
  assert.deepEqual(
    listing.months.map((month) => [month.month, month.games, month.variants.map((v) => v.variant)]),
    [['2026-09', 10, ['xiangqi']]],
  );
  assert.deepEqual(
    listing.months[0]?.files.map((file) => file.path),
    ['/api/data/monthly/2026-09/all.jsonl.gz'],
  );
  // Closed months only, like the human files.
  assert.deepEqual(
    listing.engineMonths.map((month) => [
      month.month,
      month.games,
      month.variants.map((v) => [v.variant, v.games]),
    ]),
    [
      [
        '2026-09',
        90,
        [
          ['xiangqi', 60],
          ['duck-xiangqi', 30],
        ],
      ],
    ],
  );
  assert.deepEqual(
    listing.engineMonths[0]?.files.map((file) => [file.path, file.fileName]),
    [['/api/data/engine-monthly/2026-09/all.jsonl.gz', 'mistboard_engine_all_2026-09.jsonl.gz']],
  );
  assert.deepEqual(
    listing.engineMonths[0]?.variants[0]?.files.map((file) => file.path),
    [
      '/api/data/engine-monthly/2026-09/xiangqi.pgn.gz',
      '/api/data/engine-monthly/2026-09/xiangqi.jsonl.gz',
    ],
  );
  // A variant with engine games only still gets a rail entry.
  assert.deepEqual(listing.variants, ['xiangqi', 'duck-xiangqi']);
});

test('a collection needs one exportable variant and an import origin', () => {
  const base = {
    games: 400,
    firstStartedAt: new Date('2026-09-29T00:00:00Z'),
    lastEndedAt: new Date('2026-09-30T00:00:00Z'),
  };
  const origin = {
    kind: 'imported',
    event: 'AB-JChess vs PikaJieQi · 4 s · 2026-09',
    credit: {
      work: 'AB-JChess',
      authors: ['Huorongrong', 'Laoxu (Kouza)'],
      url: 'https://github.com/lxsgx23/AB-JChess',
      permission: true,
    },
  };
  const listed = listableCollections([
    { ...base, corpusId: 'match', variants: ['jieqi'], origin },
    { ...base, corpusId: 'no-origin', variants: ['jieqi'], origin: null },
    { ...base, corpusId: 'mixed', variants: ['jieqi', 'xiangqi'], origin },
    { ...base, corpusId: 'unexportable', variants: ['mahjong'], origin },
  ]);
  assert.deepEqual(
    listed.map((row) => row.corpusId),
    ['match'],
  );
  const listing = buildDataListing({ counts: [], stored: [], collections: listed, now: NOW });
  assert.equal(listing.collections[0]?.event, origin.event);
  assert.deepEqual(listing.collections[0]?.credit, origin.credit);
  assert.deepEqual(
    listing.collections[0]?.files.map((file) => file.path),
    // A jieqi engine match gets a PGN too since #484.
    ['/api/data/collections/match.pgn.gz', '/api/data/collections/match.jsonl.gz'],
  );
});

function memoryDeps(): EnsureDeps & {
  builds: number;
  inserts: number;
  rows: Map<string, StoredDataFile>;
} {
  const rows = new Map<string, StoredDataFile>();
  const deps = {
    builds: 0,
    inserts: 0,
    rows,
    async getGameSummaries() {
      deps.builds += 1;
      return new Map();
    },
    async loadRoomsEvents() {
      return new Map();
    },
    async getStoredDataFile(key: string) {
      return rows.get(key) ?? null;
    },
    async insertDataFileIfAbsent(file: NewDataFile) {
      deps.inserts += 1;
      if (rows.has(file.key)) return false;
      rows.set(file.key, { ...file, builtAt: new Date() });
      return true;
    },
  };
  return deps;
}

test('a build with no exportable game stores nothing', async () => {
  const deps = memoryDeps();
  const target = {
    kind: 'monthly',
    month: '2026-09',
    variant: 'xiangqi',
    format: 'jsonl',
  } as const;
  await assert.rejects(
    ensureDataFile(target, async () => ['missing-room'], deps),
    EmptyDataFileError,
  );
  assert.equal(deps.rows.size, 0);
});

test('a file another instance stored is served as stored, never rebuilt', async () => {
  const deps = memoryDeps();
  const target = {
    kind: 'monthly',
    month: '2026-08',
    variant: 'xiangqi',
    format: 'jsonl',
  } as const;
  const content = Buffer.from('stored');
  // Both callers serve the stored row; nobody builds or inserts.
  deps.rows.set(dataFileKey(target), {
    key: dataFileKey(target),
    gameCount: 1,
    byteSize: content.byteLength,
    sha256: 'b'.repeat(64),
    builtAt: new Date(),
    content,
  });
  const [a, b] = await Promise.all([
    ensureDataFile(target, async () => ['r'], deps),
    ensureDataFile(target, async () => ['r'], deps),
  ]);
  assert.equal(a, b);
  assert.equal(deps.builds, 0);
  assert.equal(deps.inserts, 0);
});

// The build runs in the live web process. A month's replay held the event loop
// for seconds on prod (2026-10-01), stalling live games, because nothing in the
// per-game loop awaited. A fake clock that charges half a slice per read makes
// the yields deterministic: 60 games in one batch (no database await between
// them) must span about 30 event-loop turns, which a self-rescheduling
// immediate counts. Without the per-slice yield the build spans a handful.
test('a data file build hands the event loop back between games', async () => {
  let clock = 0;
  const deps = {
    getGameSummaries: async () => new Map(),
    loadRoomsEvents: async () => new Map(),
    now: () => {
      clock += BUILD_SLICE_MS / 2;
      return clock;
    },
  };
  let turns = 0;
  let building = true;
  const tick = () => {
    turns += 1;
    if (building) setImmediate(tick);
  };
  setImmediate(tick);
  const roomIds = Array.from({ length: 60 }, (_, i) => `room-${i}`);
  const built = await buildDataFileContent(roomIds, 'jsonl', deps);
  building = false;
  assert.equal(built.skipped.length, 60);
  assert.ok(turns >= 25, `the build spanned ${turns} event-loop turns, expected about 30`);
});

test('a data file build gzips every line and checksums the gzip bytes', async () => {
  const built = await buildDataFileContent([], 'jsonl', {
    getGameSummaries: async () => new Map(),
    loadRoomsEvents: async () => new Map(),
  });
  assert.equal(built.gameCount, 0);
  assert.equal(gunzipSync(built.content).toString('utf8'), '');
  assert.equal(built.byteSize, built.content.byteLength);
  assert.equal(built.sha256, createHash('sha256').update(built.content).digest('hex'));
});
