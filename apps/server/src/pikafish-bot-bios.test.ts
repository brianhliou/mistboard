import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { cp, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { runMigrations } from './migrate.js';
import { testDatabaseUrlFromEnv } from './test-database-url.js';

const TEST_DATABASE_URL = testDatabaseUrlFromEnv();
const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations', import.meta.url));
const BIO_MIGRATION = '194_pikafish_bot_bios.sql';
// Keep the retired wording out of current copy, including this fixture.
const RETIRED_ENGINE_NAME = ['mainline', 'Pikafish'].join(' ');

test('persistence: Pikafish bio migration preserves profiles and removes retired wording from every row', {
  skip: TEST_DATABASE_URL ? false : 'set TEST_DATABASE_URL or DATABASE_URL to enable',
}, async () => {
  const priorDir = await mkdtemp(join(tmpdir(), 'mistboard-pikafish-bios-'));
  const schema = `pikafish_bios_${randomBytes(6).toString('hex')}`;
  const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
  try {
    // Replay the real historical rows, including profiles now unlisted.
    for (const file of await readdir(MIGRATIONS_DIR)) {
      if (file.endsWith('.sql') && file < BIO_MIGRATION) {
        await cp(join(MIGRATIONS_DIR, file), join(priorDir, file));
      }
    }
    await client.connect();
    await client.query(`CREATE SCHEMA ${schema}`);
    try {
      await client.query(`SET search_path TO ${schema}`);
      await runMigrations(client, priorDir);
      const readProfiles = async () =>
        (
          await client.query<{ profile: { id: string; bio: string } }>(
            "SELECT to_jsonb(b) - 'updated_at' AS profile FROM bot_profiles b ORDER BY id",
          )
        ).rows.map(({ profile }) => profile);
      const before = await readProfiles();
      const affected = before.filter(({ bio }) => bio.includes(RETIRED_ENGINE_NAME));
      assert.deepEqual(
        affected.map(({ id }) => id),
        [
          'pikafish',
          'pikafish-xiangqi',
          'pikafish-xiangqi-amateur',
          'pikafish-xiangqi-level-1',
          'pikafish-xiangqi-level-3',
          'pikafish-xiangqi-level-4',
          'pikafish-xiangqi-level-6',
          'pikafish-xiangqi-level-7',
          'pikafish-xiangqi-strongest',
        ],
      );

      await runMigrations(client, MIGRATIONS_DIR);
      const after = await readProfiles();
      assert.deepEqual(
        after.filter(({ bio }) => bio.includes(RETIRED_ENGINE_NAME)),
        [],
      );
      assert.deepEqual(
        after,
        before.map((profile) => ({
          ...profile,
          bio: profile.bio.replaceAll(RETIRED_ENGINE_NAME, 'Pikafish'),
        })),
      );

      const migration = await readFile(join(MIGRATIONS_DIR, BIO_MIGRATION), 'utf8');
      assert.equal((await client.query(migration)).rowCount, 0, 'rerunning changes no rows');
      assert.deepEqual(await readProfiles(), after);
    } finally {
      await client.query('RESET search_path');
      await client.query(`DROP SCHEMA ${schema} CASCADE`);
    }
  } finally {
    await client.end();
    await rm(priorDir, { recursive: true, force: true });
  }
});
