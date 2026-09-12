// Tests for the shared prod-smoke lib (scripts/lib/) and the variant-smoke
// runner's config dispatch. Rides `npm run test:tooling`.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';

import {
  DEFAULT_PROD_BASE_URL,
  normalizeBaseUrl,
  resolveBaseUrl,
  revisionMatches,
} from './lib/base-url.mjs';
import { fetchJson, fetchText, parseJsonResponse } from './lib/http.mjs';
import { isSandboxLaunchFailure } from './lib/launch-browser.mjs';
import {
  formatHelp,
  parsePositiveInteger,
  parseSmokeArgs,
  requiredValue,
} from './lib/smoke-args.mjs';
import { evaluateSmokeMessage } from './lib/variant-smoke.mjs';
import { matchesEngineSeat, VARIANT_SMOKE_CONFIGS } from './lib/variant-smoke-configs.mjs';

// ── smoke-args ───────────────────────────────────────────────────────────────

const ARG_SPEC = {
  usage: 'npm run prod:smoke:test -- [options]',
  flags: {
    '--base': { key: 'baseUrl', placeholder: '<url>', help: 'Base URL' },
    '--timeout-ms': {
      key: 'timeoutMs',
      placeholder: '<ms>',
      kind: 'positive-int',
      help: 'Timeout',
    },
    '--engine': { key: 'engineIds', placeholder: '<id>', repeatable: true, help: 'Engine id' },
  },
};

test('parseSmokeArgs: defaults are null / empty array', () => {
  const parsed = parseSmokeArgs([], ARG_SPEC);
  assert.deepEqual(parsed, { baseUrl: null, timeoutMs: null, engineIds: [] });
});

test('parseSmokeArgs: parses string, positive-int, and repeatable flags', () => {
  const parsed = parseSmokeArgs(
    ['--base', 'https://example.com', '--timeout-ms', '5000', '--engine', 'a', '--engine', 'b'],
    ARG_SPEC,
  );
  assert.deepEqual(parsed, {
    baseUrl: 'https://example.com',
    timeoutMs: 5000,
    engineIds: ['a', 'b'],
  });
});

test('parseSmokeArgs: unknown argument throws', () => {
  assert.throws(() => parseSmokeArgs(['--nope'], ARG_SPEC), /unknown argument: --nope/);
});

test('parseSmokeArgs: missing or flag-like value throws', () => {
  assert.throws(() => parseSmokeArgs(['--base'], ARG_SPEC), /--base requires a value/);
  assert.throws(
    () => parseSmokeArgs(['--base', '--timeout-ms'], ARG_SPEC),
    /--base requires a value/,
  );
});

test('parseSmokeArgs: non-positive-int timeout throws', () => {
  for (const bad of ['0', '-5', '1.5', 'soon']) {
    assert.throws(
      () => parseSmokeArgs(['--timeout-ms', bad], ARG_SPEC),
      /--timeout-ms must be a positive integer/,
    );
  }
});

test('parseSmokeArgs: --help prints usage and exits 0', () => {
  const exits = [];
  const logs = [];
  const original = console.log;
  console.log = (line) => logs.push(line);
  try {
    parseSmokeArgs(['--help'], ARG_SPEC, { exit: (code) => exits.push(code) });
  } finally {
    console.log = original;
  }
  assert.deepEqual(exits, [0]);
  assert.match(logs.join('\n'), /Usage: npm run prod:smoke:test -- \[options\]/);
  assert.match(logs.join('\n'), /--timeout-ms <ms>/);
});

test('formatHelp: includes description paragraph when provided', () => {
  const help = formatHelp({ ...ARG_SPEC, description: 'A test smoke.' });
  assert.match(help, /A test smoke\.\n\nOptions:/);
});

test('requiredValue / parsePositiveInteger helpers', () => {
  assert.equal(requiredValue(['--x', 'v'], 1, '--x'), 'v');
  assert.throws(() => requiredValue(['--x'], 1, '--x'), /--x requires a value/);
  assert.equal(parsePositiveInteger('42', '--n'), 42);
  assert.throws(() => parsePositiveInteger('0', '--n'), /--n must be a positive integer/);
});

