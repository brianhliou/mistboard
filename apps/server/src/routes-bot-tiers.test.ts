import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { close, getPool, init } from './persistence-db.js';
import { handleBanqiCreate } from './routes/banqi-rooms.js';
import { handleJungleFlipCreate } from './routes/jungle-flip-rooms.js';
import { resolveBotRoomRequest } from './routes/rooms.js';
import './variant-tenant/register-tenants.js';

function captureResponse() {
  const capture = { status: 0, body: '' };
  const response = {
    writeHead: (status: number) => {
      capture.status = status;
    },
    end: (body: string) => {
      capture.body += body;
    },
  } as unknown as ServerResponse;
  return { capture, response };
}

test('Misty homepage tier requests resolve and seat only playable tiers of the requested variant', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'landing-misty-tiers-'));
  const bin = join(dir, 'engine');
  const net = join(dir, 'net');
  writeFileSync(bin, 'fixture binary');
  writeFileSync(net, 'fixture net');
  const keys = [
    'MISTBOARD_BANQI_ENABLED',
    'MISTBOARD_JUNGLE_FLIP_ENABLED',
    'MISTBOARD_BANQI_ENGINE_PATH',
    'MISTBOARD_JUNGLE_FLIP_ENGINE_PATH',
    'MISTBOARD_BANQI_NET',
    'MISTBOARD_JUNGLE_FLIP_NET',
  ] as const;
  const saved = keys.map((key) => process.env[key]);
  process.env[keys[0]] = 'true';
  process.env[keys[1]] = 'true';
  process.env[keys[2]] = bin;
  process.env[keys[3]] = bin;
  delete process.env[keys[4]];
  delete process.env[keys[5]];
  init('postgres://mistboard@127.0.0.1:9/never-connect');
  t.after(async () => {
    await close();
    keys.forEach((key, i) => {
      if (saved[i] === undefined) delete process.env[key];
      else process.env[key] = saved[i];
    });
    rmSync(dir, { recursive: true, force: true });
  });
  t.mock.method(getPool(), 'connect', () => assert.fail('unexpected database connection'));
  t.mock.method(getPool(), 'query', async (sql: string, args: unknown[]) => {
    assert.ok(sql.includes('FROM bot_profiles'));
    return {
      rows: [
        {
          id: args[0],
          active_engine_id: 'python-v2-v1.6',
          default_game_spec_id: 'dark-chess',
          supported_game_spec_ids: ['dark-chess', 'banqi', 'jungle-flip'],
          play_initial_ms: 180000,
          play_increment_ms: 2000,
          visibility: 'public',
        },
      ],
    };
  });

  for (const spec of ['banqi', 'jungle-flip'] as const) {
    const base = `misty-${spec}`;
    const body = {
      botId: 'misty',
      gameSpecId: spec,
      mode: 'pve',
      engineId: `${base}-level-5`,
      rated: false,
    };
    const { response } = captureResponse();
    const resolved = await resolveBotRoomRequest(response, body);
    assert.ok(resolved);
    assert.equal(resolved.engineId, body.engineId);
    assert.equal(resolved.botId, 'misty');
    const seated: unknown[] = [];
    const createRoom = async (_clock: unknown, _pref: unknown, engine: unknown, rated: unknown) => {
      seated.push(engine);
      assert.equal(rated, false);
      return { ok: true as const, room: { id: 'fixture', gameSpecId: spec, rated: false } };
    };
    const ctx = {
      databaseRequired: false,
      refusesCreate: () => false,
      drainDeadlineMs: () => null,
    };
    const seatResponse = captureResponse();
    if (spec === 'banqi') {
      await handleBanqiCreate(
        { ...ctx, createBanqiRoom: createRoom },
        seatResponse.response,
        resolved,
      );
    } else {
      await handleJungleFlipCreate(
        { ...ctx, createJungleFlipRoom: createRoom },
        seatResponse.response,
        resolved,
      );
    }
    assert.equal(seatResponse.capture.status, 201);
    assert.deepEqual(seated, [{ engineId: body.engineId, botId: 'misty', seat: 'black' }]);
    assert.equal(
      (await resolveBotRoomRequest(response, { ...body, engineId: undefined }))?.engineId,
      base,
    );

    for (const engineId of [
      'unknown',
      'misty-other-level-5',
      `misty-${spec === 'banqi' ? 'jungle-flip' : 'banqi'}-level-5`,
      `${base}-level-9`,
      `${base}-level-7`,
      `${base}-amateur`,
      `random-legal-${spec}`,
      '',
      null,
      5,
    ]) {
      const rejected = captureResponse();
      assert.equal(await resolveBotRoomRequest(rejected.response, { ...body, engineId }), null);
      assert.equal(rejected.capture.status, 400);
      assert.equal(JSON.parse(rejected.capture.body).error, 'bot_engine_conflict');
    }
    const unavailable = captureResponse();
    assert.equal(
      await resolveBotRoomRequest(unavailable.response, { ...body, engineId: `${base}-level-8` }),
      null,
    );
    assert.equal(unavailable.capture.status, 400);
    assert.equal(JSON.parse(unavailable.capture.body).error, 'invalid_engine');
    const netKey = spec === 'banqi' ? keys[4] : keys[5];
    process.env[netKey] = net;
    assert.equal(
      (await resolveBotRoomRequest(response, { ...body, engineId: `${base}-level-8` }))?.engineId,
      `${base}-level-8`,
    );
    delete process.env[netKey];
    const otherBot = captureResponse();
    assert.equal(
      await resolveBotRoomRequest(otherBot.response, { ...body, botId: 'community-bot' }),
      null,
    );
    assert.equal(otherBot.capture.status, 400);
  }
  const otherSpec = captureResponse();
  assert.equal(
    await resolveBotRoomRequest(otherSpec.response, {
      botId: 'misty',
      gameSpecId: 'dark-chess',
      mode: 'pve',
      engineId: 'misty-banqi-level-5',
    }),
    null,
  );
  assert.equal(otherSpec.capture.status, 400);
});
