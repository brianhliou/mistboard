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
    });
  });
  vi.stubGlobal('fetch', fetchSpy);
  const root = document.createElement('div');
  document.body.append(root);
  await mountPuzzles(root);
  expect(fetchSpy).not.toHaveBeenCalled();
  click(root, 'Start streak');
  await vi.waitFor(() => expect(root.querySelector('.puzzle-xiangqi-board')).toBeTruthy());
  expect(root.querySelector('[data-puzzle-hint]')).toBeNull();
  expect(root.querySelector('[data-puzzle-reveal]')).toBeNull();
  expect(root.querySelector('.engine-panel')).toBeNull();
  expect(root.textContent).toContain('Best: 4');
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
  await vi.waitFor(() => expect(root.textContent).toContain('Streak: 1'));
  click(root, 'Next puzzle');
  click(root, 'Skip (1 left)');
  await vi.waitFor(() => expect(root.textContent).toContain('Skip used'));
  expect(
    [...root.querySelectorAll('button')].find((b) => b.textContent === 'Skip used')?.disabled,
  ).toBe(true);
  const wrong = getStandardXiangqiLegalMoves(puzzles[2]!.initial).find(
    (m) => !attemptStandardXiangqiPuzzleLine(puzzles[2]!, [m]).ok,
  )!;
  move(root, wrong);
  await vi.waitFor(() => expect(root.textContent).toContain('Streak finished'));
  expect(root.querySelector('[data-streak-score]')?.textContent).toContain('Solved: 1');
  expect(root.querySelectorAll('ol a')).toHaveLength(3);
  expect([...root.querySelectorAll('ol a')].map((a) => a.textContent)).toEqual([
    expect.stringContaining('solved'),
    expect.stringContaining('skipped'),
    expect.stringContaining('failed'),
  ]);
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
  click(root, 'Play again');
  await vi.waitFor(() => expect(root.querySelector('.puzzle-xiangqi-board')).toBeTruthy());
  expect(root.textContent).toContain('Streak: 0');
  expect(root.textContent).toContain('Skip (1 left)');
});

it('shows a failed start and allows retrying without a phantom mode-start event', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => json({}, 503)),
  );
  const root = document.createElement('div');
  document.body.append(root);
  await mountPuzzles(root);
  click(root, 'Start streak');
  await vi.waitFor(() => expect(root.querySelector('[role="alert"]')).toBeTruthy());
  expect(root.querySelector('button')!.disabled).toBe(false);
  expect(track).not.toHaveBeenCalledWith('puzzle_mode_started', expect.anything());
});
