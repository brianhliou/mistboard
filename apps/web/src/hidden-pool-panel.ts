import type { HiddenPoolSide } from '@mistboard/game';
import './hidden-pool-panel.css';
import { t } from './i18n/catalog.js';
import { countBadge } from './review/captured-pool.js';

// The "still face-down" panel for the flip variants: one row per ink listing the
// pieces of that ink not yet revealed or captured, grouped by role with a count
// badge, strongest first. The pool is what a flip-variant player actually
// reasons with ("what can that tile still be?"); the captured strips only imply
// it. Rows are ordered top-to-bottom like the board (opponent, then viewer).
//
// A row's `unknownCaptured` (jieqi: your own dark pieces the opponent took) is
// written as a note after the pieces, because those pieces are still drawn in
// the row: the viewer cannot subtract what they were never shown.
//
// Rendered from the masked player view only (never the truth): see
// packages/game/src/hidden-pool.ts. The caller clears nothing; this replaces the
// host's children on every call, and an empty host collapses via CSS.

export type HiddenPoolRow<Color extends string, Role extends string> = {
  color: Color;
  /** Row label: the localized ink as the variant brands it (setup.red / black / blue). */
  label: string;
  side: HiddenPoolSide<Role>;
};

export function renderHiddenPoolPanel<Color extends string, Role extends string>(
  host: HTMLElement,
  rows: ReadonlyArray<HiddenPoolRow<Color, Role>>,
  renderPiece: (entry: { color: Color; role: Role }) => string,
): void {
  host.replaceChildren();
  if (rows.every((row) => row.side.total === 0)) return;
  const caption = document.createElement('div');
  caption.className = 'hidden-pool__caption';
  caption.textContent = t('live.stillFaceDown');
  host.append(caption);
  for (const row of rows) {
    const line = document.createElement('div');
    line.className = 'hidden-pool__row';
    line.dataset.ink = row.color;
    const label = document.createElement('span');
    label.className = 'hidden-pool__label';
    label.textContent = row.label;
    line.append(label);
    const pieces = document.createElement('div');
    pieces.className = 'captures-row review-captures-row hidden-pool__pieces';
    if (row.side.total === 0) {
      const none = document.createElement('span');
      none.className = 'hidden-pool__none';
      none.textContent = t('live.allRevealed');
      pieces.append(none);
    }
    for (const entry of row.side.entries) {
      const span = document.createElement('span');
      span.className = entry.count > 1 ? 'review-capture-piece has-count' : 'review-capture-piece';
      const text = `${row.label} ${entry.role}`;
      span.setAttribute('aria-label', entry.count > 1 ? `${text} x${entry.count}` : text);
      span.innerHTML = renderPiece({ color: row.color, role: entry.role });
      if (entry.count > 1) span.append(countBadge(entry.count));
      pieces.append(span);
    }
    line.append(pieces);
    if (row.side.unknownCaptured > 0) {
      const note = document.createElement('span');
      note.className = 'hidden-pool__note';
      note.textContent = t('live.unknownCaptured', { count: row.side.unknownCaptured });
      line.append(note);
    }
    host.append(line);
  }
}
