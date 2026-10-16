// Desktop game-chat height control. The chat fills its rail automatically until
// a user drags the bottom separator, then keeps that preferred height across
// live and review pages. Viewport changes clamp the rendered height without
// discarding the preference, so growing the window restores the chosen size.

const STORAGE_KEY = 'mistboard-game-chat-height';
const MIN_HEIGHT = 180;
const KEYBOARD_STEP = 24;
// How far the ceiling probe grows the panel to see which ancestors follow it.
const PROBE_STEP = 32;

export function attachChatResize(panel: HTMLElement): HTMLElement {
  panel.classList.add('review-spectator-chat--resizable');

  const separator = document.createElement('div');
  separator.className = 'review-spectator-chat__resize';
  separator.tabIndex = 0;
  separator.setAttribute('role', 'separator');
  separator.setAttribute('aria-label', 'Resize chat');
  separator.setAttribute('aria-orientation', 'horizontal');
  separator.title = 'Drag to resize chat (double-click to reset)';
  const rule = document.createElement('span');
  rule.className = 'review-spectator-chat__resize-rule';
  rule.setAttribute('aria-hidden', 'true');
  separator.append(rule);
  panel.append(separator);

  let preferredHeight = readStoredHeight();
  let dragStartY = 0;
  let dragStartHeight = 0;

  // The ceiling is the room the panel could fill without overflowing a box
  // whose height does not depend on the panel. Usually that box is the parent:
  // what it has left over after the siblings. But a parent that content-sizes
  // around the panel (no height of its own) leaves exactly the panel's current
  // height over, and trusting it ratchets the handle shut: each shrink lowers
  // the ceiling to match and nothing can grow back (#298). That reading is
  // ambiguous with a panel that correctly flex-fills a definite parent, so in
  // that case the panel is grown for one synchronous probe: ancestors that grow
  // with it are content-sized, and the first one that holds still is the
  // budget, capped by the viewport.
  const maxHeight = (): number => {
    const viewportCeiling = Math.max(MIN_HEIGHT, window.innerHeight - 120);
    const parent = panel.parentElement;
    if (!parent) return viewportCeiling;
    if (boxHeight(parent) <= 0) return viewportCeiling;

    const available = leftoverFor(parent, panel);
    const panelHeight = boxHeight(panel);
    if (Math.abs(available - panelHeight) > 1) return Math.max(MIN_HEIGHT, available);

    const chain = sizingAncestors(panel);
    const before = chain.map(boxHeight);
    const after = withProbeHeight(panelHeight + PROBE_STEP, () => chain.map(boxHeight));
    const stableIndex = chain.findIndex(
      (_ancestor, index) => Math.abs((after[index] ?? 0) - (before[index] ?? 0)) < 1,
    );
    if (stableIndex === 0) return Math.max(MIN_HEIGHT, available);
    if (stableIndex < 0) return viewportCeiling;

    const stable = chain[stableIndex] as HTMLElement;
    const grower = chain[stableIndex - 1] as HTMLElement;
    const slack = leftoverFor(stable, grower) - (before[stableIndex - 1] ?? 0);
    return clamp(panelHeight + slack, MIN_HEIGHT, viewportCeiling);
  };

  // Renders the panel at `height` just long enough to measure, then restores
  // it. No frame runs in between, so nothing paints and no ResizeObserver sees it.
  const withProbeHeight = <T>(height: number, measure: () => T): T => {
    const hadManualClass = panel.classList.contains('review-spectator-chat--manual-height');
    const previous = panel.style.getPropertyValue('--review-chat-manual-height');
    panel.classList.add('review-spectator-chat--manual-height');
    panel.style.setProperty('--review-chat-manual-height', `${Math.round(height)}px`);
    try {
      return measure();
    } finally {
      if (!hadManualClass) panel.classList.remove('review-spectator-chat--manual-height');
      if (previous) panel.style.setProperty('--review-chat-manual-height', previous);
      else panel.style.removeProperty('--review-chat-manual-height');
    }
  };

  // A drag reads the ceiling once, at pointerdown: the probe forces layout, and
  // the box it measures does not change while the pointer moves.
  let dragCeiling: number | null = null;
  const ceiling = (): number => dragCeiling ?? maxHeight();

  const setAriaHeight = (height: number): void => {
    separator.setAttribute('aria-valuemin', String(MIN_HEIGHT));
    separator.setAttribute('aria-valuemax', String(Math.round(ceiling())));
    separator.setAttribute('aria-valuenow', String(Math.round(height)));
  };

  const renderPreferredHeight = (): void => {
    if (preferredHeight === null) {
      panel.classList.remove('review-spectator-chat--manual-height');
      panel.style.removeProperty('--review-chat-manual-height');
      setAriaHeight(panel.getBoundingClientRect().height);
      return;
    }
    const renderedHeight = clamp(preferredHeight, MIN_HEIGHT, ceiling());
    panel.classList.add('review-spectator-chat--manual-height');
    panel.style.setProperty('--review-chat-manual-height', `${Math.round(renderedHeight)}px`);
    setAriaHeight(renderedHeight);
  };

  const chooseHeight = (height: number, persist = true): void => {
    preferredHeight = Math.round(clamp(height, MIN_HEIGHT, ceiling()));
    if (persist) writeStoredHeight(preferredHeight);
    renderPreferredHeight();
  };

  const resetHeight = (): void => {
    preferredHeight = null;
    removeStoredHeight();
    renderPreferredHeight();
  };

  separator.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    dragStartY = event.clientY;
    dragStartHeight = panel.getBoundingClientRect().height;
    dragCeiling = maxHeight();
    separator.setPointerCapture(event.pointerId);
    separator.classList.add('is-dragging');
    document.documentElement.classList.add('chat-resizing');
  });
  separator.addEventListener('pointermove', (event) => {
    if (!separator.hasPointerCapture(event.pointerId)) return;
    chooseHeight(dragStartHeight + event.clientY - dragStartY, false);
  });
  const endDrag = (event: PointerEvent): void => {
    if (separator.hasPointerCapture(event.pointerId))
      separator.releasePointerCapture(event.pointerId);
    dragCeiling = null;
    if (preferredHeight !== null) writeStoredHeight(preferredHeight);
    separator.classList.remove('is-dragging');
    document.documentElement.classList.remove('chat-resizing');
  };
  separator.addEventListener('pointerup', endDrag);
  separator.addEventListener('pointercancel', endDrag);
  separator.addEventListener('dblclick', (event) => {
    event.preventDefault();
    resetHeight();
  });
  separator.addEventListener('keydown', (event) => {
    const current = panel.getBoundingClientRect().height || MIN_HEIGHT;
    if (event.key === 'ArrowUp') chooseHeight(current - KEYBOARD_STEP);
    else if (event.key === 'ArrowDown') chooseHeight(current + KEYBOARD_STEP);
    else if (event.key === 'Home') chooseHeight(MIN_HEIGHT);
    else if (event.key === 'End') chooseHeight(maxHeight());
    else if (event.key === 'Escape') resetHeight();
    else return;
    event.preventDefault();
  });

  const onViewportResize = (): void => {
    if (!panel.isConnected) {
      window.removeEventListener('resize', onViewportResize);
      return;
    }
    renderPreferredHeight();
  };
  window.addEventListener('resize', onViewportResize);

  // The rail's leftover space is not settled at mount: the board refits on a
  // timer (review-layout.ts), so the rail bottom moves long after the panel
  // first measured its parent. A preference clamped against that early
  // measurement stays too tall, and the rail clips its overflow — the composer
  // and this separator end up below the cut, leaving a feed nobody can type
  // into. The viewport listener above never fires for that, so watch the space
  // itself. The panel is capped at the parent's height in CSS, so re-rendering
  // here cannot grow the parent back and loop.
  if (typeof ResizeObserver !== 'undefined' && panel.parentElement) {
    const spaceObserver = new ResizeObserver(() => {
      if (!panel.isConnected) {
        spaceObserver.disconnect();
        return;
      }
      renderPreferredHeight();
    });
    spaceObserver.observe(panel.parentElement);
  }

  queueMicrotask(renderPreferredHeight);
  return separator;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function boxHeight(element: Element): number {
  return element.getBoundingClientRect().height;
}

