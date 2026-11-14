import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { test } from 'node:test';
import type { HttpApiContext } from './lib.js';
import {
  type BroadcastPushDependencies,
  createBroadcastPushHandler,
} from './xiangqi-broadcast-push.js';

const credential = `mbpush_${randomBytes(32).toString('base64url')}`;
const initial = {
  round: 3,
  board: 12,
  red: { name: 'Red' },
  black: { name: 'Black' },
  notation: 'iccs',
  moves: ['h2e2', 'h9g7'],
  status: 'live',
};
function harness(overrides: Partial<BroadcastPushDependencies> = {}) {
  const writes: unknown[] = [];
  const evals: string[] = [];
  let touches = 0;
  let now = 1000;
  const deps: BroadcastPushDependencies = {
    findToken: async (value) =>
      value === credential
        ? {
            id: 'bpt_12345678',
            tourSlug: 'event',
            label: 'test',
            createdAt: new Date(0),
            revokedAt: null,
            lastUsedAt: null,
          }
        : null,
    touchToken: async () => {
      touches++;
      return true;
    },
    getTour: async () => ({
      slug: 'event',
      name: 'Event',
      listed: false,
      sourceUrl: undefined,
      pollMode: 'off',
    }),
    status: async () => ({ rounds: [] }),
    apply: async (slug, game) => {
      writes.push(game);
      if (!game.red || !game.black)
        return {
          ok: false,
          error: 'invalid_body',
          message: 'red and black are required on the first post',
        };
      return {
        ok: true,
        changed: true,
        corrected: false,
        stale: false,
        board: {
          id: `${slug}-r3-b12`,
          round: 'r3',
          board: 12,
          plies: game.moves.length,
          status: game.status,
          result: game.result,
        },
      };
    },
    requestEval: async (id) => {
      evals.push(id);
    },
    now: () => now,
    origin: () => 'https://configured.test/',
    ...overrides,
  };
  const handler = createBroadcastPushHandler(deps);
  async function request(
    body: unknown = initial,
    options: {
      contentType?: string;
      auth?: string | null;
      method?: string;
      path?: string;
      raw?: string;
      length?: string;
    } = {},
  ) {
    const req = Readable.from([
      Buffer.from(options.raw ?? JSON.stringify(body)),
    ]) as IncomingMessage;
    req.method = options.method ?? 'POST';
    req.url = options.path ?? '/api/xiangqi/broadcast-push';
    req.headers = {
      'content-type': options.contentType ?? 'application/json',
      host: 'untrusted.test',
    };
    if (options.auth !== null) req.headers.authorization = options.auth ?? `Bearer ${credential}`;
    if (options.length) req.headers['content-length'] = options.length;
    let code = 0;
    let data = '';
    let headers: Record<string, string> = {};
    const res = {
      writeHead(s: number, h: Record<string, string>) {
        code = s;
        headers = h;
      },
      end(b: string) {
        data = b;
      },
    } as unknown as ServerResponse;
    const handled = await handler(
      {} as HttpApiContext,
      req,
      res,
      req.url,
      new URL(req.url, 'http://localhost'),
    );
    return { handled, code, headers, body: data ? JSON.parse(data) : null };
  }
  return {
    request,
    writes,
    evals,
    touches: () => touches,
    tick: () => {
      now += 1001;
    },
  };
}

test('push creates canonical coordinates, receipt clock, configured-origin URL and requests eval', async () => {
  const h = harness();
  const r = await h.request({
    ...initial,
    clock: { red: 100, black: 200 },
    timeControl: '90+30',
    seq: 2,
  });
  assert.equal(r.code, 200);
  assert.deepEqual(r.body, {
    ok: true,
    changed: true,
    corrected: false,
    stale: false,
    game: {
      round: 'r3',
      board: 12,
      plies: 2,
      status: 'live',
      result: '*',
      url: 'https://configured.test/broadcast/xiangqi/board/event-r3-b12',
    },
    notation: 'iccs',
  });
  assert.deepEqual((h.writes[0] as { moves: unknown }).moves, [
    { from: 'h3', to: 'e3' },
    { from: 'h10', to: 'g8' },
  ]);
  assert.deepEqual((h.writes[0] as { clock: unknown }).clock, {
    redMs: 100,
    blackMs: 200,
    at: 1000,
  });
  assert.deepEqual(h.evals, ['event-r3-b12']);
  assert.equal(h.touches(), 1);
});

