import { existsSync, readFileSync } from 'node:fs';
import {
  applyStandardXiangqiMove,
  attemptStandardXiangqiPuzzleLine,
  createInitialXiangqiState,
  detectXiangqiPuzzleMotifs,
  getStandardXiangqiLegalMoves,
  puzzleShortCode,
  standardXiangqiEngineFen,
  standardXiangqiPuzzleMoveEquals,
  XIANGQI_MOTIF_BY_ID,
  XIANGQI_MOTIFS,
  XIANGQI_PUZZLES,
  XIANGQI_SPEC_ID,
  type XiangqiMove,
  type XiangqiPuzzle,
  type XiangqiPuzzleSetupMove,
  xiangqiPuzzlePreSetupState,
} from '@mistboard/game';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setPostHogInstance } from './analytics.js';
import { displayPreferenceStorageKey } from './display-preferences.js';
import { LOCALE_STORAGE_KEY } from './i18n/locale.js';
import { playSound } from './live-sound.js';
import type { PuzzleMove } from './puzzles/adapter.js';
import type { PuzzleAttempt } from './puzzles/api.js';
import { mountPuzzleHistory, puzzleHistorySessions, puzzleHistoryTime } from './puzzles/history.js';
import { puzzlePhoneMenuRows } from './puzzles/phone-menu.js';
import { playerWithoutTeam } from './puzzles/queue-panel.js';
import { loadPuzzleTheme, PUZZLE_THEME_MIN_PATTERN_COUNT } from './puzzles/themes.js';
import {
  mountPuzzleSolver,
  mountPuzzles,
  puzzleMoveRowNumber,
  renderPuzzlesShellForPrerender,
  resetPuzzleReloadCheckForTest,
  sourceGameLines,
} from './puzzles.js';
import { xiangqiAppearanceChangedEvent } from './theme.js';
import { writeStoredXiangqiPieceSet } from './xiangqi-appearance-storage.js';
import { pinXiangqiNotation } from './xiangqi-notation.js';

vi.mock('./live-sound.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./live-sound.js')>();
  return { ...actual, playSound: vi.fn() };
});

function publicSummary(puzzle: XiangqiPuzzle) {
  return {
    id: puzzle.id,
    variant: puzzle.variant,
    title: puzzle.title,
    sideToMove: puzzle.initial.status.type === 'playing' ? puzzle.initial.status.turn : null,
    goal: puzzle.goal,
    themes: puzzle.themes,
    motifs: puzzle.variant === XIANGQI_SPEC_ID ? detectXiangqiPuzzleMotifs(puzzle) : [],
    solutionPlyCount: puzzle.solution.length,
    rating: 1500,
    ratingProvisional: true,
  };
}

