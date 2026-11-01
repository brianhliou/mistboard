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

vi.mock('../live-sound.js', () => ({ initLiveSound: vi.fn(), playSound: vi.fn() }));
vi.mock('../analytics.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../analytics.js')>()),
  track: vi.fn(),
}));
const auth = vi.hoisted(() => ({ user: null as { id: string } | null }));
vi.mock('../account-nav.js', () => ({ loadCachedCurrentUser: async () => auth.user }));

const puzzles = XIANGQI_PUZZLES.filter((p) => p.solution.length === 3).slice(0, 4);
const storageKey = 'mistboard:puzzles:storm-run';
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
  return new Response(JSON.stringify(body), { status });
}

// The HTTP double grades real corpus moves. The UI cannot infer a verdict,
// bonus, deadline or next puzzle from the move it just sent.
function server(options: { combo?: number; remaining?: number; partial?: boolean } = {}) {
  let index = 0;
  let score = 0;
  let combo = options.combo ?? 0;
  let version = 4;
  let moves: XiangqiMove[] = options.partial ? [puzzles[0]!.solution[0]!] : [];
  let deadline = Date.now() + (options.remaining ?? 180_000);
  let loseMoveResponse = false;
  let failStart = false;
  let failResume: number | 'network' | null = null;
  let delayMove = 0;
  const results: { id: string; outcome: 'solved' | 'failed' }[] = [];
  const snapshot = () => ({
    runId: 'run',
    version,
    score,
    combo,
    best: 8,
    dailyBest: 3,
    remainingMs: Math.max(0, deadline - Date.now()),
    deadlineAt: deadline,
    startedAt: Date.now() - 1000,
    day: '2026-10-31',
    finished: Date.now() >= deadline || index >= puzzles.length,
    results,
    puzzle: index < puzzles.length ? detail(puzzles[index]!) : null,
    upcoming: puzzles.slice(index + 1, index + 3).map(detail),
    progress: moves.length ? attemptStandardXiangqiPuzzleLine(puzzles[index]!, moves) : null,
  });
  const fetchSpy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/quality')) return json({});
    if (url !== '/api/puzzles/storm') {
      const p = puzzles.find((p) => url === `/api/puzzles/${p.id}`);
      if (p) return json({ puzzle: detail(p) });
      const review = puzzles.find((p) => url === `/api/puzzles/${p.id}/attempt`);
      if (review) {
        expect(JSON.parse(String(init?.body)).rated).toBe(false);
        return json({
          attempt: attemptStandardXiangqiPuzzleLine(review, JSON.parse(String(init?.body)).moves),
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    }
    const body = JSON.parse(String(init?.body));
    if (body.action === 'start' && failStart) return json({}, 503);
    if (body.action === 'resume' && failResume) {
      if (failResume === 'network') throw new TypeError('Offline');
      return json({}, failResume);
    }
    let attempt: ReturnType<typeof attemptStandardXiangqiPuzzleLine> | undefined;
    if (body.action === 'move') {
      expect(body).toMatchObject({ runId: 'run', version, puzzleId: puzzles[index]!.id });
      expect(Date.now()).toBeLessThan(deadline);
      moves.push(body.move);
      attempt = attemptStandardXiangqiPuzzleLine(puzzles[index]!, moves);
      version++;
      if (attempt.ok) {
        combo++;
        if (combo === 5) deadline += 3000;
        if (combo === 12) deadline += 5000;
        if (combo === 20) deadline += 7000;
        if (combo >= 30 && combo % 10 === 0) deadline += 10_000;
      } else {
        combo = 0;
        deadline -= 10_000;
      }
      if (!attempt.ok || attempt.complete) {
        const outcome = attempt.ok ? 'solved' : 'failed';
        results.push({ id: puzzles[index]!.id, outcome });
        if (attempt.ok) score++;
        moves = [];
        index++;
      }
      if (loseMoveResponse) {
        loseMoveResponse = false;
        throw new TypeError('Connection lost after commit');
      }
    }
    const response = json({ ...snapshot(), ...(attempt ? { attempt } : {}) });
    if (body.action === 'move' && delayMove) {
      await new Promise((resolve) => window.setTimeout(resolve, delayMove));
      delayMove = 0;
    }
    return response;
  });
  vi.stubGlobal('fetch', fetchSpy);
  return {
    fetchSpy,
    loseNextMove: () => {
      loseMoveResponse = true;
    },
    failStart: (value: boolean) => {
      failStart = value;
    },
    failResume: (value: boolean, status: number | 'network' = 503) => {
      failResume = value ? status : null;
    },
    delayNextMove: (ms: number) => {
      delayMove = ms;
    },
  };
}
const boardId = (root: HTMLElement) =>
  root.querySelector<HTMLElement>('.puzzle-board')?.dataset.puzzleId;
async function open() {
  const root = document.createElement('div');
  document.body.append(root);
  await mountPuzzles(root);
  return root;
}
async function move(root: HTMLElement, m: XiangqiMove) {
  for (const square of [m.from, m.to]) {
    const target = root.querySelector(`[data-square="${square}"]`);
    expect(target).toBeTruthy();
    target!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  }
  await vi.waitFor(() => expect(root.querySelector('[aria-busy="true"]')).toBeNull());
}
function click(root: HTMLElement, label: string) {
  const button = [...root.querySelectorAll('button')].find((b) => b.textContent === label);
  expect(button, label).toBeTruthy();
  button!.click();
}
beforeEach(() => {
  auth.user = null;
  vi.mocked(track).mockClear();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-31T12:00:00Z'));
  const values = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
  });
  window.localStorage.setItem(
    displayPreferenceStorageKey,
    JSON.stringify({ pieceAnimation: 'none' }),
  );
  window.sessionStorage.clear();
  window.history.replaceState(null, '', '/puzzles?mode=storm');
});
afterEach(() => {
  window.dispatchEvent(new Event('pagehide'));
  document.body.replaceChildren();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

it('starts Storm, counts down, and moves straight to the next public board after a solve', async () => {
  const { fetchSpy } = server();
  const root = await open();
  await vi.waitFor(() => expect(boardId(root)).toBe(puzzles[0]!.id));
  expect(root.querySelector('[data-storm-clock]')?.textContent).toBe('3:00');
  expect(root.querySelector('[data-storm-score]')?.textContent).toBe('0');
  expect(root.querySelector('[data-puzzle-hint]')).toBeNull();
  expect(root.querySelector('.engine-panel')).toBeNull();
  await vi.advanceTimersByTimeAsync(2000);
  expect(root.querySelector('[data-storm-clock]')?.textContent).toBe('2:58');
  await move(root, puzzles[0]!.solution[0]!);
  expect(root.querySelector<HTMLElement>('.puzzle-board')?.dataset.puzzleLive).toBe('true');
  await move(root, puzzles[0]!.solution[2]!);
  expect(boardId(root)).toBe(puzzles[1]!.id);
  expect(root.querySelector('[data-storm-score]')?.textContent).toBe('1');
  expect(root.querySelector('[data-storm-combo]')?.textContent).toBe('2');
  expect(
    fetchSpy.mock.calls.every(
      ([url]) => String(url) === '/api/puzzles/storm' || String(url).endsWith('/quality'),
    ),
  ).toBe(true);
});

it.each([
  [4, '+3s'],
  [11, '+5s'],
  [19, '+7s'],
  [29, '+10s'],
  [39, '+10s'],
])('shows the server bonus at combo %i', async (combo, bonus) => {
  server({ combo });
  const root = await open();
  await vi.waitFor(() => expect(boardId(root)).toBe(puzzles[0]!.id));
  await move(root, puzzles[0]!.solution[0]!);
  expect(root.querySelector('[data-storm-change]')?.textContent).toBe(bonus);
  expect(root.querySelector('[data-storm-combo]')?.textContent).toBe(String(combo + 1));
});

it('penalizes a miss and resets combo while transitioning immediately', async () => {
  server({ combo: 4 });
  const root = await open();
  await vi.waitFor(() => expect(boardId(root)).toBe(puzzles[0]!.id));
  const wrong = getStandardXiangqiLegalMoves(puzzles[0]!.initial).find((m) => {
    const attempt = attemptStandardXiangqiPuzzleLine(puzzles[0]!, [m]);
    return !attempt.ok && attempt.code === 'incorrect-move';
  })!;
  await move(root, wrong);
  expect(boardId(root)).toBe(puzzles[1]!.id);
  expect(root.querySelector('[data-storm-change]')?.textContent).toBe('−10s');
  expect(root.querySelector('[data-storm-combo]')?.textContent).toBe('0');
  expect(root.querySelector('[data-storm-score]')?.textContent).toBe('0');
});

it('resumes accepted partial progress and never resubmits its first move', async () => {
  window.sessionStorage.setItem(
    storageKey,
    JSON.stringify({ runId: 'run', owner: null, finished: false }),
  );
  const { fetchSpy } = server({ partial: true, combo: 1, remaining: 70_000 });
  const root = await open();
  await vi.waitFor(() => expect(boardId(root)).toBe(puzzles[0]!.id));
  expect(root.querySelector('[data-storm-clock]')?.textContent).toBe('1:10');
  await move(root, puzzles[0]!.solution[2]!);
  expect(boardId(root)).toBe(puzzles[1]!.id);
  const actions = fetchSpy.mock.calls
    .filter(([url]) => url === '/api/puzzles/storm')
    .map(([, init]) => JSON.parse(String(init?.body)));
  expect(actions.map((a) => a.action)).toEqual(['resume', 'move']);
  expect(actions[1].move).toEqual(puzzles[0]!.solution[2]);
});

it('recovers an ambiguous move response by resuming the accepted position', async () => {
  const api = server();
  const root = await open();
  await vi.waitFor(() => expect(boardId(root)).toBe(puzzles[0]!.id));
  api.loseNextMove();
  await move(root, puzzles[0]!.solution[0]!);
  expect(root.querySelector('[role="alert"]')).not.toBeNull();
  click(root, 'Resume Storm');
  await vi.waitFor(() => expect(root.querySelector('[role="alert"]')).toBeNull());
  await move(root, puzzles[0]!.solution[2]!);
  expect(boardId(root)).toBe(puzzles[1]!.id);
  expect(root.querySelector('[data-storm-combo]')?.textContent).toBe('2');
});

it('expires without another move, keeps results, and opens an unrated review', async () => {
  const { fetchSpy } = server({ remaining: 10_000 });
  const root = await open();
  await vi.waitFor(() => expect(boardId(root)).toBe(puzzles[0]!.id));
  await move(root, puzzles[0]!.solution[0]!);
  await move(root, puzzles[0]!.solution[2]!);
  await vi.advanceTimersByTimeAsync(11_000);
  await vi.waitFor(() => expect(root.querySelector('[data-storm-results]')).not.toBeNull());
  expect(root.querySelector('[data-storm-clock]')?.textContent).toBe('0:00');
  expect(JSON.parse(window.sessionStorage.getItem(storageKey)!)).toEqual({
    runId: 'run',
    owner: null,
    finished: true,
  });
  const chip = root.querySelector<HTMLAnchorElement>('.puzzle-streak-chip--solved')!;
  expect(chip.href).toContain('mode=storm&review=');
  chip.click();
  await vi.waitFor(() => expect(boardId(root)).toBe(puzzles[0]!.id));
  expect(root.textContent).toContain('Unrated review');
  await move(root, puzzles[0]!.solution[0]!);
  expect(fetchSpy.mock.calls.some(([url]) => String(url).endsWith('/attempt'))).toBe(true);
  click(root, 'Back to results');
  expect(root.querySelector('[data-storm-results]')).not.toBeNull();
});

it.each([null, 'account-a'])(
  'restores the same results and review chips for owner %s until New Storm is pressed',
  async (owner) => {
    auth.user = owner ? { id: owner } : null;
    const { fetchSpy } = server({ remaining: 10_000 });
    const root = await open();
    await vi.waitFor(() => expect(boardId(root)).toBe(puzzles[0]!.id));
    await move(root, puzzles[0]!.solution[0]!);
    await move(root, puzzles[0]!.solution[2]!);
    await vi.advanceTimersByTimeAsync(11_000);
    await vi.waitFor(() => expect(root.querySelector('[data-storm-results]')).not.toBeNull());
    const results = root.querySelector('[data-storm-results]')!.textContent;
    const chipHref = root.querySelector<HTMLAnchorElement>('.puzzle-streak-chip--solved')!.href;

    window.dispatchEvent(new Event('pagehide'));
    root.remove();
    const reloaded = await open();
    await vi.waitFor(() => expect(reloaded.querySelector('[data-storm-results]')).not.toBeNull());
    expect(reloaded.querySelector('[data-storm-results]')!.textContent).toBe(results);
    expect(reloaded.querySelector<HTMLAnchorElement>('.puzzle-streak-chip--solved')!.href).toBe(
      chipHref,
    );
    const actions = () =>
      fetchSpy.mock.calls
        .filter(([url]) => url === '/api/puzzles/storm')
        .map(([, init]) => JSON.parse(String(init?.body)).action);
    expect(actions()).toEqual(['start', 'move', 'move', 'resume', 'resume']);
    click(reloaded, 'New Storm');
    await vi.waitFor(() => expect(actions().at(-1)).toBe('start'));
  },
);

it.each([
  [null, 'account-a'],
  ['account-a', null],
  ['account-a', 'account-b'],
])('drops a finished run when its owner changes from %s to %s', async (from, to) => {
  auth.user = from ? { id: from } : null;
  const api = server({ remaining: 1000 });
  const root = await open();
  await vi.waitFor(() => expect(boardId(root)).toBe(puzzles[0]!.id));
  await vi.advanceTimersByTimeAsync(1100);
  await vi.waitFor(() => expect(root.querySelector('[data-storm-results]')).not.toBeNull());

  window.dispatchEvent(new Event('pagehide'));
  root.remove();
  auth.user = to ? { id: to } : null;
  api.failResume(true, 404);
  api.fetchSpy.mockClear();
  const reloaded = await open();
  await vi.waitFor(() => expect(api.fetchSpy).toHaveBeenCalled());
  expect(reloaded.querySelector('[role="alert"]')).toBeNull();
  const actions = api.fetchSpy.mock.calls
    .filter(([url]) => url === '/api/puzzles/storm')
    .map(([, init]) => JSON.parse(String(init?.body)).action);
  expect(actions).not.toContain('resume');
  expect(JSON.parse(window.sessionStorage.getItem(storageKey)!).owner).toBe(to);
});

it('clears a missing finished run silently and waits for New Storm', async () => {
  window.sessionStorage.setItem(
    storageKey,
    JSON.stringify({ runId: 'run', owner: null, finished: true }),
  );
  const api = server();
  api.failResume(true, 404);
  const root = await open();
  await vi.waitFor(() => expect(window.sessionStorage.getItem(storageKey)).toBeNull());
  expect(root.querySelector('[role="alert"]')).toBeNull();
  expect(root.querySelector('[data-storm-results]')).toBeNull();
  expect(api.fetchSpy).toHaveBeenCalledTimes(1);
  click(root, 'New Storm');
  await vi.waitFor(() => expect(boardId(root)).toBe(puzzles[0]!.id));
});

it('emits one completion on the live transition and none on review or results reload', async () => {
  server({ remaining: 1000 });
  const root = await open();
  await vi.waitFor(() => expect(boardId(root)).toBe(puzzles[0]!.id));
  await vi.advanceTimersByTimeAsync(1100);
  await vi.waitFor(() => expect(root.querySelector('[data-storm-results]')).not.toBeNull());
  const completions = () =>
    vi
      .mocked(track)
      .mock.calls.filter(
        ([event, props]) => event === 'puzzle_mode_finished' && props?.reason === 'completed',
      );
  expect(completions()).toHaveLength(1);

  window.dispatchEvent(new Event('pagehide'));
  root.remove();
  window.history.replaceState(null, '', `/puzzles?mode=storm&review=${puzzles[0]!.id}`);
  const reloaded = await open();
  await vi.waitFor(() => expect(boardId(reloaded)).toBe(puzzles[0]!.id));
  expect(reloaded.textContent).toContain('Unrated review');
  click(reloaded, 'Back to results');
  expect(reloaded.querySelector('[data-storm-results]')).not.toBeNull();
  expect(completions()).toHaveLength(1);
});

it.each([
  { state: 'saved', status: 404 },
  { state: 'saved', status: 503 },
  { state: 'saved', status: 403 },
  { state: 'saved', status: 'network' },
  { state: 'loaded', status: 404 },
  { state: 'loaded', status: 503 },
  { state: 'loaded', status: 403 },
  { state: 'loaded', status: 'network' },
] as const)(
  'opens a pending unrated review when a $state run resumes with $status',
  async ({ state, status }) => {
    window.sessionStorage.setItem(
      storageKey,
      JSON.stringify({ runId: 'run', owner: null, finished: false }),
    );
    window.history.replaceState(null, '', `/puzzles?mode=storm&review=${puzzles[2]!.id}`);
    const api = server({ remaining: 1000 });
    if (state === 'saved') api.failResume(true, status);
    const root = await open();
    if (state === 'loaded') {
      await vi.waitFor(() => expect(boardId(root)).toBe(puzzles[0]!.id));
      api.failResume(true, status);
      await vi.advanceTimersByTimeAsync(1100);
    }
    await vi.waitFor(() => expect(boardId(root)).toBe(puzzles[2]!.id));
    expect(root.textContent).toContain('Unrated review');
    expect(root.querySelector('[role="alert"]')).toBeNull();
    await move(root, puzzles[2]!.solution[0]!);
    expect(api.fetchSpy.mock.calls.some(([url]) => String(url).endsWith('/attempt'))).toBe(true);
    expect(api.fetchSpy.mock.calls.filter(([url]) => url === '/api/puzzles/storm')).toHaveLength(
      state === 'saved' ? 1 : 2,
    );
    expect(window.sessionStorage.getItem(storageKey) !== null).toBe(status !== 404);
  },
);

it('resumes a live run before opening a review link and opens it after the run ends', async () => {
  window.sessionStorage.setItem(
    storageKey,
    JSON.stringify({ runId: 'run', owner: null, finished: false }),
  );
  window.history.replaceState(null, '', `/puzzles?mode=storm&review=${puzzles[2]!.id}`);
  const { fetchSpy } = server({ partial: true, combo: 1, remaining: 1000 });
  const root = await open();
  await vi.waitFor(() => expect(boardId(root)).toBe(puzzles[0]!.id));
  expect(root.querySelector('[data-storm-clock]')?.textContent).toBe('0:01');
  expect(root.textContent).not.toContain('Unrated review');
  expect(fetchSpy.mock.calls.some(([url]) => url === `/api/puzzles/${puzzles[2]!.id}`)).toBe(false);
  await move(root, puzzles[0]!.solution[2]!);
  await vi.advanceTimersByTimeAsync(1100);
  await vi.waitFor(() => expect(boardId(root)).toBe(puzzles[2]!.id));
  expect(root.textContent).toContain('Unrated review');
  expect(
    fetchSpy.mock.calls
      .filter(([url]) => url === '/api/puzzles/storm')
      .map(([, init]) => JSON.parse(String(init?.body)).action),
  ).toEqual(['resume', 'move', 'resume']);
  click(root, 'Back to results');
  expect(root.querySelector('[data-storm-score]')?.textContent).toBe('1');
});

it.each(['saved', 'loaded'])('offers New Storm when a %s run returns 404', async (state) => {
  window.sessionStorage.setItem(
    storageKey,
    JSON.stringify({ runId: 'run', owner: null, finished: false }),
  );
  const api = server();
  if (state === 'saved') api.failResume(true, 404);
  const root = await open();
  if (state === 'loaded') {
    await vi.waitFor(() => expect(boardId(root)).toBe(puzzles[0]!.id));
    api.loseNextMove();
    await move(root, puzzles[0]!.solution[0]!);
    api.failResume(true, 404);
    click(root, 'Resume Storm');
  }
  await vi.waitFor(() =>
    expect([...root.querySelectorAll('button')].some((b) => b.textContent === 'New Storm')).toBe(
      true,
    ),
  );
  expect(root.querySelector('[role="alert"]')).not.toBeNull();
  expect(window.sessionStorage.getItem(storageKey)).toBeNull();
  expect(root.textContent).not.toContain('Resume Storm');
  const actions = () =>
    api.fetchSpy.mock.calls
      .filter(([url]) => url === '/api/puzzles/storm')
      .map(([, init]) => JSON.parse(String(init?.body)).action);
  expect(actions()).not.toContain('start');
  api.failResume(false);
  click(root, 'New Storm');
  await vi.waitFor(() => expect(root.querySelector('[role="alert"]')).toBeNull());
  expect(actions().at(-1)).toBe('start');
  expect(boardId(root)).toBe(puzzles[0]!.id);
});

it('offers a retry when starting fails', async () => {
  const api = server();
  api.failStart(true);
  const root = await open();
  await vi.waitFor(() => expect(root.querySelector('[role="alert"]')).not.toBeNull());
  api.failStart(false);
  click(root, 'New Storm');
  await vi.waitFor(() => expect(boardId(root)).toBe(puzzles[0]!.id));
});

it('keeps a saved run through a network failure on resume', async () => {
  window.sessionStorage.setItem(
    storageKey,
    JSON.stringify({ runId: 'run', owner: null, finished: false }),
  );
  const api = server({ partial: true });
  api.failResume(true);
  const root = await open();
  await vi.waitFor(() => expect(root.querySelector('[role="alert"]')).not.toBeNull());
  expect(window.sessionStorage.getItem(storageKey)).toContain('run');
  api.failResume(false);
  click(root, 'Resume Storm');
  await vi.waitFor(() => expect(boardId(root)).toBe(puzzles[0]!.id));
  expect(
    api.fetchSpy.mock.calls
      .filter(([url]) => url === '/api/puzzles/storm')
      .map(([, init]) => JSON.parse(String(init?.body)).action),
  ).toEqual(['resume', 'resume']);
});

it('shows an expired saved run without silently starting another', async () => {
  window.sessionStorage.setItem(
    storageKey,
    JSON.stringify({ runId: 'run', owner: null, finished: false }),
  );
  const { fetchSpy } = server({ remaining: 0 });
  const root = await open();
  await vi.waitFor(() => expect(root.querySelector('[data-storm-results]')).not.toBeNull());
  expect(fetchSpy).toHaveBeenCalledTimes(1);
  expect(JSON.parse(String(fetchSpy.mock.calls[0]![1]?.body)).action).toBe('resume');
  expect(track).not.toHaveBeenCalledWith(
    'puzzle_mode_finished',
    expect.objectContaining({ reason: 'completed' }),
  );
});

it('allows an in-flight bonus to settle when the local clock reaches zero', async () => {
  const api = server({ combo: 4, remaining: 1000 });
  const root = await open();
  await vi.waitFor(() => expect(boardId(root)).toBe(puzzles[0]!.id));
  api.delayNextMove(1500);
  for (const square of [puzzles[0]!.solution[0]!.from, puzzles[0]!.solution[0]!.to]) {
    root
      .querySelector(`[data-square="${square}"]`)!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
  }
  await vi.advanceTimersByTimeAsync(1100);
  expect(root.querySelector('[data-storm-clock]')?.textContent).toBe('0:00');
  expect(root.querySelector('[data-storm-results]')).toBeNull();
  await vi.advanceTimersByTimeAsync(500);
  expect(root.querySelector('[data-storm-clock]')?.textContent).toBe('0:03');
  expect(root.querySelector('[data-storm-combo]')?.textContent).toBe('5');
  expect(root.querySelector<HTMLElement>('.puzzle-board')?.dataset.puzzleLive).toBe('true');
});

it('keeps its countdown independent of a device wall-clock change', async () => {
  server();
  const root = await open();
  await vi.waitFor(() => expect(boardId(root)).toBe(puzzles[0]!.id));
  vi.setSystemTime(new Date('2027-01-01T12:00:00Z'));
  await vi.advanceTimersByTimeAsync(2000);
  expect(root.querySelector('[data-storm-clock]')?.textContent).toBe('2:58');
});

it('ignores a delayed start response after leaving the page', async () => {
  const api = server();
  const respond = api.fetchSpy.getMockImplementation()!;
  api.fetchSpy.mockImplementation(async (url, init) => {
    const response = await respond(url, init);
    await new Promise((resolve) => window.setTimeout(resolve, 1000));
    return response;
  });
  const root = await open();
  window.dispatchEvent(new Event('pagehide'));
  await vi.advanceTimersByTimeAsync(1100);
  expect(boardId(root)).toBeUndefined();
  expect(window.sessionStorage.getItem(storageKey)).toBeNull();
});
