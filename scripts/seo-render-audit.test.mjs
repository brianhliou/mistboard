import assert from 'node:assert/strict';
import test from 'node:test';
import {
  auditUrl,
  htmlLangFailures,
  serverHtmlFacts,
  serverHtmlFailures,
  serverMetaFindings,
  sitemapUrls,
} from './seo-render-audit.mjs';

test('raw floor covers ordinary sitemap pages, excluding script and template text', () => {
  const facts = serverHtmlFacts(
    `<body><script>${'not readable '.repeat(30)}</script><template>hidden</template></body>`,
  );
  assert.ok(serverHtmlFailures('/faq', facts).some((failure) => failure.includes('150')));
});

const SITEMAP =
  '<urlset><url><loc>https://mistboard.com/faq</loc></url><url><loc>https://mistboard.com/source</loc></url></urlset>';

const AUDIT_URL = 'https://mistboard.com/rules/jungle-flip';
const AUDIT_ARGS = { timeoutMs: 25_000, blockLazyChunks: true };
const AUDIT_HTML =
  '<html lang="en"><head><title>Flip Jungle Rules | Mistboard</title></head><body><div id="app"><h1>Flip Jungle Rules</h1><p>Readable xiangqi rules. Readable xiangqi rules. Readable xiangqi rules. Readable xiangqi rules. Readable xiangqi rules. Readable xiangqi rules. Readable xiangqi rules. Readable xiangqi rules. Readable xiangqi rules. Readable xiangqi rules. Readable xiangqi rules. Readable xiangqi rules. </p></div></body></html>';

function auditBrowser({ gotoErrors = [], rendered = {}, newPageError } = {}) {
  const state = { contexts: 0, closed: 0, routes: 0 };
  const browser = {
    async newContext() {
      state.contexts += 1;
      return {
        async close() {
          state.closed += 1;
        },
        async newPage() {
          if (newPageError) throw newPageError;
          return {
            on() {},
            async route() {
              state.routes += 1;
            },
            async goto() {
              const error = gotoErrors.shift();
              if (error) throw error;
            },
            async waitForTimeout() {},
            async evaluate() {
              return {
                title: 'Flip Jungle Rules | Mistboard',
                h1: 'Flip Jungle Rules',
                lang: 'en',
                appText: 100,
                errorPanel: false,
                imgsMissingAlt: 0,
                ...rendered,
              };
            },
          };
        },
      };
    },
  };
  return { browser, state };
}

test('a failed HTML fetch retries and preserves its transport cause in the report', async () => {
  const { browser, state } = auditBrowser();
  let calls = 0;
  const waits = [];
  const result = await auditUrl(browser, AUDIT_URL, AUDIT_ARGS, {
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) {
        throw new TypeError('fetch failed', {
          cause: Object.assign(new Error('reset'), { code: 'ECONNRESET' }),
        });
      }
      return new Response(AUDIT_HTML);
    },
    wait: async (ms) => waits.push(ms),
  });
  assert.deepEqual(result.failures, []);
  assert.equal(result.attempts, 2);
  assert.match(result.transportErrors[0], /server HTML.*ECONNRESET/);
  assert.match(result.warnings.join('\n'), /recovered.*2 attempts/);
  assert.deepEqual(waits, [1000]);
  assert.equal(calls, 2);
  assert.equal(state.closed, 1);
});

test('a reset navigation retries with fresh browser state and chunk blocking still enabled', async () => {
  const { browser, state } = auditBrowser({
    gotoErrors: [new Error(`page.goto: net::ERR_CONNECTION_RESET at ${AUDIT_URL}`)],
  });
  const result = await auditUrl(browser, AUDIT_URL, AUDIT_ARGS, {
    fetchImpl: async () => new Response(AUDIT_HTML),
    wait: async () => {},
  });
  assert.deepEqual(result.failures, []);
  assert.equal(result.attempts, 2);
  assert.match(result.transportErrors[0], /navigation.*ERR_CONNECTION_RESET/);
  assert.deepEqual(state, { contexts: 2, closed: 2, routes: 2 });
});

