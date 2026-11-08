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
    findMoments: async () => [],
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
    assert.deepEqual(manifest.selection, { boardIds: [], puzzleIds: [], momentIds: [] });
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
  assert.deepEqual(manifest.selection, { boardIds: [], puzzleIds: [], momentIds: [] });
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

const momentMoves = [
  'a3a4',
  'a6a5',
  'c3c4',
  'c6c5',
  'e3e4',
  'e6e5',
  'g3g4',
  'g6g5',
  'i3i4',
  'i6i5',
  'b0c2',
  'b9c7',
  'h0g2',
  'h9g7',
  'a0a1',
  'a9a8',
];
const momentBoard = (boardId = 'moment-game') => ({
  ...fixture.boards[0],
  boardId,
  colour: 'red',
  roundNameEn: 'Round 4',
  red: { name: 'Fixture Player' },
  black: { name: 'Fixture Opponent' },
  moves: momentMoves.map((uci) => ({
    from: `${uci[0]}${Number(uci[1]) + 1}`,
    to: `${uci[2]}${Number(uci[3]) + 1}`,
  })),
  plyCount: momentMoves.length,
});
const momentRow = (ply, extra = {}) => ({
  ply,
  side: ply % 2 ? 'red' : 'black',
  uci: momentMoves[ply - 1],
  best: { 10: 'b9c7', 11: 'h0g2', 12: 'h9g7' }[ply] ?? 'a0a1',
  lost: 18,
  winBefore: 50,
  ...extra,
});
const scoredLines = (ply, secondCp = 0) => [
  {
    rank: 1,
    score: { cp: 150, mate: null },
    pvUci: {
      11: ['b0c2', 'b9c7', 'h0g2'],
      12: ['b9c7', 'h0g2'],
      13: ['h0g2', 'h9g7'],
      15: ['a0a1', 'a9a8'],
    }[ply],
  },
  {
    rank: 2,
    score: { cp: secondCp, mate: null },
    pvUci: [{ 11: 'h0g2', 12: 'h9g7', 13: 'a0a1', 15: 'i0i1' }[ply]],
  },
];

async function momentSetup(t, rows = [momentRow(10)], board = momentBoard()) {
  const ctx = await setup(t);
  const { findCriticalMoments } = await import('./lib/player-kit-moments.mjs');
  ctx.services.loadPlayer = async () => ({ ...fixture, boards: [board] });
  ctx.services.prepareGame = async (board) => ({
    annotation: { game: { key: board.boardId }, rows },
    puzzles: [],
  });
  ctx.services.findMoments = (args) =>
    findCriticalMoments({
      ...args,
      analyzeMoves: async (moves, limits, multipv) => {
        assert.deepEqual(limits, {
          nodes: args.budgets.verifyNodes,
          depth: args.budgets.verifyDepth,
        });
        assert.equal(multipv, 2);
        assert.deepEqual(moves, momentMoves.slice(0, moves.length));
        return scoredLines(moves.length + 1);
      },
    });
  return ctx;
}

test('critical moments require a meaningful loss, a unique answer, and an undecided position', async (t) => {
  const ctx = await momentSetup(t, [
    momentRow(10),
    momentRow(11),
    momentRow(12, { lost: 9.9 }),
    momentRow(14, { winBefore: 86 }),
    momentRow(12, { winBefore: 14 }),
    momentRow(8),
    momentRow(12, { best: momentMoves[11] }),
  ]);
  const manifest = await runKit({ slug: 'fixture-player', dbUrl, root: ctx.root }, ctx.services);
  assert.equal(manifest.moments.length, 1);
  const moment = manifest.moments[0];
  assert.equal(moment.boardId, 'moment-game');
  assert.equal(moment.ply, 11);
  assert.equal(moment.side, 'red');
  assert.equal(moment.best, 'b0c2');
  assert.equal(moment.played, 'b0c2');
  assert.ok(moment.gap >= 8);
  assert.ok(manifest.missing.some((m) => m.kind === 'moments'));
  assert.deepEqual(manifest.selection.momentIds, []);
  const plan = JSON.parse(await readFile(join(ctx.dir, 'study-draft.json'), 'utf8'));
  const chapter = plan.ops.at(-1);
  assert.equal(chapter.gamebook, true);
  assert.equal(chapter.orientation, 'red');
  assert.equal(chapter.name, 'Moment 1 · Round 4 · Red to play');
  assert.equal(chapter.tags.ply, '11');
  assert.equal(chapter.tags.black, 'Fixture Opponent');
  assert.match(chapter.tree.rootFen, / w - - \d+ 6$/);
  const root = chapter.tree.root;
  assert.equal(root.annotations.comments[0].text, 'Round 4: Fixture Opponent just played P9+1.');
  assert.doesNotMatch(root.annotations.comments[0].text, /to play|find|H8\+7/i);
  assert.equal(root.children.length, 1);
  const [best] = root.children;
  assert.equal(best.uci, 'b1c3');
  assert.equal(best.children[0].uci, 'b10c8');
  assert.deepEqual(best.children[0].children, []);
  assert.equal(
    best.annotations.comments[0].text,
    'After Fixture Opponent played P9+1, Fixture Player found H8+7. Pikafish continues H8+7 H2+3 H2+3.',
  );
  assert.doesNotMatch(JSON.stringify(chapter), /—|square|knight|bishop|pawn/i);
});

