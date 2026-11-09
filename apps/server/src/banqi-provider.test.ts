import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after } from 'node:test';
import {
  applyBanqiMove,
  type BanqiGameState,
  type BanqiMove,
  banqiMoveToEngineUci,
  banqiStateToEngineFen,
  createInitialBanqiState,
  isBanqiLegalMove,
} from '@mistboard/game';
import {
  checkedBanqiProviderEndpoint,
  createBanqiHttpProvider,
  createBanqiUciProvider,
} from './banqi-provider.js';
import { createBanqiProviderBridge } from './banqi-provider-bridge.js';
import { banqiProviderForLive } from './banqi-provider-live.js';
import {
  BANQI_PROVIDER_MAX_BYTES,
  BanqiProviderError,
  buildBanqiProviderRequest,
  providerResponse,
} from './banqi-provider-protocol.js';
import { playBanqiEngineMoveIfReady } from './server-banqi-engine.js';

const dir = mkdtempSync(join(tmpdir(), 'banqi-providers-'));
after(() => rmSync(dir, { recursive: true, force: true }));
let fixtureId = 0;
const TOKEN = 'test-only-auth-fixture';

function executable(onGo: string): string {
  const bin = join(dir, `engine-${++fixtureId}`);
  writeFileSync(
    bin,
    `#!${process.execPath}\nimport readline from 'node:readline';\nlet evalFile='';let position='';\nreadline.createInterface({input:process.stdin}).on('line',line=>{\nif(line.startsWith('position fen '))position=line;\nif(line.startsWith('setoption name EvalFile value '))evalFile=line.slice(30);\nif(line==='uci') console.log('id name Opaque fixture\\noption name NoProgressLimit type spin default 60 min 40 max 60\\noption name EvalFile type string default none\\nuciok');\nif(line==='isready') console.log('readyok');\nif(line.startsWith('go ')){const move=line.split('searchmoves ')[1].split(' ')[0];${onGo}}\n});\n`,
  );
  chmodSync(bin, 0o755);
  return bin;
}

function request(budgetMs = 1500) {
  return buildBanqiProviderRequest({
    state: createInitialBanqiState('test-game', undefined, {
      noProgressLimit: 60,
      chaseRule: 'repetition',
    }),
    requestId: `request-${++fixtureId}`,
    engineId: 'test-engine',
    nowMs: Date.now(),
    budgetMs,
    remainingMs: 300_000,
    incrementMs: 5000,
    nodes: 64,
  });
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return `http://127.0.0.1:${address.port}/turn`;
}

async function close(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((done, reject) =>
    server.close((error) => (error ? reject(error) : done())),
  );
}

function code(expected: string) {
  return (error: unknown): boolean =>
    error instanceof BanqiProviderError &&
    error.code === expected &&
    !error.message.includes(TOKEN);
}

