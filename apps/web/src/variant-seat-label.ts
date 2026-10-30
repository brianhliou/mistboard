import { type GameSpecId, maybeGameSpecForId } from '@mistboard/game';
import { t } from './i18n/catalog.js';

// Display word for a seat color. The Jungle family (Jungle Chess + Flip Jungle)
// brands its dark side "Blue": the pieces are navy (#28323c) and read as blue,
// not black. The INTERNAL color id stays 'black' (no data/protocol migration) —
// this is a presentation-only rename. Every other variant shows the literal
// color word. Centralized so seat rows, result lines, POV toggles, and matchup
// labels all agree on the word, which is also why translating it here reaches
// every one of those surfaces at once.
export function seatColorWord(variant: string | null | undefined, color: string): string {
  if (color === 'red') return t('setup.red');
  if (color === 'white') return t('setup.white');
  if (color === 'black') return brandsBlackAsBlue(variant) ? t('setup.blue') : t('setup.black');
  return color.charAt(0).toUpperCase() + color.slice(1);
}

/**
 * True when this variant brands its 'black' ink as Blue. Same predicate the word
 * above uses, exported so the seat DISCS key on it too: the word and the dot beside
 * it disagreeing is exactly the defect this fixes, and two copies of `family ===
 * 'jungle'` would let them drift apart again.
 *
 * Presentation only. The internal color id stays 'black' everywhere -- nothing
 * downstream should ever compare against the string 'blue'.
 */
export function brandsBlackAsBlue(variant: string | null | undefined): boolean {
  return (variant ? maybeGameSpecForId(variant)?.family : undefined) === 'jungle';
}

/**
 * The `data-seat-ink-family` value for a surface showing this variant, or null when
 * it needs none. Pages that swap variants in place (/watch) stamp this on a
 * container; `seat-disc-ink.css` hangs the ink tokens off it. Review pages already
 * carry a `.jungle-review` / `.jungle-flip-review` class and need nothing here.
 */
export function seatInkFamily(variant: string | null | undefined): string | null {
  return brandsBlackAsBlue(variant) ? 'jungle' : null;
}

/**
 * How a variant names its seats on list and result surfaces. 'seat-word': the
 * seat id IS a side the player plays as (Red, Black, White, the mahjong winds),
 * so "West wins" is a sentence. 'player': the seat id is bookkeeping nobody plays
 * as. Xiangqi mahjong's east/west only alternate the deal, its table names the
 * seats "You", the handle or the bot, and "West is victorious" beside that table
 * read as a third party. A 'player' variant names the winner by player, or uses a
 * seat-neutral phrase where no name is at hand, and never prints the seat id.
 *
 * Exhaustive over GameSpecId so a new variant must choose (fail closed); an
 * unknown or legacy variant string reads as 'seat-word', the old behaviour.
 */
export type SeatNaming = 'seat-word' | 'player';
const SEAT_NAMING: Readonly<Record<GameSpecId, SeatNaming>> = {
  banqi: 'seat-word',
  mahjong: 'seat-word',
  'xiangqi-mahjong': 'player',
  'three-kingdoms-banqi': 'seat-word',
  'dark-chess': 'seat-word',
  'dark-xiangqi': 'seat-word',
  'fortress-xiangqi': 'seat-word',
  jieqi: 'seat-word',
  jungle: 'seat-word',
  'jungle-flip': 'seat-word',
  xiangqi: 'seat-word',
  'crazyhouse-xiangqi': 'seat-word',
  'duck-xiangqi': 'seat-word',
  'atomic-xiangqi': 'seat-word',
  chess: 'seat-word',
};

export function seatsNamePlayers(variant: string | null | undefined): boolean {
  const spec = variant ? maybeGameSpecForId(variant) : undefined;
  return spec ? SEAT_NAMING[spec.id] === 'player' : false;
}
