import { expect, type Page, test } from '@playwright/test';

import { capture, expectNoErrors, horizontalOverflow, trackPageErrors } from './support';

// Route sweep: every key page renders, is not the branded 404, has no console
// errors and no sideways scroll, at desktop and phone widths. The route list
// is scripts/mobile-loop.mjs's golden path plus one analysis board per variant
// (board mounted, engine left off; the engine gate is prod:smoke:ceval) and
// the persistence-backed game review. Re-check the list against
// isClientRoute in apps/server/src/server-policy.ts when routes move.

type Route = { name: string; path: string; ready?: string };

const ROUTES: Route[] = [
  { name: 'home', path: '/', ready: '.landing-play-panel' },
  { name: 'play', path: '/play', ready: '.landing-play-panel' },
  { name: 'puzzles', path: '/puzzles', ready: 'h1' },
  { name: 'watch', path: '/watch' },
  { name: 'broadcast-xiangqi', path: '/broadcast/xiangqi', ready: 'h1' },
  { name: 'learn-xiangqi', path: '/learn/xiangqi', ready: 'h1' },
  { name: 'rules', path: '/rules', ready: 'h1' },
  { name: 'rules-xiangqi', path: '/rules/xiangqi', ready: 'h1' },
  { name: 'blog', path: '/blog', ready: 'h1' },
  { name: 'leaderboard', path: '/leaderboard', ready: 'h1' },
  { name: 'account', path: '/account', ready: 'h1' },
  { name: 'contact', path: '/contact', ready: 'h1' },
  { name: 'about', path: '/about', ready: 'h1' },
  { name: 'faq', path: '/faq', ready: 'h1' },
  { name: 'terms', path: '/terms', ready: 'h1' },
];

// Board class per analysis slug, as prod-ceval-smoke.mjs selects them.
const ANALYSIS_BOARDS: Record<string, string> = {
  xiangqi: '.xiangqi-live-board svg',
  jieqi: '.jieqi-live-board svg',
  banqi: '.banqi-live-board svg',
  jungle: '.jungle-live-board svg',
  'jungle-flip': '.jungle-flip-live-board svg',
  'fortress-xiangqi': '.fortress-xiangqi-live-board svg',
  'atomic-xiangqi': '.xiangqi-live-board svg',
};

// Variants whose postgame route is /<variant>/game/:id (gameRouteBase in
// apps/web/src/variant-tenant/registry.ts). Fog Chess uses the legacy /game/:id.
const TENANT_REVIEW_VARIANTS = [
  'xiangqi',
  'jieqi',
  'banqi',
  'jungle',
  'jungle-flip',
  'fortress-xiangqi',
  'duck-xiangqi',
  'atomic-xiangqi',
  'dark-xiangqi',
];

for (const route of ROUTES) {
  test(`page ${route.name} (${route.path})`, async ({ page }, testInfo) => {
    const errors = trackPageErrors(page);
    await openAndCheck(page, route.path, route.ready);
    await capture(page, testInfo, `page-${route.name}`);
    expectNoErrors(errors);
  });
}

for (const [slug, board] of Object.entries(ANALYSIS_BOARDS)) {
  test(`analysis board ${slug}`, async ({ page }, testInfo) => {
    const errors = trackPageErrors(page);
    await openAndCheck(page, `/analysis/${slug}`);
    await expect(page.locator(board).first()).toBeVisible();
    await expect(page.locator('button.engine-panel__switch')).toBeAttached();
    await capture(page, testInfo, `analysis-${slug}`);
    expectNoErrors(errors);
  });
}

test('blog: the newest post opens from the index', async ({ page }, testInfo) => {
  // Discovered, not hardcoded: mobile-loop's /blog/fog-of-war-rules scene has
  // shown "Article not found" since the 2026-05-23 slug rename.
  const errors = trackPageErrors(page);
  await openAndCheck(page, '/blog', 'h1');
  const firstPost = page.locator('main a[href^="/blog/"]').first();
  const href = await firstPost.getAttribute('href');
  expect(href, 'the blog index links at least one post').toBeTruthy();
  await openAndCheck(page, href as string, 'h1');
  await capture(page, testInfo, 'page-blog-post');
  expectNoErrors(errors);
});

test('game review: a finished game from the database replays', async ({ page }, testInfo) => {
  // Persistence surface: reads the games table. Needs the persistent pair and
  // at least one finished game (play one, or npm run db:seed:qa).
  const response = await page.request.get('/api/games/recent');
  test.skip(!response.ok(), `/api/games/recent answered ${response.status()} (no-DB server?)`);
  const { games = [] } = (await response.json()) as {
    games?: Array<{ roomId: string; variant: string }>;
  };
  // Tenant variants replay under /<variant>/game/:id; prefer xiangqi (Bet 1).
  const tenant = (entry: { variant: string }) => TENANT_REVIEW_VARIANTS.includes(entry.variant);
  const game = games.find((entry) => entry.variant === 'xiangqi') ?? games.find(tenant);
  if (!game) {
    test.skip(true, 'no finished tenant game in the local database; seed with npm run db:seed:qa');
    return;
  }

  const errors = trackPageErrors(page);
  const path = `/${game.variant}/game/${encodeURIComponent(game.roomId)}`;
  await openAndCheck(page, path);
  const board = page.locator('.review-board-host');
  await expect(board).toBeVisible();
  await expect(board.locator('svg').first()).toBeAttached();
  await capture(page, testInfo, `review-${game.variant}`);
  expectNoErrors(errors);
});

async function openAndCheck(page: Page, path: string, ready?: string): Promise<void> {
  const response = await page.goto(path);
  expect(response?.status() ?? 0, `${path} HTTP status`).toBeLessThan(400);
  if (ready) await expect(page.locator(ready).first()).toBeVisible();
  await page.waitForLoadState('networkidle');
  // A dead route serves the branded 404 shell with a 200, and a dead article
  // slug renders "Article not found": neither shows up in the status code.
  const headings = await page.locator('h1').allTextContents();
  expect(headings.join(' | '), `${path} rendered a not-found page`).not.toMatch(
    /page not found|article not found/i,
  );
  expect(await horizontalOverflow(page), `${path} scrolls sideways`).toBeLessThanOrEqual(1);
}
