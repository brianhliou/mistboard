import assert from 'node:assert/strict';
import type { IncomingMessage, ServerResponse } from 'node:http';
import test from 'node:test';
import { ffqBanqiHttpTarget } from './ffq-banqi-http.js';
import { handleApiRequest, routes } from './http-api.js';
import { close, getPool, init } from './persistence-db.js';
import { clearPresence } from './presence.js';
import type { HttpApiContext } from './routes/lib.js';
import { createHttpRequestHandler } from './server-http.js';

const FLAG = 'MISTBOARD_FFQ_BANQI_ENABLED';
const SECRET = 'CANONICAL-FFQ-SETUP-MUST-STAY-SERVER-SECRET';
const PREFIXES = [
  '',
  'ffq-banqi/',
  'banqi/',
  'three-kingdoms-banqi/',
  'xiangqi/',
  'jieqi/',
  'dark-xiangqi/',
  'fortress-xiangqi/',
  'duck-xiangqi/',
  'atomic-xiangqi/',
  'crazyhouse-xiangqi/',
  'jungle/',
  'jungle-flip/',
  'xiangqi-mahjong/',
  'historical-xiangqi/',
];

function reads(id: string): Array<[string, string]> {
  const paths: Array<[string, string]> = [];
  for (const prefix of PREFIXES) {
    for (const suffix of [
      '',
      '/events',
      '/review',
      '/artifacts',
      '/export.json',
      '/export.pgn',
      '/analysis',
      '/analysis/jobs/job',
      '/decisions',
      '/watch',
      '/crosstable',
      '/favorite',
    ]) {
      paths.push(['GET', `/api/${prefix}games/${id}${suffix}`]);
    }
    paths.push(['POST', `/api/${prefix}games/${id}/analysis`]);
    paths.push(['POST', `/api/${prefix}games/${id}/favorite`]);
    paths.push(['DELETE', `/api/${prefix}games/${id}/favorite`]);
    paths.push(['GET', `/${prefix}game/${id}`]);
    paths.push(['GET', `/${prefix}room/${id}`]);
  }
  for (const path of [
    `/api/admin/games/${id}/artifacts?type=live-engine-decision`,
    `/api/admin/lifecycle?roomId=${id}`,
    `/api/chat/game/${id}`,
    `/api/chat/player/${id}`,
    `/og/game/${id}.png`,
    `/embed/game/${id}`,
    `/api/watch/live?room=${id}`,
    `/watch?room=${id}`,
    `/api/oembed?url=${encodeURIComponent(`https://mistboard.com/game/${id}`)}`,
    `/api/oembed?url=${encodeURIComponent(`https://mistboard.com/banqi/game/${id}`)}`,
    `/api/oembed?url=${encodeURIComponent(`https://mistboard.com/embed/game/${id}`)}`,
  ])
    paths.push(['GET', path]);
  paths.push(['POST', `/api/rooms/${id}/abandon`]);
  paths.push(['POST', `/api/chat/game/${id}`]);
  paths.push(['POST', `/api/chat/player/${id}/hide`]);
  paths.push(['HEAD', `/api/games/${id}/events`]);
  return paths;
}

async function invoke(
  run: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>,
  method: string,
  url: string,
  signedIn: boolean,
) {
  const headers: Record<string, unknown> = {};
  let status = 0;
  let body = '';
  let finish!: () => void;
  const done = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const request = {
    method,
    url,
    headers: signedIn ? { cookie: 'mistboard_session=fixture.token' } : {},
  } as IncomingMessage;
  const response = {
    setHeader: (key: string, value: unknown) => {
      headers[key.toLowerCase()] = value;
    },
    writeHead: (code: number, values: Record<string, unknown> = {}) => {
      status = code;
      for (const [key, value] of Object.entries(values)) headers[key.toLowerCase()] = value;
    },
    end: (chunk = '') => {
      body += chunk;
      finish();
    },
  } as unknown as ServerResponse;
  await run(request, response);
  await done;
  return { status, body, headers };
}

