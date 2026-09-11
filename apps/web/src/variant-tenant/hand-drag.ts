// Shared pointer drag for reserve/hand pieces. It complements board-drag.ts:
// the drag begins in a hand strip, then resolves against the board's
// `[data-square]` hit zones.

export interface HandDragHandlers<R extends string> {
  hand: HTMLElement;
  ghostSizePx: number | (() => number);
  canDragRole: (role: R) => boolean;
  ghostHtml: (role: R) => string | null;
  isRole: (value: string) => value is R;
  onDragStart: (role: R) => void;
  onDrop: (role: R, to: string | null) => void;
}

const MOVE_THRESHOLD_PX = 4;

function ghostSizePx<R extends string>(handlers: HandDragHandlers<R>): number {
  const size = handlers.ghostSizePx;
  return typeof size === 'function' ? size() : size;
}

function roleOf<R extends string>(
  target: EventTarget | null,
  handlers: HandDragHandlers<R>,
): R | null {
  const el = (target as Element | null)?.closest('[data-drop]') as HTMLElement | null;
  const role = el?.dataset.drop ?? '';
  return handlers.isRole(role) ? role : null;
}

function squareUnderPoint(x: number, y: number): string | null {
  const el = document.elementFromPoint(x, y)?.closest('[data-square]') as HTMLElement | null;
  return el?.dataset.square ?? null;
}

export function installHandDrag<R extends string>(handlers: HandDragHandlers<R>): void {
  let suppressNextClick = false;

  // Same reason as board-drag.ts: a touch drag off the hand strip is ours, not
  // the page scroller's. Without this the browser claims it and answers with
  // pointercancel instead of pointerup.
  handlers.hand.style.touchAction = 'none';

  handlers.hand.addEventListener(
    'click',
    (event) => {
      if (!suppressNextClick) return;
      suppressNextClick = false;
      event.preventDefault();
      event.stopImmediatePropagation();
    },
    { capture: true },
  );

  handlers.hand.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    const role = roleOf(event.target, handlers);
    if (!role || !handlers.canDragRole(role)) return;

    const startX = event.clientX;
    const startY = event.clientY;
    let dragging = false;
    // Per-drag, not per-install — a shared reference strands the previous ghost.
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
          return;
        }
        dragging = true;
        handlers.onDragStart(role);
        const html = handlers.ghostHtml(role);
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
      if (!dragging) return;
      removeGhost();
      swallowTrailingClick();
      handlers.onDrop(role, squareUnderPoint(up.clientX, up.clientY));
    };

    // The browser took the gesture: no pointerup follows, so this is the only
    // path that removes the ghost and puts the lifted reserve piece back.
    const onCancel = (): void => {
      detach();
      if (!dragging) return;
      removeGhost();
      swallowTrailingClick();
      handlers.onDrop(role, null);
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onCancel);
  });
}
