import { mkdir, writeFile } from 'node:fs/promises';

import { expect, type Locator, type Page, test } from '@playwright/test';

// #671: a real guest PvE game, with no account, seeded result, or mocked game state.
// Banqi's local engine answers the opening flip; resign as soon as it is legal.
const ACTIONS = ['Rematch', 'New game', 'Review game', 'Challenge a friend'];
const OUTPUT = 'test-results/phone-postgame';

for (const viewport of [
  { width: 390, height: 844 },
  { width: 360, height: 780 },
]) {
  test(`phone postgame sheet at ${viewport.width}x${viewport.height}`, async ({
    page,
    context,
    baseURL,
    isMobile,
  }, testInfo) => {
    test.skip(!isMobile, 'run with the mobile project for touch input');
    if (!baseURL || !isLocal(baseURL)) throw new Error('This spec requires localhost');
    // Keep analytics, fonts, and other third-party resources off the network.
    await context.route('**/*', (route) =>
      isLocal(route.request().url()) ? route.continue() : route.abort(),
    );
    await context.routeWebSocket(/.*/, (socket) => {
      if (isLocal(socket.url())) socket.connectToServer();
      else socket.close();
    });
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const created = await page.request.post('/api/rooms', {
      data: {
        gameSpecId: 'banqi',
        mode: 'pve',
        rated: false,
        preferredColor: 'red',
        timeControl: { initialMs: 300_000, incrementMs: 5_000 },
      },
    });
    expect(created.status(), 'create a casual guest game against the computer').toBe(201);
    const room = (await created.json()) as { url: string };
    expect(room.url).toMatch(/^\/room\//);
    await page.goto(room.url);
    const board = page.locator('.board.banqi-live-board');
    await expect(board.locator('svg.banqi-board')).toBeVisible();
    await expect(page.locator('[data-game-action="abort"]')).toBeVisible();
    await board.locator('[data-square="a1"]').tap();
    const resign = page.locator('[data-game-action="resign"]');
    await expect(resign).toBeVisible();
    await resign.tap();
    const confirm = page.locator('[data-game-action="confirm-yes"]');
    await expect(confirm).toBeVisible();
    // Measure after the confirmation row settles, immediately before game end.
    const before = await requiredBox(board);
    await confirm.tap();

    const sheet = page.getByRole('dialog', { name: 'Game over', exact: true });
    const controls = page.locator('.postgame-sheet .postgame-actions').locator('a, button');
    await expect.soft(sheet, '(a) sheet opens on game end').toBeVisible();
    await expect.soft(controls, '(a) all four postgame actions appear').toHaveText(ACTIONS);
    for (const label of ACTIONS) {
      const action = controls.filter({ hasText: new RegExp(`^${label}$`) });
      await expect.soft(action, `(a) ${label} is visible`).toBeVisible();
      await expect
        .soft(action, `(a) ${label} fits in the phone viewport`)
        .toBeInViewport({ ratio: 1 });
    }
    const originalActions = await controls.allTextContents();
    await capture('sheet-open');
    const after = await requiredBox(board);
    expect
      .soft(Math.abs(after.width - before.width), '(b) board width unchanged within 2px')
      .toBeLessThanOrEqual(2);
    expect
      .soft(Math.abs(after.height - before.height), '(b) board height unchanged within 2px')
      .toBeLessThanOrEqual(2);
    const sheetBox = await sheet.boundingBox();
    expect.soft(sheetBox, '(a) bottom sheet has a visible box').not.toBeNull();
    if (sheetBox) {
      expect
        .soft(
          Math.abs(sheetBox.y + sheetBox.height - viewport.height),
          '(a) sheet is pinned to screen bottom',
        )
        .toBeLessThanOrEqual(2);
      // Banqi is landscape, so its board ends above the bottom sheet. Check
      // the overlay's positioning and modal layer rather than requiring its
      // content rectangle to physically intersect that shorter board.
      expect
        .soft(
          await sheet.evaluate((element) => getComputedStyle(element).position),
          '(a) sheet floats outside document flow',
        )
        .toBe('fixed');
      expect
        .soft(
          await sheet.evaluate((element) => element.matches(':modal')),
          '(a) sheet occupies the modal layer over the room',
        )
        .toBe(true);
    }

    // Real touch input through Chromium, starting on the visual handle. The
    // header captures the pointer, so the drag may finish below the header.
    await swipeHandle(page);
    await expect.soft(sheet, '(c) swipe dismisses the sheet').toBeHidden();
    await expect
      .soft(page.locator('.postgame-sheet-toggle'), '(c) Game over stays available')
      .toBeVisible();
    const dismissed = await requiredBox(board);
    expect
      .soft(Math.abs(dismissed.width - before.width), '(c) dismissed board width')
      .toBeLessThanOrEqual(2);
    expect
      .soft(Math.abs(dismissed.height - before.height), '(c) dismissed board height')
      .toBeLessThanOrEqual(2);
    expect
      .soft(await boardUncovered(board), '(c) entire board fits and is unobstructed')
      .toBe(true);
    await capture('dismissed');

    await page.getByRole('button', { name: 'Game over', exact: true }).tap();
    await expect.soft(sheet, '(d) Game over reopens the sheet').toBeVisible();
    await expect.soft(controls, '(d) reopened sheet retains every action').toHaveText(ACTIONS);
    expect
      .soft(await controls.allTextContents(), '(d) action list is identical')
      .toEqual(originalActions);
    await capture('reopened');
    const measurements = { viewport, before, after, dismissed, actions: originalActions };
    await writeFile(
      `${OUTPUT}/${viewport.width}-measurements.json`,
      JSON.stringify(measurements, null, 2),
    );
    console.log(JSON.stringify(measurements));

    async function capture(step: string) {
      await mkdir(OUTPUT, { recursive: true });
      const path = `${OUTPUT}/${viewport.width}-${step}.png`;
      await page.screenshot({ path });
      await testInfo.attach(`${viewport.width}-${step}`, { path, contentType: 'image/png' });
    }
  });
}

function isLocal(value: string): boolean {
  return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(value).hostname);
}

async function requiredBox(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('Board has no bounding box');
  return box;
}

async function swipeHandle(page: Page) {
  const handle = await page.locator('.postgame-sheet__handle').boundingBox();
  if (!handle) throw new Error('Sheet handle has no bounding box');
  const x = handle.x + handle.width / 2;
  const y = handle.y + handle.height / 2;
  const session = await page.context().newCDPSession(page);
  try {
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let dy = 10; dy <= 100; dy += 10) {
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x, y: y + dy }],
      });
    }
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally {
    await session.detach();
  }
}

async function boardUncovered(board: Locator): Promise<boolean> {
  return board.evaluate((element) => {
    const box = element.getBoundingClientRect();
    if (box.left < 0 || box.top < 0 || box.right > innerWidth || box.bottom > innerHeight)
      return false;
    // Sample corners, edges, and centre: a visible box alone misses overlays.
    for (const fx of [0.01, 0.5, 0.99]) {
      for (const fy of [0.01, 0.5, 0.99]) {
        if (
          !element.contains(
            document.elementFromPoint(box.x + box.width * fx, box.y + box.height * fy),
          )
        )
          return false;
      }
    }
    return true;
  });
}
