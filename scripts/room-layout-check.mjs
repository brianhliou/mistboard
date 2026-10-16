// Room layout check: start a bot game in each board shape and assert the right
// column's table is whole. From 2026-09-30 to 10-02 the right rail was capped at
// the board's height, and every board shorter than the table (banqi's 8x4
// strip, flip jungle) clipped the move list, the seat row and Resign/Abort out
// of sight. CSS text tests could not see it; only a laid-out page can.
//
//   MISTBOARD_WEB_URL=http://localhost:3030 node scripts/room-layout-check.mjs
//
// Needs a running dev pair (npm run dev:memory is enough: bot games only).
import { launchChromium } from './lib/launch-browser.mjs';

const baseUrl = (process.env.MISTBOARD_WEB_URL ?? 'http://127.0.0.1:3000').replace(/\/$/, '');
const specs = ['banqi', 'jungle-flip', 'xiangqi', 'jieqi', 'fortress-xiangqi', 'jungle'];
const viewports = [
  { width: 2000, height: 960 },
  { width: 1366, height: 768 },
  { width: 1100, height: 800 },
];

const browser = await launchChromium();
const failures = [];

for (const viewport of viewports) {
  for (const spec of specs) {
    const page = await browser.newPage({ viewport });
    const label = `${spec} @ ${viewport.width}x${viewport.height}`;
    try {
      await page.goto(`${baseUrl}/?play=computer&gameSpecId=${spec}`);
      await page.getByRole('button', { name: 'Start game' }).click();
      await page.waitForURL(/\/room\//);
      await page.locator('.game-controls button').first().waitFor({ state: 'attached' });
      const m = await page.evaluate(() => {
        const rect = (selector) =>
          document.querySelector(selector)?.getBoundingClientRect() ?? null;
        const box = rect('.live-review__cluster .round-table__box');
        const control = rect('.game-controls button');
        const moves = rect('.live-review__cluster .game-table-moves');
        const seat = rect('.round-table__player--bottom');
        const rail = rect('.live-review__cluster .moves-panel');
        const meta = rect('.live-review__cluster .meta-panel');
        const board = rect('.live-review__cluster .board-stage');
        const pool = document.querySelector('.hidden-pool');
        const inside = (inner) =>
          !!inner &&
          !!box &&
          inner.height > 0 &&
          inner.top >= box.top - 0.5 &&
          inner.bottom <= box.bottom + 0.5;
        return {
          controlInside: inside(control),
          seatInside: inside(seat),
          movesHeight: moves ? Math.round(moves.height) : 0,
          railBottom: rail ? Math.round(rail.bottom) : 0,
          metaBottom: meta ? Math.round(meta.bottom) : 0,
          boardBottom: board ? Math.round(board.bottom) : 0,
          poolUnderBoard: pool?.parentElement?.classList.contains('review-shell__center') ?? false,
          poolTop: pool ? Math.round(pool.getBoundingClientRect().top) : 0,
          horizontalOverflow: document.documentElement.scrollWidth - window.innerWidth,
        };
      });
      const fail = (why) => failures.push(`${label}: ${why} ${JSON.stringify(m)}`);
      if (!m.controlInside) fail('Resign/Abort is clipped out of the table');
      if (!m.seatInside) fail("the viewer's seat row is clipped out of the table");
      if (m.movesHeight < 72) fail(`the move window is ${m.movesHeight}px, under its 72px floor`);
      if (m.horizontalOverflow > 1) fail(`horizontal overflow ${m.horizontalOverflow}px`);
      if (spec === 'banqi' || spec === 'jungle-flip') {
        if (!m.poolUnderBoard || m.poolTop < m.boardBottom)
          fail('the face-down tally is not under the board');
        if (viewport.width >= 1260 && Math.abs(m.metaBottom - m.railBottom) > 2) {
          fail('the chat rail and the table rail end at different heights');
        }
      }
      console.log(`${failures.some((f) => f.startsWith(label)) ? 'FAIL' : 'ok  '} ${label}`);
    } catch (error) {
      failures.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
      console.log(`FAIL ${label}`);
    } finally {
      await page.close();
    }
  }
}

await browser.close();
if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log(`room layout: ${specs.length * viewports.length} rooms whole`);
