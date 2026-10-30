import {
  attemptStandardXiangqiPuzzleLine,
  getStandardXiangqiLegalMoves,
  XIANGQI_PUZZLES,
  type XiangqiMove,
  type XiangqiPuzzle,
} from '@mistboard/game';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { track } from '../analytics.js';
import { displayPreferenceStorageKey } from '../display-preferences.js';
import { mountPuzzles } from '../puzzles.js';

vi.mock('../analytics.js', async (original) => ({
  ...(await original<typeof import('../analytics.js')>()),
  track: vi.fn(),
}));
vi.mock('../live-sound.js', () => ({ initLiveSound: vi.fn(), playSound: vi.fn() }));

const puzzles = XIANGQI_PUZZLES.filter((p) => p.solution.length === 3).slice(0, 3);
function detail(p: XiangqiPuzzle) {
  return {
    id: p.id,
    variant: p.variant,
    initial: p.initial,
    title: p.title,
    goal: p.goal,
    sideToMove: p.initial.status.type === 'playing' ? p.initial.status.turn : 'red',
    themes: p.themes,
    motifs: [],
    rating: 1000,
    ratingProvisional: true,
    solutionPlyCount: p.solution.length,
  };
}
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
function click(root: HTMLElement, label: string) {
  const target = [...root.querySelectorAll('button')].find((b) => b.textContent === label);
  expect(target, label).toBeTruthy();
  target!.click();
}
function move(root: HTMLElement, m: XiangqiMove) {
  for (const square of [m.from, m.to]) {
    const target = root.querySelector(`[data-square="${square}"]`);
    expect(target).toBeTruthy();
    target!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  }
}
beforeEach(() => {
  const values = new Map([
    [displayPreferenceStorageKey, JSON.stringify({ pieceAnimation: 'none' })],
  ]);
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => values.get(k) ?? null,
      setItem: (k: string, v: string) => values.set(k, v),
      removeItem: (k: string) => values.delete(k),
    },
  });
  window.sessionStorage.clear();
  window.history.replaceState(null, '', '/puzzles?mode=streak');
  vi.clearAllMocks();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
  window.history.replaceState(null, '', '/');
});

