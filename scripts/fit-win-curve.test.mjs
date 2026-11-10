import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

function run(script, args = []) {
  const result = spawnSync(process.execPath, [`scripts/${script}`, ...args], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

test('paired tracked samples reproduce the CC0 calibration and seeded game-bootstrap interval', () => {
  const report = JSON.parse(run('fit-win-curve-paired.mjs'));
  assert.equal(report.positions, 856);
  assert.equal(report.paired, 848);
  assert.equal(report.games, 70);
  assert.equal(report.k6, 0.00465696);
  assert.deepEqual(report.ci95, [0.004567, 0.004755]);
  assert.equal(report.seed, 20261109);
  assert.equal(report.bootstrapReplicates, 2000);
  assert.deepEqual(
    report.bands.map(({ winDev5, winDev6 }) => [winDev5, winDev6]),
    [
      [2.4, 2.7],
      [11.4, 10.9],
      [25.5, 25.0],
      [41.7, 41.0],
    ],
  );
  assert.equal(report.signFlipsOver50, 0);
  assert.deepEqual(report.mates, { mate5: 7, mate6: 7 });
});

test('paired fit joins by key and ply, independent of the second file order', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'mistboard-paired-fit-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const old = JSON.parse(readFileSync('scripts/data/win-curve-samples.json', 'utf8'));
  const fresh = JSON.parse(
    readFileSync('scripts/data/win-curve-samples-pikafish-cc0.json', 'utf8'),
  );
  const path = join(dir, 'reversed.json');
  writeFileSync(path, JSON.stringify({ ...fresh, samples: fresh.samples.toReversed() }));
  const args = ['--boot', '10'];
  const ordered = run('fit-win-curve-paired.mjs', args);
  const reversed = run('fit-win-curve-paired.mjs', [...args, '--new', path]);
  assert.equal(reversed, ordered);
  // A missing position must fail instead of silently fitting a different corpus.
  writeFileSync(path, JSON.stringify({ ...fresh, samples: fresh.samples.slice(1) }));
  const missing = spawnSync(
    process.execPath,
    ['scripts/fit-win-curve-paired.mjs', ...args, '--new', path],
    { encoding: 'utf8' },
  );
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /missing paired sample/);
  assert.equal(old.samples.length, fresh.samples.length);
});

test('outcome fit writes the chess-K bootstrap percentile in its report', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'mistboard-outcome-fit-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'report.json');
  const stdout = run('fit-win-curve.mjs', [
    '--in',
    'scripts/data/win-curve-samples.json',
    '--boot',
    '20',
    '--out',
    path,
  ]);
  const report = JSON.parse(readFileSync(path, 'utf8'));
  assert.equal(typeof report.chessKPercentile, 'number');
  assert.ok(report.chessKPercentile >= 0 && report.chessKPercentile <= 100);
  assert.ok(!('containsChessK' in report));
  assert.ok(stdout.includes(`at the ${report.chessKPercentile.toFixed(1)} percentile`));
});
