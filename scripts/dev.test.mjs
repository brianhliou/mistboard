import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { EventEmitter, once } from 'node:events';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import { syncBuiltinESMExports } from 'node:module';
import { PassThrough, Readable } from 'node:stream';
import test from 'node:test';
import { register } from 'tsx/esm/api';

register();

let importId = 0;

function withEnv(t, values) {
  for (const [key, value] of Object.entries(values)) {
    const previous = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
    t.after(() => {
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    });
  }
}

async function launchPair(t, lan, memory) {
  withEnv(t, {
    MISTBOARD_DEV_LAN: lan,
    MISTBOARD_DEV_PORT_BASE: '3020',
    // An inherited API setting must not silently expose a local-only pair.
    MISTBOARD_BIND_HOST: '0.0.0.0',
  });
  const previousArgv = process.argv;
  process.argv = ['node', 'dev.mjs', ...(memory ? ['--memory'] : [])];
  t.after(() => {
    process.argv = previousArgv;
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
  t.mock.method(console, 'log', () => {});
  let launch;
  t.mock.method(childProcess, 'spawn', (bin, args, options) => {
    launch = { bin, args, options };
    return new EventEmitter();
  });
  syncBuiltinESMExports();
  await import(`./dev.mjs?test=${++importId}`);
  assert.ok(launch, 'the launcher starts the pair');
  return launch;
}

for (const memory of [false, true]) {
  for (const [lan, host] of [
    [undefined, '127.0.0.1'],
    ['0', '127.0.0.1'],
    ['true', '127.0.0.1'],
    ['1', '0.0.0.0'],
  ]) {
    test(`${memory ? 'memory' : 'persistent'} pair binds to ${host} with LAN=${lan}`, async (t) => {
      const { args, options } = await launchPair(t, lan, memory);
      assert.equal(options.env.MISTBOARD_BIND_HOST, host);
      assert.match(
        args.at(-2),
        new RegExp(
          `PORT=3021 npm run ${memory ? 'dev' : 'dev:persistent'} --workspace @mistboard/server`,
        ),
      );
      assert.match(args.at(-1), /PORT=3020 MISTBOARD_DEV_API_URL=http:\/\/127\.0\.0\.1:3021 /);
    });
  }
}

async function viteConfig(t, lan, apiUrl) {
  withEnv(t, {
    MISTBOARD_DEV_LAN: lan,
    MISTBOARD_DEV_API_URL: apiUrl,
    MISTBOARD_DEV_PUBLIC_STUDIES: '0',
  });
  const { default: config } = await import(`../apps/web/vite.config.ts?test=${++importId}`);
  return config({ command: 'serve', mode: 'development' });
}

for (const [lan, host] of [
  [undefined, '127.0.0.1'],
  ['0', '127.0.0.1'],
  ['true', '127.0.0.1'],
  ['1', '0.0.0.0'],
]) {
  test(`Vite binds to ${host} with LAN=${lan}, including standalone web commands`, async (t) => {
    const config = await viteConfig(t, lan);
    assert.equal(config.server?.host, host);
    assert.equal(config.server?.strictPort, true);
    const pkg = JSON.parse(readFileSync(new URL('../apps/web/package.json', import.meta.url)));
    for (const script of ['dev', 'dev:agent']) {
      assert.match(pkg.scripts[script], /--strictPort\b/);
      assert.doesNotMatch(pkg.scripts[script], /--host\b/);
    }
    assert.match(pkg.scripts.dev, /\$\{PORT:-3000\}/);
    assert.match(pkg.scripts['dev:agent'], /\$\{PORT:-3099\}/);
  });
}

for (const apiUrl of [undefined, 'http://127.0.0.1:3021']) {
  test(`Vite proxies /api over IPv4 (${apiUrl ?? 'default target'})`, async (t) => {
    const config = await viteConfig(t, undefined, apiUrl);
    const plugin = config.plugins.find((entry) => entry.name === 'mistboard-dev-api-proxy');
    let middleware;
    plugin.configureServer({
      middlewares: {
        use(handler) {
          middleware = handler;
        },
      },
    });
    let target;
    t.mock.method(http, 'request', (url, _options, callback) => {
      target = url;
      const upstream = Readable.from(['{"ok":true}']);
      upstream.statusCode = 200;
      upstream.headers = { 'content-type': 'application/json' };
      queueMicrotask(() => callback(upstream));
      return new PassThrough();
    });
    const req = Readable.from([]);
    req.url = '/api/ping?probe=1';
    req.method = 'GET';
    req.headers = {};
    const res = new PassThrough();
    let status;
    res.writeHead = (code) => {
      status = code;
    };
    let body = '';
    res.on('data', (chunk) => {
      body += chunk;
    });
    const finished = once(res, 'end');
    middleware(req, res, () => assert.fail('API requests must reach the proxy'));
    await finished;
    assert.equal(target.hostname, '127.0.0.1');
    assert.equal(target.port, apiUrl ? '3021' : '3001');
    assert.equal(target.pathname, '/api/ping');
    assert.equal(target.search, '?probe=1');
    assert.equal(status, 200);
    assert.equal(body, '{"ok":true}');
  });
}

async function devIsolationMiddleware(t) {
  const config = await viteConfig(t);
  const plugin = config.plugins.find((entry) => entry.name === 'mistboard-cross-origin-isolation');
  let middleware;
  plugin.configureServer({
    middlewares: {
      use: (handler) => {
        middleware = handler;
      },
    },
  });
  return middleware;
}

for (const url of [
  '/blog/xiangqi-lesson',
  '/blog/xiangqi-lesson?preview=1',
  '/rules/xiangqi',
  '/zh-hans/blog/xiangqi-lesson',
  '/zh-hant/rules/xiangqi',
]) {
  test(`Vite allows third-party embeds on article document ${url}`, async (t) => {
    const middleware = await devIsolationMiddleware(t);
    for (const method of ['GET', 'HEAD']) {
      const req = { url, method, headers: { accept: 'text/html,application/xhtml+xml' } };
      const res = new http.ServerResponse(req);
      let passed = false;
      middleware(req, res, () => {
        passed = true;
      });
      assert.equal(passed, true);
      assert.equal(res.getHeader('Cross-Origin-Embedder-Policy'), undefined);
      assert.equal(res.getHeader('Cross-Origin-Opener-Policy'), undefined);
    }
  });
}

for (const [url, accept] of [
  ['/analysis/xiangqi', 'text/html'],
  ['/replay/game-id', 'text/html'],
  ['/engine/pikafish/pikafish.js?v=1', '*/*'],
  ['/engine/fairy-stockfish/stockfish.worker.js', '*/*'],
  ['/engine/pikafish/pikafish.wasm', '*/*'],
  ['/src/articles.ts', '*/*'],
  ['/blog/xiangqi-lesson', '*/*'],
  ['/rules/xiangqi', undefined],
  ['/blog/worker.js', 'text/html'],
  ['/blog/xiangqi-lesson/worker.js', 'text/html'],
  ['/blog', 'text/html'],
  ['/videos', 'text/html'],
]) {
  test(`Vite retains isolation on ${url} (${accept ?? 'no Accept header'}), including 304s`, async (t) => {
    const middleware = await devIsolationMiddleware(t);
    const req = { url, method: 'GET', headers: { accept } };
    const res = new http.ServerResponse(req);
    middleware(req, res, () => {});
    res.writeHead(304);
    assert.equal(res.getHeader('Cross-Origin-Embedder-Policy'), 'require-corp');
    assert.equal(res.getHeader('Cross-Origin-Opener-Policy'), 'same-origin');
  });
}
