// The hover / tap card behind a review mark, whatever the mark says: the luck die
// (luck-mark-card.ts) and the move-grade badge (grade-mark-card.ts) open the same card
// from the same two places, the board and the move list.
//
// The board's hit layer sits above the marker layers and owns every click (piece
// selection, drags), so the board card does not listen on the mark itself. It watches
// pointer positions on the board host and tests them against the mark the caller finds.
// That keeps the board's own input untouched: a tap on the marked piece still selects it,
// and also opens the card.

/** What the card shows: `key` names the content, so an unchanged card is not re-rendered. */
export type MarkCardContent = {
  key: string;
  html: string;
  tone: string;
};

/** The card element and its placement, shared by the board mark and the move-list badge. */
export function createMarkCard() {
  const card = document.createElement('div');
  card.className = 'luck-card';
  card.setAttribute('role', 'tooltip');
  card.hidden = true;
  document.body.append(card);
  let shownFor: string | null = null;

  /** Open the card with `content`, centred over `rect` (the piece, or the badge); below it
   *  when the top is tight. */
  function show(rect: DOMRect, content: MarkCardContent): void {
    if (shownFor !== content.key) {
      card.innerHTML = content.html;
      card.dataset.tone = content.tone;
      shownFor = content.key;
    }
    card.hidden = false;
    // Measure after unhiding, then place above the anchor; below when the top is tight.
    const cw = card.offsetWidth;
    const ch = card.offsetHeight;
    const gap = 10;
    const margin = 8;
    let left = rect.left + rect.width / 2 - cw / 2;
    left = Math.max(margin, Math.min(left, window.innerWidth - cw - margin));
    const above = rect.top - ch - gap;
    const below = rect.bottom + gap;
    const top = above >= margin ? above : below;
    card.dataset.side = above >= margin ? 'above' : 'below';
    card.style.left = `${Math.round(left)}px`;
    card.style.top = `${Math.round(top)}px`;
    card.classList.add('luck-card--open');
  }

  function hide(): void {
    card.classList.remove('luck-card--open');
    card.hidden = true;
  }

  return { el: card, show, hide };
}

/** A mark found on the board: where to anchor the card, whether a point is on the mark,
 *  and what the card says. */
export type BoardMarkHit = {
  rect: DOMRect;
  contains(x: number, y: number): boolean;
  content: MarkCardContent;
};

/**
 * Wire a card to a board host. `find` returns the mark drawn now (or null); the card opens
 * only while it is, so navigating away closes it without the caller having to. Mouse: hover
 * opens, moving off closes. Touch and pen: a tap on the mark pins the card open; any other
 * tap closes it. Returns a detach function.
 */
export function attachBoardMarkCard(
  boardHost: HTMLElement,
  find: () => BoardMarkHit | null,
): () => void {
  const card = createMarkCard();
  let pinned = false;

  function over(x: number, y: number): BoardMarkHit | null {
    const hit = find();
    return hit?.contains(x, y) ? hit : null;
  }

  function hide(): void {
    pinned = false;
    card.hide();
  }

  const onMove = (event: PointerEvent): void => {
    if (event.pointerType !== 'mouse' || pinned) return;
    const hit = over(event.clientX, event.clientY);
    if (hit) card.show(hit.rect, hit.content);
    else if (!card.el.hidden) hide();
  };
  const onLeave = (event: PointerEvent): void => {
    if (event.pointerType === 'mouse' && !pinned) hide();
  };
  const onDown = (event: PointerEvent): void => {
    if (event.pointerType === 'mouse') return;
    const hit = over(event.clientX, event.clientY);
    if (hit) {
      if (pinned) hide();
      else {
        card.show(hit.rect, hit.content);
        pinned = true;
      }
    } else hide();
  };
  const onDocDown = (event: PointerEvent): void => {
    if (!boardHost.contains(event.target as Node)) hide();
  };
  // Navigation re-renders the board: re-place the card over the new mark, or close it.
  const observer = new MutationObserver(() => {
    if (card.el.hidden) return;
    const hit = find();
    if (hit) card.show(hit.rect, hit.content);
    else hide();
  });
  boardHost.addEventListener('pointermove', onMove);
  boardHost.addEventListener('pointerleave', onLeave);
  boardHost.addEventListener('pointerdown', onDown);
  document.addEventListener('pointerdown', onDocDown, true);
  window.addEventListener('scroll', hide, true);
  window.addEventListener('resize', hide);
  observer.observe(boardHost, { childList: true, subtree: true });
  return () => {
    observer.disconnect();
    boardHost.removeEventListener('pointermove', onMove);
    boardHost.removeEventListener('pointerleave', onLeave);
    boardHost.removeEventListener('pointerdown', onDown);
    document.removeEventListener('pointerdown', onDocDown, true);
    window.removeEventListener('scroll', hide, true);
    window.removeEventListener('resize', hide);
    card.el.remove();
  };
}

