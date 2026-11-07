import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { loadAllSeedPuzzles } from '@mistboard/game/puzzle-seed';
import pg from 'pg';
import { localKitServices, publishLocal } from './lib/player-kit-local.mjs';
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
  const black = { name: 'Fixture Opponent', nameEn: 'Fixture Opponent' };
  const moves = [
    { from: 'a4', to: 'a5' },
    { from: 'a7', to: 'a6' },
  ];
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
  let studyId: string | undefined;
  let ownerCreated = false;
  let tourCreated = false;
  t.after(async () => {
    if (studyId) await client.query('DELETE FROM studies WHERE id=$1', [studyId]);
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
    VALUES ($1,'2025-wxc-sample',$1,$1,1,$2,$3,'complete','1-0',$4,2,'{"type":"win","winner":"red"}',$5,$6)`,
    [
      id,
      JSON.stringify(red),
      JSON.stringify(black),
      JSON.stringify(moves),
      JSON.stringify(payload),
      payload.sourceUrl,
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
        rows: [{ uci: 'a3a4' }, { uci: 'a6a5' }],
      },
      puzzles: [{ ...seed, id, tags: [] }],
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
  await writeFile(
    join(directory, 'selection.json'),
    JSON.stringify({ boardIds: [id], puzzleIds: [id] }),
  );
  const receipt = await runKit({ ...options, apply: true }, services);
  studyId = receipt.studyId;
  assert.ok(studyId);
  const stored = await client.query('SELECT data FROM puzzles WHERE id=$1', [id]);
  assert.ok(stored.rows[0].data.tags.includes('player:fixture-player'));
  const chapters = await client.query('SELECT variant FROM study_chapters WHERE study_id=$1', [
    studyId,
  ]);
  assert.deepEqual(chapters.rows, [{ variant: 'xiangqi' }]);
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

  if (process.env.MISTBOARD_KIT_ENGINE_SMOKE === '1') {
    const real = await runKit({ ...options, root: join(root, 'real-engine') }, localKitServices);
    assert.equal(real.candidates[0].preview, true, JSON.stringify(real.missing));
    assert.ok(real.engine.pin.startsWith('6a59ee2f'));
    assert.ok(real.engine.binarySha256);
    assert.ok(!real.missing.some((m) => ['engine', 'preparation'].includes(m.kind)));
  }
});
