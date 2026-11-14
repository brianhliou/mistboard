import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type pg from 'pg';
import { loadBotRatingPins } from './bot-rating-provenance.js';
import {
  captureEngineGameStamps,
  captureEngineGameStampsOrNull,
  recordEngineGameStamps,
} from './engine-game-provenance.js';
import { loadEngine } from './engine-registry.js';

test('worker hashes the resolved net bytes, including an override that differs from the server pin', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'eve-net-stamp-'));
  const net = join(dir, 'net.nnue');
  writeFileSync(net, 'worker-specific net bytes');
  const names = ['MISTBOARD_FSF_XIANGQI_PATH', 'MISTBOARD_FSF_XIANGQI_NET'] as const;
  const saved = names.map((name) => process.env[name]);
  process.env.MISTBOARD_FSF_XIANGQI_PATH = process.execPath;
  process.env.MISTBOARD_FSF_XIANGQI_NET = net;
  try {
    const id = 'fairy-stockfish-xiangqi-level-8';
    const stamps = await captureEngineGameStamps(
      loadEngine(id),
      loadEngine('random-legal-xiangqi'),
    );
    assert.equal(
      stamps.white.netSha256,
      createHash('sha256').update('worker-specific net bytes').digest('hex'),
    );
    assert.notEqual(stamps.white.netSha256, loadBotRatingPins([id]).nets[id]);
    assert.equal(stamps.black.netSha256, null);
    assert.equal(stamps.white.recipe, loadBotRatingPins([]).recipe);
    writeFileSync(net, 'replacement worker net');
    const changed = await captureEngineGameStamps(
      loadEngine('random-legal-xiangqi'),
      loadEngine(id),
    );
    assert.notEqual(changed.black.netSha256, stamps.white.netSha256);
  } finally {
    names.forEach((name, i) => {
      if (saved[i] === undefined) delete process.env[name];
      else process.env[name] = saved[i];
    });
    rmSync(dir, { recursive: true });
  }
});

test('whole stored stamp payload contains only build and net: hidden setup, board, pieces and paths cannot enter it', async () => {
  const recipe = loadBotRatingPins([]).recipe;
  const side = {
    recipe,
    netSha256: null,
    board: [{ role: 'secret-general' }],
    setup: { hidden: 'PRIVATE_DEAL' },
    seed: 'PRIVATE_SEED',
    path: '/private/net',
  };
  let payload: unknown;
  const db = {
    query: async (sql: string, values: unknown[]) => {
      assert.match(sql, /INSERT INTO game_debug_artifacts/);
      assert.equal(values[1], 'engine-rating-stamp');
      payload = values[2];
      return { rows: [] };
    },
  } as unknown as Pick<pg.Pool, 'query'>;
  await recordEngineGameStamps(db, 'hidden-info-game', { white: side, black: side });
  assert.equal(
    JSON.stringify(payload),
    JSON.stringify({ white: { recipe, netSha256: null }, black: { recipe, netSha256: null } }),
  );
  assert.doesNotMatch(
    JSON.stringify(payload),
    /board|role|setup|hidden|seed|path|PRIVATE|secret-general/,
  );
});

test('an unreadable net leaves the game unstamped instead of failing it', async () => {
  const names = ['MISTBOARD_FSF_XIANGQI_PATH', 'MISTBOARD_FSF_XIANGQI_NET'] as const;
  const saved = names.map((name) => process.env[name]);
  process.env.MISTBOARD_FSF_XIANGQI_PATH = process.execPath;
  process.env.MISTBOARD_FSF_XIANGQI_NET = join(tmpdir(), 'no-such-dir-eve-stamp', 'missing.nnue');
  try {
    const id = 'fairy-stockfish-xiangqi-level-8';
    await assert.rejects(
      captureEngineGameStamps(loadEngine(id), loadEngine('random-legal-xiangqi')),
    );
    assert.equal(
      await captureEngineGameStampsOrNull(loadEngine(id), loadEngine('random-legal-xiangqi')),
      null,
    );
  } finally {
    names.forEach((name, i) => {
      if (saved[i] === undefined) delete process.env[name];
      else process.env[name] = saved[i];
    });
  }
});
