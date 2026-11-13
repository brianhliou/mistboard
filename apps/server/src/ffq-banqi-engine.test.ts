import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { createInitialFFQBanqiState } from '@mistboard/game';
import { ffqBanqiLiveEngineMove } from './ffq-banqi-engine.js';
import { ffqBanqiTierRequestFor } from './server-ffq-banqi-engine.js';

test('FFQ live provider preserves UCI cp/mate scores and leaves scoreless searches null', async () => {
  const dir = mkdtempSync('/tmp/ffq-score-');
  const previous = process.env.MISTBOARD_FFQ_BANQI_ENGINE_PATH;
  const request = ffqBanqiTierRequestFor(
    createInitialFFQBanqiState('ffq_score', 800),
    'misty-ffq-banqi-level-7',
    50,
  );
  try {
    for (const [info, cp, mate] of [
      ['info depth 4 nodes 25000 time 2 score cp -123', -123, null],
      ['info depth 4 nodes 25000 time 2 score mate 3', null, 3],
      ['', null, null],
    ] as const) {
      const bin = join(dir, 'engine');
      writeFileSync(
        bin,
        `#!${process.execPath}\nrequire('node:readline').createInterface({input: process.stdin}).on('line', line => { if (line === 'uci') console.log('uciok'); if (line === 'isready') console.log('readyok'); if (line.startsWith('go ')) console.log(${JSON.stringify(`${info}\nbestmove a0a0`)}); });\n`,
        { mode: 0o755 },
      );
      process.env.MISTBOARD_FFQ_BANQI_ENGINE_PATH = bin;
      const result = await ffqBanqiLiveEngineMove(request);
      assert.equal(result.cp, cp);
      assert.equal(result.mate, mate);
      assert.deepEqual(result.move, { from: 0, to: 0 });
      assert.equal(result.gameId, request.gameId);
      assert.equal(result.sessionId, request.sessionId);
    }
  } finally {
    if (previous === undefined) delete process.env.MISTBOARD_FFQ_BANQI_ENGINE_PATH;
    else process.env.MISTBOARD_FFQ_BANQI_ENGINE_PATH = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});
