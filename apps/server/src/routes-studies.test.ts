import assert from 'node:assert/strict';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import test from 'node:test';
import { createGomokuRoomState, gomokuFen } from '@mistboard/game';
import { close, getPool, init } from './persistence-db.js';
import { parseChapterTags, setAdminOnlyStudyGateForTests, tryHandle } from './routes/studies.js';

type ResponseCapture = { body: string; headers: Record<string, string>; status: number | null };

test('study decision reads omit disabled luck and preserve the stored row for re-enabling', async (t) => {
  const previous = process.env.MISTBOARD_JIEQI_LUCK_ENABLED;
  t.after(() => {
    if (previous === undefined) delete process.env.MISTBOARD_JIEQI_LUCK_ENABLED;
    else process.env.MISTBOARD_JIEQI_LUCK_ENABLED = previous;
  });
  init('postgres://mistboard@127.0.0.1:9/never');
  t.after(close);
  const tree = {
    version: 1,
    rootFen:
      'xxxxkxxxx/9/1x5x1/x1x1x1x1x/9/9/X1X1X1X1X/1X5X1/9/XXXXKXXXX w R2A2C2P5N2B2r2a2c2p5n2b2 0 1 prnabpbrccppanpCNPNAPAPBRPPRCB',
    root: { children: [{ uci: 'i4i5', children: [] }] },
  };
  const decisions = [{ ply: 1, mover: 'red', playedWin: 50, realizedWin: 62 }];
  t.mock.method(getPool(), 'query', async (sql: string) => {
    if (sql.includes('FROM study_chapters c JOIN studies'))
      return {
        rows: [
          {
            chapter_id: 'c',
            visibility: 'public',
            owner_id: 'owner',
            variant: 'jieqi',
            root: tree,
            engine_id: 'offline',
            source: 'match',
            decisions,
            updated_at: new Date(),
          },
        ],
      };
    if (sql.includes('LEFT JOIN study_chapters')) return { rows: [{ variant: 'jieqi' }] };
    assert.fail(`Unexpected study query: ${sql}`);
  });
  const read = async () => {
    const response = captureResponse();
    assert.equal(
      await tryHandle(
        {},
        { method: 'GET', headers: {} } as IncomingMessage,
        response,
        '/api/studies/s/chapters/c/decisions',
      ),
      true,
    );
    assert.equal(response.status, 200);
    return JSON.parse(response.body);
  };
  delete process.env.MISTBOARD_JIEQI_LUCK_ENABLED;
  const enabled = await read();
  assert.deepEqual(enabled, { engineId: 'offline', source: 'match', decisions });
  process.env.MISTBOARD_JIEQI_LUCK_ENABLED = 'false';
  const disabled = await read();
  assert.doesNotMatch(JSON.stringify(disabled), /"(?:realizedWin|luck|netLuck|totalLuck)"/);
  assert.deepEqual(disabled.decisions, [{ ply: 1, mover: 'red', playedWin: 50 }]);
  process.env.MISTBOARD_JIEQI_LUCK_ENABLED = 'true';
  assert.deepEqual(await read(), enabled);
});

test('Staff picks curation rejects a non-admin before reading persistence', async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    const response = captureResponse();
    const request = {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      socket: { remoteAddress: '127.0.0.1' },
    } as unknown as IncomingMessage;

    const handled = await tryHandle({}, request, response, '/api/admin/studies/study1/featured');

    assert.equal(handled, true);
    assert.equal(response.status, 403);
    assert.deepEqual(JSON.parse(response.body), { error: 'admin_required' });
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  }
});

test('cloning a study requires a session', async () => {
  const response = captureResponse();
  const request = {
    method: 'POST',
    headers: {},
    socket: { remoteAddress: '127.0.0.1' },
  } as unknown as IncomingMessage;
  const handled = await tryHandle({}, request, response, '/api/studies/study1/clone');
  assert.equal(handled, true);
  // Without persistence the route answers 503 before the session check; with
  // it, 401. Either way nothing is cloned for a signed-out caller.
  assert.ok(response.status === 401 || response.status === 503, String(response.status));
});

test('chapter tags keep the allowlist and drop everything else', () => {
  assert.deepEqual(
    parseChapterTags({
      red: 'Xu Chao',
      black: 'Huang Xueqian',
      result: '1-0',
      event: '2019 World Championship',
      date: '2019-11-24',
      round: '9',
      site: 'http://www.dpxq.com/x.html',
    }),
    {
      red: 'Xu Chao',
      black: 'Huang Xueqian',
      result: '1-0',
      event: '2019 World Championship',
      date: '2019-11-24',
      round: '9',
      site: 'http://www.dpxq.com/x.html',
    },
  );

  // The case that cost a whole study: PGN writes its tags capitalised, so
  // sending Red/Black/Event/Result is the natural mistake. They are not on the
  // allowlist, the write still returns 201, and the chapter stores {}. The drop
  // is deliberate (an unknown key is not a reason to reject a whole save) but it
  // is silent, which is why a caller has to read its own write back.
  assert.deepEqual(parseChapterTags({ Red: 'Xu Chao', Black: 'Huang Xueqian', Result: '1-0' }), {});

  // Blank strings clear rather than store, and non-strings are ignored.
  assert.deepEqual(parseChapterTags({ red: '   ', black: 42, result: '1-0' }), { result: '1-0' });
  assert.deepEqual(parseChapterTags(null), {});
  assert.deepEqual(parseChapterTags(['red', 'Xu Chao']), {});
});

