import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { auditCrawlerRoute, pageFailures, ratchetFailures } from './crawler-floor.mjs';
import { crawlerShells } from './fixtures/crawler-shell.mjs';
import { crawlerContentText, crawlerText } from './lib/crawler-text.mjs';

// Blind spots: presence, not fidelity (crawler copy can drift); one fixture
// per DB-backed template; no JS by design; minChars is only a floor and the
// catalog phrase is the only protection against boilerplate.
const prose = 'Chinese chess positions reward careful study and practical play. '.repeat(12);
const realShell = crawlerShells().find((shell) => shell.locale === 'en').html;
const entry = {
  path: '/__fixture/positive',
  minChars: 150,
  phrase: 'Chinese chess',
  h1: true,
  canonical: true,
  hreflang: ['en'],
  source: 'prerender',
};
const page = (body, alternate = '/__fixture/positive') =>
  `<html><head><link rel="canonical" href="https://mistboard.test/__fixture/positive">
  <link rel="alternate" hreflang="en" href="https://mistboard.test${alternate}"></head>
  <body>${body}</body></html>`;

const fixtures = {
  '/__fixture/client-only': page('<div id="app"></div>'),
  '/__fixture/script-only': page(
    `<script type="application/json">${prose}</script><template>${prose}</template>`,
  ),
  '/zh-hans/__fixture/wrong-locale': page(`<h1>Chinese chess</h1><p>${prose}</p>`),
  '/__fixture/dead-alternate': page(
    `<h1>Chinese chess</h1><p>${prose}</p>`,
    '/__fixture/client-only',
  ),
  '/__fixture/positive': page(`<h1>Chinese chess</h1><p>${prose}</p>`),
  '/__fixture/positive-with-menu': page(
    `${realShell}<main><h1>Chinese chess</h1><p>${prose}</p></main>`,
  ),
  '/__fixture/menu-only': page(`${realShell}<main></main>`),
};
const fixtureEntries = Object.keys(fixtures).map((path) => ({
  ...entry,
  path,
  ...(path.includes('wrong-locale') ? { phrase: '象棋' } : {}),
}));

test('shared text extractor excludes non-body and non-content nodes and decodes entities', () => {
  assert.equal(
    crawlerText(`<html><head><title>ignore</title></head><body>
    <h1>Play &amp; study</h1><script>${prose}</script><style>${prose}</style>
    <template><p>${prose}</p></template><svg><text>${prose}</text></svg>
    <!-- ${prose} --><p>&#x8c61;&#26827;&nbsp;&lt;ok&gt;</p></body></html>`),
    'Play & study 象棋 <ok>',
  );
  assert.equal(crawlerText('<body><div id="app"></div></body>'), '');
});

test('content text removes only header, nav, footer and the stable shell menu containers', () => {
  const html = `<header>Header</header><nav>Navigation</nav><footer>Footer</footer>
    <div class="site-nav"><div>Shell navigation</div></div>
    <div id="site-menu"><div>Detached menu</div></div>
    <main><h1>Chinese chess</h1><aside>Page sidebar</aside><article>Page copy</article>
    <div class="menu">Page menu</div><section>Study &amp; play</section></main>`;
  assert.equal(
    crawlerContentText(html),
    'Chinese chessPage sidebarPage copy Page menuStudy & play',
  );
  assert.match(crawlerText(html), /HeaderNavigationFooter/);
  assert.match(crawlerText(html), /Detached menu/);
});

