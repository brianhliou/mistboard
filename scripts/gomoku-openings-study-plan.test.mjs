import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { tsImport } from 'tsx/esm/api';
import { buildGomokuOpeningsPlan } from './gomoku-openings-study-plan.mjs';

const pool = JSON.parse(
  readFileSync(new URL('../packages/game/src/gomoku-openings.json', import.meta.url), 'utf8'),
);
const { gomokuFen, parseGomokuFen } = await tsImport(
  '../packages/game/src/variants-gomoku.ts',
  import.meta.url,
);
const editor = await tsImport('../apps/server/src/study-edit-cli.ts', import.meta.url);
const { ensureDealtRoot } = await tsImport('../apps/server/src/routes/studies.ts', import.meta.url);
const chaptersOf = (plan) => [plan.create.chapter, ...plan.ops];
const sortedStones = (stones) => [...stones].sort((a, b) => a.square.localeCompare(b.square));

test('every pool opening stays in order with its exact stones, turn and screening provenance', () => {
  const plan = buildGomokuOpeningsPlan(pool);
  assert.equal(plan.create.owner, 'mistboard');
  assert.equal(plan.create.name, 'Gomoku: every dealt opening');
  assert.equal(plan.create.visibility, 'unlisted');
  assert.equal(plan.create.chapter.variant, 'gomoku');
  const chapters = chaptersOf(plan);
  assert.equal(chapters.length, pool.openings.length);
  for (const [index, opening] of pool.openings.entries()) {
    const chapter = chapters[index];
    const classic = opening.classicId ? ` · ${opening.classicId.replaceAll('-', ' ')}` : '';
    assert.equal(chapter.name, `${opening.id}${classic}`);
    if (index > 0) assert.equal(chapter.op, 'add');
    const parsed = parseGomokuFen(chapter.tree.rootFen);
    assert.equal(parsed.ok, true, `${opening.id}: ${parsed.error}`);
    assert.deepEqual(sortedStones(parsed.state.opening.stones), sortedStones(opening.stones));
    assert.equal(parsed.state.status.turn, opening.turn, opening.id);
    assert.equal(gomokuFen(parsed.state), chapter.tree.rootFen, opening.id);
    assert.equal(chapter.tree.version, 1);
    assert.deepEqual(chapter.tree.root.children, []);
    const side = opening.turn === 'black' ? 'Black' : 'White';
    const comment = chapter.tree.root.annotations.comments[0].text;
    assert.ok(comment.includes(`${side} to move`), opening.id);
    assert.ok(comment.includes(`${(opening.screening.winrate * 100).toFixed(2)}%`), opening.id);
    assert.ok(comment.includes(`side-to-move perspective: ${side}`), opening.id);
  }
  // These mined deals deliberately break empty-board parity: never infer turn from counts.
  assert.ok(pool.openings.some((o) => o.turn === 'black' && o.stones.length === 5));
  assert.throws(() => buildGomokuOpeningsPlan({ ...pool, openings: [] }), /empty/i);
});

test('the editor accepts the create and every add without changing their canonical roots', () => {
  const plan = buildGomokuOpeningsPlan(pool);
  const { study, lines } = editor.checkCreate(plan.create);
  assert.equal(lines.length, 1);
  assert.equal(editor.checkPlan(study, plan).length, pool.openings.length - 1);
  for (const chapter of chaptersOf(plan)) {
    assert.deepEqual(ensureDealtRoot('gomoku', chapter.tree), chapter.tree);
  }
});

test('the CLI writes only a deterministic plan, reports its path and loads through the editor', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gomoku-openings-plan-'));
  try {
    const path = join(dir, 'openings.json');
    const script = fileURLToPath(new URL('./gomoku-openings-study-plan.mjs', import.meta.url));
    const stdout = execFileSync(process.execPath, [script, '--out', path], {
      cwd: dir,
      encoding: 'utf8',
    });
    assert.ok(stdout.includes(`${pool.openings.length} chapters in 1 study`));
    assert.ok(stdout.includes(path));
    assert.deepEqual(readdirSync(dir), ['openings.json']);
    const first = readFileSync(path, 'utf8');
    assert.deepEqual(editor.readPlan(path), buildGomokuOpeningsPlan(pool));
    execFileSync(process.execPath, [script, '--out', path], { cwd: dir });
    assert.equal(readFileSync(path, 'utf8'), first);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
