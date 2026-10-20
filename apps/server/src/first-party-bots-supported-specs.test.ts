/**
 * Every (first-party bot, variant) pair that `first-party-bots.ts` names an
 * engine for must be allowed by that bot's `bot_profiles.supported_game_spec_ids`
 * row as the migrations leave it (#400).
 *
 * The two halves do different jobs: the code names the ENGINE for a pair, the
 * column decides whether the pair is allowed at all (`routes/rooms.ts` answers
 * 400 `bot_game_spec_conflict` otherwise). Duck Xiangqi launched with only the
 * code half and every duck bot game failed in prod until migration 138. Nothing
 * else catches it: typecheck and the unit suite never read the column, and the
 * persistent suite truncates `bot_profiles` before every test.
 *
 * So this replays every migration into a scratch schema, reads the rows they
 * leave, and drops the schema. Needs Postgres (`npm run test:persistent`).
 */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { cp, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { FIRST_PARTY_BOT_PROFILES, type FirstPartyBotProfile } from './first-party-bots.js';
import { runMigrations } from './migrate.js';
import { testDatabaseUrlFromEnv } from './test-database-url.js';

const TEST_DATABASE_URL = testDatabaseUrlFromEnv();
const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

type BotRow = { id: string; supportedGameSpecIds: readonly string[] };

/** One line per (bot, variant) pair the code plays but the column refuses,
 *  and per bot with no row at all. Empty when the two halves agree. */
function botSpecColumnGaps(
  profiles: readonly FirstPartyBotProfile[],
  rows: readonly BotRow[],
  nextMigration: string,
): string[] {
  const byId = new Map(rows.map((row) => [row.id, new Set(row.supportedGameSpecIds)]));
  const gaps: string[] = [];
  for (const bot of profiles) {
    const supported = byId.get(bot.id);
    if (!supported) {
      gaps.push(
        `${bot.id}: no bot_profiles row. Migration ${nextMigration} owes an INSERT ` +
          '(174_general_blunder_bot.sql is the model).',
      );
      continue;
    }
    for (const spec of Object.keys(bot.engines).sort()) {
      if (supported.has(spec)) continue;
      gaps.push(
        `${bot.id} x ${spec}: first-party-bots.ts names engine ${bot.engines[spec]} but ` +
          `supported_game_spec_ids does not list '${spec}'. Migration ${nextMigration} owes an ` +
          'array_append (155_crazyhouse_xiangqi_bot_support.sql is the model).',
      );
    }
  }
  return gaps;
}

async function nextMigrationNumber(): Promise<string> {
  const prefixes = (await readdir(MIGRATIONS_DIR))
    .map((file) => /^(\d+)_.*\.sql$/.exec(file)?.[1])
    .filter((prefix): prefix is string => prefix !== undefined)
    .map(Number);
  return String(Math.max(...prefixes) + 1).padStart(3, '0');
}

/** The bot_profiles rows a fresh database ends with after `migrationsDir`. */
async function migratedBotRows(migrationsDir: string): Promise<BotRow[]> {
  const schema = `bot_specs_check_${randomBytes(6).toString('hex')}`;
  const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
  await client.connect();
  try {
    await client.query(`CREATE SCHEMA ${schema}`);
    try {
      // Every migration names its tables unqualified, so they all land in the
      // scratch schema and the shared test database is never touched.
      await client.query(`SET search_path TO ${schema}`);
      await runMigrations(client, migrationsDir);
      const { rows } = await client.query<{ id: string; supported_game_spec_ids: string[] }>(
        'SELECT id, supported_game_spec_ids FROM bot_profiles ORDER BY id',
      );
      return rows.map((row) => ({ id: row.id, supportedGameSpecIds: row.supported_game_spec_ids }));
    } finally {
      await client.query('RESET search_path');
      await client.query(`DROP SCHEMA ${schema} CASCADE`);
    }
  } finally {
    await client.end();
  }
}

test('bot spec gaps name the missing pair, a missing row, and the migration that owes it', () => {
  const bot: FirstPartyBotProfile = {
    id: 'ladder-bot',
    displayName: 'Ladder Bot',
    engines: { xiangqi: 'fsf-xiangqi', 'duck-xiangqi': 'fsf-duck' },
    defaultGameSpecId: 'xiangqi',
  };
  const orphan: FirstPartyBotProfile = { ...bot, id: 'orphan-bot' };
  const gaps = botSpecColumnGaps(
    [bot, orphan],
    [{ id: 'ladder-bot', supportedGameSpecIds: ['xiangqi', 'fortress-xiangqi'] }],
    '175',
  );
  assert.equal(gaps.length, 2);
  assert.match(gaps[0] ?? '', /^ladder-bot x duck-xiangqi: .*fsf-duck.*Migration 175 owes/);
  assert.match(gaps[1] ?? '', /^orphan-bot: no bot_profiles row\. Migration 175 owes/);
  assert.deepEqual(
    botSpecColumnGaps(
      [bot],
      [{ id: 'ladder-bot', supportedGameSpecIds: ['duck-xiangqi', 'xiangqi'] }],
      '175',
    ),
    [],
  );
});

test('persistence: every first-party bot engine pair is allowed by its migrated bot_profiles row', {
  skip: TEST_DATABASE_URL ? false : 'set TEST_DATABASE_URL or DATABASE_URL to enable',
}, async () => {
  const rows = await migratedBotRows(MIGRATIONS_DIR);
  assert.ok(
    rows.length >= FIRST_PARTY_BOT_PROFILES.length,
    `expected the bot roster, got ${rows.length} rows`,
  );
  const gaps = botSpecColumnGaps(FIRST_PARTY_BOT_PROFILES, rows, await nextMigrationNumber());
  assert.deepEqual(
    gaps,
    [],
    `bot_profiles disagrees with first-party-bots.ts:\n${gaps.join('\n')}`,
  );
});

test('persistence: the bot spec check catches the duck launch gap with migration 138 removed', {
  skip: TEST_DATABASE_URL ? false : 'set TEST_DATABASE_URL or DATABASE_URL to enable',
}, async () => {
  // The planted failure: the migrations as they stood when duck shipped. Later
  // migrations append other specs to the same rows, so duck stays missing.
  const dir = await mkdtemp(join(tmpdir(), 'mistboard-migrations-without-138-'));
  try {
    await cp(MIGRATIONS_DIR, dir, { recursive: true });
    await rm(join(dir, '138_duck_xiangqi_bot_support.sql'));
    const gaps = botSpecColumnGaps(FIRST_PARTY_BOT_PROFILES, await migratedBotRows(dir), '175');
    const duckGaps = gaps.filter((gap) => / x duck-xiangqi: /.test(gap));
    assert.equal(duckGaps.length, 8, gaps.join('\n'));
    assert.deepEqual(gaps, duckGaps);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
