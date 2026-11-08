import { test as base, expect, type Page } from '@playwright/test';

import { phoneLayoutProblems } from './phone-layout';
import { expectNoErrors, trackPageErrors } from './support';

const BOARD = '.xiangqi-live-board';
const ARROWS = ['first', 'prev', 'next', 'latest'].map((step) => `[data-replay="${step}"]`);
const RESIGN = '[data-game-action="resign"]';

// One Chinese phone journey, not another project multiplying the entire suite.
// The browser's language drives the app locale, including after a cold reload.
base.use({ locale: 'zh-TW' });
base.skip(({ isMobile }) => !isMobile, 'Chinese phone gameplay slice (#646)');

const test = base.extend<{ seededGame: { roomId: string; opponent: Page; errors: string[] } }>({
  seededGame: async ({ page, browser, baseURL }, use) => {
    // This fixture creates and plays a real room; never seed a remote target,
    // consume a recent game, depend on an engine, or mock the game transport.
    const origin = new URL(baseURL ?? 'http://127.0.0.1:3000');
    expect(['localhost', '127.0.0.1', '[::1]']).toContain(origin.hostname);
    expect(origin.protocol).toBe('http:');
    const errors = trackPageErrors(page, [], 'red');
    const created = await page.request.post('/api/rooms', {
      data: {
        gameSpecId: 'xiangqi',
        mode: 'pvp',
        preferredColor: 'red',
        rated: false,
        timeControl: { initialMs: 600_000, incrementMs: 0 },
      },
    });
    expect(created.status(), 'local Xiangqi room creation is required').toBe(201);
    const room = (await created.json()) as { roomId: string; url: string; gameSpecId: string };
    expect(room.gameSpecId).toBe('xiangqi');
    expect(room.url).toBe(`/room/${room.roomId}`);

    const opponentContext = await browser.newContext({
      baseURL,
      locale: 'zh-TW',
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    try {
      const opponent = await opponentContext.newPage();
      trackPageErrors(opponent, errors, 'black');
      // Red connects first and claims the creator's preferred seat.
      await page.goto(room.url);
      await expect(page.locator(BOARD).locator('[data-piece-square="a4"]')).toBeAttached();
      await page.locator(`${BOARD} [data-square="a4"]`).tap();
      await expect(page.locator(`${BOARD} [data-square="a5"]`)).toHaveClass(/--target/);
      await opponent.goto(room.url);
      await expect(opponent.locator(BOARD).locator('[data-piece-square="a7"]')).toBeAttached();
      await page.locator(`${BOARD} [data-square="a5"]`).tap();
      await expect(opponent.locator(`${BOARD} [data-piece-square="a5"]`)).toBeAttached();
      await move(opponent, 'a7', 'a6');
      await expect(page.locator(`${BOARD} [data-piece-square="a6"]`)).toBeAttached();
      await use({ roomId: room.roomId, opponent, errors });
    } finally {
      await opponentContext.close();
    }
  },
});

test('seeded Chinese phone: play, resign and replay with controls in view', async ({
  page,
  seededGame: { roomId, opponent, errors },
}, testInfo) => {
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-Hant');
  await expect(page.locator(RESIGN)).toHaveAccessibleName('認輸');
  await expectFits(page, 'seeded opening', [...ARROWS, RESIGN]);

  await move(page, 'c4', 'c5');
  await expect(opponent.locator(`${BOARD} [data-piece-square="c5"]`)).toBeAttached();
  await move(opponent, 'c7', 'c6');
  await expect(page.locator(`${BOARD} [data-piece-square="c6"]`)).toBeAttached();
  await expect(page.locator('.xiangqi-move-row__move.move-jump')).toHaveCount(4);
  await expectFits(page, 'both players moved', [...ARROWS, RESIGN]);

  // Reload the seeded position from the server's event history, keeping the
  // same seat and Chinese locale. No test-only state injection is involved.
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-Hant');
  await expect(page.locator(`${BOARD} [data-piece-square="c5"]`)).toBeAttached();
  await expect(page.locator(`${BOARD} [data-piece-square="c6"]`)).toBeAttached();
  await expectFits(page, 'reconnected room', [...ARROWS, RESIGN]);
  await testInfo.attach('chinese-phone-room', {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png',
  });

  await page.locator(RESIGN).tap();
  const confirm = '[data-game-action="confirm-yes"]';
  await expect(page.locator(confirm)).toHaveAccessibleName('認輸');
  await expectFits(page, 'resign confirmation', [...ARROWS, confirm]);
  await page.locator(confirm).tap();
  const review = page.locator(`a[href="/xiangqi/game/${roomId}"]`).first();
  await expect(review).toHaveText('覆盤');
  await expect
    .poll(async () => (await page.request.get(`/api/xiangqi/games/${roomId}`)).status())
    .toBe(200);
  await review.tap();
  await expect(page).toHaveURL(new RegExp(`/xiangqi/game/${roomId}$`));
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-Hant');
  await expect(page.locator(`${BOARD} [data-piece-square="c5"]`)).toBeAttached();
  await expectFits(page, 'recorded review', ARROWS);

  await page.locator('[data-replay="first"]').tap();
  await expect(page.locator(`${BOARD} [data-piece-square="a4"]`)).toBeAttached();
  await expect(page.locator(`${BOARD} [data-piece-square="a5"]`)).toHaveCount(0);
  await expect(page.locator('[data-replay="prev"]')).toBeDisabled();
  await expect(page.locator('[data-replay="next"]')).toHaveAccessibleName('下一手');
  await page.locator('[data-replay="next"]').tap();
  await expect(page.locator(`${BOARD} [data-piece-square="a5"]`)).toBeAttached();
  await page.locator('[data-replay="latest"]').tap();
  await expect(page.locator(`${BOARD} [data-piece-square="c5"]`)).toBeAttached();
  await expect(page.locator(`${BOARD} [data-piece-square="c6"]`)).toBeAttached();
  await expect(page.locator('[data-replay="next"]')).toBeDisabled();
  await expectFits(page, 'replayed review', ARROWS);
  await testInfo.attach('chinese-phone-review', {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png',
  });
  expectNoErrors(errors);
});

async function move(page: Page, from: string, to: string): Promise<void> {
  await page.locator(`${BOARD} [data-square="${from}"]`).tap();
  await expect(page.locator(`${BOARD} [data-square="${to}"]`)).toHaveClass(/--target/);
  await page.locator(`${BOARD} [data-square="${to}"]`).tap();
  await expect(page.locator(`${BOARD} [data-piece-square="${to}"]`)).toBeAttached();
  await expect(page.locator(`${BOARD} [data-piece-square="${from}"]`)).toHaveCount(0);
}

async function expectFits(page: Page, stage: string, controls: string[]): Promise<void> {
  await expect
    .poll(() => page.evaluate(phoneLayoutProblems, { board: BOARD, controls }), {
      message: `${stage}: board and controls fit the phone and accept taps`,
    })
    .toEqual([]);
}