it('plays through a solve, one skip, and a terminal miss with review and mode telemetry', async () => {
  let index = 0;
  let score = 0;
  let skipUsed = false;
  const results: { id: string; outcome: string }[] = [];
  let moves: XiangqiMove[] = [];
  const fetchSpy = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    if (String(url).includes('/quality')) return json({});
    expect(String(url)).toBe('/api/puzzles/streak');
    const body = JSON.parse(String(init?.body));
    let attempt: ReturnType<typeof attemptStandardXiangqiPuzzleLine> | undefined;
    let finished = false;
    if (body.action === 'start') {
      index = 0;
      score = 0;
      skipUsed = false;
      results.length = 0;
      moves = [];
    } else if (body.action === 'skip') {
      skipUsed = true;
      results.push({ id: puzzles[index]!.id, outcome: 'skipped' });
      index++;
    } else if (body.action === 'move') {
      moves.push(body.move);
      attempt = attemptStandardXiangqiPuzzleLine(puzzles[index]!, moves);
      if (attempt.ok && attempt.complete) {
        score++;
        results.push({ id: puzzles[index]!.id, outcome: 'solved' });
        index++;
        moves = [];
      } else if (!attempt.ok) {
        finished = true;
        results.push({ id: puzzles[index]!.id, outcome: 'failed' });
      }
    }
    return json({
      runId: 'run',
      score,
      best: 4,
      skipUsed,
      finished,
      results,
      puzzle: finished ? null : detail(puzzles[index]!),
      attempt,
      ...(finished ? { solution: puzzles[index]!.solution } : {}),
    });
  });
  vi.stubGlobal('fetch', fetchSpy);
  const root = document.createElement('div');
  document.body.append(root);
  await mountPuzzles(root);
  // No start screen: the run layout is up at once and the run starts itself.
  expect(root.querySelector('.puzzle-streak-side h1')?.textContent).toBe('Puzzle Streak');
  expect(root.textContent).not.toContain('Start streak');
  await vi.waitFor(() =>
    expect(root.querySelector<HTMLElement>('.puzzle-board')?.dataset.puzzleId).toBe(puzzles[0]!.id),
  );
  expect(actions(fetchSpy)).toEqual([{ action: 'start' }]);
  // The regular page's info card sits on top, its rating hidden mid-run.
  const info = () => root.querySelector<HTMLElement>('.puzzle-info-card')!;
  expect(info().nextElementSibling?.classList.contains('puzzle-streak-side')).toBe(true);
  expect(info().querySelector('a')?.getAttribute('href')).toContain(puzzles[0]!.id);
  expect(info().textContent).toContain('Rating: hidden');
  const side = root.querySelector('.puzzle-streak-side')!;
  expect(side.textContent).toContain('No clock, one skip. Your puzzle rating does not change.');
  // A signed-in player is not asked to sign in.
  expect(side.querySelector('.puzzle-streak-signin')).toBeNull();
  expect(root.querySelector('[data-puzzle-hint]')).toBeNull();
  expect(root.querySelector('[data-puzzle-reveal]')).toBeNull();
  expect(root.querySelector('.engine-panel')).toBeNull();
  expect(root.textContent).toContain('Best: 4');
  expect(root.textContent).not.toContain('Guest');
  expect(root.querySelector('.puzzle-streak-count strong')?.textContent).toBe('0');
  // The run's prompt is the trainer's row (Brian, 2026-10-29): the side's
  // general, "<side> to move" over "Find the best move.", with the count in a
  // tally beside it rather than a big block of its own.
  const prompt = root.querySelector('.puzzle-streak-feedback')!;
  expect(prompt.querySelector('.puzzle-feedback-icon svg')).not.toBeNull();
  expect(prompt.querySelector('.puzzle-feedback-title')?.textContent).toMatch(
    /^(Red|Black) to move$/,
  );
  expect(prompt.querySelector('.puzzle-feedback-body')?.textContent).toBe('Find the best move.');
  expect(
    prompt.querySelector('.puzzle-streak-tally .puzzle-streak-count strong')?.textContent,
  ).toBe('0');
  expect(prompt.querySelector('.puzzle-streak-tally')?.textContent).toContain('Best: 4');
  for (const m of puzzles[0]!.solution.filter((_, i) => i % 2 === 0)) {
    const count = fetchSpy.mock.calls.length;
    move(root, m);
    await vi.waitFor(() => expect(fetchSpy.mock.calls.length).toBeGreaterThan(count));
    await vi.waitFor(() =>
      expect(root.querySelector('.puzzle-streak-feedback')?.getAttribute('aria-busy')).toBe(
        'false',
      ),
    );
  }
  await vi.waitFor(() =>
    expect(root.querySelector('.puzzle-streak-count strong')?.textContent).toBe('1'),
  );
  click(root, 'Next puzzle');
  // During the run the row under the board shows the run so far plus the
  // puzzle in play, as the trainer's chip row; the left card has none.
  expect(root.querySelector('.puzzle-streak-side .puzzle-streak-chip')).toBeNull();
  expect(
    [
      ...root.querySelectorAll(
        '.puzzle-board-panel > .puzzle-session-chips.puzzle-streak-run-chips .puzzle-streak-chip',
      ),
    ].map((c) => c.className),
  ).toEqual([expect.stringContaining('--solved'), expect.stringContaining('--current')]);
  const skip = root.querySelector<HTMLButtonElement>('[data-streak-skip]');
  expect(skip?.className).toBe('puzzle-feedback-skip');
  click(root, 'Skip · 1 left');
  await vi.waitFor(() => expect(root.textContent).toContain('Skip used'));
  expect(
    [...root.querySelectorAll('button')].find((b) => b.textContent === 'Skip used')?.disabled,
  ).toBe(true);
  const wrong = getStandardXiangqiLegalMoves(puzzles[2]!.initial).find(
    (m) => !attemptStandardXiangqiPuzzleLine(puzzles[2]!, [m]).ok,
  )!;
  move(root, wrong);
  await vi.waitFor(() => expect(root.textContent).toContain('Game over'));
  // The run ends on the puzzle page: the failed puzzle stays on the board and
  // its answer is laid out in the move list, the miss marked ✗, the right move ✓.
  const board = root.querySelector<HTMLElement>('.puzzle-board');
  expect(board?.dataset.puzzleId).toBe(puzzles[2]!.id);
  // Game over reveals the failed puzzle's rating.
  expect(info().textContent).toContain('Rating: 1000');
  expect(info().querySelector('a')?.getAttribute('href')).toContain(puzzles[2]!.id);
  expect(root.querySelector('.puzzle-xiangqi-board')).toBeTruthy();
  expect(root.querySelector('.puzzle-move-cell--wrong')?.textContent).toContain('✗');
  expect(root.querySelector('.puzzle-move-variation')).toBeTruthy();
  expect(root.querySelector('.puzzle-move-cell--right')?.textContent).toContain('✓');
  expect(
    root.querySelectorAll('.puzzle-move-list .puzzle-move-item:not(.puzzle-move-variation)').length,
  ).toBeGreaterThan(1);
  expect(root.querySelector('[data-streak-score] strong')?.textContent).toBe('1');
  const chips = [
    ...root.querySelectorAll<HTMLAnchorElement>('.puzzle-streak-over .puzzle-streak-chip'),
  ];
  expect(chips.map((c) => [c.textContent, c.dataset.outcome, c.getAttribute('href')])).toEqual([
    ['1', 'solved', `/puzzles/${puzzles[0]!.id}`],
    ['2', 'skipped', `/puzzles/${puzzles[1]!.id}`],
    ['3', 'failed', `/puzzles/${puzzles[2]!.id}`],
  ]);
  expect(root.querySelector('ol a')).toBeNull();
  const newStreak = root.querySelector<HTMLButtonElement>('.puzzle-streak-over [data-puzzle-next]');
  expect(newStreak?.textContent).toBe('New streak');
  expect(document.activeElement).toBe(newStreak);
  // The answer plays out under Game over, one re-render per move; focus stays
  // on New streak through every rebuild instead of dropping to <body>.
  await vi.waitFor(
    () => {
      const rows = root.querySelectorAll('.puzzle-move-item:not(.puzzle-move-variation)');
      expect(rows[rows.length - 1]?.querySelector('.puzzle-move-cell--active')).toBeTruthy();
    },
    { timeout: 4000 },
  );
  expect(document.activeElement?.textContent).toBe('New streak');
  expect(document.activeElement).not.toBe(newStreak);
  expect(
    root.querySelector('.puzzle-streak-over .puzzle-streak-practice')?.getAttribute('href'),
  ).toBe('/puzzles');
  expect(track).toHaveBeenCalledWith(
    'puzzle_mode_started',
    expect.objectContaining({ mode: 'streak' }),
  );
  expect(track).toHaveBeenCalledWith(
    'puzzle_attempted',
    expect.objectContaining({ mode: 'streak', outcome: 'solved' }),
  );
  expect(track).toHaveBeenCalledWith(
    'puzzle_attempted',
    expect.objectContaining({ mode: 'streak', outcome: 'skipped' }),
  );
  expect(track).toHaveBeenCalledWith(
    'puzzle_attempted',
    expect.objectContaining({ mode: 'streak', outcome: 'failed' }),
  );
  expect(track).toHaveBeenCalledWith(
    'puzzle_mode_finished',
    expect.objectContaining({ mode: 'streak', run_length: 1 }),
  );
  click(root, 'New streak');
  await vi.waitFor(() => expect(root.querySelector('.puzzle-streak-over')).toBeNull());
  // The new run is told which puzzles this browser met, to draw others.
  expect(actions(fetchSpy).at(-1)).toEqual({
    action: 'start',
    recent: puzzles.slice(0, 3).map((p) => p.id),
  });
  expect(info().textContent).toContain('Rating: hidden');
  expect(root.querySelector<HTMLElement>('.puzzle-board')?.dataset.puzzleId).toBe(puzzles[0]!.id);
  expect(root.querySelector('.puzzle-streak-count strong')?.textContent).toBe('0');
  expect(root.textContent).toContain('Skip · 1 left');
  expect(root.querySelector('.puzzle-move-cell--wrong')).toBeNull();
});

