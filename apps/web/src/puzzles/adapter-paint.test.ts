/**
 * Paint smoke for the adapter board path that puzzles.test.ts does not cover
 * (its flows drive standard Xiangqi): Jungle. Mounts the real page against a
 * mocked API and asserts the adapter's board paints with interactive squares,
 * pinning the behavior across the puzzles.ts -> adapters split. Also pins how
 * the page meets a puzzle id whose registry was deleted (Fortress Xiangqi,
 * retired 2026-10-11): a fallback or "Puzzle not found", never a throw.
 */

import { JUNGLE_PUZZLES, type JunglePuzzle } from '@mistboard/game';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountPuzzles } from '../puzzles.js';

type CorpusPuzzle = JunglePuzzle;

function publicSummary(puzzle: CorpusPuzzle) {
  return {
    id: puzzle.id,
    variant: puzzle.variant,
    title: puzzle.title,
    sideToMove: puzzle.initial.status.type === 'playing' ? puzzle.initial.status.turn : null,
    goal: puzzle.goal,
    themes: puzzle.themes,
    solutionPlyCount: puzzle.solution.length,
  };
}

function publicDetail(puzzle: CorpusPuzzle) {
  return { ...publicSummary(puzzle), initial: puzzle.initial };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function stubPuzzleApi(puzzle: CorpusPuzzle): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/puzzles') return json({ puzzles: [publicSummary(puzzle)] });
      if (url === `/api/puzzles/${puzzle.id}`) return json({ puzzle: publicDetail(puzzle) });
      return json({ error: 'not_found' }, 404);
    }),
  );
}

describe('puzzle adapter board painting', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
    window.history.replaceState(null, '', '/');
  });

  it('paints the Jungle board with pieces and selects a piece on click', async () => {
    const puzzle = JUNGLE_PUZZLES[0]!;
    stubPuzzleApi(puzzle);
    const root = document.createElement('div');

    await mountPuzzles(root, puzzle.id);

    const board = root.querySelector('.puzzle-board');
    expect(board).not.toBeNull();
    // 7x9 grid of interactive hit targets + at least one piece slot.
    expect(board?.querySelectorAll('[data-square]').length).toBe(63);
    expect(board?.querySelector('.jgl-piece-slot')).not.toBeNull();
    // No reserve shell: Jungle paints straight onto the board host.
    expect(root.querySelector('.puzzle-board-shell')).toBeNull();

    // Clicking the solution move's origin selects it (adapter click wiring).
    const firstMove = puzzle.solution[0]!;
    board
      ?.querySelector(`[data-square="${firstMove.from}"]`)
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(root.textContent).toContain(`${firstMove.from} selected.`);
  });
});

// Fortress Xiangqi's puzzle registry was deleted with the variant (2026-10-11).
// The server answers its ids with 404 and the list never carries them, but a
// bookmark, a shared link, the attempted-id history or a back button still can.
describe('a deleted puzzle id', () => {
  const DELETED_ID = 'fortress-xiangqi-mined-v2-001';

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
    window.history.replaceState(null, '', '/');
  });

  function stubListWithout(puzzle: CorpusPuzzle): void {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === '/api/puzzles') {
          return json({ puzzles: [publicSummary(puzzle)], attemptedIds: [DELETED_ID] });
        }
        if (url === `/api/puzzles/${puzzle.id}`) return json({ puzzle: publicDetail(puzzle) });
        return json({ error: 'not_found' }, 404);
      }),
    );
  }

  it('deep-linked at mount, falls back to the queue instead of throwing', async () => {
    const puzzle = JUNGLE_PUZZLES[0]!;
    stubListWithout(puzzle);
    const root = document.createElement('div');

    await mountPuzzles(root, DELETED_ID);

    expect(root.textContent).not.toContain('Puzzle not found');
    expect(root.querySelectorAll('.puzzle-board [data-square]').length).toBe(63);
  });

  it('reached by back navigation, renders "Puzzle not found"', async () => {
    const puzzle = JUNGLE_PUZZLES[0]!;
    stubListWithout(puzzle);
    const root = document.createElement('div');
    document.body.append(root);
    await mountPuzzles(root, puzzle.id);

    window.history.pushState(null, '', `/puzzles/${DELETED_ID}`);
    window.dispatchEvent(new PopStateEvent('popstate'));
    await vi.waitFor(() => expect(root.textContent).toContain('Puzzle not found'));
  });
});
