import assert from 'node:assert/strict';
import test from 'node:test';
import { reportingArticles } from './article-meta.js';
import {
  buildContentQueries,
  CONTENT_METRICS,
  collectContentReadout,
  contentSummary,
  parseContentResult,
} from './content-readout.js';
import { buildMistboardReadout } from './mistboard-readout.js';
import { buildReadoutSummary, renderReadoutEmail } from './readout-email-render.js';

const now = new Date('2026-11-09T17:23:00Z');
const articles = [
  {
    slug: 'example',
    title: 'Example',
    publishedAt: '2026-10-01',
    liveAt: Date.parse('2026-10-01T16:00:00Z'),
  },
];
const ok = (columns: string[], results: unknown[][] = []) =>
  new Response(JSON.stringify({ columns: ['slug', ...columns], results }));
const fixtureFetch =
  (calls: string[]) => async (_url: string | URL | Request, init?: RequestInit) => {
    calls.push(String(init?.body));
    const sql = JSON.parse(String(init?.body)).query.query as string;
    const keys = sql.includes('AS matureVisitors')
      ? ['matureVisitors', 'returnedVisitors']
      : sql.includes('AS priorPlayers')
        ? ['priorPlayers', 'firstPlayers', 'entryFirstPlayers']
        : CONTENT_METRICS.slice(0, 11);
    return ok([...keys], [['example', ...keys.map((_, i) => i + 1)]]);
  };
test('collector stores aggregate contract, exact complete windows and genuine zero separately from unavailable', async () => {
  const calls: string[] = [];
  const result = await collectContentReadout(now, {
    apiKey: 'synthetic-test-key',
    articles,
    fetch: fixtureFetch(calls),
  });
  assert.equal(result.status, 'available');
  assert.equal(calls.length, 6);
  assert.equal(result.periodEnd, '2026-11-09T00:00:00.000Z');
  assert.equal(result.periodStart, '2026-10-12T00:00:00.000Z');
  assert.equal(result.previousPeriodStart, '2026-09-14T00:00:00.000Z');
  assert.equal(result.articles[0].current.visitors, 1);
  assert.equal(result.articles[0].current.returnedVisitors, 2);
  assert.equal(result.articles[0].previous.movedVisits, null); // before event coverage, not zero
  assert.equal(JSON.stringify(result).includes('synthetic-test-key'), false);
  const zero = await collectContentReadout(now, {
    apiKey: 'synthetic',
    articles,
    fetch: async (url, init) => {
      const response = await fixtureFetch([])(url, init);
      const body = (await response.json()) as { columns: string[] };
      return ok(body.columns.slice(1));
    },
  });
  assert.equal(zero.status, 'available');
  assert.equal(zero.articles[0].current.visitors, 0);
  const unavailable = await collectContentReadout(now, { apiKey: '', articles });
  assert.equal(unavailable.reason, 'not-configured');
  assert.deepEqual(unavailable.articles, []);
});
test('queries exclude whole internal sessions and use prod host, actual paths, locale/session dedup, lifecycle order and historical/mature bounds', () => {
  const sql = buildContentQueries(new Date('2026-10-12'), new Date('2026-11-09'), articles);
  assert.match(
    sql[0],
    /max\(coalesce\(poe.properties.\$internal_or_test_user,false\) OR coalesce\(properties.is_internal,false\)\)/,
  );
  assert.match(sql[0], /HAVING internal=0/);
  assert.match(sql[0], /www.mistboard.com/);
  assert.match(sql[0], /\^\(\/zh-hans\|\/zh-hant\)\?\/blog/);
  assert.match(sql[0], /uniq\(tuple\(person_id,sid\)\)/);
  assert.match(sql[0], /y.4=x.4 AND y.1>=x.1/);
  assert.match(sql[0], /x.1>=first_view/);
  assert.match(sql[0], /timestamp>='2026-10-01 16:00:00'/);
  assert.match(sql[1], /timestamp>='2026-05-01 00:00:00'/);
  assert.match(sql[1], /t.entry_path=t.article_path/);
  assert.match(sql[2], /timestamp<'2026-11-01 00:00:00'/);
  assert.match(sql[2], /x.3='\$pageview' AND x.4=1/);
  assert.match(sql[2], /first_view\+INTERVAL 1 DAY/);
  assert.match(sql[2], /first_view\+INTERVAL 8 DAY/);
});
test('inventory excludes draft/future/nonarticles and retains distinct Vietnamese slugs', () => {
  const inventory = reportingArticles(new Date('2026-11-09'));
  assert.ok(inventory.length > 40);
  assert.ok(inventory.every((a) => a.liveAt === null || a.liveAt <= Date.parse('2026-11-09')));
  assert.equal(
    reportingArticles(new Date('2020-01-01')).filter((a) => a.liveAt !== null).length,
    0,
  );
  const sql = buildContentQueries(new Date('2026-10-12'), new Date('2026-11-09'), articles)[0];
  assert.ok(!sql.includes("='unknown'"));
});
test('malformed, incomplete, limited, asynchronous and identifier-bearing provider results fail closed', async () => {
  for (const data of [
    null,
    {},
    { columns: ['slug'], results: [], hasMore: true },
    { columns: ['slug'], results: Array(500).fill(['example']) },
    { columns: ['slug', 'person_id'], results: [['example', 'secret-person']] },
    { columns: ['slug', 'visitors'], results: [['example', -1]] },
    {
      columns: ['slug', 'visitors'],
      results: [
        ['example', 1],
        ['example', 1],
      ],
    },
  ])
    assert.throws(() => parseContentResult(data));
  for (const response of [
    () => new Response('secret provider credential', { status: 500 }),
    () => ok(['visitors']),
    () => new Response('not JSON secret'),
  ]) {
    const r = await collectContentReadout(now, {
      apiKey: 'secret-test',
      articles,
      fetch: async () => response(),
    });
    assert.equal(r.status, 'unavailable');
    assert.equal(JSON.stringify(r).includes('secret'), false);
  }
});
test('timeouts and fetch errors redact their details', async () => {
  const r = await collectContentReadout(now, {
    apiKey: 'synthetic',
    articles,
    timeoutMs: 5,
    fetch: async (_url, init) =>
      new Promise((_resolve, reject) =>
        init?.signal?.addEventListener('abort', () =>
          reject(new Error('sensitive provider detail')),
        ),
      ),
  });
  assert.equal(r.reason, 'provider-unavailable');
  assert.ok(!JSON.stringify(r).includes('sensitive'));
});
test('weekly email and admin summary share stored content values; optional failure does not change alert grading', async () => {
  const content = await collectContentReadout(now, {
    apiKey: 'synthetic',
    articles,
    fetch: fixtureFetch([]),
  });
  const base = {
    snapshotId: 'synthetic',
    trigger: 'weekly' as const,
    now,
    runtime: {
      revision: null,
      activeGames: 0,
      databaseRequired: false,
      persistence: 'enabled' as const,
      persistenceErrors: { count1m: 0, lastAt: null },
    },
    facts: { product: null, puzzles: null, mining: null, engines: null },
  };
  const report = buildMistboardReadout({ ...base, facts: { ...base.facts, content } });
  const plain = buildMistboardReadout(base);
  assert.equal(report.alertKey, plain.alertKey);
  assert.equal(report.verdict, plain.verdict);
  for (const line of contentSummary(content)) {
    assert.ok(renderReadoutEmail(report).text.includes(line));
    assert.ok(buildReadoutSummary(report).content.includes(line));
  }
  assert.ok(renderReadoutEmail(report).html.includes('/ops?tab=activity#content'));
  assert.ok(contentSummary()[0].includes('no stored snapshot'));
  assert.ok(!renderReadoutEmail({ ...report, trigger: 'daily' }).text.includes('Example'));
});

