// The live jieqi room's reveal odds (jieqi-reveal-odds.ts has the counting and
// why it is exact). Three UI variants behind `?revealOdds=a|b|c`, for a pick:
//
//   a. a compact pool row beside each seat's captured tray: piece glyphs with
//      unseen counts, the percentage on hover or tap; the uncertain side adds
//      "N taken unseen";
//   b. hover or tap any face-down piece on the board for a popover with its
//      side's odds, plus a slim pool row (glyphs and counts only);
//   c. a table in the game-info rail (below the board on a phone): one row per
//      piece type, one column per side, percent and count in each cell.
//
// Every number comes from the DISPLAYED view only (the seat's own PlayerView,
// or the spectator's public view), so the aid can never know more than the
// viewer. Rows are reserved bands and the popover is an overlay, so nothing
// here moves the board: not when the odds change, not when a popover opens.

import { JIEQI_POOL_ROLE_ORDER, type JieqiColor, type JieqiPieceRole } from '@mistboard/game';
import { t } from './i18n/catalog.js';
import {
  formatRevealPercent,
  jieqiRevealOdds,
  type RevealOdds,
  type RevealOddsSide,
  type RevealOddsVariant,
  type RevealOddsView,
} from './jieqi-reveal-odds.js';
import './live-jieqi-reveal-odds.css';
import { countBadge } from './review/captured-pool.js';

export type RevealOddsSlots = {
  capturesTop: HTMLElement;
  capturesBottom: HTMLElement;
  board: HTMLElement;
  gameInfo: HTMLElement;
};

export type RevealOddsInput = {
  /** The displayed view; null before the first frame. */
  view: (RevealOddsView & { status: { type: string } }) | null;
  /** The ink drawn at the bottom of the board (the viewer's flip). */
  orientation: JieqiColor;
  /** The viewer's seat; null for a spectator. */
  seat: JieqiColor | null;
};

export type PieceGlyph = (piece: { color: JieqiColor; role: JieqiPieceRole }) => string;

export type RevealOddsMount = {
  variant: RevealOddsVariant;
  render(input: RevealOddsInput): void;
};

const INKS: readonly JieqiColor[] = ['red', 'black'];

export function roleName(role: JieqiPieceRole): string {
  return t(`review.luckCard.role.${role}`);
}

export function inkName(color: JieqiColor): string {
  return t(color === 'red' ? 'setup.red' : 'setup.black');
}

/** "Chariot: 2 in 13, 15%": the one sentence every variant reads aloud. */
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

export function mountRevealOdds(
  slots: RevealOddsSlots,
  variant: RevealOddsVariant,
  glyph: () => PieceGlyph,
): RevealOddsMount {
  if (variant === 'c') return mountTable(slots, glyph);
  return mountRows(slots, variant, glyph);
}

// ── a / b: a pool row beside each seat's tray ───────────────────────────────

function rowHost(position: 'top' | 'bottom', variant: RevealOddsVariant): HTMLDivElement {
  const host = document.createElement('div');
  host.className = `reveal-odds-row reveal-odds-row--${position} reveal-odds-row--${variant}`;
  host.dataset.revealOdds = position;
  return host;
}

// The top row describes the top ink's face-down pieces and sits on the far side
// of the top tray; the bottom row mirrors it. On a phone both rows are lines
// below the board, the viewer's first, so the board keeps its place
// (live-jieqi-reveal-odds.css).
function insertRows(slots: RevealOddsSlots, variant: RevealOddsVariant) {
  const existing = slots.capturesTop.parentElement?.querySelectorAll('[data-reveal-odds]');
  for (const el of existing ?? []) el.remove();
  const top = rowHost('top', variant);
  const bottom = rowHost('bottom', variant);
  slots.capturesTop.before(top);
  slots.capturesBottom.after(bottom);
  return { top, bottom };
}

