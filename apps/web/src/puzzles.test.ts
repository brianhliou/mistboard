import {
  attemptStandardXiangqiPuzzleLine,
  detectXiangqiPuzzleMotifs,
  getStandardXiangqiLegalMoves,
  standardXiangqiPuzzleMoveEquals,
  XIANGQI_MOTIF_BY_ID,
  XIANGQI_PUZZLES,
  XIANGQI_SPEC_ID,
  type XiangqiMove,
  type XiangqiPuzzle,
} from '@mistboard/game';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  mountPuzzles,
  puzzleMoveRowNumber,
  renderPuzzlesShellForPrerender,
  sourceGameLines,
} from './puzzles.js';
import { xiangqiAppearanceChangedEvent } from './theme.js';

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

  // Skipped while only Fortress Xiangqi is surfaced (the variant picker is
  // hidden). Restore when more than one variant is unhidden.
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
    // Winning-advantage puzzles (most of the Fortress corpus, Jungle material
    // tactics) complete while the game is still in progress: the server reports
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
        'mistboard.xiangqiPieceSet': 'international-flat',
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
    expect(hrefs.every((href) => href?.includes('/international-flat/'))).toBe(true);
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
    expect(sourceGameLines({ variant: 'fortress-xiangqi' }).map((l) => l.textContent)).toEqual([
      'From set Fortress Xiangqi',
    ]);
    // A xiangqi puzzle with only {gameId, ply} and no names/event is not enough.
    expect(
      sourceGameLines({ variant: XIANGQI_SPEC_ID, sourceGame: { gameId: 'g', ply: 1 } }).map(
        (l) => l.textContent,
      ),
    ).toEqual(['From set Xiangqi']);
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

  it('does not reuse the screen-reader-only header class', () => {
    // puzzles.css clips .puzzles-header to 1px because the live trainer leads
    // with the board. Reusing it here would hide the baked heading from the
    // no-JS visitor this page exists for.
    const wrap = render();
    expect(wrap.querySelector('.puzzles-intro-header')).not.toBeNull();
    expect(wrap.querySelector('.puzzles-header')).toBeNull();
  });
});