it('says New best when the run beats the best it started from, and asks a guest to sign in', async () => {
  const puzzle = puzzles[0]!;
  let best: number | null = 0;
  let moves: XiangqiMove[] = [];
  let score = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url).includes('/quality')) return json({});
      const body = JSON.parse(String(init?.body));
      if (body.action === 'start') {
        moves = [];
        score = 0;
        return json({
          runId: 'run',
          score,
          best,
          skipUsed: false,
          finished: false,
          results: [],
          puzzle: detail(puzzle),
        });
      }
      moves.push(body.move);
      const attempt = attemptStandardXiangqiPuzzleLine(puzzle, moves);
      if (attempt.ok && attempt.complete) score++;
      const finished = !attempt.ok || attempt.complete;
      return json({
        runId: 'run',
        score,
        best: best === null ? null : Math.max(best, score),
        skipUsed: false,
        finished,
        results: finished ? [{ id: puzzle.id, outcome: attempt.ok ? 'solved' : 'failed' }] : [],
        puzzle: finished ? null : detail(puzzle),
        attempt,
      });
    }),
  );
  const root = document.createElement('div');
  document.body.append(root);
  await mountPuzzles(root);
  await vi.waitFor(() =>
    expect(root.querySelector<HTMLElement>('.puzzle-board')?.dataset.puzzleId).toBe(puzzle.id),
  );
  for (const m of puzzle.solution.filter((_, i) => i % 2 === 0)) {
    move(root, m);
    await vi.waitFor(() =>
      expect(
        root.querySelector('.puzzle-streak-feedback')?.getAttribute('aria-busy') ?? 'false',
      ).toBe('false'),
    );
  }
  await vi.waitFor(() => expect(root.textContent).toContain('Game over'));
  expect(root.querySelector('.puzzle-streak-new-best')?.textContent).toBe('New best!');

  best = null;
  click(root, 'New streak');
  await vi.waitFor(() => expect(root.querySelector('.puzzle-streak-over')).toBeNull());
  const signIn = root.querySelector<HTMLAnchorElement>('.puzzle-streak-side .puzzle-streak-signin');
  expect(signIn?.textContent).toBe('Sign in to save your best');
  expect(signIn?.getAttribute('href')).toContain('/account');
  // The phone's prompt row carries a short sign-in beside the count.
  const short = root.querySelector<HTMLAnchorElement>(
    '.puzzle-streak-feedback .puzzle-streak-tally .puzzle-streak-signin',
  );
  expect(short?.textContent).toBe('Sign in to save');
  expect(short?.title).toBe('Sign in to save your best');
  expect(root.textContent).not.toContain('Guest');
});