function mountRows(
  slots: RevealOddsSlots,
  variant: RevealOddsVariant,
  glyph: () => PieceGlyph,
): RevealOddsMount {
  const rows = insertRows(slots, variant);
  const interactive = variant === 'a';
  // Which chip's percentage is open (tap), kept across re-renders.
  let open: { color: JieqiColor; role: JieqiPieceRole } | null = null;
  let last: RevealOddsInput | null = null;
  const popover = variant === 'b' ? installPopover(slots, () => last, glyph) : null;

  const paint = (): void => {
    const odds = last ? oddsToShow(last.view) : null;
    const bottomInk = last?.orientation ?? 'red';
    const topInk: JieqiColor = bottomInk === 'red' ? 'black' : 'red';
    const draw = glyph();
    renderPoolRow(rows.top, odds?.[topInk] ?? null, { interactive, open, glyph: draw });
    renderPoolRow(rows.bottom, odds?.[bottomInk] ?? null, { interactive, open, glyph: draw });
    popover?.refresh();
  };

  if (interactive) {
    const onChip = (event: Event): void => {
      const chip = (event.target as Element | null)?.closest<HTMLElement>('.reveal-odds-chip');
      if (!chip) return;
      const color = chip.dataset.ink as JieqiColor;
      const role = chip.dataset.role as JieqiPieceRole;
      open = open && open.color === color && open.role === role ? null : { color, role };
      paint();
    };
    rows.top.addEventListener('click', onChip);
    rows.bottom.addEventListener('click', onChip);
    document.addEventListener('click', (event) => {
      if (!open) return;
      const target = event.target as Element | null;
      if (target?.closest('.reveal-odds-chip')) return;
      open = null;
      paint();
    });
  }

  return {
    variant,
    render(input) {
      last = input;
      paint();
    },
  };
}

export function renderPoolRow(
  host: HTMLElement,
  side: RevealOddsSide | null,
  options: {
    interactive: boolean;
    open: { color: JieqiColor; role: JieqiPieceRole } | null;
    glyph: PieceGlyph;
  },
): void {
  host.replaceChildren();
  if (!side || side.faceDown === 0) {
    delete host.dataset.ink;
    return;
  }
  host.dataset.ink = side.color;
  host.setAttribute(
    'aria-label',
    `${t('live.revealOdds.title')}: ${inkName(side.color)}, ${t('live.revealOdds.faceDownCount', { count: side.faceDown })}`,
  );
  const lead = document.createElement('span');
  lead.className = 'reveal-odds-row__lead';
  lead.textContent = t('live.revealOdds.faceDownCount', { count: side.faceDown });
  host.append(lead);
  const pieces = document.createElement('span');
  pieces.className = 'reveal-odds-row__pieces';
  for (const entry of side.entries) {
    const chip = document.createElement(options.interactive ? 'button' : 'span');
    if (chip instanceof HTMLButtonElement) chip.type = 'button';
    chip.className = 'reveal-odds-chip';
    chip.dataset.ink = side.color;
    chip.dataset.role = entry.role;
    chip.dataset.count = String(entry.count);
    chip.setAttribute('aria-label', chanceText(side, entry.role));
    if (options.interactive) {
      const isOpen = options.open?.color === side.color && options.open.role === entry.role;
      chip.classList.toggle('is-open', isOpen);
      chip.setAttribute('aria-expanded', String(isOpen));
    }
    const disc = document.createElement('span');
    disc.className = 'reveal-odds-chip__piece';
    disc.setAttribute('aria-hidden', 'true');
    disc.innerHTML = options.glyph({ color: side.color, role: entry.role });
    chip.append(disc);
    if (entry.count > 1) chip.append(countBadge(entry.count));
    if (options.interactive) {
      const pct = document.createElement('span');
      pct.className = 'reveal-odds-chip__pct';
      pct.setAttribute('aria-hidden', 'true');
      pct.textContent = formatRevealPercent(entry.probability);
      chip.append(pct);
    }
    pieces.append(chip);
  }
  host.append(pieces);
  if (side.takenUnseen > 0) {
    const note = document.createElement('span');
    note.className = 'reveal-odds-row__note';
    note.textContent = t('live.revealOdds.takenUnseen', { count: side.takenUnseen });
    host.append(note);
  }
}

// ── b: the popover over the board ───────────────────────────────────────────

