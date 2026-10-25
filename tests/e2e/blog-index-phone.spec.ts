import { expect, test } from '@playwright/test';

import { expectNoErrors, trackPageErrors } from './support';

// On a 360px phone the blog index kept its desktop shape: a By Mistboard /
// Community rail took ~40% of the width, the topic chips stacked one per line
// in the column left over, and card titles cut to two words. On a phone the
// rail is a tab row above the sheet and the posts take the full width.
test('phone: the blog index puts the posts full width with no rail beside them', async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, 'the rail-to-tabs swap is a phone-width layout');
  await page.setViewportSize({ width: 360, height: 800 });
  const errors = trackPageErrors(page);
  await page.goto('/blog');
  await expect(
    page.locator('.articles-index-list .articles-index-card-title').first(),
  ).toBeVisible();

  const layout = await page.evaluate(() => {
    const list = document.querySelector<HTMLElement>('.articles-index-list');
    const sheet = document.querySelector<HTMLElement>(
      '.articles-community-layout > .article-sheet',
    );
    const rail = document.querySelector<HTMLElement>('.articles-community-rail');
    if (!list || !sheet || !rail) throw new Error('blog index markup missing');
    const chipTops = new Set(
      [...document.querySelectorAll<HTMLElement>('.articles-topic-chip')].map((chip) =>
        Math.round(chip.getBoundingClientRect().top),
      ),
    );
    const titleWidths = [
      ...document.querySelectorAll<HTMLElement>(
        '.articles-index-list > li:not([hidden]) .articles-index-card-title',
      ),
    ]
      .slice(0, 6)
      .map((title) => Math.round(title.getBoundingClientRect().width));
    return {
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      listLeft: Math.round(list.getBoundingClientRect().left),
      sheetLeft: Math.round(sheet.getBoundingClientRect().left),
      railBottom: Math.round(rail.getBoundingClientRect().bottom),
      sheetTop: Math.round(sheet.getBoundingClientRect().top),
      chipCount: document.querySelectorAll('.articles-topic-chip').length,
      chipRows: chipTops.size,
      titleWidths,
    };
  });

  expect
    .soft(layout.scrollWidth, 'no horizontal page scroll')
    .toBeLessThanOrEqual(layout.clientWidth);
  // The sheet starts at the page gutter and the list at the sheet's own
  // padding: nothing sits to the left of the posts.
  expect.soft(layout.sheetLeft, 'sheet starts at the left gutter').toBeLessThanOrEqual(16);
  expect.soft(layout.listLeft, 'post list starts at the left gutter').toBeLessThanOrEqual(32);
  expect
    .soft(layout.railBottom, 'the blog tabs sit above the sheet, not beside it')
    .toBeLessThanOrEqual(layout.sheetTop);
  expect.soft(layout.chipCount, 'the index shows its topic chips').toBeGreaterThanOrEqual(2);
  expect.soft(layout.chipRows, 'topic chips sit in one or two rows').toBeLessThanOrEqual(2);
  expect.soft(layout.titleWidths.length).toBeGreaterThan(0);
  for (const width of layout.titleWidths) {
    expect.soft(width, 'card title width').toBeGreaterThan(280);
  }
  expectNoErrors(errors);
});