function captureResponse(): ServerResponse & ResponseCapture {
  const capture = {
    body: '',
    headers: {} as Record<string, string>,
    status: null as number | null,
    writeHead(status: number, headers?: Record<string, string>) {
      capture.status = status;
      capture.headers = headers ?? {};
      return capture;
    },
    end(chunk?: string) {
      capture.body += chunk ?? '';
      return capture;
    },
  };
  return capture as unknown as ServerResponse & ResponseCapture;
}

// Exercise the real route, session lookup and persistence serializers. Only the
// SQL boundary is in memory, with admin-only access explicitly denied.
test('a non-admin creates public Gomoku chapters and unknown variants fail closed', async (t) => {
  init('postgres://mistboard@127.0.0.1:9/never');
  t.after(close);
  setAdminOnlyStudyGateForTests(async () => false);
  t.after(() => setAdminOnlyStudyGateForTests(null));
  const now = new Date('2026-11-07T12:00:00Z');
  let study: Record<string, unknown> | undefined;
  let chapter: Record<string, unknown> | undefined;
  let writes = 0;
  const query = async (sql: string, values: unknown[] = []) => {
    if (sql.includes('UPDATE account_sessions')) {
      return {
        rows: [{ id: 'member', handle: 'member', display_name: 'member', account_role: 'user' }],
      };
    }
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
    if (sql.includes('INSERT INTO studies')) {
      writes++;
      study = {
        id: values[0],
        owner_id: values[1],
        name: values[3],
        description: values[4],
        visibility: values[6],
        featured_at: null,
        created_at: now,
        updated_at: now,
      };
      return { rows: [] };
    }
    if (sql.includes('INSERT INTO study_chapters')) {
      chapter = {
        id: values[0],
        study_id: values[1],
        name: values[2],
        variant: values[4],
        orientation: values[5],
        root: JSON.parse(values[6] as string),
        version: 1,
      };
      return { rows: [] };
    }
    if (sql.includes('FROM study_likes'))
      return { rows: [{ like_count: '0', liked_by_viewer: false }] };
    if (sql.includes('FROM study_chapter_analysis') || sql.includes('FROM study_chapter_decisions'))
      return { rows: [] };
    if (sql.includes('FROM studies s')) return { rows: study ? [study] : [] };
    if (sql.includes('FROM study_chapters')) return { rows: chapter ? [chapter] : [] };
    assert.fail(`Unexpected study query: ${sql}`);
  };
  t.mock.method(getPool(), 'query', query);
  t.mock.method(getPool(), 'connect', async () => ({ query, release() {} }));

  async function create(variant: string, root: unknown) {
    const request = Readable.from([
      JSON.stringify({
        name: 'Gomoku lesson',
        visibility: 'public',
        chapter: { name: 'One', variant, root },
      }),
    ]) as IncomingMessage;
    request.method = 'POST';
    request.headers = { cookie: 'mistboard_session=member.test-token' };
    const response = captureResponse();
    assert.equal(await tryHandle({}, request, response, '/api/studies'), true);
    return response;
  }

  const empty = { version: 1, root: { children: [] } };
  const dealt = {
    ...empty,
    rootFen: gomokuFen(
      createGomokuRoomState('route', {
        stones: [{ square: 'h8', color: 'black' }],
        turn: 'white',
      }),
    ),
    root: { children: [{ uci: 'a1', children: [{ uci: 'o15', children: [] }] }] },
  };
  for (const root of [empty, dealt]) {
    const response = await create('gomoku', root);
    assert.equal(response.status, 201, response.body);
    const body = JSON.parse(response.body);
    assert.equal(body.study.visibility, 'public');
    assert.equal(body.chapters[0].variant, 'gomoku');
    assert.deepEqual(body.chapters[0].root, root);
    // Public studies are readable by a guest, including their saved root and line.
    const read = captureResponse();
    const request = { method: 'GET', headers: {} } as IncomingMessage;
    assert.equal(await tryHandle({}, request, read, `/api/studies/${body.study.id}`), true);
    assert.equal(read.status, 200, read.body);
    assert.deepEqual(JSON.parse(read.body).chapters[0].root, root);
  }
  const beforeRefusal = writes;
  const refused = await create('unknown-gomoku', empty);
  assert.equal(refused.status, 400);
  assert.deepEqual(JSON.parse(refused.body), { error: 'unsupported_variant' });
  assert.equal(writes, beforeRefusal);
});
