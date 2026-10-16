/**
 * Low-time emphasis shared by both live clock renderers (live-clocks.ts for the
 * chess shell, variant-tenant/room-chrome.ts for tenant rooms): the share of the
 * starting time left, drawn as the bar under/over each clock tab, and the red
 * "emergency" tint once a clock drops into its last stretch.
 */

/** Lichess's emergency band: an eighth of the starting time, clamped to 10-60 s. */
export function clockEmergencyMs(initialMs: number): number {
  return Math.min(60_000, Math.max(10_000, initialMs / 8));
}

/** Share of the starting time left, 0..1 (an increment can push past the start). */
export function clockFractionLeft(remainingMs: number, initialMs: number): number {
  if (initialMs <= 0) return 0;
  return Math.max(0, Math.min(1, remainingMs / initialMs));
}

/**
 * Sets `--clock-left` and the `emerg` class on a clock row. A null start (no
 * live clock, or a days-per-move room where a fraction of days means nothing)
 * clears both, so the row draws no bar and never reads as urgent.
 */
export function applyClockEmphasis(
  row: HTMLElement,
  remainingMs: number,
  initialMs: number | null,
): void {
  if (!initialMs || initialMs <= 0) {
    row.style.removeProperty('--clock-left');
    row.classList.remove('emerg', 'has-bar');
    return;
  }
  row.style.setProperty('--clock-left', clockFractionLeft(remainingMs, initialMs).toFixed(4));
  row.classList.add('has-bar');
  row.classList.toggle('emerg', remainingMs < clockEmergencyMs(initialMs));
}

/**
 * Lichess clock face: zero-padded minutes (`00:24`), a dimmed colon, and the
 * tenths digit set small (`00:24.9`), so the digits fill the tab instead of
 * floating in it. Takes formatClock's text; an hours clock keeps its `H:MM:SS`.
 * Rebuilds only when the text changes (the live tick runs every 100 ms).
 */
export function setClockFace(el: HTMLElement, text: string): void {
  const padded = /^\d:\d\d(\.\d)?$/.test(text) ? `0${text}` : text;
  if (el.dataset.face === padded) return;
  el.dataset.face = padded;
  const match = /^(.*\d)(\.\d)$/.exec(padded);
  const main = match ? match[1] : padded;
  const tenths = match ? match[2] : '';
  const parts: Node[] = [];
  main.split(':').forEach((chunk, index) => {
    if (index > 0) {
      const sep = document.createElement('span');
      sep.className = 'clock-sep';
      sep.textContent = ':';
      parts.push(sep);
    }
    parts.push(document.createTextNode(chunk));
  });
  if (tenths) {
    const small = document.createElement('span');
    small.className = 'clock-tenths';
    small.textContent = tenths;
    parts.push(small);
  }
  el.replaceChildren(...parts);
}