test('authentication distinguishes absent/unknown/revoked tokens', async () => {
  for (const auth of [null, 'Basic bad', 'Bearer unknown'])
    assert.equal((await harness().request(initial, { auth })).body.error, 'unauthorized');
  const h = harness({
    findToken: async () => ({
      id: 'bpt_12345678',
      tourSlug: 'event',
      label: '',
      createdAt: new Date(),
      revokedAt: new Date(),
      lastUsedAt: null,
    }),
  });
  assert.equal((await h.request()).code, 403);
  assert.equal((await h.request()).body.error, 'token_revoked');
});

test('invalid fields and malformed JSON return 400 without applying', async () => {
  for (const patch of [
    { round: 0 },
    { round: '' },
    { round: 1.2 },
    { board: 0 },
    { board: 1.2 },
    { red: {} },
    { black: { name: 'B', federation: 'China' } },
    { moves: 4 },
    { moves: [3] },
    { status: 'complete' },
    { status: 'finished' },
    { result: 'draw' },
    { notation: 'other' },
    { seq: '2' },
    { clock: { red: -1, black: 3 } },
    { timeControl: 42 },
  ]) {
    const h = harness();
    const r = await h.request({ ...initial, ...patch });
    assert.equal(r.code, 400, JSON.stringify(patch));
    assert.equal(r.body.error, 'invalid_body');
    assert.equal(h.writes.length, 0);
  }
  for (const raw of ['{', 'null', '[]'])
    assert.equal((await harness().request(null, { raw })).code, 400);
});

test('body byte cap rejects before JSON parsing, including chunked bodies; ply cap precedes replay', async () => {
  for (const options of [{ raw: '{', length: '65537' }, { raw: ' '.repeat(65537) }]) {
    const h = harness();
    const r = await h.request(null, options);
    assert.equal(r.code, 413);
    assert.equal(r.body.error, 'too_large');
    assert.equal(h.writes.length, 0);
  }
  const r = await harness().request({ ...initial, moves: Array(1001).fill('h2e2') });
  assert.equal(r.code, 413);
  assert.equal(r.body.error, 'too_large');
});

test('notation errors carry atomic 1-based diagnostics and unknown notation is separate', async () => {
  const h = harness();
  const r = await h.request({ ...initial, moves: ['h2e2', 'h9h0'] });
  assert.equal(r.code, 422);
  assert.equal(r.body.error, 'illegal_move');
  assert.equal(r.body.ply, 2);
  assert.equal(r.body.move, 'h9h0');
  assert.equal(h.writes.length, 0);
  const unknown = await harness().request({ ...initial, moves: 'gibberish' });
  assert.equal(unknown.code, 422);
  assert.equal(unknown.body.error, 'unknown_notation');
});

test('polled event returns 409; status is read-only, returns test-event metadata and boards', async () => {
  const h = harness({
    getTour: async () => ({
      slug: 'event',
      name: 'Event',
      listed: true,
      sourceUrl: 'https://source.test',
      pollMode: 'auto',
    }),
    status: async () => ({ rounds: [{ id: 'r3', boards: [{ board: 12 }] }] }),
  });
  const r = await h.request();
  assert.equal(r.code, 409);
  assert.equal(r.body.error, 'event_not_pushable');
  const s = await h.request(null, { method: 'GET', path: '/api/xiangqi/broadcast-push/status' });
  assert.equal(s.code, 200);
  assert.equal(s.body.event.slug, 'event');
  assert.equal(s.body.test, false);
  assert.equal(s.body.rounds[0].boards[0].board, 12);
  assert.equal(h.touches(), 0);
  assert.equal(h.writes.length, 0);
  assert.equal(
    (await harness().request(null, { method: 'GET', path: '/api/xiangqi/broadcast-push/status' }))
      .body.test,
    true,
  );
});

