// Phone game review (600px and under, #619): the whole-game analysis sits on
// the page, between the board's bottom player row and the arrow bar, instead
// of in a sheet. Before analysis it is the request control ("Request computer
// analysis", or the sign-in link), which shows its own progress while it runs;
// once analysis lands it is the advantage chart, squeezed to a strip, with the
// current move's eval at its left edge. Tap or drag the strip to jump.
//
// The slot does not build either piece. The review hands it the same element
// the underboard's Computer analysis tab would hold, and the slot decides where
// it lives: in the strip on a phone, in the tab above 600px. One element, two
// homes, so the chart keeps its cursor, marks and luck band through a rotate
// and nothing is drawn twice. Above 600px the strip is display: none
// (review-phone-analysis.css), so tablet and desktop see the tab as before.

import './review-phone-analysis.css';

/** The phone breakpoint review-phone-analysis.css switches on. */
const PHONE_QUERY = '(max-width: 600px)';

export type PhoneAnalysisContent = { kind: 'request' | 'chart'; el: HTMLElement } | null;

export type PhoneAnalysisSlot = {
  el: HTMLElement;
  /** What the analysis slot holds now: the request control, the chart, or
   *  nothing (a game with no moves). */
  setContent(content: PhoneAnalysisContent): void;
  /** The current move's eval beside the chart; null clears it (a move off the
   *  main line, or no analysis yet). */
  setEval(text: string | null): void;
};

export function createPhoneAnalysisSlot(opts: {
  signal: AbortSignal;
  /** The Computer analysis tab's body: the content's home above 600px. */
  wideHost: HTMLElement;
  /** A drag across the chart strip, as a fraction of its width (0 = first
   *  ply, 1 = last). A tap is the chart's own click-to-jump. */
  onScrub(fraction: number): void;
  /** The content moved or changed size; the board re-fits to what is left. */
  onLayout(): void;
  /** For tests: the phone media query. Defaults to the window's. */
  media?: MediaQueryList | null;
}): PhoneAnalysisSlot {
  const el = document.createElement('div');
  el.className = 'review-phone-analysis';
  el.hidden = true;
  const evalChip = document.createElement('span');
  evalChip.className = 'review-phone-analysis__eval';
  evalChip.hidden = true;
  const body = document.createElement('div');
  body.className = 'review-phone-analysis__body';
  el.append(evalChip, body);

  const media =
    opts.media !== undefined
      ? opts.media
      : typeof window.matchMedia === 'function'
        ? window.matchMedia(PHONE_QUERY)
        : null;
  const isPhone = (): boolean => Boolean(media?.matches);
  let content: PhoneAnalysisContent = null;

  function place(): void {
    const phone = isPhone();
    const wasShown = !el.hidden;
    if (content) (phone ? body : opts.wideHost).replaceChildren(content.el);
    else opts.wideHost.replaceChildren();
    if (!phone || !content) body.replaceChildren();
    el.hidden = !(phone && content);
    el.dataset.kind = content?.kind ?? '';
    // Re-fit only when the strip is or was on the page. Above 600px the content
    // lands in the tab as it always did, with no extra re-fit: one there moved
    // the move list's scroll after the chart landed (desktop must not change).
    if (phone || wasShown) opts.onLayout();
  }

  media?.addEventListener('change', () => place(), { signal: opts.signal });

  // Drag to scrub (touch and pen): the chart's own scrub answers a hover and a
  // click, and a finger has no hover, so a drag across the strip walks the
  // board through the game the way a mouse sweep walks the readout.
  let dragging: number | null = null;
  const fractionAt = (clientX: number): number | null => {
    const svg = body.querySelector('.advantage-chart__svg');
    const box = svg?.getBoundingClientRect();
    if (!box || box.width === 0) return null;
    return Math.max(0, Math.min(1, (clientX - box.left) / box.width));
  };
  body.addEventListener(
    'pointerdown',
    (event) => {
      if (content?.kind !== 'chart' || event.pointerType === 'mouse') return;
      dragging = event.pointerId;
      body.setPointerCapture?.(event.pointerId);
    },
    { signal: opts.signal },
  );
  body.addEventListener(
    'pointermove',
    (event) => {
      if (dragging !== event.pointerId) return;
      const fraction = fractionAt(event.clientX);
      if (fraction !== null) opts.onScrub(fraction);
    },
    { signal: opts.signal },
  );
  const endDrag = (event: PointerEvent): void => {
    if (dragging === event.pointerId) dragging = null;
  };
  body.addEventListener('pointerup', endDrag, { signal: opts.signal });
  body.addEventListener('pointercancel', endDrag, { signal: opts.signal });

  return {
    el,
    setContent(next) {
      content = next;
      place();
    },
    setEval(text) {
      evalChip.textContent = text ?? '';
      evalChip.hidden = text === null;
    },
  };
}
