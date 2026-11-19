import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  applyStandardXiangqiMove,
  createInitialXiangqiState,
  type XiangqiMove,
} from '@mistboard/game';
import {
  positionPacketFixture,
  positionReceiptFixture,
} from './fixtures/xiangqi-position-packet.js';
import { getPool } from './persistence-db.js';
import { assert, definePersistenceTests, test } from './persistence-test-support.js';
import { getPuzzleStore, resetPuzzleStoreForTests } from './puzzle-store.js';
import type { HttpApiContext } from './routes/lib.js';
import { tryHandle } from './routes/puzzles.js';
import { xiangqiPositionPuzzleHash } from './xiangqi-puzzle-position-packet.js';
import {
  planXiangqiPositionPublication,
  publishXiangqiPositionPacket,
} from './xiangqi-puzzle-position-publication.js';
import {
  applyXiangqiPuzzleSetupBackfill,
  planXiangqiPuzzleSetupBackfill,
} from './xiangqi-puzzle-setup-backfill.js';

async function detail(id: string) {
  let body = '',
    status = 0;
  const response = {
    writeHead(code: number) {
      status = code;
      return response;
    },
    end(chunk = '') {
      body += chunk;
    },
  };
  const url = new URL(`/api/puzzles/${id}`, 'http://localhost');
  await tryHandle(
    {} as HttpApiContext,
    { method: 'GET', headers: {}, socket: { remoteAddress: '127.0.0.1' } } as IncomingMessage,
    response as unknown as ServerResponse,
    url.pathname,
    url,
  );
  return { status, body };
}

