import type { BanqiColor } from '@mistboard/game';
import { flipSeatInk } from './flip-seat-ink.js';
import { type GameOutcome, humanizeToken, outcomeLabel } from './game-display.js';
import { t } from './i18n/catalog.js';

// Banqi seats are first/second mover ('red' seat = first); the ink binds on the opening flip
// and travels as the game state's `firstColor`. The recorded result and the timeline's `color`
// are keyed by SEAT, so the raw token shows "Red" even when the first-mover seat flipped black.
// Translate seat -> bound ink for every player-facing label, falling back to move order before
// the flip binds. This module is import-light on purpose so result-only surfaces (the watch
// queue) can reuse it without pulling in board renderers. The seat -> ink map itself lives in
// flip-seat-ink.ts, shared with Flip Jungle and the /watch seat rows.

export function seatInkLabel(seat: BanqiColor, firstColor: BanqiColor | null): string {
  const ink = flipSeatInk(seat, firstColor);
  if (ink === null) return seat === 'red' ? t('setup.first') : t('setup.second');
  return ink === 'red' ? t('setup.red') : t('setup.black');
}

export function banqiOutcome(result: string, firstColor: BanqiColor | null): GameOutcome {
  if (result === 'red-wins') return { winner: seatInkLabel('red', firstColor) };
  if (result === 'black-wins') return { winner: seatInkLabel('black', firstColor) };
  if (result === 'draw') return { draw: true };
  return { label: humanizeToken(result) };
}

export function banqiResultLabel(result: string, firstColor: BanqiColor | null): string {
  return outcomeLabel(banqiOutcome(result, firstColor));
}