for (const flag of [undefined, 'false', 'true']) {
  for (const role of [null, 'player', 'admin'] as const) {
    test(`FFQ HTTP dispatch: flag=${flag}, account=${role ?? 'guest'}`, {
      timeout: 15_000,
    }, async (t) => {
      const previous = process.env[FLAG];
      if (flag === undefined) delete process.env[FLAG];
      else process.env[FLAG] = flag;
      t.after(async () => {
        if (previous === undefined) delete process.env[FLAG];
        else process.env[FLAG] = previous;
        clearPresence();
        await close();
      });
      init('postgres://mistboard@127.0.0.1:9/never-connect');
      t.mock.method(getPool(), 'connect', () => assert.fail('unexpected database connection'));
      const queries: string[] = [];
      t.mock.method(getPool(), 'query', async (sql: string, params: unknown[]) => {
        queries.push(sql);
        if (sql.includes('UPDATE account_sessions')) {
          return { rows: role ? [{ id: 'fixture', handle: 'fixture', account_role: role }] : [] };
        }
        if (admitted && sql.includes('SELECT games.room_id')) {
          assert.ok(params[0] === 'legacy_alias' || params[0] === 'inflight_alias');
          if (params[0] === 'inflight_alias') return { rows: [] };
          return {
            rows: [
              {
                room_id: 'legacy_alias',
                variant: 'ffq-banqi',
                mode: 'pvp',
                result: 'draw',
                termination: 'draw',
                ply_count: 30,
                started_at: new Date(0),
                ended_at: new Date(1),
                white_name: SECRET,
                black_name: SECRET,
                time_control: { setup: SECRET },
              },
            ],
          };
        }
        if (admitted && sql.includes('FROM game_participants')) return { rows: [] };
        // The pre-dispatch identity check must select metadata only, including
        // rooms without a completed games row. Never fetch a canonical log.
        assert.ok(sql.includes('SELECT EXISTS'), `read reached route data loading: ${sql}`);
        assert.ok(sql.includes('games') && sql.includes('events'));
        assert.ok(sql.includes("payload->>'gameSpecId'") && sql.includes("payload->>'variant'"));
        assert.ok(!sql.includes('SELECT payload'));
        assert.equal(params[1], 'ffq-banqi');
        return { rows: [{ matches: true }] };
      });
      const summary = {
        roomId: '',
        variant: 'ffq-banqi',
        mode: 'pvp',
        result: 'draw',
        termination: 'draw',
        plyCount: 30,
        startedAt: new Date(0),
        endedAt: new Date(1),
        rated: false,
        setup: { deal: SECRET },
        events: [{ setup: SECRET }],
        state: { board: SECRET },
        participants: [{ setup: SECRET }],
      };
      let summaryReads = 0;
      const context = {
        rooms: new Map([['live_alias', { gameSpecId: 'ffq-banqi', setup: SECRET }]]),
        inMemoryGameSummary: (roomId: string) => {
          summaryReads++;
          return ['legacy_alias', 'inflight_alias'].includes(roomId)
            ? null
            : { ...summary, roomId };
        },
        abandonRoom: () => assert.fail('FFQ room action escaped the guard'),
      } as unknown as HttpApiContext;
      const handler = createHttpRequestHandler({
        ...context,
        publicHost: 'https://mistboard.com',
        staticDir: '/not-used',
        drainController: { isDraining: () => false },
      } as unknown as Parameters<typeof createHttpRequestHandler>[0]);
      const admitted = flag === 'true' && role === 'admin';
      for (const id of [
        'ffq_reserved',
        '%66fq_encoded',
        'legacy_alias',
        'inflight_alias',
        'live_alias',
      ]) {
        for (const [method, path] of reads(id)) {
          // Only the two explicitly supported summary endpoints are open.
          const safeSummary =
            id !== 'inflight_alias' &&
            method === 'GET' &&
            (path === `/api/games/${id}` || path === `/api/ffq-banqi/games/${id}`);
          const result = await invoke(handler, method, path, role !== null);
          assert.equal(result.status, admitted && safeSummary ? 200 : 404, `${method} ${path}`);
          assert.ok(!result.body.includes(SECRET), `${method} ${path}: leaked setup`);
          assert.equal(result.headers['cache-control'], 'no-store');
          if (admitted && safeSummary) {
            assert.deepEqual(JSON.parse(result.body), {
              game: {
                roomId: decodeURIComponent(id),
                variant: 'ffq-banqi',
                mode: 'pvp',
                result: 'draw',
                termination: 'draw',
                plyCount: 30,
                startedAt: new Date(0).toISOString(),
                endedAt: new Date(1).toISOString(),
                rated: false,
              },
            });
          } else assert.equal(result.body, '{"error":"not_found"}');
        }
      }
      // Both entrypoints are boundaries: direct dispatcher users cannot bypass
      // the server's page/OG preflight.
      const direct = await invoke(
        (req, res) => handleApiRequest(context, req, res),
        'GET',
        '/api/games/ffq_reserved/events',
        role !== null,
      );
      assert.equal(direct.status, 404);
      assert.equal(direct.body, '{"error":"not_found"}');
      if (!admitted) assert.equal(summaryReads, 0, 'unauthorized request loaded a summary');
      assert.ok(
        queries.some((sql) => sql.includes('SELECT EXISTS')),
        'persisted aliases were checked',
      );
    });
  }
}

