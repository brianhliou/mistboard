// A bot may play an admin-playtest spec (publicSurface 'hidden') for an admin,
// but a visitor's bot profile must not name it, count it per variant, list its
// games, or offer it as a play option. A retired spec (Fortress Xiangqi,
// 2026-10-11) is hidden the same way.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import test from 'node:test';
import { gameSpecForId } from '@mistboard/game';
import { ffqBanqiRooms } from '../ffq-banqi-registration.js';
import { firstPartyBotForEngine } from '../first-party-bots.js';
import { close, getPool, init } from '../persistence-db.js';
import { clearTenantRuntimeTimers } from '../variant-tenant/ws.js';
import type { HttpApiContext } from './lib.js';
import { tryHandle as roomsRoute } from './rooms.js';
import '../variant-tenant/register-tenants.js';
import type { BotProfilePage } from '../persistence-bots.js';
import { botPlayOptions, withoutHiddenSpecs } from './bots.js';

function game(variant: string) {
  return { roomId: `${variant}-1`, variant } as BotProfilePage['games'][number];
}

const bot = {
  id: 'fairy-stockfish-level-1',
  defaultGameSpecId: 'xiangqi',
  activeEngineId: 'fairy-stockfish-xiangqi-level-1',
  supportedGameSpecIds: ['xiangqi', 'duck-xiangqi', 'fortress-xiangqi', 'mahjong'],
  games: [game('xiangqi'), game('mahjong')],
  recordsByGameSpecId: {
    xiangqi: { games: 1, wins: 0, losses: 1, draws: 0 },
    mahjong: { games: 1, wins: 1, losses: 0, draws: 0 },
  },
  gamesByGameSpecId: {
    xiangqi: [game('xiangqi')],
    mahjong: [game('mahjong')],
  },
} as unknown as BotProfilePage;

test('a hidden spec leaves every public bot field', () => {
  const visible = withoutHiddenSpecs(bot);
  assert.deepEqual(visible.supportedGameSpecIds, ['xiangqi', 'duck-xiangqi']);
  assert.deepEqual(
    visible.games.map((g) => g.variant),
    ['xiangqi'],
  );
  assert.deepEqual(Object.keys(visible.recordsByGameSpecId), ['xiangqi']);
  assert.deepEqual(Object.keys(visible.gamesByGameSpecId), ['xiangqi']);
  assert.ok(botPlayOptions(visible).every((option) => option.gameSpecId !== 'mahjong'));
  assert.ok(botPlayOptions(visible).every((option) => option.gameSpecId !== 'fortress-xiangqi'));
  // The source row is untouched: the play path still reads the full list.
  assert.ok(bot.supportedGameSpecIds.includes('mahjong'));
});

// A box without Misty's Flip Jungle engine (every dev box without the private
// build) must still list the variant, unplayable, so /bots shows Flip Jungle the
// way it shows AB-JChess and KataGo there; the play path still refuses it.
test('a missing Flip Jungle engine lists the variant as unplayable, not missing', () => {
  const saved = process.env.MISTBOARD_JUNGLE_FLIP_ENGINE_PATH;
  process.env.MISTBOARD_JUNGLE_FLIP_ENGINE_PATH = '/nonexistent/jungle-flip-engine';
  try {
    const misty = {
      id: 'misty',
      defaultGameSpecId: 'dark-chess',
      activeEngineId: 'misty',
      supportedGameSpecIds: ['dark-chess', 'jungle-flip'],
    };
    const flip = botPlayOptions(misty).find((option) => option.gameSpecId === 'jungle-flip');
    assert.ok(flip, 'jungle-flip must stay listed');
    assert.equal(flip.playable, false);
  } finally {
    if (saved === undefined) delete process.env.MISTBOARD_JUNGLE_FLIP_ENGINE_PATH;
    else process.env.MISTBOARD_JUNGLE_FLIP_ENGINE_PATH = saved;
  }
});

