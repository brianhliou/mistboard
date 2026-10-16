import assert from 'node:assert/strict';
import type { IncomingMessage, ServerResponse } from 'node:http';
import test from 'node:test';
import { createInitialXiangqiState, parseStandardXiangqiFen } from '@mistboard/game';
import { setXiangqiTablebaseForTests, tryHandle } from './routes/xiangqi-tablebase.js';
import { createXiangqiTablebase, xiangqiTablebaseKey } from './xiangqi-tablebase.js';

// Horse vs elephant caught on one flank, black to move: one elephant move holds
// the draw, the other loses (chessdb.cn's answer, 2026-10-07).
const FEN = '3k5/9/5N3/9/2b6/9/9/9/4K4/9 b - - 0 1';
const ANSWER =
  'move:c5a7,score:-29980,rank:0,note:? (L-M-0020)|move:c5e7,score:0,rank:2,note:! (D-M-0000)';

function state(fen = FEN) {
  const parsed = parseStandardXiangqiFen(fen);
  assert.ok(parsed.ok);
  return parsed.state;
}

/** A fake chessdb: answers from a script and records every URL it was asked. */
function fakeChessdb(answer: (url: string, init?: RequestInit) => Promise<Response>) {
  const urls: string[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    urls.push(url);
    return answer(url, init);
  }) as typeof globalThis.fetch;
  return { fetch, urls };
}

// Three more positions with the same material (the red general elsewhere).
const OTHER_FENS = [
  '3k5/9/5N3/9/2b6/9/9/9/5K3/9 b - - 0 1',
  '3k5/9/5N3/9/2b6/9/9/9/9/4K4 b - - 0 1',
  '3k5/9/5N3/9/2b6/9/9/9/9/5K3 b - - 0 1',
];

const text =
  (body: string, status = 200) =>
  async () =>
    new Response(body, { status });
const instant = async () => {};

test('tablebase: an exact answer is returned and the second lookup is a cache hit', async () => {
  const db = fakeChessdb(text(ANSWER));
  const tb = createXiangqiTablebase({ fetch: db.fetch, sleep: instant });
  const first = await tb.lookup(state());
  assert.equal(first.status, 'exact');
  assert.ok(first.status === 'exact');
  assert.deepEqual(
    first.moves.map((m) => `${m.from}${m.to} ${m.result}`),
    ['c6e8 draw', 'c6a8 loss'],
  );
  // Clocks are not part of the key: the same position later in a game hits.
  const again = await tb.lookup(state('3k5/9/5N3/9/2b6/9/9/9/4K4/9 b - - 12 40'));
  assert.deepEqual(again, first);
  assert.equal(db.urls.length, 1);
  assert.equal(tb.stats().hits, 1);
  // Asked over https, in the engine dialect (w/b), no clock fields.
  assert.equal(
    db.urls[0],
    `https://www.chessdb.cn/chessdb.php?action=queryall&board=${encodeURIComponent('3k5/9/5N3/9/2b6/9/9/9/4K4/9 b')}`,
  );
});

test('tablebase: a slow chessdb times out to no data, then cools down', async (t) => {
  // AbortSignal.timeout's timer is unref'd, and the fake fetch holds no handle,
  // so nothing else keeps the event loop alive while the lookup waits for it:
  // on Node 22 (CI) the runner cancels the file mid-await.
  const keepAlive = setInterval(() => {}, 1_000);
  t.after(() => clearInterval(keepAlive));
  let now = 1_000;
  const db = fakeChessdb(
    (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      }),
  );
  const tb = createXiangqiTablebase({
    fetch: db.fetch,
    sleep: instant,
    now: () => now,
    timeoutMs: 20,
    cooldownMs: 10_000,
  });
  assert.deepEqual(await tb.lookup(state()), { status: 'none' });
  // Inside the cooldown: no request at all, still no data.
  now += 5_000;
  assert.deepEqual(await tb.lookup(state()), { status: 'none' });
  assert.equal(db.urls.length, 1);
  // A failure is never cached: after the cooldown it asks again.
  now += 6_000;
  await tb.lookup(state());
  assert.equal(db.urls.length, 2);
});

test('tablebase: malformed, inexact and rate-limited answers are no data', async () => {
  for (const body of [
    'unknown',
    '<html>gateway</html>',
    ANSWER.replace('(L-M-0020)', '(12-03)'),
    'move:c5a7,score:-29980,rank:0,note:? (L-M-0020)',
  ]) {
    const tb = createXiangqiTablebase({ fetch: fakeChessdb(text(body)).fetch, sleep: instant });
    assert.deepEqual(await tb.lookup(state()), { status: 'none' }, body);
  }
  // A rate-limit answer and a 5xx trip the cooldown and are not cached.
  for (const answer of [text('rate limit exceeded'), text('oops', 503)]) {
    let now = 0;
    const db = fakeChessdb(answer);
    const tb = createXiangqiTablebase({
      fetch: db.fetch,
      sleep: instant,
      now: () => now,
      cooldownMs: 1_000,
    });
    assert.deepEqual(await tb.lookup(state()), { status: 'none' });
    await tb.lookup(state());
    assert.equal(db.urls.length, 1, 'cooling down');
    now += 2_000;
    await tb.lookup(state());
    assert.equal(db.urls.length, 2, 'asks again after the cooldown');
    assert.equal(tb.stats().entries, 0);
  }
});

