import assert from 'node:assert/strict';
import { globSync, readFileSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { INDEXNOW_KEY } from '../apps/server/src/indexnow.ts';
import {
  main,
  parseIndexNowState,
  recordAcceptedBatch,
  selectChangedUrls,
  sitemapEntries,
} from './indexnow-submit.mjs';

const NOW = '2026-11-04T21:53:00.000Z';
const OLD = '2026-10-01T21:53:00.000Z';
const BASE = 'https://example.test';
const page = (path, lastmod = '2026-11-01') => ({ url: `${BASE}${path}`, lastmod });
const pages = [page('/rules/jieqi'), page('/players/someone', null)];
const stateFor = (entries, lastSentAt = NOW) =>
  Object.fromEntries(entries.map(({ url, lastmod }) => [url, { lastmod, lastSentAt }]));
const urlset = (entries) =>
  `<urlset>${entries
    .map(
      ({ url, lastmod }) =>
        `<url><loc>${url}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}</url>`,
    )
    .join('')}</urlset>`;

test('reads lastmod per URL, including gaps between dated entries', () => {
  const entries = [pages[0], pages[1], page('/broadcast/round', '2026-11-03')];
  assert.deepEqual(sitemapEntries(urlset(entries)), entries);
});

test('nothing changed selects zero URLs, even when dated URLs were sent long ago', () => {
  const state = { ...stateFor([pages[0]], OLD), ...stateFor([pages[1]]) };
  assert.deepEqual(selectChangedUrls(pages, state, NOW), { urls: [], state, seeded: false });
});

test('one moved lastmod selects exactly that URL, without mutating accepted state', () => {
  const state = stateFor(pages);
  const before = structuredClone(state);
  const moved = { ...pages[0], lastmod: '2026-11-04' };
  assert.deepEqual(selectChangedUrls([moved, pages[1]], state, NOW).urls, [moved]);
  assert.deepEqual(state, before);
});

test('new URLs are selected with and without lastmod', () => {
  const added = [page('/blog/new'), page('/players/new', null)];
  assert.deepEqual(selectChangedUrls([...pages, ...added], stateFor(pages), NOW).urls, added);
  assert.deepEqual(selectChangedUrls(pages, {}, NOW).urls, pages);
});

test('a no-lastmod URL is selected only past 30 days, including the exact boundary', () => {
  const entry = pages[1];
  for (const age of [0, 29, 30, 30 + 1 / 86400000, 31]) {
    const lastSentAt = new Date(Date.parse(NOW) - age * 86400000).toISOString();
    const result = selectChangedUrls([entry], stateFor([entry], lastSentAt), NOW);
    assert.deepEqual(result.urls, age > 30 ? [entry] : [], `${age} days`);
  }
});

test('missing, corrupt and invalid-shaped state select zero URLs and seed a baseline', () => {
  for (const text of [
    null,
    '{',
    'null',
    '[]',
    '42',
    '{"url":{}}',
    '{"url":{"lastmod":null,"lastSentAt":"bad"}}',
  ]) {
    const parsed = parseIndexNowState(text);
    assert.equal(parsed, null);
    assert.deepEqual(selectChangedUrls(pages, parsed, NOW), {
      urls: [],
      state: stateFor(pages),
      seeded: true,
    });
  }
  assert.deepEqual(parseIndexNowState('{}'), {});
  assert.deepEqual(parseIndexNowState(JSON.stringify(stateFor(pages))), stateFor(pages));
});

test('only 200 and 202 advance batch state; failures leave existing and new URLs untouched', () => {
  const state = stateFor(pages, OLD);
  const before = structuredClone(state);
  const batch = [{ ...pages[0], lastmod: '2026-11-04' }, page('/new')];
  for (const status of [200, 202, 204, 400, 403, 422, 429, 500]) {
    const result = recordAcceptedBatch(state, batch, status, NOW);
    assert.deepEqual(state, before);
    assert.deepEqual(
      result,
      [200, 202].includes(status) ? { ...state, ...stateFor(batch) } : before,
    );
  }
});