// ── base-url ─────────────────────────────────────────────────────────────────

test('resolveBaseUrl: explicit beats env beats default', () => {
  const env = { MISTBOARD_BASE_URL: 'https://env.example.com' };
  assert.equal(
    resolveBaseUrl('https://explicit.example.com', { env }).href,
    'https://explicit.example.com/',
  );
  assert.equal(resolveBaseUrl(null, { env }).href, 'https://env.example.com/');
  assert.equal(resolveBaseUrl(null, { env: {} }).href, `${DEFAULT_PROD_BASE_URL}/`);
});

test('normalizeBaseUrl: strips path, query, and hash', () => {
  const url = normalizeBaseUrl('https://example.com/some/path?query=1#frag');
  assert.equal(url.href, 'https://example.com/');
});

test('revisionMatches: exact and prefix in either direction', () => {
  assert.equal(revisionMatches('abcdef123456', 'abcdef123456'), true);
  assert.equal(revisionMatches('abcdef123456', 'abcdef'), true);
  assert.equal(revisionMatches('abcdef', 'abcdef123456'), true);
  assert.equal(revisionMatches('abcdef', '123456'), false);
});

// ── http ─────────────────────────────────────────────────────────────────────

async function withServer(handler, run) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('fetchJson: parses JSON body and reports status', async () => {
  await withServer(
    (_req, res) => {
      res.writeHead(201, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ roomId: 'r1' }));
    },
    async (origin) => {
      const result = await fetchJson(new URL('/api/rooms', origin), { timeoutMs: 2_000 });
      assert.deepEqual(result, { status: 201, body: { roomId: 'r1' } });
    },
  );
});

test('fetchJson: empty body yields null, non-JSON names the path', async () => {
  await withServer(
    (req, res) => {
      if (req.url === '/empty') {
        res.writeHead(204);
        res.end();
        return;
      }
      res.writeHead(502, { 'content-type': 'text/html' });
      res.end('<html>bad gateway</html>');
    },
    async (origin) => {
      const empty = await fetchJson(new URL('/empty', origin), { timeoutMs: 2_000 });
      assert.deepEqual(empty, { status: 204, body: null });
      await assert.rejects(
        fetchJson(new URL('/garbage', origin), { timeoutMs: 2_000 }),
        /\/garbage returned non-JSON response: <html>bad gateway<\/html>/,
      );
    },
  );
});

test('fetchJson: aborts on timeout', async () => {
  await withServer(
    () => {
      /* never respond */
    },
    async (origin) => {
      await assert.rejects(fetchJson(new URL('/hang', origin), { timeoutMs: 100 }), (err) => {
        assert.equal(err.name, 'AbortError');
        return true;
      });
    },
  );
});

test('fetchText: returns raw body', async () => {
  await withServer(
    (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<title>Mistboard</title>');
    },
    async (origin) => {
      const result = await fetchText(new URL('/', origin), { timeoutMs: 2_000 });
      assert.equal(result.status, 200);
      assert.match(result.body, /Mistboard/);
    },
  );
});

test('parseJsonResponse: empty -> null, JSON -> value, garbage -> error naming url', async () => {
  assert.equal(await parseJsonResponse(new Response('')), null);
  assert.deepEqual(await parseJsonResponse(new Response('{"ok":true}')), { ok: true });
  await assert.rejects(parseJsonResponse(new Response('nope')), /non-JSON response from/);
});

// ── variant-smoke config dispatch ────────────────────────────────────────────

test('variant configs: every entry is complete and self-consistent', () => {
  const expected = {
    fortress: 'fortress-xiangqi',
    duck: 'duck-xiangqi',
    dxq: 'dark-xiangqi',
    banqi: 'banqi',
    jieqi: 'jieqi',
    jungle: 'jungle',
    'jungle-flip': 'jungle-flip',
    xiangqi: 'xiangqi',
  };
  assert.deepEqual(Object.keys(VARIANT_SMOKE_CONFIGS).sort(), Object.keys(expected).sort());
  for (const [key, config] of Object.entries(VARIANT_SMOKE_CONFIGS)) {
    assert.equal(config.name, key);
    assert.equal(config.gameSpecId, expected[key]);
    assert.equal(typeof config.label, 'string');
    assert.match(config.usage, /^npm run prod:smoke:/);
    assert.ok(Number.isInteger(config.defaultTimeoutMs) && config.defaultTimeoutMs > 0);
    assert.ok(
      config.engineSeat.equals !== undefined ||
        config.engineSeat.prefix !== undefined ||
        config.engineSeat.prefixes !== undefined,
      `${key} engineSeat needs equals, prefix, or prefixes`,
    );
  }
});

