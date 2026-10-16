import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import {
  createHttpRequestHandler,
  isHashedBuildAssetPath,
  isIsolatedEngineAssetPath,
  isPageNavigationRequest,
  robotsTxt,
} from './server-http.js';

const HTML_ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';

test('page navigation: extensionless GET asking for HTML → true', () => {
  assert.equal(
    isPageNavigationRequest({ method: 'GET', headers: { accept: HTML_ACCEPT } }, '/asdfasdf'),
    true,
  );
});

test('page navigation: direct hit with no Accept header → true', () => {
  assert.equal(isPageNavigationRequest({ method: 'GET', headers: {} }, '/nope'), true);
  assert.equal(isPageNavigationRequest({ method: 'HEAD', headers: {} }, '/nope/deeper'), true);
});

test('missing asset: extensioned path → false (falls through to real asset 404)', () => {
  assert.equal(
    isPageNavigationRequest({ method: 'GET', headers: { accept: HTML_ACCEPT } }, '/assets/app.js'),
    false,
  );
  assert.equal(
    isPageNavigationRequest({ method: 'GET', headers: { accept: '*/*' } }, '/img/missing.png'),
    false,
  );
});

test('data fetch to an unknown page path (no text/html) → false', () => {
  assert.equal(
    isPageNavigationRequest({ method: 'GET', headers: { accept: 'application/json' } }, '/data'),
    false,
  );
});

test('non-idempotent methods are never page navigations', () => {
  assert.equal(
    isPageNavigationRequest({ method: 'POST', headers: { accept: HTML_ACCEPT } }, '/asdfasdf'),
    false,
  );
});

test('isolated engine assets: every vendored engine dir gets COEP, not just fairy-stockfish', () => {
  assert.equal(isIsolatedEngineAssetPath('/engine/fairy-stockfish/stockfish.wasm'), true);
  assert.equal(isIsolatedEngineAssetPath('/engine/misty-banqi/worker.js'), true);
  assert.equal(isIsolatedEngineAssetPath('/engine/misty-jungle/engine.wasm'), true);
  assert.equal(isIsolatedEngineAssetPath('/engine/misty-jungle-flip/worker.js'), true);
  assert.equal(isIsolatedEngineAssetPath('/engine/pikafish-jieqi/worker.js'), true);
});