function startedRun(puzzle: XiangqiPuzzle, runId = 'run') {
  return json({
    runId,
    score: 0,
    best: 2,
    skipUsed: false,
    finished: false,
    results: [],
    puzzle: detail(puzzle),
  });
}
function actions(spy: ReturnType<typeof vi.fn>) {
  return spy.mock.calls
    .filter(([url]) => String(url) === '/api/puzzles/streak')
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)));
}
async function mount() {
  const root = document.createElement('div');
  document.body.append(root);
  await mountPuzzles(root);
  return root;
}

it('shows a failed start and allows retrying without a phantom mode-start event', async () => {
  let fail = true;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => (fail ? json({}, 503) : startedRun(puzzles[0]!))),
  );
  const root = await mount();
  await vi.waitFor(() => expect(root.querySelector('[role="alert"]')).toBeTruthy());
  expect(track).not.toHaveBeenCalledWith('puzzle_mode_started', expect.anything());
  const retry = [...root.querySelectorAll('button')].find((b) => b.textContent === 'New streak');
  expect(retry?.disabled).toBe(false);
  fail = false;
  retry!.click();
  await vi.waitFor(() =>
    expect(root.querySelector<HTMLElement>('.puzzle-board')?.dataset.puzzleId).toBe(puzzles[0]!.id),
  );
  expect(root.querySelector('[role="alert"]')).toBeNull();
  expect(track).toHaveBeenCalledWith(
    'puzzle_mode_started',
    expect.objectContaining({ mode: 'streak' }),
  );
});