test('board and token sliding windows return Retry-After and recover', async () => {
  const h = harness();
  await h.request();
  await h.request();
  const limited = await h.request();
  assert.equal(limited.code, 429);
  assert.equal(limited.body.error, 'rate_limited');
  assert.equal(limited.headers['Retry-After'], '1');
  h.tick();
  assert.equal((await h.request()).code, 200);
  const many = harness();
  for (let board = 1; board <= 50; board++)
    assert.equal((await many.request({ ...initial, board })).code, 200);
  assert.equal((await many.request({ ...initial, board: 51 })).code, 429);
});

test('PGN games apply independently, Round 3.12/White/TimeControl and standard-start policy', async () => {
  const raw =
    '[Round "3.12"]\n[White "R"]\n[Black "B"]\n[TimeControl "90+30"]\n[Result "1-0"]\n\n1. h2e2 h9g7 1-0\n\n[Round "3"]\n[Board "13"]\n[Red "R"]\n[Black "B"]\n\n1. h2e2 h9h0 *';
  const h = harness();
  const r = await h.request(null, { raw, contentType: 'application/x-chess-pgn' });
  assert.equal(r.code, 200);
  assert.equal(r.body.games.length, 2);
  assert.equal(r.body.games[0].ok, true);
  assert.equal(r.body.games[1].error, 'illegal_move');
  assert.equal(h.writes.length, 1);
  const game = h.writes[0] as {
    round: number;
    board: number;
    red: { name: string };
    status: string;
    timeControl: string;
  };
  assert.equal(game.round, 3);
  assert.equal(game.board, 12);
  assert.equal(game.red.name, 'R');
  assert.equal(game.status, 'finished');
  assert.equal(game.timeControl, '90+30');
  const fen = await harness().request(null, {
    raw: '[Round "1"]\n[Board "1"]\n[FEN "bad"]\n\n*',
    contentType: 'text/plain',
  });
  assert.equal(fen.code, 422);
  assert.equal(fen.body.error, 'unsupported_start_position');
});

test('success, validation, auth and internal failures never log the credential or raw exception', async (t) => {
  const output: string[] = [];
  for (const key of ['log', 'warn', 'error', 'info', 'debug'] as const)
    t.mock.method(console, key, (...args: unknown[]) => output.push(JSON.stringify(args)));
  await harness().request();
  await harness().request({ ...initial, moves: 'bad' });
  await harness().request(initial, { auth: null });
  const h = harness({
    apply: async () => {
      throw new Error(credential);
    },
  });
  const r = await h.request();
  assert.equal(r.code, 500);
  assert.equal(r.body.error, 'internal_error');
  assert.equal(output.join('').includes(credential), false, 'credential appeared in logger output');
  assert.equal(
    JSON.stringify(r.body).includes(credential),
    false,
    'credential appeared in error response',
  );
});

test('registered beside broadcasts and leaves the anonymous OpenAPI unchanged', async () => {
  const route = await import('./xiangqi-broadcast-push.js');
  const { routes } = await import('../http-api.js');
  assert.ok(routes.some((entry) => entry.tryHandle === route.tryHandle));
  const { buildOpenApiDocument } = await import('../openapi.js');
  assert.equal(
    JSON.stringify(buildOpenApiDocument('https://configured.test')).includes('/broadcast-push'),
    false,
  );
  const h = harness();
  assert.equal((await h.request(null, { path: '/api/other' })).handled, false);
  assert.equal((await h.request(null, { method: 'GET' })).code, 400);
  assert.equal((await h.request(initial, { contentType: 'image/png' })).body.error, 'invalid_body');
});

