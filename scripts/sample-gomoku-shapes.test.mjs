import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { mineShapes, parseArgs, shapeClass } from './sample-gomoku-shapes.mjs';

const options = (output, extra = {}) => ({
  black: 2,
  white: 3,
  halfWidth: 3,
  sample: 60,
  band: [0.48, 0.52],
  output,
  ...extra,
});
const telemetry = (winrate) => ({ winrate, finalScore: 0, nodes: 1_000_000 });
const screen = (candidate) => ({ candidate, fast: { screen: telemetry(0.5) }, deep: null });
const key = (candidate) =>
  shapeClass(
    candidate.stones.map(({ square, color }) => [
      square.charCodeAt(0) - 104,
      Number(square.slice(1)) - 8,
      color,
    ]),
    3,
  ).key;
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'gomoku-mining-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return join(dir, 'mine.json');
}

test('planted failure between checkpoints resumes without re-searching any completed class', (t) => {
  const output = fixture(t);
  const completed = new Set();
  let calls = 0;
  const checkpoints = [];
  assert.throws(
    () =>
      mineShapes(options(output), {
        screen(candidate) {
          if (++calls === 28) throw new Error('planted engine failure');
          const id = key(candidate);
          assert.ok(!completed.has(id), 're-searched a completed class');
          completed.add(id);
          return screen(candidate);
        },
        onCheckpoint: (data) => checkpoints.push(data.rows.length),
      }),
    /planted engine failure/,
  );
  assert.deepEqual(checkpoints, [0, 25]);
  const checkpoint = JSON.parse(readFileSync(output, 'utf8'));
  assert.equal(checkpoint.rows.length, 25);
  assert.ok(checkpoint.rows.every((row) => row.hits >= 1));
  assert.ok(checkpoint.state.drawn >= checkpoint.state.accepted);
  assert.ok(Number.isInteger(checkpoint.state.prngState));
  assert.equal(readFileSync(`${output}.journal.jsonl`, 'utf8').trim().split('\n').length, 2);

  // A torn append is not a completed search. Recovery removes it before appending.
  appendFileSync(`${output}.journal.jsonl`, '{"sequence":');
  const resumed = mineShapes(options(output, { resume: true }), {
    screen(candidate) {
      const id = key(candidate);
      assert.ok(!completed.has(id), 'resume re-searched a completed class');
      completed.add(id);
      return screen(candidate);
    },
  });
  const uninterrupted = mineShapes(options(), { screen });
  assert.equal(completed.size, 60);
  assert.deepEqual(resumed, uninterrupted, 'PRNG, hits and counters must resume exactly');
  assert.equal(readFileSync(`${output}.journal.jsonl`, 'utf8'), '');
});

test('a stale journal after checkpoint rename is replayed only once', (t) => {
  const output = fixture(t);
  const data = mineShapes(options(output, { sample: 3 }), { screen });
  appendFileSync(`${output}.journal.jsonl`, `${JSON.stringify({ sequence: 3 })}\n`);
  const resumed = mineShapes(options(output, { sample: 3, resume: true }), {
    screen() {
      assert.fail('already at the shape limit');
    },
  });
  assert.deepEqual(resumed, data);
});

test('target counts only valid deep winrates, with inclusive custom band boundaries', (t) => {
  const output = fixture(t);
  const wins = [null, NaN, 0.479, 0.48, 0.521, 0.52];
  let calls = 0;
  const data = mineShapes(options(output, { untilInBand: 2 }), {
    screen(candidate) {
      const win = wins[calls++];
      return {
        candidate,
        fast: { screen: telemetry(0.5) },
        deep: win === null ? null : { screen: telemetry(win) },
      };
    },
  });
  assert.equal(calls, 6);
  assert.equal(data.summary.inBand, 2);
  assert.equal(data.summary.sampledShapes, 6);
  assert.equal(data.summary.stopReason, 'target');
  mineShapes(options(output, { resume: true, untilInBand: 2 }), {
    screen() {
      assert.fail('target already satisfied');
    },
  });
  let customCalls = 0;
  const custom = mineShapes(options(undefined, { untilInBand: 2, band: [0.49, 0.51] }), {
    screen(candidate) {
      const winrate = [0.48, 0.49, 0.51][customCalls++];
      return { candidate, fast: { screen: null }, deep: { screen: telemetry(winrate) } };
    },
  });
  assert.equal(customCalls, 3);
  assert.equal(custom.summary.inBand, 2);
});

