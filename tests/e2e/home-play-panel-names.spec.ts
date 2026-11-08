import { expect, test } from '@playwright/test';

import { expectNoErrors, trackPageErrors } from './support';

// From 1241px the homepage goes to three columns and the play panel narrows to
// ~480-650px. The bot rows' fixed level, clock and action columns left the
// variant name 29px at 1280 ("Xi…") and 110px at 1366 (2026-10-25, about one
// homepage visitor in nine sits in that band). Every name must show in full,
// wrapping if it has to, at each width the layout passes through; so must the
// engine and clock beside it (the first fix cut the clock to "10…").
const WIDTHS = [1241, 1280, 1366, 1410, 1440, 1100, 960];

test('home: every play-the-computer row shows its whole name, engine and clock', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'the cut happened in the three-column desktop band');
  const errors = trackPageErrors(page);
  await page.goto('/');
  await expect(page.locator('.pp-row-bot .pp-name-label').first()).toBeVisible();
  const cut: string[] = [];
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    const clipped = await page.evaluate(() =>
      [
        ...document.querySelectorAll<HTMLElement>(
          '.pp-row-bot .pp-name-label, .pp-row-bot .pp-step-main, .pp-row-bot .pp-step-sub',
        ),
      ]
        .filter((label) => label.scrollWidth > label.clientWidth)
        .map((label) => label.textContent ?? ''),
    );
    for (const name of clipped) cut.push(`${width}px: ${name}`);
  }
  expect(cut).toEqual([]);
  expectNoErrors(errors);
});
