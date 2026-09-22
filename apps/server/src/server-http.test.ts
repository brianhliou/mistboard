import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { isIsolatedEngineAssetPath, isPageNavigationRequest } from './server-http.js';

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
