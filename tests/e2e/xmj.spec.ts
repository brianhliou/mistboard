import { expect, type Locator, type Page } from '@playwright/test';

import { expectNoErrors, horizontalOverflow, trackPageErrors } from './support';
import { test } from './xmj-fixture';

// Both runner projects execute this journey. The phone is deliberately 360px
// rather than the suite's usual 390px; disabling XMJ must fail, never skip.
test('Xiangqi Mahjong: room, discard, bot answer and recorded review', async ({
  page,
  isMobile,
  grantedAccount,
}, testInfo) => {
  if (isMobile) await page.setViewportSize({ width: 360, height: 800 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const errors = trackPageErrors(page);
  const me = await page.request.get('/api/auth/me');
  expect(me.status(), 'the persistent dev auth API is required').toBe(200);
  expect((await me.json()).user?.id, 'the granted player session resolves').toBe(grantedAccount);

  // Create our own game, never depend on a seeded/recent match being present.
  // Keep the human in east; the game's first dealer is still random.
  const created = await page.request.post('/api/rooms', {
    data: {
      gameSpecId: 'xiangqi-mahjong',
      mode: 'pve',
      preferredColor: 'east',
      timeControl: { initialMs: 600_000, incrementMs: 0 },
    },
  });
  expect(created.status(), 'XMJ room creation must be enabled').toBe(201);
  const room = (await created.json()) as { roomId: string; url: string; gameSpecId: string };
  expect(room.gameSpecId).toBe('xiangqi-mahjong');
  expect(room.url).toBe(`/room/${room.roomId}`);
  const response = await page.goto(room.url);
  expect(response?.status()).toBe(200);
  const board = page.locator('.xiangqi-mahjong-live-board');
  await expect(board.locator('.xmj-table')).toBeVisible();
  await expect(board.locator('.xmj-seat--you[data-xmj-seat="east"]')).toBeVisible();
  await expectFits(page, 'initial room');

  const tile = board.locator('button[data-xmj-tile]').first();
  // If the bot dealt, pass on its opening discard (or ready the next hand if
  // it won immediately). Do not rely on a particular shuffle or first dealer.
  for (let step = 0; step < 4; step += 1) {
    const action = board
      .locator(
        'button[data-xmj-tile], button[data-xmj-pass]:enabled, button[data-xmj-next]:enabled',
      )
      .first();
    await expect(action).toBeVisible();
    if ((await action.getAttribute('data-xmj-tile')) !== null) break;
    const pending =
      (await action.getAttribute('data-xmj-pass')) !== null
        ? '[data-xmj-pass]:enabled'
        : '[data-xmj-next]:enabled';
    await press(action, isMobile);
    await expect(board.locator(pending)).toHaveCount(0);
  }
  await expect(tile).toBeVisible();
  // A self-drawn winning deal requires a second press to confirm a discard.
  const confirmDiscard = await board.locator('[data-xmj-selfdraw]').isVisible();
  await press(tile, isMobile);
  if (confirmDiscard) await press(board.locator('.xmj-tile--armed'), isMobile);
  const ownMove = page.locator('.xmj-log__row:not(.xmj-log__row--theirs)').last();
  await expect(ownMove).toContainText(/You (?:draw, )?discard/);
  const humanPly = Number(await ownMove.getAttribute('data-xmj-ply'));
  expect(humanPly).toBeGreaterThan(0);
  await expectFits(page, 'after the human discard');

  // A bot may claim or win rather than simply discard. All are visible answers
  // in its log rows; an automatic pass alone does not satisfy this assertion.
  const answer = page.locator('.xmj-log__row--theirs').last();
  await expect
    .poll(async () => Number(await answer.getAttribute('data-xmj-ply')))
    .toBeGreaterThan(humanPly);
  const botPly = Number(await answer.getAttribute('data-xmj-ply'));
  await expectFits(page, 'after the bot answer');
  await testInfo.attach('xmj-room', {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png',
  });

  // A real finished match is necessary: the review API refuses live matches.
  const review = page.locator(`a[href="/xiangqi-mahjong/game/${room.roomId}"]`).first();
  if (!(await review.isVisible())) {
    await press(page.locator('[data-game-action="resign"]'), isMobile);
    await press(page.locator('[data-game-action="confirm-yes"]'), isMobile);
  }
  await expect(review).toBeVisible();
  // Wait for persistence, which can finish just after the socket's final frame.
  await expect
    .poll(async () =>
      (await page.request.get(`/api/xiangqi-mahjong/games/${room.roomId}`)).status(),
    )
    .toBe(200);
  await press(review, isMobile);
  await expect(page).toHaveURL(new RegExp(`/xiangqi-mahjong/game/${room.roomId}$`));
  await expect(board.locator('.xmj-table')).toBeVisible();
  await expect(board.locator('.xmj-tile--back')).toHaveCount(0);
  await expect(board.locator('button[data-xmj-tile]')).toHaveCount(0);
  await expectFits(page, 'finished review');

  // Step from the deal through our discard, then jump to the bot's own answer.
  await press(page.locator('[data-replay="first"]'), isMobile);
  const ownDiscards = board.locator('[data-xmj-pond="east"] .xmj-pond > .xmj-tile');
  await expect(ownDiscards).toHaveCount(0);
  await press(page.locator('[data-replay="next"]'), isMobile);
  await expect(page.locator('.xmj-log__row.active')).toHaveAttribute('data-xmj-ply', '1');
  await press(page.locator(`.xmj-log [data-xmj-ply="${humanPly}"]`), isMobile);
  await expect(ownDiscards).toHaveCount(1);
  await press(page.locator(`.xmj-log [data-xmj-ply="${botPly}"]`), isMobile);
  // The last ply has no active row (it returns to latest); the meta still
  // identifies the exact recorded position in either case.
  await expect(page.locator('[data-replay-meta]')).toContainText(`ply ${botPly} of`);
  await press(page.locator('[data-replay="first"]'), isMobile);
  await press(page.locator('[data-replay="latest"]'), isMobile);
  await expect(page.locator('[data-replay="next"]')).toBeDisabled();
  await expectFits(page, 'replayed review');
  await testInfo.attach('xmj-review', {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png',
  });
  expectNoErrors(errors);
});

async function press(locator: Locator, touch: boolean): Promise<void> {
  if (touch) await locator.tap();
  else await locator.click();
}

async function expectFits(page: Page, stage: string): Promise<void> {
  expect(await horizontalOverflow(page), `${stage} scrolls sideways`).toBeLessThanOrEqual(1);
}
