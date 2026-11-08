import {
  attemptStandardXiangqiPuzzleLine,
  getStandardXiangqiLegalMoves,
  type XiangqiPuzzle,
} from '@mistboard/game';
import { loadSeedPuzzleRegistry } from '@mistboard/game/puzzle-seed';
import { expect, type Page, test } from '@playwright/test';

// Practice and Streak keep their three columns. Storm has a board and one
// fixed panel, with its server clock waiting for the first move.

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

for (const path of ['/puzzles', '/puzzles?mode=streak']) {
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

async function stormLayout(page: Page, phone = false) {
  const response = page.waitForResponse(
    (r) => r.url().endsWith('/api/puzzles/storm') && r.request().method() === 'POST',
  );
  await page.goto('/puzzles?mode=storm');
  const run = await (await response).json();
  const at = await columns(page);
  const panel = page.locator('.puzzle-side-panel');
  await expect(page.locator('.puzzle-left-card')).toHaveCount(0);
  await expect(page.locator('.puzzle-moves')).toBeHidden();
  await expect(page.locator('[data-storm-clock]')).toHaveText('3:00');
  await expect(page.locator('.puzzle-storm-status')).toHaveText('Move to start');
  const before = await panel.boundingBox();
  const board = await page.locator('.puzzle-board').boundingBox();
  expect(before).not.toBeNull();
  expect(board).not.toBeNull();
  // A board wider than its column scrolls the panel sideways on an edge click.
  const overflow = await page
    .locator('.puzzles-layout')
    .evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(overflow).toBe(0);
  if (phone) expect(before!.y).toBeGreaterThanOrEqual(board!.y + board!.height);
  else expect(at.board).toBeLessThan(at.panel);
  await page.waitForTimeout(2000);
  await expect(page.locator('[data-storm-clock]')).toHaveText('3:00');
  const puzzles = loadSeedPuzzleRegistry('xiangqi') as readonly XiangqiPuzzle[];
  const puzzle = puzzles.find((p) => p.id === run.puzzle.id)!;
  const wrong = getStandardXiangqiLegalMoves(puzzle.initial).find((move) => {
    const attempt = attemptStandardXiangqiPuzzleLine(puzzle, [move]);
    return !attempt.ok && attempt.code === 'incorrect-move';
  });
  expect(wrong).toBeDefined();
  await expect(page.locator('.puzzle-board')).toHaveAttribute('data-puzzle-live', 'true');
  for (const square of [wrong!.from, wrong!.to]) {
    await page.locator(`.puzzle-board [data-square="${square}"]`).click();
  }
  await expect(page.locator('.puzzle-board')).not.toHaveAttribute('data-puzzle-id', puzzle.id);
  await expect(page.locator('[data-storm-change]')).toHaveText('−10s');
  expect(await panel.boundingBox()).toEqual(before);
  expect(await page.locator('.puzzle-board').boundingBox()).toEqual(board);
  await expect(page.locator('.puzzle-moves')).toBeHidden();
}

test('Storm keeps a fixed panel beside the board and waits for the first move', async ({
  page,
}) => {
  await stormLayout(page);
});

test.describe('Storm phone stack', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test('keeps the same fixed panel below the board between puzzles', async ({ page }) => {
    await stormLayout(page, true);
  });
});

// A phone fits the board and the Storm panel on one screen, guest or not.
for (const viewport of [
  { width: 320, height: 568 },
  { width: 390, height: 664 },
  { width: 430, height: 739 },
]) {
  test.describe(`Storm phone ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport, hasTouch: true, isMobile: true });
    test('fits without vertical scroll before and after a puzzle change', async ({ page }) => {
      const overflow = () =>
        page.evaluate(() => {
          const shell = document.querySelector('main.puzzles-shell');
          const doc = document.documentElement;
          return Math.max(
            shell ? shell.scrollHeight - shell.clientHeight : 0,
            doc.scrollHeight - doc.clientHeight,
          );
        });
      await stormLayout(page, true);
      expect(await overflow()).toBe(0);
    });
  });
}
