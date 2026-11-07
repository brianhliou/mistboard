import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import test from 'node:test';
import { close, getPool, init } from '../persistence-db.js';
import { clearPresence } from '../presence.js';
import { tryHandle } from './engines.js';

const ORIGINAL = 'misty-three-kingdoms-banqi';
const levels = Array.from({ length: 8 }, (_, i) => `${ORIGINAL}-level-${i + 1}`);

test('playable API reports TK runtime tiers only through the admin/local gate', async (t) => {
  const scratch = '/tmp/burn-scratch/mistboard-burn-867-tk-admin-pve-level-picker';
  mkdirSync(scratch, { recursive: true });
  const dir = mkdtempSync(join(scratch, 'availability-'));
  const binary = join(dir, 'engine');
  const net = join(dir, 'test.nnue');
  writeFileSync(binary, 'fixture binary');
  writeFileSync(net, 'fixture net');
  const keys = [
    'MISTBOARD_THREE_KINGDOMS_BANQI_ENABLED',
    'MISTBOARD_THREE_KINGDOMS_BANQI_ENGINE_PATH',
    'MISTBOARD_THREE_KINGDOMS_BANQI_NET',
    'MISTBOARD_EXTRA_PLAYABLE_ENGINES',
  ] as const;
  const saved = keys.map((key) => process.env[key]);
  process.env[keys[0]] = 'false';
  process.env[keys[1]] = binary;
  process.env[keys[2]] = net;
  process.env[keys[3]] = levels[7];
  init('postgres://mistboard@127.0.0.1:9/never-connect');
  t.after(async () => {
    clearPresence();
    await close();
    keys.forEach((key, i) => {
      if (saved[i] === undefined) delete process.env[key];
      else process.env[key] = saved[i];
    });
  });
  t.mock.method(getPool(), 'connect', () => assert.fail('unexpected database connection'));
  t.mock.method(getPool(), 'query', async (sql: string, args: unknown[]) => {
    assert.ok(sql.includes('UPDATE account_sessions'));
    return { rows: [{ id: args[0], handle: 'fixture', account_role: args[0] }] };
  });

  let headers: Record<string, string> = {};
  async function read(role?: 'admin' | 'player') {
    let body = '';
    let status = 0;
    const request = {
      method: 'GET',
      headers: role ? { cookie: `mistboard_session=${role}.fixture` } : {},
    } as IncomingMessage;
    const response = {
      writeHead(code: number, values: Record<string, string>) {
        status = code;
        headers = values;
      },
      end(chunk: string) {
        body += chunk;
      },
    } as unknown as ServerResponse;
    assert.equal(await tryHandle({}, request, response, '/api/engines/playable'), true);
    assert.equal(status, 200);
    assert.ok(!body.includes(dir), 'the whole response must not expose filesystem paths');
    return JSON.parse(body) as {
      engines: { id: string }[];
      threeKingdomsBanqiEngines?: { id: string; name: string; familyName: string; kind: string }[];
    };
  }

  for (const role of [undefined, 'player'] as const) {
    const data = await read(role);
    assert.equal(data.threeKingdomsBanqiEngines, undefined);
    assert.ok(!JSON.stringify(data).includes(ORIGINAL), 'no TK engine in any public field');
  }
  const full = await read('admin');
  assert.deepEqual(
    full.threeKingdomsBanqiEngines?.map((e) => e.id),
    [ORIGINAL, ...levels],
  );
  assert.equal(headers['cache-control'], 'private, no-store');
  assert.deepEqual(Object.keys(full.threeKingdomsBanqiEngines![8]!).sort(), [
    'familyName',
    'id',
    'kind',
    'name',
  ]);

  for (const absent of [undefined, join(dir, 'missing-net'), dir]) {
    if (absent === undefined) delete process.env[keys[2]];
    else process.env[keys[2]] = absent;
    assert.deepEqual(
      (await read('admin')).threeKingdomsBanqiEngines?.map((e) => e.id),
      [ORIGINAL, ...levels.slice(0, 7)],
    );
  }
  process.env[keys[1]] = join(dir, 'missing-binary');
  process.env[keys[2]] = net;
  assert.deepEqual(
    (await read('admin')).threeKingdomsBanqiEngines?.map((e) => e.id),
    [levels[0]],
  );

  process.env[keys[0]] = 'true';
  for (const role of [undefined, 'player', 'admin'] as const) {
    assert.deepEqual(
      (await read(role)).threeKingdomsBanqiEngines?.map((e) => e.id),
      [levels[0]],
    );
  }
});