test('engine seat matching is version-agnostic for versioned engine ids', () => {
  // bfb02b95's lesson: a version bump must not break the smoke.
  const dxq = VARIANT_SMOKE_CONFIGS.dxq.engineSeat;
  assert.equal(matchesEngineSeat(dxq, 'python-fdx-v1.1'), true);
  assert.equal(matchesEngineSeat(dxq, 'python-fdx-v9.9'), true);
  assert.equal(matchesEngineSeat(dxq, 'python-dmx-v1.0'), false);

  // Jieqi accepts any rung, not just the 'strongest' one that fronts PvE today.
  const jieqi = VARIANT_SMOKE_CONFIGS.jieqi.engineSeat;
  assert.equal(matchesEngineSeat(jieqi, 'pikafish-jieqi-strongest'), true);
  assert.equal(matchesEngineSeat(jieqi, 'pikafish-jieqi-amateur'), true);
  assert.equal(matchesEngineSeat(jieqi, 'pikafish-xiangqi-level-8'), false);

  // Jungle must NOT accept Flip Jungle's engine: 'misty-jungle' is a prefix of
  // 'misty-jungle-flip', so the shorter prefix would silently pass on the
  // wrong variant's bot.
  const jungle = VARIANT_SMOKE_CONFIGS.jungle.engineSeat;
  assert.equal(matchesEngineSeat(jungle, 'misty-jungle-level-2'), true);
  assert.equal(matchesEngineSeat(jungle, 'misty-jungle-level-9'), true);
  assert.equal(matchesEngineSeat(jungle, 'misty-jungle-flip'), false);

  // Xiangqi is served by two engine families; either is a healthy default.
  const xiangqi = VARIANT_SMOKE_CONFIGS.xiangqi.engineSeat;
  assert.equal(matchesEngineSeat(xiangqi, 'fairy-stockfish-xiangqi-level-1'), true);
  assert.equal(matchesEngineSeat(xiangqi, 'fairy-stockfish-xiangqi-level-8'), true);
  assert.equal(matchesEngineSeat(xiangqi, 'pikafish-xiangqi-level-8'), true);
  assert.equal(matchesEngineSeat(xiangqi, 'misty-banqi'), false);

  // Fortress is prefix-matched across the whole ladder: the default rung is a
  // product knob (Level 4 since the bot consolidation), and the retired tier
  // ids keep matching for any environment still pinned to them.
  const fortress = VARIANT_SMOKE_CONFIGS.fortress.engineSeat;
  assert.equal(matchesEngineSeat(fortress, 'fairy-stockfish-fortress-xiangqi-level-4'), true);
  assert.equal(matchesEngineSeat(fortress, 'fairy-stockfish-fortress-xiangqi-strong'), true);
  assert.equal(matchesEngineSeat(fortress, 'fairy-stockfish-xiangqi-level-4'), false);

  assert.equal(matchesEngineSeat(dxq, undefined), false);
  assert.equal(matchesEngineSeat(dxq, 42), false);
});

// ── variant-smoke message evaluation ─────────────────────────────────────────

const DXQ = VARIANT_SMOKE_CONFIGS.dxq;
const CONTEXT = () => ({ roomId: 'room-1', sentAbort: false });

function playingState(overrides = {}) {
  return {
    status: { type: 'playing', turn: 'black' },
    moveNumber: 1,
    lastMove: { from: 'a1', to: 'a2' },
    ...overrides,
  };
}

test('evaluateSmokeMessage: hello with wrong seat fails', () => {
  const effects = evaluateSmokeMessage(DXQ, CONTEXT(), { type: 'hello', seat: 'white' });
  assert.deepEqual(effects, [{ kind: 'failure', message: 'expected black seat, got white' }]);
});

