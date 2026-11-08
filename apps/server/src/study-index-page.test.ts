import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import type { ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DATA_PAGE_COPY } from './data-page-copy.js';
import type { PublicStudySummary } from './persistence.js';
import { SITEMAP_STATIC_ROUTES, serveSpaShellWithRoutePreloads } from './server-static-pages.js';
import { renderStudyIndexBody } from './study-page-body.js';

// The study list (/study) served crawlers the empty SPA shell until 2026-10-17:
// no canonical, no heading and no link to any study, although it is the page
// that lists them all. The Chinese lists (/zh-hans/study, /zh-hant/study) did
// not exist at all, though every study had its zh pages.

type Capture = { body: string; status: number | null };

function captureResponse(): ServerResponse & Capture {
  const capture = {
    body: '',
    status: null as number | null,
    writeHead(status: number) {
      capture.status = status;
      return capture;
    },
    end(chunk?: string) {
      capture.body += chunk ?? '';
      return capture;
    },
  };
  return capture as ServerResponse & Capture;
}

const SHELL =
  '<html lang="en"><head><title>Mistboard</title>' +
  '<meta name="description" content="old"><meta property="og:title" content="old">' +
  '<meta property="og:description" content="old"><meta property="og:url" content="old">' +
  '</head><body><div id="app"></div></body></html>';

function study(
  id: string,
  name: string,
  chapterCount: number,
  i18n: Record<string, unknown> = {},
  chapterPreview: PublicStudySummary['chapterPreview'] = [],
): PublicStudySummary {
  return { id, name, i18n, chapterCount, chapterPreview } as PublicStudySummary;
}

const FIXTURE = [
  // Authored Chinese-first: the English title lives in the en overlay.
  study(
    'abc123',
    '橘中秘',
    40,
    { en: { name: 'Secrets Within the Tangerine' }, 'zh-Hant': { name: '橘中祕' } },
    [
      {
        name: '顺手炮',
        i18n: { en: { name: 'Same-direction cannon' }, 'zh-Hant': { name: '順手炮' } },
      },
      {
        name: '列手炮',
        i18n: { en: { name: 'Opposite-direction cannon' } },
      },
    ],
  ),
  study('def456', 'Riverbank <basics>', 1, {}, [{ name: 'Riverbank <opening>', i18n: {} }]),
];

async function serveStudyList(pathname: string) {
  const staticDir = await mkdtemp(join(tmpdir(), 'mistboard-study-index-'));
  await writeFile(join(staticDir, 'index.html'), SHELL, 'utf-8');
  const response = captureResponse();
  const served = await serveSpaShellWithRoutePreloads({
    response,
    staticDir,
    pathname,
    publicHost: 'https://mistboard.com',
    listPublicStudies: async () => FIXTURE,
  });
  return { served, response };
}

