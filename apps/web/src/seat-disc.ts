import './seat-disc-ink.css';
import './seat-disc.css';

// The seat disc: the one circle beside a player's name that says which colour
// they have, on every surface (seat-disc.css has the look and the history).
// `ink` is what the seat plays on the board ('red', 'black', 'white', 'blue');
// null is a flip variant before its opening flip binds an ink, drawn as a dashed
// ring rather than a guess. The Jungle family's second ink paints blue through
// `data-seat-ink-family` (or a family page class) on an ancestor.
//
// `hostClass` is the caller's own layout hook (size via --seat-disc-size,
// margins); colour always comes from here.

/** The class list for a seat disc, for callers that build markup as a string. */
export function seatDiscClass(ink: string | null, hostClass?: string): string {
  const base = `seat-disc seat-disc--${ink ?? 'unbound'}`;
  return hostClass ? `${hostClass} ${base}` : base;
}

export function seatDiscEl(ink: string | null, hostClass?: string): HTMLSpanElement {
  const disc = document.createElement('span');
  disc.className = seatDiscClass(ink, hostClass);
  disc.setAttribute('aria-hidden', 'true');
  return disc;
}