test('FFQ identity lookup leaves unrelated rooms and collections with their existing dispatcher', async (t) => {
  init('postgres://mistboard@127.0.0.1:9/never-connect');
  t.after(() => close());
  const lookedUp: unknown[] = [];
  t.mock.method(getPool(), 'query', async (sql: string, params: unknown[]) => {
    assert.ok(sql.includes('SELECT EXISTS'));
    lookedUp.push(params[0]);
    return { rows: [{ matches: false }] };
  });
  const context = { rooms: new Map() } as unknown as HttpApiContext;
  const sentinel = {
    tryHandle: async (_ctx: unknown, _req: IncomingMessage, res: ServerResponse) => {
      res.writeHead(200);
      res.end('existing route');
      return true;
    },
  };
  routes.unshift(sentinel);
  t.after(() => {
    assert.equal(routes.shift(), sentinel);
  });
  for (const path of [
    '/api/games/nonffq/events',
    '/api/banqi/games/recent',
    '/api/games/current',
    '/api/games/recent',
    '/api/games/showcase',
    '/api/games/favorites',
    '/api/admin/games/query',
    '/api/correspondence/games/finished',
    '/api/health',
  ]) {
    const result = await invoke(
      (req, res) => handleApiRequest(context, req, res),
      'GET',
      path,
      false,
    );
    assert.equal(result.status, 200, path);
    assert.equal(result.body, 'existing route');
  }
  assert.deepEqual(lookedUp, ['nonffq', 'recent']);
  assert.equal(ffqBanqiHttpTarget(new URL('http://localhost/api/games/current')), null);
  assert.equal(
    ffqBanqiHttpTarget(new URL('http://localhost/api/banqi/games/current'))?.roomId,
    'current',
  );
});

test('reserved FFQ reads close without persistence or touching runtime state', async (t) => {
  const previous = process.env[FLAG];
  t.after(() => {
    if (previous === undefined) delete process.env[FLAG];
    else process.env[FLAG] = previous;
  });
  const context = new Proxy({} as HttpApiContext, {
    get: (_target, key) => assert.fail(`reserved FFQ read touched runtime: ${String(key)}`),
  });
  for (const flag of ['false', 'true']) {
    process.env[FLAG] = flag;
    for (const path of [
      '/api/games/ffq_reserved',
      '/api/games/ffq_reserved/events',
      '/api/ffq-banqi/games/legacy_alias',
      '/api/games/%ZZ/events',
    ]) {
      const result = await invoke(
        (req, res) => handleApiRequest(context, req, res),
        'GET',
        path,
        false,
      );
      assert.equal(result.status, 404, path);
      assert.equal(result.body, '{"error":"not_found"}');
    }
  }
});
