import { createInitialXiangqiState, getStandardXiangqiPlayerView } from '@mistboard/game';
import { expect, type Locator, type Page, test, type WebSocketRoute } from '@playwright/test';

// Drive restart frames without restarting a shared dev server. Input still goes
// through Chromium's touch stack and the real room renderer and move handlers.
test('phone: paused Xiangqi blocks touch moves and reconnect freezes both clocks', async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, 'requires the mobile project and CDP touch input');
  const roomId = 'xq_restart_phone';
  const state = getStandardXiangqiPlayerView(createInitialXiangqiState(roomId), 'red');
  const moves: unknown[] = [];
  let socket: WebSocketRoute | null = null;
  let connections = 0;

  function frame(type: 'hello' | 'snapshot', paused: boolean) {
    return JSON.stringify({
      type,
      roomId,
      gameSpecId: 'xiangqi',
      clientId: 'restart-phone',
      seat: 'red',
      state,
      paused,
      seats: { red: 'restart-phone', black: 'opponent' },
      connectedSeats: { red: true, black: true },
      events: [],
      timeControl: { initialMs: 180_000, incrementMs: 0 },
      clock: {
        initialMs: 180_000,
        incrementMs: 0,
        activeColor: paused ? null : 'red',
        runningSince: paused ? null : Date.now(),
        remainingMs: { red: 180_000, black: 180_000 },
      },
    });
  }

  // Only the room socket: Vite's hot-reload socket opens first and would take the hello.
  await page.routeWebSocket(/[?&]room=/, (route) => {
    socket = route;
    connections += 1;
    route.onMessage((message) => {
      const payload = JSON.parse(String(message)) as { type: string };
      if (payload.type === 'move') moves.push(payload);
    });
    if (connections === 1) route.send(frame('hello', true));
  });
  await page.goto(`/room/${roomId}`);
  const overlay = page.locator('[data-board-paused]');
  await expect(overlay).toBeVisible();
  await expect(overlay).toContainText('Game paused');

  // Tap a legal soldier move through the paused overlay. Nothing may be sent.
  await touchTap(page, page.locator('[data-board] [data-square="a4"]'));
  await touchTap(page, page.locator('[data-board] [data-square="a5"]'));
  expect(moves).toEqual([]);

  if (!socket) throw new Error('room socket did not connect');
  (socket as WebSocketRoute).send(frame('snapshot', false));
  await expect(overlay).toBeHidden();
  await touchTap(page, page.locator('[data-board] [data-square="a4"]'));
  await touchTap(page, page.locator('[data-board] [data-square="a5"]'));
  await expect.poll(() => moves).toEqual([{ type: 'move', from: 'a4', to: 'a5' }]);

  (socket as WebSocketRoute).close({ code: 1012, reason: 'server restart' });
  await expect(page.locator('[data-clocks-note]')).toHaveText('Reconnecting…');
  const faces = page.locator('[data-clock-top] strong, [data-clock-bottom] strong');
  const frozen = await faces.allTextContents();
  // Includes a reopened socket that has not received its hello yet.
  await page.waitForTimeout(2_000);
  expect(connections).toBeGreaterThan(1);
  expect(await faces.allTextContents()).toEqual(frozen);
  await expect(page.locator('[data-clocks-note]')).toHaveText('Reconnecting…');
  (socket as WebSocketRoute).send(frame('hello', false));
  await expect(page.locator('[data-clocks-note]')).toBeHidden();
  const resumed = await faces.allTextContents();
  await expect.poll(() => faces.allTextContents()).not.toEqual(resumed);
});

async function touchTap(page: Page, target: Locator): Promise<void> {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (!box) throw new Error('touch target has no box');
  const session = await page.context().newCDPSession(page);
  try {
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }],
    });
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally {
    await session.detach();
  }
}
