import { puzzleShortCode } from '@mistboard/game';
import { t } from '../i18n/catalog.js';

export type PuzzleChipOutcome = 'solved' | 'failed';
export type PuzzleChipResult = { id: string; outcome: PuzzleChipOutcome };

const OUTCOME_KEYS = {
  solved: 'puzzle.sessionOutcomeSolved',
  failed: 'puzzle.sessionOutcomeFailed',
} as const;

export function puzzleChipOutcomeLabel(outcome: PuzzleChipOutcome): string {
  return t(OUTCOME_KEYS[outcome]);
}

export type PuzzleResultChipsOptions = {
  /** The nav's accessible name. */
  label: string;
  /** Extra class on the nav, for placement. */
  className?: string;
  /** A click on a past chip. Absent = a plain link to the puzzle's page. */
  onPick?: (id: string) => void;
};

const MARKS: Record<PuzzleChipOutcome, string> = { solved: '✓', failed: '✗' };

// One small chip per puzzle played, each a link to that puzzle's own page and
// reading ✓ or ✗: solved green, failed red. `currentId` adds the puzzle in play
// as an unlinked, filled last chip when it has no result yet.
export function puzzleResultChips(
  results: readonly PuzzleChipResult[],
  currentId: string | null,
  options: PuzzleResultChipsOptions,
): HTMLElement {
  const nav = document.createElement('nav');
  nav.className = options.className
    ? `puzzle-result-chips ${options.className}`
    : 'puzzle-result-chips';
  nav.setAttribute('aria-label', options.label);
  for (const result of results) {
    const chip = document.createElement('a');
    chip.className = `puzzle-result-chip puzzle-result-chip--${result.outcome}`;
    chip.dataset.outcome = result.outcome;
    chip.href = `/puzzles/${encodeURIComponent(result.id)}`;
    chip.textContent = MARKS[result.outcome];
    const label = t('puzzle.sessionResult', {
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
  }
  if (currentId && !results.some((r) => r.id === currentId)) {
    const chip = document.createElement('span');
    chip.className = 'puzzle-result-chip puzzle-result-chip--current';
    chip.setAttribute('aria-current', 'step');
    chip.setAttribute('aria-label', t('puzzle.sessionCurrent'));
    nav.append(chip);
  }
  return nav;
}