async function fixture({ entries = pages, state, sections, statuses = [] } = {}) {
  const scratch = resolve(
    '/tmp/burn-scratch',
    basename(fileURLToPath(new URL('..', import.meta.url))),
  );
  await mkdir(scratch, { recursive: true });
  const directory = await mkdtemp(resolve(scratch, 'indexnow-test-'));
  const statePath = resolve(directory, 'indexnow-state-example.test.json');
  if (state !== undefined) {
    await writeFile(statePath, typeof state === 'string' ? state : JSON.stringify(state));
  }
  const requests = [];
  const posts = [];
  const fetchImpl = async (url, options) => {
    requests.push(url);
    if (options?.method === 'POST') {
      assert.equal(url, 'https://api.indexnow.org/indexnow');
      const body = JSON.parse(options.body);
      assert.equal(body.host, 'example.test');
      assert.equal(body.keyLocation, `${BASE}/${INDEXNOW_KEY}.txt`);
      posts.push(body.urlList);
      const status = statuses[posts.length - 1] ?? 200;
      if (status instanceof Error) throw status;
      return new Response('fixture', { status });
    }
    if (url === `${BASE}/sitemap.xml`) {
      return new Response(
        sections
          ? `<sitemapindex>${Object.keys(sections)
              .map((name) => `<sitemap><loc>${BASE}/sitemap-${name}.xml</loc></sitemap>`)
              .join('')}</sitemapindex>`
          : urlset(entries),
      );
    }
    if (url === `${BASE}/${INDEXNOW_KEY}.txt`) return new Response(INDEXNOW_KEY);
    for (const [name, rows] of Object.entries(sections ?? {})) {
      if (url === `${BASE}/sitemap-${name}.xml`) return new Response(urlset(rows));
    }
    assert.fail(`unexpected request: ${url}`);
  };
  return {
    directory,
    statePath,
    posts,
    requests,
    run: (args = ['--changed']) =>
      main(['--base', BASE, ...args], { fetchImpl, directory, now: NOW }),
    state: async () => JSON.parse(await readFile(statePath, 'utf8')),
    logs: async () =>
      (await readFile(resolve(directory, 'indexnow-log.jsonl'), 'utf8'))
        .trim()
        .split('\n')
        .map(JSON.parse),
  };
}

test('runner seeds missing/corrupt state without a POST, then logs zero again on an unchanged run', async () => {
  for (const state of [undefined, '{broken', '[]']) {
    const f = await fixture({ state });
    assert.equal(await f.run(), 0);
    assert.deepEqual(await f.state(), stateFor(pages));
    assert.equal(await f.run(), 0);
    assert.deepEqual(f.posts, []);
    assert.ok(f.requests.every((url) => url.endsWith('/sitemap.xml')));
    const logs = await f.logs();
    assert.deepEqual(
      logs.map(({ submitted }) => submitted),
      [0, 0],
    );
    assert.ok(logs.every(({ accepted, failedBatches }) => accepted === 0 && failedBatches === 0));
  }
});

test('an unreadable state file seeds without posting', async () => {
  const f = await fixture({ state: {} });
  await chmod(f.statePath, 0o000);
  await assert.rejects(readFile(f.statePath), { code: 'EACCES' });
  assert.equal(await f.run(), 0);
  assert.deepEqual(f.posts, []);
  assert.deepEqual(await f.state(), stateFor(pages));
  assert.equal((await f.logs())[0].submitted, 0);
});

test('runner persists accepted batches and retries HTTP/network failures on the next release', async () => {
  const entries = [page('/one'), page('/two'), page('/three'), page('/four')];
  const initial = stateFor(
    entries.map((entry) => ({ ...entry, lastmod: '2026-10-01' })),
    OLD,
  );
  const f = await fixture({
    entries,
    state: initial,
    statuses: [200, 500, new Error('offline fixture'), 202],
  });
  assert.equal(await f.run(['--changed', '--batch', '1']), 1);
  assert.deepEqual(await f.state(), { ...initial, ...stateFor([entries[0], entries[3]]) });
  const [log] = await f.logs();
  assert.equal(log.submitted, 4);
  assert.equal(log.accepted, 2);
  assert.equal(log.failedBatches, 2);
  assert.equal(await f.run(['--changed', '--batch', '1']), 0);
  assert.deepEqual(f.posts.slice(4), [[entries[1].url], [entries[2].url]]);
  assert.deepEqual(await f.state(), stateFor(entries));
});

test('runner reads all sitemap sections and sends only changed lastmods', async () => {
  const sections = {
    pages: [pages[0]],
    players: [pages[1]],
    broadcasts: [page('/broadcast/round')],
    studies: [page('/study/one')],
  };
  const entries = Object.values(sections).flat();
  const state = stateFor(entries);
  state[sections.broadcasts[0].url].lastmod = '2026-10-31';
  state[sections.studies[0].url].lastmod = '2026-10-31';
  const f = await fixture({ sections, state });
  assert.equal(await f.run(), 0);
  assert.deepEqual(f.posts, [[sections.broadcasts[0].url, sections.studies[0].url]]);
});

