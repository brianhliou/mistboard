import { expect, type Page } from '@playwright/test';

import { expectNoErrors, trackPageErrors, uniqueRoom } from './support';
import { test } from './xmj-fixture';

// #674: on a 360px phone the signed-in friends-online pill (fixed to the
// bottom-right corner) sat on the move-nav bar's right-hand buttons, so a tap
// on "latest" landed on the pill. The pill is gone (friends live in the header
// menu now); this keeps anything else from floating there. Any page whose move
// controls reach the foot of the screen had it; this pins a plain live room,
// the XMJ spec pins the tenant review.
test('phone: nothing floats over the move-nav bar of a signed-in room', async ({
  page,
  isMobile,
  grantedAccount,
}, testInfo) => {
  test.skip(!isMobile, 'the overlap is a phone-width layout');
  expect(grantedAccount).toBeTruthy();
  await page.setViewportSize({ width: 360, height: 800 });
  const errors = trackPageErrors(page);
  const room = uniqueRoom('phone-chrome', testInfo);
  await page.goto(`/room/${encodeURIComponent(room)}?reset=1&variant=fog-of-war`);
  // Signed-in chrome (the account nav) has mounted before the check runs.
  await expect(page.locator('[data-account-nav]').first()).toBeAttached();
  await expect(page.locator('.move-nav-bar [data-replay="latest"]').first()).toBeVisible();
  expect(await coveredNavButtons(page)).toEqual([]);
  expectNoErrors(errors);
});

/** Scrolls the bar to the screen's foot and names every button something else would take the tap from. */
async function coveredNavButtons(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const bar = document.querySelector<HTMLElement>('.move-nav-bar');
    if (!bar) throw new Error('no move-nav bar');
    bar.scrollIntoView({ block: 'end' });
    const covered: string[] = [];
    for (const button of bar.querySelectorAll<HTMLElement>('[data-replay]')) {
      const box = button.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      if (!hit || !button.contains(hit)) {
        covered.push(
          `${button.dataset.replay} under ${hit?.className || hit?.tagName || 'nothing'}`,
        );
      }
    }
    return covered;
  });
}