test('the full real shell with an empty main fails both content checks in every locale', () => {
  for (const shell of crawlerShells()) {
    assert.ok(crawlerText(shell.html).length > 0, `${shell.locale}: ${shell.source}`);
    const html = page(`${shell.html}<main></main>`);
    const { failures, facts } = pageFailures(entry, { status: 200, html });
    assert.equal(facts.text, '');
    assert.ok(failures.includes('body 0 < 150 chars'));
    assert.ok(failures.includes('missing catalog phrase: Chinese chess'));
    // Even the old manifest's menu phrase cannot pass once chrome is removed.
    assert.ok(
      pageFailures(
        { ...entry, phrase: shell.locale === 'en' ? 'Play' : '规则' },
        { status: 200, html },
      ).failures.some((failure) => failure.startsWith('missing catalog phrase:')),
    );
  }
  assert.ok(crawlerText(realShell).length > entry.minChars);
  for (const path of ['/__fixture/positive', '/__fixture/positive-with-menu'])
    assert.deepEqual(pageFailures(entry, { status: 200, html: fixtures[path] }).failures, []);
});

test('planted crawler failures and positive control over HTTP', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'mistboard-crawler-'));
  const files = new Map();
  for (const [path, html] of Object.entries(fixtures)) {
    const file = join(dir, `${files.size}.html`);
    await writeFile(file, html);
    files.set(path, file);
  }
  const server = createServer(async (req, res) => {
    assert.match(req.headers['user-agent'], /OAI-SearchBot/);
    const file = files.get(req.url);
    res.writeHead(file ? 200 : 404, { 'content-type': 'text/html' });
    res.end(file ? await readFile(file) : 'Not found');
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const path of Object.keys(fixtures)) {
    const sample = { ...entry, path, ...(path.includes('wrong-locale') ? { phrase: '象棋' } : {}) };
    const result = await auditCrawlerRoute(sample, { base, manifest: fixtureEntries });
    assert.equal(result.failures.length === 0, path.includes('/positive'), JSON.stringify(result));
    if (path.includes('script-only') || path.includes('client-only')) assert.equal(result.chars, 0);
    if (path.includes('wrong-locale')) assert.ok(result.failures.some((f) => f.includes('phrase')));
    if (path.includes('dead-alternate'))
      assert.ok(
        result.failures.some((f) => f.includes('alternate /__fixture/client-only: body 0')),
      );
  }
});

test('ratchet rejects a repaired knownGap and an untracked content failure', () => {
  assert.deepEqual(ratchetFailures({ ...entry, knownGap: '#956' }, []), [
    'remove knownGap #956: route now passes',
  ]);
  assert.deepEqual(ratchetFailures({ ...entry, knownGap: '#956' }, ['too short']), []);
  assert.deepEqual(ratchetFailures(entry, ['too short']), ['too short']);
});

test('metadata and status are enforced independently of the text floor', () => {
  const { failures } = pageFailures(entry, { status: 503, html: `<body><p>${prose}</p></body>` });
  assert.deepEqual(failures, [
    'HTTP 503',
    'missing h1',
    'missing canonical',
    'missing hreflang en',
  ]);
});

test('an actual passing page with knownGap fails the ratchet', async () => {
  const sample = { ...entry, knownGap: '#956' };
  const result = await auditCrawlerRoute(sample, {
    base: 'http://fixture.test',
    manifest: [sample],
    fetchImpl: async () => new Response(fixtures[entry.path]),
  });
  assert.deepEqual(result.failures, []);
  assert.deepEqual(ratchetFailures(sample, result.failures), [
    'remove knownGap #956: route now passes',
  ]);
});

test('the same planted contracts reject bad bodies and pass the positive control without a socket', async () => {
  for (const path of Object.keys(fixtures)) {
    const sample = { ...entry, path, ...(path.includes('wrong-locale') ? { phrase: '象棋' } : {}) };
    const result = await auditCrawlerRoute(sample, {
      base: 'http://fixture.test',
      manifest: fixtureEntries,
      fetchImpl: async (url, init) => {
        assert.match(init.headers['user-agent'], /OAI-SearchBot/);
        return new Response(fixtures[new URL(url).pathname] ?? '', {
          status: fixtures[new URL(url).pathname] ? 200 : 404,
        });
      },
    });
    assert.equal(result.failures.length === 0, path.includes('/positive'), JSON.stringify(result));
  }
});
