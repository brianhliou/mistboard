// Routes linked from every page that served the homepage's title and
// description until 2026-10-24 (Bing: duplicate and short titles), and the
// shelf deep links that served the same shell before the client bounced them.
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import type { ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { xiangqiEndgamePracticeSets } from '@mistboard/game';
import { practiceChapterPath } from './practice-chapter-redirect.js';
import { seoMetaLengthProblems } from './seo-meta-length.js';
import { serveSpaShellWithRoutePreloads } from './server-static-pages.js';

// The real shell's default, as apps/web/index.html ships it.
const HOME_TITLE = 'Free Online Chinese Chess (Xiangqi) | Mistboard';
const HOME_DESCRIPTION = 'Play xiangqi (Chinese chess) online for free.';

type Capture = { status: number | null; headers: Record<string, string>; body: string };

function captureResponse(): ServerResponse & Capture {
  const capture: Capture & Record<string, unknown> = {
    status: null,
    headers: {},
    body: '',
    writeHead(status: number, headers?: Record<string, string>) {
      capture.status = status;
      capture.headers = headers ?? {};
      return capture;
    },
    end(chunk?: string) {
      capture.body += chunk ?? '';
      return capture;
    },
  };
  return capture as unknown as ServerResponse & Capture;
}

async function shellDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'mistboard-route-meta-'));
  await writeFile(
    join(dir, 'index.html'),
    `<html lang="en"><head><title>${HOME_TITLE}</title>` +
      '<meta name="robots" content="max-image-preview:large" />' +
      `<meta name="description" content="${HOME_DESCRIPTION}">` +
      '<meta property="og:title" content="old"><meta property="og:description" content="old">' +
      '<meta property="og:url" content="old"><meta property="og:image" content="old">' +
      '</head><body><div id="app"></div></body></html>',
  );
  return dir;
}

async function serve(
  pathname: string,
  extra: { search?: string; practiceChapterPath?: (path: string) => Promise<string | null> } = {},
) {
  const response = captureResponse();
  const served = await serveSpaShellWithRoutePreloads({
    response,
    staticDir: await shellDir(),
    pathname,
    publicHost: 'https://mistboard.com',
    playerPage: async () => null,
    broadcastPage: async () => null,
    gameMeta: async () => null,
    practiceChapterPath: async () => null,
    ...extra,
  });
  return { served, response };
}

const title = (html: string) => html.match(/<title>([^<]*)<\/title>/)?.[1] ?? null;
const description = (html: string) =>
  html.match(/<meta name="description" content="([^"]*)"/)?.[1] ?? null;

test('terms, privacy, contact, watch and thanks serve their own title and description', async () => {
  const seen = new Set<string>();
  for (const route of ['/terms', '/privacy', '/contact', '/watch', '/thanks']) {
    const { served, response } = await serve(route);
    assert.equal(served, true, route);
    const t = title(response.body);
    const d = description(response.body);
    assert.ok(t && t !== HOME_TITLE, `${route} serves the homepage title`);
    assert.ok(d && d !== HOME_DESCRIPTION, `${route} serves the homepage description`);
    assert.doesNotMatch(response.body, /noindex/, `${route} must stay indexable`);
    assert.deepEqual(seoMetaLengthProblems(route, { title: t, description: d }), []);
    assert.ok(!seen.has(t), `${route} repeats another route's title`);
    seen.add(t);
  }
});

test('the lag diagnostic and the title-verification form are noindexed', async () => {
  for (const route of ['/lag', '/verify-title']) {
    const { served, response } = await serve(route);
    assert.equal(served, true, route);
    assert.match(response.body, /<meta name="robots" content="noindex, follow"/, route);
    assert.equal(response.body.match(/name="robots"/g)?.length, 1, `${route}: one robots tag`);
  }
});

test('a resolved shelf deep link is a 301 to its chapter, keeping the query', async () => {
  const { served, response } = await serve('/practice/endgames-horse/horse-vs-advisor', {
    search: '?utm_source=x',
    practiceChapterPath: async () => '/study/S1/C2',
  });
  assert.equal(served, true);
  assert.equal(response.status, 301);
  assert.equal(response.headers.location, '/study/S1/C2?utm_source=x');
  assert.match(response.headers['cache-control'] ?? '', /max-age=86400/);
});

test('an unresolved shelf deep link keeps the shell for the client to degrade', async () => {
  const { response } = await serve('/practice/endgames-horse/horse-vs-advisor');
  assert.notEqual(response.status, 301);
});

const horse = xiangqiEndgamePracticeSets().find((set) => set.slug === 'endgames-horse')!;
const target = horse.chapters.find((chapter) => chapter.id === 'horse-vs-advisor')!;

test('the shelf lookup finds the chapter whose root is the position', async () => {
  const lookedUp: string[] = [];
  const path = await practiceChapterPath('/practice/endgames-horse/horse-vs-advisor', {
    studyIdForSlug: async (slug) => {
      lookedUp.push(slug);
      return 'S 1';
    },
    chapters: async () => [
      { id: 'other', root: { rootFen: 'not-it' } },
      { id: 'C2', root: { rootFen: target.fen } },
      { id: 'late-duplicate', root: { rootFen: target.fen } },
    ],
  });
  assert.deepEqual(lookedUp, ['endgames-horse']);
  assert.equal(path, '/study/S%201/C2');
});

test('the shelf lookup answers null short of a chapter, and for any other path', async () => {
  const none = { studyIdForSlug: async () => null, chapters: async () => [] };
  assert.equal(await practiceChapterPath('/practice/endgames-horse/horse-vs-advisor', none), null);
  const noChapter = {
    studyIdForSlug: async () => 'S1',
    chapters: async () => [{ id: 'C1', root: { rootFen: 'not-it' } }],
  };
  assert.equal(
    await practiceChapterPath('/practice/endgames-horse/horse-vs-advisor', noChapter),
    null,
  );
  const unreached = {
    studyIdForSlug: async () => assert.fail('not a shelf route'),
    chapters: async () => assert.fail('not a shelf route'),
  };
  assert.equal(
    await practiceChapterPath('/practice/endgames-horse/no-such-position', unreached),
    null,
  );
  assert.equal(await practiceChapterPath('/terms', unreached), null);
});
