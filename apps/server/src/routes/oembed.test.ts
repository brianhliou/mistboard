import assert from 'node:assert/strict';
import test from 'node:test';
import { tryHandle } from './oembed.js';

type Captured = { status: number; body: unknown };

function fakeResponse(): { res: unknown; captured: Captured } {
  const captured: Captured = { status: 0, body: undefined };
  const res = {
    writeHead(status: number) {
      captured.status = status;
      return res;
    },
    end(payload?: string) {
      if (payload) {
        try {
          captured.body = JSON.parse(payload);
        } catch {
          captured.body = payload;
        }
      }
    },
    setHeader() {},
  };
  return { res, captured };
}

async function call(url: string, method = 'GET') {
  const parsed = new URL(url, 'http://mistboard.com');
  const { res, captured } = fakeResponse();
  const handled = await tryHandle(
    null,
    { method, headers: { host: 'mistboard.com' } } as never,
    res as never,
    parsed.pathname,
    parsed,
  );
  return { handled, ...captured };
}

test('ignores every path but its own', async () => {
  assert.equal((await call('/api/studies/abc')).handled, false);
  assert.equal((await call('/api/oembed')).handled, true);
});

test('a missing url is a 400, not a crash', async () => {
  const r = await call('/api/oembed');
  assert.equal(r.status, 400);
  assert.deepEqual(r.body, { error: 'url_required' });
});

test('a format other than json is 501, as the spec requires', async () => {
  const r = await call('/api/oembed?url=https://mistboard.com/study/a/b&format=xml');
  assert.equal(r.status, 501);
});

test('a url that is a page rather than a frameable surface is not embeddable', async () => {
  for (const url of [
    'https://mistboard.com/blog/xiangqi-champions',
    'https://mistboard.com/watch',
    'https://mistboard.com/game',
    'https://mistboard.com/puzzles',
    'https://mistboard.com/analysis',
  ]) {
    const r = await call(`/api/oembed?url=${encodeURIComponent(url)}`);
    assert.equal(r.status, 404, url);
    assert.deepEqual(r.body, { error: 'not_embeddable' }, url);
  }
});

test('accepts the review permalink, a tenant game route, and the game embed path', async () => {
  for (const url of [
    'https://mistboard.com/game/abc-123',
    'https://mistboard.com/xiangqi/game/abc-123',
    'https://mistboard.com/embed/game/abc-123',
  ]) {
    const r = await call(`/api/oembed?url=${encodeURIComponent(url)}`);
    // Without persistence these reach the store check: the URL parsed.
    assert.notDeepEqual(r.body, { error: 'not_embeddable' }, url);
  }
});

test('rejects a method that is not a read', async () => {
  const r = await call('/api/oembed?url=https://mistboard.com/study/a/b', 'POST');
  assert.equal(r.status, 405);
});

test('accepts both the reader permalink and the embed path', async () => {
  // The link a person copies is the permalink, so a provider that only matched
  // the embed path would answer nothing for the URL anyone actually pastes.
  for (const url of [
    'https://mistboard.com/study/ytSzepET/Ue0EgpS7',
    'https://mistboard.com/embed/study/ytSzepET/Ue0EgpS7',
  ]) {
    const r = await call(`/api/oembed?url=${encodeURIComponent(url)}`);
    // Without persistence configured these reach the store check, not the
    // "not_embeddable" branch: the URL parsed.
    assert.notDeepEqual(r.body, { error: 'not_embeddable' }, url);
  }
});

test('tv and the analysis board embed without a store, from their embed paths only', async () => {
  const tv = await call('/api/oembed?url=https://mistboard.com/embed/tv?channel=xiangqi');
  assert.equal(tv.status, 200);
  const tvBody = tv.body as { html: string; title: string };
  assert.match(tvBody.html, /src="https:\/\/mistboard\.com\/embed\/tv\?channel=xiangqi"/);
  assert.equal(tvBody.title, 'Mistboard TV · xiangqi');

  const analysis = await call('/api/oembed?url=https://mistboard.com/embed/analysis');
  assert.equal(analysis.status, 200);
  assert.match(
    (analysis.body as { html: string }).html,
    /src="https:\/\/mistboard\.com\/embed\/analysis\/xiangqi"/,
  );
});

test("today's puzzle embeds without a store; a puzzle by id is looked up", async () => {
  const daily = await call('/api/oembed?url=https://mistboard.com/embed/puzzle');
  assert.equal(daily.status, 200);
  assert.match(
    (daily.body as { html: string }).html,
    /src="https:\/\/mistboard\.com\/embed\/puzzle"/,
  );

  // No store in this harness: an unknown id is a plain not_found, never a
  // crash, and never the not_embeddable that would mean the URL did not parse.
  const byId = await call('/api/oembed?url=https://mistboard.com/puzzles/no-such-puzzle');
  assert.equal(byId.status, 404);
  assert.deepEqual(byId.body, { error: 'not_found' });
});
