// /embed/puzzle — today's puzzle, or one by id, solvable inside someone else's
// page. The solver is the trainer's own (puzzles.ts mountPuzzleSolver), so
// hints, reveal and the replay arrows behave exactly as on /puzzles; what is
// missing is everything around it: no queue, no nav, no rating. Attempts from
// a frame are always unrated.

import '../app-base.css';
import '../puzzles.css';
import { fetchPuzzleDetail } from '../puzzles/api.js';
import type { EmbedPuzzleRoute } from './embed-route.js';
import './embed.css';

// Height the caption and credit lines take out of the frame, so the board's
// surface budget leaves room for them: two text lines (13px and 12px, ~20px
// and ~18px with line-height) and the two 6px flex gaps. 44 undershot that by
// a few pixels and the credit line sat on the board's bottom edge.
const CHROME_PX = 52;

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

function goalLine(sideToMove: string | null, variant: string): string {
  const side = sideToMove === 'black' ? 'Black' : 'Red';
  const name = variant
    .split('-')
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
    .join(' ');
  return `${name} · ${side} to play`;
}

export async function mountEmbedPuzzle(root: HTMLElement, route: EmbedPuzzleRoute): Promise<void> {
  document.body.classList.add('embed-body');
  document.documentElement.dataset.embed = 'puzzle';
  root.className = 'embed-root';
  note(root, 'Loading…');

  let id = route.puzzleId;
  try {
    id ??= await dailyPuzzleId();
  } catch {
    id = null;
  }
  if (!id) {
    note(root, 'No puzzle today.');
    return;
  }

  let puzzle: Awaited<ReturnType<typeof fetchPuzzleDetail>>;
  try {
    puzzle = await fetchPuzzleDetail(id);
  } catch {
    note(root, 'This puzzle could not be loaded.');
    return;
  }
  if (!puzzle) {
    note(root, 'This puzzle is not available.');
    return;
  }

  const frame = document.createElement('div');
  frame.className = 'embed-frame';
  const caption = document.createElement('div');
  caption.className = 'embed-puzzle-caption';
  caption.textContent = route.puzzleId
    ? goalLine(puzzle.sideToMove, puzzle.variant)
    : `Daily puzzle · ${goalLine(puzzle.sideToMove, puzzle.variant)}`;
  const host = document.createElement('div');
  host.className = 'puzzles-page embed-puzzle';
  const credit = document.createElement('a');
  credit.className = 'embed-credit';
  credit.href = `/puzzles/${encodeURIComponent(puzzle.id)}`;
  credit.target = '_blank';
  credit.rel = 'noopener';
  credit.textContent = 'Solve on mistboard.com';
  frame.append(caption, host, credit);
  root.replaceChildren(frame);

  // The trainer sizes its board from the viewport height; a frame is the whole
  // viewport, so the surface budget is the frame minus the two text lines.
  const fitBoard = (): void => {
    const height = root.getBoundingClientRect().height;
    if (height === 0) return;
    host.style.setProperty('--puzzle-page-height', `${Math.max(200, height - CHROME_PX)}px`);
  };
  fitBoard();
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(fitBoard).observe(root);

  const { mountPuzzleSolver } = await import('../puzzles.js');
  mountPuzzleSolver(host, puzzle);
  document.title = `${puzzle.title} · Mistboard`;
}
