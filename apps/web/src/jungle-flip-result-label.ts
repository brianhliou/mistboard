import type { JungleFlipColor } from '@mistboard/game';
import { flipSeatInk } from './flip-seat-ink.js';
import { type GameOutcome, humanizeToken, outcomeLabel } from './game-display.js';
import { t } from './i18n/catalog.js';

// Flip Jungle seats are first/second mover ('red' seat = first); the ink binds on the
// opening flip and travels as the view's `firstColor`. The recorded result and the
// timeline's `color` are keyed by SEAT, so the raw token shows "Red" even when the
// first-mover seat flipped black. Translate seat -> bound ink for every player-facing
// label, falling back to move order before the flip binds. Import-light on purpose so
// result-only surfaces can reuse it without pulling in board renderers. The seat -> ink
// map itself lives in flip-seat-ink.ts, shared with Banqi and the /watch seat rows.

export function jungleFlipSeatInk(
  seat: JungleFlipColor,
  firstColor: JungleFlipColor | null,
): JungleFlipColor | null {
  return flipSeatInk(seat, firstColor);
}

export function jungleFlipSeatInkLabel(
  seat: JungleFlipColor,
  firstColor: JungleFlipColor | null,
): string {
  const ink = jungleFlipSeatInk(seat, firstColor);
  if (ink === null) return seat === 'red' ? t('setup.first') : t('setup.second');
  // The Jungle family brands its navy ink "Blue" (internal id stays 'black').
  return ink === 'red' ? t('setup.red') : t('setup.blue');
}

export function jungleFlipOutcome(result: string, firstColor: JungleFlipColor | null): GameOutcome {
  if (result === 'red-wins') return { winner: jungleFlipSeatInkLabel('red', firstColor) };
  if (result === 'black-wins') return { winner: jungleFlipSeatInkLabel('black', firstColor) };
  if (result === 'draw') return { draw: true };
  return { label: humanizeToken(result) };
}

export function jungleFlipResultLabel(result: string, firstColor: JungleFlipColor | null): string {
  return outcomeLabel(jungleFlipOutcome(result, firstColor));
}
