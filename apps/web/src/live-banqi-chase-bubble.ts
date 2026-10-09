// The 長捉 notice as a bubble ON the board, pointing at the red cross the player
// just pressed. It lives in the board stage's overlay space (absolutely
// positioned, pointer-events none), so showing it moves nothing else on the page
// and never blocks a tap; the side column it used to sit in grew by a card.
//
// Anchored to the RENDERED square ([data-square] hit cell), never to raw board
// coordinates, so it follows whatever orientation and size the board is drawn
// at. It sits on the side of the square AWAY from the selected piece, so it
// never covers the piece being moved: piece above the cross, bubble below;
// piece below, bubble above; piece beside it on the row, above unless there is
// no room inside the board. Clamped horizontally so it never crosses the
// board's left or right edge on a narrow phone.

import './live-banqi-chase-bubble.css';

// How long a board notice stays up: long enough to read at a slow pace, scaled
// by length so a long English line outlasts a short Chinese one, never under 6s.
// Counted in code points so CJK characters count once each.
export function noticeReadMs(text: string): number {
  return Math.max(6000, 1500 + [...text].length * 60);
}

export type Box = { left: number; top: number; width: number; height: number };

// Breathing room between the bubble and the board edge, and between the bubble
// and the square it points at.
const EDGE_PAD = 6;
const GAP = 6;

export type ChaseBubblePlacement = {
  left: number;
  top: number;
  below: boolean;
  // The caret's x inside the bubble, so it still points at the square when the
  // bubble is clamped toward an edge.
  caretX: number;
};

// Pure geometry, in one coordinate space (the stage's). `piece` is the selected
// piece's cell, when known. Exported for tests.
export function placeChaseBubble(
  anchor: Box,
  board: Box,
  bubble: { width: number; height: number },
  piece?: Box | null,
): ChaseBubblePlacement {
  const anchorX = anchor.left + anchor.width / 2;
  const minLeft = board.left + EDGE_PAD;
  const maxLeft = Math.max(minLeft, board.left + board.width - EDGE_PAD - bubble.width);
  const left = Math.min(maxLeft, Math.max(minLeft, anchorX - bubble.width / 2));
  const roomAbove = anchor.top - board.top - GAP;
  const roomBelow = board.top + board.height - (anchor.top + anchor.height) - GAP;
  const pieceY = piece ? piece.top + piece.height / 2 : null;
  // The opposite side from the piece wins outright, even if it overhangs the
  // board edge: covering the piece being moved is the one thing it must not do.
  const below =
    pieceY !== null && pieceY < anchor.top
      ? true
      : pieceY !== null && pieceY > anchor.top + anchor.height
        ? false
        : roomAbove < bubble.height && roomBelow > roomAbove;
  const top = below ? anchor.top + anchor.height + GAP : anchor.top - GAP - bubble.height;
  const caretInset = 12;
  const caretX = Math.min(bubble.width - caretInset, Math.max(caretInset, anchorX - left));
  return { left, top, below, caretX };
}

export type BanqiChaseBubble = {
  /** Show (or move) the bubble at `square`, on the side away from `from`. */
  show(square: string, from: string | null, text: string): void;
  /** Re-anchor after a board render; removes it if its square is gone. */
  sync(): void;
  clear(): void;
};

export function createBanqiChaseBubble(board: HTMLElement): BanqiChaseBubble {
  let el: HTMLElement | null = null;
  let square: string | null = null;
  let from: string | null = null;
  const stage = (): HTMLElement => board.closest<HTMLElement>('.board-stage') ?? board;
  const resize =
    typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => position());

  function position(): void {
    if (!el || !square) return;
    const host = el.parentElement;
    const cell =
      board.querySelector(`[data-square="${square}"] rect`) ??
      board.querySelector(`[data-square="${square}"]`);
    const surface = board.querySelector('svg') ?? board;
    if (!host || !cell) return;
    const hostRect = host.getBoundingClientRect();
    const cellRect = cell.getBoundingClientRect();
    const boardRect = surface.getBoundingClientRect();
    // Not laid out (jsdom, a hidden tab): leave it where CSS puts it.
    if (cellRect.width === 0 || boardRect.width === 0) return;
    const rel = (r: DOMRect): Box => ({
      left: r.left - hostRect.left,
      top: r.top - hostRect.top,
      width: r.width,
      height: r.height,
    });
    // Cap the width to the board first (the CSS takes the smaller of this and its
    // own reading-width cap), so the measured height is the wrapped one.
    el.style.setProperty(
      '--banqi-chase-board-max',
      `${Math.max(0, boardRect.width - EDGE_PAD * 2)}px`,
    );
    const fromCell = from
      ? (board.querySelector(`[data-square="${from}"] rect`) ??
        board.querySelector(`[data-square="${from}"]`))
      : null;
    const placed = placeChaseBubble(
      rel(cellRect),
      rel(boardRect),
      { width: el.offsetWidth, height: el.offsetHeight },
      fromCell ? rel(fromCell.getBoundingClientRect()) : null,
    );
    el.style.left = `${placed.left}px`;
    el.style.top = `${placed.top}px`;
    el.style.setProperty('--banqi-chase-caret-x', `${placed.caretX}px`);
    el.classList.toggle('banqi-chase-bubble--below', placed.below);
  }

  function clear(): void {
    if (el) resize?.unobserve(stage());
    el?.remove();
    el = null;
    square = null;
    from = null;
  }

  return {
    show(next, nextFrom, text) {
      if (!el) {
        el = document.createElement('div');
        el.className = 'banqi-chase-bubble';
        el.dataset.banqiChaseNotice = '';
        el.setAttribute('role', 'status');
        el.setAttribute('aria-live', 'polite');
        stage().append(el);
        resize?.observe(stage());
      }
      square = next;
      from = nextFrom;
      el.textContent = text;
      position();
    },
    sync() {
      if (!el || !square) return;
      // A board re-render can drop the cross (selection cleared elsewhere).
      if (!board.querySelector(`[data-square="${square}"][data-forbidden-move]`)) {
        clear();
        return;
      }
      if (!el.isConnected) stage().append(el);
      position();
    },
    clear,
  };
}
