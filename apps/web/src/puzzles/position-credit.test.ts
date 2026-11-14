// @vitest-environment happy-dom
import { afterEach, expect, it } from 'vitest';
import { type PuzzleSummary, puzzleSolvePrompt } from './adapter.js';
import { puzzlePhoneMenuHead } from './phone-menu.js';
import { goalLabel, sourceGameLines, withSelectedSource } from './queue-panel.js';

const credit = {
  name: 'DPXQ',
  event: 'World Championship',
  red: 'Red Player',
  black: 'Black Player',
  url: 'http://www.dpxq.com/hldcg/search/view_m_1.html',
};
const puzzle: PuzzleSummary = {
  id: 'position-only',
  variant: 'xiangqi',
  title: 'Black mate in 3',
  sideToMove: 'black',
  goal: { type: 'checkmate', winner: 'black' },
  themes: [],
  motifs: [],
  solutionPlyCount: 5,
  rating: 1600,
  ratingProvisional: true,
  credit,
};
afterEach(() => {
  window.history.replaceState(null, '', '/');
});

it('the unsolved prompt states the mate bound without relying on the title', () => {
  expect(puzzleSolvePrompt(puzzle)).toBe('Mate in 3 | Black to move');
  expect(goalLabel(puzzle)).toBe('Mate in 3');
  expect(puzzleSolvePrompt({ ...puzzle, goal: { type: 'winning-advantage' } })).toBe(
    'Black to move',
  );
});

it('position-only source credit has players and archive link, with no hosted-game link', () => {
  const host = document.createElement('div');
  host.append(...sourceGameLines(puzzle));
  expect(host.textContent).toContain('World Championship');
  expect(host.textContent).toContain('Red Player');
  expect(host.textContent).toContain('Black Player');
  expect(host.querySelectorAll('a')).toHaveLength(1);
  expect(host.querySelector('a')?.getAttribute('href')).toBe(credit.url);
  expect(host.innerHTML).not.toContain('/historical-xiangqi/');
});

it('detail credit reaches the selected queue summary and never another puzzle', () => {
  const summary = { ...puzzle, credit: undefined };
  expect(withSelectedSource(summary, puzzle)?.credit).toEqual(credit);
  expect(withSelectedSource({ ...summary, id: 'other' }, puzzle)?.credit).toBeUndefined();
});

it('the phone summary states the unsolved mate objective and includes source credit', () => {
  const props = {
    queue: [puzzle],
    selectedId: puzzle.id,
    selectedSource: puzzle,
    solvedIds: new Set<string>(),
    variantFilter: 'xiangqi' as const,
    variantFilters: ['xiangqi' as const],
    autoNext: false,
    ratedEnabled: false,
    userRating: null,
    ratingDelta: null,
    onVariantChange: async () => {},
    onAutoNextChange: () => {},
    onRatedChange: () => {},
  };
  const summary = puzzlePhoneMenuHead(props);
  expect(summary?.textContent).toContain('Mate in 3');
  expect(summary?.textContent).toContain('DPXQ');
  expect(summary?.querySelector('a')?.getAttribute('href')).toBe(credit.url);
  expect(summary?.querySelector('.puzzle-pm-head__source--position-only')).not.toBeNull();
});
