import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type pg from 'pg';
import { loadBotRatingPins } from './bot-rating-provenance.js';
import { currentStampedCalibrationGames } from './bot-rating-refresh.js';
import type { EngineEloGameRow } from './engine-elo-report.js';
import {
  captureEngineGameStamps,
  captureEngineGameStampsOrNull,
  recordEngineGameStamps,
} from './engine-game-provenance.js';
import { loadEngine } from './engine-registry.js';

test('worker hashes the resolved net bytes, including an override that differs from the server pin', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'eve-net-stamp-'));
  const net = join(dir, 'mistboardxiangqi-test.nnue');
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

test('Rapfi worker hashes the actual native mix9svq file and records policy for each seat', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'rapfi-stamp-'));
  const name = 'mix9svqfreestyle_bsmix.bin.lz4';
  writeFileSync(join(dir, name), 'actual worker Rapfi net');
  const saved = process.env.RAPFI_BIN;
  process.env.RAPFI_BIN = join(dir, 'rapfi');
  try {
    const id = 'rapfi-strongest';
    const anchor = 'random-legal-gomoku';
    const pins = loadBotRatingPins([id, anchor]);
    const stamps = await captureEngineGameStamps(loadEngine(id), loadEngine(anchor));
    assert.equal(
      stamps.white.netSha256,
      createHash('sha256').update('actual worker Rapfi net').digest('hex'),
    );
    assert.notEqual(stamps.white.netSha256, pins.nets[id]);
    assert.equal(stamps.white.policy, loadEngine(id).playSignature);
    assert.deepEqual(stamps.black, {
      recipe: pins.recipe,
      netSha256: null,
      policy: loadEngine(anchor).playSignature,
    });
    // Level 8 shares the strongest policy (#1204); a lower level still stamps
    // its own, so each seat's policy is recorded separately.
    const level = await captureEngineGameStamps(loadEngine('rapfi-level-1'), loadEngine(id));
    assert.notEqual(level.white.policy, level.black.policy);
    let payload: unknown;
    await recordEngineGameStamps(
      {
        query: async (_sql: string, values: unknown[]) => {
          payload = values[2];
          return { rows: [] };
        },
      } as never,
      'gomoku-game',
      stamps,
    );
    assert.deepEqual(payload, stamps);
    const row: EngineEloGameRow = {
      stamps,
      anchorEngineId: anchor,
      whiteEngineId: id,
      blackEngineId: anchor,
      gameId: 'game',
      jobId: 'job',
      result: 'white-wins',
      status: 'completed',
      termination: 'five',
      timeControl: {},
      tournamentId: null,
      variant: 'gomoku',
    };
    // Isolate policy eligibility from the deliberate worker net override.
    const workerPins = { ...pins, nets: { ...pins.nets, [id]: stamps.white.netSha256 } };
    assert.equal(currentStampedCalibrationGames([row], workerPins, anchor).length, 1);
    for (const policy of [undefined, loadEngine('rapfi-level-1').playSignature]) {
      assert.equal(
        currentStampedCalibrationGames(
          [{ ...row, stamps: { ...stamps, white: { ...stamps.white, policy } } }],
          workerPins,
          anchor,
        ).length,
        0,
      );
    }
    assert.equal(currentStampedCalibrationGames([row], pins, anchor).length, 0);
    const legacyStamps = {
      white: { recipe: stamps.white.recipe, netSha256: stamps.white.netSha256 },
      black: { recipe: stamps.black.recipe, netSha256: stamps.black.netSha256 },
    };
    assert.equal(
      currentStampedCalibrationGames(
        [{ ...row, stamps: legacyStamps }],
        { ...workerPins, policies: undefined },
        anchor,
      ).length,
      0,
    );
    const reversed = {
      ...row,
      whiteEngineId: anchor,
      blackEngineId: id,
      stamps: { white: stamps.black, black: stamps.white },
    };
    assert.equal(currentStampedCalibrationGames([reversed], workerPins, anchor).length, 1);
    assert.equal(
      currentStampedCalibrationGames(
        [
          {
            ...reversed,
            stamps: { white: stamps.black, black: { ...stamps.white, policy: 'wrong-policy' } },
          },
        ],
        workerPins,
        anchor,
      ).length,
      0,
    );
    writeFileSync(join(dir, name), 'changed native network bytes');
    const changed = await captureEngineGameStamps(loadEngine(id), loadEngine(anchor));
    assert.notEqual(changed.white.netSha256, stamps.white.netSha256);
    rmSync(join(dir, name));
    await assert.rejects(captureEngineGameStamps(loadEngine(id), loadEngine(anchor)));
  } finally {
    if (saved === undefined) delete process.env.RAPFI_BIN;
    else process.env.RAPFI_BIN = saved;
    rmSync(dir, { recursive: true });
  }
});
