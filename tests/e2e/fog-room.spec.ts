import { type Browser, expect, type Page, test } from '@playwright/test';

import {
  capture,
  debug,
  expectNoErrors,
  horizontalOverflow,
  movePiece,
  roomLayout,
  trackPageErrors,
  uniqueRoom,
  waitForSeat,
  waitForTurn,
} from './support';

// Port of scripts/visual-check.mjs: the home play entry, the Fog Chess room at
// desktop and phone widths, the engine debug harness, and the two-seat Fog
// flows that prove hidden-information redaction in a real browser. Asserts
// structure and redaction, never pixels.

const FOG_ROOM = (room: string, extra = '') =>
  `/room/${encodeURIComponent(room)}?reset=1&variant=fog-of-war${extra}`;

test('home: the play entry opens the unified setup dialog', async ({ page }, testInfo) => {
  const errors = trackPageErrors(page);
  await page.goto('/');
  const panel = page.locator('.landing-play-panel');
  await expect(panel).toBeVisible();
  // Since the 2026-07-20 homepage rework the panel is one primary button; the
  // opponent choice moved into the dialog (visual-check.mjs still expects the
  // old three-button row).
  const primary = panel.locator('.landing-play-action-primary');
  await expect(primary).toHaveText(/Play a game/);
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
  await capture(page, testInfo, 'home');

  await primary.click();
  const dialog = page.getByRole('dialog', { name: 'Play a game' });
  await expect(dialog).toBeVisible();
  const variants = dialog.getByRole('radiogroup', { name: 'Variant' }).getByRole('radio');
  await expect(variants.and(dialog.getByRole('radio', { checked: true }))).toHaveText('Xiangqi');
  await expect(variants.filter({ hasText: /^Fog Chess$/ })).toHaveCount(1);
  // One dialog for every opponent: the three old homepage buttons live here.
  await dialog.getByRole('button', { name: /^Opponent / }).click();
  const opponents = dialog.getByRole('radiogroup', { name: 'Opponent' }).getByRole('radio');
  await expect(opponents).toHaveText(['Bot', 'A friend', 'Lobby']);
  await expect(dialog.getByRole('button', { name: 'Start game' })).toBeVisible();
  await capture(page, testInfo, 'home-setup-dialog');
  expectNoErrors(errors);
});

test('fog room: square board, partial fog, panel placement', async ({ page }, testInfo) => {
  const errors = trackPageErrors(page);
  await page.goto(FOG_ROOM(uniqueRoom('fog', testInfo)));
  await waitForSeat(page, 'white');
  await expect(page.locator('.board.cg-wrap')).toBeVisible();
  await expect(page.locator('square.fog-hidden').first()).toBeAttached();
  await expect(page.locator('piece').first()).toBeAttached();

  const layout = await roomLayout(page);
  expect(Math.abs(layout.boardWidth - layout.boardHeight), 'board is square').toBeLessThanOrEqual(
    1,
  );
  // White sees its own 16 plus nothing of Black's army at the start.
  expect(layout.pieceCount).toBeGreaterThan(0);
  expect(layout.pieceCount).toBeLessThan(32);
  expect(layout.fogHiddenCount).toBeGreaterThan(0);
  expect(layout.panelStacked, 'side panel stacks under the board on a phone').toBe(true);
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
  expect((await debug(page)).gameSpecId).toBe('dark-chess');
  await capture(page, testInfo, 'fog-room');
  expectNoErrors(errors);
});