function publicDetail(puzzle: XiangqiPuzzle) {
  return {
    ...publicSummary(puzzle),
    initial: puzzle.initial,
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

// These tests locate cells by from-to text; pin coordinate labels so the
// reader's notation default (algebraic) does not become the subject.
beforeEach(() => pinXiangqiNotation('coordinate'));
afterEach(() => pinXiangqiNotation(null));

// The board goes live only after the page's own pauses (the setup move's intro,
// the opponent's reply), about 0.9s by design, which leaves vitest's 1s default
// no margin on a loaded runner. Wait well past the pauses.
const waitForLiveBoard = (root: HTMLElement): Promise<void> =>
  vi.waitFor(
    () => expect(root.querySelector<HTMLElement>('.puzzle-board')?.dataset.puzzleLive).toBe('true'),
    { timeout: 4000 },
  );

describe('puzzles route', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    document.body.innerHTML = '';
    stubWindowLocalStorage(memoryStorage());
    window.history.replaceState(null, '', '/');
  });

  // Two mined checkmate lines from the served corpus, one per side to move.
  // The player is driven through the real kernel (attemptStandardXiangqiPuzzleLine)
  // rather than fixed fixtures, so these tests read moves off the seed.
  const minedMate = (turn: 'red' | 'black'): XiangqiPuzzle =>
    XIANGQI_PUZZLES.find(
      (puzzle) =>
        puzzle.goal.type === 'checkmate' &&
        puzzle.initial.status.type === 'playing' &&
        puzzle.initial.status.turn === turn &&
        puzzle.solution.length === 3,
    )!;
  const RED_MATE = minedMate('red');
  const BLACK_MATE = minedMate('black');
  const themeOptions = XIANGQI_MOTIFS.map((motif) => ({
    ...motif,
    // Above PUZZLE_THEME_MIN_PATTERN_COUNT, so the picker lists it.
    count: motif.id === 'ma-hou-pao' ? 24 : 0,
    literal: 'cannon behind the horse',
    gloss: 'The horse pens the general in and screens the cannon behind it.',
  }));

  it('replays Dashboard failures oldest first instead of opening puzzle replay', async () => {
    stubWindowLocalStorage(memoryStorage());
    window.history.replaceState(null, '', '/puzzles/replay?days=30');
    const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/puzzles/failed?days=30') {
        return json({
          failures: [
            { puzzleId: BLACK_MATE.id, failedAt: '2026-10-30T12:00:00Z' },
            { puzzleId: RED_MATE.id, failedAt: '2026-10-29T12:00:00Z' },
          ],
        });
      }
      if (url === `/api/puzzles/${RED_MATE.id}`) return json({ puzzle: publicDetail(RED_MATE) });
      if (url.endsWith('/quality')) return new Response(null, { status: 204 });
      return json({ puzzles: [] }, url === '/api/puzzles' ? 200 : 404);
    });
    vi.stubGlobal('fetch', fetchSpy);
    const root = document.createElement('div');
    document.body.append(root);
    await mountPuzzles(root);
    expect(fetchSpy).toHaveBeenCalledWith('/api/puzzles/failed?days=30', {
      credentials: 'same-origin',
    });
    expect(root.querySelector('.puzzle-board')?.getAttribute('data-puzzle-id')).toBe(RED_MATE.id);
    expect(root.querySelector('.puzzle-replay-progress')?.textContent).toBe('Replay: 1 of 2');
    // The left column: back to the Dashboard, the run's title, none of two finished yet.
    const side = root.querySelector<HTMLElement>('.puzzle-replay-side')!;
    expect(side.hidden).toBe(false);
    expect(side.querySelector('a')?.getAttribute('href')).toBe('/puzzles/dashboard?days=30');
    expect(side.querySelector('h2')?.textContent).toBe('Replay failed puzzles');
    expect(side.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('0');
    expect(side.querySelector('.puzzle-replay-side__count')?.textContent).toBe('0 / 2');
    expect(fetchSpy.mock.calls.some(([url]) => String(url) === '/api/puzzles/replay')).toBe(false);
    expect(fetchSpy.mock.calls.some(([url]) => String(url) === '/api/puzzles')).toBe(false);
    expect(window.location.pathname + window.location.search).toBe('/puzzles/replay?days=30');

    const main = readFileSync('src/main.ts', 'utf8');
    const replayBranch = main.indexOf('} else if (wantsPuzzleReplay) {');
    expect(replayBranch).toBeGreaterThan(0);
    expect(replayBranch).toBeLessThan(main.indexOf('} else if (wantsPuzzles) {'));
    expect(main).toContain("const wantsPuzzleReplay = path === '/puzzles/replay'");
  });

  it('solves replay puzzles unrated, advances after a miss plays its solution, and finishes', async () => {
    stubWindowLocalStorage(memoryStorage());
    window.history.replaceState(null, '', '/puzzles/replay?days=7');
    const fetchSpy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/puzzles/failed?days=7')
        return json({
          failures: [
            { puzzleId: RED_MATE.id, failedAt: '2026-10-29T12:00:00Z' },
            { puzzleId: BLACK_MATE.id, failedAt: '2026-10-30T12:00:00Z' },
          ],
        });
      if (url.endsWith('/quality')) return new Response(null, { status: 204 });
      const puzzle = url.includes(RED_MATE.id) ? RED_MATE : BLACK_MATE;
      if (url.endsWith('/attempt'))
        return json({ attempt: attemptStandardXiangqiPuzzleLine(puzzle, movesOf(init)) });
      if (url.endsWith('/reveal')) return json({ solution: puzzle.solution });
      return json({ puzzle: publicDetail(puzzle) });
    });
    vi.stubGlobal('fetch', fetchSpy);
    const root = document.createElement('div');
    document.body.append(root);
    await mountPuzzles(root);
    await solveLine(root, RED_MATE);
    await vi.waitFor(() =>
      expect(root.querySelector('.puzzle-replay-progress')?.textContent).toBe('Replay: 2 of 2'),
    );
    expect(root.querySelector('.puzzle-replay-side__count')?.textContent).toBe('1 / 2');
    const wrong = getStandardXiangqiLegalMoves(BLACK_MATE.initial).find(
      (move) => !standardXiangqiPuzzleMoveEquals(move, BLACK_MATE.solution[0]!),
    )!;
    await clickSquares(root, wrong);
    await vi.waitFor(() => expect(root.querySelector('.puzzle-revealed-panel')).not.toBeNull());
    expect(root.querySelector('.puzzle-board')?.getAttribute('data-puzzle-id')).toBe(BLACK_MATE.id);
    // The wrong visit submits only that miss: autoplay never submits a solve.
    await vi.waitFor(
      () => expect(root.querySelector('.puzzle-replay-summary')?.textContent).toContain('All done'),
      { timeout: 7000 },
    );
    expect(root.querySelector('.puzzle-replay-summary a')?.getAttribute('href')).toBe(
      '/puzzles/dashboard?days=7',
    );
    const attempts = fetchSpy.mock.calls.filter(([url]) => String(url).endsWith('/attempt'));
    expect(attempts).toHaveLength(3);
    for (const [, init] of attempts) {
      expect(JSON.parse(String(init?.body))).toMatchObject({
        rated: false,
        qualitySessionId: expect.any(String),
      });
    }
    const reveals = fetchSpy.mock.calls.filter(([url]) => String(url).endsWith('/reveal'));
    expect(reveals).toHaveLength(1);
    expect(JSON.parse(String(reveals[0]![1]?.body))).toMatchObject({
      rated: false,
      mode: 'solution',
    });
    expect(
      fetchSpy.mock.calls.filter(
        ([url, init]) =>
          String(url).endsWith('/quality') && JSON.parse(String(init?.body)).event === 'view',
      ),
    ).toHaveLength(2);
    expect(window.location.pathname + window.location.search).toBe('/puzzles/replay?days=7');
  });

  it('keeps the replay puzzle when the player steps back before auto-advance fires', async () => {
    stubWindowLocalStorage(memoryStorage());
    window.history.replaceState(null, '', '/puzzles/replay?days=7');
    const fetchSpy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('/api/puzzles/failed'))
        return json({ failures: [{ puzzleId: RED_MATE.id, failedAt: '2026-10-29T12:00:00Z' }] });
      if (url.endsWith('/attempt'))
        return json({ attempt: attemptStandardXiangqiPuzzleLine(RED_MATE, movesOf(init)) });
      if (url.endsWith('/quality')) return new Response(null, { status: 204 });
      return json({ puzzle: publicDetail(RED_MATE) });
    });
    vi.stubGlobal('fetch', fetchSpy);
    const root = document.createElement('div');
    document.body.append(root);
    await mountPuzzles(root);
    await solveLine(root, RED_MATE);
    root.querySelector<HTMLButtonElement>('[data-puzzle-replay-previous]')!.click();
    await new Promise((resolve) => window.setTimeout(resolve, 300));
    expect(root.querySelector('.puzzle-board')?.getAttribute('data-puzzle-id')).toBe(RED_MATE.id);
    expect(root.querySelector('.puzzle-replay-summary')).toBeNull();
    // Returning to the final ply can schedule a fresh advance.
    root.querySelector<HTMLButtonElement>('[data-puzzle-replay-last]')!.click();
    await vi.waitFor(() => expect(root.querySelector('.puzzle-replay-summary')).not.toBeNull());
  });

  const historyEntry = (puzzle: XiangqiPuzzle, createdAt: string, solved = true) => ({
    puzzleId: puzzle.id,
    variant: puzzle.variant,
    solved,
    rated: true,
    ratingBefore: 1500,
    ratingAfter: 1510,
    ratingDelta: 10,
    createdAt,
    fen: standardXiangqiEngineFen(puzzle.initial),
    sideToMove: puzzle.initial.status.type === 'playing' ? puzzle.initial.status.turn : null,
  });

  it('opens Puzzle history before the puzzle-id route and highlights its shared menu', async () => {
    stubWindowLocalStorage(memoryStorage());
    window.history.replaceState(null, '', '/puzzles/history');
    const fetchSpy = vi.fn(async () => json({ attempts: [], nextCursor: null }));
    vi.stubGlobal('fetch', fetchSpy);
    const root = document.createElement('div');
    await mountPuzzleHistory(root);
    expect(root.querySelector('h1')?.textContent).toBe('Puzzle history');
    expect(root.querySelector('.puzzle-menu [aria-current="page"]')?.getAttribute('href')).toBe(
      '/puzzles/history',
    );
    expect(root.querySelector('main a')?.textContent).toBe(
      'Nothing to show, go play some puzzles first!',
    );
    expect(root.querySelector('main a')?.getAttribute('href')).toBe('/puzzles');
    expect(root.querySelector<HTMLButtonElement>('main button')?.hidden).toBe(true);
    expect(fetchSpy).toHaveBeenCalledWith('/api/puzzles/history?order=newest&limit=50', {
      credentials: 'same-origin',
    });
    const source = readFileSync('src/main.ts', 'utf8');
    expect(source).toContain("const wantsPuzzleHistory = path === '/puzzles/history'");
    expect(source).toContain(
      'wantsPuzzleReplay || wantsPuzzleHistory ? null : puzzleIdFromPath(path)',
    );
    const branch = source.indexOf('} else if (wantsPuzzleHistory) {');
    expect(branch).toBeGreaterThan(0);
    expect(branch).toBeLessThan(source.indexOf('} else if (wantsPuzzles) {'));
    expect(source).toContain(
      "import('./puzzles/history.js').then(({ mountPuzzleHistory }) => mountPuzzleHistory(appRoot))",
    );
  });

  it('groups by successive one-hour gaps, including chained sessions lasting over an hour', () => {
    const at = (time: string) => historyEntry(RED_MATE, `2026-10-31T${time}:00Z`);
    expect(
      puzzleHistorySessions([at('17:01'), at('16:00'), at('15:00'), at('14:01')]).map((session) =>
        session.map((entry) => entry.createdAt.slice(11, 16)),
      ),
    ).toEqual([['17:01'], ['14:01', '15:00', '16:00']]);
  });

  it('joins sessions across cursor pages, orders thumbnails as played, and draws each solver side', async () => {
    stubWindowLocalStorage(memoryStorage());
    const recent = historyEntry(BLACK_MATE, '2026-10-31T16:00:00Z', false);
    const earlier = historyEntry(RED_MATE, '2026-10-31T15:15:00Z');
    const old = { ...historyEntry(RED_MATE, '2026-10-30T14:00:00Z'), puzzleId: 'older-puzzle' };
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(json({ attempts: [recent], nextCursor: 'page-one' }))
      .mockResolvedValueOnce(json({ attempts: [earlier, old], nextCursor: null }));
    vi.stubGlobal('fetch', fetchSpy);
    const root = document.createElement('div');
    await mountPuzzleHistory(root);
    root.querySelector<HTMLButtonElement>('main button')!.click();
    await vi.waitFor(() =>
      expect(root.querySelectorAll('.puzzle-history__session')).toHaveLength(2),
    );
    expect(fetchSpy).toHaveBeenLastCalledWith(
      '/api/puzzles/history?order=newest&limit=50&cursor=page-one',
      { credentials: 'same-origin' },
    );
    const sessions = [...root.querySelectorAll('.puzzle-history__session')];
    expect(
      [...sessions[0]!.querySelectorAll('a')].map((link) => link.getAttribute('href')),
    ).toEqual([`/puzzles/${RED_MATE.id}`, `/puzzles/${BLACK_MATE.id}`]);
    expect(
      [...sessions[0]!.querySelectorAll('a > span:last-child')].map((label) => label.textContent),
    ).toEqual(['Solved', 'Incorrect']);
    expect(sessions[0]!.querySelector('time')?.dateTime).toBe(recent.createdAt);
    const boards = sessions[0]!.querySelectorAll('.puzzle-history__board');
    expect(boards[0]!.querySelectorAll('[aria-label$=" general"]')).toHaveLength(2);
    expect(boards[1]!.querySelectorAll('[aria-label$=" general"]')).toHaveLength(2);
    // The bottom general's colour changes with the solver; glyphs stay upright.
    const generalY = (board: Element, color: 'red' | 'black') =>
      Number(board.querySelector(`[aria-label="${color} general"]`)!.getAttribute('y'));
    expect(generalY(boards[0]!, 'red')).toBeGreaterThan(generalY(boards[0]!, 'black'));
    expect(generalY(boards[1]!, 'black')).toBeGreaterThan(generalY(boards[1]!, 'red'));
    // Lichess's short id, shown at the end of the result line on hover.
    expect(
      [...sessions[0]!.querySelectorAll<HTMLElement>('.puzzle-history__result')].map(
        (label) => label.dataset.puzzleCode,
      ),
    ).toEqual([`#${puzzleShortCode(RED_MATE.id)}`, `#${puzzleShortCode(BLACK_MATE.id)}`]);
    expect(root.querySelector<HTMLButtonElement>('main button')!.hidden).toBe(true);
  });

  it("draws history thumbnails in the reader's chosen piece set", async () => {
    const boardFor = async (set: 'traditional' | 'international') => {
      stubWindowLocalStorage(memoryStorage());
      writeStoredXiangqiPieceSet(set);
      vi.stubGlobal(
        'fetch',
        vi.fn(async () =>
          json({ attempts: [historyEntry(RED_MATE, '2026-10-31T16:00:00Z')], nextCursor: null }),
        ),
      );
      const root = document.createElement('div');
      await mountPuzzleHistory(root);
      return root.querySelector('.puzzle-history__board')!;
    };
    const traditional = await boardFor('traditional');
    const international = await boardFor('international');
    const general = (board: Element) =>
      board.querySelector('[aria-label="red general"]')!.outerHTML;
    expect(general(traditional)).not.toBe(general(international));
    // The international set draws picture art; the traditional set draws characters.
    expect(
      international.querySelector('[aria-label="red general"] image')?.getAttribute('href'),
    ).toContain('/piece-sets/xiangqi/international/red-general');
    expect(traditional.querySelector('[aria-label="red general"] image')).toBeNull();
  });

  it.each([
    ['en', 'Puzzle history', 'Incorrect', '1 minute ago', '17 hours ago', '3 days ago'],
    ['zh-Hans', '解题记录', '错误', '1分钟前', '17小时前', '3天前'],
    ['zh-Hant', '解題紀錄', '錯誤', '1 分鐘前', '17 小時前', '3 天前'],
  ])(
    'localizes history and relative times in %s',
    async (locale, title, incorrect, minute, hours, days) => {
      stubWindowLocalStorage(memoryStorage({ [LOCALE_STORAGE_KEY]: locale }));
      const now = Date.parse('2026-10-31T19:00:00Z');
      expect(puzzleHistoryTime(new Date(now - 60_000).toISOString(), now)).toBe(minute);
      expect(puzzleHistoryTime(new Date(now - 17 * 3_600_000).toISOString(), now)).toBe(hours);
      expect(puzzleHistoryTime(new Date(now - 3 * 86_400_000).toISOString(), now)).toBe(days);
      vi.stubGlobal(
        'fetch',
        vi.fn(async () =>
          json({
            attempts: [historyEntry(RED_MATE, new Date(now).toISOString(), false)],
            nextCursor: null,
          }),
        ),
      );
      const root = document.createElement('div');
      await mountPuzzleHistory(root);
      expect(root.querySelector('h1')?.textContent).toBe(title);
      expect(root.querySelector('.puzzle-history__attempt > span:last-child')?.textContent).toBe(
        incorrect,
      );
    },
  );

  it('keeps loaded history on paging failures, retries the same cursor, and prompts on session expiry', async () => {
    stubWindowLocalStorage(memoryStorage());
    window.history.replaceState(null, '', '/puzzles/history');
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(
        json({
          attempts: [historyEntry(RED_MATE, '2026-10-31T12:00:00Z')],
          nextCursor: 'page-one',
        }),
      )
      .mockResolvedValueOnce(json({}, 503))
      .mockResolvedValue(json({}, 401));
    vi.stubGlobal('fetch', fetchSpy);
    const root = document.createElement('div');
    await mountPuzzleHistory(root);
    root.querySelector<HTMLButtonElement>('main button')!.click();
    await vi.waitFor(() =>
      expect(root.querySelector('main button')?.textContent).toBe('Try again'),
    );
    expect(root.querySelectorAll('.puzzle-history__attempt')).toHaveLength(1);
    root.querySelector<HTMLButtonElement>('main button')!.click();
    await vi.waitFor(() =>
      expect(root.querySelectorAll('.puzzle-history__attempt')).toHaveLength(0),
    );
    const link = root.querySelector<HTMLAnchorElement>('main a')!;
    expect(link.textContent).toBe('Sign in');
    expect(new URL(link.href).searchParams.get('referrer')).toBe('/puzzles/history');
    expect(fetchSpy.mock.calls.slice(1).map((args) => args[0])).toEqual([
      '/api/puzzles/history?order=newest&limit=50&cursor=page-one',
      '/api/puzzles/history?order=newest&limit=50&cursor=page-one',
    ]);
    await mountPuzzleHistory(root);
    expect(root.querySelector('main a')?.textContent).toBe('Sign in');
    expect(root.querySelector('main button')?.hasAttribute('hidden')).toBe(true);
  });

  it('renders each attempt once when a later cursor page repeats already shown attempts', async () => {
    stubWindowLocalStorage(memoryStorage());
    const recent = historyEntry(BLACK_MATE, '2026-10-31T16:00:00Z');
    const earlier = historyEntry(RED_MATE, '2026-10-31T15:15:00Z');
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        // Both fields let the regression reach the old client's append logic.
        .mockResolvedValueOnce(json({ attempts: [recent], nextCursor: 'page-one', nextOffset: 1 }))
        .mockResolvedValueOnce(
          json({ attempts: [recent, earlier, earlier], nextCursor: null, nextOffset: null }),
        ),
    );
    const root = document.createElement('div');
    await mountPuzzleHistory(root);
    root.querySelector<HTMLButtonElement>('main button')!.click();
    await vi.waitFor(() =>
      expect(root.querySelector<HTMLButtonElement>('main button')!.hidden).toBe(true),
    );
    expect(
      [...root.querySelectorAll<HTMLElement>('.puzzle-history__attempt')].map(
        (link) => link.dataset.puzzleId,
      ),
    ).toEqual([RED_MATE.id, BLACK_MATE.id]);
  });

  it('never renders a future hidden-information variant as a full-information board', async () => {
    stubWindowLocalStorage(memoryStorage());
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json({
          attempts: [{ ...historyEntry(RED_MATE, '2026-10-31T12:00:00Z'), variant: 'jieqi' }],
          nextCursor: null,
        }),
      ),
    );
    const root = document.createElement('div');
    await mountPuzzleHistory(root);
    expect(root.querySelector('.puzzle-history__board svg')).toBeNull();
    expect(root.querySelectorAll('.puzzle-history__attempt')).toHaveLength(1);
  });

  it.each([
    ['en', 'Replay: 1 of 1', 'All done'],
    ['zh-Hans', '错题重练：1 / 1', '全部完成'],
    ['zh-Hant', '錯題重練：1 / 1', '全部完成'],
  ])(
    'localizes replay progress and the empty completion screen in %s',
    async (locale, progress, done) => {
      stubWindowLocalStorage(memoryStorage({ [LOCALE_STORAGE_KEY]: locale }));
      window.history.replaceState(null, '', '/puzzles/replay?days=90');
      let failures = [{ puzzleId: RED_MATE.id, failedAt: '2026-10-29T12:00:00Z' }];
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL) => {
          const url = String(input);
          if (url.startsWith('/api/puzzles/failed')) return json({ failures });
          if (url.endsWith('/quality')) return new Response(null, { status: 204 });
          return json({ puzzle: publicDetail(RED_MATE) });
        }),
      );
      const root = document.createElement('div');
      await mountPuzzles(root);
      expect(root.querySelector('.puzzle-replay-progress')?.textContent).toBe(progress);
      failures = [];
      await mountPuzzles(root);
      expect(root.querySelector('.puzzle-replay-summary')?.textContent).toContain(done);
      expect(root.querySelector('.puzzle-replay-summary a')?.getAttribute('href')).toBe(
        '/puzzles/dashboard?days=90',
      );
    },
  );

  it('requires sign-in for replay and retains the days in the login return URL', async () => {
    stubWindowLocalStorage(memoryStorage());
    window.history.replaceState(null, '', '/puzzles/replay?days=14');
    const fetchSpy = vi.fn(async () => json({ error: 'not_signed_in' }, 401));
    vi.stubGlobal('fetch', fetchSpy);
    const root = document.createElement('div');
    await mountPuzzles(root);
    const link = root.querySelector<HTMLAnchorElement>('.puzzle-replay-summary a')!;
    expect(new URL(link.href).searchParams.get('referrer')).toBe('/puzzles/replay?days=14');
    expect(root.querySelector('.puzzle-board')).toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('defaults invalid replay windows to 30 days and retries a failed queue request', async () => {
    stubWindowLocalStorage(memoryStorage());
    window.history.replaceState(null, '', '/puzzles/replay?days=31');
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(json({}, 500))
      .mockResolvedValue(json({ failures: [] }));
    vi.stubGlobal('fetch', fetchSpy);
    const root = document.createElement('div');
    await mountPuzzles(root);
    root.querySelector<HTMLButtonElement>('.puzzles-status button')!.click();
    await vi.waitFor(() =>
      expect(root.querySelector('.puzzle-replay-summary')?.textContent).toContain('All done'),
    );
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy).toHaveBeenLastCalledWith('/api/puzzles/failed?days=30', {
      credentials: 'same-origin',
    });
  });

  it('saves difficulty, preserves an active attempt, and shifts the next puzzle', async () => {
    stubWindowLocalStorage(memoryStorage());
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const puzzles = [
      RED_MATE,
      BLACK_MATE,
      XIANGQI_PUZZLES.find((puzzle) => puzzle.id !== RED_MATE.id && puzzle.id !== BLACK_MATE.id)!,
    ];
    const summaries = puzzles.map((puzzle, index) => ({
      ...publicSummary(puzzle),
      servingRating: [1800, 1200, 2400][index],
    }));
    const fetchSpy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/puzzles') return json({ puzzles: summaries });
      if (url.endsWith('/quality')) return new Response(null, { status: 204 });
      if (url.endsWith('/attempt')) {
        return json({
          attempt: attemptStandardXiangqiPuzzleLine(RED_MATE, JSON.parse(String(init?.body)).moves),
        });
      }
      const index = puzzles.findIndex((puzzle) => url === `/api/puzzles/${puzzle.id}`);
      return index >= 0 ? json({ puzzle: publicDetail(puzzles[index]!) }) : json({}, 404);
    });
    vi.stubGlobal('fetch', fetchSpy);
    const root = document.createElement('div');
    await mountPuzzles(root, RED_MATE.id);
    clickSquares(root, RED_MATE.solution[0]!);
    await vi.waitFor(() => expect(root.textContent).toContain('Correct.'));
    const picker = root.querySelector<HTMLSelectElement>('[data-puzzle-difficulty]');
    expect(picker).not.toBeNull();
    expect([...picker!.options].map((option) => option.textContent)).toEqual([
      'Easiest',
      'Easier',
      'Normal',
      'Harder',
      'Hardest',
    ]);
    expect(picker!.value).toBe('normal');
    picker!.value = 'easiest';
    picker!.dispatchEvent(new Event('change'));
    expect(window.localStorage.getItem('mistboard:puzzles:difficulty')).toBe('easiest');
    expect(root.textContent).toContain('Correct.');
    expect(
      fetchSpy.mock.calls.filter(([input]) => String(input) === `/api/puzzles/${RED_MATE.id}`),
    ).toHaveLength(1);
    expect(root.textContent).toContain('Few unseen puzzles near this level');
    clickSquares(root, RED_MATE.solution[2]!);
    await vi.waitFor(() => expect(root.textContent).toContain('Success!'));
    root.querySelector<HTMLButtonElement>('[data-puzzle-next]')!.click();
    await vi.waitFor(() => expect(window.location.pathname).toContain(BLACK_MATE.id));
    const reopened = document.createElement('div');
    await mountPuzzles(reopened);
    expect(reopened.querySelector<HTMLSelectElement>('[data-puzzle-difficulty]')?.value).toBe(
      'easiest',
    );
  });

  it('offers difficulty and sparse fallback in the phone menu', () => {
    const onChange = vi.fn();
    const rows = puzzlePhoneMenuRows({
      queue: [],
      selectedId: null,
      solvedIds: new Set(),
      variantFilter: 'xiangqi',
      variantFilters: ['xiangqi'],
      autoNext: false,
      ratedEnabled: true,
      userRating: null,
      ratingDelta: null,
      onVariantChange: vi.fn(),
      onAutoNextChange: vi.fn(),
      onRatedChange: vi.fn(),
      difficulty: { level: 'hardest', nearby: 0, unseen: 3, onChange },
    });
    const field = rows.find((row) => row.dataset.puzzleMenuRow === 'difficulty');
    expect(field).toBeDefined();
    const select = field!.querySelector<HTMLSelectElement>('[data-puzzle-menu="difficulty"]')!;
    expect(select.value).toBe('hardest');
    select.value = 'easier';
    select.dispatchEvent(new Event('change'));
    expect(onChange).toHaveBeenCalledWith('easier');
    expect(rows.map((row) => row.textContent).join(' ')).toContain(
      'Few unseen puzzles near this level',
    );
  });

  it.each([
    { nearby: 0, unseen: 0, note: 'All puzzles in this selection have been seen.' },
    { nearby: 19, unseen: 30, note: 'Few unseen puzzles near this level (19 left).' },
    { nearby: 20, unseen: 30, note: null },
  ])(
    'explains difficulty availability: $nearby near, $unseen unseen',
    ({ nearby, unseen, note }) => {
      const rows = puzzlePhoneMenuRows({
        queue: [],
        selectedId: null,
        solvedIds: new Set(),
        variantFilter: 'xiangqi',
        variantFilters: ['xiangqi'],
        autoNext: false,
        ratedEnabled: true,
        userRating: null,
        ratingDelta: null,
        onVariantChange: vi.fn(),
        onAutoNextChange: vi.fn(),
        onRatedChange: vi.fn(),
        difficulty: { level: 'normal', nearby, unseen, onChange: vi.fn() },
      });
      const fallback = rows.find((row) => row.dataset.puzzleDifficultyFallback);
      if (note) expect(fallback?.textContent).toContain(note);
      else expect(fallback).toBeUndefined();
    },
  );

  it('filters the queue by theme, persists the picker, and keeps next navigation filtered', async () => {
    const puzzles = XIANGQI_PUZZLES.slice(0, 3);
    const summaries = puzzles.map((puzzle, index) => ({
      ...publicSummary(puzzle),
      motifs: index < 2 ? ['ma-hou-pao'] : [],
    }));
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === '/api/puzzles') return json({ puzzles: summaries, themes: themeOptions });
        const hinted = puzzles.find((puzzle) => url === `/api/puzzles/${puzzle.id}/reveal`);
        if (hinted) return json({ move: hinted.solution[0] });
        const index = puzzles.findIndex((puzzle) => url === `/api/puzzles/${puzzle.id}`);
        return index >= 0
          ? json({ puzzle: { ...publicDetail(puzzles[index]!), ...summaries[index] } })
          : json({}, 404);
      }),
    );
    stubWindowLocalStorage(memoryStorage());
    const root = document.createElement('div');
    await mountPuzzles(root);
    const picker = root.querySelector<HTMLSelectElement>('[data-puzzle-theme]');
    expect(picker).not.toBeNull();
    picker!.value = 'ma-hou-pao';
    picker!.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(root.textContent).toContain('0 solved of 2'));
    expect(window.localStorage.getItem('mistboard:puzzles:theme')).toBe('ma-hou-pao');
    await vi.waitFor(() =>
      expect(new URL(window.location.href).searchParams.get('theme')).toBe('ma-hou-pao'),
    );
    const firstPath = window.location.pathname;
    root.querySelector<HTMLButtonElement>('[data-puzzle-hint]')!.click();
    await vi.waitFor(() => expect(root.querySelector('[data-puzzle-skip]')).not.toBeNull());
    const next = root.querySelector<HTMLButtonElement>('[data-puzzle-skip]');
    expect(next).not.toBeNull();
    next!.click();
    await vi.waitFor(() => expect(window.location.pathname).not.toBe(firstPath));
    expect(new URL(window.location.href).searchParams.get('theme')).toBe('ma-hou-pao');
    expect(puzzles.slice(0, 2).some((puzzle) => window.location.pathname.endsWith(puzzle.id))).toBe(
      true,
    );
    expect(root.textContent).toContain('0 solved of 2');
    const reopened = document.createElement('div');
    window.history.replaceState(null, '', '/puzzles');
    await mountPuzzles(reopened);
    expect(reopened.querySelector<HTMLSelectElement>('[data-puzzle-theme]')?.value).toBe(
      'ma-hou-pao',
    );
    const all = reopened.querySelector<HTMLSelectElement>('[data-puzzle-theme]')!;
    all.value = '';
    all.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(reopened.textContent).toContain('0 solved of 3'));
  });

  it.each(['ma-hou-pao', ''])(
    'preserves an unfinished puzzle when changing to theme "%s" keeps it in the queue',
    async (nextTheme) => {
      stubWindowLocalStorage(memoryStorage());
      window.history.replaceState(
        null,
        '',
        `/puzzles/${RED_MATE.id}?theme=${nextTheme ? '' : 'ma-hou-pao'}`,
      );
      const qualityEvents: Array<{ sessionId: string; event: string }> = [];
      const attemptBodies: Array<{ moves: XiangqiMove[]; qualitySessionId: string }> = [];
      const fetchSpy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === '/api/puzzles') {
          return json({
            puzzles: [{ ...publicSummary(RED_MATE), motifs: ['ma-hou-pao'] }],
            themes: themeOptions,
          });
        }
        if (url === `/api/puzzles/${RED_MATE.id}`) {
          return json({ puzzle: publicDetail(RED_MATE) });
        }
        if (url.endsWith('/quality')) {
          qualityEvents.push(JSON.parse(String(init?.body)));
          return new Response(null, { status: 204 });
        }
        if (url.endsWith('/attempt')) {
          const body = JSON.parse(String(init?.body));
          attemptBodies.push(body);
          return json({ attempt: attemptStandardXiangqiPuzzleLine(RED_MATE, body.moves) });
        }
        return json({}, 404);
      });
      vi.stubGlobal('fetch', fetchSpy);
      const root = document.createElement('div');
      await mountPuzzles(root, RED_MATE.id);
      await clickSquares(root, RED_MATE.solution[0]!);
      await vi.waitFor(() => expect(root.textContent).toContain('Correct.'));
      const view = qualityEvents[0]!;

      const picker = root.querySelector<HTMLSelectElement>('[data-puzzle-theme]')!;
      picker.value = nextTheme;
      picker.dispatchEvent(new Event('change'));
      await vi.waitFor(() =>
        expect(new URL(window.location.href).searchParams.get('theme') ?? '').toBe(nextTheme),
      );

      expect(
        fetchSpy.mock.calls.filter(([input]) => String(input) === `/api/puzzles/${RED_MATE.id}`),
      ).toHaveLength(1);
      expect(root.textContent).toContain('Correct.');
      await vi.waitFor(() =>
        expect(root.textContent).toContain(
          `${RED_MATE.solution[1]!.from}-${RED_MATE.solution[1]!.to}`,
        ),
      );
      expect(qualityEvents).toEqual([view]);
      expect(view.event).toBe('view');
      await clickSquares(root, RED_MATE.solution[2]!);
      await vi.waitFor(() => expect(root.textContent).toContain('Success!'));
      expect(attemptBodies.map((body) => body.moves)).toEqual([
        [RED_MATE.solution[0]],
        [RED_MATE.solution[0], RED_MATE.solution[2]],
      ]);
      expect(attemptBodies.every((body) => body.qualitySessionId === view.sessionId)).toBe(true);
    },
  );

  it('opens the themes index with counts, glosses and filtered-session links', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ puzzles: [], themes: themeOptions })),
    );
    const root = document.createElement('div');
    await mountPuzzles(root, 'themes');
    // An older server sends no tagCounts: the page still lists the patterns.
    expect(root.querySelectorAll('[data-puzzle-theme-card]')).toHaveLength(1);
    const link = root.querySelector<HTMLAnchorElement>('a[href="/puzzles?theme=ma-hou-pao"]');
    expect(link?.textContent).toContain('Cannon behind the horse');
    // English copy assumes no Chinese: no hanzi or pinyin beside the name.
    expect(root.textContent).not.toContain('马后炮');
    expect(root.textContent).not.toContain('mǎ hòu pào');
    // Lichess's row: the count sits inline after the name, a bare number.
    const count = root.querySelector(
      '[data-puzzle-theme-card="ma-hou-pao"] h3 .puzzle-theme-count',
    );
    expect(count?.textContent).toBe('24');
    expect(count?.getAttribute('title')).toBe('24 puzzles');
    // Names and glosses come from the catalogue, so they follow the locale.
    expect(root.textContent).toContain('the horse pens the general in');
    // A theme with art wears it as a mask-painted marker, tagged with its group.
    const icon = root.querySelector<HTMLElement>(
      '[data-puzzle-theme-card="ma-hou-pao"] .puzzle-theme-icon',
    );
    expect(icon?.dataset.iconGroup).toBe('motif');
    expect(icon?.dataset.iconTheme).toBe('ma-hou-pao');
    expect(
      icon
        ?.querySelector<HTMLElement>('.variant-marker')
        ?.style.getPropertyValue('--variant-marker-mask'),
    ).toContain('/puzzle-theme-icons/ma-hou-pao.png');
    expect(icon?.querySelector('text')).toBeNull();
    expect(
      root.querySelector<HTMLElement>('[data-puzzle-theme-recommended] .puzzle-theme-icon')?.dataset
        .iconGroup,
    ).toBe('mix');
    expect(root.querySelector('.puzzle-xiangqi-board')).toBeNull();
    expect(root.querySelector('a[href="/puzzles?theme=men-gong"]')).toBeNull();
    // With no tag counts the mix row still links every puzzle, just uncounted.
    // The mix row clears a saved theme: plain /puzzles would reopen the last drill.
    const mix = root.querySelector('[data-puzzle-theme-recommended] a[href="/puzzles?theme="]');
    expect(mix?.textContent).toContain('Healthy mix');
    expect(mix?.querySelector('.puzzle-theme-count')).toBeNull();
  });

  it("names the mate patterns in the reader's script on a zh-Hant themes page", async () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'zh-Hant');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ puzzles: [], themes: themeOptions })),
    );
    const root = document.createElement('div');
    await mountPuzzles(root, 'themes');
    const card = root.querySelector<HTMLElement>('[data-puzzle-theme-card="ma-hou-pao"]');
    expect(card?.querySelector('h3')?.textContent).toContain('馬後炮');
    expect(card?.textContent).toContain('炮在馬後將軍');
    // The hanzi is the name: no pinyin or English literal line under it.
    expect(card?.querySelector('.puzzle-theme-name')).toBeNull();
    expect(card?.textContent).not.toContain('Cannon behind the horse');
  });

  it('groups the themes page like lichess, with the pattern minimum and no empty entries', async () => {
    const motifCount = (id: string) =>
      ({ 'ma-hou-pao': 30, 'men-gong': PUZZLE_THEME_MIN_PATTERN_COUNT, 'tie-men-shuan': 90 })[id] ??
      (id === 'chong-pao' ? PUZZLE_THEME_MIN_PATTERN_COUNT - 1 : 0);
    const tagCounts = {
      ...Object.fromEntries(XIANGQI_MOTIFS.map((m) => [m.id, motifCount(m.id)])),
      matein1: 40,
      matein2: 25,
      matein3: 9,
      matein4: 0,
      opening: 5,
      middlegame: 70,
      endgame: 30,
      checkmate: 74,
      winning: 31,
      'one-move': 50,
      short: 30,
      long: 25,
      'very-long': 0,
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json({
          puzzles: [],
          themes: XIANGQI_MOTIFS.map((m) => ({ ...m, count: motifCount(m.id) })),
          tagCounts,
        }),
      ),
    );
    const root = document.createElement('div');
    await mountPuzzles(root, 'themes');
    const groups = [...root.querySelectorAll<HTMLElement>('[data-puzzle-theme-group]')];
    expect(groups.map((g) => g.dataset.puzzleThemeGroup)).toEqual([
      'motif',
      'mate',
      'phase',
      'goal',
      'length',
    ]);
    expect(groups.map((g) => g.querySelector('h2')?.textContent)).toEqual([
      'Mate patterns',
      'Mates',
      'Phases',
      'Goals',
      'Lengths',
    ]);
    const cards = (group: HTMLElement) =>
      [...group.querySelectorAll<HTMLElement>('[data-puzzle-theme-card]')].map(
        (card) => card.dataset.puzzleThemeCard,
      );
    // Patterns at the minimum, most puzzles first; one short of it is hidden.
    expect(cards(groups[0]!)).toEqual(['tie-men-shuan', 'ma-hou-pao', 'men-gong']);
    // Zero counts are hidden; any count above zero shows outside the patterns.
    expect(cards(groups[1]!)).toEqual(['matein1', 'matein2', 'matein3']);
    expect(cards(groups[2]!)).toEqual(['opening', 'middlegame', 'endgame']);
    expect(cards(groups[3]!)).toEqual(['checkmate', 'winning']);
    expect(cards(groups[4]!)).toEqual(['one-move', 'short', 'long']);
    const mateIn1 = root.querySelector<HTMLAnchorElement>('a[href="/puzzles?theme=matein1"]');
    expect(mateIn1?.querySelector('h3')?.textContent).toBe('Mate in 1 40');
    expect(root.querySelector('[data-puzzle-theme-card="endgame"]')?.textContent).toContain(
      '14 or fewer pieces',
    );
    // English copy assumes no Chinese: a mate pattern reads in English only,
    // with no hanzi or pinyin line under it.
    const menGong = root.querySelector<HTMLElement>('[data-puzzle-theme-card="men-gong"]');
    expect(menGong?.querySelector('h3')?.textContent).toContain('Sealed palace');
    expect(menGong?.querySelector('.puzzle-theme-name')).toBeNull();
    expect(menGong?.textContent).not.toMatch(/[\u3400-\u9fff]/);
    // A pattern with no art of its own wears its group's line icon, never nothing.
    const fallback = menGong?.querySelector<HTMLElement>('.puzzle-theme-icon');
    expect(fallback?.dataset.iconTheme).toBeUndefined();
    expect(fallback?.querySelector('svg path')).not.toBeNull();

    // Recommended comes first: one row training on everything, counted as
    // the corpus (each puzzle has one phase: 5 + 70 + 30).
    const recommended = root.querySelector<HTMLElement>('[data-puzzle-theme-recommended]');
    expect(recommended?.compareDocumentPosition(groups[0]!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(recommended?.querySelector('h2')?.textContent).toBe('Recommended');
    const mix = recommended?.querySelectorAll<HTMLAnchorElement>('a') ?? [];
    expect([...mix].map((a) => a.getAttribute('href'))).toEqual(['/puzzles?theme=']);
    expect(mix[0]?.querySelector('h3')?.textContent).toBe('Healthy mix 105');
    expect(mix[0]?.querySelector('.puzzle-theme-description')?.textContent).toContain(
      'Every theme shuffled together',
    );

    // The sidebar is the Puzzles menu, this page current.
    const side = root.querySelector<HTMLElement>('.puzzle-themes-side');
    expect(
      [...(side?.querySelectorAll<HTMLAnchorElement>('a') ?? [])].map((a) => [
        a.getAttribute('href'),
        a.textContent,
        a.getAttribute('aria-current'),
      ]),
    ).toEqual([
      ['/puzzles', 'Puzzles', null],
      ['/puzzles/themes', 'Puzzle Themes', 'page'],
      ['/puzzles?mode=streak', 'Puzzle Streak', null],
      ['/puzzles/dashboard', 'Puzzle Dashboard', null],
    ]);
  });

  it('drills any tag, not only patterns, from the URL and the grouped picker', async () => {
    const puzzles = XIANGQI_PUZZLES.slice(0, 3);
    const summaries = puzzles.map((puzzle, index) => ({
      ...publicSummary(puzzle),
      tags: index === 1 ? ['matein2', 'middlegame', 'checkmate', 'short'] : ['endgame'],
    }));
    window.history.replaceState(null, '', '/puzzles?theme=matein2');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === '/api/puzzles')
          return json({
            puzzles: summaries,
            themes: themeOptions,
            tagCounts: { 'ma-hou-pao': 24, matein2: 1, middlegame: 1, endgame: 2, short: 1 },
          });
        const index = puzzles.findIndex((puzzle) => url === `/api/puzzles/${puzzle.id}`);
        return index >= 0
          ? json({ puzzle: { ...publicDetail(puzzles[index]!), ...summaries[index] } })
          : json({}, 404);
      }),
    );
    stubWindowLocalStorage(memoryStorage());
    const root = document.createElement('div');
    document.body.append(root);
    await mountPuzzles(root);
    await vi.waitFor(() => expect(root.textContent).toContain('0 solved of 1'));
    const picker = root.querySelector<HTMLSelectElement>('[data-puzzle-theme]')!;
    expect(picker.value).toBe('matein2');
    expect([...picker.querySelectorAll('optgroup')].map((g) => g.label)).toEqual([
      'Mate patterns',
      'Mates',
      'Phases',
      'Lengths',
    ]);
    expect(
      [...picker.querySelectorAll<HTMLOptionElement>('optgroup option')].map((o) => o.value),
    ).toEqual(['ma-hou-pao', 'matein2', 'middlegame', 'endgame', 'short']);
    picker.value = 'endgame';
    picker.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(root.textContent).toContain('0 solved of 2'));
    expect(loadPuzzleTheme()).toBe('endgame');
  });

  it('honors a theme URL over storage and offers recovery from an empty theme', async () => {
    stubWindowLocalStorage(memoryStorage({ 'mistboard:puzzles:theme': 'ma-hou-pao' }));
    window.history.replaceState(null, '', '/puzzles?theme=men-gong');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) =>
        String(input) === '/api/puzzles'
          ? json({
              puzzles: [{ ...publicSummary(RED_MATE), motifs: ['ma-hou-pao'] }],
              themes: themeOptions,
            })
          : json({ puzzle: publicDetail(RED_MATE) }),
      ),
    );
    const root = document.createElement('div');
    document.body.append(root);
    await mountPuzzles(root);
    expect(root.querySelector('.puzzle-detail')?.textContent).toContain(
      'No puzzles for this theme',
    );
    expect(root.querySelector('.puzzle-detail a[href="/puzzles?theme="]')).not.toBeNull();
    expect(root.querySelector('[data-square]')).toBeNull();
    window.history.replaceState(null, '', '/puzzles');
    window.dispatchEvent(new PopStateEvent('popstate'));
    await vi.waitFor(() => expect(root.querySelector('[data-square]')).not.toBeNull());
    expect(root.querySelector<HTMLSelectElement>('[data-puzzle-theme]')?.value).toBe('');
    expect(loadPuzzleTheme()).toBe('men-gong');
  });

  it('opens a direct puzzle link without erasing the saved theme and ignores invalid stored ids', async () => {
    stubWindowLocalStorage(memoryStorage({ 'mistboard:puzzles:theme': 'ma-hou-pao' }));
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) =>
        String(input) === '/api/puzzles'
          ? json({ puzzles: [{ ...publicSummary(RED_MATE), motifs: [] }], themes: themeOptions })
          : json({ puzzle: publicDetail(RED_MATE) }),
      ),
    );
    const root = document.createElement('div');
    await mountPuzzles(root, RED_MATE.id);
    expect(root.querySelector('[data-square]')).not.toBeNull();
    expect(root.querySelector<HTMLSelectElement>('[data-puzzle-theme]')?.value).toBe('');
    expect(loadPuzzleTheme()).toBe('ma-hou-pao');
    window.history.replaceState(null, '', '/puzzles');
    const reopened = document.createElement('div');
    await mountPuzzles(reopened);
    expect(reopened.querySelector<HTMLSelectElement>('[data-puzzle-theme]')?.value).toBe(
      'ma-hou-pao',
    );
    window.localStorage.setItem('mistboard:puzzles:theme', 'toString');
    expect(loadPuzzleTheme()).toBeNull();
    stubWindowLocalStorage({
      getItem: () => {
        throw new Error('blocked');
      },
    } as unknown as Storage);
    expect(loadPuzzleTheme()).toBeNull();
  });

  it('offers the theme picker in the phone menu using the same callback', async () => {
    const onChange = vi.fn(async () => {});
    const rows = puzzlePhoneMenuRows({
      queue: [],
      selectedId: null,
      solvedIds: new Set(),
      variantFilter: 'xiangqi',
      variantFilters: ['xiangqi'],
      autoNext: false,
      ratedEnabled: true,
      userRating: null,
      ratingDelta: null,
      onVariantChange: vi.fn(),
      onAutoNextChange: vi.fn(),
      onRatedChange: vi.fn(),
      theme: { id: null, options: { motifs: themeOptions, tagCounts: {} }, onChange },
    });
    const field = rows.find((row) => row.dataset.puzzleMenuRow === 'theme')!;
    const select = field.querySelector<HTMLSelectElement>('[data-puzzle-menu="theme"]')!;
    select.value = 'ma-hou-pao';
    select.dispatchEvent(new Event('change'));
    expect(onChange).toHaveBeenCalledWith('ma-hou-pao');
    expect(rows.some((row) => row.querySelector('a[href="/puzzles/themes"]'))).toBe(true);
  });
  const movesOf = (init?: RequestInit): XiangqiMove[] =>
    (JSON.parse(String(init?.body)) as { moves: XiangqiMove[] }).moves;
  const clickSquares = async (root: HTMLElement, move: XiangqiMove): Promise<void> => {
    await waitForLiveBoard(root);
    root
      .querySelector<SVGGElement>(`[data-square="${move.from}"]`)
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    root
      .querySelector<SVGGElement>(`[data-square="${move.to}"]`)
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  };
  // Every solver ply of the line, waiting for each attempt to land and its
  // scripted reply to glide in (the ✓ pause holds input) before the next click.
  const solveLine = async (root: HTMLElement, puzzle: XiangqiPuzzle): Promise<void> => {
    for (const [ply, move] of puzzle.solution.entries()) {
      if (ply % 2 !== 0) continue;
      await clickSquares(root, move);
      const shown = puzzle.solution[ply + 1] ?? move;
      await vi.waitFor(() =>
        expect(root.querySelector('.puzzle-move-cell--active')?.textContent).toContain(
          `${shown.from}-${shown.to}`,
        ),
      );
    }
  };

  it('renders a puzzle board from the API', async () => {
    const mini = BLACK_MATE;
    const drop = RED_MATE;
    const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/puzzles')
        return json({ puzzles: [publicSummary(mini), publicSummary(drop)] });
      if (url === `/api/puzzles/${drop.id}`) return json({ puzzle: publicDetail(drop) });
      return json({ error: 'not_found' }, 404);
    });
    vi.stubGlobal('fetch', fetchSpy);
    const root = document.createElement('div');

    await mountPuzzles(root, drop.id);

    expect(root.querySelector('.site-section-heading')?.textContent).toBe('Puzzles');
    expect(root.querySelectorAll('.puzzle-list-item')).toHaveLength(0);
    // Only Xiangqi is surfaced, so there is no variant picker. A direct deep
    // link into a puzzle still resolves and renders.
    expect(root.querySelector('[data-puzzle-variant]')).toBeNull();
    expect(root.querySelector('.puzzles-sidebar')?.textContent).toContain('0 solved of 2');
    expect(root.querySelector('.puzzles-sidebar')?.textContent).not.toContain('All puzzles');
    expect(root.querySelector('.puzzles-sidebar')?.textContent).not.toContain(' / ');
    // The feedback title is deliberately generic (the puzzle title would spoil the piece).
    expect(root.querySelector('.puzzle-detail h2')?.textContent).toBe('Red to move');
    expect(root.querySelector('.puzzle-xiangqi-board')).not.toBeNull();
    // Open information, no reserves: the board paints straight onto its host.
    expect(root.querySelector('.puzzle-board-shell')).toBeNull();
    expect(root.querySelectorAll('[data-square]').length).toBe(90);
    expect(root.querySelector('.puzzle-reserves')).toBeNull();
    // The goal (mate depth) is hidden while solving so it doesn't spoil the move.
    expect(root.textContent).not.toContain('Mate in 1');
    expect(root.querySelector('.puzzle-moves h3')).toBeNull();
    expect(root.textContent).not.toContain(
      `${RED_MATE.solution[0]!.from}-${RED_MATE.solution[0]!.to}`,
    );
  });

  it('mounts the shared board resize grip on the board column', async () => {
    const mini = RED_MATE;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === '/api/puzzles') return json({ puzzles: [publicSummary(mini)] });
        if (url === `/api/puzzles/${mini.id}`) return json({ puzzle: publicDetail(mini) });
        return json({ error: 'not_found' }, 404);
      }),
    );
    const root = document.createElement('div');

    await mountPuzzles(root, mini.id);

    // The grip is the whole adjustability affordance, and it belongs to the
    // board COLUMN so it can be parked on the board's own corner. It is the same
    // element, and the same persisted --uni-board-scale, that the room, review
    // and analysis boards use.
    const grip = root.querySelector('.puzzle-board > .board-resize-grip');
    expect(grip).not.toBeNull();
    expect(grip?.getAttribute('aria-label')).toBe('Resize board');
  });

  it("sizes the right column to the board's drawn height, not its max size", async () => {
    const puzzle = RED_MATE;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === '/api/puzzles') return json({ puzzles: [publicSummary(puzzle)] });
        if (url === `/api/puzzles/${puzzle.id}`) return json({ puzzle: publicDetail(puzzle) });
        return json({ error: 'not_found' }, 404);
      }),
    );
    // A width-bound board: the column is narrower than the 704px height budget
    // allows, so the 9x10 board draws 556x616 (1440x900, measured), not 704 tall.
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: Element,
    ) {
      const painted = this.classList.contains('puzzle-xiangqi-board');
      return new DOMRect(0, 0, 556, painted ? 616 : 704);
    });
    const root = document.createElement('div');
    document.body.append(root);

    await mountPuzzles(root, puzzle.id);

    const detail = root.querySelector<HTMLElement>('.puzzle-detail');
    await vi.waitFor(() =>
      expect(detail?.style.getPropertyValue('--puzzle-board-height')).toBe('616px'),
    );
  });

  it("keeps the side panel's height on the measured board height", () => {
    const css = readFileSync(
      ['src/puzzles.css', 'apps/web/src/puzzles.css'].find((path) => existsSync(path))!,
      'utf8',
    );
    const rule = (selector: string): string =>
      css.match(new RegExp(`(?<!,)\\n${selector.replace(/[.-]/g, '\\$&')} \\{([^}]*)\\}`))?.[1] ??
      '';
    expect(rule('.puzzle-side-panel')).toMatch(
      /\bheight: var\(--puzzle-board-height, var\(--puzzle-surface-size\)\)/,
    );
    expect(rule('.puzzle-side-panel--analysis')).toMatch(
      /max-height: var\(--puzzle-board-height, var\(--puzzle-surface-size\)\)/,
    );
  });

  it("puts the board's inset on the detail, where the session row under the board reads it", async () => {
    const puzzle = RED_MATE;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === '/api/puzzles') return json({ puzzles: [publicSummary(puzzle)] });
        if (url === `/api/puzzles/${puzzle.id}`) return json({ puzzle: publicDetail(puzzle) });
        return json({ error: 'not_found' }, 404);
      }),
    );
    // A shrunk board centred in a wider column (1920x1080 at scale 0.6,
    // measured): the 465px board sat 26px in from its 516px column, and the
    // session row, a sibling of the column, started in that gutter.
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: Element,
    ) {
      const painted = this.classList.contains('puzzle-xiangqi-board');
      return new DOMRect(0, 0, painted ? 465 : 516, 516);
    });
    const root = document.createElement('div');
    document.body.append(root);

    await mountPuzzles(root, puzzle.id);

    const detail = root.querySelector<HTMLElement>('.puzzle-detail');
    await vi.waitFor(() =>
      expect(detail?.style.getPropertyValue('--puzzle-board-inset')).toBe('26px'),
    );
    expect(detail?.querySelector('.puzzle-session-chips')).not.toBeNull();
  });

  describe('desktop columns around the board', () => {
    const css = readFileSync(
      ['src/puzzles.css', 'apps/web/src/puzzles.css'].find((path) => existsSync(path))!,
      'utf8',
    );
    const rule = (selector: string): string =>
      css.match(new RegExp(`(?<!,)\\n${selector.replace(/[.()-]/g, '\\$&')} \\{([^}]*)\\}`))?.[1] ??
      '';

    it('lets the left column keep its natural height instead of the board height', () => {
      // Tied to the board, a shrunk board made the column scroll inside itself,
      // and its last card pinned to the board's bottom left a blank gap above it.
      expect(css).not.toMatch(/\.puzzles-sidebar \{[^}]*height: var\(--puzzle-board-height/);
      expect(css).not.toMatch(/\.puzzles-sidebar > :last-child \{[^}]*margin-top: auto/);
      // It spans the session row's line too, so that row stays under the board.
      expect(css).toMatch(/\.puzzles-sidebar \{\s*grid-row: 1 \/ span 2;/);
      expect(css).toMatch(/\.puzzles-layout \{\s*grid-template-rows: auto minmax\(0, 1fr\);/);
    });

    it("sizes the board column to the 9x10 board's drawn width", () => {
      expect(rule('.puzzles-layout')).toMatch(
        /minmax\(min\(420px, var\(--puzzle-board-track\)\), var\(--puzzle-board-track\)\)/,
      );
      expect(rule('.puzzles-layout:has(.puzzle-xiangqi-board)')).toContain(
        'calc(var(--puzzle-surface-size) * 552 / 612)',
      );
    });

    it('keeps the move nav as plain arrows, not boxed buttons', () => {
      expect(rule('.puzzle-actions')).toContain('grid-template-columns: repeat(4, 48px);');
      expect(rule('.puzzle-button')).toMatch(/border: 0;[\s\S]*background: transparent;/);
    });
  });

  it('merges the practice note into the puzzle rating card', async () => {
    stubWindowLocalStorage(memoryStorage({ 'mistboard:puzzles:rated': 'false' }));
    const mini = RED_MATE;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === '/api/puzzles') return json({ puzzles: [publicSummary(mini)] });
        if (url === `/api/puzzles/${mini.id}`) return json({ puzzle: publicDetail(mini) });
        return json({ error: 'not_found' }, 404);
      }),
    );
    const root = document.createElement('div');

    await mountPuzzles(root, mini.id);

    const ratingCard = root.querySelector('.puzzle-rating-card');
    expect(root.querySelector('.puzzle-rated-card')).toBeNull();
    expect(ratingCard?.querySelector<HTMLInputElement>('[data-puzzle-rated]')?.checked).toBe(false);
    expect(ratingCard?.textContent).toContain('Rated');
    expect(ratingCard?.textContent).toContain('Your puzzle rating will not change.');
    expect(ratingCard?.textContent).not.toContain('0 solved of 1');
  });

  it('plays a puzzle line and advances to the solved state', async () => {
    const drop = RED_MATE;
    const qualityEvents: Array<{ sessionId: string; event: string; vote?: string | null }> = [];
    let attemptQualitySessionId: string | null = null;
    const fetchSpy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/puzzles') return json({ puzzles: [publicSummary(drop)] });
      if (url === `/api/puzzles/${drop.id}`) return json({ puzzle: publicDetail(drop) });
      if (url === `/api/puzzles/${drop.id}/quality`) {
        qualityEvents.push(JSON.parse(String(init?.body)));
        return new Response(null, { status: 204 });
      }
      if (url === `/api/puzzles/${drop.id}/attempt`) {
        expect(init?.method).toBe('POST');
        const body = JSON.parse(String(init?.body));
        expect(body).toEqual(
          expect.objectContaining({
            moves: expect.any(Array),
            rated: true,
          }),
        );
        attemptQualitySessionId = body.qualitySessionId;
        return json({
          attempt: attemptStandardXiangqiPuzzleLine(drop, movesOf(init)),
        });
      }
      return json({ error: 'not_found' }, 404);
    });
    vi.stubGlobal('fetch', fetchSpy);
    const root = document.createElement('div');

    await mountPuzzles(root, drop.id);
    await solveLine(root, drop);

    await vi.waitFor(() => expect(root.textContent).toContain('Success!'));
    // The mate draws the game rooms' slash through the mated general, and
    // stepping off the final position takes it away.
    const slash = root.querySelector<HTMLElement>('.finish-badge--mated');
    expect(slash?.querySelector('.finish-badge__slash')).not.toBeNull();
    expect(root.querySelector('.finish-badges')).not.toBeNull();
    expect(root.querySelector('[data-puzzle-play-position]')).toBeNull();
    root.querySelector<HTMLButtonElement>('[data-puzzle-replay-previous]')?.click();
    expect(root.querySelector('.finish-badge--mated')).toBeNull();
    const playPosition = root.querySelector<HTMLAnchorElement>('[data-puzzle-play-position]');
    expect(playPosition).not.toBeNull();
    const shownState = drop.solution
      .slice(0, -1)
      .reduce((state, move) => applyStandardXiangqiMove(state, move), drop.initial);
    expect(new URL(playPosition!.href).searchParams.get('fen')).toBe(
      standardXiangqiEngineFen(shownState),
    );
    expect(playPosition!.closest('.puzzle-vote-actions')).toBeNull();
    expect(playPosition!.previousElementSibling?.matches('.puzzle-continue-button')).toBe(true);
    expect(playPosition!.textContent).toBe('Play the computer');
    expect(playPosition!.target).toBe('_blank');
    root.querySelector<HTMLButtonElement>('[data-puzzle-replay-next]')?.click();
    expect(root.querySelector('.finish-badge--mated')).not.toBeNull();
    expect(root.querySelector('[data-puzzle-play-position]')).toBeNull();
    root.querySelector<HTMLButtonElement>('[aria-label="Puzzle was helpful"]')?.click();
    await vi.waitFor(() =>
      expect(qualityEvents.some((event) => event.event === 'vote' && event.vote === 'up')).toBe(
        true,
      ),
    );
    const view = qualityEvents.find((event) => event.event === 'view');
    expect(view?.sessionId).toBe(attemptQualitySessionId);
    expect(root.querySelector('.puzzle-reserves')).toBeNull();
    expect(root.textContent).not.toContain('d5');
    expect(fetchSpy).toHaveBeenCalledWith(
      `/api/puzzles/${drop.id}/attempt`,
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('offers reports after completion, retries failed sends and preserves the sent state', async () => {
    const puzzle = RED_MATE;
    const reports: Array<{ reason: string; deviceId: string; moves: XiangqiMove[] }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === '/api/puzzles') return json({ puzzles: [publicSummary(puzzle)] });
        if (url === `/api/puzzles/${puzzle.id}`) return json({ puzzle: publicDetail(puzzle) });
        if (url.endsWith('/attempt'))
          return json({ attempt: attemptStandardXiangqiPuzzleLine(puzzle, movesOf(init)) });
        if (url.endsWith('/report')) {
          reports.push(JSON.parse(String(init?.body)));
          return reports.length === 1
            ? json({ error: 'temporarily_unavailable' }, 503)
            : json({ reported: true }, 201);
        }
        return new Response(null, { status: 204 });
      }),
    );
    const root = document.createElement('div');
    await mountPuzzles(root, puzzle.id);
    expect(root.querySelector('.puzzle-report')).toBeNull();
    await solveLine(root, puzzle);
    // Reporting stays account-optional even when durable browser storage is
    // unavailable: the puzzle visit supplies an anonymous fallback identity.
    stubWindowLocalStorage({
      getItem() {
        throw new Error('storage unavailable');
      },
      setItem() {
        throw new Error('storage unavailable');
      },
    } as unknown as Storage);
    const reason = root.querySelector<HTMLSelectElement>('.puzzle-report select')!;
    expect([...reason.options].map((option) => option.textContent)).toEqual([
      'Wrong solution',
      'A second winning move',
      'Wrong theme',
      'Other',
    ]);
    reason.value = 'second-winning-move';
    reason.dispatchEvent(new Event('change'));
    const form = root.querySelector<HTMLFormElement>('.puzzle-report form')!;
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await vi.waitFor(() => expect(form.textContent).toContain('Could not send the report'));
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await vi.waitFor(() => expect(root.textContent).toContain('Report sent. Thank you.'));
    expect(reports[1]).toEqual({
      reason: 'second-winning-move',
      deviceId: expect.any(String),
      moves: puzzle.solution.filter((_, ply) => ply % 2 === 0),
    });
    root.querySelector<HTMLButtonElement>('[aria-label="Puzzle was helpful"]')?.click();
    expect(root.querySelector('.puzzle-report form')).toBeNull();
    expect(root.textContent).toContain('Report sent. Thank you.');
    expect(reports).toHaveLength(2);
  });

  it('reports the rejected move after revealing the solution', async () => {
    const puzzle = RED_MATE;
    const wrong = getStandardXiangqiLegalMoves(puzzle.initial).find(
      (move) =>
        !standardXiangqiPuzzleMoveEquals(move, puzzle.solution[0]!) &&
        !attemptStandardXiangqiPuzzleLine(puzzle, [move]).ok,
    )!;
    let report: { moves: XiangqiMove[] } | null = null;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === '/api/puzzles') return json({ puzzles: [publicSummary(puzzle)] });
        if (url === `/api/puzzles/${puzzle.id}`) return json({ puzzle: publicDetail(puzzle) });
        if (url.endsWith('/attempt'))
          return json({ attempt: attemptStandardXiangqiPuzzleLine(puzzle, movesOf(init)) });
        if (url.endsWith('/reveal')) return json({ solution: puzzle.solution });
        if (url.endsWith('/report')) {
          report = JSON.parse(String(init?.body));
          return json({ reported: true }, 201);
        }
        return new Response(null, { status: 204 });
      }),
    );
    const root = document.createElement('div');
    await mountPuzzles(root, puzzle.id);
    clickSquares(root, wrong);
    await vi.waitFor(() => expect(root.textContent).toContain('Try again'));
    expect(root.querySelector('.puzzle-report')).toBeNull();
    root.querySelector<HTMLButtonElement>('[data-puzzle-reveal]')?.click();
    await vi.waitFor(() => expect(root.querySelector('.puzzle-report form')).not.toBeNull());
    root.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await vi.waitFor(() => expect(report).toEqual(expect.objectContaining({ moves: [wrong] })));
  });

  it('shows no streak line under Success even when the server sends one', async () => {
    const drop = RED_MATE;
    let timeZone: unknown = null;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === '/api/puzzles') return json({ puzzles: [publicSummary(drop)] });
        if (url === `/api/puzzles/${drop.id}`) return json({ puzzle: publicDetail(drop) });
        if (url === `/api/puzzles/${drop.id}/quality`) return new Response(null, { status: 204 });
        if (url === `/api/puzzles/${drop.id}/attempt`) {
          timeZone = JSON.parse(String(init?.body)).timeZone;
          const attempt = attemptStandardXiangqiPuzzleLine(drop, movesOf(init));
          return json({
            attempt,
            ...(attempt.ok && attempt.complete ? { streak: { current: 3, best: 7 } } : {}),
          });
        }
        return json({ error: 'not_found' }, 404);
      }),
    );
    const root = document.createElement('div');

    await mountPuzzles(root, drop.id);
    await solveLine(root, drop);

    await vi.waitFor(() => expect(root.textContent).toContain('Success!'));
    expect(root.querySelector('.puzzle-solved-streak')).toBeNull();
    expect(root.textContent).not.toContain('Puzzle streak');
    // The attempt carries the browser's calendar so the server counts days
    // the way the solver does.
    expect(timeZone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  });

  it('marks solved puzzles and navigates to the next puzzle', async () => {
    const redDrop = RED_MATE;
    const blackDrop = BLACK_MATE;
    // Pin the queue order despite the rotation shuffle: mark the second puzzle
    // seen so the unseen (deep-linked) puzzle leads and "next" is deterministic.
    stubWindowLocalStorage(
      memoryStorage({ 'mistboard:puzzles:seen': JSON.stringify({ [blackDrop.id]: 1 }) }),
    );
    const fetchSpy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/puzzles')
        return json({ puzzles: [publicSummary(redDrop), publicSummary(blackDrop)] });
      if (url === `/api/puzzles/${redDrop.id}`) return json({ puzzle: publicDetail(redDrop) });
      if (url === `/api/puzzles/${blackDrop.id}`) return json({ puzzle: publicDetail(blackDrop) });
      if (url === `/api/puzzles/${redDrop.id}/attempt`) {
        expect(JSON.parse(String(init?.body))).toEqual(
          expect.objectContaining({
            moves: expect.any(Array),
            rated: true,
          }),
        );
        return json({
          attempt: attemptStandardXiangqiPuzzleLine(redDrop, movesOf(init)),
        });
      }
      return json({ error: 'not_found' }, 404);
    });
    vi.stubGlobal('fetch', fetchSpy);
    const root = document.createElement('div');

    await mountPuzzles(root, redDrop.id);
    expect(root.querySelector<HTMLButtonElement>('[data-puzzle-next]')).toBeNull();
    expect(root.querySelector<HTMLButtonElement>('[data-puzzle-replay-next]')?.disabled).toBe(true);
    await solveLine(root, redDrop);

    await vi.waitFor(() => expect(root.textContent).toContain('Success!'));
    expect(root.querySelector('.puzzle-current-card')?.textContent).toContain('Solved');
    expect(root.querySelector('.puzzles-sidebar')?.textContent).not.toContain(' / ');
    expect(root.querySelector<HTMLButtonElement>('[data-puzzle-replay-previous]')?.disabled).toBe(
      false,
    );
    expect(root.querySelector<HTMLButtonElement>('[data-puzzle-replay-next]')?.disabled).toBe(true);
    const nextButton = root.querySelector<HTMLButtonElement>('[data-puzzle-next]');
    expect(nextButton?.getAttribute('aria-label')).toBe('Next puzzle');
    expect(nextButton?.textContent).toBe('Next puzzle');
    expect(nextButton?.disabled).toBe(false);

    nextButton?.click();

    await vi.waitFor(() =>
      expect(root.querySelector('.puzzle-detail h2')?.textContent).toBe('Black to move'),
    );
    expect(fetchSpy).toHaveBeenCalledWith(`/api/puzzles/${blackDrop.id}`);
  });

  it('shows a focused next-puzzle button when a winning-advantage line completes mid-game', async () => {
    const redDrop = RED_MATE;
    const blackDrop = BLACK_MATE;
    stubWindowLocalStorage(
      memoryStorage({ 'mistboard:puzzles:seen': JSON.stringify({ [blackDrop.id]: 1 }) }),
    );
    // Winning-advantage puzzles (Jungle material tactics) complete while the game is still in progress: the server reports
    // complete: true with a state whose status is still 'playing'. Reshape the
    // real attempt to that contract so the solved CTA is exercised against it.
    const solvedAttempt = attemptStandardXiangqiPuzzleLine(
      redDrop,
      redDrop.solution.filter((_, ply) => ply % 2 === 0),
    );
    if (!solvedAttempt.ok) throw new Error('expected a solved attempt fixture');
    const midGameAttempt = {
      ...solvedAttempt,
      state: { ...solvedAttempt.state, status: { type: 'playing', turn: 'black' } },
    };
    const winningAdvantageSummary = {
      ...publicSummary(redDrop),
      goal: { type: 'winning-advantage', winner: 'red' },
    };
    const fetchSpy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/puzzles')
        return json({ puzzles: [winningAdvantageSummary, publicSummary(blackDrop)] });
      if (url === `/api/puzzles/${redDrop.id}`)
        return json({ puzzle: { ...winningAdvantageSummary, initial: redDrop.initial } });
      if (url === `/api/puzzles/${blackDrop.id}`) return json({ puzzle: publicDetail(blackDrop) });
      if (url === `/api/puzzles/${redDrop.id}/attempt`) return json({ attempt: midGameAttempt });
      return json({ error: 'not_found' }, 404);
    });
    vi.stubGlobal('fetch', fetchSpy);
    const root = document.createElement('div');
    document.body.append(root);

    await mountPuzzles(root, redDrop.id);
    await clickSquares(root, redDrop.solution[0]!);

    await vi.waitFor(() => expect(root.textContent).toContain('Success!'));
    const nextButton = root.querySelector<HTMLButtonElement>('[data-puzzle-next]');
    expect(nextButton).not.toBeNull();
    expect(nextButton?.textContent).toBe('Next puzzle');
    expect(nextButton?.disabled).toBe(false);
    // Focus lands on the CTA so Enter advances straight away.
    expect(document.activeElement).toBe(nextButton);

    nextButton?.click();

    await vi.waitFor(() =>
      expect(root.querySelector('.puzzle-detail h2')?.textContent).toBe('Black to move'),
    );
    expect(window.location.pathname).toBe(`/puzzles/${blackDrop.id}`);
  });

  it('wraps to the start of the queue when solving the last puzzle', async () => {
    const redDrop = RED_MATE;
    const blackDrop = BLACK_MATE;
    // Mark the deep-linked puzzle seen so it sorts LAST in the rotated queue:
    // solving it exercises the end-of-queue wrap instead of a disabled button.
    stubWindowLocalStorage(
      memoryStorage({ 'mistboard:puzzles:seen': JSON.stringify({ [redDrop.id]: 1 }) }),
    );
    const fetchSpy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/puzzles')
        return json({ puzzles: [publicSummary(redDrop), publicSummary(blackDrop)] });
      if (url === `/api/puzzles/${redDrop.id}`) return json({ puzzle: publicDetail(redDrop) });
      if (url === `/api/puzzles/${blackDrop.id}`) return json({ puzzle: publicDetail(blackDrop) });
      if (url === `/api/puzzles/${redDrop.id}/attempt`)
        return json({
          attempt: attemptStandardXiangqiPuzzleLine(redDrop, movesOf(init)),
        });
      return json({ error: 'not_found' }, 404);
    });
    vi.stubGlobal('fetch', fetchSpy);
    const root = document.createElement('div');

    await mountPuzzles(root, redDrop.id);
    await solveLine(root, redDrop);

    await vi.waitFor(() => expect(root.textContent).toContain('Success!'));
    const nextButton = root.querySelector<HTMLButtonElement>('[data-puzzle-next]');
    expect(nextButton?.disabled).toBe(false);

    nextButton?.click();

    await vi.waitFor(() =>
      expect(root.querySelector('.puzzle-detail h2')?.textContent).toBe('Black to move'),
    );
    expect(fetchSpy).toHaveBeenCalledWith(`/api/puzzles/${blackDrop.id}`);
    expect(window.location.pathname).toBe(`/puzzles/${blackDrop.id}`);
  });

  it('offers a skip to the next puzzle after a failed attempt', async () => {
    const redDrop = RED_MATE;
    const blackDrop = BLACK_MATE;
    stubWindowLocalStorage(
      memoryStorage({ 'mistboard:puzzles:seen': JSON.stringify({ [blackDrop.id]: 1 }) }),
    );
    const qualityEvents: Array<{ sessionId: string; event: string }> = [];
    const fetchSpy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/puzzles')
        return json({ puzzles: [publicSummary(redDrop), publicSummary(blackDrop)] });
      if (url === `/api/puzzles/${redDrop.id}`) return json({ puzzle: publicDetail(redDrop) });
      if (url === `/api/puzzles/${blackDrop.id}`) return json({ puzzle: publicDetail(blackDrop) });
      if (url.endsWith('/quality')) {
        qualityEvents.push(JSON.parse(String(init?.body)));
        return new Response(null, { status: 204 });
      }
      if (url === `/api/puzzles/${redDrop.id}/attempt`)
        return json({
          // A legal move that is not the solution: incorrect-move.
          attempt: attemptStandardXiangqiPuzzleLine(redDrop, movesOf(init)),
        });
      return json({ error: 'not_found' }, 404);
    });
    vi.stubGlobal('fetch', fetchSpy);
    const root = document.createElement('div');

    await mountPuzzles(root, redDrop.id);
    expect(root.querySelector('[data-puzzle-skip]')).toBeNull();
    const solution = redDrop.solution[0]!;
    const wrong = getStandardXiangqiLegalMoves(redDrop.initial).find(
      (move) => !standardXiangqiPuzzleMoveEquals(move, solution),
    )!;
    await clickSquares(root, wrong);

    await vi.waitFor(() => expect(root.textContent).toContain('Try again'));
    const skipButton = root.querySelector<HTMLButtonElement>('[data-puzzle-skip]');
    expect(skipButton?.textContent).toBe('Skip to the next puzzle');
    // The solved CTA stays reserved for solves.
    expect(root.querySelector('[data-puzzle-next]')).toBeNull();

    skipButton?.click();

    await vi.waitFor(() =>
      expect(root.querySelector('.puzzle-detail h2')?.textContent).toBe('Black to move'),
    );
    expect(qualityEvents.some((event) => event.event === 'abandon')).toBe(true);
    expect(fetchSpy).toHaveBeenCalledWith(`/api/puzzles/${blackDrop.id}`);
  });

  it('auto-advances after solving when the immediate next toggle is enabled', async () => {
    const redDrop = RED_MATE;
    const blackDrop = BLACK_MATE;
    // Pin the queue order (see the navigation test): the seen puzzle sorts after
    // the unseen deep-linked one, so auto-advance lands on it deterministically.
    const storage = memoryStorage({
      'mistboard:puzzles:seen': JSON.stringify({ [blackDrop.id]: 1 }),
    });
    stubWindowLocalStorage(storage);
    const fetchSpy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/puzzles')
        return json({ puzzles: [publicSummary(redDrop), publicSummary(blackDrop)] });
      if (url === `/api/puzzles/${redDrop.id}`) return json({ puzzle: publicDetail(redDrop) });
      if (url === `/api/puzzles/${blackDrop.id}`) return json({ puzzle: publicDetail(blackDrop) });
      if (url === `/api/puzzles/${redDrop.id}/attempt`) {
        expect(JSON.parse(String(init?.body))).toEqual(
          expect.objectContaining({
            moves: expect.any(Array),
            rated: true,
          }),
        );
        return json({
          attempt: attemptStandardXiangqiPuzzleLine(redDrop, movesOf(init)),
        });
      }
      return json({ error: 'not_found' }, 404);
    });
    vi.stubGlobal('fetch', fetchSpy);
    const root = document.createElement('div');

    await mountPuzzles(root, redDrop.id);
    const autoNext = root.querySelector<HTMLInputElement>('[data-puzzle-auto-next]')!;
    expect(autoNext.checked).toBe(false);
    autoNext.checked = true;
    autoNext.dispatchEvent(new Event('change', { bubbles: true }));
    expect(storage.getItem('mistboard:puzzles:auto-next')).toBe('true');

    await solveLine(root, redDrop);

    await vi.waitFor(() =>
      expect(root.querySelector('.puzzle-detail h2')?.textContent).toBe('Black to move'),
    );
    expect(window.location.pathname).toBe(`/puzzles/${blackDrop.id}`);
  });

  it('leads with an unseen puzzle over a recently seen one and records visits', async () => {
    const redDrop = RED_MATE;
    const blackDrop = BLACK_MATE;
    // The black puzzle was seen recently; the red one is unseen. Rotation must
    // lead with the unseen puzzle even though the server lists the seen one first.
    const storage = memoryStorage({
      'mistboard:puzzles:seen': JSON.stringify({ [blackDrop.id]: 1 }),
    });
    stubWindowLocalStorage(storage);
    const fetchSpy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/puzzles')
        return json({ puzzles: [publicSummary(blackDrop), publicSummary(redDrop)] });
      if (url === `/api/puzzles/${redDrop.id}`) return json({ puzzle: publicDetail(redDrop) });
      if (url === `/api/puzzles/${blackDrop.id}`) return json({ puzzle: publicDetail(blackDrop) });
      return json({ error: 'not_found' }, 404);
    });
    vi.stubGlobal('fetch', fetchSpy);
    const root = document.createElement('div');

    await mountPuzzles(root, null);

    await vi.waitFor(() =>
      expect(root.querySelector('.puzzle-detail h2')?.textContent).toBe('Red to move'),
    );
    expect(fetchSpy).toHaveBeenCalledWith(`/api/puzzles/${redDrop.id}`);
    // Visiting a puzzle records it in the seen-set for the next visit's rotation.
    expect(storage.getItem('mistboard:puzzles:seen')).toContain(redDrop.id);
  });

  it('restores solved markers from local storage', async () => {
    const drop = RED_MATE;
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key: string) =>
        key === 'mistboard:puzzles:solved' ? JSON.stringify([drop.id]) : null,
      ),
      setItem: vi.fn(),
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === '/api/puzzles') return json({ puzzles: [publicSummary(drop)] });
        if (url === `/api/puzzles/${drop.id}`) return json({ puzzle: publicDetail(drop) });
        return json({ error: 'not_found' }, 404);
      }),
    );
    const root = document.createElement('div');

    await mountPuzzles(root, drop.id);

    expect(root.querySelector('.puzzle-current-card')?.textContent).toContain('Solved');
    expect(root.querySelector('.puzzles-sidebar')?.textContent).not.toContain(' / ');
  });
});

