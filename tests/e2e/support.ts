import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

import { expect, type Page, type TestInfo } from '@playwright/test';

// Shared helpers for the e2e specs. Everything a spec needs to read the live
// room goes through window.__MISTBOARD_DEBUG__ (apps/web/src/live.ts), the same
// hook visual-check.mjs used; the board is a canvas-like chessground surface
// with no text, so the debug snapshot is the readable state.

export type Square = string;
export type DebugPiece = { color: 'white' | 'black'; role: string } | undefined;
export type DebugView = {
  board: Record<Square, DebugPiece>;
  legalMoves: Array<{ from: Square; to: Square }>;
  perspective?: 'white' | 'black';
  status: { type: string; turn?: string; winner?: string; reason?: string };
  visibleSquares: Square[];
};
export type DebugSnapshot = {
  connectionState: string;
  currentView: DebugView | null;
  devViews: {
    opponent?: string;
    opponentView: DebugView;
    player: DebugView;
    truth: DebugView;
  } | null;
  events: Array<{ type: string; color?: string }>;
  gameSpecId: string | null;
  seat: 'white' | 'black' | 'spectator' | null;
};

declare global {
  interface Window {
    __MISTBOARD_DEBUG__?: () => DebugSnapshot;
  }
}

// Console noise that is known, expected, and not a regression. Each entry
// names the request that produces it; anything else fails the spec.
const KNOWN_CONSOLE_NOISE: Array<{
  reason: string;
  matches: (text: string, url: string) => boolean;
}> = [
  {
    // A signed-out seat asks for its room chat and is told 401; the panel
    // then renders "Sign in to chat". Chrome logs every 4xx subresource.
    reason: 'signed-out room chat probe',
    matches: (text, url) => text.includes('status of 401') && url.includes('/api/chat/player/'),
  },
];

/**
 * Collect console errors and uncaught page errors, minus KNOWN_CONSOLE_NOISE,
 * into `sink` (pass one array to several pages to gather them together).
 */
export function trackPageErrors(page: Page, sink: string[] = [], label = ''): string[] {
  const prefix = label ? `[${label}] ` : '';
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const url = msg.location().url ?? '';
    if (KNOWN_CONSOLE_NOISE.some((noise) => noise.matches(msg.text(), url))) return;
    sink.push(`${prefix}${msg.text()}${url ? ` (${url})` : ''}`);
  });
  page.on('pageerror', (error) => sink.push(`${prefix}pageerror: ${error.message}`));
  return sink;
}

/**
 * Full-page screenshot to test-results/screenshots/<project>/<name>.png, also
 * attached to the HTML report. For reading, not diffing.
 */
export async function capture(page: Page, testInfo: TestInfo, name: string): Promise<string> {
  const path = `test-results/screenshots/${testInfo.project.name}/${name}.png`;
  await mkdir(dirname(path), { recursive: true });
  await page.screenshot({ path, fullPage: true });
  await testInfo.attach(name, { path, contentType: 'image/png' });
  return path;
}

export async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}

export function uniqueRoom(prefix: string, testInfo: TestInfo): string {
  return `e2e-${prefix}-${testInfo.project.name}-${Date.now()}-${testInfo.workerIndex}`;
}

export function debug(page: Page): Promise<DebugSnapshot> {
  return page.evaluate(() => {
    const snapshot = window.__MISTBOARD_DEBUG__?.();
    if (!snapshot) throw new Error('window.__MISTBOARD_DEBUG__ is not installed');
    return snapshot;
  });
}

export async function waitForSeat(page: Page, seat: 'white' | 'black'): Promise<void> {
  await page.waitForFunction((want) => window.__MISTBOARD_DEBUG__?.().seat === want, seat);
}

/** Wait until the live game is in progress with `turn` to move. */
export async function waitForTurn(page: Page, turn: 'white' | 'black'): Promise<void> {
  await page.waitForFunction((want) => {
    const status = window.__MISTBOARD_DEBUG__?.().currentView?.status;
    return status?.type === 'playing' && status.turn === want;
  }, turn);
}

/** Play a chess-board move by clicking the two squares, as a player would. */
export async function movePiece(page: Page, from: Square, to: Square): Promise<void> {
  await page
    .waitForFunction(
      (square) =>
        window.__MISTBOARD_DEBUG__?.().currentView?.legalMoves.some((m) => m.from === square),
      from,
      { timeout: 15_000 },
    )
    .catch(async (error) => {
      const state = await debug(page).catch(() => null);
      throw new Error(
        `move ${from}-${to} unavailable: seat=${state?.seat} status=${JSON.stringify(
          state?.currentView?.status,
        )}`,
        { cause: error },
      );
    });
  await clickSquare(page, from);
  await clickSquare(page, to);
}

const FILES = 'abcdefgh';

async function clickSquare(page: Page, square: Square): Promise<void> {
  const box = await page.locator('.board.cg-wrap').first().boundingBox();
  if (!box) throw new Error('missing board box');
  const orientation = (await debug(page)).currentView?.perspective ?? 'white';
  const fileIndex = FILES.indexOf(square[0]);
  const rank = Number(square[1]);
  const column = orientation === 'white' ? fileIndex : 7 - fileIndex;
  const row = orientation === 'white' ? 8 - rank : rank - 1;
  await page.mouse.click(
    box.x + ((column + 0.5) * box.width) / 8,
    box.y + ((row + 0.5) * box.height) / 8,
  );
}

/** Board/panel geometry a room page must keep at every width. */
export async function roomLayout(page: Page) {
  return page.evaluate(() => {
    const board = document.querySelector('.board.cg-wrap');
    const panel = document.querySelector('.side-panel');
    if (!board || !panel) throw new Error('missing board or side panel');
    const boardRect = board.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    return {
      boardWidth: boardRect.width,
      boardHeight: boardRect.height,
      fogHiddenCount: document.querySelectorAll('square.fog-hidden').length,
      pieceCount: document.querySelectorAll('piece:not(.fading)').length,
      // Below the 780px breakpoint the side panel stacks under the board.
      panelStacked: window.innerWidth > 780 ? true : panelRect.top >= boardRect.bottom - 1,
    };
  });
}

export function expectNoErrors(errors: string[]): void {
  expect(errors, `console/page errors:\n${errors.join('\n')}`).toEqual([]);
}
