import './seat-disc-ink.css';
import './seat-disc.css';

// The seat disc beside a player's name in the compact showcase rows (homepage TV):
// the same circle the /watch seat rows draw (.watch-player-disc). `ink` is what
// the seat plays on the board ('red', 'black', 'white'); null is a flip variant
// before its opening flip binds an ink, drawn as a dashed ring rather than a guess.
// The Jungle family's second ink paints blue through `data-seat-ink-family` on an
// ancestor (seat-disc-ink.css).
export function seatDiscEl(ink: string | null): HTMLSpanElement {
  const disc = document.createElement('span');
  disc.className = `seat-disc seat-disc--${ink ?? 'unbound'}`;
  disc.setAttribute('aria-hidden', 'true');
  return disc;
}