test('evaluateSmokeMessage: hello captures the seat token', () => {
  const effects = evaluateSmokeMessage(DXQ, CONTEXT(), {
    type: 'hello',
    seat: 'black',
    seatToken: 'tok',
  });
  assert.deepEqual(effects, [{ kind: 'seat-token', seatToken: 'tok' }]);
});

test('evaluateSmokeMessage: messages without state are inert', () => {
  assert.deepEqual(evaluateSmokeMessage(DXQ, CONTEXT(), { type: 'pong' }), []);
});

test('evaluateSmokeMessage: engine opening move triggers abort with reply state', () => {
  const effects = evaluateSmokeMessage(DXQ, CONTEXT(), {
    seats: { red: 'python-fdx-v1.1' },
    state: playingState(),
  });
  assert.deepEqual(effects, [
    {
      kind: 'abort',
      engineReplyState: { moveNumber: 1, turn: 'black', lastMove: { from: 'a1', to: 'a2' } },
    },
  ]);
});

test('evaluateSmokeMessage: non-matching engine seat never aborts', () => {
  const effects = evaluateSmokeMessage(DXQ, CONTEXT(), {
    seats: { red: 'some-other-engine' },
    state: playingState(),
  });
  assert.deepEqual(effects, []);
});

test('evaluateSmokeMessage: after abort was sent, aborted status finishes ok', () => {
  const context = { roomId: 'room-1', sentAbort: true };
  const effects = evaluateSmokeMessage(DXQ, context, {
    state: { status: { type: 'aborted' }, moveNumber: 1 },
  });
  assert.deepEqual(effects, [{ kind: 'success', finalStatus: { type: 'aborted' } }]);
});

test('evaluateSmokeMessage: finished before completion fails and names the room', () => {
  const effects = evaluateSmokeMessage(DXQ, CONTEXT(), {
    state: { status: { type: 'finished', reason: 'checkmate' }, moveNumber: 3 },
  });
  assert.equal(effects.length, 1);
  assert.equal(effects[0].kind, 'failure');
  assert.match(effects[0].message, /DXQ game room-1 finished before smoke completed/);
});

// ── launch-browser ───────────────────────────────────────────────────────────

// Verbatim shape of the failure an agent harness produces: Playwright's generic
// closed-target text, with the real cause buried in the browser logs.
const SANDBOX_LAUNCH_ERROR = [
  'browserType.launch: Target page, context or browser has been closed',
  'Browser logs:',
  '',
  '<launching> /Users/x/Library/Caches/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell --no-sandbox --headless',
  '<launched> pid=8193',
  '[pid=8193][err] [0726/150710.229832:FATAL:base/apple/mach_port_rendezvous_mac.cc:159] Check failed: kr == KERN_SUCCESS. bootstrap_',
].join('\n');

test('isSandboxLaunchFailure: recognises the seatbelt Mach-registration wall', () => {
  assert.equal(isSandboxLaunchFailure(new Error(SANDBOX_LAUNCH_ERROR)), true);
});

test('isSandboxLaunchFailure: matches when the cause only shows up in the stack', () => {
  const error = new Error('browserType.launch: Target page, context or browser has been closed');
  error.stack = `${error.message}\n${SANDBOX_LAUNCH_ERROR}`;
  assert.equal(isSandboxLaunchFailure(error), true);
});

test('isSandboxLaunchFailure: an ordinary browser crash is not the sandbox wall', () => {
  const crash = new Error(
    [
      'browserType.launch: Target page, context or browser has been closed',
      'Browser logs:',
      '',
      '<launched> pid=4242',
      '[pid=4242][err] Received signal 11 SEGV_MAPERR',
    ].join('\n'),
  );
  assert.equal(isSandboxLaunchFailure(crash), false);
});

test('isSandboxLaunchFailure: tolerates missing / non-Error input', () => {
  assert.equal(isSandboxLaunchFailure(undefined), false);
  assert.equal(isSandboxLaunchFailure(null), false);
  assert.equal(isSandboxLaunchFailure('mach_port_rendezvous_mac.cc'), true);
});
