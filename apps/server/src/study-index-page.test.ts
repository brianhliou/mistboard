import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import type { ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
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
): PublicStudySummary {
  return { id, name, i18n, chapterCount } as PublicStudySummary;
}

const FIXTURE = [
  // Authored Chinese-first: the English title lives in the en overlay.
  study('abc123', '橘中秘', 40, {
    en: { name: 'Secrets Within the Tangerine' },
    'zh-Hant': { name: '橘中祕' },
  }),
  study('def456', 'Riverbank <basics>', 1),
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

test('/study serves a self canonical, an h1 and a link to every listed study', async () => {
  const { served, response } = await serveStudyList('/study');
  assert.equal(served, true);
  assert.equal(response.status, 200);
  const html = response.body;
  assert.equal(html.match(/rel="canonical"/g)?.length, 1);
  assert.match(html, /<link rel="canonical" href="https:\/\/mistboard\.com\/study">/);
  assertAlternatesToAllThree(html);
  assert.match(html, /<title>Xiangqi Studies \| Mistboard<\/title>/);
  assert.match(
    html,
    /<div id="app"><div class="crawler-copy"><main><h1>Studies<\/h1><p>Public studies on Mistboard: annotated games of xiangqi and its variants, [^<]+<\/p>/,
  );
  assert.match(html, /<a href="\/study\/abc123">Secrets Within the Tangerine<\/a> · 40 chapters/);
  assert.match(html, /<a href="\/study\/def456">Riverbank &lt;basics&gt;<\/a> · 1 chapter</);
  assert.equal(html.match(/<a href="\/study\//g)?.length, FIXTURE.length);
  assert.doesNotMatch(html, /noindex/);
});

test('the study list body has its heading and intro even with no studies', () => {
  for (const [page, heading] of [
    [{ locale: 'en', localePath: '' }, 'Studies'],
    [{ locale: 'zh-Hans', localePath: '/zh-hans' }, '研习'],
    [{ locale: 'zh-Hant', localePath: '/zh-hant' }, '研習'],
  ] as const) {
    const body = renderStudyIndexBody([], page);
    assert.match(body, new RegExp(`^<main><h1>${heading}</h1><p>[^<]+</p></main>$`));
    assert.doesNotMatch(body, /—/);
  }
});

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

for (const { path, htmlLang, heading, linkPrefix, titles } of [
  {
    path: '/zh-hans/study',
    htmlLang: 'zh-Hans',
    heading: '研习',
    linkPrefix: '/zh-hans',
    // No zh-Hans overlay: the Chinese base title, not the English one.
    titles: ['橘中秘', 'Riverbank &lt;basics&gt;'],
  },
  {
    path: '/zh-hant/study',
    htmlLang: 'zh-Hant',
    heading: '研習',
    linkPrefix: '/zh-hant',
    titles: ['橘中祕', 'Riverbank &lt;basics&gt;'],
  },
]) {
  test(`${path} is a Chinese study list: own canonical, alternates, h1 and same-locale links`, async () => {
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
    assert.match(
      html,
      new RegExp(
        `<div id="app"><div class="crawler-copy"><main><h1>${heading}</h1><p>Mistboard [^<]+</p>`,
      ),
    );
    assert.ok(
      html.includes(`<a href="${linkPrefix}/study/abc123">${titles[0]}</a> · 40 章`),
      'localized title and chapter label',
    );
    assert.ok(html.includes(`<a href="${linkPrefix}/study/def456">${titles[1]}</a> · 1 章`));
    assert.equal(html.match(/<a href="\/study\//g), null, 'no English study links');
    assert.doesNotMatch(html, /noindex/);
    assert.doesNotMatch(html, /—/);
  });
}

test('the sitemap lists all three study lists', () => {
  for (const path of ['/study', '/zh-hans/study', '/zh-hant/study']) {
    assert.ok(SITEMAP_STATIC_ROUTES.includes(path), path);
  }
});