/** How a move-list badge is found: `pathAttr` is the data attribute (dataset name) holding
 *  the path key of the move the badge labels. */
export type ListBadgeSpec = {
  /** Selector matching only badges that carry the path attribute. */
  selector: string;
  /** The dataset key of the path attribute (`luckPath` for `data-luck-path`). */
  pathAttr: string;
  content(badge: HTMLElement): MarkCardContent | null;
};

/**
 * Wire a card to the move list's badges. `spec.content` maps a badge to its move's card, so
 * any move's card opens, not only the current one's. Mouse: hover opens, leaving closes; the
 * click still lands on the move button and navigates. Touch and pen: a tap on a badge opens
 * the card pinned AND selects the move (the tap reaches the move button untouched, so the
 * list keeps one tap behaviour); a second tap on the same badge, or a tap anywhere else,
 * closes it. Returns a detach function.
 */
export function attachListBadgeCard(list: HTMLElement, spec: ListBadgeSpec): () => void {
  const card = createMarkCard();
  let anchor: HTMLElement | null = null;
  let pinned = false;

  const badgeAt = (target: EventTarget | null): HTMLElement | null =>
    target instanceof Element ? (target.closest(spec.selector) as HTMLElement | null) : null;

  function open(badge: HTMLElement): boolean {
    const content = spec.content(badge);
    if (!content) return false;
    anchor = badge;
    card.show(badge.getBoundingClientRect(), content);
    return true;
  }

  function hide(): void {
    pinned = false;
    anchor = null;
    card.hide();
  }

  const onOver = (event: PointerEvent): void => {
    if (event.pointerType !== 'mouse' || pinned) return;
    const badge = badgeAt(event.target);
    if (badge && badge !== anchor) open(badge);
  };
  const onOut = (event: PointerEvent): void => {
    if (event.pointerType !== 'mouse' || pinned || !anchor) return;
    if (!(event.relatedTarget instanceof Node && anchor.contains(event.relatedTarget))) hide();
  };
  const onDown = (event: PointerEvent): void => {
    if (event.pointerType === 'mouse') return;
    const badge = badgeAt(event.target);
    if (!badge) return;
    if (pinned && anchor === badge) hide();
    else if (open(badge)) pinned = true;
  };
  const onDocDown = (event: PointerEvent): void => {
    if (!anchor) return;
    const badge = badgeAt(event.target);
    if (!badge || !list.contains(badge)) hide();
  };
  // A rebuild (analysis landing, a relabel) replaces the badges: follow the open card to the
  // badge for the same move, or close it.
  const observer = new MutationObserver(() => {
    if (!anchor || anchor.isConnected) return;
    const path = anchor.dataset[spec.pathAttr] ?? '';
    const next = Array.from(list.querySelectorAll<HTMLElement>(spec.selector)).find(
      (badge) => badge.dataset[spec.pathAttr] === path,
    );
    const keepPinned = pinned;
    if (next && open(next)) pinned = keepPinned;
    else hide();
  });
  list.addEventListener('pointerover', onOver);
  list.addEventListener('pointerout', onOut);
  list.addEventListener('pointerdown', onDown);
  document.addEventListener('pointerdown', onDocDown, true);
  window.addEventListener('scroll', hide, true);
  window.addEventListener('resize', hide);
  observer.observe(list, { childList: true, subtree: true });
  return () => {
    observer.disconnect();
    list.removeEventListener('pointerover', onOver);
    list.removeEventListener('pointerout', onOut);
    list.removeEventListener('pointerdown', onDown);
    document.removeEventListener('pointerdown', onDocDown, true);
    window.removeEventListener('scroll', hide, true);
    window.removeEventListener('resize', hide);
    card.el.remove();
  };
}
