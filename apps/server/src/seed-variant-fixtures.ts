// Seed the local DB with the committed per-variant postgame fixtures
// (fixtures/variant-postgame/<gameSpecId>.jsonl, produced by
// generate-variant-fixtures.ts). Each fixture is replayed through its tenant to
// derive the terminal GameSummary, then persisted as a public eve game so it
// surfaces in the watch feed and the native /<variant>/game/:id postgame page
// (and thus in the dev /postgame-sheet review surface).
//
//   env DATABASE_URL=... tsx src/seed-variant-fixtures.ts [--dir <dir>]
//
// Product profile is the default; --profile lab seeds every committed fixture.
// Product runs also remove retired rows owned by this seeder's corpus id.

import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import pg from 'pg';

import { banqiTenant } from './banqi-tenant.js';
import { darkXiangqiTenant } from './dark-xiangqi-tenant.js';
import { duckXiangqiTenant } from './duck-xiangqi-tenant.js';
import { fortressXiangqiTenant } from './fortress-xiangqi-tenant.js';
import { jieqiTenant } from './jieqi-tenant.js';
import { jungleFlipTenant } from './jungle-flip-tenant.js';
import { jungleTenant } from './jungle-tenant.js';
import { runMigrations } from './migrate.js';
import { appendRoomEvent, close, init, recordGameEnd } from './persistence.js';
import { buildTenantGameSummary } from './variant-tenant/events.js';
import { createTenantRuntimeRoomFromEvents } from './variant-tenant/runtime.js';
import { xiangqiTenant } from './xiangqi-tenant.js';

// biome-ignore lint/suspicious/noExplicitAny: cross-variant harness; tenants carry opaque types.
const TENANTS: any[] = [
  jungleTenant,
  jungleFlipTenant,
  jieqiTenant,
  banqiTenant,
  fortressXiangqiTenant,
  duckXiangqiTenant,
  darkXiangqiTenant,
  xiangqiTenant,
];

// biome-ignore lint/suspicious/noExplicitAny: opaque tenant type, keyed by spec id.
const TENANT_BY_SPEC = new Map<string, any>(TENANTS.map((t) => [t.gameSpecId as string, t]));

function isDuplicateKey(err: unknown): boolean {
  return /duplicate key|unique constraint/i.test((err as Error).message);
}

async function seedFile(dir: string, file: string): Promise<string> {
  const raw = await readFile(join(dir, file), 'utf-8');
  const events = raw
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as { type: string; roomId: string; gameSpecId?: string });
  if (events.length === 0) throw new Error(`empty fixture: ${file}`);

  const first = events[0]!;
  if (first.type !== 'room-created' || !first.gameSpecId) {
    throw new Error(`${file}: first event must be room-created with a gameSpecId`);
  }
  const tenant = TENANT_BY_SPEC.get(first.gameSpecId);
  if (!tenant) throw new Error(`${file}: no tenant for gameSpecId "${first.gameSpecId}"`);
  const roomId = first.roomId;

  const hydration = createTenantRuntimeRoomFromEvents(tenant, events as never[]);
  if (!hydration.ok) throw new Error(`${file}: replay failed (${hydration.error})`);
  const room = hydration.room;
  if (room.projection.state.status.type !== 'finished') {
    throw new Error(`${file}: fixture is not a finished game (skipped)`);
  }

  for (let seq = 0; seq < events.length; seq++) {
    try {
      await appendRoomEvent(roomId, seq, events[seq] as never);
    } catch (err) {
      if (!isDuplicateKey(err)) throw err;
    }
  }

  const base = tenant.persistence.buildGameSummary?.(room) ?? buildTenantGameSummary(tenant, room);
  // Surface these committed samples the same way the dark-chess corpus does: a
  // public engine-vs-engine game visible in the watch feed and postgame review.
  // Stamp fresh start/end at seed time (the fixture's event `at` timestamps are a
  // fixed epoch for deterministic commits; the watch feed only lists recent games,
  // so a stale endedAt would hide them).
  const now = new Date();
  const summary = {
    ...base,
    mode: 'eve' as const,
    visibility: 'public' as const,
    rated: false,
    startedAt: now,
    endedAt: now,
    whiteName: base.whiteName ?? `Random self-play (${tenant.colors[0]})`,
    blackName: base.blackName ?? `Random self-play (${tenant.colors[1]})`,
    corpusId: 'variant-postgame-fixture',
  };
  await recordGameEnd(roomId, summary);

  const status = room.projection.state.status;
  return `${roomId} plies=${summary.plyCount} ${summary.result} / ${status.reason}`;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      dir: { type: 'string', default: 'fixtures/variant-postgame' },
      profile: { type: 'string', default: 'product' },
    },
  });
  if (values.profile !== 'product' && values.profile !== 'lab') {
    throw new Error('--profile must be product or lab');
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
  const dir = resolve(repoRoot, 'apps/server', values.dir);
  const productProfile = JSON.parse(
    await readFile(resolve(repoRoot, 'config/product-profile.json'), 'utf8'),
  ) as { gameSpecIds: string[] };
  const productSpecIds = new Set(productProfile.gameSpecIds);

  const migrationClient = new pg.Client({ connectionString: databaseUrl });
  await migrationClient.connect();
  try {
    await runMigrations(migrationClient);
  } finally {
    await migrationClient.end();
  }
  init(databaseUrl);

  const allFiles = (await readdir(dir)).filter((f) => f.endsWith('.jsonl')).sort();
  const files =
    values.profile === 'lab'
      ? allFiles
      : allFiles.filter((file) => productSpecIds.has(file.replace(/\.jsonl$/, '')));
  if (files.length === 0) {
    console.error(`no .jsonl fixtures in ${dir}`);
    process.exit(1);
  }
  console.log(`seeding ${files.length} ${values.profile} variant fixture(s) from ${values.dir}`);
  let failures = 0;
  for (const file of files) {
    try {
      const result = await seedFile(dir, file);
      console.log(`  ok   ${file.padEnd(28)} ${result}`);
    } catch (err) {
      failures += 1;
      console.error(`  FAIL ${file.padEnd(28)} ${(err as Error).message}`);
    }
  }
  if (failures === 0 && values.profile === 'product') {
    const pruned = await pruneRetiredProductFixtures(databaseUrl, productSpecIds);
    console.log(`  prune retired seed-owned fixtures: ${pruned}`);
  }
  await close();
  if (failures > 0) process.exit(1);
  console.log('\ndone.');
}

async function pruneRetiredProductFixtures(
  databaseUrl: string,
  productSpecIds: ReadonlySet<string>,
): Promise<number> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query('BEGIN');
    const retired = await client.query<{ room_id: string }>(
      `SELECT room_id
         FROM games
        WHERE corpus_id = 'variant-postgame-fixture'
          AND NOT (variant = ANY($1::text[]))`,
      [[...productSpecIds]],
    );
    const roomIds = retired.rows.map((row) => row.room_id);
    if (roomIds.length > 0) {
      await client.query('DELETE FROM games WHERE room_id = ANY($1::text[])', [roomIds]);
      await client.query('DELETE FROM events WHERE room_id = ANY($1::text[])', [roomIds]);
    }
    await client.query('COMMIT');
    return roomIds.length;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

void main();