test('PGN over 1000 plies is too_large before legality checking, zero-ply games and all three notations work', async () => {
  const h = harness();
  const r = await h.request(null, {
    raw: `[Round "1"]\n[Board "1"]\n\n${Array(1001).fill('h2e2').join(' ')} *`,
    contentType: 'text/plain',
  });
  assert.equal(r.code, 413);
  assert.equal(r.body.error, 'too_large');
  assert.equal(h.writes.length, 0);
  assert.equal((await harness().request({ ...initial, moves: [] })).body.game.plies, 0);
  for (const [notation, moves] of [
    ['wxf', 'C2.5 H8+7'],
    ['chinese', '炮二平五 马8进7'],
    ['iccs', 'h2-e2 h9-g7'],
  ]) {
    const hh = harness();
    const result = await hh.request({ ...initial, notation, moves });
    assert.equal(result.code, 200);
    assert.deepEqual((hh.writes[0] as { moves: unknown }).moves, [
      { from: 'h3', to: 'e3' },
      { from: 'h10', to: 'g8' },
    ]);
  }
});

test('retries and stale responses reflect the saved board, with no eval request when unchanged', async () => {
  const h = harness({
    apply: async () => ({
      ok: true,
      changed: false,
      corrected: false,
      stale: true,
      board: {
        id: 'event-r3-b12',
        round: 'r3',
        board: 12,
        plies: 10,
        status: 'finished',
        result: '0-1',
      },
    }),
  });
  const r = await h.request();
  assert.equal(r.code, 200);
  assert.equal(r.body.changed, false);
  assert.equal(r.body.stale, true);
  assert.equal(r.body.game.plies, 10);
  assert.equal(r.body.game.status, 'finished');
  assert.equal(r.body.game.result, '0-1');
  assert.equal(h.evals.length, 0);
  const corrected = harness({
    apply: async () => ({
      ok: true,
      changed: true,
      corrected: true,
      stale: false,
      board: { id: 'event-r3-b12', round: 'r3', board: 12, plies: 2, status: 'live', result: '*' },
    }),
  });
  assert.equal((await corrected.request()).body.corrected, true);
  assert.equal(corrected.evals.length, 1);
});

test('PGN rate limits are independent per game, with Retry-After for a rejected sibling', async () => {
  const one = '[Round "3"]\n[Board "12"]\n[Red "R"]\n[Black "B"]\n\n1. h2e2 *';
  const h = harness();
  const r = await h.request(null, { raw: [one, one, one].join('\n\n'), contentType: 'text/plain' });
  assert.equal(r.code, 200);
  assert.equal(r.body.games.length, 3);
  assert.equal(r.body.games[0].ok, true);
  assert.equal(r.body.games[1].ok, true);
  assert.equal(r.body.games[2].error, 'rate_limited');
  assert.equal(r.headers['Retry-After'], '1');
  assert.equal(h.writes.length, 2);
});

test('metadata write failures yield exactly one error per PGN game', async () => {
  const h = harness({
    touchToken: async () => {
      throw new Error('database unavailable');
    },
  });
  const r = await h.request(null, {
    raw: '[Round "3"]\n[Board "12"]\n[Red "R"]\n[Black "B"]\n\n1. h2e2 *',
    contentType: 'text/plain',
  });
  assert.equal(r.code, 500);
  assert.equal(r.body.error, 'internal_error');
});

test('numeric, public and stored round identifiers share the board rate budget', async () => {
  const h = harness();
  assert.equal((await h.request()).code, 200);
  assert.equal((await h.request({ ...initial, round: 'r3' })).code, 200);
  assert.equal((await h.request({ ...initial, round: 'event-r3' })).code, 429);
});

test('PGN Red takes precedence even when blank, and Result tags use the documented values', async () => {
  for (const tags of ['[Red ""]\n[White "Fallback"]', '[Red "R"]\n[Result "invalid"]']) {
    const h = harness();
    const r = await h.request(null, {
      raw: `[Round "3"]\n[Board "12"]\n${tags}\n[Black "B"]\n\n1. h2e2 *`,
      contentType: 'text/plain',
    });
    assert.equal(r.code, 400);
    assert.equal(r.body.error, 'invalid_body');
    assert.equal(h.writes.length, 0);
  }
});
