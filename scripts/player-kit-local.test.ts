import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { loadAllSeedPuzzles } from '@mistboard/game/puzzle-seed';
import pg from 'pg';
import { localKitServices, publishLocal } from './lib/player-kit-local.mjs';
import { findCriticalMoments } from './lib/player-kit-moments.mjs';
import { assertLocalDatabase, runKit } from './player-kit.mjs';

const dbUrl = process.env.TEST_DATABASE_URL;

test('local publisher rejects remote targets before opening any connection', async () => {
  await assert.rejects(
    publishLocal({ dbUrl: 'postgres://remote.example/test', plan: null, puzzles: [] }),
    /local PostgreSQL/,
  );
});

test('persistence teaching kit: seeded player discovery, dry-run isolation, tagged selected apply', {
  skip: !dbUrl,
}, async (t) => {
  assertLocalDatabase(dbUrl);
  const client = new pg.Client({ connectionString: dbUrl });
  await client.connect();
  const root = await mkdtemp(join(tmpdir(), 'mistboard-kit-db-'));
  const id = `kit-${randomUUID()}`;
  const red = { name: 'Fixture Player', nameEn: 'Fixture Player' };
  // No nameEn: a relayed Western name is stored in English already.
  const black = { name: 'Fixture Opponent' };
  const ucis = [
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
  ];
  const moves = ucis.map((uci) => ({
    from: `${uci[0]}${Number(uci[1]) + 1}`,
    to: `${uci[2]}${Number(uci[3]) + 1}`,
  }));
  const payload = {
    id,
    tourSlug: '2025-wxc-sample',
    roundId: id,
    sourceBoardId: id,
    boardNumber: 1,
    red,
    black,
    result: '1-0',
    status: 'complete',
    moves,
    sourceUrl: 'http://www.dpxq.com/hldcg/search/view_m_999999.html',
  };
  const studyIds: string[] = [];
  let ownerCreated = false;
  let tourCreated = false;
  t.after(async () => {
    for (const createdId of studyIds)
      await client.query('DELETE FROM studies WHERE id=$1', [createdId]);
    await client.query('DELETE FROM puzzles WHERE id=$1', [id]);
    await client.query('DELETE FROM xiangqi_broadcast_boards WHERE id=$1', [id]);
    await client.query('DELETE FROM xiangqi_broadcast_rounds WHERE id=$1', [id]);
    if (tourCreated)
      await client.query(
        "DELETE FROM xiangqi_broadcast_tours WHERE slug='2025-wxc-sample' AND NOT EXISTS (SELECT 1 FROM xiangqi_broadcast_rounds WHERE tour_slug='2025-wxc-sample')",
      );
    if (ownerCreated) await client.query('DELETE FROM users WHERE id=$1', [id]);
    await client.end();
    await rm(root, { recursive: true, force: true });
  });
  const tour = await client.query(
    `INSERT INTO xiangqi_broadcast_tours (slug,name,payload) VALUES ('2025-wxc-sample','Fixture A event','{}') ON CONFLICT DO NOTHING RETURNING slug`,
  );
  tourCreated = Boolean(tour.rowCount);
  await client.query(
    `INSERT INTO xiangqi_broadcast_rounds (id,tour_slug,name,payload) VALUES ($1,'2025-wxc-sample','Fixture round','{}')`,
    [id],
  );
  await client.query(
    `INSERT INTO xiangqi_broadcast_boards (id,tour_slug,round_id,source_board_id,board_number,red,black,status,result,moves,ply_count,final_status,payload,source_url)
    VALUES ($1,'2025-wxc-sample',$1,$1,1,$2,$3,'complete','1-0',$4,$7,'{"type":"win","winner":"red"}',$5,$6)`,
    [
      id,
      JSON.stringify(red),
      JSON.stringify(black),
      JSON.stringify(moves),
      JSON.stringify(payload),
      payload.sourceUrl,
      moves.length,
    ],
  );
  const owner = await client.query(
    `INSERT INTO users (id,email,handle,display_name) VALUES ($1,$2,'mistboard','Fixture owner') ON CONFLICT DO NOTHING RETURNING id`,
    [id, `${id}@example.invalid`],
  );
  ownerCreated = Boolean(owner.rowCount);
  const seed = loadAllSeedPuzzles().find((p) => p.variant === 'xiangqi')!;
  const before = await client.query(
    'SELECT (SELECT count(*) FROM studies)::int AS studies, (SELECT count(*) FROM puzzles)::int AS puzzles',
  );
  const services = {
    ...localKitServices,
    engine: async () => ({ pin: 'fixture-local' }),
    prepareGame: async (board) => ({
      annotation: {
        game: {
          key: board.boardId,
          red: red.name,
          black: black.name,
          date: '2026-11-07',
          result: '1-0',
          event: 'Fixture A event',
        },
        rows: ucis.map((uci, index) => ({
          uci,
          ply: index + 1,
          side: index % 2 ? 'black' : 'red',
          winBefore: 50,
          winAfter: 50,
          ...(index === 9 ? { lost: 18, best: 'b9c7', winBefore: 50 } : {}),
        })),
      },
      puzzles: [{ ...seed, id, tags: [] }],
    }),
    findMoments: (args) =>
      findCriticalMoments({
        ...args,
        analyzeMoves: async () => [
          { rank: 1, score: { cp: 150, mate: null }, pvUci: ['b9c7', 'b0c2'] },
          { rank: 2, score: { cp: 0, mate: null }, pvUci: ['i6i5'] },
        ],
      }),
  };
  const options = { slug: 'fixture-player', dbUrl, root, maxGames: 1 };
  const manifest = await runKit(options, services);
  assert.equal(manifest.playerPage.resolved, true);
  assert.ok(manifest.candidates.some((b) => b.boardId === id));
  assert.equal(manifest.candidates[0].preview, true);
  const after = await client.query(
    'SELECT (SELECT count(*) FROM studies)::int AS studies, (SELECT count(*) FROM puzzles)::int AS puzzles',
  );
  assert.deepEqual(after.rows, before.rows, 'dry run must leave both stores unchanged');
  const directory = join(root, 'docs-private/players/kits/fixture-player');
  const draft = JSON.parse(await readFile(join(directory, 'study-draft.json'), 'utf8'));
  assert.equal(draft.create.chapter.orientation, 'red');
  assert.equal(draft.create.visibility, 'unlisted');
  // The annotation's win chances become the chapter's Computer analysis graph.
  // An English name stays whole, not cut to its last word.
  assert.match(draft.create.chapter.name, /Fixture Player vs Fixture Opponent/);
  assert.ok(!manifest.missing.some((m) => m.kind === 'name-map'), JSON.stringify(manifest.missing));
  assert.equal(draft.create.chapter.scoreSeries.side, 'red');
  assert.equal(draft.create.chapter.scoreSeries.series[0].values.length, ucis.length + 1);
  await writeFile(
    join(directory, 'selection.json'),
    JSON.stringify({ boardIds: [id], puzzleIds: [id] }),
  );
  const receipt = await runKit({ ...options, apply: true }, services);
  const studyId = receipt.studyId;
  assert.ok(studyId);
  studyIds.push(studyId);
  const stored = await client.query('SELECT data FROM puzzles WHERE id=$1', [id]);
  assert.ok(stored.rows[0].data.tags.includes('player:fixture-player'));
  const chapters = await client.query(
    "SELECT variant, gamebook, jsonb_array_length(score_series->'series'->0->'values') AS graph FROM study_chapters WHERE study_id=$1",
    [studyId],
  );
  assert.deepEqual(chapters.rows, [
    { variant: 'xiangqi', gamebook: false, graph: ucis.length + 1 },
  ]);
  assert.deepEqual(await runKit({ ...options, apply: true }, services), receipt);
  const studyCount = await client.query('SELECT count(*) FROM studies');
  await assert.rejects(
    publishLocal({
      dbUrl,
      plan: draft,
      puzzles: [{ ...seed, id, tags: ['player:fixture-player'] }],
    }),
    /already exists/,
  );
  assert.deepEqual(
    (await client.query('SELECT count(*) FROM studies')).rows,
    studyCount.rows,
    'failed publication removes its new study',
  );

  const momentOptions = { ...options, root: join(root, 'moment-only') };
  const momentManifest = await runKit(momentOptions, services);
  assert.equal(momentManifest.moments.length, 1);
  await writeFile(
    join(momentOptions.root, 'docs-private/players/kits/fixture-player/selection.json'),
    JSON.stringify({ boardIds: [], puzzleIds: [], momentIds: [momentManifest.moments[0].id] }),
  );
  const momentReceipt = await runKit({ ...momentOptions, apply: true }, services);
  studyIds.push(momentReceipt.studyId);
  const momentChapters = await client.query(
    'SELECT gamebook, orientation, tags, root FROM study_chapters WHERE study_id=$1',
    [momentReceipt.studyId],
  );
  assert.equal(momentChapters.rows.length, 1);
  assert.equal(momentChapters.rows[0].gamebook, true);
  assert.equal(momentChapters.rows[0].orientation, 'black');
  assert.equal(momentChapters.rows[0].tags.ply, '10');
  assert.equal(momentChapters.rows[0].root.root.children[0].uci, 'b10c8');

  if (process.env.MISTBOARD_KIT_ENGINE_SMOKE === '1') {
    const real = await runKit({ ...options, root: join(root, 'real-engine') }, localKitServices);
    assert.equal(real.candidates[0].preview, true, JSON.stringify(real.missing));
    assert.ok(real.engine.pin.startsWith('6a59ee2f'));
    assert.ok(real.engine.binarySha256);
    assert.ok(!real.missing.some((m) => ['engine', 'preparation'].includes(m.kind)));
  }
});