function installPopover(
  slots: RevealOddsSlots,
  current: () => RevealOddsInput | null,
  glyph: () => PieceGlyph,
): { refresh(): void } {
  const stage = slots.board.parentElement;
  const pop = document.createElement('div');
  pop.className = 'reveal-odds-pop';
  pop.hidden = true;
  pop.setAttribute('role', 'status');
  stage?.append(pop);
  // The square the popover belongs to, and whether a tap pinned it (a hover
  // popover follows the pointer; a tapped one stays until the next tap).
  let square: string | null = null;
  let pinned = false;

  const faceDownAt = (sq: string | null): JieqiColor | null => {
    const view = current()?.view;
    if (!sq || !view) return null;
    const entry = view.board[sq as keyof typeof view.board];
    return entry?.faceDown ? entry.color : null;
  };

  const hide = (): void => {
    pop.hidden = true;
    square = null;
    pinned = false;
  };

  const show = (sq: string): void => {
    const ink = faceDownAt(sq);
    const odds = oddsToShow(current()?.view ?? null);
    const hit = slots.board.querySelector(`[data-square="${sq}"]`);
    if (!ink || !odds || !stage || !hit) {
      hide();
      return;
    }
    square = sq;
    renderPopover(pop, odds[ink], glyph());
    pop.hidden = false;
    const s = stage.getBoundingClientRect();
    const r = hit.getBoundingClientRect();
    const x = r.left + r.width / 2 - s.left;
    const below = r.top + r.height / 2 - s.top < s.height / 2;
    const half = pop.offsetWidth / 2;
    pop.style.left = `${Math.min(Math.max(x, half + 4), s.width - half - 4)}px`;
    pop.style.top = below ? `${r.bottom - s.top + 4}px` : `${r.top - s.top - 4}px`;
    pop.dataset.place = below ? 'below' : 'above';
  };

  const squareOf = (target: EventTarget | null): string | null =>
    (target as Element | null)?.closest<HTMLElement>('[data-square]')?.dataset.square ?? null;

  slots.board.addEventListener('pointermove', (event) => {
    if (event.pointerType !== 'mouse' || pinned) return;
    const sq = squareOf(event.target);
    if (sq === square) return;
    if (faceDownAt(sq)) show(sq as string);
    else hide();
  });
  slots.board.addEventListener('pointerleave', (event) => {
    if (event.pointerType === 'mouse' && !pinned) hide();
  });
  // A tap (or click) on a face-down piece pins its popover; any other tap
  // closes it. The board's own click handling runs too: tapping your own
  // face-down piece still selects it.
  document.addEventListener('click', (event) => {
    const target = event.target as Element | null;
    const sq = slots.board.contains(target) ? squareOf(target) : null;
    if (sq && faceDownAt(sq) && !(pinned && sq === square)) {
      show(sq);
      pinned = true;
    } else hide();
  });

  return {
    refresh() {
      if (square && faceDownAt(square)) show(square);
      else hide();
    },
  };
}

export function renderPopover(host: HTMLElement, side: RevealOddsSide, glyph: PieceGlyph): void {
  host.replaceChildren();
  host.dataset.ink = side.color;
  const title = document.createElement('div');
  title.className = 'reveal-odds-pop__title';
  title.textContent = t('live.revealOdds.anyPiece', { color: inkName(side.color) });
  host.append(title);
  const grid = document.createElement('div');
  grid.className = 'reveal-odds-pop__grid';
  for (const entry of side.entries) {
    const cell = document.createElement('div');
    cell.className = 'reveal-odds-pop__cell';
    cell.dataset.role = entry.role;
    cell.setAttribute('aria-label', chanceText(side, entry.role));
    const disc = document.createElement('span');
    disc.className = 'reveal-odds-pop__piece';
    disc.setAttribute('aria-hidden', 'true');
    disc.innerHTML = glyph({ color: side.color, role: entry.role });
    const pct = document.createElement('span');
    pct.className = 'reveal-odds-pop__pct';
    pct.setAttribute('aria-hidden', 'true');
    pct.textContent = formatRevealPercent(entry.probability);
    const count = document.createElement('span');
    count.className = 'reveal-odds-pop__count';
    count.setAttribute('aria-hidden', 'true');
    count.textContent = `${entry.count}/${side.unseen}`;
    cell.append(disc, pct, count);
    grid.append(cell);
  }
  host.append(grid);
  if (side.takenUnseen > 0) {
    const note = document.createElement('div');
    note.className = 'reveal-odds-pop__note';
    note.textContent = t('live.revealOdds.takenUnseen', { count: side.takenUnseen });
    host.append(note);
  }
}

