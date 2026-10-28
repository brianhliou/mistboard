import { existsSync, readFileSync } from 'node:fs';
import {
  attemptStandardXiangqiPuzzleLine,
  detectXiangqiPuzzleMotifs,
  getStandardXiangqiLegalMoves,
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
import { displayPreferenceStorageKey } from './display-preferences.js';
import { playSound } from './live-sound.js';
import { puzzlePhoneMenuRows } from './puzzles/phone-menu.js';
import { loadPuzzleTheme, PUZZLE_THEME_MIN_PATTERN_COUNT } from './puzzles/themes.js';
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
  const themeOptions = XIANGQI_MOTIFS.map((motif) => ({
    ...motif,
    // Above PUZZLE_THEME_MIN_PATTERN_COUNT, so the picker lists it.
    count: motif.id === 'ma-hou-pao' ? 24 : 0,
    literal: 'cannon behind the horse',
    gloss: 'The horse pens the general in and screens the cannon behind it.',
  }));

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
      clickSquares(root, RED_MATE.solution[0]!);
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
      expect(root.textContent).toContain(
        `${RED_MATE.solution[1]!.from}-${RED_MATE.solution[1]!.to}`,
      );
      expect(qualityEvents).toEqual([view]);
      expect(view.event).toBe('view');
      clickSquares(root, RED_MATE.solution[2]!);
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
    expect(root.textContent).toContain('马后炮');
    expect(root.textContent).toContain('mǎ hòu pào');
    // Lichess's row: the count sits inline after the name, a bare number.
    const count = root.querySelector(
      '[data-puzzle-theme-card="ma-hou-pao"] h3 .puzzle-theme-count',
    );
    expect(count?.textContent).toBe('24');
    expect(count?.getAttribute('title')).toBe('24 puzzles');
    expect(root.textContent).toContain('The horse pens the general in');
    // The pattern's piece is the row's icon, in the board's baked glyph outline.
    expect(
      root.querySelector('[data-puzzle-theme-card="ma-hou-pao"] .puzzle-theme-icon svg path'),
    ).not.toBeNull();
    expect(root.querySelector('.puzzle-xiangqi-board')).toBeNull();
    expect(root.querySelector('a[href="/puzzles?theme=men-gong"]')).toBeNull();
    // With no tag counts the mix row still links every puzzle, just uncounted.
    const mix = root.querySelector('[data-puzzle-theme-recommended] a[href="/puzzles"]');
    expect(mix?.textContent).toContain('Healthy mix');
    expect(mix?.querySelector('.puzzle-theme-count')).toBeNull();
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
    // The hanzi · pinyin line sits on mate patterns only.
    expect(root.querySelector('[data-puzzle-theme-card="matein1"] .puzzle-theme-name')).toBeNull();
    expect(
      root.querySelector('[data-puzzle-theme-card="men-gong"] .puzzle-theme-name [lang="zh-Hans"]'),
    ).not.toBeNull();

    // Recommended comes first: one row training on everything, counted as
    // the corpus (each puzzle has one phase: 5 + 70 + 30).
    const recommended = root.querySelector<HTMLElement>('[data-puzzle-theme-recommended]');
    expect(recommended?.compareDocumentPosition(groups[0]!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(recommended?.querySelector('h2')?.textContent).toBe('Recommended');
    const mix = recommended?.querySelectorAll<HTMLAnchorElement>('a') ?? [];
    expect([...mix].map((a) => a.getAttribute('href'))).toEqual(['/puzzles']);
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
