// Viewer preference: is the opening explorer (and the tablebase panel it
// carries) open on review surfaces?
//
// CLOSED by default (#534, reversing #523's open-by-default). The book is a
// second pane most readers did not ask for, and while it is open it fetches on
// every position. A reader who opens it once keeps it open: the choice is
// remembered across pages and visits, and every surface that draws the review
// bar (analysis board, game review, study, broadcast) reads this one key.
//
// Absent storage reads as CLOSED, deliberately: a preference whose default is
// off must treat "no value" and "false" identically, or the first visit silently
// gets the opposite of the documented default.

const STORAGE_KEY = 'mistboard:review:explorer';

/** True only when the reader last left the book open. Storage can be
 *  unavailable (private windows, blocked site data), so every access is guarded
 *  and falls back to closed rather than throwing during a mount. */
export function explorerOpenPreferred(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function setExplorerOpenPreferred(open: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, open ? 'true' : 'false');
  } catch {
    // A reader who cannot persist the choice still gets it for this page view;
    // the in-memory flag in the review bar is what drives the pane.
  }
}
