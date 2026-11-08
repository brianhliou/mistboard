import { expect, type Page, test } from '@playwright/test';

import { expectNoErrors, trackPageErrors } from './support';

// The puzzle page in portrait is one screen with no vertical scroll (Brian,
// 2026-10-20, apps/web/src/puzzles-phone-stack.test.ts). The board fills the
// width edge to edge and the rows under it are compressed (Brian, 2026-10-29:
// "I want the board big as possible filling edge to edge"), so this visit's
// result chips keep a 30px row on the page and still fit a short phone's fold.
// Desktop keeps the same row under the board.

/** Give up on the puzzle in play so the session row has a result, then move on. */
async function finishOnePuzzle(page: Page): Promise<void> {
  await page.goto('/puzzles');
  const reveal = page.locator('[data-puzzle-reveal="true"]');
  await expect(reveal).toBeVisible();
  await reveal.click();
  // The reveal plays the answer out, then the puzzle counts as failed.
  await expect(page.locator('.puzzle-session-chips a.puzzle-streak-chip')).toHaveCount(1, {
    timeout: 30_000,
  });
  await page.locator('[data-puzzle-next="true"]').click();
  await expect(page.locator('[data-puzzle-reveal="true"]')).toBeVisible();
  await expect(page.locator('.puzzle-session-chips .puzzle-streak-chip--current')).toHaveCount(1);
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
  test(`phone ${width}x${height}: no vertical scroll with results, board edge to edge`, async ({
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

    const row = page.locator('.puzzle-board-panel > .puzzle-session-chips');
    await expect(row.locator('a.puzzle-streak-chip--failed')).toBeVisible();
    await expect(row.locator('.puzzle-streak-chip--current')).toBeVisible();
    // Hint and solution stay on the page, not in the ☰ sheet.
    await expect(page.locator('[data-puzzle-reveal="true"]')).toBeVisible();
    expectNoErrors(errors);
  });
}

test('desktop: the session row stays under the board', async ({ page, isMobile }) => {
  test.skip(isMobile, 'the desktop layout');
  const errors = trackPageErrors(page);
  await finishOnePuzzle(page);
  await expect(
    page.locator('.puzzle-board-panel > .puzzle-session-chips a.puzzle-streak-chip--failed'),
  ).toBeVisible();
  await expect(page.locator('.puzzle-move-nav')).toBeHidden();
  expectNoErrors(errors);
});
