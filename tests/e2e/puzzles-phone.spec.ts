import { expect, type Page, test } from '@playwright/test';

import { expectNoErrors, trackPageErrors } from './support';

// The puzzle page in portrait is one screen with no vertical scroll (Brian,
// 2026-10-20, apps/web/src/puzzles-phone-stack.test.ts). This visit's result
// chips used to sit under the controls and push the page 42px past a short
// phone's fold; on the phone they live in the ☰ sheet (Brian, 2026-10-28) and
// the board keeps the full width. Desktop keeps the row under the board.

/** Give up on the puzzle in play so the session row has a result, then move on. */
async function finishOnePuzzle(page: Page): Promise<void> {
  await page.goto('/puzzles');
  const reveal = page.locator('[data-puzzle-reveal="true"]');
  await expect(reveal).toBeVisible();
  await reveal.click();
  // The reveal plays the answer out, then the puzzle counts as failed.
  await expect(page.locator('.puzzle-session-chips a.puzzle-result-chip')).toHaveCount(1, {
    timeout: 30_000,
  });
  await page.locator('[data-puzzle-next="true"]').click();
  await expect(page.locator('[data-puzzle-reveal="true"]')).toBeVisible();
  await expect(page.locator('.puzzle-session-chips .puzzle-result-chip--current')).toHaveCount(1);
}

/** Overflow past the screen of both scrollers the page could use. */
function verticalOverflow(page: Page) {
  return page.evaluate(() => {
    const doc = document.scrollingElement ?? document.documentElement;
    const shell = document.querySelector<HTMLElement>('.puzzles-page');
    const board = document.querySelector('.puzzles-shell .puzzle-board .puzzle-xiangqi-board');
    return {
      document: doc.scrollHeight - window.innerHeight,
      page: shell ? shell.scrollHeight - shell.clientHeight : 0,
      boardWidth: Math.round(board?.getBoundingClientRect().width ?? 0),
      viewportWidth: window.innerWidth,
    };
  });
}

for (const [width, height] of [
  [390, 664],
  [375, 667],
] as const) {
  test(`phone ${width}x${height}: no vertical scroll with results, the row in the ☰ sheet`, async ({
    page,
    isMobile,
  }) => {
    test.skip(!isMobile, 'the one-screen stack is the portrait phone layout');
    await page.setViewportSize({ width, height });
    const errors = trackPageErrors(page);
    await finishOnePuzzle(page);

    const fit = await verticalOverflow(page);
    expect(fit.document, 'document scrolls').toBeLessThanOrEqual(0);
    expect(fit.page, '.puzzles-page scrolls').toBeLessThanOrEqual(0);
    expect(fit.boardWidth).toBe(fit.viewportWidth);

    await expect(page.locator('.puzzle-board-panel > .puzzle-session-chips')).toBeHidden();
    await page.locator('.puzzle-move-nav .move-nav-bar__menu-button').click();
    const visit = page.locator('.puzzle-phone-menu [data-puzzle-menu-row="visit"]');
    await expect(visit).toBeVisible();
    await expect(visit.locator('a.puzzle-result-chip--failed')).toBeVisible();
    await expect(visit.locator('.puzzle-result-chip--current')).toBeVisible();
    expectNoErrors(errors);
  });
}

test('desktop: the session row stays under the board', async ({ page, isMobile }) => {
  test.skip(isMobile, 'the desktop layout');
  const errors = trackPageErrors(page);
  await finishOnePuzzle(page);
  await expect(
    page.locator('.puzzle-board-panel > .puzzle-session-chips a.puzzle-result-chip--failed'),
  ).toBeVisible();
  await expect(page.locator('.puzzle-move-nav')).toBeHidden();
  expectNoErrors(errors);
});
