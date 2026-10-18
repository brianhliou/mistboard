import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import type { ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { PublicStudySummary } from './persistence.js';
import { serveSpaShellWithRoutePreloads } from './server-static-pages.js';
import { renderStudyIndexBody } from './study-page-body.js';

// The study list (/study) served crawlers the empty SPA shell until 2026-10-17:
// no canonical, no heading and no link to any study, although it is the page
// that lists them all.

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
  study('abc123', '橘中秘', 40, { en: { name: 'Secrets Within the Tangerine' } }),
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
  assert.match(html, /<title>Xiangqi Studies \| Mistboard<\/title>/);
  assert.match(
    html,
    /<div id="app"><div class="crawler-copy"><main><h1>Xiangqi studies<\/h1><p>[^<]+<\/p>/,
  );
  assert.match(html, /<a href="\/study\/abc123">Secrets Within the Tangerine<\/a> · 40 chapters/);
  assert.match(html, /<a href="\/study\/def456">Riverbank &lt;basics&gt;<\/a> · 1 chapter</);
  assert.equal(html.match(/<a href="\/study\//g)?.length, FIXTURE.length);
  assert.doesNotMatch(html, /noindex/);
});

test('the study list body has its heading and intro even with no studies', () => {
  const body = renderStudyIndexBody([]);
  assert.match(body, /^<main><h1>Xiangqi studies<\/h1><p>/);
  assert.doesNotMatch(body, /<ul>/);
  assert.doesNotMatch(body, /—/);
});