test('critical moments rank by loss, board id and ply, capped per game and overall', async () => {
  const { findCriticalMoments, MOMENT_RULES } = await import('./lib/player-kit-moments.mjs');
  const annotations = ['f', 'e', 'd', 'c', 'b', 'a'].map((id) => ({
    board: momentBoard(id),
    annotation: { rows: [momentRow(14), momentRow(12), momentRow(10)] },
  }));
  const args = {
    annotations,
    names: {},
    budgets: { verifyNodes: 123, verifyDepth: 20 },
    analyzeMoves: async (moves) => scoredLines(moves.length + 1),
  };
  const moments = await findCriticalMoments(args);
  assert.equal(moments.length, MOMENT_RULES.maxOverall);
  assert.deepEqual(
    moments.map((m) => [m.boardId, m.ply]),
    ['a', 'b', 'c', 'd', 'e'].flatMap((id) => [
      [id, 11],
      [id, 13],
    ]),
  );
  assert.ok(
    moments.every(
      (m) => moments.filter((n) => n.boardId === m.boardId).length <= MOMENT_RULES.maxPerGame,
    ),
  );
  assert.match(moments[0].chapter.tree.root.annotations.comments[0].text, /Black just played/);
  annotations[0].annotation.rows[0].lost = 30;
  assert.equal((await findCriticalMoments(args))[0].boardId, 'f');
});

test('apply excludes unselected moments and permits a selected moment with or without its game', async (t) => {
  for (const [selectMoment, selectGame] of [
    [false, true],
    [true, false],
    [true, true],
  ]) {
    const ctx = await momentSetup(t);
    const options = { slug: 'fixture-player', dbUrl, root: ctx.root };
    const manifest = await runKit(options, ctx.services);
    await writeFile(
      join(ctx.dir, 'selection.json'),
      JSON.stringify({
        boardIds: selectGame ? ['moment-game'] : [],
        puzzleIds: [],
        momentIds: selectMoment ? [manifest.moments[0].id] : [],
      }),
    );
    ctx.services.findMoments = async () => assert.fail('apply must use the reviewed analysis');
    ctx.services.publish = async ({ plan }) => {
      assert.equal(Boolean(plan.create.chapter.gamebook), selectMoment && !selectGame);
      assert.equal(plan.ops.length, Number(selectMoment && selectGame));
      if (selectMoment && selectGame) assert.equal(plan.ops[0].gamebook, true);
      return { studyId: 'local-study' };
    };
    const receipt = await runKit({ ...options, apply: true }, ctx.services);
    assert.deepEqual(await runKit({ ...options, apply: true }, ctx.services), receipt);
  }
});

test('moment selections reject unknown ids, duplicates, changed metadata and changed receipts', async (t) => {
  const ctx = await momentSetup(t);
  const options = { slug: 'fixture-player', dbUrl, root: ctx.root };
  const manifest = await runKit(options, ctx.services);
  const selectionPath = join(ctx.dir, 'selection.json');
  const id = manifest.moments[0].id;
  for (const [momentIds, error] of [
    [['unknown'], /candidate/],
    [[id, id], /duplicate/],
  ]) {
    await writeFile(selectionPath, JSON.stringify({ boardIds: [], puzzleIds: [], momentIds }));
    await assert.rejects(runKit({ ...options, apply: true }, ctx.services), error);
  }
  await writeFile(selectionPath, JSON.stringify({ boardIds: [], puzzleIds: [], momentIds: [id] }));
  ctx.services.publish = async () => ({ studyId: 'local-study' });
  await runKit({ ...options, apply: true }, ctx.services);
  await writeFile(
    selectionPath,
    JSON.stringify({ boardIds: ['moment-game'], puzzleIds: [], momentIds: [] }),
  );
  await assert.rejects(runKit({ ...options, apply: true }, ctx.services), /already applied/);
  manifest.moments[0].gap += 1;
  await writeFile(join(ctx.dir, 'manifest.json'), JSON.stringify(manifest));
  await assert.rejects(runKit({ ...options, apply: true }, ctx.services), /artifacts changed/);
});

