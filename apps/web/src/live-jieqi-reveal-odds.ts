// The live jieqi room's reveal odds (jieqi-reveal-odds.ts has the counting and
// why it is exact). A labelled pool row beside each seat's captured tray:
// "N face-down could be:", then a piece icon per unseen role with its count
// badge and its percentage printed under it, always visible; the uncertain side
// adds "N taken unseen" on the label line. On for both seats and spectators,
// rated games included (CLAUDE.md "In-game aids bar").
//
// Every number comes from the DISPLAYED view only (the seat's own PlayerView,
// or the spectator's public view), so the aid can never know more than the
// viewer. Rows are reserved bands, so nothing here moves the board when the
// odds change.

import type { JieqiColor, JieqiPieceRole } from '@mistboard/game';
import { t } from './i18n/catalog.js';
import {
  formatRevealPercent,
  jieqiRevealOdds,
  type RevealOdds,
  type RevealOddsSide,
  type RevealOddsView,
} from './jieqi-reveal-odds.js';
import './live-jieqi-reveal-odds.css';
import { countBadge } from './review/captured-pool.js';

export type RevealOddsSlots = {
  capturesTop: HTMLElement;
  capturesBottom: HTMLElement;
};

export type RevealOddsInput = {
  /** The displayed view; null before the first frame. */
  view: (RevealOddsView & { status: { type: string } }) | null;
  /** The ink drawn at the bottom of the board (the viewer's flip). */
  orientation: JieqiColor;
};

export type PieceGlyph = (piece: { color: JieqiColor; role: JieqiPieceRole }) => string;

export type RevealOddsMount = {
  render(input: RevealOddsInput): void;
};

export function roleName(role: JieqiPieceRole): string {
  return t(`review.luckCard.role.${role}`);
}

export function inkName(color: JieqiColor): string {
  return t(color === 'red' ? 'setup.red' : 'setup.black');
}

/** "Chariot: 2 in 13, 15%": the sentence a screen reader hears per chip. */
export function chanceText(side: RevealOddsSide, role: JieqiPieceRole): string {
  const entry = side.entries.find((e) => e.role === role);
  const count = entry?.count ?? 0;
  return t('live.revealOdds.chance', {
    piece: roleName(role),
    count,
    total: side.unseen,
    percent: formatRevealPercent(entry?.probability ?? 0),
  });
}

/**
 * The odds to show for this view, or null when there is nothing to reveal: no
 * view yet, a game that is over (the board tells the rest), or no face-down
 * piece on either side.
 */
export function oddsToShow(view: RevealOddsInput['view']): RevealOdds | null {
  if (!view || Object.keys(view.board).length === 0) return null;
  if (view.status.type !== 'playing') return null;
  const odds = jieqiRevealOdds(view);
  return odds.red.faceDown + odds.black.faceDown > 0 ? odds : null;
}

function rowHost(position: 'top' | 'bottom'): HTMLDivElement {
  const host = document.createElement('div');
  host.className = `reveal-odds-row reveal-odds-row--${position}`;
  host.dataset.revealOdds = position;
  return host;
}

// The top row describes the top ink's face-down pieces and sits on the far side
// of the top tray; the bottom row mirrors it. On a phone both rows are lines
// below the board, the viewer's first, so the board keeps its place
// (live-jieqi-reveal-odds.css). A remount (a room re-entry) replaces the rows
// rather than stacking them.
export function mountRevealOdds(slots: RevealOddsSlots, glyph: () => PieceGlyph): RevealOddsMount {
  const existing = slots.capturesTop.parentElement?.querySelectorAll('[data-reveal-odds]');
  for (const el of existing ?? []) el.remove();
  const top = rowHost('top');
  const bottom = rowHost('bottom');
  slots.capturesTop.before(top);
  slots.capturesBottom.after(bottom);
  return {
    render(input) {
      const odds = oddsToShow(input.view);
      const bottomInk = input.orientation;
      const topInk: JieqiColor = bottomInk === 'red' ? 'black' : 'red';
      const draw = glyph();
      renderPoolRow(top, odds?.[topInk] ?? null, draw);
      renderPoolRow(bottom, odds?.[bottomInk] ?? null, draw);
    },
  };
}

/**
 * One side's pool row, a labelled block: "N face-down could be:" over the
 * piece icons, each with its chance printed under it, and "N taken unseen" on
 * the label line. An empty side clears the row (its band stays reserved).
 */
export function renderPoolRow(
  host: HTMLElement,
  side: RevealOddsSide | null,
  glyph: PieceGlyph,
): void {
  host.replaceChildren();
  if (!side || side.faceDown === 0) {
    delete host.dataset.ink;
    host.removeAttribute('aria-label');
    return;
  }
  host.dataset.ink = side.color;
  host.setAttribute(
    'aria-label',
    `${t('live.revealOdds.title')}: ${inkName(side.color)}, ${t('live.revealOdds.faceDownCount', { count: side.faceDown })}`,
  );
  const head = document.createElement('span');
  head.className = 'reveal-odds-row__head';
  const lead = document.createElement('span');
  lead.className = 'reveal-odds-row__lead';
  lead.textContent = t('live.revealOdds.couldBe', { count: side.faceDown });
  head.append(lead);
  if (side.takenUnseen > 0) {
    const note = document.createElement('span');
    note.className = 'reveal-odds-row__note';
    note.textContent = t('live.revealOdds.takenUnseen', { count: side.takenUnseen });
    head.append(note);
  }
  const pieces = document.createElement('span');
  pieces.className = 'reveal-odds-row__pieces';
  for (const entry of side.entries) {
    const chip = document.createElement('span');
    chip.className = 'reveal-odds-chip';
    chip.dataset.ink = side.color;
    chip.dataset.role = entry.role;
    chip.dataset.count = String(entry.count);
    chip.setAttribute('role', 'img');
    chip.setAttribute('aria-label', chanceText(side, entry.role));
    const disc = document.createElement('span');
    disc.className = 'reveal-odds-chip__piece';
    disc.setAttribute('aria-hidden', 'true');
    disc.innerHTML = glyph({ color: side.color, role: entry.role });
    if (entry.count > 1) disc.append(countBadge(entry.count));
    const pct = document.createElement('span');
    pct.className = 'reveal-odds-chip__pct';
    pct.setAttribute('aria-hidden', 'true');
    pct.textContent = formatRevealPercent(entry.probability);
    chip.append(disc, pct);
    pieces.append(chip);
  }
  host.append(head, pieces);
}
