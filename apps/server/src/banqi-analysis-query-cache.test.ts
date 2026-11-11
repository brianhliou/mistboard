import assert from 'node:assert/strict';
import { mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createInitialBanqiState, STANDARD_BANQI_DEAL } from '@mistboard/game';
import {
  analysisAsset,
  type BanqiAnalysisQuery,
  BanqiAnalysisQueryCache,
  banqiAnalysisQueryKey,
  completeBanqiAnalysis,
} from './banqi-analysis-query-cache.js';
import { banqiStateToEngineFen } from './banqi-fen.js';
import type { UciEval } from './uci-engine-harness.js';

const query: BanqiAnalysisQuery = {
  binary: { path: 'binary', sha256: 'binary-sha', stamp: '1' },
  model: { path: 'model', sha256: 'model-sha', stamp: '1' },
  initCommands: [
    'uci',
    'setoption name EvalFile value model',
    'setoption name NoProgressLimit value 60',
    'ucinewgame',
    'isready',
  ],
  positionCommand: 'position fen masked b pool 2 4 moves a0b0 b3c3',
  goCommand: 'go nodes 200 movetime 30000 searchmoves a0a0 b0b0',
  nodes: 200,
  movetimeCapMs: 30000,
};
function result(): UciEval {
  return {
    best: 'a0a0',
    cp: 12,
    mate: null,
    depth: 4,
    nodes: 200,
    timeMs: 2,
    pv: ['a0a0'],
    lines: [{ index: 1, move: 'a0a0', cp: 12, mate: null, depth: 4, pv: ['a0a0'], bound: null }],
  };
}
test('keys preserve every exact ordered public query and evaluator artifact/budget dimension', () => {
  const variants: BanqiAnalysisQuery[] = [
    { ...query, binary: { ...query.binary, sha256: 'changed' } },
    { ...query, model: { ...query.model, sha256: 'changed' } },
    { ...query, positionCommand: query.positionCommand.replace('masked', 'other-masked') },
    { ...query, positionCommand: query.positionCommand.replace('a0b0 b3c3', 'b3c3 a0b0') },
    { ...query, goCommand: query.goCommand.replace('a0a0 b0b0', 'b0b0 a0a0') },
    { ...query, initCommands: query.initCommands.map((s) => s.replace('value 60', 'value 40')) },
    { ...query, initCommands: [...query.initCommands, 'setoption name Seed value 1'] },
    { ...query, nodes: 201 },
    { ...query, movetimeCapMs: 29999 },
  ];
  assert.equal(new Set([query, ...variants].map(banqiAnalysisQueryKey)).size, variants.length + 1);
  assert.doesNotMatch(banqiAnalysisQueryKey(query), /roomId|player|canonical|deal/);
});
test('duplicate requests share one computation and return independent deep snapshots', async () => {
  const cache = new BanqiAnalysisQueryCache();
  let release!: () => void;
  const wait = new Promise<void>((r) => (release = r));
  let calls = 0;
  const run = async () => {
    calls++;
    await wait;
    return result();
  };
  const a = cache.evaluate(query, run),
    b = cache.evaluate(query, run);
  release();
  const [one, two] = await Promise.all([a, b]);
  one.lines![0]!.pv[0] = 'changed';
  assert.equal(two.lines![0]!.pv[0], 'a0a0');
  const hit = await cache.evaluate(query, run);
  assert.equal(hit.lines![0]!.pv[0], 'a0a0');
  assert.equal(calls, 1);
  assert.equal(cache.stats().coalesced, 1);
  assert.equal(cache.stats().hits, 1);
});
test('failures, null/bounded scores and early/time-truncated searches are never reusable', async () => {
  const cache = new BanqiAnalysisQueryCache();
  let calls = 0;
  await assert.rejects(
    cache.evaluate(query, async () => {
      throw Error('engine');
    }),
  );
  const values = [
    { ...result(), cp: null, mate: null },
    { ...result(), best: 'illegal-root' },
    { ...result(), nodes: 199 },
    { ...result(), timeMs: 30000 },
    { ...result(), nodes: undefined },
    { ...result(), lines: [{ ...result().lines![0]!, bound: 'lower' as const }] },
  ];
  for (const value of values) {
    assert.equal(completeBanqiAnalysis(value, query), false);
    await cache.evaluate(query, async () => {
      calls++;
      return value;
    });
  }
  assert.equal(cache.stats().entries, 0);
  assert.equal(calls, values.length);
  await cache.evaluate(query, async () => result());
  assert.equal(cache.stats().entries, 1);
});
test('entry/byte/TTL/inflight bounds and clear prevent retained unbounded or stale work', async () => {
  const cache = new BanqiAnalysisQueryCache({ entries: 1, bytes: 2000, inflight: 1, ttlMs: 60000 });
  await cache.evaluate(query, async () => result());
  const other = { ...query, nodes: 201 };
  await cache.evaluate(other, async () => ({ ...result(), nodes: 201 }));
  assert.equal(cache.stats().entries, 1);
  assert.equal(cache.stats().evicted, 1);
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const pending = cache.evaluate(query, async () => {
    await gate;
    return result();
  });
  await assert.rejects(
    cache.evaluate({ ...query, nodes: 202 }, async () => result()),
    /capacity/,
  );
  cache.clear();
  release();
  await pending;
  assert.equal(cache.stats().entries, 0);
  const short = new BanqiAnalysisQueryCache({ entries: 1, bytes: 2000, inflight: 1, ttlMs: 0 });
  let count = 0;
  for (let i = 0; i < 2; i++)
    await short.evaluate(query, async () => {
      count++;
      return result();
    });
  assert.equal(count, 2);
  const tiny = new BanqiAnalysisQueryCache({ entries: 2, bytes: 1, inflight: 1, ttlMs: 60000 });
  await tiny.evaluate(query, async () => result());
  assert.equal(tiny.stats().entries, 0);
});
test('actual content identities change on rotation and missing/unreadable assets fail before reuse', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'banqi-cache-'));
  try {
    const path = join(dir, 'model');
    await writeFile(path, 'one');
    const one = await analysisAsset(path);
    await writeFile(path, 'two');
    const two = await analysisAsset(path);
    assert.notEqual(one.sha256, two.sha256);
    await unlink(path);
    await assert.rejects(analysisAsset(path), /assets unavailable/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('canonical deals and room identities with the same public information share an exact key', () => {
  const swapped = [...STANDARD_BANQI_DEAL];
  [swapped[0], swapped[31]] = [swapped[31]!, swapped[0]!];
  const one = createInitialBanqiState('private-room-one', STANDARD_BANQI_DEAL);
  const two = createInitialBanqiState('private-room-two', swapped);
  const inputOne = { ...query, positionCommand: `position fen ${banqiStateToEngineFen(one)}` };
  const inputTwo = { ...query, positionCommand: `position fen ${banqiStateToEngineFen(two)}` };
  assert.equal(banqiAnalysisQueryKey(inputOne), banqiAnalysisQueryKey(inputTwo));
  assert.doesNotMatch(banqiAnalysisQueryKey(inputOne), /private-room|board|faceDown|deal/);
});
