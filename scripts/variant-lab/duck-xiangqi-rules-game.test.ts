import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { winPercent } from '@mistboard/game';
import { PLANS, type Row, readRows } from './rules-page-games/common.ts';

const builder = new URL('./rules-page-games/duck-xiangqi.ts', import.meta.url);
const sourceRows = join(PLANS, 'duck-xiangqi.rows.jsonl');
const game = JSON.parse(readFileSync(join(PLANS, 'duck-xiangqi.game.json'), 'utf8'));

function build(rows: string, out: string) {
  const result = spawnSync(
    process.execPath,
    ['--import', 'tsx', builder.pathname, 'build', '--rows', rows, '--out', out],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(readFileSync(out, 'utf8'));
}

describe('Duck Xiangqi rules-game builder', () => {
  it('charts every completed turn in Red POV using position rows, including confirmations', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rules-duck-pov-'));
    const rows = readRows(sourceRows);
    // These positions have no confirmation override. Position 5 is Black to move:
    // its +300 must become Red's -300, even if the played-move search disagrees.
    rows.set('p4', { ...rows.get('p4')!, cp: 300 });
    rows.set('p5', { ...rows.get('p5')!, cp: 300 });
    rows.set('m5', { ...rows.get('m5')!, cp: -300 });
    rows.set('p6', { id: 'p6', best: '', pv: [], mate: 2 });
    rows.set('p7', { id: 'p7', best: '', pv: [], mate: 3 });
    const input = join(dir, 'rows.jsonl');
    writeFileSync(input, [...rows.values()].map((r) => JSON.stringify(r)).join('\n'));
    const plan = build(input, join(dir, 'plan.json'));
    const chart = plan.create.chapter.scoreSeries;
    assert.ok(chart, 'the rules-game chapter needs a score series');
    assert.equal(chart.side, 'red');
    assert.equal(chart.series.length, 1);
    assert.equal(chart.series[0].name, 'Fairy-Stockfish');
    assert.equal(chart.series[0].color, 'a');
    const values = chart.series[0].values as number[];
    assert.equal(values.length, game.moves.length + 1, 'start plus every mainline ply');

    const confirmed = new Map<string, Row>();
    for (const half of [0, 1]) {
      for (const [id, row] of readRows(join(PLANS, `duck-xiangqi.confirm${half}.rows.jsonl`))) {
        confirmed.set(id, row);
      }
    }
    for (let ply = 0; ply < game.moves.length; ply++) {
      const row = confirmed.get(`P${ply}`) ?? rows.get(`p${ply}`)!;
      const sign = ply % 2 === 0 ? 1 : -1;
      const expected =
        winPercent(
          row.cp == null ? null : sign * row.cp,
          row.mate == null ? null : sign * row.mate,
        ) / 100;
      assert.ok(Math.abs(values[ply]! - expected) < 1e-12, `Red POV at position ${ply}`);
    }
    assert.ok(Math.abs(values[5]! - winPercent(-300, null) / 100) < 1e-12);
    assert.ok(values[4]! > 0.5);
    assert.ok(values[5]! < 0.5);
    assert.equal(values.at(-1), 0, 'Black captured the general; no terminal search needed');
  });

  it('reproduces the committed plan from the saved engine rows', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rules-duck-plan-'));
    const actual = build(sourceRows, join(dir, 'plan.json'));
    const saved = JSON.parse(readFileSync(join(PLANS, 'duck-xiangqi.plan.json'), 'utf8'));
    assert.deepEqual(actual, saved);
  });
});
