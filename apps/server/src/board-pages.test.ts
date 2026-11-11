import './variant-tenant/register-tenants.js';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import type { ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { loadSeedPuzzleRegistry } from '@mistboard/game/puzzle-seed';
import {
  botBoardPage,
  historicalBoardPage,
  profileBoardBody,
  puzzleBoardBody,
  puzzleHeading,
} from './board-pages.js';
import { type BoardLocale, boardCopy } from './board-text-copy.js';
import {
  CRAWLER_BOT,
  CRAWLER_HISTORICAL_GAME,
  CRAWLER_PROFILE,
  CRAWLER_PUBLIC_GAME,
  crawlerFixtureSources,
} from './crawler-content-fixtures.js';
import { CRAWLER_CONTENT_MANIFEST } from './crawler-content-manifest.js';
import { serveSpaShellWithRoutePreloads, serveStudyPage } from './server-static-pages.js';

const shell =
  '<html lang="en"><head><title>Default</title><link rel="stylesheet" href="/base.css"></head><body><div id="app"></div></body></html>';
function capture() {
  const response = {
    body: '',
    writeHead() {},
    end(body: string) {
      response.body = body;
    },
  };
  return response as unknown as ServerResponse & { body: string };
}

test('fixture pages satisfy their actual crawler contracts, socketlessly, inside crawler-copy', async () => {
  const { pageFailures } = await import(
    pathToFileURL(resolve(import.meta.dirname, '../../../scripts/crawler-floor.mjs')).href
  );
  const { serverBodyProblems } = await import(
    pathToFileURL(resolve(import.meta.dirname, '../../../scripts/server-body-check.mjs')).href
  );
  const dir = await mkdtemp(join(tmpdir(), 'mistboard-board-text-'));
  await writeFile(join(dir, 'index.html'), shell);
  const sources = crawlerFixtureSources();
  const paths = [
    '/historical-xiangqi/game/hxq_crawler',
    '/puzzles/crawler-puzzle',
    '/bot/pikafish',
    '/@/crawler-player',
    '/players/crawler-player',
    '/broadcast/xiangqi/board/crawler-board',
    '/study/CrawlerStudy/CrawlerChapter',
  ];
  for (const path of paths) {
    const response = capture();
    if (path.startsWith('/study/'))
      await serveStudyPage({
        response,
        staticDir: dir,
        publicHost: 'https://mistboard.test',
        studyId: 'CrawlerStudy',
        chapterId: 'CrawlerChapter',
        getStudy: sources.getStudy,
      });
    else
      await serveSpaShellWithRoutePreloads({
        ...sources,
        response,
        staticDir: dir,
        pathname: path,
        publicHost: 'https://mistboard.test',
      });
    const entry = CRAWLER_CONTENT_MANIFEST.find((e) => e.path === path)!;
    assert.ok(entry, path);
    assert.equal(entry.knownGap, undefined, path);
    assert.deepEqual(pageFailures(entry, { status: 200, html: response.body }).failures, [], path);
    assert.deepEqual(
      serverBodyProblems(response.body, '.crawler-copy{animation:crawler-copy-reveal 0s 4s both}'),
      [],
      path,
    );
    assert.match(response.body, /<div id="app"><div class="crawler-copy">/);
    if (/historical|puzzles|study|board/.test(path)) {
      assert.match(response.body, /<code>[^<]+<\/code>/);
      assert.match(response.body, /<ol><li>/);
    }
    if (/historical|puzzles/.test(path))
      assert.doesNotMatch(response.body, /<title>Default<\/title>/);
  }
});

test('historical games use public archive facts and fix the default title', async () => {
  const page = await historicalBoardPage(
    '/historical-xiangqi/game/hxq_crawler',
    'en',
    async () => CRAWLER_HISTORICAL_GAME,
  );
  assert.match(
    page?.meta?.title ?? '',
    /孟繁睿 vs 尹昇, Crawler fixture invitational 2026 \| Mistboard/,
  );
  assert.match(page?.body ?? '', /<ol><li>Che3/);
  assert.match(page?.body ?? '', /<dd>1-0<\/dd>/);
  for (const value of [null, { ...CRAWLER_HISTORICAL_GAME, visibility: 'private' as const }]) {
    assert.deepEqual(
      await historicalBoardPage('/historical-xiangqi/game/private', 'en', async () => value),
      { noindex: true },
    );
  }
  const unlisted = await historicalBoardPage(
    '/historical-xiangqi/game/unlisted',
    'en',
    async () => ({ ...CRAWLER_HISTORICAL_GAME, visibility: 'unlisted' }),
  );
  assert.equal(unlisted?.noindex, true);
  assert.match(unlisted?.body ?? '', /<ol><li>/);
  let reads = 0;
  assert.deepEqual(
    await historicalBoardPage('/historical-xiangqi/game/%ZZ', 'en', async () => {
      reads++;
      return null;
    }),
    { noindex: true },
  );
  assert.equal(reads, 0);
});

test('puzzles publish the start position and a closed solution in every locale', async () => {
  const puzzle = loadSeedPuzzleRegistry('xiangqi')[0]!;
  for (const locale of ['en', 'zh-Hans', 'zh-Hant'] as BoardLocale[]) {
    const body = await puzzleBoardBody(puzzle, puzzleHeading(puzzle, locale), locale, null);
    assert.ok(body.includes(`<summary>${boardCopy(locale, 'puzzle.solution')}</summary>`));
    assert.match(body, /<details><summary>[^<]+<\/summary>[\s\S]*<ol><li>/);
    assert.doesNotMatch(body, /<details[^>]+open/);
    assert.match(body.split('<details>')[0]!, /<code>[^<]+<\/code>/);
    if (locale !== 'en') assert.doesNotMatch(body, /Solution|Theme:|to move|Moves/);
  }
});

test('puzzle source links obey the detail API hosted and online-platform policy', async () => {
  const puzzle = loadSeedPuzzleRegistry('xiangqi')[0]!;
  assert.equal(puzzle.variant, 'xiangqi');
  if (puzzle.variant !== 'xiangqi') return;
  const withSource = {
    ...puzzle,
    sourceGame: {
      gameId: 'source-game',
      ply: 1,
      redName: 'Red player',
      blackName: 'Black player',
      event: 'Fixture cup',
    },
  };
  const body = await puzzleBoardBody(withSource, 'Puzzle', 'en', async () => ({
    moves: [{ from: 'a4', to: 'a5' }],
    redNameRaw: 'Archive red',
    blackNameRaw: 'Archive black',
    visibility: 'public',
  }));
  assert.match(body, /href="\/historical-xiangqi\/game\/source-game"/);
  assert.match(body, /Archive red/);
  assert.doesNotMatch(body, /Red player/);
});

test('profile games whitelist summary fields and exclude private and hidden-variant games', () => {
  const profile = {
    ...CRAWLER_PROFILE,
    games: [
      { ...CRAWLER_PUBLIC_GAME, board: 'HIDDEN_STATE_SENTINEL', events: ['HIDDEN_EVENT_SENTINEL'] },
      {
        ...CRAWLER_PUBLIC_GAME,
        visibility: 'private' as const,
        whiteName: 'PRIVATE_NAME_SENTINEL',
      },
      {
        ...CRAWLER_PUBLIC_GAME,
        variant: 'unregistered-hidden',
        whiteName: 'HIDDEN_VARIANT_SENTINEL',
      },
    ],
  };
  const html = profileBoardBody(profile, ['Xiangqi 1742'], 'en');
  assert.match(html, /Public opponent/);
  assert.match(html, /<table>/);
  assert.match(html, /href="\/xiangqi\/game\/crawler-game"/);
  assert.doesNotMatch(JSON.stringify(html), /SENTINEL|participants/);
});

test('bot bodies show strength, per-variant records and public games without private internals', async () => {
  for (const locale of ['en', 'zh-Hans', 'zh-Hant'] as BoardLocale[]) {
    const page = await botBoardPage('/bot/pikafish', locale, async () => ({
      ...CRAWLER_BOT,
      activeEngineId: 'PRIVATE_ENGINE_SENTINEL',
    }));
    assert.match(page?.body ?? '', /2700/);
    assert.match(page?.body ?? '', /12-6-2/);
    assert.match(page?.body ?? '', /Public opponent/);
    assert.ok(page?.body?.includes(boardCopy(locale, 'bots.variants')));
    assert.doesNotMatch(JSON.stringify(page), /SENTINEL/);
    if (locale !== 'en')
      assert.doesNotMatch(page?.body ?? '', /First-party|Variants|No published rating/);
  }
  assert.deepEqual(
    await botBoardPage('/bot/private', 'en', async () => ({
      ...CRAWLER_BOT,
      visibility: 'private',
    })),
    { noindex: true },
  );
});

test('locale query reaches every new server body without English labels or move notation', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mistboard-board-locales-'));
  await writeFile(join(dir, 'index.html'), shell);
  const sources = crawlerFixtureSources();
  for (const locale of ['zh-Hans', 'zh-Hant'] as const) {
    for (const pathname of [
      '/historical-xiangqi/game/hxq_crawler',
      '/puzzles/crawler-puzzle',
      '/bot/pikafish',
      '/@/crawler-player',
      '/players/crawler-player',
      '/broadcast/xiangqi/board/crawler-board',
    ]) {
      const response = capture();
      await serveSpaShellWithRoutePreloads({
        ...sources,
        response,
        staticDir: dir,
        pathname,
        search: `?lang=${locale.toLowerCase()}`,
        publicHost: 'https://mistboard.test',
      });
      const body = response.body.split('<div class="crawler-copy">')[1]!;
      assert.ok(body, pathname);
      if (pathname.includes('historical') || pathname.includes('/board/')) {
        assert.ok(body.includes(boardCopy(locale, 'replay.moves')), pathname);
        assert.match(body, /炮二平五/);
      }
      if (pathname.includes('puzzles'))
        assert.ok(body.includes(boardCopy(locale, 'puzzle.solution')));
      if (pathname.includes('/bot/'))
        assert.doesNotMatch(body, /Variants|First-party|blitz|No published rating/);
      if (pathname.includes('/@/')) assert.doesNotMatch(body, /Player profile|rating|blitz/);
      if (pathname.includes('/players/'))
        assert.doesNotMatch(body, /<th>(Date|Opponent|Result|Event)<\/th>/);
    }
  }
});
