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
  dataFormatsForVariant,
  EmptyDataFileError,
  type EnsureDeps,
  ensureDataFile,
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
  });
  assert.deepEqual(parseDataFilePath('/api/data/collections/some-match-2026-09.jsonl.gz'), {
    ok: true,
    target: { kind: 'collection', corpusId: 'some-match-2026-09', format: 'jsonl' },
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
    '/api/data/monthly/2026-09/jieqi.pgn.gz',
    '/api/data/monthly/2026-09/all.pgn.gz',
    '/api/data/monthly/2026-09/everything.jsonl.gz',
    '/api/data/monthly/2026-09/xiangqi.zip',
    '/api/data/collections/../etc.jsonl.gz',
  ]) {
    const parsed = parseDataFilePath(path);
    assert.equal(parsed?.ok, false, path);
    assert.equal(parsed && !parsed.ok && parsed.status, 404, path);
  }
  // Hidden-piece variants are withheld until #484, and the 404 says why.
  for (const variant of ['jieqi', 'banqi', 'jungle-flip']) {
    assert.deepEqual(parseDataFilePath(`/api/data/monthly/2026-09/${variant}.jsonl.gz`), {
      ok: false,
      status: 404,
      error: 'hidden_piece_format_pending',
    });
  }
  assert.deepEqual(parseDataFilePath('/api/data/monthly/2026-09/all.jsonl.gz'), {
    ok: true,
    target: { kind: 'monthly', month: '2026-09', variant: 'all', format: 'jsonl' },
  });
  assert.equal(parseDataFilePath('/api/games/x/export.json'), null);
});

test('data variants are the export table minus the withheld list, PGN only where the single export has it', () => {
  assert.ok(DATA_VARIANTS.includes('xiangqi'));
  assert.ok(DATA_VARIANTS.includes('jungle'));
  assert.ok(!DATA_VARIANTS.includes('mahjong'));
  // The all-variants file is built from DATA_VARIANTS, so this keeps the
  // hidden-piece games out of it too (#484).
  assert.deepEqual(Object.keys(DATA_WITHHELD_VARIANTS).sort(), ['banqi', 'jieqi', 'jungle-flip']);
  for (const variant of Object.keys(DATA_WITHHELD_VARIANTS)) {
    assert.ok(!DATA_VARIANTS.includes(variant), variant);
  }
  assert.deepEqual(dataFormatsForVariant('xiangqi'), ['pgn', 'jsonl']);
  assert.deepEqual(dataFormatsForVariant('jieqi'), ['jsonl']);
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
      // Withheld until #484: no row, no rail entry, not in the month's total.
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
      ['2026-09', 14, ['xiangqi', 'jungle']],
      ['2026-08', 2, ['dark-chess']],
    ],
  );
  assert.deepEqual(listing.variants, ['xiangqi', 'dark-chess', 'jungle']);
  const xiangqi = listing.months[0]!.variants[0]!;
  assert.deepEqual(
    xiangqi.files.map((file) => [file.format, file.path, file.fileName, file.built?.bytes ?? null]),
    [
      ['pgn', '/api/data/monthly/2026-09/xiangqi.pgn.gz', 'mistboard_xiangqi_2026-09.pgn.gz', null],
      [
        'jsonl',
        '/api/data/monthly/2026-09/xiangqi.jsonl.gz',
        'mistboard_xiangqi_2026-09.jsonl.gz',
        2048,
      ],
    ],
  );
  assert.deepEqual(
    listing.months.map((month) => month.files.map((file) => [file.path, file.games])),
    [
      [['/api/data/monthly/2026-09/all.jsonl.gz', 14]],
      [['/api/data/monthly/2026-08/all.jsonl.gz', 2]],
    ],
  );
  assert.equal(listing.license, 'CC BY 4.0');
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
    ['/api/data/collections/match.jsonl.gz'],
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
