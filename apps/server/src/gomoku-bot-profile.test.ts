import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { gameSpecForId } from '@mistboard/game';
import pg from 'pg';
import './gomoku-registration.js';
import {
  firstPartyBotEngineFor,
  firstPartyBotForEngine,
  liveSeatProfileIdentity,
} from './first-party-bots.js';
import { gomokuTenant } from './gomoku-tenant.js';
import { botPlayOptions } from './routes/bots.js';
import { postgamePlayers } from './routes/lib.js';
import { testDatabaseUrlFromEnv } from './test-database-url.js';
import { tenantParticipant } from './variant-tenant/events.js';
import {
  createTenantRuntimeRoom,
  tenantSeatDisplayNames,
  tenantSeatProfiles,
} from './variant-tenant/runtime.js';

test('all eight Rapfi levels carry the same linkable bot identity live and in finished games', () => {
  for (let level = 1; level <= 8; level += 1) {
    const id = `rapfi-level-${level}`;
    const bot = firstPartyBotForEngine(id);
    assert.ok(bot, `${id} needs a public bot profile`);
    assert.equal(bot.id, id);
    assert.equal(firstPartyBotEngineFor(id, 'gomoku'), id);
    assert.equal(bot.displayName, `Rapfi Level ${level}`);
    for (const color of gomokuTenant.colors) {
      for (const pveBotId of [null, id]) {
        const created = createTenantRuntimeRoom(gomokuTenant, 'gmk_bot_profile', { now: 1000 });
        assert.ok(created.ok);
        const room = created.room;
        room.projection.seats[color] = id;
        room.pveBotId = pveBotId;
        assert.deepEqual(tenantSeatProfiles(gomokuTenant, room)[color], { botId: id });
        assert.equal(tenantSeatDisplayNames(gomokuTenant, room)[color], bot.displayName);
        // Finished reviews and game lists link this persisted subject id.
        const participant = tenantParticipant(gomokuTenant, color, room, 'public');
        assert.equal(participant.subjectType, 'bot');
        assert.equal(participant.subjectId, id);
        assert.equal(participant.engineId, id);
        assert.equal(participant.displayName, bot.displayName);
        assert.equal(postgamePlayers([participant])[0]?.botId, id);
        assert.deepEqual(liveSeatProfileIdentity(id, null, pveBotId), { botId: id });
      }
    }
  }
});

test('Rapfi bot pages are playable only while Gomoku is public and enabled', (t) => {
  const previousFlag = process.env.MISTBOARD_GOMOKU_ENABLED;
  const spec = gameSpecForId('gomoku');
  const previousSurface = spec.publicSurface;
  t.after(() => {
    if (previousFlag === undefined) delete process.env.MISTBOARD_GOMOKU_ENABLED;
    else process.env.MISTBOARD_GOMOKU_ENABLED = previousFlag;
    spec.publicSurface = previousSurface;
  });
  for (let level = 1; level <= 8; level += 1) {
    const id = `rapfi-level-${level}`;
    const bot = {
      id,
      activeEngineId: id,
      defaultGameSpecId: 'gomoku',
      supportedGameSpecIds: ['gomoku'],
    };
    process.env.MISTBOARD_GOMOKU_ENABLED = 'true';
    spec.publicSurface = 'casual';
    assert.deepEqual(botPlayOptions(bot), [{ gameSpecId: 'gomoku', engineId: id, playable: true }]);
    process.env.MISTBOARD_GOMOKU_ENABLED = 'false';
    assert.equal(
      botPlayOptions(bot).some((option) => option.playable),
      false,
    );
    process.env.MISTBOARD_GOMOKU_ENABLED = 'true';
    spec.publicSurface = 'hidden';
    assert.deepEqual(botPlayOptions(bot), []);
  }
});

const databaseUrl = testDatabaseUrlFromEnv();
test('persistence: Rapfi migration seeds unmeasured profiles and links historical PvE seats only', {
  skip: databaseUrl ? false : 'set TEST_DATABASE_URL to enable',
}, async () => {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query(`
      CREATE TEMP TABLE bot_profiles (
        id text PRIMARY KEY, display_name text, bio text, active_engine_id text,
        default_game_spec_id text, supported_game_spec_ids text[], play_initial_ms integer,
        play_increment_ms integer, visibility text, updated_at timestamptz DEFAULT now()
      ) ON COMMIT DROP;
      CREATE TEMP TABLE bot_rating_snapshots (bot_id text, rating integer) ON COMMIT DROP;
      CREATE TEMP TABLE games (room_id text, variant text, mode text) ON COMMIT DROP;
      CREATE TEMP TABLE game_participants (
        game_id text, subject_type text, subject_id text, engine_id text
      ) ON COMMIT DROP;
      INSERT INTO games VALUES
        ('pve', 'gomoku', 'pve'), ('eve', 'gomoku', 'eve'), ('other', 'xiangqi', 'pve');
      INSERT INTO game_participants VALUES
        ('pve', 'engine-version', 'rapfi-level-1', NULL),
        ('pve', 'engine-version', 'rapfi-level-8', NULL),
        ('pve', 'user', 'rapfi-level-1', NULL),
        ('eve', 'engine-version', 'rapfi-level-8', NULL),
        ('other', 'engine-version', 'rapfi-level-8', NULL);
    `);
    const migration = await readFile(
      new URL('../migrations/191_rapfi_bot_profiles.sql', import.meta.url),
      'utf8',
    );
    await client.query(migration);
    await client.query(migration);
    const { rows: profiles } = await client.query('SELECT * FROM bot_profiles ORDER BY id');
    assert.equal(profiles.length, 8);
    for (const [index, profile] of profiles.entries()) {
      assert.equal(profile.id, `rapfi-level-${index + 1}`);
      assert.equal(profile.active_engine_id, profile.id);
      assert.equal(profile.default_game_spec_id, 'gomoku');
      assert.deepEqual(profile.supported_game_spec_ids, ['gomoku']);
      assert.equal(profile.visibility, 'public');
    }
    assert.deepEqual((await client.query('SELECT * FROM bot_rating_snapshots')).rows, []);
    const { rows: seats } = await client.query(
      "SELECT * FROM game_participants WHERE subject_type = 'bot' ORDER BY subject_id",
    );
    assert.deepEqual(
      seats.map((seat) => [seat.game_id, seat.subject_id, seat.engine_id]),
      [
        ['pve', 'rapfi-level-1', 'rapfi-level-1'],
        ['pve', 'rapfi-level-8', 'rapfi-level-8'],
      ],
    );
    assert.equal(
      (await client.query("SELECT * FROM game_participants WHERE subject_type = 'engine-version'"))
        .rows.length,
      2,
    );
    assert.equal(
      (await client.query("SELECT * FROM game_participants WHERE subject_type = 'user'")).rows
        .length,
      1,
    );
  } finally {
    await client.query('ROLLBACK');
    await client.end();
  }
});
