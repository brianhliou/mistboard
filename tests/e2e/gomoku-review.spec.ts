import { existsSync, readFileSync } from 'node:fs';
import {
  applyGomokuRoomMove,
  createGomokuRoomState,
  type GomokuMove,
  type GomokuOpening,
  getGomokuPlayerView,
} from '@mistboard/game';
import { expect, type Page, test } from '@playwright/test';

// The recorded long game lives in the private repo beside the Gomoku ladder
// records (docs-private/gomoku); without it the spec skips. GOMOKU_LADDER_DATA
// points elsewhere.
type LongReview = {
  game_id: string;
  clocked?: boolean;
  opening: GomokuOpening;
  plies: { ply: number; uci: string; mover: string }[];
  ply_count: number;
  termination: string;
  result: string;
  analysis: {
    engineId?: string;
    depth?: number;
    plies: { ply: number; cp?: number | null; mate: number | null; best?: string | null }[];
  };
};
const FIXTURE = new URL(
  'long-review.json',
  process.env.GOMOKU_LADDER_DATA
    ? `file://${process.env.GOMOKU_LADDER_DATA.replace(/\/?$/, '/')}`
    : new URL('../../docs-private/gomoku/', import.meta.url),
);
const loaded: LongReview | null = existsSync(FIXTURE)
  ? JSON.parse(readFileSync(FIXTURE, 'utf8'))
  : null;
const fixture: LongReview = loaded ?? {
  game_id: 'gmk_absent',
  opening: { stones: [], turn: 'black' },
  plies: [],
  ply_count: 0,
  termination: '',
  result: 'draw',
  analysis: { plies: [] },
};

// Run on a local pair with both Gomoku flags OFF. The recorded server result
// replaces the expensive sweep/DB, while local analysis uses real Rapfi WASM.
// Server admission, job lifecycle and the sweep itself have independent server
// tests; no test account, import endpoint or published game is created here.
const room = fixture.game_id;
const route = `/api/gomoku/games/${room}`;
const opening = fixture.opening as GomokuOpening;
const last = fixture.ply_count;

function recording(game = fixture) {
  let state = createGomokuRoomState(room, game.opening);
  const truth = [{ ply: 0, at: 0, view: getGomokuPlayerView(state, 'black', true) }];
  const timeline: Array<{
    type: 'move-played';
    at: number;
    ply: number;
    color: 'black' | 'white';
    move: GomokuMove;
  }> = [];
  for (const entry of game.plies) {
    const move = { to: entry.uci } as GomokuMove;
    state = applyGomokuRoomMove(state, move);
    truth.push({
      ply: entry.ply,
      at: entry.ply * 1000,
      view: getGomokuPlayerView(state, 'black', true),
    });
    timeline.push({
      type: 'move-played',
      at: entry.ply * 1000,
      ply: entry.ply,
      color: entry.mover as 'black' | 'white',
      move,
    });
  }
  return {
    game: {
      roomId: room,
      variant: 'gomoku',
      mode: 'eve',
      result: game.result === 'draw' ? 'draw' : `${game.result}-wins`,
      termination: game.termination,
      plyCount: game.ply_count,
      rated: false,
      players: [
        { color: 'black', name: 'Black player' },
        { color: 'white', name: 'White player' },
      ],
      initialMs: null,
      incrementMs: null,
    },
    state: { status: state.status, moveNumber: state.moveNumber },
    view: getGomokuPlayerView(state, 'black', true),
    history: {
      truth: truth.map((frame) => ({
        ...frame,
        ...(game.clocked
          ? {
              clock: {
                remainingMs: { black: 60000 - frame.ply * 1000, white: 60000 - frame.ply * 2000 },
                activeColor: frame.view.status.type === 'playing' ? frame.view.status.turn : null,
                runningSince: frame.at,
                initialMs: 60000,
                incrementMs: 0,
              },
            }
          : {}),
      })),
    },
    timeline,
  };
}