test('synthetic inventory excludes future/draft/rules while preserving language-distinct slugs', () => {
  const meta = {
    title: 'Example',
    kind: 'article' as const,
    status: 'published' as const,
    description: 'Example',
    publishedAt: '2026-10-01',
    liveAt: Date.parse('2026-10-01T16:00:00Z'),
  };
  const inventory = reportingArticles(now, {
    example: meta,
    'vi-example': { ...meta, title: 'Vietnamese example' },
    future: { ...meta, liveAt: Date.parse('2026-12-01') },
    draft: { ...meta, status: 'draft' },
    rules: { ...meta, kind: 'rules' },
  });
  assert.deepEqual(
    inventory.map((a) => a.slug),
    ['example', 'vi-example'],
  );
});

test('transport uses only fixed provider/project with rejected redirects and bounds oversized responses', async () => {
  let calls = 0;
  const result = await collectContentReadout(now, {
    apiKey: 'synthetic',
    articles,
    fetch: async (url, init) => {
      calls++;
      assert.equal(url, 'https://us.posthog.com/api/projects/413256/query/');
      assert.equal(init?.redirect, 'error');
      assert.ok(init?.signal);
      return new Response('not consumed', { headers: { 'content-length': '1000001' } });
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.reason, 'invalid-response');
  const unknown = await collectContentReadout(now, {
    apiKey: 'synthetic',
    articles,
    fetch: async (url, init) => {
      const response = await fixtureFetch([])(url, init);
      const data = (await response.json()) as { columns: string[]; results: unknown[][] };
      data.results.push(['unknown', ...data.columns.slice(1).map(() => 999)]);
      return new Response(JSON.stringify(data));
    },
  });
  assert.equal(unknown.status, 'available');
  assert.deepEqual(
    unknown.articles.map((a) => a.slug),
    ['example'],
  );
});
