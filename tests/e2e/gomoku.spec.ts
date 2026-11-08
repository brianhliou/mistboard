import {
  applyGomokuRoomMove,
  createGomokuRoomState,
  type GomokuColor,
  type GomokuPlayerView,
  parseGomokuMove,
} from '@mistboard/game';
import { expect, test } from '@playwright/test';
import { capture, expectNoErrors, trackPageErrors } from './support';

// Local only. Start the pair with MISTBOARD_GOMOKU_ENABLED=true and
// VITE_GOMOKU_ENABLED=true, then set E2E_BASE_URL to that pair. Or give both
// flags to `npm run test:e2e -- gomoku.spec.ts --project=desktop --workers=1`.
// Real worker + WASM + pinned networks; no mocked moves, resign or debug wins.
for (const human of ['black', 'white'] as const) {
  test(`Gomoku: ${human} plays Rapfi Level 1 through a kernel ending`, async ({ page }, info) => {
    test.setTimeout(240_000);
    const errors = trackPageErrors(page);
    const positions = new Map<number, GomokuPlayerView>();
    const workerUrls: string[] = [];
    let latest: GomokuPlayerView | undefined;
    let ownSeat: string | undefined;
    let wireEngine: string | undefined;
    let networkLoaded = false;
    page.on('worker', (worker) => workerUrls.push(worker.url()));
    page.on('response', (response) => {
      if (response.url().includes('/engine/rapfi/rapfi-single-simd128.data') && response.ok())
        networkLoaded = true;
    });
    page.on('websocket', (socket) =>
      socket.on('framereceived', ({ payload }) => {
        const frame = JSON.parse(String(payload)) as {
          seat?: string;
          pveEngineId?: string;
          state?: GomokuPlayerView;
        };
        if (frame.seat) ownSeat = frame.seat;
        if (frame.pveEngineId) wireEngine = frame.pveEngineId;
        if (frame.state) {
          latest = frame.state;
          positions.set(latest.ply, latest);
        }
      }),
    );

    const created = await page.request.post('/api/rooms', {
      data: {
        gameSpecId: 'gomoku',
        mode: 'pve',
        preferredColor: human,
        engineId: 'rapfi-level-1',
        rated: false,
        timeControl: { initialMs: 600_000, incrementMs: 5_000 },
      },
    });
    expect(created.status(), 'enable the two Gomoku flags on the local pair').toBe(201);
    const room = (await created.json()) as { roomId: string; url: string; rated: boolean };
    expect(room.rated).toBe(false);
    await page.goto(room.url);
    await expect(page.locator('.gomoku-svg')).toBeVisible();
    await expect.poll(() => ownSeat).toBe(human);
    expect(wireEngine).toBe('rapfi-level-1');
    // A dealt opening may start on the human turn; the idle bot panel is hidden.
    // Worker/network checks and the full game below verify the real bot without
    // racing its transient thinking indicator.
    await expect(page.locator('[data-gomoku-bot] a')).toHaveCount(0);

    // The human plays a fixed scattered order, with no engine assistance. A
    // freestyle game must end by five or a full board within 225 placements.
    for (let turn = 0; turn < 225; turn += 1) {
      await expect
        .poll(
          () =>
            latest !== undefined &&
            (latest.status.type !== 'playing' || latest.status.turn === human),
          { timeout: 40_000, message: 'Rapfi must answer the human move' },
        )
        .toBe(true);
      const view = latest;
      expect(view).toBeDefined();
      if (view?.status.type !== 'playing') break;
      const to = scatteredEmptySquare(view.board, view.ply);
      const hit = page.locator(`[data-square="${to}"] .gomoku-hit`);
      await expect(hit).toHaveAttribute('aria-disabled', 'false');
      await hit.click();
      await expect.poll(() => latest?.ply ?? 0).toBeGreaterThan(view.ply);
    }
    const final = latest;
    expect(final?.status.type).toBe('finished');
    if (final?.status.type !== 'finished') throw new Error('no terminal Gomoku frame');
    expect(['five', 'board-full']).toContain(final.status.reason);
    expect(final.ply).toBeLessThanOrEqual(225);
    expect(networkLoaded, 'the real pinned Rapfi networks loaded').toBe(true);
    expect(workerUrls.some((url) => url.includes('/engine/rapfi/worker.js'))).toBe(true);
    const openingPly = final.opening?.stones.length ?? 0;
    expect(openingPly).toBeGreaterThanOrEqual(3);
    expect(positions.size).toBe(final.ply - openingPly + 1);
    let referee = createGomokuRoomState(room.roomId, final.opening);
    for (let ply = openingPly + 1; ply <= final.ply; ply += 1) {
      const recorded = positions.get(ply);
      const move = recorded?.lastMove;
      expect(move, `missing ply ${ply}`).toBeDefined();
      if (!move) throw new Error(`missing move ${ply}`);
      referee = applyGomokuRoomMove(referee, move);
      expect(referee.ply).toBe(ply);
      expect(referee.board).toEqual(recorded?.board);
    }
    expect(referee.status).toEqual(final.status);
    await expect(page.locator('[data-piece-square]')).toHaveCount(final.ply);
    await capture(page, info, `gomoku-rapfi-level-1-${human}-finished`);
    expectNoErrors(errors);
  });
}

function scatteredEmptySquare(board: readonly (GomokuColor | null)[], ply: number): string {
  for (let offset = 0; offset < 225; offset += 1) {
    const index = ((ply + offset) * 37) % 225;
    if (board[index] === null) {
      const square = `${String.fromCharCode(97 + (index % 15))}${1 + Math.floor(index / 15)}`;
      if (parseGomokuMove(square)) return square;
    }
  }
  throw new Error('a playing board has no empty intersection');
}