test('legacy seeds count once across translation and D4, without invented sampling hits', (t) => {
  const output = fixture(t);
  const original = mineShapes(options(undefined, { sample: 100 }), {
    screen(candidate) {
      return { ...screen(candidate), deep: { screen: telemetry(0.5) } };
    },
  });
  const seedFrom = `${output}.seed.json`;
  const rows = original.rows.map(({ candidate, raw, fast, deep }) => ({
    candidate,
    raw,
    fast,
    deep,
  }));
  const rotated = structuredClone(rows[0]);
  rotated.candidate.stones = rotated.candidate.stones.map(({ square, color }) => ({
    color,
    square: `${String.fromCharCode(104 + (Number(square.slice(1)) - 8))}${8 - (square.charCodeAt(0) - 104)}`,
  }));
  writeFileSync(seedFrom, JSON.stringify({ summary: original.summary, rows: [...rows, rotated] }));
  const seeded = mineShapes(options(output, { seedFrom, sample: 150, untilInBand: 100 }), {
    screen() {
      assert.fail('seed already meets the target');
    },
  });
  assert.equal(seeded.rows.length, 100);
  assert.equal(seeded.summary.inBand, 100);
  assert.equal(seeded.state.drawn, 0);
  assert.equal(seeded.summary.shapesEstimate, null);
  assert.ok(seeded.rows.every((row) => row.hits === 0));
  // An existing resume owns its state; a missing original seed is irrelevant.
  rmSync(seedFrom);
  const seedKeys = new Set(rows.map((row) => key(row.candidate)));
  let calls = 0;
  const continued = mineShapes(options(output, { resume: true, seedFrom, sample: 105 }), {
    screen(candidate) {
      assert.ok(!seedKeys.has(key(candidate)), 'seed class re-searched');
      calls++;
      return screen(candidate);
    },
  });
  assert.equal(calls, 5);
  assert.equal(
    continued.rows.reduce((n, row) => n + row.hits, 0),
    continued.state.accepted,
  );
});

test('resume and seed input fail closed for incompatible or damaged evidence', (t) => {
  const output = fixture(t);
  mineShapes(options(output, { sample: 2 }), { screen });
  const noSearch = {
    screen() {
      assert.fail('bad input must fail before screening');
    },
  };
  assert.throws(() => mineShapes(options(output), noSearch), /exists/);
  assert.throws(
    () => mineShapes(options(output, { resume: true, black: 3 }), noSearch),
    /configuration/,
  );
  const data = JSON.parse(readFileSync(output, 'utf8'));
  data.rows[0].raw++;
  writeFileSync(`${output}.seed.json`, JSON.stringify(data));
  assert.throws(
    () => mineShapes(options(undefined, { seedFrom: `${output}.seed.json` }), noSearch),
    /raw/,
  );
  appendFileSync(`${output}.journal.jsonl`, 'broken json\n');
  assert.throws(() => mineShapes(options(output, { resume: true }), noSearch), /JSON/);
});

test('CLI validates mining flags and retains a hard shape budget', () => {
  const args = ['2', '3', '3', '1000000', '/tmp/mine.json'];
  assert.deepEqual(
    parseArgs([
      ...args,
      '--until-in-band',
      '250',
      '--band',
      '0.48,0.52',
      '--resume',
      '--seed-from',
      '/tmp/seed.json',
    ]),
    options('/tmp/mine.json', {
      sample: 1_000_000,
      untilInBand: 250,
      resume: true,
      seedFrom: '/tmp/seed.json',
    }),
  );
  for (const flags of [
    ['--until-in-band', '0'],
    ['--band', '0.52,0.48'],
    ['--band', '0.48'],
    ['--band', '-1,1'],
    ['--unknown'],
    ['--seed-from'],
    ['--until-in-band', '2.5'],
  ]) {
    assert.throws(() => parseArgs([...args, ...flags]));
  }
  assert.throws(() => parseArgs(['30', '30', '1', '3', '/tmp/out']));
  const result = mineShapes(options(undefined, { sample: 2, untilInBand: 250 }), { screen });
  assert.equal(result.summary.sampledShapes, 2);
  assert.equal(result.summary.stopReason, 'shape-limit');
});

test('NO_ENGINE estimator still agrees with exact 2B+2W shape enumeration', () => {
  const result = spawnSync(
    process.execPath,
    ['scripts/sample-gomoku-shapes.mjs', '2', '2', '2', '1200', '/dev/null'],
    { encoding: 'utf8', env: { NO_ENGINE: '1' } },
  );
  assert.equal(result.status, 0, result.stderr);
  const { exactShapes, estimate } = JSON.parse(result.stdout);
  assert.equal(exactShapes, 1949);
  assert.ok(Math.abs(estimate / exactShapes - 1) < 0.05);
});