// The engine assets are served immutable for a year, which is only true while
// every URL built for them carries a ?v=. Each engine interpolates its own base
// into a template literal; if one of those ever loses the query, a stale worker
// or wasm pins itself into browsers for a year and nothing reports it. The
// contract lives in the client, so this reads it there. Checked against a
// deliberately broken copy before it was committed: dropping the query from
// pikafishEngineAsset fails this test.
test('every engine asset URL the client builds carries a version query', () => {
  const engineDir = resolve(import.meta.dirname, '..', '..', 'web', 'src', 'review', 'engine');
  const offenders: string[] = [];
  for (const file of readdirSync(engineDir)) {
    if (!file.endsWith('.ts') || file.includes('.test.')) continue;
    for (const line of readFileSync(join(engineDir, file), 'utf-8').split('\n')) {
      // A URL is a template that OPENS with the engine directory: `${ENGINE_BASE}…`
      // or `${this.config.base}…`. UCI commands interpolate a `base` too
      // (`position ${base} moves …`) but never in first place, and the plain
      // declarations are string literals rather than templates.
      if (!/`\$\{(?:ENGINE_BASE|[A-Za-z_.]*\bbase)\}/.test(line)) continue;
      if (line.includes('?v=')) continue;
      offenders.push(`${file}: ${line.trim()}`);
    }
  }
  assert.deepEqual(offenders, [], `engine asset URLs without a ?v=:\n${offenders.join('\n')}`);
});

test('isolated engine assets: the /engine/:id admin document stays non-isolated', () => {
  assert.equal(isIsolatedEngineAssetPath('/engine/misty-banqi'), false);
  assert.equal(isIsolatedEngineAssetPath('/engine/pikafish-xiangqi-level-5'), false);
  assert.equal(isIsolatedEngineAssetPath('/engines'), false);
  assert.equal(isIsolatedEngineAssetPath('/engine/'), false);
});

// The /data downloads are built in the live web process on first request; a
// crawler walking /data's links would trigger every build. The rest of /api
// stays open because client-rendered pages load their content from it.
test('robots.txt keeps crawlers off the data downloads and nothing else under /api', () => {
  const lines = robotsTxt('https://mistboard.com').split('\n');
  assert.ok(lines.includes('Disallow: /api/data/'));
  assert.ok(
    !lines.includes('Disallow: /api/'),
    '/api/data (the listing) and page data stay crawlable',
  );
  for (const kept of ['Disallow: /database', 'Disallow: /engines', 'Disallow: /accounts']) {
    assert.ok(lines.includes(kept), kept);
  }
  assert.ok(lines.includes('Sitemap: https://mistboard.com/sitemap.xml'));
});

test('hashed build assets: only Vite-named files under /assets qualify', () => {
  assert.equal(isHashedBuildAssetPath('/assets/index-CkdYnPwB.js'), true);
  assert.equal(isHashedBuildAssetPath('/assets/account-profile-C4OBlOPq.css'), true);
  assert.equal(isHashedBuildAssetPath('/assets/worker-a_b-C9d8.wasm'), true);
  assert.equal(isHashedBuildAssetPath('/assets/readme.js'), false);
  assert.equal(isHashedBuildAssetPath('/assets/nested/index-CkdYnPwB.js'), false);
  assert.equal(isHashedBuildAssetPath('/index-CkdYnPwB.js'), false);
  assert.equal(isHashedBuildAssetPath('/feed.xml'), false);
});

// Drives the real handler over a temp build: a hashed chunk is pinned for a
// year, while the HTML that names the chunks (and a chunk this build lacks)
// must never be.
test('hashed build assets are served immutable; HTML and missing chunks are not', async () => {
  const staticDir = await mkdtemp(join(tmpdir(), 'mistboard-static-'));
  await mkdir(join(staticDir, 'assets'), { recursive: true });
  await writeFile(join(staticDir, 'index.html'), '<!doctype html><title>x</title>', 'utf-8');
  await writeFile(join(staticDir, 'home.html'), '<!doctype html><title>home</title>', 'utf-8');
  await writeFile(join(staticDir, 'assets', 'index-CkdYnPwB.js'), 'console.log(1);', 'utf-8');
  const handler = createHttpRequestHandler({
    staticDir,
    publicHost: 'https://mistboard.com',
    drainController: { isDraining: () => false },
  } as unknown as Parameters<typeof createHttpRequestHandler>[0]);
  const server = createServer(handler);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const asset = await fetch(`${base}/assets/index-CkdYnPwB.js`);
    assert.equal(asset.status, 200);
    assert.equal(asset.headers.get('cache-control'), 'public, max-age=31536000, immutable');
    await asset.text();

    const missing = await fetch(`${base}/assets/index-Zz9Yy8Xx.js`);
    assert.equal(missing.status, 404);
    assert.equal(missing.headers.get('cache-control'), null);
    await missing.text();

    const page = await fetch(`${base}/`, { headers: { accept: 'text/html' } });
    assert.equal(page.status, 200);
    assert.equal(page.headers.get('cache-control'), null);
    await page.text();
  } finally {
    await new Promise<void>((done) => server.close(() => done()));
  }
});

// #276: WebKit ignores COEP credentialless, so the review routes must send
// require-corp to every browser, or no iPhone/iPad browser and no desktop
// Safari ever isolates and the threaded engines never start. One policy for
// every user agent, not a WebKit-only branch: the UA must not change it.
test('review routes send COOP same-origin + COEP require-corp to every browser', async () => {
  const staticDir = await mkdtemp(join(tmpdir(), 'mistboard-static-'));
  await mkdir(join(staticDir, 'engine', 'fairy-stockfish'), { recursive: true });
  await writeFile(join(staticDir, 'index.html'), '<!doctype html><title>x</title>', 'utf-8');
  await writeFile(join(staticDir, 'engine', 'fairy-stockfish', 'stockfish.worker.js'), '', 'utf-8');
  const handler = createHttpRequestHandler({
    staticDir,
    publicHost: 'https://mistboard.com',
    drainController: { isDraining: () => false },
  } as unknown as Parameters<typeof createHttpRequestHandler>[0]);
  const server = createServer(handler);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const userAgents = {
    iphoneChrome:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/138.0.7204.156 Mobile/15E148 Safari/604.1',
    iphoneSafari:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
    macSafari:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
    chrome:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
    firefox: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:143.0) Gecko/20100101 Firefox/143.0',
  };
  const reviewRoutes = [
    '/analysis',
    '/analysis/xiangqi',
    '/analysis/jieqi',
    '/game/abc123',
    '/xiangqi/game/abc123',
    '/historical-xiangqi/game/abc123',
    '/study/AbC123',
    '/zh-hans/study/AbC123/Ch1',
    '/practice/position',
    '/puzzles',
    '/puzzles/42',
    '/broadcast/xiangqi/some-event',
  ];
  try {
    for (const [name, userAgent] of Object.entries(userAgents)) {
      for (const route of reviewRoutes) {
        const page = await fetch(`${base}${route}`, {
          headers: { accept: HTML_ACCEPT, 'user-agent': userAgent },
        });
        await page.text();
        assert.equal(
          page.headers.get('cross-origin-opener-policy'),
          'same-origin',
          `${name} ${route}`,
        );
        assert.equal(
          page.headers.get('cross-origin-embedder-policy'),
          'require-corp',
          `${name} ${route}`,
        );
      }
      // The rest of the site stays non-isolated.
      for (const route of ['/', '/videos', '/broadcast/xiangqi/ops', '/engine/misty-banqi']) {
        const page = await fetch(`${base}${route}`, {
          headers: { accept: HTML_ACCEPT, 'user-agent': userAgent },
        });
        await page.text();
        assert.equal(page.headers.get('cross-origin-opener-policy'), null, `${name} ${route}`);
        assert.equal(page.headers.get('cross-origin-embedder-policy'), null, `${name} ${route}`);
      }
      // The engine worker isolates itself and is loadable from a require-corp document.
      const worker = await fetch(`${base}/engine/fairy-stockfish/stockfish.worker.js?v=1`, {
        headers: { 'user-agent': userAgent },
      });
      await worker.text();
      assert.equal(worker.headers.get('cross-origin-embedder-policy'), 'require-corp', name);
      assert.equal(worker.headers.get('cross-origin-resource-policy'), 'same-origin', name);
    }
  } finally {
    await new Promise<void>((done) => server.close(() => done()));
  }
});