// ── Standard xiangqi (mined real-game corpus) ────────────────────────────────
// Drives the player state machine with real puzzles from the 142-strong mined
// registry: the mocked server answers attempts through the real kernel
// (attemptStandardXiangqiPuzzleLine), exactly like apps/server does.

describe('standard xiangqi puzzles', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    document.body.innerHTML = '';
    stubWindowLocalStorage(memoryStorage());
    window.history.replaceState(null, '', '/');
  });

  const minedByPlyCount = (plies: number): XiangqiPuzzle =>
    XIANGQI_PUZZLES.find((puzzle) => puzzle.solution.length === plies)!;

  const solverMovesOf = (puzzle: XiangqiPuzzle): XiangqiMove[] =>
    puzzle.solution.filter((_, ply) => ply % 2 === 0);

  const moveLabel = (move: XiangqiMove): string => `${move.from}-${move.to}`;

  function xiangqiFetchMock(puzzles: readonly XiangqiPuzzle[]) {
    return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/puzzles') return json({ puzzles: puzzles.map(publicSummary) });
      for (const puzzle of puzzles) {
        if (url === `/api/puzzles/${puzzle.id}`) return json({ puzzle: publicDetail(puzzle) });
        if (url === `/api/puzzles/${puzzle.id}/attempt`) {
          expect(init?.method).toBe('POST');
          const body = JSON.parse(String(init?.body)) as { moves: XiangqiMove[] };
          return json({ attempt: attemptStandardXiangqiPuzzleLine(puzzle, body.moves) });
        }
      }
      return json({ error: 'not_found' }, 404);
    });
  }

  // Waits out any pause that holds the board (the ✓ before a scripted reply,
  // a wrong try's take-back) the way a solver would, then plays the move.
  // `held` clicks at once, to check that a held board ignores the move.
  async function clickMove(
    root: HTMLElement,
    move: XiangqiMove,
    opts: { held?: boolean } = {},
  ): Promise<void> {
    if (!opts.held) await waitForLiveBoard(root);
    root
      .querySelector<SVGGElement>(`[data-square="${move.from}"]`)
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    root
      .querySelector<SVGGElement>(`[data-square="${move.to}"]`)
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  }

  describe('Storm solver support', () => {
    const detailOf = (puzzle: XiangqiPuzzle) =>
      publicDetail(puzzle) as Parameters<typeof mountPuzzleSolver>[1];
    const feedback = () => document.createElement('div');
    const capture = vi.fn<(name: string, props?: Record<string, unknown>) => void>();
    beforeEach(() => {
      capture.mockReset();
      setPostHogInstance({ capture, identify: vi.fn(), reset: vi.fn() });
    });
    afterEach(() => setPostHogInstance({ capture: vi.fn(), identify: vi.fn(), reset: vi.fn() }));

    it('opens a copied Storm result link as an unrated solver without starting a run', async () => {
      const puzzle = minedByPlyCount(3);
      stubWindowLocalStorage(memoryStorage());
      const fetchSpy = xiangqiFetchMock([puzzle]);
      vi.stubGlobal('fetch', fetchSpy);
      window.history.replaceState(null, '', `/puzzles?mode=storm&review=${puzzle.id}`);
      const root = document.createElement('div');
      document.body.append(root);
      await mountPuzzles(root);
      try {
        await vi.waitFor(() => expect(root.textContent).toContain('Unrated review'));
        await vi.waitFor(() => expect(root.querySelector('.puzzle-board')).not.toBeNull());
        await clickMove(root, puzzle.solution[0]!, { held: true });
        await vi.waitFor(() => expect(root.textContent).toContain('Correct.'));
        const attempt = fetchSpy.mock.calls.find(([url]) => String(url).endsWith('/attempt'));
        expect(JSON.parse(String(attempt?.[1]?.body)).rated).toBe(false);
        expect(fetchSpy.mock.calls.some(([url]) => url === '/api/puzzles/storm')).toBe(false);
        expect(root.textContent).toContain('Unrated review');
      } finally {
        window.dispatchEvent(new Event('pagehide'));
      }
    });

    it('skips the setup and reply pauses for fast timed play', async () => {
      const puzzle = minedByPlyCount(3);
      // A reconstructable setup move from the public position, including captures.
      const last = puzzle.initial.lastMove!;
      const host = document.createElement('div');
      document.body.append(host);
      const onAttempt = vi.fn();
      const submitAttempt = vi.fn(async (_id: string, moves: readonly PuzzleMove[]) => ({
        attempt: attemptStandardXiangqiPuzzleLine(puzzle, moves as XiangqiMove[]),
        rating: null,
      }));
      const solver = mountPuzzleSolver(
        host,
        { ...detailOf(puzzle), setupMove: { ...last, captured: null } },
        {
          mode: 'storm',
          analysis: false,
          feedback,
          submitAttempt,
          onAttempt,
        },
      );
      try {
        expect(host.querySelector<HTMLElement>('.puzzle-board')?.dataset.puzzleLive).toBe('true');
        await clickMove(host, puzzle.solution[0]!, { held: true });
        await vi.waitFor(() => expect(onAttempt).toHaveBeenCalledTimes(1));
        expect(host.querySelector<HTMLElement>('.puzzle-board')?.dataset.puzzleLive).toBe('true');
        expect(host.textContent).toContain(moveLabel(puzzle.solution[1]!));
        await clickMove(host, puzzle.solution[2]!, { held: true });
        await vi.waitFor(() => expect(onAttempt).toHaveBeenCalledTimes(2));
        expect(capture.mock.calls.filter(([name]) => name === 'puzzle_attempted')).toEqual([
          [
            'puzzle_attempted',
            expect.objectContaining({
              mode: 'storm',
              rated: false,
              outcome: 'solved',
              clean: true,
            }),
          ],
        ]);
      } finally {
        solver.dispose();
      }
    });

    it('restores a partial line without resubmitting or counting its moves again', async () => {
      const puzzle = minedByPlyCount(3);
      const progress = attemptStandardXiangqiPuzzleLine(puzzle, [puzzle.solution[0]!]);
      if (!progress.ok) throw new Error('fixture must have accepted progress');
      const host = document.createElement('div');
      document.body.append(host);
      const onAttempt = vi.fn();
      const onSolved = vi.fn();
      const submitAttempt = vi.fn(async (_id: string, moves: readonly PuzzleMove[]) => ({
        attempt: attemptStandardXiangqiPuzzleLine(puzzle, moves as XiangqiMove[]),
        rating: null,
      }));
      const solver = mountPuzzleSolver(host, detailOf(puzzle), {
        mode: 'storm',
        analysis: false,
        feedback,
        initialAttempt: progress,
        submitAttempt,
        onAttempt,
        onSolved,
      });
      try {
        expect(host.textContent).toContain(moveLabel(puzzle.solution[1]!));
        expect(submitAttempt).not.toHaveBeenCalled();
        expect(onAttempt).not.toHaveBeenCalled();
        expect(capture).not.toHaveBeenCalled();
        await clickMove(host, puzzle.solution[2]!, { held: true });
        await vi.waitFor(() => expect(onSolved).toHaveBeenCalledWith(puzzle.id));
        expect(submitAttempt.mock.calls[0]?.[1]).toEqual(solverMovesOf(puzzle));
        expect(onAttempt).toHaveBeenCalledTimes(1);
      } finally {
        solver.dispose();
      }
    });

    for (const action of ['end', 'dispose'] as const) {
      it(`ignores a late response after ${action}, with no solve or telemetry`, async () => {
        const puzzle = minedByPlyCount(1);
        const host = document.createElement('div');
        document.body.append(host);
        let resolve!: (value: { attempt: PuzzleAttempt; rating: null }) => void;
        const submitAttempt = vi.fn(
          () =>
            new Promise<{ attempt: PuzzleAttempt; rating: null }>((done) => {
              resolve = done;
            }),
        );
        const onAttempt = vi.fn();
        const onSolved = vi.fn();
        const solver = mountPuzzleSolver(host, detailOf(puzzle), {
          mode: 'storm',
          analysis: false,
          feedback,
          submitAttempt,
          onAttempt,
          onSolved,
        });
        try {
          await clickMove(host, puzzle.solution[0]!, { held: true });
          expect(submitAttempt).toHaveBeenCalledTimes(1);
          solver[action]();
          const ended = host.innerHTML;
          resolve({
            attempt: attemptStandardXiangqiPuzzleLine(puzzle, [puzzle.solution[0]!]),
            rating: null,
          });
          // Flush the promise chain without waiting out any animation timers.
          for (let i = 0; i < 8; i++) await Promise.resolve();
          expect(host.innerHTML).toBe(ended);
          expect(onAttempt).not.toHaveBeenCalled();
          expect(onSolved).not.toHaveBeenCalled();
          expect(capture).not.toHaveBeenCalled();
          await clickMove(host, puzzle.solution[0]!, { held: true });
          expect(submitAttempt).toHaveBeenCalledTimes(1);
        } finally {
          solver.dispose();
        }
      });
    }

    it('counts a Storm miss once and leaves checker errors out of telemetry', async () => {
      const puzzle = minedByPlyCount(3);
      const host = document.createElement('div');
      document.body.append(host);
      const wrong = getStandardXiangqiLegalMoves(puzzle.initial).find((move) => {
        const attempt = attemptStandardXiangqiPuzzleLine(puzzle, [move]);
        return !attempt.ok && attempt.code === 'incorrect-move';
      })!;
      const onAttempt = vi.fn();
      let checkerError = true;
      const solver = mountPuzzleSolver(host, detailOf(puzzle), {
        mode: 'storm',
        analysis: false,
        feedback,
        onAttempt,
        submitAttempt: async (_id, moves) => ({
          attempt: checkerError
            ? { ok: false, code: 'illegal-move', state: puzzle.initial, ply: 0, move: moves[0]! }
            : attemptStandardXiangqiPuzzleLine(puzzle, moves as XiangqiMove[]),
          rating: null,
        }),
      });
      try {
        await clickMove(host, wrong, { held: true });
        await vi.waitFor(() => expect(onAttempt).toHaveBeenCalledTimes(1));
        expect(capture).not.toHaveBeenCalled();
        checkerError = false;
        await clickMove(host, wrong, { held: true });
        await vi.waitFor(() => expect(onAttempt).toHaveBeenCalledTimes(2));
        expect(capture.mock.calls.filter(([name]) => name === 'puzzle_attempted')).toEqual([
          [
            'puzzle_attempted',
            expect.objectContaining({
              mode: 'storm',
              rated: false,
              outcome: 'failed',
              clean: false,
            }),
          ],
        ]);
        await clickMove(host, wrong, { held: true });
        expect(onAttempt).toHaveBeenCalledTimes(2);
      } finally {
        solver.dispose();
      }
    });
  });

  it('renders a mined puzzle on the canonical 9x10 board', async () => {
    const puzzle = minedByPlyCount(3);
    vi.stubGlobal('fetch', xiangqiFetchMock([puzzle]));
    const root = document.createElement('div');

    await mountPuzzles(root, puzzle.id);

    expect(root.querySelector('.puzzle-xiangqi-board')).not.toBeNull();
    expect(root.querySelector('.xq-live-svg')).not.toBeNull();
    // No reserves on the open-information board.
    expect(root.querySelector('.puzzle-board-shell')).toBeNull();
    // Xiangqi is the sole surfaced variant, so the redundant picker stays hidden.
    const select = root.querySelector<HTMLSelectElement>('[data-puzzle-variant]');
    expect(select).toBeNull();
    expect(root.querySelector('.puzzles-sidebar')?.textContent).toContain('From set Xiangqi');
    // Every intersection carries a click target for the shared drag helper.
    expect(root.querySelectorAll('[data-square]').length).toBe(90);
  });

  it('a reload past a finished puzzle opens the next unseen one; a link still opens it', async () => {
    // Every Next pushes /puzzles/<id>, so a reload lands on the last puzzle
    // opened. Solving it and reloading used to serve the solved puzzle again.
    const [done, fresh] = [XIANGQI_PUZZLES[0]!, XIANGQI_PUZZLES[1]!];
    const mountAt = async (navigationType: NavigationTimingType) => {
      stubWindowLocalStorage(
        memoryStorage({
          'mistboard:puzzles:solved': JSON.stringify([done.id]),
          'mistboard:puzzles:seen': JSON.stringify({ [done.id]: Date.now() }),
        }),
      );
      vi.spyOn(performance, 'getEntriesByType').mockReturnValue([
        { type: navigationType } as PerformanceNavigationTiming,
      ]);
      resetPuzzleReloadCheckForTest();
      window.history.replaceState(null, '', `/puzzles/${done.id}`);
      const fetchSpy = xiangqiFetchMock([done, fresh]);
      vi.stubGlobal('fetch', fetchSpy);
      await mountPuzzles(document.createElement('div'), done.id);
      return fetchSpy;
    };

    const reloaded = await mountAt('reload');
    expect(reloaded).toHaveBeenCalledWith(`/api/puzzles/${fresh.id}`);
    expect(reloaded).not.toHaveBeenCalledWith(`/api/puzzles/${done.id}`);
    expect(window.location.pathname).toBe(`/puzzles/${fresh.id}`);

    // A shared or bookmarked link is not a reload: it opens what it names.
    const linked = await mountAt('navigate');
    expect(linked).toHaveBeenCalledWith(`/api/puzzles/${done.id}`);
    expect(window.location.pathname).toBe(`/puzzles/${done.id}`);
  });

  it('paints a standard puzzle with the saved xiangqi piece set', async () => {
    stubWindowLocalStorage(
      memoryStorage({
        'mistboard.xiangqiPieceSetVersion': '3',
        'mistboard.xiangqiPieceSet': 'animal-dobutsu',
      }),
    );
    const puzzle = minedByPlyCount(3);
    vi.stubGlobal('fetch', xiangqiFetchMock([puzzle]));
    const root = document.createElement('div');

    await mountPuzzles(root, puzzle.id);

    const hrefs = [...root.querySelectorAll('.xq-piece image')].map((image) =>
      image.getAttribute('href'),
    );
    expect(hrefs.length).toBeGreaterThan(0);
    expect(hrefs.every((href) => href?.includes('/animal-dobutsu/'))).toBe(true);
  });

  it('repaints a mounted standard puzzle when the board layout changes', async () => {
    const puzzle = minedByPlyCount(3);
    vi.stubGlobal('fetch', xiangqiFetchMock([puzzle]));
    const root = document.createElement('div');

    await mountPuzzles(root, puzzle.id);
    expect(root.querySelector('.xq-live-svg--intersection')).not.toBeNull();

    window.history.replaceState(null, '', '/puzzles?xqLayout=cell');
    window.dispatchEvent(new Event(xiangqiAppearanceChangedEvent));

    await vi.waitFor(() => expect(root.querySelector('.xq-live-svg--cell')).not.toBeNull());
    expect(root.querySelector('.xq-live-cell-river')).not.toBeNull();
  });

  it('solves a mined puzzle, auto-playing the scripted opponent reply', async () => {
    const puzzle = minedByPlyCount(3);
    const solver = solverMovesOf(puzzle);
    const fetchSpy = xiangqiFetchMock([puzzle]);
    vi.stubGlobal('fetch', fetchSpy);
    const root = document.createElement('div');
    document.body.append(root);

    await mountPuzzles(root, puzzle.id);
    await clickMove(root, solver[0]!);

    await vi.waitFor(() => expect(root.textContent).toContain('Correct.'));
    // The defender's scripted reply auto-played and both moves hit the move list.
    expect(root.textContent).toContain(moveLabel(puzzle.solution[0]!));
    await vi.waitFor(() => expect(root.textContent).toContain(moveLabel(puzzle.solution[1]!)));
    // Last-move highlight (gold ring) from the canonical board module.
    expect(root.querySelector('.xq-live-lastmove-ring')).not.toBeNull();

    await clickMove(root, solver[1]!);

    await vi.waitFor(() => expect(root.textContent).toContain('Success!'));
    expect(root.textContent).toContain(moveLabel(puzzle.solution[2]!));
    expect(fetchSpy).toHaveBeenCalledWith(
      `/api/puzzles/${puzzle.id}/attempt`,
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('names the kill pattern in the info card once a mate puzzle is solved', async () => {
    const puzzle = XIANGQI_PUZZLES.find(
      (candidate) =>
        candidate.goal.type === 'checkmate' && detectXiangqiPuzzleMotifs(candidate).length > 0,
    );
    expect(puzzle, 'the seed corpus must hold one tagged mate puzzle').toBeDefined();
    const motif = XIANGQI_MOTIF_BY_ID.get(detectXiangqiPuzzleMotifs(puzzle!)[0]!)!;
    vi.stubGlobal('fetch', xiangqiFetchMock([puzzle!]));
    const root = document.createElement('div');
    document.body.append(root);

    await mountPuzzles(root, puzzle!.id);
    // Spoiler-gated: the pattern names the mate, so it stays hidden until solved.
    expect(root.querySelector('.puzzle-tag-motif')).toBeNull();
    // Lichess's left column: info, rating, the theme box, then a Settings card
    // (no heading). The puzzle's own themes join the theme box after a solve.
    const sidebarCards = () =>
      [...root.querySelectorAll<HTMLElement>('.puzzle-left-card')].map((card) =>
        [...card.classList].find((name) => name !== 'puzzle-left-card'),
      );
    expect(sidebarCards()).toEqual([
      'puzzle-current-card',
      'puzzle-rating-card',
      'puzzle-theme-card',
      'puzzle-settings-card',
    ]);
    // Nothing stands in for the themes before a solve (no "revealed later" note).
    expect(root.querySelector('[data-puzzle-solved-themes]')).toBeNull();
    expect(root.textContent).not.toContain('Revealed after you solve it.');
    const settings = root.querySelector<HTMLElement>(
      '.puzzle-settings-card [data-puzzle-settings]',
    );
    expect(settings?.getAttribute('role')).toBe('group');
    expect(settings?.getAttribute('aria-label')).toBe('Settings');
    const autoNext = settings?.querySelector('[data-puzzle-auto-next]');
    const difficulty = settings?.querySelector('[data-puzzle-difficulty]');
    expect(autoNext).not.toBeNull();
    expect(difficulty).not.toBeNull();
    // Jump toggle first, then the difficulty row.
    expect(
      autoNext!.compareDocumentPosition(difficulty!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(root.querySelector('.puzzle-rating-card [data-puzzle-settings]')).toBeNull();
    expect(root.querySelector('.puzzles-sidebar h2')?.textContent).not.toBe('Settings');
    // The rating sits on the toggle's row, not under it as a headline.
    expect(
      root
        .querySelector('.puzzle-rating-head [data-puzzle-rated]')
        ?.closest('.puzzle-rating-head')
        ?.querySelector('.puzzle-rating-summary'),
    ).not.toBeNull();
    // The theme box's heading is the link back to the themes page (lichess's
    // "« Puzzle Themes"), over what the current choice drills.
    const themeCard = root.querySelector<HTMLElement>('.puzzle-theme-card');
    const back = themeCard?.querySelector<HTMLAnchorElement>('h2 a[href="/puzzles/themes"]');
    expect(back?.textContent).toBe('‹Puzzle themes');
    expect(themeCard?.querySelector('.puzzle-theme-card__description')?.textContent).toBe(
      'Every theme shuffled together, as positions come up in a real game: no hint of what is coming.',
    );
    expect(themeCard?.querySelector('select[data-puzzle-theme]')).not.toBeNull();
    expect(settings?.querySelector('a[href="/puzzles/themes"]')).toBeNull();
    for (const move of solverMovesOf(puzzle!)) {
      await clickMove(root, move);
      await vi.waitFor(() => expect(root.textContent).toMatch(/Correct\.|Success!/));
    }

    await vi.waitFor(() => expect(root.textContent).toContain('Success!'));
    // The solved puzzle's themes sit in the theme box, under its picker, and
    // the info card stays compact.
    const shownRow = root.querySelector<HTMLElement>(
      '.puzzle-theme-card [data-puzzle-solved-themes]',
    );
    expect(shownRow?.getAttribute('aria-label')).toBe('Puzzle themes');
    expect(root.querySelector('.puzzle-info-card .puzzle-tag')).toBeNull();
    expect(root.querySelector('.puzzle-theme-card')?.lastElementChild).toBe(shownRow);
    const chip = shownRow?.querySelector<HTMLElement>('.puzzle-tag-motif');
    // English names only in en: no hanzi, no pinyin tooltip.
    expect(chip?.textContent).toBe(motif.label);
    // A drillable theme links to its drill.
    expect(chip?.getAttribute('href')).toBe(`/puzzles?theme=${motif.id}`);
    expect(chip?.textContent).not.toMatch(/[\u3400-\u9fff]/);
    expect(chip?.title).not.toBe(motif.pinyin);
    // Theme tags read as names, never as the raw id ("Matein2").
    const themeChips = [...root.querySelectorAll('.puzzle-tag:not(.puzzle-tag-motif)')].map(
      (tag) => tag.textContent,
    );
    expect(themeChips.length).toBeGreaterThan(0);
    for (const label of themeChips) expect(label).not.toMatch(/^Matein|^Winning-|-/);
  });

  it('glides ONLY the scripted opponent reply after a correct move, and reverses on a back-step', async () => {
    const puzzle = minedByPlyCount(3);
    vi.stubGlobal('fetch', xiangqiFetchMock([puzzle]));
    // Record which keyed piece slots receive a WAAPI glide (happy-dom has no
    // Element.animate; installing one captures every glide the page issues).
    const glides: Array<string | null> = [];
    const proto = Element.prototype as unknown as { animate?: unknown };
    const originalAnimate = proto.animate;
    proto.animate = function (this: Element) {
      glides.push(this.getAttribute('data-piece-square'));
      return { cancel: () => {} };
    };
    const root = document.createElement('div');
    document.body.append(root);
    // The gold last-move ring also fades in on arrival (a non-piece <circle> with
    // no data-piece-square, so it records as null); this test only cares about
    // which PIECE slots glide, so filter the marker fades out.
    const pieceGlides = (): Array<string | null> => glides.filter((square) => square !== null);
    try {
      await mountPuzzles(root, puzzle.id);
      expect(glides).toHaveLength(0); // the initial paint is discrete

      const found = solverMovesOf(puzzle)[0]!;
      await clickMove(root, found);
      await vi.waitFor(() => expect(root.textContent).toContain('Correct.'));
      // The board holds on the solver's move under a green ✓ (lichess), and
      // takes no input until the reply is in.
      const reply = puzzle.solution[1]!;
      expect(pieceGlides()).toEqual([]);
      const check = root.querySelector('.xq-marker--good.xq-marker--glyph');
      expect(check?.querySelector('.xq-marker__icon')).not.toBeNull();
      expect(root.querySelector<HTMLElement>('.puzzle-board')?.dataset.puzzleLive).toBe('false');
      // The list keeps the reply back until the board plays it.
      const movesListed = () =>
        [...root.querySelectorAll('.puzzle-move-red, .puzzle-move-black')].filter((cell) =>
          cell.textContent?.trim(),
        ).length;
      const listedInPause = movesListed();
      // Then only the reply glides (the solver chose their own move an instant ago).
      await vi.waitFor(() => expect(pieceGlides()).toEqual([reply.to]));
      expect(root.querySelector('.xq-marker--glyph')).toBeNull();
      expect(movesListed()).toBe(listedInPause + 1);

      // Replay back-step reverse-glides the undone reply at its origin square.
      root.querySelector<HTMLButtonElement>('[data-puzzle-replay-previous]')?.click();
      expect(pieceGlides()).toEqual([reply.to, reply.from]);
    } finally {
      if (originalAnimate === undefined) delete proto.animate;
      else proto.animate = originalAnimate;
    }
  });

  it('rejects a legal non-solution move and lets the solver retry in place', async () => {
    const puzzle = minedByPlyCount(5);
    const solver = solverMovesOf(puzzle);
    const wrong = getStandardXiangqiLegalMoves(puzzle.initial).find(
      (move) => !standardXiangqiPuzzleMoveEquals(move, puzzle.solution[0]!),
    )!;
    vi.stubGlobal('fetch', xiangqiFetchMock([puzzle]));
    const root = document.createElement('div');

    await mountPuzzles(root, puzzle.id);
    await clickMove(root, wrong);

    await vi.waitFor(() => expect(root.textContent).toContain('Try again'));
    // The board did not advance: the correct first move still works immediately.
    await clickMove(root, solver[0]!);

    await vi.waitFor(() => expect(root.textContent).toContain('Correct.'));
    await vi.waitFor(() => expect(root.textContent).toContain(moveLabel(puzzle.solution[1]!)));
  });

  it('keeps a wrong try as a ✗ row, marks found moves ✓, and shows the rating once over', async () => {
    const puzzle = minedByPlyCount(3);
    const solver = solverMovesOf(puzzle);
    const wrong = getStandardXiangqiLegalMoves(puzzle.initial).find(
      (move) => !standardXiangqiPuzzleMoveEquals(move, puzzle.solution[0]!),
    )!;
    vi.stubGlobal('fetch', xiangqiFetchMock([puzzle]));
    const root = document.createElement('div');
    document.body.append(root);

    await mountPuzzles(root, puzzle.id);
    // The puzzle's own rating is a spoiler while it is in play.
    expect(root.textContent).toContain('Rating: hidden');
    // The session row holds only the puzzle in play, as the blue current chip.
    const chipsBefore = root.querySelector('.puzzle-session-chips');
    expect(chipsBefore?.querySelectorAll('.puzzle-streak-chip--current')).toHaveLength(1);

    await clickMove(root, wrong);
    await vi.waitFor(() => expect(root.textContent).toContain('Try again'));
    // The miss shows on the board under a red ✗, then is taken back.
    expect(root.querySelector(`[data-piece-square="${wrong.to}"]`)).not.toBeNull();
    expect(
      root.querySelector('.xq-marker--blunder.xq-marker--glyph .xq-marker__icon'),
    ).not.toBeNull();
    await waitForLiveBoard(root);
    expect(root.querySelector(`[data-piece-square="${wrong.from}"]`)).not.toBeNull();
    expect(root.querySelector('.xq-marker--blunder')).toBeNull();
    // It stays in the list after it is taken back.
    const variation = root.querySelector('.puzzle-move-variation');
    expect(variation?.textContent).toContain(moveLabel(wrong));
    expect(variation?.querySelector('.puzzle-move-cell--wrong')?.textContent).toContain('✗');

    await clickMove(root, solver[0]!);
    await vi.waitFor(() => expect(root.textContent).toContain('Correct.'));
    // The retry still lands, and the earlier miss is still listed.
    expect(root.querySelector('.puzzle-move-variation')?.textContent).toContain(moveLabel(wrong));
    await clickMove(root, solver[1]!);
    await vi.waitFor(() => expect(root.textContent).toContain('Success!'));

    // Only the solver's finds are ✓; the scripted reply is not.
    const right = [...root.querySelectorAll('.puzzle-move-cell--right')].map((cell) =>
      cell.textContent?.trim(),
    );
    expect(right).toEqual([`${moveLabel(solver[0]!)} ✓`, `${moveLabel(solver[1]!)} ✓`]);
    // Over: the puzzle's rating is out.
    expect(root.textContent).toContain('Rating: 1500');
    // A miss on the way makes the session chip a failure.
    const chips = [
      ...root.querySelectorAll<HTMLElement>('.puzzle-session-chips .puzzle-streak-chip'),
    ];
    expect(chips.map((chip) => [chip.dataset.outcome, chip.textContent])).toEqual([
      ['failed', '✗'],
    ]);
    expect(chips[0]?.getAttribute('aria-current')).toBe('step');
  });

  it('marks the revealed moves and records the reveal as a miss', async () => {
    const puzzle = minedByPlyCount(3);
    const base = xiangqiFetchMock([puzzle]);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
        String(input) === `/api/puzzles/${puzzle.id}/reveal`
          ? json({ solution: puzzle.solution })
          : base(input, init),
      ),
    );
    const root = document.createElement('div');
    document.body.append(root);

    await mountPuzzles(root, puzzle.id);
    root.querySelector<HTMLButtonElement>('[data-puzzle-reveal]')?.click();

    await vi.waitFor(() =>
      expect(root.querySelectorAll('.puzzle-move-cell--revealed')).toHaveLength(
        puzzle.solution.length,
      ),
    );
    expect(root.querySelector('.puzzle-move-cell--right')).toBeNull();
    expect(root.textContent).toContain('Rating: 1500');
    // The played-out answer ends in mate, so the board is finished; a reveal
    // is still a give-up, never "Success!".
    await vi.waitFor(() => expect(root.querySelector('.puzzle-revealed-panel')).not.toBeNull());
    expect(root.textContent).not.toContain('Success!');
    const chip = root.querySelector<HTMLElement>('.puzzle-session-chips .puzzle-streak-chip');
    expect(chip?.dataset.outcome).toBe('failed');
  });

  it('a solution still playing back stops once the same puzzle is reopened', async () => {
    // 10-31 CI: the reveal playback only checked the board's puzzle id, so after
    // the same puzzle was opened again it kept stepping its old session onto the
    // board, and the new session's reply bailed as not painted: no move ever
    // went live again. Seven plies keep the old playback stepping across every
    // reply pause of the second solve.
    const puzzle = minedByPlyCount(7);
    const base = xiangqiFetchMock([puzzle]);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
        String(input) === `/api/puzzles/${puzzle.id}/reveal`
          ? json({ solution: puzzle.solution })
          : base(input, init),
      ),
    );
    const revealed = document.createElement('div');
    document.body.append(revealed);
    await mountPuzzles(revealed, puzzle.id);
    revealed.querySelector<HTMLButtonElement>('[data-puzzle-reveal]')?.click();
    await vi.waitFor(() =>
      expect(revealed.querySelector('.puzzle-move-cell--revealed')).not.toBeNull(),
    );
    revealed.remove();

    const root = document.createElement('div');
    document.body.append(root);
    await mountPuzzles(root, puzzle.id);
    for (const move of solverMovesOf(puzzle)) {
      await clickMove(root, move);
      await vi.waitFor(() => expect(root.textContent).toContain(moveLabel(move)));
    }
    await vi.waitFor(() => expect(root.textContent).toContain('Success!'));
  });

  it('adds a ✓ chip per solved puzzle and reopens a past one from its chip', async () => {
    const threes = XIANGQI_PUZZLES.filter((puzzle) => puzzle.solution.length === 3);
    const [first, second] = [threes[0]!, threes[1]!];
    stubWindowLocalStorage(
      memoryStorage({ 'mistboard:puzzles:seen': JSON.stringify({ [second.id]: 1 }) }),
    );
    vi.stubGlobal('fetch', xiangqiFetchMock([first, second]));
    const root = document.createElement('div');
    document.body.append(root);

    await mountPuzzles(root, first.id);
    for (const move of solverMovesOf(first)) {
      await clickMove(root, move);
      await vi.waitFor(() => expect(root.textContent).toContain(moveLabel(move)));
    }
    await vi.waitFor(() => expect(root.textContent).toContain('Success!'));
    root.querySelector<HTMLButtonElement>('[data-puzzle-next]')?.click();
    await vi.waitFor(() =>
      expect(root.querySelector<HTMLElement>('.puzzle-board')?.dataset.puzzleId).toBe(second.id),
    );

    const row = root.querySelector('.puzzle-session-chips')!;
    const past = row.querySelector<HTMLAnchorElement>('a.puzzle-streak-chip--solved');
    expect(past?.textContent).toBe('✓');
    expect(past?.getAttribute('href')).toBe(`/puzzles/${first.id}`);
    expect(row.lastElementChild?.classList.contains('puzzle-streak-chip--current')).toBe(true);

    past?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await vi.waitFor(() =>
      expect(root.querySelector<HTMLElement>('.puzzle-board')?.dataset.puzzleId).toBe(first.id),
    );
    expect(window.location.pathname).toBe(`/puzzles/${first.id}`);
    // Leaving the second puzzle untouched records nothing for it.
    const outcomes = [
      ...root.querySelectorAll<HTMLElement>('.puzzle-session-chips .puzzle-streak-chip'),
    ].map((chip) => chip.dataset.outcome);
    expect(outcomes).toEqual(['solved']);
  });

  it('advances to the next mined puzzle after a solve', async () => {
    const threes = XIANGQI_PUZZLES.filter((puzzle) => puzzle.solution.length === 3);
    const [first, second] = [threes[0]!, threes[1]!];
    // Pin the rotated queue order: the seen puzzle sorts after the unseen one.
    stubWindowLocalStorage(
      memoryStorage({ 'mistboard:puzzles:seen': JSON.stringify({ [second.id]: 1 }) }),
    );
    const fetchSpy = xiangqiFetchMock([first, second]);
    vi.stubGlobal('fetch', fetchSpy);
    const root = document.createElement('div');
    document.body.append(root);

    await mountPuzzles(root, first.id);
    for (const move of solverMovesOf(first)) {
      await clickMove(root, move);
      // The move label only appears once the attempt response is applied, so
      // this waits out the async submit before the next click.
      await vi.waitFor(() => expect(root.textContent).toContain(moveLabel(move)));
    }
    await vi.waitFor(() => expect(root.textContent).toContain('Success!'));

    const nextButton = root.querySelector<HTMLButtonElement>('[data-puzzle-next]');
    expect(nextButton?.disabled).toBe(false);
    nextButton?.click();

    await vi.waitFor(() => expect(window.location.pathname).toBe(`/puzzles/${second.id}`));
    expect(fetchSpy).toHaveBeenCalledWith(`/api/puzzles/${second.id}`);
  });

  it('plays complete lines across a handful of the mined corpus', async () => {
    // One puzzle per mined line length (3/5/7 plies), each driven through the
    // full click flow against the real kernel.
    for (const plies of [3, 5, 7]) {
      const puzzle = minedByPlyCount(plies);
      vi.stubGlobal('fetch', xiangqiFetchMock([puzzle]));
      const root = document.createElement('div');
      document.body.append(root);

      await mountPuzzles(root, puzzle.id);
      for (const move of solverMovesOf(puzzle)) {
        await clickMove(root, move);
        // Wait for the attempt response (the move label lands with it) before
        // the next click; a pending submit would swallow it.
        await vi.waitFor(() => expect(root.textContent).toContain(moveLabel(move)));
      }
      await vi.waitFor(() => expect(root.textContent).toContain('Success!'));

      root.remove();
      vi.unstubAllGlobals();
      window.history.replaceState(null, '', '/');
    }
  });

  describe('opening glide of the setup move (#664)', () => {
    // The piece-animation duration is cached in board-anim; this event is how a
    // settings change invalidates it, so each test re-reads its own storage.
    const refreshAnimationPreference = (): void => {
      window.dispatchEvent(new Event('mistboard:display-preferences-change'));
    };
    beforeEach(refreshAnimationPreference);
    afterEach(refreshAnimationPreference);

    // A seed puzzle whose setup move rebuilds under the given capture record.
    const withSetup = (
      captured: (puzzle: XiangqiPuzzle) => XiangqiPuzzleSetupMove['captured'],
    ): { puzzle: XiangqiPuzzle; setupMove: XiangqiPuzzleSetupMove } => {
      for (const puzzle of XIANGQI_PUZZLES) {
        const last = puzzle.initial.lastMove;
        if (!last || puzzle.solution.length !== 3) continue;
        const setupMove = { ...last, captured: captured(puzzle) };
        if (xiangqiPuzzlePreSetupState(puzzle.initial, setupMove)) return { puzzle, setupMove };
      }
      throw new Error('the seed corpus must hold a puzzle with a rebuildable setup move');
    };
    const QUIET = withSetup(() => null);
    const CAPTURE = withSetup((puzzle) => ({
      color: puzzle.initial.status.type === 'playing' ? puzzle.initial.status.turn : 'red',
      role: 'soldier',
    }));

    function setupFetchMock(puzzle: XiangqiPuzzle, setupMove: XiangqiPuzzleSetupMove) {
      const base = xiangqiFetchMock([puzzle]);
      return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input) === `/api/puzzles/${puzzle.id}`) {
          return json({ puzzle: { ...publicDetail(puzzle), setupMove } });
        }
        return base(input, init);
      });
    }

    const slotAt = (root: HTMLElement, square: string): Element | null =>
      root.querySelector(`[data-piece-square="${square}"]`);
    const pieceCount = (root: HTMLElement): number =>
      root.querySelectorAll('.xq-piece-slot').length;

    it('opens one move earlier, glides the setup move in, and only then takes input', async () => {
      vi.mocked(playSound).mockClear();
      const { puzzle, setupMove } = QUIET;
      const fetchSpy = setupFetchMock(puzzle, setupMove);
      vi.stubGlobal('fetch', fetchSpy);
      const glides: Array<string | null> = [];
      const proto = Element.prototype as unknown as { animate?: unknown };
      const originalAnimate = proto.animate;
      proto.animate = function (this: Element) {
        glides.push(this.getAttribute('data-piece-square'));
        return { cancel: () => {} };
      };
      const root = document.createElement('div');
      document.body.append(root);
      try {
        await mountPuzzles(root, puzzle.id);
        // The pre-setup position: the opponent's piece still on its origin,
        // and the setup move not yet in the list.
        expect(slotAt(root, setupMove.from)).not.toBeNull();
        expect(slotAt(root, setupMove.to)).toBeNull();
        expect(root.querySelector('.puzzle-move-list')?.textContent ?? '').not.toContain(
          moveLabel(setupMove),
        );
        expect(playSound).not.toHaveBeenCalled();
        // Input is blocked until the hand-over.
        await clickMove(root, solverMovesOf(puzzle)[0]!, { held: true });
        expect(fetchSpy).not.toHaveBeenCalledWith(
          `/api/puzzles/${puzzle.id}/attempt`,
          expect.anything(),
        );

        await vi.waitFor(() => expect(slotAt(root, setupMove.from)).toBeNull());
        expect(slotAt(root, setupMove.to)).not.toBeNull();
        expect(glides).toContain(setupMove.to);
        expect(root.textContent).toContain(moveLabel(setupMove));
        expect(vi.mocked(playSound).mock.calls).toEqual([['move']]);

        await clickMove(root, solverMovesOf(puzzle)[0]!);
        await vi.waitFor(() => expect(root.textContent).toContain('Correct.'));
      } finally {
        if (originalAnimate === undefined) delete proto.animate;
        else proto.animate = originalAnimate;
      }
    });

    it('shows the puzzle position at once when piece animation is off', async () => {
      stubWindowLocalStorage(
        memoryStorage({
          [displayPreferenceStorageKey]: JSON.stringify({ pieceAnimation: 'none' }),
        }),
      );
      refreshAnimationPreference();
      const { puzzle, setupMove } = QUIET;
      vi.stubGlobal('fetch', setupFetchMock(puzzle, setupMove));
      const root = document.createElement('div');
      document.body.append(root);

      await mountPuzzles(root, puzzle.id);
      expect(slotAt(root, setupMove.from)).toBeNull();
      expect(slotAt(root, setupMove.to)).not.toBeNull();
      expect(root.textContent).toContain(moveLabel(setupMove));
      await clickMove(root, solverMovesOf(puzzle)[0]!);
      await vi.waitFor(() => expect(root.textContent).toContain('Correct.'));
    });

    it('puts a captured piece back on its square in the pre-setup position', async () => {
      vi.mocked(playSound).mockClear();
      const { puzzle, setupMove } = CAPTURE;
      vi.stubGlobal('fetch', setupFetchMock(puzzle, setupMove));
      const root = document.createElement('div');
      document.body.append(root);
      const initialCount = Object.keys(puzzle.initial.board).length;

      await mountPuzzles(root, puzzle.id);
      expect(slotAt(root, setupMove.from)).not.toBeNull();
      expect(slotAt(root, setupMove.to)).not.toBeNull();
      expect(pieceCount(root)).toBe(initialCount + 1);

      await vi.waitFor(() => expect(slotAt(root, setupMove.from)).toBeNull());
      expect(pieceCount(root)).toBe(initialCount);
      expect(vi.mocked(playSound).mock.calls).toEqual([['capture']]);
    });

    it("keeps today's behaviour when the payload carries no setup move", async () => {
      const { puzzle, setupMove } = QUIET;
      vi.stubGlobal('fetch', xiangqiFetchMock([puzzle]));
      const root = document.createElement('div');
      document.body.append(root);

      await mountPuzzles(root, puzzle.id);
      expect(slotAt(root, setupMove.from)).toBeNull();
      expect(slotAt(root, setupMove.to)).not.toBeNull();
    });

    it('plays the same opening glide in the embed solver', async () => {
      const { puzzle, setupMove } = QUIET;
      vi.stubGlobal('fetch', setupFetchMock(puzzle, setupMove));
      const host = document.createElement('div');
      document.body.append(host);

      const solver = mountPuzzleSolver(host, {
        ...publicDetail(puzzle),
        setupMove,
      } as unknown as Parameters<typeof mountPuzzleSolver>[1]);
      try {
        expect(slotAt(host, setupMove.from)).not.toBeNull();
        expect(slotAt(host, setupMove.to)).toBeNull();
        await vi.waitFor(() => expect(slotAt(host, setupMove.from)).toBeNull());
        expect(slotAt(host, setupMove.to)).not.toBeNull();
        clickMove(host, solverMovesOf(puzzle)[0]!);
        await vi.waitFor(() => expect(host.textContent).toContain('Correct.'));
      } finally {
        solver.dispose();
      }
    });
  });

  describe('source game history in the move list', () => {
    // A short legal game; the puzzle starts at ply 4, so GAME[3] is the setup
    // move, GAME[0..3) the history, and red solves with GAME[4..7).
    const GAME: XiangqiMove[] = [
      { from: 'h3', to: 'e3' },
      { from: 'h10', to: 'g8' },
      { from: 'h1', to: 'g3' },
      { from: 'i10', to: 'h10' },
      { from: 'i1', to: 'h1' },
      { from: 'b10', to: 'c8' },
      { from: 'h1', to: 'h7' },
    ];
    const HISTORY = GAME.slice(0, 3);
    const SETUP = { ...GAME[3]!, captured: null };
    const PUZZLE: XiangqiPuzzle = (() => {
      let initial = createInitialXiangqiState('xq_hist');
      for (const move of GAME.slice(0, 4)) initial = applyStandardXiangqiMove(initial, move);
      return {
        ...XIANGQI_PUZZLES[0]!,
        id: 'xq_hist',
        title: 'History puzzle',
        initial,
        solution: GAME.slice(4),
        goal: { type: 'winning-advantage', winner: 'red' },
        sourceGame: { gameId: 'hxq_src', ply: 4, event: 'Club' },
      };
    })();

    const slotAt = (root: HTMLElement, square: string): Element | null =>
      root.querySelector(`[data-piece-square="${square}"]`);
    const control = (root: HTMLElement, key: string): HTMLButtonElement =>
      root.querySelector<HTMLButtonElement>(`[data-${key}]`)!;
    const cellTexts = (root: HTMLElement, selector: string): string[] =>
      [...root.querySelectorAll(selector)].map((cell) => cell.textContent ?? '');

    function historyFetchMock(withHistory: boolean) {
      const base = xiangqiFetchMock([PUZZLE]);
      return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input) === `/api/puzzles/${PUZZLE.id}`) {
          return json({
            puzzle: {
              ...publicDetail(PUZZLE),
              sourceGame: { ...PUZZLE.sourceGame, redName: 'R', blackName: 'B', hosted: true },
              setupMove: SETUP,
              ...(withHistory ? { history: HISTORY } : {}),
            },
          });
        }
        return base(input, init);
      });
    }

    function animationOff(): void {
      // No opening glide, so the board starts on the live puzzle position.
      stubWindowLocalStorage(
        memoryStorage({
          [displayPreferenceStorageKey]: JSON.stringify({ pieceAnimation: 'none' }),
        }),
      );
      window.dispatchEvent(new Event('mistboard:display-preferences-change'));
    }

    async function mountWithoutGlide(withHistory = true) {
      animationOff();
      const fetchSpy = historyFetchMock(withHistory);
      vi.stubGlobal('fetch', fetchSpy);
      const root = document.createElement('div');
      document.body.append(root);
      await mountPuzzles(root, PUZZLE.id);
      return { root, fetchSpy };
    }

    afterEach(() => window.dispatchEvent(new Event('mistboard:display-preferences-change')));

    it('lists the game moves first, muted and numbered as in the game', async () => {
      const { root } = await mountWithoutGlide();
      expect(cellTexts(root, '.puzzle-move-cell--history')).toEqual(HISTORY.map(moveLabel));
      const rows = [...root.querySelectorAll('.puzzle-move-list .puzzle-move-item')].map((row) =>
        [...row.children].map((cell) => cell.textContent),
      );
      // Row 2 ends on the setup move (black), which is not muted.
      expect(rows.slice(0, 2)).toEqual([
        ['1', 'h3-e3', 'h10-g8'],
        ['2', 'h1-g3', 'i10-h10'],
      ]);
      const setup = root.querySelector('[data-view-ply="0"]');
      expect(setup?.classList.contains('puzzle-move-cell--history')).toBe(false);
      expect(setup?.classList.contains('puzzle-move-cell--active')).toBe(true);

      await clickMove(root, GAME[4]!);
      await vi.waitFor(() => expect(root.textContent).toContain('Correct.'));
      // The solution continues the game's numbering, with its mark.
      const third = root.querySelectorAll('.puzzle-move-list .puzzle-move-item')[2];
      expect(third?.children[0]?.textContent).toBe('3');
      expect(third?.children[1]?.textContent).toContain('i1-h1');
      expect(third?.children[1]?.textContent).toContain('✓');
    });

    it('steps back through the game read-only and returns to the live position', async () => {
      const { root, fetchSpy } = await mountWithoutGlide();
      expect(control(root, 'puzzle-replay-first').disabled).toBe(false);

      control(root, 'puzzle-replay-first').click();
      // The game's opening position: the central cannon still on h3.
      expect(slotAt(root, 'h3')).not.toBeNull();
      expect(slotAt(root, 'e3')).toBeNull();
      expect(control(root, 'puzzle-replay-first').disabled).toBe(true);
      expect(root.querySelector('.puzzle-move-cell--active')).toBeNull();

      control(root, 'puzzle-replay-next').click();
      expect(slotAt(root, 'e3')).not.toBeNull();
      expect(root.querySelector('.puzzle-move-cell--active')?.textContent).toBe('h3-e3');

      // A click on a history move jumps there.
      root.querySelector<HTMLElement>('[data-view-ply="-2"]')!.click();
      expect(root.querySelector('.puzzle-move-cell--active')?.textContent).toBe('h10-g8');
      expect(slotAt(root, 'g8')).not.toBeNull();
      expect(slotAt(root, 'g3')).toBeNull();

      // Off the live position the board takes no moves.
      await clickMove(root, GAME[4]!, { held: true });
      expect(fetchSpy).not.toHaveBeenCalledWith(
        `/api/puzzles/${PUZZLE.id}/attempt`,
        expect.anything(),
      );

      control(root, 'puzzle-replay-last').click();
      expect(root.querySelector('.puzzle-move-cell--active')?.textContent).toBe('i10-h10');
      await clickMove(root, GAME[4]!);
      await vi.waitFor(() => expect(root.textContent).toContain('Correct.'));
    });

    it('links the info card to the game page at the puzzle move', async () => {
      const { root } = await mountWithoutGlide();
      const link = root.querySelector<HTMLAnchorElement>('.puzzle-source-link');
      expect(link?.getAttribute('href')).toBe('/historical-xiangqi/game/hxq_src?ply=4');
      expect(link?.textContent).toContain('From game');
      // The event is clipped to one line in the sidebar, so the full text rides
      // on the hover title.
      expect(link?.closest('.puzzle-source-event')).not.toBeNull();
      expect(link?.title.split('\n')[0]).toBe(link?.textContent);
    });

    it('keeps the setup move as the first position when the detail has no history', async () => {
      const { root } = await mountWithoutGlide(false);
      expect(root.querySelector('.puzzle-move-cell--history')).toBeNull();
      expect(control(root, 'puzzle-replay-first').disabled).toBe(true);
    });

    it('leaves the embed solver without history', () => {
      animationOff();
      const host = document.createElement('div');
      document.body.append(host);
      const solver = mountPuzzleSolver(host, {
        ...publicDetail(PUZZLE),
        setupMove: SETUP,
        history: HISTORY,
      } as unknown as Parameters<typeof mountPuzzleSolver>[1]);
      try {
        expect(host.querySelector('.puzzle-move-cell--history')).toBeNull();
      } finally {
        solver.dispose();
      }
    });

    // Streak dropped the history the server sent for the same puzzle.
    it('shows the game before the puzzle in Puzzle Streak', () => {
      animationOff();
      const host = document.createElement('div');
      document.body.append(host);
      const solver = mountPuzzleSolver(
        host,
        {
          ...publicDetail(PUZZLE),
          setupMove: SETUP,
          history: HISTORY,
        } as unknown as Parameters<typeof mountPuzzleSolver>[1],
        { mode: 'streak', analysis: false },
      );
      try {
        expect(host.querySelectorAll('.puzzle-move-cell--history')).toHaveLength(HISTORY.length);
      } finally {
        solver.dispose();
      }
    });
  });
});