test('opaque UCI executable and authenticated local HTTP bridge return the same validated move and real score', async () => {
  const bin = executable(
    "console.log('info depth 2 score cp 17 nodes 64 pv '+move);console.log('bestmove '+move);",
  );
  const direct = createBanqiUciProvider({ bin });
  const bridge = createBanqiProviderBridge(direct, TOKEN);
  const endpoint = await listen(bridge);
  try {
    const remote = createBanqiHttpProvider({ endpoint, token: TOKEN, allowLocalhostHttp: true });
    const turn = request();
    const first = await direct.turn(turn);
    const second = await remote.turn(turn);
    assert.deepEqual(second, first);
    assert.equal(first.analysis?.score.type, 'cp');
    const room = {
      id: 'live-bridge',
      events: [],
      projection: {
        state: createInitialBanqiState('live-bridge', undefined, {
          noProgressLimit: 60,
          chaseRule: 'repetition',
        }),
        seats: { red: 'misty-banqi', black: 'human' },
        clock: null,
      },
    };
    const appended: string[] = [];
    const ctx = {
      appendEvent: async (_room: unknown, event: { type: string; move?: BanqiMove }) => {
        assert.ok(event.move && isBanqiLegalMove(room.projection.state, event.move));
        room.projection.state = applyBanqiMove(room.projection.state, event.move);
        appended.push(event.type);
        return appended.length;
      },
      broadcastEventAppended: () => {},
    };
    await playBanqiEngineMoveIfReady(
      ctx as never,
      room as never,
      banqiProviderForLive(remote, 'opaque-fixture-v1'),
    );
    assert.deepEqual(appended, ['move-played']);
    assert.equal(room.projection.state.ply, 1);
    assert.equal(
      (
        await fetch(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(turn),
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await fetch(endpoint, {
          method: 'POST',
          headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
          body: '{"hiddenDeal":[]}',
        })
      ).status,
      400,
    );
  } finally {
    await close(bridge);
  }
});

test('native move-only executable has no evaluation and inherits no service environment', async () => {
  const bin = executable(
    "console.log('bestmove '+(process.env.BANQI_PROVIDER_TEST_PRIVATE?'invalid':move));",
  );
  process.env.BANQI_PROVIDER_TEST_PRIVATE = 'fixture-value';
  try {
    const result = await createBanqiUciProvider({ bin }).turn(request());
    assert.equal(result.analysis, undefined);
  } finally {
    delete process.env.BANQI_PROVIDER_TEST_PRIVATE;
  }
});

test('operator EvalFile reaches only the native process, never the shared turn payload', async () => {
  const evalFile = join(dir, 'operator-model.nnue');
  const bin = executable(
    `console.log('bestmove '+(evalFile===${JSON.stringify(evalFile)}?move:'invalid'));`,
  );
  const direct = createBanqiUciProvider({ bin, evalFile });
  const bridge = createBanqiProviderBridge(direct, TOKEN);
  try {
    const endpoint = await listen(bridge);
    const remote = createBanqiHttpProvider({ endpoint, token: TOKEN, allowLocalhostHttp: true });
    const turn = request();
    assert.ok(!JSON.stringify(turn).includes(evalFile));
    const result = await remote.turn(turn);
    assert.ok(turn.legalMoves.includes(result.move));
    assert.ok(!JSON.stringify(result).includes(evalFile));
    assert.throws(
      () => createBanqiUciProvider({ bin, evalFile: '/tmp/model\nquit' }),
      BanqiProviderError,
    );
  } finally {
    await close(bridge);
  }
});

test('native stateless resume requires the complete quiet replay window', async () => {
  const base: BanqiGameState = {
    id: 'resume-game',
    board: {
      a1: { color: 'red', role: 'chariot', faceDown: false },
      h4: { color: 'black', role: 'chariot', faceDown: false },
      d2: { color: 'red', role: 'horse', faceDown: true },
    },
    status: { type: 'playing', turn: 'red' },
    ply: 10,
    firstColor: 'red',
    moveNumber: 6,
    noProgressClock: 0,
    repCounts: {},
    captures: [],
    noProgressLimit: 60,
    chaseRule: 'repetition',
  };
  const moves = [
    { from: 'a1', to: 'b1' },
    { from: 'h4', to: 'g4' },
  ] as const;
  const state = moves.reduce((current, move) => applyBanqiMove(current, move), base);
  const bin = executable(
    "console.log('bestmove '+(position.endsWith('moves a0b0 h3g3')?move:'invalid'));",
  );
  const native = createBanqiUciProvider({ bin });
  const input = {
    state,
    requestId: 'resume-turn',
    engineId: 'test-engine',
    nowMs: Date.now(),
    budgetMs: 1500,
    remainingMs: 300_000,
    incrementMs: 5000,
  };
  await assert.rejects(native.turn(buildBanqiProviderRequest(input)), code('invalid-request'));
  const turn = buildBanqiProviderRequest({
    ...input,
    repetitionWindow: { fen: banqiStateToEngineFen(base), moves: moves.map(banqiMoveToEngineUci) },
  });
  const first = await native.turn(turn);
  const resumed = await native.turn(turn);
  assert.deepEqual(resumed, first, 'a fresh process reconstructs the same public history');
});

test('native cancellation/output limits/early-exit sanitize failures and free admission', async () => {
  const stopped = createBanqiUciProvider({ bin: executable('setInterval(()=>{},1000);') });
  await assert.rejects(stopped.turn(request(50)), code('deadline'));
  const controller = new AbortController();
  const pending = stopped.turn(request(), controller.signal);
  controller.abort();
  await assert.rejects(pending, code('cancelled'));
  const noisy = createBanqiUciProvider({
    bin: executable("process.stdout.write('x'.repeat(100000));"),
  });
  await assert.rejects(noisy.turn(request()), code('transport'));
  const crashed = createBanqiUciProvider({
    bin: executable(`console.error(${JSON.stringify(TOKEN)});process.exit(2);`),
  });
  await assert.rejects(crashed.turn(request()), code('transport'));
});

test('HTTP endpoints require HTTPS except explicit numeric loopback testing', () => {
  for (const endpoint of [
    'http://example.com/turn',
    'file:///tmp/a',
    'https://user:pass@example.com/turn',
    'https://example.com/turn?token=x',
    'https://example.com/turn#x',
  ])
    assert.throws(() => checkedBanqiProviderEndpoint(endpoint, true), BanqiProviderError);
  assert.throws(
    () => checkedBanqiProviderEndpoint('http://127.0.0.1:3001/turn'),
    BanqiProviderError,
  );
  assert.equal(checkedBanqiProviderEndpoint('https://example.com/turn').protocol, 'https:');
  assert.equal(
    checkedBanqiProviderEndpoint('http://127.0.0.1:3001/turn', true).hostname,
    '127.0.0.1',
  );
});

test('HTTP rejects mismatched, illegal, malformed, oversized and redirected replies without exposing bodies', async () => {
  let mode = 'valid';
  let redirectCalls = 0;
  const destination = createServer((_req, res) => {
    redirectCalls += 1;
    res.end();
  });
  const redirected = await listen(destination);
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const turn = JSON.parse(Buffer.concat(chunks).toString());
    res.setHeader('content-type', 'application/json');
    const result = providerResponse(turn, turn.legalMoves[0]);
    if (mode === 'mismatch') result.requestId = 'wrong';
    if (mode === 'ply') result.ply += 1;
    if (mode === 'illegal') result.move = 'a0b0';
    if (mode === 'redirect') {
      res.writeHead(302, { location: redirected });
      res.end();
      return;
    }
    if (mode === 'malformed') {
      res.end(TOKEN);
      return;
    }
    if (mode === 'oversized') {
      res.write(' '.repeat(BANQI_PROVIDER_MAX_BYTES));
      res.end(TOKEN);
      return;
    }
    res.end(JSON.stringify(result));
  });
  const endpoint = await listen(server);
  const provider = createBanqiHttpProvider({ endpoint, token: TOKEN, allowLocalhostHttp: true });
  try {
    for (const [next, expected] of [
      ['mismatch', 'mismatched-response'],
      ['ply', 'mismatched-response'],
      ['illegal', 'illegal-move'],
      ['malformed', 'invalid-response'],
      ['oversized', 'oversized'],
      ['redirect', 'transport'],
    ]) {
      mode = next!;
      await assert.rejects(provider.turn(request()), code(expected!));
    }
    assert.equal(redirectCalls, 0);
  } finally {
    await close(server);
    await close(destination);
  }
});

