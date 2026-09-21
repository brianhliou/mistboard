// Shared clickable move list for the review shell — lichess-style: numbered rows
// pairing the two sides, every move a button that jumps to that ply, the current
// ply highlighted and scrolled into view. Variants build a flat MoveListEntry[]
// (from their timeline) and wire it through the layout's renderMoves hook:
//
//   const moveList = createMoveList(entries, { title: 'Moves' });
//   mountReviewLayout(root, {
//     moves: moveList.el,
//     renderMoves: (ctx, jump) => moveList.update(ctx.ply, jump),
//     ...
//   });
//
// This is the linear foundation the interactive move TREE (variations) extends —
// same row/cell/highlight machinery, with branch children added later.
import './move-list.css';

export type MoveListEntry = {
  /** 1-based ply this move produced (the ply you land on by clicking it). */
  ply: number;
  /** Rendered move text (SAN / from-to / whatever the variant shows). */
  label: string;
  /** Optional per-move annotation shown after the label (eval, glyph). Filled by
   *  the engine phases; absent today. */
  suffix?: string;
  /** Optional suffix colour class hook, e.g. 'blunder' → .review-move--blunder. */
  suffixClass?: string;
  /** The author's or the engine's note on this move, shown under its row. */
  note?: string;
  /** A sideline hung off the position this move was played in: what should have
   *  been played instead, as labels, closed by its verdict. Rendered as an
   *  indented branch under the row, every move a button; clicking one asks the
   *  board for that position (MoveList.bindLine). */
  line?: MoveListLine;
};

export type MoveListLine = {
  /** Rendered move text per step of the line, in order. */
  moves: string[];
  /** Assessment at the line's end ('±', '=', '+−', or a result), if measured. */
  verdict?: string;
  /** A note on the line itself (the study's comment on its first move). */
  note?: string;
};

/** Post-hoc per-move annotation, keyed by the move's ply. Filled once whole-game
 *  analysis returns; see MoveList.annotate. */
export type MoveAnnotation = {
  /** Short judgment glyph shown after the move, e.g. '?!', '?', '??'. Absent = none. */
  suffix?: string;
  /** Colour hook, e.g. 'blunder' → .review-move--blunder. */
  suffixClass?: string;
  /** Formatted position eval after this move (Red POV), e.g. '+2.1', '#3'. Shown
   *  right-aligned in the cell, lichess tree-view style. */
  eval?: string;
};

export type MoveList = {
  el: HTMLElement;
  /** Highlight the move at `currentPly` (scroll into view) and bind `jump` to the
   *  move buttons. Call from the layout's renderMoves on every ply change. */
  update(currentPly: number, jump: (ply: number) => void): void;
  /** Apply/replace per-ply glyphs after analysis lands. Idempotent: plies absent
   *  from the map have any prior glyph cleared. */
  annotate(byPly: Map<number, MoveAnnotation>): void;
  /** Bind the branch buttons: `jumpLine(atPly, cursor)` asks for the position
   *  after `cursor` moves of the line hung off ply `atPly`. Unbound, the branch
   *  is text. */
  bindLine(jumpLine: (atPly: number, cursor: number) => void): void;
  /** Highlight a step of a line (or clear every branch highlight with null).
   *  Called instead of `update` while the board shows a sideline. */
  highlightLine(current: { atPly: number; cursor: number } | null): void;
};

export type MoveListOptions = {
  title?: string;
  /** Which side moves first — 'a' pairs (a,b) per row (chess/xiangqi: red/white
   *  first). Default 'a'. */
  firstMover?: 'a' | 'b';
  /** Move number printed on the first row. Default 1; a composition rooted
   *  mid-game passes the position's own number so "20... Bxe4" is not "1. Bxe4". */
  firstNumber?: number;
};

/** Bring `cell` into view inside its own scroll container, never by scrolling the
 *  page. `scrollIntoView` walks EVERY scrollable ancestor up to the document, so
 *  on col1 — where the move list has no scroller of its own and the page is the
 *  only thing that scrolls — highlighting the current ply dragged the whole page
 *  down and cropped the top of the board on load. If no inner scroller exists,
 *  do nothing: on a phone the move list is read by scrolling the page anyway. */
export function revealInScroller(cell: HTMLElement): void {
  for (let node = cell.parentElement; node && node !== document.body; node = node.parentElement) {
    if (!/(auto|scroll|overlay)/.test(getComputedStyle(node).overflowY)) continue;
    if (node.scrollHeight <= node.clientHeight + 1) continue;
    const box = node.getBoundingClientRect();
    const target = cell.getBoundingClientRect();
    if (target.top < box.top) node.scrollTop -= box.top - target.top;
    else if (target.bottom > box.bottom) node.scrollTop += target.bottom - box.bottom;
    return;
  }
}

