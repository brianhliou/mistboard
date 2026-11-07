import { puzzleShortCode } from '@mistboard/game';
import { t } from '../i18n/catalog.js';

export type PuzzleChipOutcome = 'solved' | 'skipped' | 'failed';
export type PuzzleChipResult = { id: string; outcome: PuzzleChipOutcome };

const OUTCOME_KEYS = {
  solved: 'puzzle.streakOutcomeSolved',
  skipped: 'puzzle.streakOutcomeSkipped',
  failed: 'puzzle.streakOutcomeFailed',
} as const;

export function puzzleChipOutcomeLabel(outcome: PuzzleChipOutcome): string {
  return t(OUTCOME_KEYS[outcome]);
}

export type PuzzleResultChipsOptions = {
  /** The nav's accessible name. */
  label: string;
  /** What a chip reads: its place in the list (Puzzle Streak) or the
   *  outcome's mark, ✓ or ✗ (the regular page's session row). */
  text: 'index' | 'mark';
  /** Extra class on the nav, for placement. */
  className?: string;
  /** A click on a past chip. Absent = a plain link to the puzzle's page. */
  onPick?: (id: string) => void;
};

const MARKS: Record<PuzzleChipOutcome, string> = { solved: '✓', failed: '✗', skipped: '–' };

// One small chip per puzzle played, each a link to that puzzle's own page:
// solved green, failed red, skipped muted. `currentId` adds the puzzle in play
// as an unlinked, filled last chip when it has no result yet. Shared by Puzzle
// Streak's run and the regular page's session row, so both read the same.
export function puzzleResultChips(
  results: readonly PuzzleChipResult[],
  currentId: string | null,
  options: PuzzleResultChipsOptions,
): HTMLElement {
  const nav = document.createElement('nav');
  nav.className = options.className
    ? `puzzle-streak-chips ${options.className}`
    : 'puzzle-streak-chips';
  nav.setAttribute('aria-label', options.label);
  results.forEach((result, index) => {
    const chip = document.createElement('a');
    chip.className = `puzzle-streak-chip puzzle-streak-chip--${result.outcome}`;
    chip.dataset.outcome = result.outcome;
    chip.href = `/puzzles/${encodeURIComponent(result.id)}`;
    chip.textContent = options.text === 'index' ? String(index + 1) : MARKS[result.outcome];
    const label = t('puzzle.streakResult', {
      code: puzzleShortCode(result.id),
      outcome: puzzleChipOutcomeLabel(result.outcome),
    });
    chip.title = label;
    chip.setAttribute('aria-label', label);
    if (result.id === currentId) chip.setAttribute('aria-current', 'step');
    const onPick = options.onPick;
    if (onPick) {
      chip.addEventListener('click', (event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
        event.preventDefault();
        onPick(result.id);
      });
    }
    nav.append(chip);
  });
  if (currentId && !results.some((r) => r.id === currentId)) {
    const chip = document.createElement('span');
    chip.className = 'puzzle-streak-chip puzzle-streak-chip--current';
    chip.setAttribute('aria-current', 'step');
    if (options.text === 'index') chip.textContent = String(results.length + 1);
    else chip.setAttribute('aria-label', t('puzzle.sessionCurrent'));
    nav.append(chip);
  }
  return nav;
}