definePersistenceTests('position-only puzzle publication', () => {
  test('new packets persist a validated setup pair and SQL rejects nested setup history', async (t) => {
    resetPuzzleStoreForTests();
    t.after(resetPuzzleStoreForTests);
    await getPuzzleStore();
    const packet = positionPacketFixture(true);
    const item = packet.items[0]!;
    const p = item.puzzle;
    p.initial.lastMove = { from: 'g6', to: 'g5' };
    p.setupMove = { from: 'g6', to: 'g5', captured: null };
    item.verify = positionReceiptFixture(p);
    item.audit = positionReceiptFixture(p);
    item.review.puzzleHash = xiangqiPositionPuzzleHash(p);
    const plan = await planXiangqiPositionPublication(getPool(), packet);
    assert.equal(
      (
        await publishXiangqiPositionPacket({
          packet,
          expectedTotal: 1,
          expectedPacketSha256: plan.packetSha256,
          operatorNote: 'Fixture review',
        })
      ).publishedNow,
      1,
    );
    for (const setupMove of [
      { ...p.setupMove, history: ['PRIVATE_HISTORY'] },
      { ...p.setupMove, captured: { color: 'red', role: 'horse', history: ['PRIVATE_HISTORY'] } },
      { ...p.setupMove, captured: { color: 'black', role: 'horse' } },
    ]) {
      await assert.rejects(
        getPool().query(
          `INSERT INTO puzzles (id, variant, title, seq, goal_type, themes, solution_plies, data, source_kind, position_only)
         SELECT 'invalid-setup', variant, title, seq+1, goal_type, themes, solution_plies, $2::json, source_kind, true
         FROM puzzles WHERE id=$1`,
          [p.id, JSON.stringify({ ...p, setupMove })],
        ),
        /puzzles_position_only_payload/,
      );
    }
  });

  test('legacy DPXQ setup backfill preserves approved content and receipts, then stays immutable', async (t) => {
    resetPuzzleStoreForTests();
    t.after(resetPuzzleStoreForTests);
    await getPuzzleStore();
    const packet = positionPacketFixture(true);
    const p = packet.items[0]!.puzzle;
    p.id = 'xq-mined-dpxq-persistence-2';
    const moves: XiangqiMove[] = [
      { from: 'h3', to: 'h10' },
      { from: 'i10', to: 'h10' },
      { from: 'b3', to: 'b10' },
      { from: 'a7', to: 'a6' },
      { from: 'b10', to: 'd10' },
    ];
    let state = createInitialXiangqiState(p.id);
    for (const move of moves.slice(0, 2)) state = applyStandardXiangqiMove(state, move);
    const initial = {
      id: p.id,
      board: state.board,
      status: state.status,
      moveNumber: 1,
      progressClock: 0,
      positionCounts: {},
      progressClockLimit: 60,
    };
    p.initial = initial;
    p.solution = moves.slice(2);
    const item = packet.items[0]!;
    item.verify = positionReceiptFixture(p);
    item.audit = positionReceiptFixture(p);
    item.review.puzzleHash = xiangqiPositionPuzzleHash(p);
    const db = getPool();
    const publication = await planXiangqiPositionPublication(db, packet);
    await publishXiangqiPositionPacket({
      packet,
      expectedTotal: 1,
      expectedPacketSha256: publication.packetSha256,
      operatorNote: 'Fixture review',
    });
    const before = await db.query('SELECT seq, hidden_reason FROM puzzles WHERE id=$1', [p.id]);
    const receipt = await db.query(
      'SELECT * FROM xiangqi_position_publications WHERE puzzle_id=$1',
      [p.id],
    );
    const games = [{ id: 'dpxq-persistence', moves }];
    const plan = planXiangqiPuzzleSetupBackfill([p], games, 1);
    const input = { games, expectedTotal: 1, expectedSha256: plan.sha256 };
    assert.equal((await applyXiangqiPuzzleSetupBackfill(input)).updated, 1);
    assert.equal((await applyXiangqiPuzzleSetupBackfill(input)).updated, 0);
    assert.deepEqual(
      (await db.query('SELECT seq, hidden_reason FROM puzzles WHERE id=$1', [p.id])).rows,
      before.rows,
    );
    assert.deepEqual(
      (await db.query('SELECT * FROM xiangqi_position_publications WHERE puzzle_id=$1', [p.id]))
        .rows,
      receipt.rows,
    );
    assert.equal((await db.query('SELECT 1 FROM historical_xiangqi_games')).rowCount, 0);
    resetPuzzleStoreForTests();
    const response = await detail(p.id);
    assert.equal(response.status, 200);
    assert.deepEqual(JSON.parse(response.body).puzzle.setupMove, plan.entries[0]!.after.setupMove);
    assert.doesNotMatch(response.body, /"(?:sourceGame|history|moveLog|solution)":/);
    assert.equal(response.body.includes(JSON.stringify(moves[0])), false);
    for (const changed of [
      p,
      { ...plan.entries[0]!.after, credit: { ...p.credit, event: 'changed' } },
    ])
      await assert.rejects(
        db.query('UPDATE puzzles SET data=$2::json WHERE id=$1', [p.id, JSON.stringify(changed)]),
        /immutable/,
      );
  });

  test('dry-run, atomic append, receipt and idempotence with no source-game rows', async (t) => {
    resetPuzzleStoreForTests();
    t.after(resetPuzzleStoreForTests);
    await getPuzzleStore();
    // Use the synthetic advantage board so the seed's mating fixture is not a duplicate.
    const packet = positionPacketFixture(true),
      db = getPool();
    const before = await db.query<{ count: number; max: number }>(
      'SELECT count(*)::int AS count, max(seq)::int AS max FROM puzzles',
    );
    const plan = await planXiangqiPositionPublication(db, packet);
    assert.equal(plan.items.length, 1);
    assert.equal(plan.nextSequence, before.rows[0]!.max + 1);
    assert.equal(
      (await db.query('SELECT 1 FROM puzzles WHERE id=$1', [packet.items[0]!.puzzle.id])).rowCount,
      0,
    );
    const input = {
      packet,
      expectedTotal: 1,
      expectedPacketSha256: plan.packetSha256,
      operatorNote: 'Reviewed fixture',
    };
    assert.equal((await publishXiangqiPositionPacket(input)).publishedNow, 1);
    assert.equal((await publishXiangqiPositionPacket(input)).alreadyPublished, 1);
    assert.equal((await db.query('SELECT 1 FROM xiangqi_position_publications')).rowCount, 1);
    assert.equal((await db.query('SELECT 1 FROM historical_xiangqi_games')).rowCount, 0);
    resetPuzzleStoreForTests();
    const response = await detail(packet.items[0]!.puzzle.id);
    assert.equal(response.status, 200);
    for (const field of [
      'sourceGame',
      'history',
      'moveLog',
      'lastMove',
      'setupMove',
      'showcaseSourceGameId',
    ])
      assert.ok(!response.body.includes(`"${field}"`), field);
    const puzzle = JSON.parse(response.body).puzzle;
    assert.equal(puzzle.credit.red, 'Red Player');
    assert.equal(puzzle.credit.url, packet.items[0]!.puzzle.credit!.url);
    assert.equal(puzzle.solution, undefined);
  });

  test('wrong hash or count rolls back without inserting a puzzle or receipt', async () => {
    resetPuzzleStoreForTests();
    await getPuzzleStore();
    const packet = positionPacketFixture(true);
    for (const expectedTotal of [1, 2])
      await assert.rejects(
        publishXiangqiPositionPacket({
          packet,
          expectedTotal,
          expectedPacketSha256: '0'.repeat(64),
          operatorNote: 'Reviewed fixture',
        }),
      );
    assert.equal(
      (await getPool().query('SELECT 1 FROM puzzles WHERE id=$1', [packet.items[0]!.puzzle.id]))
        .rowCount,
      0,
    );
    assert.equal(
      (await getPool().query('SELECT 1 FROM xiangqi_position_publications')).rowCount,
      0,
    );
  });

  test('a duplicate seed position and duplicate positions within a packet are refused', async () => {
    resetPuzzleStoreForTests();
    await getPuzzleStore();
    await assert.rejects(
      planXiangqiPositionPublication(getPool(), positionPacketFixture()),
      /Position already exists/,
    );
    const packet = positionPacketFixture(true);
    packet.items.push(structuredClone(packet.items[0]!));
    await assert.rejects(
      planXiangqiPositionPublication(getPool(), packet),
      /Duplicate packet puzzle id/,
    );
  });

  test('receipt insertion failure rolls the preceding puzzle insertion back', async () => {
    resetPuzzleStoreForTests();
    await getPuzzleStore();
    const packet = positionPacketFixture(true),
      db = getPool();
    const plan = await planXiangqiPositionPublication(db, packet);
    await db.query(
      `CREATE FUNCTION reject_position_receipt_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'receipt test failure'; END $$`,
    );
    await db.query(
      'CREATE TRIGGER reject_position_receipt BEFORE INSERT ON xiangqi_position_publications FOR EACH ROW EXECUTE FUNCTION reject_position_receipt_test()',
    );
    try {
      await assert.rejects(
        publishXiangqiPositionPacket({
          packet,
          expectedTotal: 1,
          expectedPacketSha256: plan.packetSha256,
          operatorNote: 'Reviewed fixture',
        }),
        /receipt test failure/,
      );
      assert.equal(
        (await db.query('SELECT 1 FROM puzzles WHERE id=$1', [packet.items[0]!.puzzle.id]))
          .rowCount,
        0,
      );
    } finally {
      await db.query('DROP TRIGGER reject_position_receipt ON xiangqi_position_publications');
      await db.query('DROP FUNCTION reject_position_receipt_test()');
    }
  });

  test('two simultaneous applications serialize into one append', async () => {
    resetPuzzleStoreForTests();
    await getPuzzleStore();
    const packet = positionPacketFixture(true);
    const plan = await planXiangqiPositionPublication(getPool(), packet);
    const input = {
      packet,
      expectedTotal: 1,
      expectedPacketSha256: plan.packetSha256,
      operatorNote: 'Reviewed fixture',
    };
    const results = await Promise.all([
      publishXiangqiPositionPacket(input),
      publishXiangqiPositionPacket(input),
    ]);
    assert.equal(
      results.reduce((n, r) => n + r.publishedNow, 0),
      1,
    );
    assert.equal(
      (await getPool().query('SELECT 1 FROM xiangqi_position_publications')).rowCount,
      1,
    );
  });
  test('legacy updates cannot replace a verified position or remove its privacy boundary', async () => {
    resetPuzzleStoreForTests();
    await getPuzzleStore();
    const packet = positionPacketFixture(true),
      db = getPool();
    const plan = await planXiangqiPositionPublication(db, packet);
    await publishXiangqiPositionPacket({
      packet,
      expectedTotal: 1,
      expectedPacketSha256: plan.packetSha256,
      operatorNote: 'Reviewed fixture',
    });
    const p = packet.items[0]!.puzzle;
    await assert.rejects(
      db.query('UPDATE puzzles SET data=$2::json WHERE id=$1', [
        p.id,
        JSON.stringify({ ...p, sourceGame: { gameId: 'PRIVATE_GAME', ply: 40 } }),
      ]),
      /immutable/,
    );
    await assert.rejects(
      db.query('UPDATE puzzles SET position_only=false WHERE id=$1', [p.id]),
      /immutable/,
    );
    const changed = structuredClone(p);
    changed.credit!.event = 'Changed after verification';
    await assert.rejects(
      db.query('UPDATE puzzles SET data=$2::json WHERE id=$1', [p.id, JSON.stringify(changed)]),
      /immutable/,
    );
    const reordered = Object.fromEntries(Object.entries(p).reverse());
    await db.query('UPDATE puzzles SET data=$2::json WHERE id=$1', [
      p.id,
      JSON.stringify(reordered),
    ]);
    assert.equal(
      (
        await publishXiangqiPositionPacket({
          packet,
          expectedTotal: 1,
          expectedPacketSha256: plan.packetSha256,
          operatorNote: 'Reviewed fixture',
        })
      ).alreadyPublished,
      1,
    );
    assert.deepEqual(
      (await db.query('SELECT data FROM puzzles WHERE id=$1', [p.id])).rows[0].data,
      p,
    );
  });
});
