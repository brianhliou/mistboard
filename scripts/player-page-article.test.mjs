import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { articleAnalysisKey } from '../apps/web/src/article-analysis-key.js';

const SCRIPT = new URL('./player-page-article.mjs', import.meta.url).pathname;

function build(frontMatter) {
  const dir = mkdtempSync(join(tmpdir(), 'player-page-article-'));
  try {
    const draft = join(dir, 'draft.md');
    writeFileSync(
      draft,
      `---\nslug: test-player\nexport: testPlayerArticle\ntitle: Test Player\nsummary: A test page.\naudience: Tests.\nstatus: published\n${frontMatter}\n---\n\nAn intro paragraph.\n\n## Games\n\nA body paragraph.\n`,
    );
    return spawnSync(process.execPath, [SCRIPT, draft], { encoding: 'utf8' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('the generated article carries the draft updateNote after updatedAt', () => {
  // Regenerating lai-ly-huynh.ts from its draft dropped the note, and the
  // article test fails an updated page without one.
  const result = build(
    'publishedAt: 2026-10-02\nupdatedAt: 2026-10-26\nupdateNote: Added a link to the "match" in the archive.',
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(
    result.stdout,
    / {2}updatedAt: "2026-10-26",\n {2}updateNote: "Added a link to the \\"match\\" in the archive.",\n/,
  );
});

test('a draft updated after publication with no updateNote refuses to build', () => {
  const result = build('publishedAt: 2026-10-02\nupdatedAt: 2026-10-26');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /add an updateNote line/);
});

test('a draft never updated needs no updateNote', () => {
  const result = build('publishedAt: 2026-10-02');
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /updateNote/);
});

function chartBuild(change = (a) => a) {
  const dir = mkdtempSync(join(tmpdir(), 'player-page-chart-'));
  const player = join(dir, 'player');
  mkdirSync(join(player, 'specs'), { recursive: true });
  mkdirSync(join(player, 'annot1m'));
  mkdirSync(join(dir, 'content'));
  const spec = {
    iccs: 'h2e2 h9g7',
    red: 'Red',
    black: 'Black',
    event: 'Synthetic',
    resultText: '1-0',
    annotations: { byPly: {} },
  };
  const site = {
    engineId: 'pikafish-xiangqi-analysis@5',
    depth: 12,
    plies: [
      { ply: 0, cp: 24, mate: null, best: 'h3e3' },
      { ply: 1, cp: -53, mate: null, best: 'h10g8' },
      { ply: 2, cp: null, mate: 5, best: null },
    ],
  };
  writeFileSync(join(player, 'specs', 'fixture.json'), JSON.stringify(spec));
  writeFileSync(
    join(player, 'annot1m', 'fixture.json'),
    JSON.stringify(
      change({ game: { date: '2026-01-01' }, rows: [{ uci: 'h2e2' }, { uci: 'h9g7' }], site }),
    ),
  );
  const draft = join(player, 'draft.md');
  writeFileSync(
    draft,
    '---\nslug: test-player\nexport: testPlayerArticle\ntitle: Test Player\nsummary: Test\naudience: Test\nplayer: Red\nstatus: draft\n---\n\nIntro.\n\n## Game\n\n[board key=fixture ply=0]\n',
  );
  const args = [
    SCRIPT,
    draft,
    '--out',
    join(dir, 'content', 'test-player.ts'),
    '--preview',
    '--no-measure',
  ];
  return { dir, site, run: () => spawnSync(process.execPath, args, { encoding: 'utf8' }) };
}
test('generating an article automatically prepares exact stored site analysis and keeps it on regeneration', () => {
  const f = chartBuild();
  try {
    const run = f.run();
    assert.equal(run.status, 0, run.stderr);
    const files = readdirSync(join(f.dir, 'analysis'));
    assert.equal(files.length, 1);
    assert.match(files[0], /^[0-9a-f]{14}\.json$/);
    const first = readFileSync(join(f.dir, 'analysis', files[0]), 'utf8');
    assert.deepEqual(JSON.parse(first).plies, f.site.plies);
    assert.equal(JSON.parse(first).engineId, f.site.engineId);
    assert.equal(f.run().status, 0);
    assert.equal(readFileSync(join(f.dir, 'analysis', files[0]), 'utf8'), first);
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});
test('automatic charts reject stale moves, wrong engine, missing/duplicate plies and malformed evals without computing replacements', () => {
  const mutations = [
    (a) => ({ ...a, rows: [{ uci: 'a0a1' }, a.rows[1]] }),
    (a) => ({ ...a, site: { ...a.site, engineId: 'different-engine' } }),
    (a) => ({ ...a, site: { ...a.site, plies: a.site.plies.slice(1) } }),
    (a) => ({
      ...a,
      site: { ...a.site, plies: [a.site.plies[0], a.site.plies[0], a.site.plies[2]] },
    }),
    (a) => ({
      ...a,
      site: { ...a.site, plies: a.site.plies.map((p) => ({ ...p, cp: 'invalid' })) },
    }),
  ];
  for (const mutate of mutations) {
    const f = chartBuild(mutate);
    try {
      const run = f.run();
      assert.notEqual(run.status, 0, 'invalid chart unexpectedly accepted');
      assert.match(run.stderr, /chart|analysis/i);
    } finally {
      rmSync(f.dir, { recursive: true, force: true });
    }
  }
});

test('source game metadata overrides older annotation fields and survives regeneration', () => {
  const f = chartBuild();
  try {
    const player = join(f.dir, 'player');
    mkdirSync(join(player, 'games'));
    writeFileSync(
      join(player, 'games', 'fixture.json'),
      JSON.stringify({
        key: 'fixture',
        date: '2026-02-03 09:00',
        round: 'Round 7',
        timeControl: '5分＋3秒',
        sourceUrl: 'http://www.dpxq.com/hldcg/search/view_m_143873.html',
        moves: [
          { from: 'h3', to: 'e3' },
          { from: 'h10', to: 'g8' },
        ],
      }),
    );
    const run = f.run();
    assert.equal(run.status, 0, run.stderr);
    const path = join(f.dir, 'content', 'test-player.ts');
    const first = readFileSync(path, 'utf8');
    assert.match(first, /"date": "2026-02-03 09:00"/);
    assert.match(first, /"timeControl": "5分＋3秒"/);
    assert.match(first, /"round": "Round 7"/);
    assert.equal(f.run().status, 0);
    assert.equal(readFileSync(path, 'utf8'), first);
    writeFileSync(
      join(player, 'games', 'fixture.json'),
      JSON.stringify({ key: 'wrong', date: '2026-02-03' }),
    );
    assert.notEqual(f.run().status, 0);
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});
function embedBuild(directive) {
  const dir = mkdtempSync(join(tmpdir(), 'player-page-embed-'));
  try {
    const path = join(dir, 'draft.md');
    writeFileSync(
      path,
      `---\nslug: test\nexport: testArticle\ntitle: Test\nsummary: Test\naudience: Test\nstatus: draft\n---\n\nIntro.\n\n## Exercise\n\n${directive}\n`,
    );
    return spawnSync(process.execPath, [SCRIPT, path, '--preview'], { encoding: 'utf8' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
test('embed directives preserve a relative line path and explicit solution booleans', () => {
  for (const [raw, expected] of [
    ['1', true],
    ['true', true],
    ['0', false],
    ['false', false],
  ]) {
    const result = embedBuild(
      `[embed path="/embed/line/xiangqi?moves=h3e3&fen=test" title="Find Meng’s reply" hideSolution=${raw}] Try the position.`,
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /kind: 'embed'/);
    assert.ok(result.stdout.includes(`hideSolution: ${expected}`));
    assert.ok(result.stdout.includes('Find Meng’s reply'));
    assert.ok(result.stdout.includes('Try the position.'));
  }
});
test('embed directives reject external URLs, encoded paths, fragments and ambiguous booleans', () => {
  for (const path of [
    'https://evil.test/embed/line/xiangqi?moves=h3e3',
    '//evil.test/embed/line/xiangqi?moves=h3e3',
    '/embed/line/jieqi?moves=h3e3',
    '/embed/line/xiangqi?moves=h3e3#fragment',
    '/embed/line/xiangqi/../xiangqi?moves=h3e3',
    '/embed/line/%78iangqi?moves=h3e3',
  ]) {
    const result = embedBuild(`[embed path="${path}" title="Test" hideSolution=1]`);
    assert.notEqual(result.status, 0, path);
  }
  for (const value of ['yes', '2', '', 'TRUE']) {
    const result = embedBuild(
      `[embed path="/embed/line/xiangqi?moves=h3e3" title="Test" hideSolution="${value}"]`,
    );
    assert.notEqual(result.status, 0, value);
  }
});

test('a decision exercise may keep a thumbnail from its source game without embedding another replay', () => {
  const f = chartBuild();
  try {
    const path = join(f.dir, 'player', 'draft.md');
    const text = readFileSync(path, 'utf8')
      .replace(
        'status: draft',
        'status: draft\nthumbnailBoard: fixture ply=1 half=bottom\nthumbnailAlt: A recorded decision',
      )
      .replace(
        '[board key=fixture ply=0]',
        '[embed path="/embed/line/xiangqi?moves=h3e3" title="Find the move" hideSolution=1] Try this.',
      );
    writeFileSync(path, text);
    const result = f.run();
    assert.equal(result.status, 0, result.stderr);
    const module = readFileSync(join(f.dir, 'content', 'test-player.ts'), 'utf8');
    assert.match(module, /const THUMBNAIL_GAME_RECORD/);
    assert.match(module, /kind: 'svg'/);
    assert.doesNotMatch(module, /kind: 'xq-replay'/);
    assert.match(module, /kind: 'embed'/);
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});

function makeDeepFixture(f, mutate = (a) => a) {
  const player = join(f.dir, 'player');
  const specPath = join(player, 'specs', 'fixture.json');
  const spec = {
    ...JSON.parse(readFileSync(specPath, 'utf8')),
    analysisNodes: 10_000_000,
    boardId: 'synthetic-archive-game',
  };
  writeFileSync(specPath, JSON.stringify(spec));
  mkdirSync(join(player, 'annot10m'), { recursive: true });
  const deep = mutate({
    game: { date: '2026-01-01' },
    engine: { nodes: 10_000_000 },
    initial: { cp: 91, mate: null },
    rows: [
      { ply: 1, uci: 'h2e2', best: 'b2e2', cp: 333, mate: null },
      { ply: 2, uci: 'h9g7', best: 'b7c7', cp: -444, mate: null },
    ],
    site: f.site,
  });
  writeFileSync(join(player, 'annot10m', 'fixture.json'), JSON.stringify(deep));
  return { spec, deep };
}
test('deep generation uses its actual evaluations with a different key, never the cached 1M site series', () => {
  const f = chartBuild();
  try {
    assert.equal(f.run().status, 0);
    const { spec } = makeDeepFixture(f);
    const run = f.run();
    assert.equal(run.status, 0, run.stderr);
    const deepPath = join(f.dir, 'analysis', `${articleAnalysisKey(spec)}.json`);
    const first = readFileSync(deepPath, 'utf8');
    const result = JSON.parse(first);
    assert.equal(result.engineId, 'pikafish-xiangqi-analysis@5:nodes=10000000');
    assert.equal(result.nodes, 10_000_000);
    assert.equal(result.depth, 0);
    assert.doesNotMatch(
      readFileSync(join(f.dir, 'content', 'test-player.ts'), 'utf8'),
      /"boardId"/,
    );
    assert.deepEqual(result.plies, [
      { ply: 0, cp: 91, mate: null, best: 'b3e3' },
      { ply: 1, cp: 333, mate: null, best: 'b8c8' },
      { ply: 2, cp: -444, mate: null, best: null },
    ]);
    assert.equal(readdirSync(join(f.dir, 'analysis')).length, 2);
    assert.equal(f.run().status, 0);
    assert.equal(readFileSync(deepPath, 'utf8'), first);
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});
test('deep generation fails when deep data is absent, despite a valid stored 1M graph', () => {
  const f = chartBuild();
  try {
    assert.equal(f.run().status, 0);
    const path = join(f.dir, 'player', 'specs', 'fixture.json');
    writeFileSync(
      path,
      JSON.stringify({ ...JSON.parse(readFileSync(path, 'utf8')), analysisNodes: 10_000_000 }),
    );
    const result = f.run();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /10M|10000000|annot10m/);
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});
test('deep generation rejects missing initial scores, mismatched budgets/plies/moves and malformed evaluations', () => {
  const mutations = [
    (a) => ({ ...a, initial: undefined }),
    (a) => ({ ...a, engine: { nodes: 1_000_000 } }),
    (a) => ({ ...a, rows: a.rows.slice(1) }),
    (a) => ({ ...a, rows: [a.rows[0], { ...a.rows[1], ply: 1 }] }),
    (a) => ({ ...a, rows: [{ ...a.rows[0], uci: 'a0a1' }, a.rows[1]] }),
    (a) => ({ ...a, initial: { cp: 'not-a-score', mate: null } }),
    (a) => ({ ...a, rows: [a.rows[0], { ...a.rows[1], cp: null, mate: null }] }),
    (a) => ({ ...a, rows: [{ ...a.rows[0], best: 'b3e3bad' }, a.rows[1]] }),
  ];
  for (const mutation of mutations) {
    const f = chartBuild();
    try {
      makeDeepFixture(f, mutation);
      const result = f.run();
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /chart|analysis/);
    } finally {
      rmSync(f.dir, { recursive: true, force: true });
    }
  }
});
