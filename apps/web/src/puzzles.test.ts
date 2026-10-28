import { existsSync, readFileSync } from 'node:fs';
import {
  applyStandardXiangqiMove,
  attemptStandardXiangqiPuzzleLine,
  createInitialXiangqiState,
  detectXiangqiPuzzleMotifs,
  getStandardXiangqiLegalMoves,
  standardXiangqiPuzzleMoveEquals,
  XIANGQI_MOTIF_BY_ID,
  XIANGQI_PUZZLES,
  XIANGQI_SPEC_ID,
  type XiangqiMove,
  type XiangqiPuzzle,
  type XiangqiPuzzleSetupMove,
  xiangqiPuzzlePreSetupState,
} from '@mistboard/game';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { displayPreferenceStorageKey } from './display-preferences.js';
import { playSound } from './live-sound.js';
import {
  mountPuzzleSolver,
  mountPuzzles,
  puzzleMoveRowNumber,
  renderPuzzlesShellForPrerender,
  sourceGameLines,
} from './puzzles.js';
import { xiangqiAppearanceChangedEvent } from './theme.js';
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
  const movesOf = (init?: RequestInit): XiangqiMove[] =>
    (JSON.parse(String(init?.body)) as { moves: XiangqiMove[] }).moves;
  const clickSquares = (root: HTMLElement, move: XiangqiMove): void => {
    root
      .querySelector<SVGGElement>(`[data-square="${move.from}"]`)
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    root
      .querySelector<SVGGElement>(`[data-square="${move.to}"]`)
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  };
  // Every solver ply of the line, waiting for each attempt to land before the
  // next click (a pending submit would swallow it).
  const solveLine = async (root: HTMLElement, puzzle: XiangqiPuzzle): Promise<void> => {
    for (const [ply, move] of puzzle.solution.entries()) {
      if (ply % 2 !== 0) continue;
      clickSquares(root, move);
      await vi.waitFor(() => expect(root.textContent).toContain(`${move.from}-${move.to}`));
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
    clickSquares(root, redDrop.solution[0]!);

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
    clickSquares(root, wrong);

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

  function clickMove(root: HTMLElement, move: XiangqiMove): void {
    root
      .querySelector<SVGGElement>(`[data-square="${move.from}"]`)
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    root
      .querySelector<SVGGElement>(`[data-square="${move.to}"]`)
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  }

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
    clickMove(root, solver[0]!);

    await vi.waitFor(() => expect(root.textContent).toContain('Correct.'));
    // The defender's scripted reply auto-played and both moves hit the move list.
    expect(root.textContent).toContain(moveLabel(puzzle.solution[0]!));
    expect(root.textContent).toContain(moveLabel(puzzle.solution[1]!));
    // Last-move highlight (gold ring) from the canonical board module.
    expect(root.querySelector('.xq-live-lastmove-ring')).not.toBeNull();

    clickMove(root, solver[1]!);

    await vi.waitFor(() => expect(root.textContent).toContain('Success!'));
    expect(root.textContent).toContain(moveLabel(puzzle.solution[2]!));
    expect(fetchSpy).toHaveBeenCalledWith(
      `/api/puzzles/${puzzle.id}/attempt`,
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('names the kill pattern in the themes card once a mate puzzle is solved', async () => {
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
    for (const move of solverMovesOf(puzzle!)) {
      clickMove(root, move);
      await vi.waitFor(() => expect(root.textContent).toMatch(/Correct\.|Success!/));
    }

    await vi.waitFor(() => expect(root.textContent).toContain('Success!'));
    const chip = root.querySelector<HTMLElement>('.puzzle-tag-motif');
    expect(chip?.textContent).toBe(`${motif.hanzi} ${motif.label}`);
    expect(chip?.title).toBe(motif.pinyin);
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

      clickMove(root, solverMovesOf(puzzle)[0]!);
      await vi.waitFor(() => expect(root.textContent).toContain('Correct.'));
      // Both moves landed in one render; only the reply glides (the solver
      // chose their own move an instant ago).
      const reply = puzzle.solution[1]!;
      expect(pieceGlides()).toEqual([reply.to]);

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
    clickMove(root, wrong);

    await vi.waitFor(() => expect(root.textContent).toContain('Try again'));
    // The board did not advance: the correct first move still works immediately.
    clickMove(root, solver[0]!);

    await vi.waitFor(() => expect(root.textContent).toContain('Correct.'));
    expect(root.textContent).toContain(moveLabel(puzzle.solution[1]!));
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
    expect(chipsBefore?.querySelectorAll('.puzzle-result-chip--current')).toHaveLength(1);

    clickMove(root, wrong);
    await vi.waitFor(() => expect(root.textContent).toContain('Try again'));
    // The miss stays in the list after it is taken back, flashed on the board.
    const variation = root.querySelector('.puzzle-move-variation');
    expect(variation?.textContent).toContain(moveLabel(wrong));
    expect(variation?.querySelector('.puzzle-move-cell--wrong')?.textContent).toContain('✗');
    expect(root.querySelector('.puzzle-wrong-flash')).not.toBeNull();

    clickMove(root, solver[0]!);
    await vi.waitFor(() => expect(root.textContent).toContain('Correct.'));
    // The retry still lands, and the earlier miss is still listed.
    expect(root.querySelector('.puzzle-move-variation')?.textContent).toContain(moveLabel(wrong));
    clickMove(root, solver[1]!);
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
      ...root.querySelectorAll<HTMLElement>('.puzzle-session-chips .puzzle-result-chip'),
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
    const chip = root.querySelector<HTMLElement>('.puzzle-session-chips .puzzle-result-chip');
    expect(chip?.dataset.outcome).toBe('failed');
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
      clickMove(root, move);
      await vi.waitFor(() => expect(root.textContent).toContain(moveLabel(move)));
    }
    await vi.waitFor(() => expect(root.textContent).toContain('Success!'));
    root.querySelector<HTMLButtonElement>('[data-puzzle-next]')?.click();
    await vi.waitFor(() =>
      expect(root.querySelector<HTMLElement>('.puzzle-board')?.dataset.puzzleId).toBe(second.id),
    );

    const row = root.querySelector('.puzzle-session-chips')!;
    const past = row.querySelector<HTMLAnchorElement>('a.puzzle-result-chip--solved');
    expect(past?.textContent).toBe('✓');
    expect(past?.getAttribute('href')).toBe(`/puzzles/${first.id}`);
    expect(row.lastElementChild?.classList.contains('puzzle-result-chip--current')).toBe(true);

    past?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await vi.waitFor(() =>
      expect(root.querySelector<HTMLElement>('.puzzle-board')?.dataset.puzzleId).toBe(first.id),
    );
    expect(window.location.pathname).toBe(`/puzzles/${first.id}`);
    // Leaving the second puzzle untouched records nothing for it.
    const outcomes = [
      ...root.querySelectorAll<HTMLElement>('.puzzle-session-chips .puzzle-result-chip'),
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
      clickMove(root, move);
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
        clickMove(root, move);
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
        clickMove(root, solverMovesOf(puzzle)[0]!);
        expect(fetchSpy).not.toHaveBeenCalledWith(
          `/api/puzzles/${puzzle.id}/attempt`,
          expect.anything(),
        );

        await vi.waitFor(() => expect(slotAt(root, setupMove.from)).toBeNull());
        expect(slotAt(root, setupMove.to)).not.toBeNull();
        expect(glides).toContain(setupMove.to);
        expect(root.textContent).toContain(moveLabel(setupMove));
        expect(vi.mocked(playSound).mock.calls).toEqual([['move']]);

        clickMove(root, solverMovesOf(puzzle)[0]!);
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
      clickMove(root, solverMovesOf(puzzle)[0]!);
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

      clickMove(root, GAME[4]!);
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
      clickMove(root, GAME[4]!);
      expect(fetchSpy).not.toHaveBeenCalledWith(
        `/api/puzzles/${PUZZLE.id}/attempt`,
        expect.anything(),
      );

      control(root, 'puzzle-replay-last').click();
      expect(root.querySelector('.puzzle-move-cell--active')?.textContent).toBe('i10-h10');
      clickMove(root, GAME[4]!);
      await vi.waitFor(() => expect(root.textContent).toContain('Correct.'));
    });

    it('links the info card to the game page at the puzzle move', async () => {
      const { root } = await mountWithoutGlide();
      const link = root.querySelector<HTMLAnchorElement>('.puzzle-source-link');
      expect(link?.getAttribute('href')).toBe('/historical-xiangqi/game/hxq_src?ply=4');
      expect(link?.textContent).toContain('From game');
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
    expect(lines[0]?.textContent).toBe('From game · 2026 Team Championship (2026)');
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
    expect(text[0]).toBe('From game · 2026 National Xiangqi Team Championship (2026)');
    expect(text[1]).toContain('Huang Leilei (Shandong Board Games Centre)');
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
    expect(lines[1]?.textContent).toContain('山东省棋牌运动管理中心 黄蕾蕾');
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
