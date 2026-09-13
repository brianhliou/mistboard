// Shared drag-to-move for the self-rendered SVG variant boards.
//
// Extracted from the first SVG tenant client (the first SVG drag implementation)
// so every tenant gets the same lichess-style feel: pick a piece up, drag it, drop
// it on the target. CLICK-TO-MOVE IS PRESERVED — a pointerdown that never crosses
// the movement threshold falls through to the click handler, and a completed drag
// swallows the trailing click so it does not double-fire.
//
// Listeners are delegated to the persistent board container (not the per-square
// hit rects), so they are attached ONCE at mount and survive every board
// re-render. The caller supplies the per-variant policy (which squares are
// draggable, the ghost markup, what a drop does); the mechanics live here.

export interface BoardDragHandlers {
  // The persistent container that holds the `[data-square]` hit elements. Its
  // inner SVG is replaced on every render, but the container itself stays.
  board: HTMLElement;
  // Size of the floating ghost piece. A NUMBER is read as the board SVG's own
  // viewBox units and scaled to the rendered board (a phone renders the same
  // viewBox much smaller, and an unscaled ghost is visibly bigger than the piece
  // it was lifted from). A FUNCTION returns CSS pixels and is used as given.
  ghostSizePx: number | (() => number);
  // A click (tap) on `square` — the existing click-to-move handler.
  onSquareClick: (square: string) => void;
  // Whether a drag may begin from `square` (an own, movable piece on your turn).
  canDragFrom: (square: string) => boolean;
  // Inner markup (SVG) for the ghost piece lifted from `square`, or null.
  ghostHtml: (square: string) => string | null;
  // A drag crossed the threshold and began at `from`: the caller should select it
  // and lift its piece off the origin (render with that square emptied) so only
  // the ghost shows.
  onDragStart: (from: string) => void;
  // A drag ended over `to` (null if dropped off-board or back on `from`). The
  // caller attempts the move (legality / promotion / send), clears the drag-origin
  // state, and re-renders.
  onDrop: (from: string, to: string | null) => void;
}

const MOVE_THRESHOLD_PX = 4;

// Rendered CSS pixels per board-SVG viewBox unit. 1 when the board has not been
// laid out yet (jsdom, pre-paint) so the caller's constant is used unscaled.
function boardSvgScale(board: HTMLElement): number {
  const svg = board.querySelector('svg');
  if (!svg) return 1;
  const units = svg.viewBox?.baseVal?.width ?? 0;
  const rendered = svg.getBoundingClientRect().width;
  return units > 0 && rendered > 0 ? rendered / units : 1;
}

function ghostSizePx(handlers: BoardDragHandlers): number {
  const size = handlers.ghostSizePx;
  if (typeof size === 'function') return size(); // already CSS pixels
  return size * boardSvgScale(handlers.board);
}

function squareOf(target: EventTarget | null): string | null {
  const el = (target as Element | null)?.closest('[data-square]') as HTMLElement | null;
  return el?.dataset.square ?? null;
}

function squareUnderPoint(x: number, y: number): string | null {
  const el = document.elementFromPoint(x, y)?.closest('[data-square]') as HTMLElement | null;
  return el?.dataset.square ?? null;
}

