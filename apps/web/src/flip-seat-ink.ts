import { maybeGameSpecForId } from '@mistboard/game';

// Flip variants (Banqi, Flip Jungle) seat their players as first/second MOVER under
// the color ids 'red'/'black'. The ink each seat plays binds on the opening flip and
// travels as the game state's `firstColor` — it is never a stored column, so the
// recorded result, the timeline's `color`, and the participant rows are all
// SEAT-keyed. Half of all flip games bind the opposite way round, so a raw seat used
// as a color is wrong half the time rather than merely inconsistent.
//
// This module is the seat -> ink map alone, deliberately import-light: a caller that
// only needs a disc color (the /watch seat rows) should not have to pull in a result
// -label module, and the two label modules should not each keep their own copy of the
// mapping.

export type FlipSeat = 'red' | 'black';

// Keyed on the spec's SETUP rule rather than its id, so the flip family is read out
// of the registry (alias ids and future members resolve through the same lookup) and
// the members are typed union values rather than loose strings. Note that
// 'jieqi-deal' is NOT here: jieqi deals its pieces face down but its seats own a
// fixed ink from move one.
const FLIP_INK_SETUPS: ReadonlySet<string> = new Set(['banqi-deal', 'jungle-flip-deal']);

/** True when the variant's seats are move-order slots whose ink binds on a flip. */
export function isFlipSeatVariant(variant: string | null | undefined): boolean {
  if (!variant) return false;
  const setup = maybeGameSpecForId(variant)?.setup;
  return setup !== undefined && FLIP_INK_SETUPS.has(setup);
}

/**
 * The ink a flip seat plays, or null before the opening flip binds one. The
 * first-mover seat ('red') plays `firstColor`; the second-mover seat plays the
 * other ink.
 */
export function flipSeatInk(seat: FlipSeat, firstColor: FlipSeat | null): FlipSeat | null {
  if (firstColor === null) return null;
  return seat === 'red' ? firstColor : firstColor === 'red' ? 'black' : 'red';
}

/**
 * False when the variant's seats have no colour at all: the mahjong family seats
 * players by wind (east, west), and a seat disc there is an empty grey circle
 * that claims a colour the game does not have. Callers draw no disc instead.
 */
export function variantSeatsHaveInk(variant: string | null | undefined): boolean {
  if (!variant) return true;
  return maybeGameSpecForId(variant)?.family !== 'mahjong';
}

/**
 * The ink a seat renders as for ANY variant: flip variants translate through
 * `firstColor` (null until the flip binds), and every other variant has seat == ink
 * so the seat passes straight through. Use this wherever a seat id is about to be
 * painted as a color.
 */
export function seatInkForVariant(
  variant: string | null | undefined,
  seat: string,
  firstColor: FlipSeat | null | undefined,
): string | null {
  if (!isFlipSeatVariant(variant)) return seat;
  if (seat !== 'red' && seat !== 'black') return seat;
  return flipSeatInk(seat, firstColor ?? null);
}

/**
 * A live flip game's bound ink, read out of a postgame-shaped board payload's
 * view (the /watch rows and the /games cards both get one). The payload is
 * `Record<string, unknown>` by contract (the renderers own its shape), so this
 * narrows defensively: anything unexpected reads as unbound, which renders a
 * neutral disc rather than a wrong one.
 */
export function payloadFirstColor(
  payload: Record<string, unknown> | null | undefined,
): FlipSeat | null {
  const view = (payload as { view?: { firstColor?: unknown } } | null | undefined)?.view;
  const firstColor = view?.firstColor;
  return firstColor === 'red' || firstColor === 'black' ? firstColor : null;
}
