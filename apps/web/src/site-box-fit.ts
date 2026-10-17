// Fit a site-box body's rows to the body's height. For homepage widgets whose
// box height comes from the band they sit in (the forum box is the daily
// puzzle's height; Top studies spans the blog + video rows) rather than from
// their content: the row count is measured, not configured. Callers fetch more
// rows than the box can show and let fitRows() drop the ones that would clip.

/** Slack per row that the rows absorb by growing when every row fits; past
 *  this the box is content-starved and keeps its slack instead of puffing each
 *  row up. A trimmed box always spreads its slack (see fitRows). */
export const fillSlackPerRow = 28;

/**
 * Whole rows only: a row cut mid-item reads as broken. Trimming leaves up to
 * one row of slack under the last row. When rows were trimmed the box has more
 * to show than room, so that slack is always spread: `fillClass` goes on the
 * body and the widget's CSS lets the rows grow to share it, so the last row
 * lands on the box's bottom edge. Rows vary in height (a one- or two-line
 * excerpt), so the leftover can be most of a tall row: 86px under three forum
 * topics at 1000px wide, 80px under two on a phone (#574). When every row fits,
 * the slack is spread only while it is small (at most fillSlackPerRow per
 * row); a content-starved box (two topics in a board-height box) keeps it.
 * The body's height is fixed by its box (flex child of a fixed-height box), so
 * neither trimming nor growth changes it. Rows a stylesheet hides (display:
 * none, e.g. a row cap on a layout whose box sizes to its content) take no
 * room and are not measured. Unlaid-out documents (tests, prerender) report
 * clientHeight 0 and keep every row.
 */
export function fitRows(body: HTMLElement, rows: HTMLElement[], fillClass: string): void {
  body.classList.remove(fillClass);
  body.replaceChildren(...rows);
  const available = body.clientHeight;
  if (available <= 0) return;
  const top = body.getBoundingClientRect().top;
  const shown = rows.filter((row) => row.getClientRects().length > 0);
  if (shown.length === 0) return;
  const bottomOf = (row: HTMLElement): number => row.getBoundingClientRect().bottom - top;
  let kept = shown.length;
  while (kept > 1 && bottomOf(shown[kept - 1] as HTMLElement) > available + 0.5) {
    shown[kept - 1]?.remove();
    kept -= 1;
  }
  const slack = available - bottomOf(shown[kept - 1] as HTMLElement);
  const trimmed = kept < shown.length;
  body.classList.toggle(fillClass, slack > 0.5 && (trimmed || slack <= kept * fillSlackPerRow));
}

/** fitRows() now, and again whenever the body's height changes (the band
 *  re-laying out, a resize crossing the stacked breakpoint). Trimmed rows come
 *  back when the body grows: `rows` keeps every row, fitted or not. */
export function fitRowsToBody(body: HTMLElement, rows: HTMLElement[], fillClass: string): void {
  fitRows(body, rows, fillClass);
  if (typeof ResizeObserver === 'undefined') return;
  let fittedHeight = body.clientHeight;
  new ResizeObserver(() => {
    if (body.clientHeight === fittedHeight) return;
    fittedHeight = body.clientHeight;
    fitRows(body, rows, fillClass);
  }).observe(body);
}
