import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { assertLocalDatabase, runKit } from './player-kit.mjs';

const dbUrl = 'postgres://mistboard:mistboard@localhost:5435/mistboard_test';
const fixture = {
  player: { slug: 'fixture-player', name: 'Fixture Player', nameEn: 'Fixture Player' },
  names: { 'Fixture Player': 'Fixture Player', 'Fixture Opponent': 'Fixture Opponent' },
  boards: [
    {
      boardId: 'draw',
      level: 'A',
      result: '1/2-1/2',
      outcome: 'draw',
      plyCount: 2,
      moves: [
        { from: 'a4', to: 'a5' },
        { from: 'a7', to: 'a6' },
      ],
    },
    {
      boardId: 'win',
      level: 'A',
      result: '1-0',
      outcome: 'win',
      plyCount: 2,
      moves: [
        { from: 'a4', to: 'a5' },
        { from: 'a7', to: 'a6' },
      ],
    },
    { boardId: 'live', level: 'A', result: '*', outcome: 'win', moves: [] },
    { boardId: 'lower', level: 'B', result: '1-0', outcome: 'win', moves: [] },
    { boardId: 'missing', level: 'A', result: '1-0', outcome: 'loss', moves: [] },
  ],
};

async function setup(t) {
  const root = await mkdtemp(join(tmpdir(), 'mistboard-kit-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  let published = 0;
  const prepared = [];
  const services = {
    loadPlayer: async () => structuredClone(fixture),
    engine: async () => ({ pin: 'fixture-pin', binarySha256: 'fixture-hash' }),
    prepareGame: async (board) => {
      prepared.push(board.boardId);
      return {
        annotation: { game: { key: board.boardId }, rows: [{ uci: 'a3a4' }] },
        puzzles: [{ id: `p-${board.boardId}`, variant: 'xiangqi', tags: [] }],
      };
    },
    buildStudy: async ({ boards }) => ({
      create: { name: 'Fixture study', chapter: { name: boards[0].boardId } },
      ops: boards.slice(1).map((b) => ({ op: 'add', name: b.boardId })),
    }),
    publish: async ({ puzzles, plan }) => {
      published += 1;
      return {
        studyId: 'local-study',
        puzzleIds: puzzles.map((p) => p.id),
        chapters: plan.ops.length + 1,
      };
    },
  };
  return {
    root,
    services,
    prepared,
    published: () => published,
    dir: join(root, 'docs-private/players/kits/fixture-player'),
  };
}

test('default and explicit dry runs rank only finished A games, tag candidates, and never publish', async (t) => {
  const ctx = await setup(t);
  for (const dryRun of [undefined, true]) {
    const manifest = await runKit(
      { slug: 'fixture-player', dbUrl, root: ctx.root, dryRun },
      ctx.services,
    );
    assert.equal(manifest.version, 1);
    assert.equal(manifest.playerPage.path, '/players/fixture-player');
    assert.equal(manifest.playerPage.resolved, true);
    assert.deepEqual(
      manifest.candidates.map((c) => c.boardId),
      ['win', 'draw'],
    );
    assert.ok(manifest.candidates.every((c) => c.reasons.length && c.rank > 0));
    assert.deepEqual(manifest.selection, { boardIds: [], puzzleIds: [] });
    assert.ok(manifest.missing.some((item) => item.boardId === 'missing'));
    const puzzles = JSON.parse(await readFile(join(ctx.dir, 'candidate-puzzles.json'), 'utf8'));
    assert.ok(puzzles.every((p) => p.tags.includes('player:fixture-player')));
    assert.ok(JSON.parse(await readFile(join(ctx.dir, 'study-draft.json'), 'utf8')).create);
    assert.deepEqual(await readdir(ctx.root), ['docs-private']);
    assert.equal(ctx.published(), 0);
  }
});

test('missing player and name coverage are reported without invented games', async (t) => {
  const ctx = await setup(t);
  ctx.services.loadPlayer = async () => ({ player: null, names: {}, boards: [] });
  const manifest = await runKit({ slug: 'fixture-player', dbUrl, root: ctx.root }, ctx.services);
  assert.equal(manifest.playerPage.resolved, false);
  assert.ok(manifest.missing.some((item) => item.kind === 'player'));
  assert.deepEqual(ctx.prepared, []);
  assert.equal(JSON.parse(await readFile(join(ctx.dir, 'study-draft.json'), 'utf8')).create, null);
  ctx.services.loadPlayer = async () => ({ ...structuredClone(fixture), names: {} });
  const second = await runKit({ slug: 'fixture-player', dbUrl, root: ctx.root }, ctx.services);
  assert.ok(second.missing.some((item) => item.kind === 'name-map'));
});

test('local target enforcement rejects remote URLs and connection overrides before any work', async (t) => {
  const ctx = await setup(t);
  for (const url of [
    'postgres://db.example/mistboard',
    'postgres://localhost.evil/mistboard',
    'postgres://localhost/mistboard?host=db.example',
    'postgres://localhost/mistboard?hostaddr=8.8.8.8',
    'postgres://localhost/mistboard?options=-c%20search_path=public',
    'https://localhost/mistboard',
    'not-a-url',
  ]) {
    assert.throws(() => assertLocalDatabase(url), /local PostgreSQL/);
    await assert.rejects(
      runKit({ slug: 'fixture-player', root: ctx.root, dbUrl: url, apply: true }, ctx.services),
      /local PostgreSQL/,
    );
  }
  for (const url of [dbUrl, 'postgresql://127.0.0.1/test', 'postgres://[::1]/test'])
    assertLocalDatabase(url);
  assert.deepEqual(await readdir(ctx.root), []);
});

test('apply requires explicit selections, publishes only reviewed candidates, and records a receipt', async (t) => {
  const ctx = await setup(t);
  const options = { slug: 'fixture-player', dbUrl, root: ctx.root };
  await runKit(options, ctx.services);
  await assert.rejects(runKit({ ...options, apply: true }, ctx.services), /select/i);
  const selection = join(ctx.dir, 'selection.json');
  await writeFile(selection, JSON.stringify({ boardIds: ['win'], puzzleIds: ['p-win'] }));
  ctx.services.publish = async ({ puzzles, plan }) => {
    assert.deepEqual(
      puzzles.map((p) => p.id),
      ['p-win'],
    );
    assert.equal(plan.create.chapter.name, 'win');
    assert.deepEqual(plan.ops, []);
    return { studyId: 'local-study', puzzleIds: ['p-win'] };
  };
  const receipt = await runKit({ ...options, apply: true }, ctx.services);
  assert.equal(receipt.studyId, 'local-study');
  ctx.services.publish = async () => assert.fail('a repeated apply must not publish twice');
  assert.deepEqual(await runKit({ ...options, apply: true }, ctx.services), receipt);
});

test('apply rejects unknown selections and artifacts changed after the dry run', async (t) => {
  const ctx = await setup(t);
  const options = { slug: 'fixture-player', dbUrl, root: ctx.root };
  await runKit(options, ctx.services);
  await writeFile(
    join(ctx.dir, 'selection.json'),
    JSON.stringify({ boardIds: ['live'], puzzleIds: [] }),
  );
  await assert.rejects(runKit({ ...options, apply: true }, ctx.services), /candidate/);
  await writeFile(
    join(ctx.dir, 'selection.json'),
    JSON.stringify({ boardIds: ['win'], puzzleIds: [] }),
  );
  await writeFile(join(ctx.dir, 'candidate-puzzles.json'), '[]');
  await assert.rejects(runKit({ ...options, apply: true }, ctx.services), /changed/);
  assert.equal(ctx.published(), 0);
});

test('bounds serial preview work and reports failed preparation', async (t) => {
  const ctx = await setup(t);
  ctx.services.prepareGame = async () => {
    throw new Error('fixture engine unavailable');
  };
  const manifest = await runKit(
    { slug: 'fixture-player', dbUrl, root: ctx.root, maxGames: 1 },
    ctx.services,
  );
  assert.equal(manifest.candidates.filter((c) => c.preview).length, 0);
  assert.ok(manifest.missing.some((item) => item.kind === 'preparation'));
  await assert.rejects(runKit({ slug: '../escape', dbUrl, root: ctx.root }, ctx.services), /slug/);
  await assert.rejects(
    runKit({ slug: 'fixture-player', dbUrl, root: ctx.root, maxGames: 100 }, ctx.services),
    /maxGames/,
  );
});

test('editor can preview a different ranked game without finalizing the selection', async (t) => {
  const ctx = await setup(t);
  const manifest = await runKit(
    { slug: 'fixture-player', dbUrl, root: ctx.root, maxGames: 1, boardIds: ['draw'] },
    ctx.services,
  );
  assert.deepEqual(ctx.prepared, ['draw']);
  assert.equal(manifest.candidates.find((c) => c.boardId === 'draw').preview, true);
  assert.deepEqual(manifest.selection, { boardIds: [], puzzleIds: [] });
  await assert.rejects(
    runKit({ slug: 'fixture-player', dbUrl, root: ctx.root, boardIds: ['live'] }, ctx.services),
    /eligible candidate/,
  );
});

test('unavailable pinned engine still writes an honest manifest and empty drafts', async (t) => {
  const ctx = await setup(t);
  ctx.services.engine = async () => {
    throw new Error('no local binary');
  };
  const manifest = await runKit({ slug: 'fixture-player', dbUrl, root: ctx.root }, ctx.services);
  assert.ok(manifest.missing.some((m) => m.kind === 'engine'));
  assert.equal(manifest.engine, null);
  assert.deepEqual(ctx.prepared, []);
  assert.deepEqual(JSON.parse(await readFile(join(ctx.dir, 'candidate-puzzles.json'), 'utf8')), []);
});

test('prepares each preview serially', async (t) => {
  const ctx = await setup(t);
  const prepare = ctx.services.prepareGame;
  let active = 0;
  ctx.services.prepareGame = async (board) => {
    active += 1;
    assert.equal(active, 1);
    await new Promise((resolve) => setImmediate(resolve));
    const result = await prepare(board);
    active -= 1;
    return result;
  };
  await runKit({ slug: 'fixture-player', dbUrl, root: ctx.root }, ctx.services);
  assert.deepEqual(ctx.prepared, ['win', 'draw']);
});
