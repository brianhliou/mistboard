import { expect, type Page, test } from '@playwright/test';

async function openAnalysis(page: Page) {
  // The layout needs neither a stored game nor an engine download. Keep the
  // normal admin offering gate and engine UI, with an idle worker for Rapfi.
  await page.addInitScript(() => {
    localStorage.setItem('mb_admin', '1');
    localStorage.setItem('mb_signed_in', '1');
    localStorage.removeItem('mistboard.review.gomoku.localEngine');
    class IdleWorker {
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: ErrorEvent) => void) | null = null;
      postMessage(message: { type: string }) {
        if (message.type === 'init') {
          queueMicrotask(() =>
            this.onmessage?.(new MessageEvent('message', { data: { type: 'ready' } })),
          );
        }
      }
      terminate() {}
    }
    Object.defineProperty(window, 'Worker', { value: IdleWorker });
  });
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({
      json: {
        user: {
          id: 'layout-admin',
          handle: 'layout-admin',
          email: 'layout@example.invalid',
          accountRole: 'admin',
        },
      },
    }),
  );
  await page.goto('/analysis/gomoku?lang=en&moves=a1+b1+c1+d1');
  await expect(page.locator('.gomoku-svg')).toBeVisible();
}

async function expectOneScreen(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(() => {
        const doc = document.scrollingElement ?? document.documentElement;
        return Math.max(doc.scrollHeight - innerHeight, doc.scrollWidth - innerWidth);
      }),
    )
    .toBeLessThanOrEqual(1);
  const bar = await page.locator('.analysis-phone-bar').boundingBox();
  const moves = await page.locator('.review-move-list').boundingBox();
  expect(bar).not.toBeNull();
  expect(moves).not.toBeNull();
  expect(moves!.y + moves!.height).toBeLessThanOrEqual(bar!.y);
}

for (const [width, height] of [
  [320, 568],
  [375, 667],
  [390, 664],
  [390, 844],
] as const) {
  test(`Gomoku analysis fits ${width}x${height} with engine off and on`, async ({
    page,
    isMobile,
  }) => {
    test.skip(!isMobile, 'phone layout');
    await page.setViewportSize({ width, height });
    await openAnalysis(page);
    const action = (name: string) => page.locator(`[data-analysis-bar="${name}"]`);
    await expect(action('tools')).toBeVisible();
    await expect(action('flip')).toBeHidden();
    await expectOneScreen(page);
    await action('back').click();
    await expect(page.locator('[data-piece-square]')).toHaveCount(3);
    await expect(page.locator('.analysis-phone-info')).toContainText('White to move');
    await action('next').click();
    await expect(page.locator('.analysis-phone-info')).toContainText('Black to move');
    await action('engine').click();
    await expect(action('engine')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.analysis-engine-bar')).toBeVisible();
    await expectOneScreen(page);
    await action('tools').click();
    const sheet = page.locator('.analysis-tools-sheet');
    await expect(sheet.locator('.analysis-variant-picker')).toBeVisible();
    await expect(sheet.locator('#gomoku-import-json')).toBeVisible();
    await expect(sheet.locator('.engine-panel')).toBeVisible();
    await sheet.locator('#gomoku-import-json').fill('{broken');
    await sheet.getByRole('button', { name: 'Import JSON' }).click();
    await expect(sheet.getByRole('alert')).toContainText('Invalid Gomoku JSON');
    await sheet.locator('.analysis-tools-sheet__close').click();
    await expectOneScreen(page);
    await action('engine').click();
    await expect(page.locator('.analysis-engine-bar')).toBeHidden();
    await expectOneScreen(page);
  });
}

test('Gomoku desktop keeps the variant picker, JSON import and engine card inline', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'desktop layout');
  await openAnalysis(page);
  await expect(page.locator('.analysis-phone-bar')).toBeHidden();
  await expect(page.locator('.review-shell .analysis-variant-picker')).toBeVisible();
  await expect(page.locator('.review-shell #gomoku-import-json')).toBeVisible();
  await expect(page.locator('.review-shell .engine-panel')).toBeVisible();
});