it('resumes the open run on a reload instead of starting a second one', async () => {
  const fetchSpy = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    return startedRun(puzzles[0]!, body.action === 'resume' ? body.runId : 'run-1');
  });
  vi.stubGlobal('fetch', fetchSpy);
  await mount();
  await vi.waitFor(() => expect(actions(fetchSpy)).toEqual([{ action: 'start' }]));
  await vi.waitFor(() =>
    expect(document.querySelector<HTMLElement>('.puzzle-board')?.dataset.puzzleId).toBe(
      puzzles[0]!.id,
    ),
  );
  // The reload: a fresh document mounts the same tab's page again.
  document.body.replaceChildren();
  vi.mocked(track).mockClear();
  const root = await mount();
  await vi.waitFor(() =>
    expect(actions(fetchSpy)).toEqual([{ action: 'start' }, { action: 'resume', runId: 'run-1' }]),
  );
  await vi.waitFor(() =>
    expect(root.querySelector<HTMLElement>('.puzzle-board')?.dataset.puzzleId).toBe(puzzles[0]!.id),
  );
  expect(track).not.toHaveBeenCalledWith('puzzle_mode_started', expect.anything());
});

it('starts a new run when the remembered one has ended or is gone', async () => {
  window.sessionStorage.setItem(
    'mistboard:puzzles:streak-run',
    JSON.stringify({ runId: 'old', bestAtStart: 1 }),
  );
  const fetchSpy = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) =>
    JSON.parse(String(init?.body)).action === 'resume'
      ? json({ error: 'streak_action_unavailable' }, 409)
      : startedRun(puzzles[1]!, 'new'),
  );
  vi.stubGlobal('fetch', fetchSpy);
  const root = await mount();
  await vi.waitFor(() =>
    expect(root.querySelector<HTMLElement>('.puzzle-board')?.dataset.puzzleId).toBe(puzzles[1]!.id),
  );
  expect(actions(fetchSpy)).toEqual([{ action: 'resume', runId: 'old' }, { action: 'start' }]);
  expect(JSON.parse(window.sessionStorage.getItem('mistboard:puzzles:streak-run')!).runId).toBe(
    'new',
  );
});

it('does not create a run while the page is prerendered or hidden', async () => {
  const fetchSpy = vi.fn(async () => startedRun(puzzles[0]!));
  vi.stubGlobal('fetch', fetchSpy);
  Object.defineProperty(document, 'prerendering', { configurable: true, value: true });
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  try {
    const root = await mount();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(actions(fetchSpy)).toEqual([]);
    expect(root.querySelector('.puzzle-streak-side h1')?.textContent).toBe('Puzzle Streak');
    Object.defineProperty(document, 'prerendering', { configurable: true, value: false });
    document.dispatchEvent(new Event('prerenderingchange'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    // Activated, but still a background tab.
    expect(actions(fetchSpy)).toEqual([]);
    visibility.mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.waitFor(() =>
      expect(root.querySelector<HTMLElement>('.puzzle-board')?.dataset.puzzleId).toBe(
        puzzles[0]!.id,
      ),
    );
    expect(actions(fetchSpy)).toEqual([{ action: 'start' }]);
  } finally {
    delete (document as { prerendering?: boolean }).prerendering;
  }
});