async function open(page: Page, game = fixture) {
  await page.addInitScript(() => {
    localStorage.setItem('mb_admin', '1');
    localStorage.setItem('mb_signed_in', '1');
  });
  await page.route('**/api/auth/me', (request) =>
    request.fulfill({
      json: {
        user: {
          id: 'fixture-admin',
          handle: 'fixture-admin',
          email: 'fixture@example.invalid',
          accountRole: 'admin',
        },
      },
    }),
  );
  await page.route(`**${route}`, (request) => request.fulfill({ json: recording(game) }));
  let polls = 0;
  await page.route(`**${route}/analysis`, (request) =>
    request.request().method() === 'POST'
      ? request.fulfill({ status: 202, json: { jobId: 'fixture-sweep' } })
      : request.fulfill({ status: 204 }),
  );
  await page.route(`**${route}/analysis/jobs/fixture-sweep`, (request) =>
    request.fulfill({
      json: ++polls === 1 ? { status: 'pending' } : { status: 'done', result: game.analysis },
    }),
  );
  const cached = page.waitForResponse(
    (response) =>
      response.url().endsWith(`${route}/analysis`) && response.request().method() === 'GET',
  );
  await page.goto(`/gomoku/game/${room}?lang=en`);
  await cached;
  await expect(page.locator('.gomoku-svg')).toBeVisible();
  await page.getByRole('button', { name: 'Request computer analysis', exact: true }).click();
  await expect(page.locator('.advantage-chart')).toBeVisible();
}

const shortGame: LongReview = {
  game_id: room,
  clocked: true,
  opening: { stones: [], turn: 'black' },
  plies: ['a1', 'a15', 'b1', 'b15', 'c1', 'c15', 'd1', 'd15', 'e1'].map((uci, index) => ({
    ply: index + 1,
    uci,
    mover: index % 2 === 0 ? 'black' : 'white',
  })),
  ply_count: 9,
  result: 'black',
  termination: 'five',
  analysis: {
    engineId: 'rapfi-gomoku',
    depth: 9,
    plies: Array.from({ length: 10 }, (_, ply) => ({
      ply,
      cp: ply === 9 ? -30000 : ply % 2 === 0 ? 300 : -300,
      mate: null,
      best: null,
    })),
  },
};

test('shared review gives Black a dark advantage area and White a light area in both themes', async ({
  page,
}, testInfo) => {
  await open(page, shortGame);
  await expect(page.locator('.analysis-summary__player')).toHaveCount(2);
  await expect(page.locator('.gomoku-winning')).toHaveCount(5);
  await expect(page.locator('.gomoku-move-number')).toHaveCount(9);
  for (const theme of ['light', 'dark']) {
    await page.evaluate(
      (value) => (document.documentElement.dataset.effectiveTheme = value),
      theme,
    );
    const fills = await page.locator('.advantage-chart').evaluate((chart) => {
      const fill = (ink: string) =>
        getComputedStyle(chart.querySelector(`.advantage-chart__area--${ink}`)!).fill;
      const scope = chart.closest('[data-seat-ink-family="gomoku"]')!.parentElement!;
      const style = (selector: string) => getComputedStyle(scope.querySelector(selector)!);
      const dot = style('.game-meta-card .seat-disc--black');
      return {
        black: fill('black'),
        white: fill('white'),
        panel: getComputedStyle(chart).backgroundColor,
        edge: style('.advantage-chart__area--black').stroke,
        dot: dot.backgroundColor,
        ring: dot.borderTopColor,
        ringWidth: dot.borderTopWidth,
        bar: style('.review-move-times__bar--black').backgroundColor,
        clock: style('.review-move-times__clock--black').color,
      };
    });
    expect(fills.black).toBe('rgb(20, 18, 16)');
    expect(fills.dot).toBe(fills.black);
    expect(fills.bar).toBe(fills.black);
    expect(fills.clock).toBe(fills.black);
    expect(fills.ringWidth).toBe('1px');
    expect(fills.ring).not.toBe(fills.dot);
    expect(fills.edge).not.toBe('none');
    expect(fills.edge).not.toBe(fills.black);
    expect(fills.black).not.toBe(fills.panel);
    expect(fills.black).not.toBe(fills.white);
    const brightness = (fill: string) =>
      fill
        .match(/[\d.]+/g)!
        .slice(0, 3)
        .map(Number)
        .reduce((sum, channel) => sum + channel, 0);
    expect(brightness(fills.black)).toBeLessThan(brightness(fills.white));
  }
  await expect(page.locator('.review-move-list__eval').last()).toBeEmpty();
  await page.screenshot({ path: testInfo.outputPath('gomoku-review-dark.png'), fullPage: true });
  await page.evaluate(() => (document.documentElement.dataset.effectiveTheme = 'light'));
  await page.screenshot({ path: testInfo.outputPath('gomoku-review.png'), fullPage: true });
});

async function turnOnLocalEngine(page: Page) {
  if ((page.viewportSize()?.width ?? 1280) <= 600) {
    await page.locator('[data-move-nav-menu]').click();
    await page.locator('[data-review-engine]').click();
  } else {
    await page.locator('.engine-panel__switch').click();
  }
}