test.describe('two-seat and debug flows', () => {
  test.skip(({ isMobile }) => isMobile, 'layout-independent; desktop covers it');

  test('engine harness: three debug boards, true view clear, engine moves redacted', async ({
    page,
  }, testInfo) => {
    const errors = trackPageErrors(page);
    await page.goto(FOG_ROOM(uniqueRoom('engine', testInfo), '&dev=engine'));
    await waitForSeat(page, 'white');
    await expect(page.locator('[data-dev-views-section]:not([hidden])')).toBeVisible();
    await expect(page.locator('.dev-board')).toHaveCount(3);
    await expect(page.locator('h1')).toHaveText('Fog Debug');
    await expect(page.locator('.dev-board[aria-label="True view"] .dev-square.hidden')).toHaveCount(
      0,
    );

    await movePiece(page, 'e2', 'e4');
    await page.waitForFunction(
      () => window.__MISTBOARD_DEBUG__?.().devViews?.truth.board.e4?.color === 'white',
    );
    const state = await debug(page);
    expect(state.devViews?.truth.board.e4).toEqual({
      color: 'white',
      role: 'pawn',
    });
    const moves = state.events.filter((event) => event.type === 'move-played');
    expect(
      moves.filter((event) => event.color === 'black'),
      'engine moves stay hidden',
    ).toEqual([]);
    expect(moves).toHaveLength(1);
    // The engine's reply is not asserted: dev=engine seats Misty, which needs
    // the internal engine service. Without it the local server forfeits the
    // engine seat after White's first move (engine_seat_forfeited in the log).
    await capture(page, testInfo, 'engine-harness');
    expectNoErrors(errors);
  });

  test('fog vision: White sees what its pieces see, never Black moves', async ({
    browser,
    baseURL,
  }, testInfo) => {
    const room = uniqueRoom('vision', testInfo);
    const { white, black, errors, closeAll } = await seatTwoPlayers(browser, baseURL, room);
    try {
      await movePiece(white, 'e2', 'e4');
      await waitForTurn(white, 'black');
      await movePiece(black, 'a7', 'a6');
      await waitForTurn(white, 'white');
      await movePiece(white, 'e4', 'e5');
      await waitForTurn(black, 'black');
      await movePiece(black, 'd7', 'd5');
      await white.waitForFunction(() => {
        const view = window.__MISTBOARD_DEBUG__?.().currentView;
        return view?.status.turn === 'white' && view.board.d5?.role === 'pawn';
      });

      const view = (await debug(white)).currentView;
      expect(view?.board.d5).toEqual({ color: 'black', role: 'pawn' });
      expect(view?.visibleSquares).toEqual(expect.arrayContaining(['d5', 'd6']));
      const events = (await debug(white)).events.filter((event) => event.type === 'move-played');
      expect(events).toHaveLength(2);
      expect(events.filter((event) => event.color === 'black')).toEqual([]);
      await capture(white, testInfo, 'fog-vision-white');
      await capture(black, testInfo, 'fog-vision-black');
      expectNoErrors(errors);
    } finally {
      await closeAll();
    }
  });

  test('fog flow: finished room reveals both seats, replay re-fogs', async ({
    browser,
    baseURL,
  }, testInfo) => {
    const room = uniqueRoom('flow', testInfo);
    const seats = await seatTwoPlayers(browser, baseURL, room, '&views=all');
    const { white, black, errors } = seats;
    try {
      await movePiece(white, 'e2', 'e4');
      await waitForTurn(black, 'black');
      await movePiece(black, 'f7', 'f6');
      await waitForTurn(white, 'white');
      await movePiece(white, 'd1', 'h5');
      await waitForTurn(black, 'black');
      await movePiece(black, 'e8', 'f7');
      await waitForTurn(white, 'white');
      // While the game is live White's history holds only White's moves.
      const live = (await debug(white)).events.filter((event) => event.type === 'move-played');
      expect(live.map((event) => event.color)).toEqual(['white', 'white']);
      await movePiece(white, 'h5', 'f7');
      await white.waitForFunction(
        () => window.__MISTBOARD_DEBUG__?.().currentView?.status.type === 'finished',
      );

      // A finished room reveals everything, to both seats (roomViewPolicy);
      // visual-check.mjs predates that and still expects a fogged final board.
      const terminal = await debug(white);
      expect(terminal.currentView?.status).toMatchObject({ winner: 'white' });
      expect(terminal.currentView?.visibleSquares).toHaveLength(64);
      expect(terminal.devViews?.truth.visibleSquares).toHaveLength(64);
      await expect(white.locator('square.fog-hidden')).toHaveCount(0);
      const moves = terminal.events.filter((event) => event.type === 'move-played');
      expect(moves.map((event) => event.color)).toEqual([
        'white',
        'black',
        'white',
        'black',
        'white',
      ]);
      expect((await debug(black)).currentView?.visibleSquares).toHaveLength(64);
      await capture(white, testInfo, 'fog-flow-terminal-white');

      // Stepping back replays from White's own fogged perspective.
      await white.locator('[data-replay="first"]').click();
      await white.waitForFunction(() => {
        const view = window.__MISTBOARD_DEBUG__?.().currentView;
        return view?.status.type === 'playing' && view.board.e4 === undefined;
      });
      const replay = (await debug(white)).currentView;
      expect(replay?.board.e8, 'black king hidden at the first event').toBeUndefined();
      expect(replay?.board.f7, 'black pawn hidden at the first event').toBeUndefined();
      expect(replay?.board.e2?.color).toBe('white');
      expect(replay?.board.f6).toBeUndefined();
      expect(replay?.visibleSquares.length).toBeLessThan(64);
      expect((await debug(white)).devViews?.truth.visibleSquares).toHaveLength(64);
      await capture(white, testInfo, 'fog-flow-replay-white');
      await capture(black, testInfo, 'fog-flow-black');
      expectNoErrors(errors);
    } finally {
      await seats.closeAll();
    }
  });
});

// Two independent browser contexts, so each holds its own seat token. The
// caller closes them (closeAll) so both videos and traces are finalized.
async function seatTwoPlayers(
  browser: Browser,
  baseURL: string | undefined,
  room: string,
  whiteExtra = '',
): Promise<{
  white: Page;
  black: Page;
  errors: string[];
  closeAll: () => Promise<void>;
}> {
  const options = { viewport: { width: 1280, height: 900 }, baseURL };
  const whiteContext = await browser.newContext(options);
  const blackContext = await browser.newContext(options);
  const white = await whiteContext.newPage();
  const black = await blackContext.newPage();
  const errors: string[] = [];
  trackPageErrors(white, errors, 'white');
  trackPageErrors(black, errors, 'black');
  await white.goto(FOG_ROOM(room, whiteExtra));
  await waitForSeat(white, 'white');
  await black.goto(`/room/${encodeURIComponent(room)}?variant=fog-of-war`);
  await waitForSeat(black, 'black');
  await expect(white.locator('.board.cg-wrap')).toBeVisible();
  await expect(black.locator('.board.cg-wrap')).toBeVisible();
  const closeAll = async () => {
    await whiteContext.close();
    await blackContext.close();
  };
  return { white, black, errors, closeAll };
}
