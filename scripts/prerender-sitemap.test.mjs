import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  contentSources,
  gitContentDate,
  prerenderSitemapRecord,
  writePrerenderSitemap,
} from '../apps/web/scripts/prerender-sitemap.mjs';

const host = 'https://mistboard.test';
const head = (path, alternates = '') =>
  `<html><head><link rel="canonical" href="${host}${path}">${alternates}</head><body><h1>Page</h1><p>${'Page-owned content. '.repeat(12)}</p></body></html>`;

test('prerender records the exact head hreflang group, including non-UI translation partners', () => {
  const links = [
    ['en', '/blog/a'],
    ['zh-Hans', '/zh-hans/blog/a'],
    ['vi', '/blog/vietnamese-a'],
    ['x-default', '/blog/a'],
  ];
  const html = head(
    '/blog/a',
    links
      .map(([lang, path]) => `<link href="${host}${path}" hreflang="${lang}" rel="alternate">`)
      .join(''),
  );
  const record = prerenderSitemapRecord(html, 'blog/a.html', host, () => '2026-11-01');
  assert.deepEqual(
    record.alternates,
    links.map(([lang, path]) => ({ lang, path })),
  );
  assert.equal(record.lastmod, '2026-11-01');
  // Planted regressions: inventing dates or accepting a foreign alternate.
  assert.throws(
    () => prerenderSitemapRecord(html, 'a.html', host, () => undefined),
    /missing source-content date/,
  );
  assert.throws(
    () =>
      prerenderSitemapRecord(
        head('/a', '<link rel="alternate" hreflang="en" href="https://other.test/a">'),
        'a.html',
        host,
        () => '2026-11-01',
      ),
    /foreign prerender alternate/,
  );
  assert.equal(
    prerenderSitemapRecord(
      head('/a').replace('</head>', '<meta name="robots" content="noindex"></head>'),
      'a.html',
      host,
      () => '2026-11-01',
    ),
    null,
  );
  assert.equal(
    prerenderSitemapRecord('<head></head>', 'shell.html', host, () => '2026-11-01'),
    null,
  );
});

test('blank, shell-only and short prerenders cannot enter the sitemap', () => {
  for (const body of [
    '<h1>Short</h1>',
    `<nav><h1>Menu</h1>${'Navigation '.repeat(30)}</nav>`,
    `<p>${'Missing heading '.repeat(20)}</p>`,
  ]) {
    assert.equal(
      prerenderSitemapRecord(
        `<head><link rel="canonical" href="${host}/planted"></head><body>${body}</body>`,
        'planted.html',
        host,
        () => '2026-10-01',
      ),
      null,
    );
  }
});

test('prerender sitemap records use the crawler CJK count in every locale', () => {
  for (const prefix of ['', '/zh-hans', '/zh-hant']) {
    for (const char of ['象', '𠀀', 'カ']) {
      const record = (count) =>
        prerenderSitemapRecord(
          `<head><link rel="canonical" href="${host}${prefix}/rules"></head><body><h1>象</h1><p>${char.repeat(count)}</p></body>`,
          'rules.html',
          host,
          () => '2026-11-01',
        );
      assert.equal(record(74).contentChars, 150);
      // Planted failure: a heading and 73 ideographs still fall below 150.
      assert.equal(record(73), null);
    }
  }
});

test('blank prerenders retain source dates only when their exact path is a tracked gap', () => {
  const html = `<head><link rel="canonical" href="${host}/about"></head><body></body>`;
  const record = prerenderSitemapRecord(
    html,
    'about.html',
    host,
    () => '2026-10-01',
    new Set(['/about']),
  );
  assert.equal(record.path, '/about');
  assert.equal(record.contentChars, 0);
  assert.equal(record.lastmod, '2026-10-01');
  // Planted untracked shell: a gap on another page must not admit this page.
  assert.equal(
    prerenderSitemapRecord(html, 'about.html', host, () => '2026-10-01', new Set(['/study'])),
    null,
  );
});