// ── c: the odds table in the game-info rail ─────────────────────────────────

function mountTable(slots: RevealOddsSlots, glyph: () => PieceGlyph): RevealOddsMount {
  const anchor = slots.gameInfo.closest('.panel-section') ?? slots.gameInfo;
  anchor.parentElement?.querySelector('[data-reveal-odds="table"]')?.remove();
  const section = document.createElement('section');
  section.className = 'panel-section reveal-odds-table';
  section.dataset.revealOdds = 'table';
  section.hidden = true;
  const details = document.createElement('details');
  details.open = true;
  const summary = document.createElement('summary');
  summary.className = 'reveal-odds-table__summary';
  summary.textContent = t('live.revealOdds.title');
  const body = document.createElement('div');
  body.className = 'reveal-odds-table__body';
  details.append(summary, body);
  section.append(details);
  anchor.after(section);
  return {
    variant: 'c',
    render(input) {
      const odds = oddsToShow(input.view);
      section.hidden = odds === null;
      if (!odds) {
        body.replaceChildren();
        return;
      }
      renderOddsTable(body, odds, input, glyph());
    },
  };
}

export function renderOddsTable(
  host: HTMLElement,
  odds: RevealOdds,
  input: Pick<RevealOddsInput, 'orientation' | 'seat'>,
  glyph: PieceGlyph,
): void {
  const bottom = input.orientation;
  const columns: JieqiColor[] = [bottom === 'red' ? 'black' : 'red', bottom];
  const table = document.createElement('table');
  table.className = 'reveal-odds-table__grid';
  const head = table.createTHead().insertRow();
  head.append(document.createElement('th'));
  for (const ink of columns) {
    const th = document.createElement('th');
    th.scope = 'col';
    th.dataset.ink = ink;
    const name = document.createElement('span');
    name.className = 'reveal-odds-table__ink';
    name.textContent = input.seat === ink ? `${inkName(ink)} (${t('live.you')})` : inkName(ink);
    const sub = document.createElement('span');
    sub.className = 'reveal-odds-table__sub';
    sub.textContent = t('live.revealOdds.faceDownCount', { count: odds[ink].faceDown });
    th.append(name, sub);
    head.append(th);
  }
  const tbody = table.createTBody();
  for (const role of JIEQI_POOL_ROLE_ORDER) {
    const row = tbody.insertRow();
    row.dataset.role = role;
    const th = document.createElement('th');
    th.scope = 'row';
    const disc = document.createElement('span');
    disc.className = 'reveal-odds-table__piece';
    disc.setAttribute('aria-hidden', 'true');
    disc.innerHTML = glyph({ color: bottom, role });
    const label = document.createElement('span');
    label.textContent = roleName(role);
    th.append(disc, label);
    row.append(th);
    for (const ink of columns) {
      const side = odds[ink];
      const cell = row.insertCell();
      cell.dataset.ink = ink;
      const entry = side.entries.find((e) => e.role === role);
      if (!entry || side.faceDown === 0) {
        cell.className = 'is-empty';
        cell.textContent = '0';
        continue;
      }
      cell.setAttribute('aria-label', chanceText(side, role));
      const pct = document.createElement('strong');
      pct.textContent = formatRevealPercent(entry.probability);
      const count = document.createElement('span');
      count.className = 'reveal-odds-table__count';
      count.textContent = `${entry.count}/${side.unseen}`;
      cell.append(pct, count);
    }
  }
  if (INKS.some((ink) => odds[ink].takenUnseen > 0)) {
    const foot = table.createTFoot().insertRow();
    foot.append(document.createElement('th'));
    for (const ink of columns) {
      const cell = foot.insertCell();
      cell.dataset.ink = ink;
      if (odds[ink].takenUnseen > 0) {
        cell.textContent = t('live.revealOdds.takenUnseen', { count: odds[ink].takenUnseen });
      }
    }
  }
  host.replaceChildren(table);
}