test('manual sweep keeps only/prerendered/batch filters and updates only accepted URLs', async () => {
  const sections = {
    pages: [page('/zh-hans/rules/jieqi'), page('/rules/jieqi')],
    players: [page('/zh-hans/players/one', null)],
    broadcasts: [page('/zh-hans/broadcast/one'), page('/zh-hans/study/extra')],
    studies: [page('/zh-hans/study/one')],
  };
  const f = await fixture({ sections, state: {} });
  assert.equal(await f.run(['--only', '/zh-hans/', '--prerendered', '--batch', '2']), 0);
  const selected = [sections.pages[0], sections.players[0], sections.broadcasts[0]];
  assert.deepEqual(f.posts, [selected.slice(0, 2).map(({ url }) => url), [selected[2].url]]);
  assert.ok(!f.requests.some((url) => url.includes('sitemap-studies')));
  assert.deepEqual(await f.state(), stateFor(selected));
});

test('no-flag manual sweep sends every same-host URL, including studies, even if unchanged', async () => {
  const entries = [...pages, page('/study/one')];
  const f = await fixture({
    entries: [...entries, { url: 'https://other.test/page', lastmod: null }, entries[0]],
    state: stateFor(entries),
  });
  assert.equal(await f.run([]), 0);
  assert.deepEqual(f.posts, [entries.map(({ url }) => url)]);
});

test('dry runs write no state or log, including bootstrap and filtered manual sweeps', async () => {
  for (const state of [undefined, '{broken', {}]) {
    const f = await fixture({ state });
    assert.equal(await f.run(['--changed', '--dry-run']), 0);
    assert.equal(await f.run(['--dry-run', '--only', '/players/', '--prerendered']), 0);
    assert.deepEqual(f.posts, []);
    if (state === undefined) await assert.rejects(readFile(f.statePath), { code: 'ENOENT' });
    else
      assert.equal(
        await readFile(f.statePath, 'utf8'),
        typeof state === 'string' ? state : JSON.stringify(state),
      );
    await assert.rejects(f.logs(), { code: 'ENOENT' });
  }
});

test('a manual sweep with no state records none, so the next --changed seeds and sends nothing', async () => {
  for (const state of [undefined, '{broken']) {
    const f = await fixture({ state });
    assert.equal(await f.run(['--only', '/rules/']), 0);
    assert.deepEqual(f.posts, [[pages[0].url]]);
    assert.equal(await f.run(), 0);
    assert.equal(f.posts.length, 1);
    assert.deepEqual(await f.state(), stateFor(pages));
  }
});

test('--changed --prerendered seeds studies too, so a later plain --changed sends nothing', async () => {
  const sections = { pages: [pages[0]], studies: [page('/study/one')] };
  const f = await fixture({ sections });
  assert.equal(await f.run(['--changed', '--prerendered']), 0);
  assert.deepEqual(await f.state(), stateFor([...sections.pages, ...sections.studies]));
  assert.equal(await f.run(), 0);
  assert.deepEqual(f.posts, []);
});

test('an empty section refuses to seed, then seeds once it is back', async () => {
  const sections = { pages: [pages[0]], studies: [] };
  const f = await fixture({ sections });
  await assert.rejects(f.run(), /empty/);
  await assert.rejects(readFile(f.statePath), { code: 'ENOENT' });
  sections.studies = [page('/study/one')];
  assert.equal(await f.run(), 0);
  assert.equal(await f.run(), 0);
  assert.deepEqual(f.posts, []);
});

test('state is per host: another base neither reads nor writes this host', async () => {
  const f = await fixture({ state: stateFor(pages) });
  const other = 'https://staging.example.test';
  const fetchImpl = async () =>
    new Response(urlset([{ url: `${other}/rules/jieqi`, lastmod: '2026-11-01' }]));
  assert.equal(
    await main(['--base', other, '--changed'], { fetchImpl, directory: f.directory, now: NOW }),
    0,
  );
  assert.deepEqual(await f.state(), stateFor(pages));
});

test('the configured tooling runner discovers indexnow-submit.test.mjs', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const nodeCommand = pkg.scripts['test:tooling'].split('&&')[0].trim();
  assert.ok(nodeCommand.startsWith('node --test '));
  const listed = globSync(nodeCommand.slice('node --test '.length).split(/\s+/));
  assert.ok(listed.includes('scripts/indexnow-submit.test.mjs'));
});