test('article lastmod uses its content date rather than a build date', () => {
  const published = head('/blog/a').replace(
    '</head>',
    '<script type="application/ld+json">{"datePublished":"2026-10-01","dateModified":"2026-10-07"}</script></head>',
  );
  assert.equal(
    prerenderSitemapRecord(published, 'a.html', host, () => '2026-11-07').lastmod,
    '2026-10-07',
  );
});

test('git source dates survive unrelated commits and change with the catalog', async () => {
  const repo = await mkdtemp(join(tmpdir(), 'sitemap-source-date-'));
  const git = (args, date) =>
    execFileSync('git', args, {
      cwd: repo,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
    });
  git(['init'], '2026-10-01T12:00:00Z');
  const commit = (date) => {
    git(['add', 'catalog.ts', 'unrelated.ts'], date);
    git(
      [
        '-c',
        'user.name=Sitemap test',
        '-c',
        'user.email=sitemap@example.test',
        'commit',
        '-m',
        'fixture',
      ],
      date,
    );
  };
  await writeFile(join(repo, 'catalog.ts'), 'first');
  await writeFile(join(repo, 'unrelated.ts'), 'first');
  commit('2026-10-01T12:00:00Z');
  assert.equal(gitContentDate(repo, ['catalog.ts']), '2026-10-01');
  await writeFile(join(repo, 'unrelated.ts'), 'second');
  commit('2026-10-02T12:00:00Z');
  assert.equal(gitContentDate(repo, ['catalog.ts']), '2026-10-01');
  await writeFile(join(repo, 'catalog.ts'), 'second');
  commit('2026-10-03T12:00:00Z');
  assert.equal(gitContentDate(repo, ['catalog.ts']), '2026-10-03');
  assert.throws(() => gitContentDate(repo, ['missing.ts']), /no git content date/);
  assert.ok(
    contentSources('/zh-hant/washington-xiangqi').includes(
      'apps/web/src/i18n/catalogs/content.zh-hant.ts',
    ),
  );
});

test('the prerender writes a sidecar for root and nested locale pages without altering HTML', async () => {
  const dist = await mkdtemp(join(tmpdir(), 'sitemap-prerender-'));
  const repo = new URL('..', import.meta.url).pathname;
  await mkdir(join(dist, 'zh-hans'), { recursive: true });
  const html = head('/zh-hans/washington-xiangqi');
  await writeFile(join(dist, 'zh-hans', 'washington-xiangqi.html'), html);
  await writePrerenderSitemap(dist, host, repo);
  const records = JSON.parse(await readFile(join(dist, 'prerender-sitemap.json'), 'utf8'));
  assert.equal(
    records.find((r) => r.path === '/zh-hans/washington-xiangqi').file,
    'zh-hans/washington-xiangqi.html',
  );
  assert.equal(await readFile(join(dist, 'zh-hans', 'washington-xiangqi.html'), 'utf8'), html);
});

test('server-only tracked gaps keep content dates and locale groups without a fabricated artifact', async () => {
  const dist = await mkdtemp(join(tmpdir(), 'sitemap-tracked-gaps-'));
  const repo = new URL('..', import.meta.url).pathname;
  const paths = ['/study', '/zh-hans/study', '/zh-hant/study'];
  const alternates = [
    ...paths.map((path, index) => ({ lang: ['en', 'zh-Hans', 'zh-Hant'][index], path })),
    { lang: 'x-default', path: '/study' },
  ];
  await writePrerenderSitemap(
    dist,
    host,
    repo,
    paths.map((path) => ({ path, alternates })),
  );
  const records = JSON.parse(await readFile(join(dist, 'prerender-sitemap.json'), 'utf8'));
  for (const path of paths) {
    const record = records.find((entry) => entry.path === path);
    assert.equal(record.lastmod, gitContentDate(repo, contentSources(path)));
    assert.deepEqual(record.alternates, alternates);
    assert.equal(record.file, undefined);
    assert.equal(record.contentChars, undefined);
  }
  assert.equal(
    records.some((entry) => entry.path === '/planted-unclassified'),
    false,
  );
});
