import {
  applyStandardXiangqiMove,
  attemptStandardXiangqiPuzzleLine,
  parseStandardXiangqiFen,
  type XiangqiMove,
  type XiangqiPuzzle,
} from '@mistboard/game';
import { afterEach, expect, it, vi } from 'vitest';
import { mountPuzzleSolver } from '../puzzles.js';
import type { PuzzleDetail, PuzzleSession } from './adapter.js';
import { explorationState, exploreMove } from './exploration.js';

vi.mock('../live-sound.js', async (original) => ({
  ...(await original<typeof import('../live-sound.js')>()),
  playSound: vi.fn(),
}));

function fixture(): XiangqiPuzzle {
  const parsed = parseStandardXiangqiFen(
    '2bakab2/9/9/p3C3p/5R1N1/2r1c4/P7P/2N6/4A4/2BA1Kc2 w - - 0 23',
    'review-mate-two',
  );
  if (!parsed.ok) throw Error('invalid fixture');
  return {
    id: 'review-mate-two',
    variant: 'xiangqi',
    title: 'Red mate in 2',
    initial: parsed.state,
    goal: { type: 'checkmate', winner: 'red' },
    themes: ['checkmate', 'matein2'],
    solution: [
      { from: 'h6', to: 'g8' },
      { from: 'a7', to: 'a6' },
      { from: 'f6', to: 'f10' },
    ],
  };
}

const capture: XiangqiMove = { from: 'f6', to: 'f10' };
const kingEscape: XiangqiMove = { from: 'e10', to: 'e9' };
const click = (root: HTMLElement, move: XiangqiMove) => {
  for (const square of [move.from, move.to])
    root
      .querySelector(`[data-square="${square}"]`)
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
};

function mounted(analysis = true) {
  const puzzle = fixture();
  const completed = attemptStandardXiangqiPuzzleLine(puzzle, [
    puzzle.solution[0]!,
    puzzle.solution[2]!,
  ]);
  if (!completed.ok) throw Error('fixture does not solve');
  const root = document.createElement('div');
  document.body.append(root);
  const detail: PuzzleDetail = {
    ...puzzle,
    sideToMove: 'red',
    solutionPlyCount: 3,
    motifs: [],
    rating: 1500,
    ratingProvisional: true,
  };
  let latest: PuzzleSession | undefined;
  const controller = mountPuzzleSolver(root, detail, {
    analysis,
    initialAttempt: completed,
    afterRender: (_host, session) => {
      latest = session;
      session.wrongTries ??= [{ ply: 0, move: capture }];
    },
  });
  return { root, puzzle, controller, session: () => latest! };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

it('plays both sides of an alternative after completion without grading or changing the solution', () => {
  const fetch = vi.fn(async (_input: RequestInfo | URL) => new Response('{}', { status: 404 }));
  vi.stubGlobal('fetch', fetch);
  const m = mounted();
  try {
    const original = {
      state: m.session().state,
      moves: [...m.session().playedMoves],
      solver: [...m.session().solverMoves],
    };
    m.root.querySelector<HTMLButtonElement>('[data-puzzle-replay-first]')!.click();
    click(m.root, capture);
    expect(m.root.querySelector('.puzzle-exploration')).not.toBeNull();
    expect(m.session().exploration?.moves).toEqual([capture]);
    expect(explorationState(m.session())).toEqual(
      applyStandardXiangqiMove(m.puzzle.initial, capture),
    );
    click(m.root, kingEscape);
    expect(m.session().exploration?.moves).toEqual([capture, kingEscape]);
    const analysisLink = m.root.querySelector<HTMLAnchorElement>('.puzzle-analysis-open-link');
    expect(new URL(analysisLink!.href).searchParams.get('moves')).toBe('f6-f10 e10-e9');
    expect(
      m.root
        .querySelector('.puzzle-exploration [aria-current]')
        ?.getAttribute('data-exploration-ply'),
    ).toBe('2');
    m.root.querySelector<HTMLButtonElement>('[data-puzzle-replay-previous]')!.click();
    expect(m.session().exploration?.cursor).toBe(1);
    m.root.querySelector<HTMLButtonElement>('[data-puzzle-replay-next]')!.click();
    expect(m.session().exploration?.cursor).toBe(2);
    m.root.querySelector<HTMLButtonElement>('.puzzle-exploration-return')!.click();
    expect(m.session().exploration).toBeNull();
    expect(m.session().state).toBe(original.state);
    expect(m.session().playedMoves).toEqual(original.moves);
    expect(m.session().solverMoves).toEqual(original.solver);
    expect(m.session().solved).toBe(true);
    expect(fetch.mock.calls.some((args) => String(args[0]).includes('/attempt'))).toBe(false);
  } finally {
    m.controller.dispose();
  }
});

it('opens a previous wrong try as a local line after completion', () => {
  const m = mounted();
  try {
    m.root.querySelector<HTMLButtonElement>('[data-puzzle-replay-first]')!.click();
    const wrong = m.root.querySelector<HTMLElement>('.puzzle-move-cell--wrong');
    expect(wrong?.getAttribute('role')).toBe('button');
    wrong!.click();
    expect(m.session().exploration?.moves).toEqual([capture]);
    expect(m.root.querySelector('.puzzle-exploration .puzzle-move-mark')).toBeNull();
    // A click on the stored answer exits the exploratory line.
    m.root.querySelector<HTMLElement>('[data-view-ply="1"]')!.click();
    expect(m.session().exploration).toBeNull();
    expect(m.session().viewPly).toBe(1);
  } finally {
    m.controller.dispose();
  }
});

it('rejects illegal local moves and keeps a mode with analysis disabled read-only', () => {
  const m = mounted(false);
  try {
    m.root.querySelector<HTMLButtonElement>('[data-puzzle-replay-first]')!.click();
    click(m.root, capture);
    expect(m.session().exploration).toBeUndefined();
    expect(m.root.querySelector('.puzzle-move-cell--wrong')?.getAttribute('role')).not.toBe(
      'button',
    );
    expect(exploreMove(m.session(), { from: 'a1', to: 'a10' }, m.puzzle.initial)).toBe(false);
    expect(m.session().exploration).toBeUndefined();
  } finally {
    m.controller.dispose();
  }
});

it('cannot enter local exploration before the puzzle outcome is complete', () => {
  const m = mounted();
  try {
    const session = m.session();
    session.solved = false;
    session.state = m.puzzle.initial;
    expect(exploreMove(session, capture, m.puzzle.initial)).toBe(false);
    expect(session.exploration).toBeUndefined();
  } finally {
    m.controller.dispose();
  }
});
