import { createHash, randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { getPool } from './persistence-db.js';
import { assert, definePersistenceTests, test } from './persistence-test-support.js';
import {
  findXiangqiBroadcastPushToken,
  touchXiangqiBroadcastPushToken,
} from './persistence-xiangqi-broadcast-push.js';
import {
  getXiangqiBroadcastBoard,
  getXiangqiBroadcastTour,
  importXiangqiBroadcastPack,
} from './persistence-xiangqi-broadcasts.js';
import type { HttpApiContext } from './routes/lib.js';
import { createBroadcastPushHandler } from './routes/xiangqi-broadcast-push.js';
import { applyBroadcastPushGame, broadcastPushStatus } from './xiangqi-broadcast-push-store.js';

const initial = {
  round: 3,
  board: 12,
  red: { name: 'Red' },
  black: { name: 'Black' },
  notation: 'iccs',
  moves: ['h2e2', 'h9g7'],
  status: 'live',
  seq: 2,
};
async function setup(slug = 'event') {
  await importXiangqiBroadcastPack({
    tour: { schema: 'mistboard.xiangqi.broadcast.v1', slug, name: slug },
    rounds: [],
    boards: [],
  });
  await getPool().query(
    "UPDATE xiangqi_broadcast_tours SET listed = false, poll_mode = 'off' WHERE slug = $1",
    [slug],
  );
  const credential = `mbpush_${randomBytes(32).toString('base64url')}`;
  const id = `bpt_${randomBytes(4).toString('hex')}`;
  await getPool().query(
    'INSERT INTO xiangqi_broadcast_push_tokens (id, tour_slug, label, token_hash) VALUES ($1,$2,$3,$4)',
    [id, slug, 'test', createHash('sha256').update(credential).digest('hex')],
  );
  let at = 0;
  const evals: string[] = [];
  const handler = createBroadcastPushHandler({
    findToken: findXiangqiBroadcastPushToken,
    touchToken: touchXiangqiBroadcastPushToken,
    getTour: getXiangqiBroadcastTour,
    apply: applyBroadcastPushGame,
    status: broadcastPushStatus,
    requestEval: async (boardId) => {
      evals.push(boardId);
    },
    now: () => (at += 1001),
    origin: () => 'https://configured.test',
  });
  async function request(
    body: unknown = initial,
    path = '/api/xiangqi/broadcast-push',
    contentType = 'application/json',
  ) {
    const req = Readable.from([
      Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)),
    ]) as IncomingMessage;
    req.headers = { authorization: `Bearer ${credential}`, 'content-type': contentType };
    req.method = path.endsWith('/status') ? 'GET' : 'POST';
    let status = 0;
    let data = '';
    const res = {
      writeHead(s: number) {
        status = s;
      },
      end(b: string) {
        data = b;
      },
    } as unknown as ServerResponse;
    await handler({} as HttpApiContext, req, res, path, new URL(path, 'http://localhost'));
    return { status, body: JSON.parse(data) };
  }
  return { request, id, evals };
}