export function installBoardDrag(handlers: BoardDragHandlers): void {
  let suppressNextClick = false;

  // Touch drags belong to us, not to the page scroller. Without this the browser
  // claims any vertical-ish touch on the board as a page scroll and answers with
  // pointercancel, so drag-to-move never completes on a phone. preventDefault()
  // on pointerdown cannot do this; touch-action is the only lever. Cost: a swipe
  // that STARTS on the board no longer scrolls the page (lichess makes the same
  // trade on cg-board) — the panels below the board still scroll normally.
  handlers.board.style.touchAction = 'none';

  handlers.board.addEventListener('click', (event) => {
    if (suppressNextClick) {
      suppressNextClick = false;
      return; // trailing click from a completed drag — already handled
    }
    const square = squareOf(event.target);
    if (square) handlers.onSquareClick(square);
  });

  handlers.board.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    const from = squareOf(event.target);
    if (!from || !handlers.canDragFrom(from)) return;

    // Stop the browser from beginning a native text-selection gesture when the
    // pointer later leaves the board. Pointer events still produce the trailing
    // click for a sub-threshold tap, preserving click-to-move.
    event.preventDefault();

    const startX = event.clientX;
    const startY = event.clientY;
    let dragging = false;
    // Ghost state is per-drag, never per-install: one shared reference lets a
    // second drag overwrite the first and strand its node in <body> forever.
    let ghost: HTMLDivElement | null = null;

    const removeGhost = (): void => {
      ghost?.remove();
      ghost = null;
    };
    const positionGhost = (x: number, y: number): void => {
      if (!ghost) return;
      const size = ghostSizePx(handlers);
      ghost.style.left = `${x - size / 2}px`;
      ghost.style.top = `${y - size / 2}px`;
    };
    const detach = (): void => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onCancel);
    };
    const swallowTrailingClick = (): void => {
      suppressNextClick = true;
      setTimeout(() => {
        suppressNextClick = false;
      }, 0);
    };

    const onMove = (move: PointerEvent): void => {
      if (!dragging) {
        if (
          Math.abs(move.clientX - startX) + Math.abs(move.clientY - startY) <=
          MOVE_THRESHOLD_PX
        ) {
          return; // still within tap tolerance — leave it to the click handler
        }
        dragging = true;
        handlers.onDragStart(from);
        const html = handlers.ghostHtml(from);
        if (html) {
          const size = ghostSizePx(handlers);
          ghost = document.createElement('div');
          ghost.className = 'board-drag-ghost';
          ghost.style.width = `${size}px`;
          ghost.style.height = `${size}px`;
          ghost.innerHTML = html;
          document.body.append(ghost);
        }
      }
      move.preventDefault();
      positionGhost(move.clientX, move.clientY);
    };

    const onUp = (up: PointerEvent): void => {
      detach();
      if (!dragging) return; // a tap — let the click handler run click-to-move
      removeGhost();
      swallowTrailingClick();
      const to = squareUnderPoint(up.clientX, up.clientY);
      handlers.onDrop(from, to && to !== from ? to : null);
    };

    // The browser took the gesture (system edge swipe, a second finger, the page
    // scroller). No pointerup follows, so this is the ONLY place the ghost and
    // the lifted-piece state get cleaned up on that path. Without it the ghost
    // stays welded to the viewport (it is position: fixed) for the rest of the
    // session, one per interrupted drag.
    const onCancel = (): void => {
      detach();
      if (!dragging) return;
      removeGhost();
      swallowTrailingClick();
      handlers.onDrop(from, null); // put the lifted piece back
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onCancel);
  });
}

export interface BoardDrawHandlers {
  // Same persistent `[data-square]` container as installBoardDrag.
  board: HTMLElement;
  // A right-button gesture completed: `orig` is the square pressed; `dest` is the
  // square released over (null off-board, or equal to `orig` for a tap). `alt` =
  // a modifier was held (Shift/Ctrl/Meta/Alt) selecting the secondary brush. The
  // caller decides shape kind (dest==orig|null → circle at orig; else arrow) and
  // toggles it on the current node. The context menu is suppressed while enabled.
  onDraw: (orig: string, dest: string | null, opts: { alt: boolean }) => void;
  // Outer gate; default always on. Drawing is an annotation affordance, so review
  // surfaces enable it always; a live board can leave it off.
  enabled?: () => boolean;
}

// Right-button draw for the self-rendered SVG boards — the shape-annotation
// counterpart to installBoardDrag. Left button is untouched (installBoardDrag owns
// it); this listens only to button 2, so click-to-move and draw never collide.
export function installBoardDraw(handlers: BoardDrawHandlers): void {
  const gate = (): boolean => handlers.enabled?.() ?? true;

  handlers.board.addEventListener('contextmenu', (event) => {
    if (gate()) event.preventDefault();
  });

  handlers.board.addEventListener('pointerdown', (event) => {
    if (event.button !== 2 || !gate()) return;
    const orig = squareOf(event.target);
    if (!orig) return;
    const alt = event.shiftKey || event.ctrlKey || event.metaKey || event.altKey;
    event.preventDefault();
    const onUp = (up: PointerEvent): void => {
      document.removeEventListener('pointerup', onUp);
      handlers.onDraw(orig, squareUnderPoint(up.clientX, up.clientY), { alt });
    };
    document.addEventListener('pointerup', onUp);
  });
}