export function createMoveList(entries: MoveListEntry[], opts: MoveListOptions = {}): MoveList {
  const panel = document.createElement('section');
  panel.className = 'review-move-list';
  if (opts.title) {
    const heading = document.createElement('h2');
    heading.className = 'review-move-list__title';
    heading.textContent = opts.title;
    panel.append(heading);
  }
  const list = document.createElement('ol');
  list.className = 'review-move-list__rows';
  panel.append(list);

  const cellsByPly = new Map<number, HTMLButtonElement>();
  const lineCells = new Map<string, HTMLButtonElement>();
  let onJump: ((ply: number) => void) | null = null;
  let onJumpLine: ((atPly: number, cursor: number) => void) | null = null;

  if (entries.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'review-move-list__empty';
    empty.textContent = 'No moves';
    list.append(empty);
  } else {
    // Pair entries two-per-row. `firstMover` sets which column the first ply lands
    // in so an odd leading ply (rare) still aligns under the right side.
    const leadOffset = opts.firstMover === 'b' ? 1 : 0;
    let row: HTMLLIElement | null = null;
    const startRow = (index: number): HTMLLIElement => {
      const li = document.createElement('li');
      li.className = 'review-move-list__row';
      const number = document.createElement('span');
      number.className = 'review-move-list__number';
      number.textContent = String(Math.floor((index + leadOffset) / 2) + (opts.firstNumber ?? 1));
      li.append(number);
      list.append(li);
      return li;
    };
    entries.forEach((entry, index) => {
      const slot = (index + leadOffset) % 2;
      if (slot === 0) {
        row = startRow(index);
      } else if (!row) {
        // A line that opens with the second mover: the row exists so the first
        // entry has somewhere to land, with an empty first-mover cell so it sits
        // in its own column. Without this the leading move was dropped.
        row = startRow(index);
        const gap = document.createElement('span');
        gap.className = 'review-move-list__move review-move-list__move--gap';
        gap.textContent = '…';
        row.append(gap);
      }
      row.append(moveCell(entry));
      // A note or a sideline closes the row: the branch sits under the move it
      // belongs to, and the other side's next move starts a fresh row (with the
      // gap cell, above) so the columns stay aligned.
      if (entry.note || entry.line) {
        list.append(branchRow(entry));
        row = null;
      }
    });
  }

  function branchRow(entry: MoveListEntry): HTMLLIElement {
    const li = document.createElement('li');
    li.className = 'review-move-list__branch';
    li.dataset.atPly = String(entry.ply);
    if (entry.note) {
      const note = document.createElement('p');
      note.className = 'review-move-list__note';
      note.textContent = entry.note;
      li.append(note);
    }
    if (entry.line) {
      const line = document.createElement('div');
      line.className = 'review-move-list__line';
      entry.line.moves.forEach((label, i) => {
        const cursor = i + 1;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'review-move-list__line-move';
        button.textContent = label;
        button.addEventListener('click', () => onJumpLine?.(entry.ply, cursor));
        lineCells.set(`${entry.ply}:${cursor}`, button);
        line.append(button);
      });
      if (entry.line.verdict) {
        const verdict = document.createElement('span');
        verdict.className = 'review-move-list__line-verdict';
        verdict.textContent = entry.line.verdict;
        line.append(verdict);
      }
      li.append(line);
      if (entry.line.note) {
        const note = document.createElement('p');
        note.className = 'review-move-list__note review-move-list__note--line';
        note.textContent = entry.line.note;
        li.append(note);
      }
    }
    return li;
  }

  function moveCell(entry: MoveListEntry): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'review-move-list__move';
    button.dataset.ply = String(entry.ply);
    // san holds the move text (+ any glyph); eval sits right-aligned (tree-view style).
    const san = document.createElement('span');
    san.className = 'review-move-list__san';
    san.textContent = entry.label;
    const evalEl = document.createElement('span');
    evalEl.className = 'review-move-list__eval';
    button.append(san, evalEl);
    if (entry.suffix) appendGlyph(san, entry.suffix, entry.suffixClass);
    button.addEventListener('click', () => onJump?.(entry.ply));
    cellsByPly.set(entry.ply, button);
    return button;
  }

  function appendGlyph(san: HTMLElement, suffix: string, suffixClass?: string): void {
    const glyph = document.createElement('span');
    glyph.className = 'review-move-list__suffix';
    if (suffixClass) glyph.classList.add(`review-move--${suffixClass}`);
    glyph.textContent = ` ${suffix}`;
    san.append(glyph);
  }

  function update(currentPly: number, jump: (ply: number) => void): void {
    onJump = jump;
    let current: HTMLButtonElement | undefined;
    for (const [ply, cell] of cellsByPly) {
      const isCurrent = ply === currentPly;
      cell.classList.toggle('review-move-list__move--current', isCurrent);
      if (isCurrent) current = cell;
    }
    if (current) revealInScroller(current);
  }

  function annotate(byPly: Map<number, MoveAnnotation>): void {
    for (const [ply, cell] of cellsByPly) {
      const san = cell.querySelector<HTMLElement>('.review-move-list__san');
      const evalEl = cell.querySelector<HTMLElement>('.review-move-list__eval');
      cell.querySelector('.review-move-list__suffix')?.remove();
      const ann = byPly.get(ply);
      if (ann?.suffix && san) appendGlyph(san, ann.suffix, ann.suffixClass);
      if (evalEl) evalEl.textContent = ann?.eval ?? '';
    }
  }

  function bindLine(jumpLine: (atPly: number, cursor: number) => void): void {
    onJumpLine = jumpLine;
  }

  function highlightLine(current: { atPly: number; cursor: number } | null): void {
    let cell: HTMLButtonElement | undefined;
    for (const [key, button] of lineCells) {
      const isCurrent = current !== null && key === `${current.atPly}:${current.cursor}`;
      button.classList.toggle('review-move-list__line-move--current', isCurrent);
      if (isCurrent) cell = button;
    }
    if (current) {
      for (const mainline of cellsByPly.values()) {
        mainline.classList.remove('review-move-list__move--current');
      }
    }
    if (cell) revealInScroller(cell);
  }

  return { el: panel, update, annotate, bindLine, highlightLine };
}
