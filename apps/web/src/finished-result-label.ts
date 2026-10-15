// Result words for a finished game row (the /watch queue and the /games "Just
// finished" tiles). Import-light on purpose: no renderers, no route modules.

import { banqiResultLabel } from './banqi-result-label.js';
import { colorWinsLabel, displayParticipantName, type FeaturedGame } from './game-display.js';
import { t } from './i18n/catalog.js';
import { jungleFlipResultLabel } from './jungle-flip-result-label.js';
import { seatColorWord, seatsNamePlayers } from './variant-seat-label.js';

export function resultLabel(result: string): string {
  if (result === 'white-wins') return t('watch.whiteWins');
  if (result === 'black-wins') return t('watch.blackWins');
  if (result === 'red-wins') return t('watch.redWins');
  return t('watch.draw');
}

// Flip variants (Banqi, Flip Jungle) decouple seat from ink, so their seat-keyed
// result needs the game's firstColor to read by ink ("Black wins" / "Blue wins").
// Every other variant has seat == ink; route the winning-side word through
// seatColorWord so the Jungle family reads "Blue wins" (its canonical second-seat
// color) instead of "Black wins".
export function watchQueueResultLabel(game: FeaturedGame): string {
  if (game.variant === 'banqi') return banqiResultLabel(game.result, game.firstColor ?? null);
  if (game.variant === 'jungle-flip')
    return jungleFlipResultLabel(game.result, game.firstColor ?? null);
  const result = game.result;
  // Xiangqi mahjong's east/west are bookkeeping: name the winning player, as its
  // table does, never the seat (variant-seat-label.ts SEAT_NAMING).
  if ((result === 'east-wins' || result === 'west-wins') && seatsNamePlayers(game.variant)) {
    return colorWinsLabel(displayParticipantName(game, result === 'east-wins' ? 'east' : 'west'));
  }
  if (result === 'red-wins') return colorWinsLabel(seatColorWord(game.variant, 'red'));
  if (result === 'black-wins') return colorWinsLabel(seatColorWord(game.variant, 'black'));
  if (result === 'white-wins') return colorWinsLabel(seatColorWord(game.variant, 'white'));
  return resultLabel(result);
}