definePersistenceTests('broadcast push HTTP adapter', () => {
  test('persistence push route creates/extends/retries/corrects/takes back with sticky completion and updates players/clock', async () => {
    const h = await setup();
    const created = await h.request();
    assert.equal(created.status, 200);
    assert.equal(created.body.changed, true);
    assert.equal(created.body.game.round, 'r3');
    assert.equal((await h.request()).body.changed, false);
    const extended = {
      ...initial,
      moves: [...initial.moves, 'h0g2'],
      seq: 3,
      red: undefined,
      black: undefined,
    };
    assert.equal((await h.request(extended)).body.game.plies, 3);
    assert.equal((await h.request({ ...initial, seq: undefined })).body.stale, true);
    assert.equal((await h.request({ ...initial, seq: 2 })).body.stale, true);
    const back = await h.request({ ...initial, seq: 4 });
    assert.equal(back.body.corrected, true);
    assert.equal(back.body.game.plies, 2);
    const divergent = { ...initial, moves: ['b2e2', 'h9g7'], seq: 5 };
    assert.equal((await h.request(divergent)).body.corrected, true);
    const finished = {
      ...divergent,
      status: 'finished',
      result: '1-0',
      seq: 6,
      clock: { red: 123, black: 456 },
      timeControl: '90+30',
    };
    assert.equal((await h.request(finished)).body.game.status, 'finished');
    assert.equal((await h.request(divergent)).body.changed, false);
    assert.equal((await h.request({ ...initial, seq: 5 })).body.stale, true);
    const corrected = await h.request({ ...initial, seq: 7 });
    assert.equal(corrected.body.corrected, true);
    assert.equal(corrected.body.game.status, 'finished');
    assert.equal(corrected.body.game.result, '1-0');
    await h.request({
      ...initial,
      seq: 8,
      status: 'finished',
      result: '1-0',
      red: { name: 'Corrected', federation: 'CHN', title: 'GM' },
    });
    const saved = await getXiangqiBroadcastBoard('event-r3-b12');
    assert.equal(saved?.red.name, 'Corrected');
    assert.equal(saved?.clock?.redMs, 123);
    assert.equal(saved?.details?.timeControl, '90+30');
    assert.equal(saved?.sourceBoardId, 'r3-b12');
    assert.equal(h.evals.length, 7);
    const lastUsed = (
      await getPool().query('SELECT last_used_at FROM xiangqi_broadcast_push_tokens WHERE id=$1', [
        h.id,
      ])
    ).rows[0].last_used_at;
    await h.request();
    assert.deepEqual(
      (
        await getPool().query(
          'SELECT last_used_at FROM xiangqi_broadcast_push_tokens WHERE id=$1',
          [h.id],
        )
      ).rows[0].last_used_at,
      lastUsed,
    );
  });

  test('persistence route isolates event round ids, checks string rounds and initial players, and returns authoritative status', async () => {
    const h = await setup();
    const other = await setup('other');
    assert.equal((await h.request({ ...initial, red: undefined })).status, 400);
    assert.equal((await h.request({ ...initial, round: 'unknown' })).status, 400);
    await h.request();
    await other.request();
    // The id given by the status endpoint must address the SAME numeric board.
    const status = await h.request(null, '/api/xiangqi/broadcast-push/status');
    assert.equal(status.body.test, true);
    assert.equal(status.body.rounds[0].id, 'event-r3');
    assert.equal(status.body.rounds[0].boards.length, 1);
    assert.equal((await h.request({ ...initial, round: 'event-r3' })).body.changed, false);
    assert.equal((await h.request({ ...initial, round: 'r3' })).body.changed, false);
    assert.equal((await other.request({ ...initial, round: 'event-r3' })).status, 400);
    assert.equal(
      (await getPool().query('SELECT count(*)::int AS n FROM xiangqi_broadcast_boards')).rows[0].n,
      2,
    );
    await getPool().query('UPDATE xiangqi_broadcast_push_tokens SET revoked_at=now() WHERE id=$1', [
      h.id,
    ]);
    assert.equal((await h.request()).status, 403);
  });

  test('persistence multi-game PGN applies valid siblings only and illegal JSON is atomic; polled events reject writes', async () => {
    const h = await setup();
    const text =
      '[Round "3.12"]\n[Red "R"]\n[Black "B"]\n\n1. h2e2 h9h0 *\n\n[Round "3"]\n[Board "13"]\n[White "R"]\n[Black "B"]\n[Result "0-1"]\n\n1. h2e2 h9g7 0-1';
    const r = await h.request(text, undefined, 'application/x-chess-pgn');
    assert.equal(r.status, 200);
    assert.equal(r.body.games[0].error, 'illegal_move');
    assert.equal(r.body.games[1].ok, true);
    assert.equal(await getXiangqiBroadcastBoard('event-r3-b12'), null);
    assert.equal((await getXiangqiBroadcastBoard('event-r3-b13'))?.status, 'complete');
    await h.request();
    const failed = await h.request({ ...initial, moves: [...initial.moves, 'h0h9'] });
    assert.equal(failed.status, 422);
    assert.equal((await getXiangqiBroadcastBoard('event-r3-b12'))?.moves.length, 2);
    await getPool().query(
      "UPDATE xiangqi_broadcast_tours SET source_url='https://source.test', poll_mode='auto' WHERE slug='event'",
    );
    assert.equal((await h.request()).status, 409);
    // Also assert the transaction guard, independently of the route precheck.
    const applied = await applyBroadcastPushGame('event', {
      round: 3,
      board: 12,
      moves: [],
      status: 'live',
      result: '*',
    });
    assert.equal(applied.ok, false);
    if (!applied.ok) assert.equal(applied.error, 'event_not_pushable');
  });

  test('persistence push cannot claim a colliding board id from another event', async () => {
    const h = await setup();
    await importXiangqiBroadcastPack({
      tour: { schema: 'mistboard.xiangqi.broadcast.v1', slug: 'other', name: 'Other' },
      rounds: [
        {
          schema: 'mistboard.xiangqi.broadcast.v1',
          id: 'other-r1',
          tourSlug: 'other',
          name: 'Round 1',
        },
      ],
      boards: [
        {
          schema: 'mistboard.xiangqi.broadcast.v1',
          id: 'event-r3-b12',
          tourSlug: 'other',
          roundId: 'other-r1',
          sourceBoardId: 'r1-b01',
          boardNumber: 1,
          red: { name: 'Original red' },
          black: { name: 'Original black' },
          moves: [],
          status: 'live',
          result: '*',
        },
      ],
    });
    const rejected = await h.request();
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.error, 'invalid_body');
    const board = await getXiangqiBroadcastBoard('event-r3-b12');
    assert.equal(board?.tourSlug, 'other');
    assert.equal(board?.red.name, 'Original red');
    assert.deepEqual(board?.moves, []);
  });
});