test('tablebase: middlegame material never reaches chessdb', async () => {
  const db = fakeChessdb(text(ANSWER));
  const tb = createXiangqiTablebase({ fetch: db.fetch, sleep: instant });
  assert.deepEqual(await tb.lookup(createInitialXiangqiState('t')), { status: 'none' });
  assert.equal(db.urls.length, 0);
});

test('tablebase: requests are spaced, deduplicated, and a deep queue answers none', async () => {
  const now = 0;
  const waits: number[] = [];
  const db = fakeChessdb(text(ANSWER));
  const tb = createXiangqiTablebase({
    fetch: db.fetch,
    now: () => now,
    sleep: async (ms) => {
      waits.push(ms);
    },
    minIntervalMs: 400,
    maxQueueMs: 900,
  });
  // Same position twice at once: one request.
  const [a, b] = await Promise.all([tb.lookup(state()), tb.lookup(state())]);
  assert.deepEqual(a, b);
  assert.equal(db.urls.length, 1);
  // Three more distinct positions at the same instant: slots at +400, +800, then
  // +1200 is past the 900ms queue bound and answers none without asking.
  const results = await Promise.all(OTHER_FENS.map((fen) => tb.lookup(state(fen))));
  assert.deepEqual(waits, [400, 800]);
  assert.equal(db.urls.length, 3);
  assert.deepEqual(results[2], { status: 'none' });
});

test('tablebase: the cache is bounded', async () => {
  const db = fakeChessdb(text('unknown'));
  const tb = createXiangqiTablebase({ fetch: db.fetch, sleep: instant, cacheEntries: 2 });
  for (const fen of OTHER_FENS) await tb.lookup(state(fen));
  assert.equal(tb.stats().entries, 2);
});

test('tablebase key drops clocks and uses the engine side token', () => {
  assert.equal(xiangqiTablebaseKey(state()), '3k5/9/5N3/9/2b6/9/9/9/4K4/9 b');
});

function captureResponse() {
  const capture = {
    statusCode: 0,
    headers: {} as Record<string, string | string[]>,
    body: '',
    writeHead(statusCode: number, headers: Record<string, string | string[]> = {}) {
      capture.statusCode = statusCode;
      capture.headers = headers;
      return capture;
    },
    end(chunk?: string) {
      if (chunk) capture.body += chunk;
      return capture;
    },
  };
  return capture;
}

async function get(path: string) {
  const response = captureResponse();
  const url = new URL(`http://test.local${path}`);
  const handled = await tryHandle(
    {},
    {
      method: 'GET',
      headers: {},
      socket: { remoteAddress: '203.0.113.9' },
    } as never as IncomingMessage,
    response as never as ServerResponse,
    url.pathname,
    url,
  );
  return { handled, ...response, json: response.body ? JSON.parse(response.body) : null };
}

test('tablebase route: exact passthrough, none on no data, 400 on a bad FEN', async () => {
  const db = fakeChessdb(
    async (url) => new Response(url.includes(encodeURIComponent('4K4/9 b')) ? ANSWER : 'unknown'),
  );
  setXiangqiTablebaseForTests(createXiangqiTablebase({ fetch: db.fetch, sleep: instant }));
  try {
    const exact = await get(`/api/xiangqi/tablebase?fen=${encodeURIComponent(FEN)}`);
    assert.equal(exact.handled, true);
    assert.equal(exact.statusCode, 200);
    assert.equal(exact.json.status, 'exact');
    assert.equal(exact.json.result, 'draw');
    assert.match(String(exact.headers['cache-control']), /max-age=86400/);

    const none = await get(
      `/api/xiangqi/tablebase?fen=${encodeURIComponent(OTHER_FENS[0] as string)}`,
    );
    assert.deepEqual(none.json, { status: 'none' });

    const bad = await get('/api/xiangqi/tablebase?fen=not-a-fen');
    assert.equal(bad.statusCode, 400);
    assert.deepEqual(bad.json, { error: 'invalid_position' });

    const other = await get('/api/xiangqi/explorer?fen=x');
    assert.equal(other.handled, false);
  } finally {
    setXiangqiTablebaseForTests(null);
  }
});
