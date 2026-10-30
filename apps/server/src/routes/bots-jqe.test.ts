// jqe is held behind MISTBOARD_JQE_ENABLED until its author's OK. /api/bots lists,
// and the profile and games routes serve, only a bot with a playable option, so the
// flag gates every public bot surface through botPlayOptions alone.
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import '../variant-tenant/register-tenants.js';
import { JIEQI_JQE_ENGINE_ID } from '../jieqi-engine.js';
import { botPlayOptions } from './bots.js';

const jqeBot = {
  id: 'jqe',
  defaultGameSpecId: 'jieqi',
  activeEngineId: JIEQI_JQE_ENGINE_ID,
  supportedGameSpecIds: ['jieqi'],
};

const KEYS = [
  'MISTBOARD_JIEQI_ENABLED',
  'MISTBOARD_JQE_ENABLED',
  'MISTBOARD_JQE_PATH',
  'MISTBOARD_JQE_NET',
] as const;

test('the jqe bot is unplayable with its flag off, even on a box that has the binary and net', (t) => {
  const saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
  const dir = mkdtempSync(join(tmpdir(), 'jqe-bots-'));
  t.after(() => {
    for (const key of KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    rmSync(dir, { recursive: true, force: true });
  });
  const bin = join(dir, 'jqe');
  const net = join(dir, 'it014.jqn');
  writeFileSync(bin, '#!/bin/sh\n');
  chmodSync(bin, 0o755);
  writeFileSync(net, '');
  process.env.MISTBOARD_JIEQI_ENABLED = 'true';
  process.env.MISTBOARD_JQE_PATH = bin;
  process.env.MISTBOARD_JQE_NET = net;

  delete process.env.MISTBOARD_JQE_ENABLED;
  assert.deepEqual(botPlayOptions(jqeBot), [
    {
      gameSpecId: 'jieqi',
      engineId: JIEQI_JQE_ENGINE_ID,
      playable: false,
      version: '331a6e61 · it014',
    },
  ]);

  process.env.MISTBOARD_JQE_ENABLED = '1';
  assert.deepEqual(botPlayOptions(jqeBot), [
    {
      gameSpecId: 'jieqi',
      engineId: JIEQI_JQE_ENGINE_ID,
      playable: true,
      version: '331a6e61 · it014',
    },
  ]);

  // Flag on, but the box lacks the net: still unplayable, never served half-built.
  process.env.MISTBOARD_JQE_NET = join(dir, 'missing.jqn');
  assert.equal(botPlayOptions(jqeBot)[0]?.playable, false);
});
