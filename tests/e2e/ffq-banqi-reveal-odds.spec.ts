import {
  createInitialFFQBanqiState,
  FFQ_BANQI_DAMAGE,
  type FFQBanqiPlayerView,
  getFFQBanqiPlayerView,
} from '@mistboard/game';
import { expect, test } from '@playwright/test';

// Local pair with VITE_FFQ_BANQI_ENABLED=true. Only masked views cross the
// socket seam; no engine, account, database fixture or production game needed.
test('Fanfanqi odds and wrapped captures fit the board and phone panel', async ({
  page,
  baseURL,
  isMobile,
}, info) => {
  if (!baseURL || !['localhost', '127.0.0.1', '[::1]'].includes(new URL(baseURL).hostname)) {
    throw new Error('This layout test requires a local pair');
  }
  await page.setViewportSize(isMobile ? { width: 390, height: 844 } : { width: 1160, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const roomId = 'ffq_reveal_odds_layout';
  const state = createInitialFFQBanqiState(roomId, 7);
  // Nine different capture discs force wrapping, including friendly covered
  // victims. Leave both inks with covered pieces for their odds rows.
  for (const [owner, roles] of [
    ['black', ['advisor', 'elephant', 'chariot', 'horse', 'cannon', 'soldier']],
    ['red', ['horse', 'cannon', 'soldier']],
  ] as const) {
    for (const role of roles) {
      const square = state.board.findIndex(
        (piece) => piece?.color === owner && piece.role === role,
      );
      const piece = state.board[square]!;
      state.board[square] = null;
      state.captures.push({ owner, role, capturedBy: 'red', wasFaceDown: piece.faceDown });
      state.hp[owner] -= FFQ_BANQI_DAMAGE[role];
    }
  }
  state.ply = 18;
  state.moveNumber = 10;
  const live = getFFQBanqiPlayerView(state, 'observer');
  const finished: FFQBanqiPlayerView = {
    ...live,
    status: { type: 'finished', winner: 'black', reason: 'resignation' },
    legalMoves: [],
  };
  let sendFinished: () => void = () => {
    throw new Error('Room socket has not connected');
  };
  await page.route('**/api/**', (route) => route.fulfill({ json: {} }));
  await page.routeWebSocket(/[?&]room=ffq_reveal_odds_layout(?:&|$)/, (socket) => {
    const frame = (view: typeof live | typeof finished) =>
      JSON.stringify({
        type: 'hello',
        roomId,
        gameSpecId: 'ffq-banqi',
        seat: 'spectator',
        state: view,
        events: [{ type: 'room-created', roomId, at: 0 }],
      });
    socket.send(frame(live));
    sendFinished = () => socket.send(frame(finished));
  });
  await page.goto(`/room/${roomId}`);
  const pool = page.locator('.hidden-pool');
  await expect(pool.locator('[data-line="face-down"]')).toHaveCount(2);
  const livePercentages = await pool.locator('.reveal-odds-chip__pct').allTextContents();
  expect(livePercentages.length).toBeGreaterThan(0);
  for (const phase of ['live', 'finished']) {
    if (phase === 'finished') {
      sendFinished();
      await expect(page.locator('[data-game-result]')).toBeVisible();
      await expect(pool.locator('.reveal-odds-chip__pct')).toHaveText(livePercentages);
      const dialog = page.getByRole('dialog', { name: 'Game over', exact: true });
      if (await dialog.isVisible()) await page.keyboard.press('Escape');
    }
    const measurements = await page.evaluate(() => {
      const pool = document.querySelector<HTMLElement>('.hidden-pool')!;
      const panel = pool.getBoundingClientRect();
      const board = document.querySelector('.board-stage')!.getBoundingClientRect();
      const pieces = [...pool.querySelectorAll<HTMLElement>('.tk-seat__pieces')];
      const taken = [
        ...pool.querySelectorAll('[data-seat="red"] [data-line="captured"] .review-capture-piece'),
      ];
      return {
        overflow: document.documentElement.scrollWidth - innerWidth,
        panelLeft: panel.left,
        panelRight: panel.right,
        boardLeft: board.left,
        boardRight: board.right,
        viewport: innerWidth,
        wrapped:
          new Set(taken.map((piece) => Math.round(piece.getBoundingClientRect().top))).size > 1,
        // Each seat's "Still face-down" label, top seat first.
        faceDownTops: [
          ...pool.querySelectorAll<HTMLElement>('[data-line="face-down"] .tk-seat__key'),
        ].map((key) => Math.round(key.getBoundingClientRect().top)),
        piecesFit: pieces.every((row) =>
          [...row.children].every((piece) => {
            const box = piece.getBoundingClientRect();
            const parent = row.getBoundingClientRect();
            return box.left >= parent.left - 1 && box.right <= parent.right + 1;
          }),
        ),
      };
    });
    expect(measurements.overflow).toBeLessThanOrEqual(1);
    expect(measurements.panelLeft).toBeGreaterThanOrEqual(0);
    expect(measurements.panelRight).toBeLessThanOrEqual(measurements.viewport);
    expect(measurements.piecesFit).toBe(true);
    if (isMobile) expect(measurements.wrapped).toBe(true);
    if (!isMobile) {
      // Side by side, Red's captures wrap and Black's do not; the two
      // face-down lines still start level.
      expect(measurements.wrapped).toBe(true);
      expect(measurements.faceDownTops).toHaveLength(2);
      expect(measurements.faceDownTops[0]).toBe(measurements.faceDownTops[1]);
      expect(measurements.panelLeft).toBeGreaterThanOrEqual(measurements.boardLeft - 1);
      expect(measurements.panelRight).toBeLessThanOrEqual(measurements.boardRight + 1);
    }
    await info.attach(`${phase}-layout`, {
      body: JSON.stringify(measurements),
      contentType: 'application/json',
    });
    await info.attach(`${phase}-screen`, {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });
  }
});