test.describe('recorded long-game Rapfi acceptance', () => {
  test.skip(!loaded, 'docs-private/gomoku/long-review.json not present');
  test('long game: Analyse yields every recorded graph point, including a null score', async ({
    page,
  }) => {
    await open(page);
    const points = await page.locator('.advantage-chart__line').getAttribute('points');
    expect(points?.split(' ')).toHaveLength(last + 1);
    expect(last + 1).toBeGreaterThanOrEqual(81);
    expect(points).not.toMatch(/NaN|Infinity/);
  });

  test('long game: stepping and clicking the graph move board and cursor together', async ({
    page,
  }) => {
    await open(page);
    await page.keyboard.press('Home');
    for (let k = 0; k < 12; k += 1) await page.keyboard.press('ArrowRight');
    await expect(page.locator('[data-piece-square]')).toHaveCount(opening.stones.length + 12);
    await expect(page.locator('.advantage-chart__cursor')).toHaveAttribute(
      'x1',
      ((300 * 12) / last).toFixed(2),
    );
    const graph = page.locator('.advantage-chart__svg');
    const box = await graph.boundingBox();
    if (!box) throw new Error('graph has no layout');
    await graph.click({ position: { x: (box.width * 40) / last, y: box.height / 2 } });
    await expect(page.locator('[data-piece-square]')).toHaveCount(opening.stones.length + 40);
  });

  test('long game: local Rapfi draws its best move and line while the graph stays', async ({
    page,
  }) => {
    await open(page);
    await page.keyboard.press('Home');
    await turnOnLocalEngine(page);
    await expect(page.locator('.gomoku-best')).toHaveCount(1, { timeout: 40_000 });
    await expect(page.locator('.gomoku-pv .gomoku-pv-number').first()).toHaveText('1');
    await expect(page.locator('.advantage-chart')).toBeVisible();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('[data-piece-square]')).toHaveCount(opening.stones.length + 1);
    await expect(page.locator('.gomoku-best')).toHaveCount(1, { timeout: 40_000 });
  });

  test('long game: a forced five is displayed as win in N', async ({ page }) => {
    await open(page);
    const forced = [...fixture.analysis.plies].reverse().find((point) => point.mate !== null);
    expect(forced).toBeDefined();
    await page.keyboard.press('Home');
    for (let k = 0; k < forced!.ply; k += 1) await page.keyboard.press('ArrowRight');
    await turnOnLocalEngine(page);
    const evaluation =
      (page.viewportSize()?.width ?? 1280) <= 600
        ? '.analysis-engine-bar__eval'
        : '.engine-panel__eval';
    await expect(page.locator(evaluation)).toHaveText(/^(Black|White) wins in \d+$/, {
      timeout: 40_000,
    });
  });
});

test('hidden game: a non-admin with flags off sees no Analyse and gets route refusal', async ({
  page,
}) => {
  await page.route('**/api/auth/me', (request) => request.fulfill({ json: { user: null } }));
  await page.goto(`/gomoku/game/${room}?lang=en`);
  await expect(page.locator('.xiangqi-review__analyse')).toHaveCount(0);
  await expect(page.locator('.gomoku-svg')).toHaveCount(0);
  expect((await page.request.get(`${route}/analysis`)).status()).toBe(404);
  expect((await page.request.post(`${route}/analysis`)).status()).toBe(404);
});

test('Gomoku rules have matching play rows and larger boards without phone overflow', async ({
  page,
}, testInfo) => {
  if ((page.viewportSize()?.width ?? 1280) < 600)
    await page.setViewportSize({ width: 375, height: 844 });
  await page.goto('/rules/gomoku?lang=en');
  const article = page.locator('[data-article-slug="gomoku"]');
  await expect(article.locator('h1')).toHaveText('Gomoku Rules');
  const rows = article.locator('.article-play-cta');
  await expect(rows).toHaveCount(2);
  const buttons = await rows.evaluateAll((elements) =>
    elements.map((row) =>
      [...row.querySelectorAll('a')].map((a) => [a.textContent, a.getAttribute('href')]),
    ),
  );
  expect(buttons[0]).toEqual(buttons[1]);
  expect(buttons[0]).toEqual([
    ['Play Gomoku', '/?play=computer&gameSpecId=gomoku'],
    ['Play a friend', '/?play=friend&gameSpecId=gomoku'],
  ]);
  const widths = await article
    .locator('figure > svg.gomoku-svg')
    .evaluateAll((boards) => boards.map((board) => board.getBoundingClientRect().width));
  expect(widths).toHaveLength(3);
  if ((page.viewportSize()?.width ?? 1280) > 600) expect(widths).toEqual([448, 448, 448]);
  else {
    expect(widths.every((width) => width <= 375 && width > 250)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      375,
    );
  }
  await page.screenshot({ path: testInfo.outputPath('gomoku-rules.png'), fullPage: true });
});
