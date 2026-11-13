import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runBroadcastPushSim } from './broadcast-push-sim.mjs';

async function setup(t) {
  const dir = await mkdtemp(join(tmpdir(), 'mbpush-sim-'));
  t.after(() => rm(dir, { force: true, recursive: true }));
  const credential = `mbpush_${randomBytes(32).toString('base64url')}`;
  const tokenFile = join(dir, 'token');
  await writeFile(tokenFile, credential, { mode: 0o600 });
  const posts = [];
  const lines = [];
  const waits = [];
  const responses = [];
  const deps = {
    log: (line) => lines.push(line),
    sleep: async (ms) => waits.push(ms),
    fetch: async (_url, init) => {
      assert.equal(
        init.headers.Authorization === `Bearer ${credential}`,
        true,
        'authorization must use the file',
      );
      const body = JSON.parse(init.body);
      posts.push(body);
      const next = responses.shift();
      if (next instanceof Error) throw next;
      return (
        next ??
        new Response(
          JSON.stringify({ ok: true, changed: true, game: { plies: body.moves.length } }),
          { status: 200 },
        )
      );
    },
  };
  return { dir, tokenFile, posts, lines, waits, responses, deps, credential };
}

test('simulator replays whole canonical game with growing seq, players and final PGN result', async (t) => {
  const h = await setup(t);
  const pgn = join(h.dir, 'game.pgn');
  await writeFile(pgn, '[Red "R"]\n[Black "B"]\n[Result "1-0"]\n\n1. h2e2 h9g7 1-0');
  await runBroadcastPushSim(
    [
      '--token-file',
      h.tokenFile,
      '--pgn',
      pgn,
      '--round',
      '3',
      '--board',
      '12',
      '--interval-ms',
      '2000',
    ],
    h.deps,
  );
  assert.deepEqual(
    h.posts.map((p) => p.moves.length),
    [1, 2, 2],
  );
  assert.deepEqual(
    h.posts.map((p) => p.seq),
    [1, 2, 3],
  );
  assert.equal(h.posts[0].red.name, 'R');
  assert.equal(h.posts[0].round, 3);
  assert.equal(h.posts[0].board, 12);
  assert.equal(h.posts[2].status, 'finished');
  assert.equal(h.posts[2].result, '1-0');
  assert.equal(h.lines.length, 3);
  assert.equal(h.lines.join('').includes(h.credential), false, 'token absent from client logs');
  assert.deepEqual(h.waits, [2000, 2000]);
});

test('simulator retries 429, network and 5xx, then sends latest snapshot; other 4xx stop safely', async (t) => {
  const h = await setup(t);
  h.responses.push(
    new Response('{}', { status: 429, headers: { 'Retry-After': '2' } }),
    new Error(h.credential),
    new Response('{}', { status: 503 }),
  );
  await runBroadcastPushSim(
    [
      '--token-file',
      h.tokenFile,
      '--moves',
      'h2e2',
      '--red',
      'R',
      '--black',
      'B',
      '--interval-ms',
      '500',
    ],
    h.deps,
  );
  assert.deepEqual(
    h.posts.slice(0, 4).map((p) => p.seq),
    [1, 1, 1, 1],
  );
  assert.deepEqual(h.waits.slice(0, 3), [2000, 1000, 2000]);
  const fail = await setup(t);
  fail.responses.push(new Response(fail.credential, { status: 401 }));
  await assert.rejects(
    runBroadcastPushSim(
      ['--token-file', fail.tokenFile, '--moves', 'h2e2', '--red', 'R', '--black', 'B'],
      fail.deps,
    ),
    { message: 'Push failed: HTTP 401.' },
  );
  assert.equal(fail.posts.length, 1);
  assert.equal(fail.lines.join('').includes(fail.credential), false);
});

test('simulator names the API error code and ply, never a body or a hostile code', async (t) => {
  const args = (h) => [
    '--token-file',
    h.tokenFile,
    '--moves',
    'h2e2',
    '--red',
    'R',
    '--black',
    'B',
  ];
  const coded = await setup(t);
  coded.responses.push(
    Response.json(
      { ok: false, error: 'illegal_move', ply: 3, message: coded.credential },
      { status: 422 },
    ),
  );
  await assert.rejects(runBroadcastPushSim(args(coded), coded.deps), {
    message: 'Push failed: HTTP 422 illegal_move at ply 3.',
  });
  const hostile = await setup(t);
  hostile.responses.push(Response.json({ ok: false, error: hostile.credential }, { status: 400 }));
  await assert.rejects(runBroadcastPushSim(args(hostile), hostile.deps), {
    message: 'Push failed: HTTP 400.',
  });
});

test('simulator says which move of the input it could not read', async () => {
  await assert.rejects(
    runBroadcastPushSim(['--token-file', 'unused', '--pgn', '/dev/null'], {}),
    /readable game/,
  );
  await assert.rejects(
    runBroadcastPushSim(
      [
        '--token-file',
        'unused',
        '--moves',
        'h2e2 a0a5',
        '--notation',
        'iccs',
        '--red',
        'R',
        '--black',
        'B',
      ],
      {},
    ),
    /readable game from the standard opening: .*a0a5/,
  );
});

test('simulator reads WXF and Chinese, forces notation, accepts named rounds and rejects unsafe input', async (t) => {
  for (const [notation, moves] of [
    ['wxf', 'C2.5 H8+7'],
    ['chinese', '炮二平五 马8进7'],
  ]) {
    const h = await setup(t);
    await runBroadcastPushSim(
      [
        '--token-file',
        h.tokenFile,
        '--moves',
        moves,
        '--notation',
        notation,
        '--round',
        'women-r3',
        '--red',
        'R',
        '--black',
        'B',
      ],
      h.deps,
    );
    assert.equal(h.posts[0].notation, notation);
    assert.equal(h.posts[0].round, 'women-r3');
    assert.equal(h.posts.at(-1).moves.length, 2);
  }
  const h = await setup(t);
  for (const args of [
    [],
    ['--moves', 'h2e2', '--interval-ms', '-1'],
    ['--moves', 'h2e2', '--board', '0'],
    ['--moves', 'garbage'],
  ]) {
    await assert.rejects(runBroadcastPushSim(['--token-file', h.tokenFile, ...args], h.deps));
  }
  assert.equal(h.posts.length, 0);
});