function pointerEvent(type: string, clientX: number, clientY: number): MouseEvent {
  return new MouseEvent(type, { bubbles: true, button: 0, clientX, clientY });
}

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const values = new Map(Object.entries(initial));
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => Array.from(values.keys())[index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}

function stubWindowLocalStorage(storage: Storage): void {
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: storage,
  });
}

describe('puzzleMoveRowNumber', () => {
  it('numbers a red-to-move line by full move, red then black per row', () => {
    // plies 0..3 -> rows 1,1,2,2 (red idx0 leads row 1).
    expect([0, 1, 2, 3].map((i) => puzzleMoveRowNumber('red', i))).toEqual([1, 1, 2, 2]);
  });

  it('offsets a black-to-move line so black leads row 1 alone', () => {
    // Regression for the reported xiangqi puzzle: black moves first, so its
    // opening move must sit in row 1 (red cell blank) and red's reply drops to
    // row 2 — otherwise the row reads "1. <red> <black>" in reversed order.
    // plies 0..6 -> rows 1,2,2,3,3,4,4.
    expect([0, 1, 2, 3, 4, 5, 6].map((i) => puzzleMoveRowNumber('black', i))).toEqual([
      1, 2, 2, 3, 3, 4, 4,
    ]);
  });
});

describe('sourceGameLines', () => {
  it('renders a "From game" header with both players when a xiangqi puzzle carries attribution', () => {
    const lines = sourceGameLines({
      variant: XIANGQI_SPEC_ID,
      sourceGame: {
        gameId: 'hxq_test',
        ply: 12,
        event: '2026 Team Championship',
        playedOn: '2026-04-02',
        result: '1/2-1/2',
        redName: 'Red Player',
        blackName: 'Black Player',
      },
    });
    expect(lines).toHaveLength(3);
    // The event already names its year, so the year is not added again.
    expect(lines[0]?.textContent).toBe('From game · 2026 Team Championship');
    expect(lines[1]?.textContent).toContain('Red Player');
    expect(lines[2]?.textContent).toContain('Black Player');
    // Draw shows ½ on both players.
    expect(lines[1]?.textContent).toContain('½');
    expect(lines[2]?.textContent).toContain('½');
  });

  it('marks only the winner on a decisive result', () => {
    const lines = sourceGameLines({
      variant: XIANGQI_SPEC_ID,
      sourceGame: { gameId: 'g', ply: 1, redName: 'R', blackName: 'B', result: '1-0' },
    });
    expect(lines[1]?.querySelector('.puzzle-source-result')?.textContent).toBe('1');
    expect(lines[2]?.querySelector('.puzzle-source-result')).toBeNull();
  });

  it('adds the year only to an event name that does not say it', () => {
    const header = (event: string | undefined) =>
      sourceGameLines({
        variant: XIANGQI_SPEC_ID,
        sourceGame: { gameId: 'g', ply: 1, event, playedOn: '2025-11-08', redName: 'R' },
      })[0]?.textContent;
    expect(header('Guangdong Ten Tigers Match')).toBe(
      'From game · Guangdong Ten Tigers Match (2025)',
    );
    expect(header('2025 Guangdong Ten Tigers Match')).toBe(
      'From game · 2025 Guangdong Ten Tigers Match',
    );
    // No event an English reader can read: a plain description.
    expect(header(undefined)).toBe('From a 2025 game');
    expect(header('某某杯')).toBe('From a 2025 game');
  });

  it('shows the player without the team, the full string in the tooltip', () => {
    const lines = sourceGameLines({
      variant: XIANGQI_SPEC_ID,
      sourceGame: {
        gameId: 'g',
        ply: 1,
        redName: 'Li Xiaolong (Shaanxi Sports Bureau)',
        blackName: 'Xu Tengfei',
        result: '1-0',
      },
    });
    const names = lines.map((line) =>
      line.querySelector<HTMLElement>('.puzzle-source-player-name'),
    );
    expect(names[1]?.textContent).toBe('Li Xiaolong');
    expect(names[1]?.title).toBe('Li Xiaolong (Shaanxi Sports Bureau)');
    // No team, no tooltip.
    expect(names[2]?.textContent).toBe('Xu Tengfei');
    expect(names[2]?.title).toBe('');
  });

  it('names an online platform game only as an online game and its year', () => {
    const online = { gameId: 'g', ply: 4, online: true };
    expect(
      sourceGameLines({
        variant: XIANGQI_SPEC_ID,
        sourceGame: { ...online, playedOn: '2026-03-14' },
      }).map((l) => l.textContent),
    ).toEqual(['From a 2026 online game']);
    expect(
      sourceGameLines({ variant: XIANGQI_SPEC_ID, sourceGame: online }).map((l) => l.textContent),
    ).toEqual(['From an online game']);
  });

  it('falls back to "From set <variant>" without attribution', () => {
    expect(sourceGameLines({ variant: 'jungle' }).map((l) => l.textContent)).toEqual([
      'From set Jungle Chess',
    ]);
    // A xiangqi puzzle with only {gameId, ply} and no names/event is not enough.
    expect(
      sourceGameLines({ variant: XIANGQI_SPEC_ID, sourceGame: { gameId: 'g', ply: 1 } }).map(
        (l) => l.textContent,
      ),
    ).toEqual(['From set Xiangqi']);
  });

  it('credits a source that requires it with a link back to the original game (#712)', () => {
    const lines = sourceGameLines({
      variant: XIANGQI_SPEC_ID,
      sourceGame: {
        gameId: 'view_m_140041',
        ply: 41,
        redName: 'R',
        blackName: 'B',
        attribution: {
          name: '东萍象棋网 (DPXQ)',
          url: 'http://www.dpxq.com/hldcg/search/view_m_140041.html',
        },
      },
    });
    expect(lines).toHaveLength(4);
    const link = lines[3]?.querySelector('a');
    expect(link?.getAttribute('href')).toBe('http://www.dpxq.com/hldcg/search/view_m_140041.html');
    expect(link?.textContent).toBe('东萍象棋网 (DPXQ)');
    expect(lines[3]?.textContent).toBe('Game courtesy of 东萍象棋网 (DPXQ)');
    // A credit alone still renders the "From game" card, so the link shows.
    const bare = sourceGameLines({
      variant: XIANGQI_SPEC_ID,
      sourceGame: {
        gameId: 'g',
        ply: 1,
        attribution: { name: 'DPXQ', url: 'http://www.dpxq.com/a.html' },
      },
    });
    expect(bare.map((l) => l.textContent)).toEqual(['From game', 'Game courtesy of DPXQ']);
  });
});

