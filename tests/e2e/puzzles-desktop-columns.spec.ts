import { expect, type Page, test } from '@playwright/test';

// Desktop puzzle pages run left column, board, side panel. Storm has no
// session chips row, which was all that kept the side panel out of the middle
// column: from 2026-11-05 Storm showed the move list in the middle and the
// board on the right. A Storm run also hides the move arrows until review.

test.use({ viewport: { width: 1440, height: 900 } });

async function columns(page: Page) {
  await expect(page.locator('.puzzles-shell .puzzle-board .puzzle-xiangqi-board')).toBeVisible();
  return page.evaluate(() => {
    const left = (selector: string) =>
      Math.round(document.querySelector(selector)?.getBoundingClientRect().left ?? -1);
    const nav = document.querySelector('.puzzle-side-panel > .puzzle-move-nav');
    return {
      sidebar: left('.puzzles-sidebar'),
      board: left('.puzzles-shell .puzzle-board'),
      panel: left('.puzzles-shell .puzzle-side-panel'),
      navShown: nav ? getComputedStyle(nav).display !== 'none' : false,
    };
  });
}

for (const path of ['/puzzles', '/puzzles?mode=streak', '/puzzles?mode=storm']) {
  test(`board sits between the left column and the side panel on ${path}`, async ({ page }) => {
    await page.goto(path);
    const at = await columns(page);
    expect(at.sidebar).toBeLessThan(at.board);
    expect(at.board).toBeLessThan(at.panel);
  });
}

test('a Storm run hides the move arrows', async ({ page }) => {
  await page.goto('/puzzles?mode=storm');
  const nav = page.locator('.puzzle-side-panel > .puzzle-move-nav');
  await expect(nav).toBeAttached();
  await expect(nav).toBeHidden();
});
