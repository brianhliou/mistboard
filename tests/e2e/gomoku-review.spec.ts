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
  opening: GomokuOpening;
  plies: { ply: number; uci: string; mover: string }[];
  ply_count: number;
  termination: string;
  result: string;
  analysis: { plies: { ply: number; mate: number | null }[] };
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
test.skip(!loaded, 'docs-private/gomoku/long-review.json not present');
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

function recording() {
  let state = createGomokuRoomState(room, opening);
  const truth = [{ ply: 0, at: 0, view: getGomokuPlayerView(state, 'black', true) }];
  const timeline: Array<{
    type: 'move-played';
    at: number;
    ply: number;
    color: 'black' | 'white';
    move: GomokuMove;
  }> = [];
  for (const entry of fixture.plies) {
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
      result: fixture.result === 'draw' ? 'draw' : `${fixture.result}-wins`,
      termination: fixture.termination,
      plyCount: last,
      rated: false,
      initialMs: null,
      incrementMs: null,
    },
    state: { status: state.status, moveNumber: state.moveNumber },
    view: getGomokuPlayerView(state, 'black', true),
    history: { truth },
    timeline,
  };
}

async function open(page: Page) {
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
  await page.route(`**${route}`, (request) => request.fulfill({ json: recording() }));
  let polls = 0;
  await page.route(`**${route}/analysis`, (request) =>
    request.request().method() === 'POST'
      ? request.fulfill({ status: 202, json: { jobId: 'fixture-sweep' } })
      : request.fulfill({ status: 204 }),
  );
  await page.route(`**${route}/analysis/jobs/fixture-sweep`, (request) =>
    request.fulfill({
      json: ++polls === 1 ? { status: 'pending' } : { status: 'done', result: fixture.analysis },
    }),
  );
  await page.goto(`/gomoku/game/${room}?lang=en`);
  await expect(page.locator('.gomoku-svg')).toBeVisible();
  await page.getByRole('button', { name: 'Analyse', exact: true }).click();
  await expect(page.locator('.advantage-chart')).toBeVisible();
}

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
  await page.locator('.engine-panel__switch').click();
  await expect(page.locator('.gomoku-best')).toHaveCount(1, { timeout: 40_000 });
  await expect(page.locator('.gomoku-pv-number').first()).toHaveText('1');
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
  await page.locator('.engine-panel__switch').click();
  await expect(page.locator('.engine-panel__eval')).toHaveText(/^(Black|White) wins in \d+$/, {
    timeout: 40_000,
  });
});

test('hidden game: a non-admin with flags off sees no Analyse and gets route refusal', async ({
  page,
}) => {
  await page.route('**/api/auth/me', (request) => request.fulfill({ json: { user: null } }));
  await page.goto(`/gomoku/game/${room}?lang=en`);
  await expect(page.locator('[data-gomoku-analyse]')).toHaveCount(0);
  await expect(page.locator('.gomoku-svg')).toHaveCount(0);
  expect((await page.request.get(`${route}/analysis`)).status()).toBe(404);
  expect((await page.request.post(`${route}/analysis`)).status()).toBe(404);
});