describe('sourceGameLines locale', () => {
  const CJK = /[\p{Script=Han}\u3000-\u303f\uff00-\uffef]/u;
  const source = {
    gameId: 'hxq_zh',
    ply: 30,
    event: '2026年全国象棋团体赛',
    eventEn: '2026 National Xiangqi Team Championship',
    playedOn: '2026-04-02',
    result: '1-0',
    redName: '山东省棋牌运动管理中心 黄蕾蕾',
    redNameEn: 'Huang Leilei (Shandong Board Games Centre)',
    blackName: '广东省二沙体育训练中心 时凤兰',
    blackNameEn: 'Shi Fenglan (Guangdong Ersha Sports Training Centre)',
  };
  afterEach(() => {
    window.history.replaceState(null, '', '/');
  });

  it('shows no Chinese in the players and event lines on an English page', () => {
    window.history.replaceState(null, '', '/puzzles');
    const lines = sourceGameLines({ variant: XIANGQI_SPEC_ID, sourceGame: source });
    const text = lines.map((line) => line.textContent ?? '');
    expect(text[0]).toBe('From game · 2026 National Xiangqi Team Championship');
    expect(text[1]).toContain('Huang Leilei');
    expect(text[1]).not.toContain('Shandong');
    expect(text[2]).toContain('Shi Fenglan');
    for (const line of text) expect(line).not.toMatch(CJK);
  });

  it('leaves out a Chinese string with no English form on an English page', () => {
    window.history.replaceState(null, '', '/puzzles');
    const lines = sourceGameLines({
      variant: XIANGQI_SPEC_ID,
      sourceGame: { gameId: 'g', ply: 1, event: '某某杯', redName: '张三', blackName: 'Li Si' },
    });
    expect(lines.map((line) => line.textContent ?? '')).toEqual(['From game', 'Red', 'Li Si']);
  });

  it('keeps the original Chinese on a Chinese page', () => {
    window.history.replaceState(null, '', '/zh-hans/puzzles');
    const lines = sourceGameLines({ variant: XIANGQI_SPEC_ID, sourceGame: source });
    expect(lines[0]?.textContent).toContain('2026年全国象棋团体赛');
    // The Chinese original puts the team first; the name shows, the team is
    // in the tooltip.
    const red = lines[1]?.querySelector<HTMLElement>('.puzzle-source-player-name');
    expect(red?.textContent).toBe('黄蕾蕾');
    expect(red?.title).toBe('山东省棋牌运动管理中心 黄蕾蕾');
  });

  it('strips the team from every archive name shape', () => {
    expect(playerWithoutTeam('Xu Wei (Xinjiang Production Team)')).toBe('Xu Wei');
    expect(playerWithoutTeam('徐伟（新疆）')).toBe('徐伟');
    expect(playerWithoutTeam('四川 黎德玲')).toBe('黎德玲');
    expect(playerWithoutTeam('北京棋院（北京市棋牌运动管理中心） 王禹博')).toBe('王禹博');
    expect(playerWithoutTeam('金州 Son X Nguyen')).toBe('Son X Nguyen');
    // Nothing to strip: a plain name, a Latin team word, a lone parenthetical.
    expect(playerWithoutTeam('HTown David Nguyen')).toBe('HTown David Nguyen');
    expect(playerWithoutTeam('许银川')).toBe('许银川');
    expect(playerWithoutTeam('(Team)')).toBe('(Team)');
  });
});