test('one absolute deadline covers queued admission and HTTP body, with bounded concurrency', async () => {
  let active = 0;
  let peak = 0;
  let calls = 0;
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const turn = JSON.parse(Buffer.concat(chunks).toString());
    calls += 1;
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((done) => setTimeout(done, 80));
    active -= 1;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(providerResponse(turn, turn.legalMoves[0])));
  });
  const provider = createBanqiHttpProvider({
    endpoint: await listen(server),
    token: TOKEN,
    allowLocalhostHttp: true,
    concurrency: 1,
  });
  try {
    const first = provider.turn(request());
    const second = provider.turn(request(20));
    await assert.rejects(second, code('deadline'));
    await first;
    assert.equal(calls, 1, 'expired queued request never reaches endpoint');
    await provider.turn(request());
    assert.equal(peak, 1);
  } finally {
    await close(server);
  }

  const hanging = createServer(async (req, res) => {
    for await (const _chunk of req) {
    }
    res.setHeader('content-type', 'application/json');
    res.write('{');
  });
  try {
    const body = createBanqiHttpProvider({
      endpoint: await listen(hanging),
      token: TOKEN,
      allowLocalhostHttp: true,
    });
    await assert.rejects(body.turn(request(40)), code('deadline'));
  } finally {
    await close(hanging);
  }
});

test('dispatch snapshots caller state and checks the reply against that original turn', async () => {
  let observedId = '';
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const turn = JSON.parse(Buffer.concat(chunks).toString());
    observedId = turn.requestId;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(providerResponse(turn, turn.legalMoves[0])));
  });
  try {
    const provider = createBanqiHttpProvider({
      endpoint: await listen(server),
      token: TOKEN,
      allowLocalhostHttp: true,
    });
    const mutable = structuredClone(request());
    const original = mutable.requestId;
    const pending = provider.turn(mutable);
    mutable.requestId = 'changed-after-dispatch';
    mutable.legalMoves = [];
    const result = await pending;
    assert.equal(observedId, original);
    assert.equal(result.requestId, original);
  } finally {
    await close(server);
  }
});