test('FFQ bot cards follow launch, native availability and the kill switch; Misty seats casual tiers', async (t) => {
  const spec = gameSpecForId('ffq-banqi');
  const surface = spec.publicSurface;
  const keys = ['MISTBOARD_FFQ_BANQI_ENABLED', 'MISTBOARD_FFQ_BANQI_ENGINE_PATH'] as const;
  const saved = keys.map((key) => process.env[key]);
  process.env[keys[0]] = 'true';
  process.env[keys[1]] = '/nonexistent/ffq-banqi-engine';
  init('postgres://mistboard@127.0.0.1:9/never-connect');
  t.after(async () => {
    for (const room of ffqBanqiRooms.values()) clearTenantRuntimeTimers(room);
    ffqBanqiRooms.clear();
    await close();
    spec.publicSurface = surface;
    keys.forEach((key, index) => {
      if (saved[index] === undefined) delete process.env[key];
      else process.env[key] = saved[index];
    });
  });
  t.mock.method(getPool(), 'connect', () => assert.fail('unexpected database connection'));
  t.mock.method(getPool(), 'query', async (sql: string) => {
    if (sql.includes('FROM bot_profiles'))
      return {
        rows: [
          {
            id: 'misty',
            active_engine_id: 'python-v2-v1.6',
            default_game_spec_id: 'dark-chess',
            supported_game_spec_ids: ['dark-chess', 'ffq-banqi'],
            play_initial_ms: 180_000,
            play_increment_ms: 2_000,
            visibility: 'public',
          },
        ],
      };
    if (sql.includes('INSERT INTO events')) return { rows: [] };
    assert.fail(`unexpected bot query: ${sql}`);
  });
  const misty = {
    ...bot,
    id: 'misty',
    supportedGameSpecIds: ['dark-chess', 'ffq-banqi'],
    defaultGameSpecId: 'dark-chess',
    activeEngineId: 'python-v2-v1.6',
  };
  spec.publicSurface = 'hidden';
  assert.doesNotMatch(JSON.stringify(botPlayOptions(misty)), /ffq/);
  assert.ok(!withoutHiddenSpecs(misty).supportedGameSpecIds.includes('ffq-banqi'));
  spec.publicSurface = 'casual';
  const ffq = () => botPlayOptions(misty).find((option) => option.gameSpecId === 'ffq-banqi');
  assert.equal(ffq()?.engineId, 'misty-ffq-banqi-level-4');
  assert.equal(ffq()?.version, '0.1.0');
  assert.equal(ffq()?.playable, false, 'a missing binary must not advertise playability');
  process.env[keys[1]] = process.execPath;
  assert.equal(ffq()?.playable, true);
  process.env[keys[0]] = 'false';
  assert.equal(ffq()?.playable, false);
  process.env[keys[0]] = 'true';
  assert.equal(firstPartyBotForEngine('misty-ffq-banqi-level-1')?.id, 'misty');
  const migration = await readFile(
    new URL('../../migrations/203_ffq_banqi_misty_support.sql', import.meta.url),
    'utf8',
  );
  assert.match(migration, /array_append\(supported_game_spec_ids, 'ffq-banqi'\)/);
  async function post(extra: Record<string, unknown> = {}) {
    const request = Readable.from([
      JSON.stringify({
        botId: 'misty',
        gameSpecId: 'ffq-banqi',
        engineId: 'misty-ffq-banqi-level-1',
        ...extra,
      }),
    ]) as IncomingMessage;
    request.method = 'POST';
    request.headers = {};
    let status = 0,
      body = '';
    const response = {
      writeHead: (code: number) => {
        status = code;
      },
      end: (chunk: string) => {
        body += chunk;
      },
    } as unknown as ServerResponse;
    await roomsRoute(
      { databaseRequired: false, refusesCreate: () => false } as HttpApiContext,
      request,
      response,
      '/api/rooms',
    );
    return { status, body: JSON.parse(body) };
  }
  const created = await post();
  assert.equal(created.status, 201);
  const room = ffqBanqiRooms.get(created.body.roomId);
  assert.ok(room);
  assert.equal(room.pveBotId, 'misty');
  assert.equal(room.rated, false);
  assert.ok(Object.values(room.projection.seats).includes('misty-ffq-banqi-level-1'));
  for (const extra of [
    { rated: true },
    { engineId: 'misty-banqi-level-1' },
    { mode: 'correspondence' },
  ])
    assert.ok((await post(extra)).status >= 400);
});
