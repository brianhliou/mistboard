import {
  getStandardXiangqiPlayerView,
  XIANGQI_SPEC_ID,
  type XiangqiColor,
  type XiangqiGameState,
} from '@mistboard/game';
import './live-xiangqi.css';
import { variantDisplayLabel } from './game-display.js';
import { t } from './i18n/catalog.js';
import { xiangqiAppearanceChangedEvent } from './theme.js';
import { renderXiangqiBoardSvg } from './xiangqi-board.js';

// Daily variants this widget knows how to paint. The payload gate (fail-closed)
// treats any other variant as a miss: no widget beats the wrong board. Extend
// this list together with renderHomePuzzleBox when the daily rotation grows.
// Fortress Xiangqi was retired on 2026-10-11 and its puzzles deleted, so a
// Fortress daily still sitting in a visitor's cache reads as a miss here.
const HOME_PUZZLE_VARIANTS: readonly string[] = [XIANGQI_SPEC_ID];

type HomeDailyPuzzle = {
  daily: {
    day: string;
    persisted: boolean;
    selectedAt: string | null;
    slot: string;
    source: string;
  };
  puzzle: {
    goal:
      | { type: 'checkmate'; winner?: XiangqiColor }
      | { type: 'winning-advantage'; winner?: XiangqiColor; centipawns?: number };
    id: string;
    initial: XiangqiGameState;
    sideToMove: XiangqiColor | null;
    solutionPlyCount: number;
    themes: string[];
    title: string;
    variant: string;
  };
};

export async function buildHomePuzzleWidget(): Promise<HTMLElement | null> {
  const daily = await loadHomeDailyPuzzle();
  return daily ? renderHomePuzzleWidget(daily) : null;
}

// Last successfully loaded daily puzzle, cached so repeat visits can render the
// widget synchronously at first paint (exact real footprint, no pop-in) and
// swap in place if the day rolled over. Best-effort: storage may be unavailable
// (private mode) or stale-shaped after a schema change; both read as a miss.
const HOME_PUZZLE_CACHE_KEY = 'mistboard:home-daily-puzzle';

export function cachedHomeDailyPuzzle(): HomeDailyPuzzle | null {
  try {
    const raw = window.localStorage.getItem(HOME_PUZZLE_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<HomeDailyPuzzle>;
    return isHomeDailyPuzzle(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function loadHomeDailyPuzzle(): Promise<HomeDailyPuzzle | null> {
  try {
    const response = await fetch('/api/puzzles/daily?slot=homepage', {
      credentials: 'same-origin',
    });
    if (!response.ok) return null;
    const body = (await response.json()) as Partial<HomeDailyPuzzle>;
    if (!isHomeDailyPuzzle(body)) return null;
    try {
      window.localStorage.setItem(HOME_PUZZLE_CACHE_KEY, JSON.stringify(body));
    } catch {
      // storage full/unavailable: caching is best-effort
    }
    return body;
  } catch {
    return null;
  }
}

export function renderHomePuzzleWidget(daily: HomeDailyPuzzle): HTMLElement {
  const { puzzle } = daily;
  const link = document.createElement('a');
  link.className = 'home-puzzle-widget';
  link.href = `/puzzles/${encodeURIComponent(puzzle.id)}`;
  link.setAttribute('aria-label', t('homePuzzle.ariaLabel', { title: puzzle.title }));

  const paint = () => link.replaceChildren(...renderHomePuzzleWidgetContent(puzzle));
  paint();
  window.addEventListener(xiangqiAppearanceChangedEvent, paint);
  return link;
}

function renderHomePuzzleWidgetContent(puzzle: HomeDailyPuzzle['puzzle']): HTMLElement[] {
  const title = document.createElement('span');
  title.className = 'home-puzzle-widget-title';
  title.textContent = t('homePuzzle.title', { variant: variantDisplayLabel(puzzle.variant) });

  const turn = document.createElement('span');
  turn.className = 'home-puzzle-widget-turn';
  turn.textContent = t('homePuzzle.toPlay', { color: colorLabel(puzzle.sideToMove) });

  return [title, renderHomePuzzleBox(puzzle), turn];
}

// The flush board box: a square filling the rail, with the board hugging the inner
// (center-facing) edge. Title/turn captions sit outside the box (see landing.css).
function renderHomePuzzleBox(puzzle: HomeDailyPuzzle['puzzle']): HTMLElement {
  const box = document.createElement('div');
  box.className = 'home-puzzle-box';
  const turn = puzzle.sideToMove ?? 'red';

  if (puzzle.variant === XIANGQI_SPEC_ID) {
    // The standard 9x10 board renders from the solver's perspective; no reserve.
    box.append(
      homePuzzleBoardSurface(
        renderXiangqiBoardSvg(
          getStandardXiangqiPlayerView(puzzle.initial, turn),
          turn,
          // A thumbnail that links to the puzzle, not a board anyone plays on.
          // Suppressing the labels also keeps the box's authored aspect ratio
          // right: the host clips, and the gutter is a different rectangle.
          { coordinates: false },
        ),
      ),
    );
    return box;
  }

  // Fail-closed: isHomeDailyPuzzle already filters unknown variants, so this is
  // unreachable from the fetch/cache paths. Never fall back to another board.
  throw new Error(`Unsupported daily puzzle variant: ${puzzle.variant}`);
}

function homePuzzleBoardSurface(svg: string): HTMLElement {
  const board = document.createElement('div');
  board.className = 'home-puzzle-widget-board';
  board.innerHTML = svg;
  // Center the board within the square box so a non-square (portrait xiangqi) board
  // pillarboxes symmetrically rather than jamming against the center column.
  board.querySelector('svg')?.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  return board;
}

function isHomeDailyPuzzle(value: Partial<HomeDailyPuzzle>): value is HomeDailyPuzzle {
  return (
    typeof value.daily?.day === 'string' &&
    typeof value.daily.slot === 'string' &&
    typeof value.puzzle?.id === 'string' &&
    typeof value.puzzle.title === 'string' &&
    typeof value.puzzle.variant === 'string' &&
    // Fail-closed variant gate: a daily for a variant this widget cannot paint
    // (a future rotation addition) reads as a miss, so the homepage simply
    // omits the widget instead of rendering the position on the wrong board.
    HOME_PUZZLE_VARIANTS.includes(value.puzzle.variant) &&
    typeof value.puzzle.solutionPlyCount === 'number' &&
    typeof value.puzzle.initial === 'object' &&
    value.puzzle.initial !== null
  );
}

function colorLabel(color: XiangqiColor | null): string {
  return color === 'black' ? t('setup.black') : t('setup.red');
}