test('persistent resets fail after three attempts as navigation failures, never empty content', async () => {
  const { browser, state } = auditBrowser({
    gotoErrors: Array.from({ length: 3 }, () => new Error('page.goto: net::ERR_CONNECTION_RESET')),
    rendered: { title: '', h1: null, appText: 0 },
  });
  const waits = [];
  const result = await auditUrl(browser, AUDIT_URL, AUDIT_ARGS, {
    fetchImpl: async () => new Response(AUDIT_HTML),
    wait: async (ms) => waits.push(ms),
  });
  assert.equal(result.attempts, 3);
  assert.equal(result.transportErrors.length, 3);
  assert.match(result.failures.join('\n'), /navigation.*3 attempts.*ERR_CONNECTION_RESET/);
  assert.doesNotMatch(result.failures.join('\n'), /#app is empty/);
  assert.deepEqual(waits, [1000, 2000]);
  assert.equal(state.closed, 3);
});

test('HTML deadlines cover stalled bodies and remain failures after bounded retries', async () => {
  const { browser, state } = auditBrowser();
  const signals = [];
  const keepAlive = setInterval(() => {}, 1000);
  try {
    const result = await auditUrl(
      browser,
      AUDIT_URL,
      { ...AUDIT_ARGS, timeoutMs: 10 },
      {
        fetchImpl: async (_url, { signal }) => {
          signals.push(signal);
          return {
            status: 200,
            text: () =>
              new Promise((_resolve, reject) => {
                signal.addEventListener('abort', () => reject(signal.reason), { once: true });
              }),
          };
        },
        wait: async () => {},
      },
    );
    assert.match(result.failures.join('\n'), /server HTML.*3 attempts.*TimeoutError/);
    assert.equal(signals.length, 3);
    assert.notEqual(signals[0], signals[1]);
    assert.equal(state.contexts, 0);
  } finally {
    clearInterval(keepAlive);
  }
});

test('HTTP and actual render failures are not retried or downgraded', async () => {
  for (const scenario of [
    { status: 404, expected: /HTTP 404/ },
    { status: 503, expected: /HTTP 503/ },
    { status: 200, rendered: { errorPanel: true }, expected: /error panel replaced/ },
    { status: 200, rendered: { appText: 0 }, expected: /#app is empty/ },
    { status: 200, rendered: { lang: 'vi' }, expected: /html lang changed/ },
  ]) {
    const { browser } = auditBrowser(scenario);
    let calls = 0;
    const result = await auditUrl(browser, AUDIT_URL, AUDIT_ARGS, {
      fetchImpl: async () => {
        calls += 1;
        return new Response(AUDIT_HTML, { status: scenario.status });
      },
      wait: async () => assert.fail('content and HTTP failures must not retry'),
    });
    assert.match(result.failures.join('\n'), scenario.expected);
    assert.equal(calls, 1);
  }
});

test('an idle timeout still checks the rendered DOM without retrying', async () => {
  const { browser, state } = auditBrowser({
    gotoErrors: [new Error('page.goto: Timeout 25000ms exceeded')],
    rendered: { appText: 0 },
  });
  const result = await auditUrl(browser, AUDIT_URL, AUDIT_ARGS, {
    fetchImpl: async () => new Response(AUDIT_HTML),
    wait: async () => assert.fail('a networkidle timeout must still inspect content'),
  });
  assert.match(result.failures.join('\n'), /#app is empty/);
  assert.match(result.warnings.join('\n'), /load:.*Timeout/);
  assert.equal(result.attempts, 1);
  assert.equal(state.closed, 1);
});

test('browser setup errors release the context and are not retried as network failures', async () => {
  const error = new Error('browser setup failed');
  const { browser, state } = auditBrowser({ newPageError: error });
  await assert.rejects(
    auditUrl(browser, AUDIT_URL, AUDIT_ARGS, {
      fetchImpl: async () => new Response(AUDIT_HTML),
      wait: async () => assert.fail('setup errors must not retry'),
    }),
    error,
  );
  assert.equal(state.closed, 1);
});

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
  '<html lang="en"><head><title>Round 2 | Mistboard</title><link rel="canonical" href="https://mistboard.com/broadcast/xiangqi/t/round/t-r02"></head><body><div id="app"><div class="crawler-copy"><main><h1>Round 2 · <span lang="zh">五羊杯</span></h1><a href="/broadcast/xiangqi/board/b1">1-0</a><p>Tournament results and pairings. Tournament results and pairings. Tournament results and pairings. Tournament results and pairings. Tournament results and pairings. Tournament results and pairings. Tournament results and pairings. Tournament results and pairings. Tournament results and pairings. Tournament results and pairings. </p></main></div></div></body></html>';

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
      ['raw body 0 < 150 chars', 'empty shell: no server-rendered body and no canonical'],
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

test('a canonical cannot excuse thin content; noindex is exempt across all sections', () => {
  const canonicalOnly = serverHtmlFacts(
    EMPTY_SHELL.replace(
      '</head>',
      '<link rel="canonical" href="https://mistboard.com/study/S1"></head>',
    ),
  );
  assert.deepEqual(serverHtmlFailures('/study/S1', canonicalOnly), ['raw body 0 < 150 chars']);
  const noindexed = serverHtmlFacts(
    EMPTY_SHELL.replace('max-image-preview:large', 'noindex, follow'),
  );
  assert.deepEqual(serverHtmlFailures('/broadcast/xiangqi/board/nope', noindexed), []);
  // The raw floor applies to every sitemap section.
  assert.deepEqual(serverHtmlFailures('/watch', serverHtmlFacts(EMPTY_SHELL)), [
    'raw body 0 < 150 chars',
  ]);
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

const HOME = {
  title: 'Free Online Chinese Chess (Xiangqi) | Mistboard',
  description:
    'Play xiangqi (Chinese chess) online for free against people or bots, with rated games, puzzles, studies and live broadcasts of top events.',
};
const page = ({ title, description, body = '', robots = 'max-image-preview:large' }) =>
  `<html lang="en"><head><title>${title}</title><meta name="robots" content="${robots}" />` +
  `<meta name="description" content="${description}"></head><body><div id="app">${body}</div></body></html>`;
const OWN = {
  title: 'Terms of Use: Play, Ratings and Fair Play | Mistboard',
  description:
    'The rules for using mistboard.com: anonymous and rated play, ratings and fair play, finished games published under CC BY 4.0, and patron billing and refunds.',
};

test('a page other than the homepage serving its title fails; its description warns', () => {
  // The planted failure: what /terms and every endgame deep link served until 2026-10-24.
  const copy = serverMetaFindings('/terms', serverHtmlFacts(page(HOME)), HOME);
  assert.deepEqual(copy.failures, [`serves the homepage title "${HOME.title}"`]);
  assert.deepEqual(copy.warnings, ['serves the homepage description']);
  // The homepage itself, in any locale, is not a copy of itself.
  for (const home of ['/', '/zh-hans', '/zh-hant/']) {
    assert.deepEqual(
      serverMetaFindings(home, serverHtmlFacts(page(HOME)), HOME).failures,
      [],
      home,
    );
  }
  // A noindexed copy is out of search, so it is not a duplicate.
  const noindexed = serverHtmlFacts(page({ ...HOME, robots: 'noindex, follow' }));
  assert.deepEqual(serverMetaFindings('/lag', noindexed, HOME), { failures: [], warnings: [] });
  assert.deepEqual(serverMetaFindings('/terms', serverHtmlFacts(page(OWN)), HOME), {
    failures: [],
    warnings: [],
  });
  // Known blind spot: only the reference home title is compared, so a route
  // serving the zh homepage's title is not caught (the run reads '/' only).
});

test('a title or description under the length floor warns, never fails', () => {
  const short = serverMetaFindings(
    '/watch',
    serverHtmlFacts(page({ title: 'Watch · Mistboard', description: 'Live games.' })),
    HOME,
  );
  assert.deepEqual(short.failures, []);
  assert.deepEqual(short.warnings, [
    'title 17 < 25: Watch · Mistboard',
    'description 11 < 100: Live games.',
  ]);
  // A zh description is held to its character floor, CJK counted wide.
  const zh = serverMetaFindings(
    '/zh-hans/watch',
    serverHtmlFacts(
      page({
        title: '观看象棋直播对局 | Mistboard',
        description: '在 Mistboard 上实时观看象棋和各种变体的对局，逐步跟进。',
      }),
    ),
    HOME,
  );
  assert.equal(zh.failures.length, 0);
  assert.match(zh.warnings.join('\n'), /description \d+ < 100|zh description \d+ chars < 60/);
  // Entities count as the character they stand for.
  const escaped = serverHtmlFacts(
    page({ ...OWN, title: 'Terms &amp; Fair Play: The Rules | Mistboard' }),
  );
  assert.equal(escaped.title, 'Terms & Fair Play: The Rules | Mistboard');
});

test('an <img> with no alt attribute warns; alt="" is decorative and passes', () => {
  const facts = serverHtmlFacts(
    page({
      ...OWN,
      body: '<img src="/a.png"><img src="/b.png" alt=""><IMG SRC="/c.png" ALT="Board"><img\nsrc="/d.png">',
    }),
  );
  assert.equal(facts.imgsMissingAlt, 2);
  assert.deepEqual(serverMetaFindings('/thanks', facts, HOME).warnings, ['2 <img> without alt']);
  // Known blind spot: the server HTML holds only prerendered images; the client's
  // are counted in the rendered DOM, which only the full run reads.
});

test('raw/rendered ratio below one half fails even with more than 150 raw characters', async () => {
  const { browser } = auditBrowser({ rendered: { bodyText: 2000 } });
  const result = await auditUrl(browser, AUDIT_URL, AUDIT_ARGS, {
    fetchImpl: async () => new Response(AUDIT_HTML),
    wait: async () => {},
  });
  assert.ok(result.rawChars >= 150);
  assert.ok(result.failures.some((failure) => failure.includes('raw/rendered')));
});