test('critical moments accept the boundary rules and a one-ply engine line', async () => {
  const { findCriticalMoments } = await import('./lib/player-kit-moments.mjs');
  for (const winBefore of [15, 85]) {
    const moments = await findCriticalMoments({
      annotations: [
        { board: momentBoard(), annotation: { rows: [momentRow(10, { lost: 10, winBefore })] } },
      ],
      names: { 'Fixture Opponent': { en: 'Fixture Rival' } },
      budgets: { verifyNodes: 123, verifyDepth: 20 },
      analyzeMoves: async () => {
        const lines = scoredLines(11);
        lines[0].pvUci = ['b0c2'];
        return lines;
      },
    });
    assert.equal(moments.length, 1);
    assert.deepEqual(moments[0].chapter.tree.root.children[0].children, []);
    assert.match(
      moments[0].chapter.tree.root.annotations.comments[0].text,
      /Fixture Rival just played/,
    );
  }
});

test('a moment names its round from the board id when the record has no round tag', async (t) => {
  const board = {
    ...momentBoard('fixture-open-r06-r06t02'),
    roundNameEn: undefined,
    roundName: '',
  };
  const ctx = await momentSetup(t, [momentRow(10)], board);
  await runKit({ slug: 'fixture-player', dbUrl, root: ctx.root }, ctx.services);
  const plan = JSON.parse(await readFile(join(ctx.dir, 'study-draft.json'), 'utf8'));
  const chapter = plan.ops.at(-1);
  assert.equal(chapter.name, 'Moment 1 · Round 6 · Red to play');
  assert.equal(chapter.tags.round, '6');
});

test('moments keep only the kit player’s verified punishing replies', async (t) => {
  const { findCriticalMoments } = await import('./lib/player-kit-moments.mjs');
  for (const colour of ['red', 'black']) {
    const mistakePly = colour === 'red' ? 10 : 11;
    const board = { ...momentBoard(), colour };
    if (colour === 'black') [board.red, board.black] = [board.black, board.red];
    for (const outcome of ['punished', 'lesser reply', 'close gap', 'own mistake']) {
      await t.test(`${colour}: ${outcome}`, async () => {
        const row = momentRow(outcome === 'own mistake' ? mistakePly + 1 : mistakePly);
        let calls = 0;
        const moments = await findCriticalMoments({
          annotations: [{ board, annotation: { rows: [row] } }],
          names: fixture.names,
          budgets: { verifyNodes: 123, verifyDepth: 20 },
          analyzeMoves: async (moves, limits, multipv) => {
            calls += 1;
            assert.notEqual(outcome, 'own mistake', 'do not verify the player’s own mistakes');
            assert.deepEqual(moves, momentMoves.slice(0, mistakePly));
            assert.deepEqual(limits, { nodes: 123, depth: 20 });
            assert.equal(multipv, 2);
            const lines = scoredLines(mistakePly + 1, outcome === 'close gap' ? 145 : 0);
            if (outcome === 'lesser reply') {
              [lines[0].pvUci, lines[1].pvUci] = [lines[1].pvUci, lines[0].pvUci];
            }
            return lines;
          },
        });
        assert.equal(calls, outcome === 'own mistake' ? 0 : 1);
        assert.equal(moments.length, outcome === 'punished' ? 1 : 0);
        if (moments.length) {
          const [moment] = moments;
          assert.equal(moment.ply, mistakePly + 1);
          assert.equal(moment.side, colour);
          assert.equal(moment.played, momentMoves[mistakePly]);
          assert.equal(moment.best, moment.played);
          assert.equal(moment.chapter.orientation, colour);
          assert.match(moment.chapter.tree.rootFen, colour === 'red' ? / w / : / b /);
          assert.match(
            moment.chapter.tree.root.annotations.comments[0].text,
            /Fixture Opponent just played/,
          );
          assert.match(
            moment.chapter.tree.root.children[0].annotations.comments[0].text,
            /Fixture Player found/,
          );
        }
      });
    }
  }
});

test('moments skip an absent player seat or an opponent mistake with no recorded reply', async () => {
  const { findCriticalMoments } = await import('./lib/player-kit-moments.mjs');
  for (const [board, row] of [
    [{ ...momentBoard(), colour: undefined }, momentRow(10)],
    [momentBoard(), momentRow(momentMoves.length)],
  ]) {
    const moments = await findCriticalMoments({
      annotations: [{ board, annotation: { rows: [row] } }],
      names: {},
      budgets: { verifyNodes: 123, verifyDepth: 20 },
      analyzeMoves: async () => assert.fail('unusable positions must not reach the engine'),
    });
    assert.deepEqual(moments, []);
  }
});