// The height `child` could take inside `container`: the container's height
// less its other visible children and the gaps between them.
function leftoverFor(container: HTMLElement, child: HTMLElement): number {
  const others = Array.from(container.children).filter(
    (sibling): sibling is HTMLElement =>
      sibling instanceof HTMLElement && sibling !== child && boxHeight(sibling) > 0,
  );
  const occupied = others.reduce((total, sibling) => total + boxHeight(sibling), 0);
  const gap = Number.parseFloat(getComputedStyle(container).gap) || 0;
  return boxHeight(container) - occupied - gap * others.length;
}

// Ancestors from the parent up to (not including) <body>; past that the page
// itself scrolls, so the viewport is the only budget left.
function sizingAncestors(panel: HTMLElement): HTMLElement[] {
  const chain: HTMLElement[] = [];
  for (
    let node = panel.parentElement;
    node && node !== document.body && node !== document.documentElement;
    node = node.parentElement
  ) {
    chain.push(node);
  }
  return chain;
}

function readStoredHeight(): number | null {
  try {
    const value = Number.parseFloat(localStorage.getItem(STORAGE_KEY) ?? '');
    return Number.isFinite(value) && value >= MIN_HEIGHT ? value : null;
  } catch {
    return null;
  }
}

function writeStoredHeight(height: number): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(Math.round(height)));
  } catch {
    // Storage unavailable (private mode); the height still applies this session.
  }
}

function removeStoredHeight(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage unavailable; resetting the current page still succeeds.
  }
}

export const chatResizeStorageKey = STORAGE_KEY;
