import assert from 'node:assert/strict';
import test from 'node:test';
import {
  htmlLangFailures,
  serverHtmlFacts,
  serverHtmlFailures,
  sitemapUrls,
} from './seo-render-audit.mjs';

const SITEMAP =
  '<urlset><url><loc>https://mistboard.com/faq</loc></url><url><loc>https://mistboard.com/source</loc></url></urlset>';

test('a transient sitemap network failure retries, rebases and respects the limit', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const waits = [];
  const signals = [];
  const urls = await sitemapUrls('http://localhost:3000', 'pages', 1, {
    fetchImpl: async (url, { signal }) => {
      assert.equal(url, 'http://localhost:3000/sitemap-pages.xml');
      signals.push(signal);
      if (signals.length === 1) throw new TypeError('fetch failed');
      return new Response(SITEMAP);
    },
    wait: async (ms) => waits.push(ms),
  });
  assert.deepEqual(urls, ['http://localhost:3000/faq']);
  assert.deepEqual(waits, [1000]);
  assert.notEqual(signals[0], signals[1]);
});

test('sitemap rate limits and server errors retry with bounded backoff', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const responses = [new Response('', { status: 429 }), new Response('', { status: 503 })];
  const waits = [];
  const urls = await sitemapUrls('https://mistboard.com', 'pages', 0, {
    fetchImpl: async () => responses.shift() ?? new Response(SITEMAP),
    wait: async (ms) => waits.push(ms),
  });
  assert.equal(urls.length, 2);
  assert.deepEqual(waits, [1000, 2000]);
});

test('a permanently missing sitemap fails immediately', async () => {
  let calls = 0;
  await assert.rejects(
    sitemapUrls('https://mistboard.com', 'pages', 0, {
      fetchImpl: async () => {
        calls += 1;
        return new Response('', { status: 404 });
      },
      wait: async () => assert.fail('a 404 must not retry'),
    }),
    /sitemap-pages.xml returned 404/,
  );
  assert.equal(calls, 1);
});

test('persistent sitemap network failure still fails after exactly three attempts', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const failure = new TypeError('fetch failed');
  let calls = 0;
  const waits = [];
  await assert.rejects(
    sitemapUrls('https://mistboard.com', 'pages', 0, {
      fetchImpl: async () => {
        calls += 1;
        throw failure;
      },
      wait: async (ms) => waits.push(ms),
    }),
    (error) => {
      assert.match(error.message, /sitemap-pages.xml could not be fetched after 3 attempts/);
      assert.equal(error.cause, failure);
      return true;
    },
  );
  assert.equal(calls, 3);
  assert.deepEqual(waits, [1000, 2000]);
});

test('the sitemap deadline also bounds a stalled response body', async (t) => {
  t.mock.method(console, 'warn', () => {});
  // AbortSignal.timeout uses an unref'ed timer; keep this isolated test alive
  // while its simulated response bodies wait for the real deadline.
  const keepAlive = setInterval(() => {}, 1000);
  let calls = 0;
  try {
    await assert.rejects(
      sitemapUrls('https://mistboard.com', 'pages', 0, {
        timeoutMs: 10,
        fetchImpl: async (_url, { signal }) => {
          calls += 1;
          return {
            ok: true,
            text: () =>
              new Promise((_resolve, reject) => {
                signal.addEventListener('abort', () => reject(signal.reason), { once: true });
              }),
          };
        },
        wait: async () => {},
      }),
      (error) => error.cause?.name === 'TimeoutError',
    );
    assert.equal(calls, 3);
  } finally {
    clearInterval(keepAlive);
  }
});

// The shell prod served for every broadcast URL until 2026-10-17: a title, no
// canonical, nothing in #app. The audit passed it, because the client drew a
// page after the fact; this is the planted failure the check must catch.
const EMPTY_SHELL =
  '<html lang="en"><head><title>Mistboard</title><meta name="robots" content="max-image-preview:large" /></head><body><div id="app"></div></body></html>';

const SERVED =
  '<html lang="en"><head><title>Round 2 | Mistboard</title><link rel="canonical" href="https://mistboard.com/broadcast/xiangqi/t/round/t-r02"></head><body><div id="app"><div class="crawler-copy"><main><h1>Round 2 · <span lang="zh">五羊杯</span></h1><a href="/broadcast/xiangqi/board/b1">1-0</a></main></div></div></body></html>';

test('an empty shell on a broadcast, player or study URL fails', () => {
  const facts = serverHtmlFacts(EMPTY_SHELL);
  assert.equal(facts.canonical, null);
  assert.equal(facts.h1, null);
  assert.equal(facts.prerendered, false);
  for (const path of [
    '/broadcast/xiangqi',
    '/broadcast/xiangqi/t/round/t-r02',
    '/broadcast/xiangqi/board/b1',
    '/players/wang-tianyi',
    '/study',
    '/zh-hant/study',
    '/study/S1',
    '/zh-hans/study/S1',
  ]) {
    assert.deepEqual(
      serverHtmlFailures(path, facts),
      ['empty shell: no server-rendered body and no canonical'],
      path,
    );
  }
});

test('a server-rendered page records its canonical and h1 and passes', () => {
  const facts = serverHtmlFacts(SERVED);
  assert.equal(facts.canonical, 'https://mistboard.com/broadcast/xiangqi/t/round/t-r02');
  assert.equal(facts.h1, 'Round 2 · 五羊杯');
  assert.equal(facts.prerendered, true);
  assert.deepEqual(serverHtmlFailures('/broadcast/xiangqi/t/round/t-r02', facts), []);
});

test('a canonical alone, a noindexed unknown id, or another section passes', () => {
  const canonicalOnly = serverHtmlFacts(
    EMPTY_SHELL.replace(
      '</head>',
      '<link rel="canonical" href="https://mistboard.com/study/S1"></head>',
    ),
  );
  assert.deepEqual(serverHtmlFailures('/study/S1', canonicalOnly), []);
  const noindexed = serverHtmlFacts(
    EMPTY_SHELL.replace('max-image-preview:large', 'noindex, follow'),
  );
  assert.deepEqual(serverHtmlFailures('/broadcast/xiangqi/board/nope', noindexed), []);
  // Known blind spot: client-only pages outside these sections are not held to
  // the rule (the rendered-DOM checks cover them).
  assert.deepEqual(serverHtmlFailures('/watch', serverHtmlFacts(EMPTY_SHELL)), []);
});

test('a client that changes <html lang> fails the audit; case alone does not', () => {
  const server = serverHtmlFacts(
    '<!doctype html><html lang="vi"><head><title>Lại Lý Huynh</title></head><body><div id="app"><h1>Lại Lý Huynh</h1></div></body></html>',
  );
  assert.equal(server.htmlLang, 'vi');
  // The planted failure: what /blog/lai-ly-huynh-co-tuong did until 2026-10-21.
  assert.deepEqual(htmlLangFailures(server.htmlLang, 'en'), ['html lang changed: "vi" -> "en"']);
  assert.deepEqual(htmlLangFailures(server.htmlLang, 'vi'), []);
  assert.deepEqual(htmlLangFailures('zh-Hans', 'zh-hans'), []);
  // Nothing to compare: a page without lang is not this check's finding.
  assert.deepEqual(htmlLangFailures(null, 'en'), []);
  assert.equal(serverHtmlFacts('<html><body></body></html>').htmlLang, null);
});
