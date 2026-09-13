/**
 * Paint smoke for the adapter board paths that puzzles.test.ts does not cover
 * (its flows drive Mini and standard Xiangqi): Jungle and Fortress
 * Xiangqi. Mounts the real page against a mocked API and asserts each
 * adapter's board (+ pockets, for Fortress) paints with interactive squares,
 * pinning the behavior across the puzzles.ts -> adapters split.
 */

import {
  createInitialFortressXiangqiState,
  FORTRESS_XIANGQI_SPEC_ID,
  type FortressXiangqiPuzzle,
  JUNGLE_PUZZLES,
  type JunglePuzzle,
} from '@mistboard/game';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountPuzzles } from '../puzzles.js';

type CorpusPuzzle = JunglePuzzle | FortressXiangqiPuzzle;

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

  it('paints the Fortress board inside its pocket shell', async () => {
    // Built here, not taken from the corpus: Fortress ships no puzzles as of
    // 2026-09-03. This test is about the adapter painting a board and its two
    // pockets, so any well-formed puzzle serves — it never solves the line.
    const puzzle: FortressXiangqiPuzzle = {
      id: 'fortress-paint-fixture',
      variant: FORTRESS_XIANGQI_SPEC_ID,
      title: 'paint fixture',
      initial: createInitialFortressXiangqiState('fortress-paint-fixture'),
      solution: [{ from: 'e1', to: 'e4' }],
      goal: { type: 'winning-advantage', winner: 'red', centipawns: 600 },
      themes: ['chariot'],
    } as FortressXiangqiPuzzle;
    stubPuzzleApi(puzzle);
    const root = document.createElement('div');

    await mountPuzzles(root, puzzle.id);

    expect(root.querySelector('.fxq-board')).not.toBeNull();
    const shell = root.querySelector('.puzzle-board-shell.puzzle-fortress-shell');
    expect(shell).not.toBeNull();
    expect(shell?.querySelector('[aria-label="Opponent reserve"]')).not.toBeNull();
    expect(shell?.querySelector('[aria-label="Your reserve"]')).not.toBeNull();
    // 7x8 grid of interactive hit targets.
    expect(shell?.querySelectorAll('[data-square]').length).toBe(56);
  });
});