describe('puzzles prerender shell', () => {
  const render = (): HTMLDivElement => {
    const wrap = document.createElement('div');
    wrap.innerHTML = renderPuzzlesShellForPrerender();
    return wrap;
  };

  it('bakes real body text rather than a bare shell', () => {
    // /puzzles sat in the sitemap serving 27 characters of body (a <title> and
    // nothing else) because the trainer cannot render before the API answers.
    // The exact length is not the contract; "substantially more than a title" is.
    const text = (render().textContent ?? '').replace(/\s+/g, ' ').trim();
    expect(text.length).toBeGreaterThan(600);
  });

  it('gives the baked page a heading and section structure', () => {
    const wrap = render();
    expect(wrap.querySelector('h1')?.textContent?.trim()).toBeTruthy();
    expect(wrap.querySelectorAll('.puzzles-intro h2').length).toBeGreaterThanOrEqual(2);
  });

  it('links onward to the rules, the course, and the analysis board', () => {
    const hrefs = [...render().querySelectorAll('.puzzles-intro a')].map((a) =>
      a.getAttribute('href'),
    );
    expect(hrefs).toContain('/rules/xiangqi');
    expect(hrefs).toContain('/learn/xiangqi');
    expect(hrefs).toContain('/analysis');
  });

  // Tag and class of every element in the frame, stopping at the slots whose
  // content legitimately differs (the sidebar: explainer vs queue; the trainer
  // panel: empty vs loading line).
  const frameSkeleton = (root: ParentNode): string[] => {
    const out: string[] = [];
    const walk = (el: Element, depth: number): void => {
      out.push(`${'  '.repeat(depth)}${el.tagName.toLowerCase()}.${el.className}`);
      if (el.matches('.puzzles-sidebar, .puzzle-side-panel')) return;
      for (const child of el.children) walk(child, depth + 1);
    };
    const shell = root.querySelector('.puzzles-shell');
    if (shell) walk(shell, 0);
    return out;
  };

  it('bakes the frame the client mounts into', async () => {
    // The bake used to be an article (visible heading, explainer column) that
    // the mount replaced with the three-column trainer: CLS 0.69 on prod. The
    // two now share buildPuzzlesFrame, so the mount lands in the same slots.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => {})),
    );
    const root = document.createElement('div');
    document.body.append(root);
    void mountPuzzles(root);
    const baked = frameSkeleton(render());
    expect(baked.length).toBeGreaterThan(4);
    expect(frameSkeleton(root)).toEqual(baked);
    expect(render().querySelector('.puzzles-sidebar .puzzles-intro')).not.toBeNull();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('keeps the board slot while the API answers', async () => {
    // .puzzle-detail is display: contents, so a bare loading line in it became
    // a layout grid item ahead of the sidebar, and the sidebar jumped columns
    // (or down the page, stacked) when the board painted.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => {})),
    );
    const root = document.createElement('div');
    document.body.append(root);
    void mountPuzzles(root);
    const detail = root.querySelector('.puzzle-detail');
    expect(detail?.querySelector(':scope > .puzzles-status')).toBeNull();
    expect(detail?.querySelector('.puzzle-board > .puzzle-xiangqi-board')).not.toBeNull();
    expect(detail?.querySelector('.puzzle-side-panel .puzzles-status')).not.toBeNull();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });
});
