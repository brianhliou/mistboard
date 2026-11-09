import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
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
    assert.ok(!body.includes(`"${ORIGINAL}"`), 'the historical TK id is never offered');
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
    levels,
  );
  assert.deepEqual(
    full.threeKingdomsBanqiEngines?.map((e) => e.name),
    levels.map((_, i) => `Misty level ${i + 1}`),
  );
  assert.equal(headers['cache-control'], 'private, no-store');
  assert.deepEqual(Object.keys(full.threeKingdomsBanqiEngines![7]!).sort(), [
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
      levels.slice(0, 7),
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

test('public runtime roster hides neural Flip Jungle L8 without its file and never exposes paths', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'jgf-roster-'));
  const bin = join(dir, 'engine');
  const net = join(dir, 'net.jfnn');
  writeFileSync(bin, 'fixture engine');
  writeFileSync(net, 'fixture net');
  const keys = ['MISTBOARD_JUNGLE_FLIP_ENGINE_PATH', 'MISTBOARD_JUNGLE_FLIP_NET'] as const;
  const saved = keys.map((key) => process.env[key]);
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
    keys.forEach((key, i) => {
      if (saved[i] === undefined) delete process.env[key];
      else process.env[key] = saved[i];
    });
  });
  process.env.MISTBOARD_JUNGLE_FLIP_ENGINE_PATH = bin;
  for (const path of [undefined, `${net}.missing`, dir, net]) {
    if (path === undefined) delete process.env.MISTBOARD_JUNGLE_FLIP_NET;
    else process.env.MISTBOARD_JUNGLE_FLIP_NET = path;
    let body = '';
    const response = {
      writeHead: () => {},
      end: (chunk: string) => {
        body += chunk;
      },
    } as unknown as ServerResponse;
    await tryHandle(
      {},
      { method: 'GET', headers: {} } as IncomingMessage,
      response,
      '/api/engines/playable',
    );
    const roster = JSON.parse(body).jungleFlipEngines;
    assert.equal(roster.length, path === net ? 8 : 7);
    assert.equal(
      roster.some((tier: { id: string }) => tier.id === 'misty-jungle-flip-level-8'),
      path === net,
    );
    assert.ok(!body.includes(dir));
    assert.ok(
      roster.some(
        (tier: { id: string; name: string }) =>
          tier.id === 'misty-jungle-flip' && tier.name === 'Misty Level 7',
      ),
    );
  }
});