test('/study serves a self canonical, the catalog heading and study links with chapter previews', async () => {
  const { served, response } = await serveStudyList('/study');
  assert.equal(served, true);
  assert.equal(response.status, 200);
  const html = response.body;
  assert.equal(html.match(/rel="canonical"/g)?.length, 1);
  assert.match(html, /<link rel="canonical" href="https:\/\/mistboard\.com\/study">/);
  assertAlternatesToAllThree(html);
  assert.match(html, /<title>Xiangqi Studies \| Mistboard<\/title>/);
  const body = crawlerCopy(html);
  assert.ok(body.startsWith(`<main><h1>${DATA_PAGE_COPY.en['study.indexAll']}</h1><ul>`));
  assert.ok(
    body.includes(
      '<a href="/study/abc123">Secrets Within the Tangerine</a>' +
        '<ol><li>Same-direction cannon</li><li>Opposite-direction cannon</li><li>+38 more</li></ol>',
    ),
  );
  assert.ok(
    body.includes(
      '<a href="/study/def456">Riverbank &lt;basics&gt;</a>' +
        '<ol><li>Riverbank &lt;opening&gt;</li></ol>',
    ),
  );
  assert.doesNotMatch(body, /<p>/);
  assert.equal(body.match(/<a href="\/study\//g)?.length, FIXTURE.length);
  assert.doesNotMatch(html, /noindex/);
});

test('an empty study list still serves the catalog heading in every locale without an intro', () => {
  for (const page of [
    { locale: 'en', localePath: '' },
    { locale: 'zh-Hans', localePath: '/zh-hans' },
    { locale: 'zh-Hant', localePath: '/zh-hant' },
  ] as const) {
    const body = renderStudyIndexBody([], page);
    assert.equal(body, `<main><h1>${DATA_PAGE_COPY[page.locale]['study.indexAll']}</h1></main>`);
    if (page.locale !== 'en') assert.doesNotMatch(body.replace(/<[^>]*>/g, ''), /[a-z]/i);
    assert.doesNotMatch(body, /—/);
  }
});

function crawlerCopy(html: string): string {
  const match = html.match(/<div id="app"><div class="crawler-copy">([\s\S]*?)<\/div><\/div>/);
  assert.ok(match, 'study list body is inside crawler-copy');
  return match[1];
}

function assertAlternatesToAllThree(html: string) {
  for (const [hreflang, href] of [
    ['en', 'https://mistboard.com/study'],
    ['zh-Hans', 'https://mistboard.com/zh-hans/study'],
    ['zh-Hant', 'https://mistboard.com/zh-hant/study'],
    ['x-default', 'https://mistboard.com/study'],
  ]) {
    assert.ok(
      html.includes(`<link rel="alternate" hreflang="${hreflang}" href="${href}">`),
      `${hreflang} alternate`,
    );
  }
}

for (const { path, htmlLang, linkPrefix, titles, previews } of [
  {
    path: '/zh-hans/study',
    htmlLang: 'zh-Hans' as const,
    linkPrefix: '/zh-hans',
    // No zh-Hans overlay: the Chinese base title, not the English one.
    titles: ['橘中秘', 'Riverbank &lt;basics&gt;'],
    previews: ['顺手炮', '列手炮'],
  },
  {
    path: '/zh-hant/study',
    htmlLang: 'zh-Hant' as const,
    linkPrefix: '/zh-hant',
    titles: ['橘中祕', 'Riverbank &lt;basics&gt;'],
    previews: ['順手炮', '列手炮'],
  },
]) {
  test(`${path} serves its canonical, alternates, catalog heading and localized study previews`, async () => {
    const { served, response } = await serveStudyList(path);
    assert.equal(served, true);
    assert.equal(response.status, 200);
    const html = response.body;
    assert.match(html, new RegExp(`^<html lang="${htmlLang}">`));
    assert.equal(html.match(/rel="canonical"/g)?.length, 1);
    assert.ok(html.includes(`<link rel="canonical" href="https://mistboard.com${path}">`));
    assertAlternatesToAllThree(html);
    assert.match(html, /<title>[^<]*研[习習][^<]*\| Mistboard<\/title>/);
    assert.doesNotMatch(html, /<title>Xiangqi Studies/);
    const body = crawlerCopy(html);
    assert.ok(body.startsWith(`<main><h1>${DATA_PAGE_COPY[htmlLang]['study.indexAll']}</h1><ul>`));
    assert.ok(
      body.includes(
        `<a href="${linkPrefix}/study/abc123">${titles[0]}</a>` +
          `<ol><li>${previews[0]}</li><li>${previews[1]}</li><li>另有 38 章</li></ol>`,
      ),
      'localized title, chapter previews and remaining-chapter label',
    );
    assert.ok(
      body.includes(
        `<a href="${linkPrefix}/study/def456">${titles[1]}</a>` +
          '<ol><li>Riverbank &lt;opening&gt;</li></ol>',
      ),
      'untranslated study and chapter names fall back to their base values',
    );
    assert.doesNotMatch(
      body,
      /<p>|All studies|Same-direction cannon|Opposite-direction cannon|more/,
    );
    assert.equal(body.match(/<a href="\/study\//g), null, 'no English study links');
    assert.equal(
      body.match(new RegExp(`<a href="${linkPrefix}/study/`, 'g'))?.length,
      FIXTURE.length,
    );
    assert.doesNotMatch(html, /noindex/);
    assert.doesNotMatch(html, /—/);
  });
}

test('the sitemap lists all three study lists', () => {
  for (const path of ['/study', '/zh-hans/study', '/zh-hant/study']) {
    assert.ok(SITEMAP_STATIC_ROUTES.includes(path), path);
  }
});
