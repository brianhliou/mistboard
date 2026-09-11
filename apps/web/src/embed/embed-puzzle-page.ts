// /embed/puzzle — today's puzzle, or one by id, solvable inside someone else's
// page. The solver is the trainer's own (puzzles.ts mountPuzzleSolver), so
// hints, reveal and the replay arrows behave exactly as on /puzzles; what is
// missing is everything around it: no queue, no nav, no rating. Attempts from
// a frame are always unrated.

import '../app-base.css';
import '../puzzles.css';
import { variantDisplayLabel } from '../game-display.js';
import { t } from '../i18n/catalog.js';
import { colorLabel, type PuzzleColor } from '../puzzles/adapter.js';
import { fetchPuzzleDetail } from '../puzzles/api.js';
import type { EmbedPuzzleRoute } from './embed-route.js';
import './embed.css';

type DailyPayload = { puzzle?: { id?: string } };

function note(root: HTMLElement, message: string): void {
  const box = document.createElement('div');
  box.className = 'embed-note';
  box.textContent = message;
  root.replaceChildren(box);
}

async function dailyPuzzleId(): Promise<string | null> {
  const response = await fetch('/api/puzzles/daily?slot=homepage');
  if (!response.ok) return null;
  const body = (await response.json()) as DailyPayload;
  return typeof body.puzzle?.id === 'string' ? body.puzzle.id : null;
}

// The embed's locale is whatever the reader's browser or stored preference
// says (an embed URL carries no locale prefix), which is also what the
// trainer inside the frame renders in; these lines follow the same t().
function captionLine(
  puzzle: { sideToMove: PuzzleColor | null; variant: string },
  daily: boolean,
): string {
  const params = {
    variant: variantDisplayLabel(puzzle.variant),
    color: colorLabel(puzzle.sideToMove),
  };
  return daily ? t('puzzle.embedDaily', params) : t('puzzle.embedGoal', params);
}

export async function mountEmbedPuzzle(root: HTMLElement, route: EmbedPuzzleRoute): Promise<void> {
  document.body.classList.add('embed-body');
  document.documentElement.dataset.embed = 'puzzle';
  root.className = 'embed-root';
  note(root, `${t('puzzle.loading')}…`);

  let id = route.puzzleId;
  try {
    id ??= await dailyPuzzleId();
  } catch {
    id = null;
  }
  if (!id) {
    note(root, t('puzzle.embedNoDaily'));
    return;
  }

  let puzzle: Awaited<ReturnType<typeof fetchPuzzleDetail>>;
  try {
    puzzle = await fetchPuzzleDetail(id);
  } catch {
    note(root, t('puzzle.embedLoadFailed'));
    return;
  }
  if (!puzzle) {
    note(root, t('puzzle.embedNotAvailable'));
    return;
  }

  const frame = document.createElement('div');
  frame.className = 'embed-frame';
  const caption = document.createElement('div');
  caption.className = 'embed-puzzle-caption';
  caption.textContent = captionLine(puzzle, route.puzzleId === null);
  const host = document.createElement('div');
  host.className = 'puzzles-page embed-puzzle';
  const credit = document.createElement('a');
  credit.className = 'embed-credit';
  credit.href = `/puzzles/${encodeURIComponent(puzzle.id)}`;
  credit.target = '_blank';
  credit.rel = 'noopener';
  credit.textContent = t('puzzle.embedSolveOn');
  frame.append(caption, host, credit);
  root.replaceChildren(frame);

  // The trainer sizes its board from the viewport height; a frame is the whole
  // viewport, so the surface budget is the frame minus everything else in it:
  // the root's padding, the caption and credit lines, and the two flex gaps
  // between them. Measured, not a constant: a 52px constant left out the
  // root's 16px of padding, and on a 520px host frame the card ran 21px past
  // the bottom and took the credit line with it.
  const fitBoard = (): void => {
    const height = root.getBoundingClientRect().height;
    if (height === 0) return;
    const rootStyle = getComputedStyle(root);
    const gap = Number.parseFloat(getComputedStyle(frame).rowGap) || 0;
    const chrome =
      Number.parseFloat(rootStyle.paddingTop) +
      Number.parseFloat(rootStyle.paddingBottom) +
      caption.offsetHeight +
      credit.offsetHeight +
      gap * 2;
    host.style.setProperty('--puzzle-page-height', `${Math.max(200, height - chrome)}px`);
  };
  fitBoard();
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(fitBoard).observe(root);

  // The trainer's jump-out link (added on reveal) targets the document it is
  // in; in a frame that document is the widget, and the whole site would open
  // inside a 520px box on someone else's page. Send it to a new tab, the way
  // the credit line goes.
  host.addEventListener('click', (event) => {
    const link = (event.target as Element | null)?.closest<HTMLAnchorElement>(
      'a.puzzle-analysis-open-link',
    );
    if (!link) return;
    link.target = '_blank';
    link.rel = 'noopener';
  });

  const { mountPuzzleSolver } = await import('../puzzles.js');
  mountPuzzleSolver(host, puzzle);
  document.title = `${puzzle.title} · Mistboard`;
}
