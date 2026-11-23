// First paint of the phone bar's pieces button (site-shell.ts
// buildNavQuickControls). The button previews the reader's own xiangqi set, but
// a prerendered page bakes the set the build resolved for that page's locale.
// Until main.ts runs, a reader whose set differs saw the baked icon and then a
// visible swap to their own.
//
// This is the source of the inline script in index.html's <head>, beside the
// theme script; piece-set-first-paint.test.ts fails if the two drift apart
// (compared with whitespace collapsed) and runs this exact text against the real
// inference to prove the predicate below never misses a reader whose set
// differs from the bake.
//
// The predicate is deliberately not the inference rule
// (inferredXiangqiPieceSet): only "could this reader's set differ from what the
// build baked?". True when anything the inference reads beyond the page's own
// URL is present: a stored pick, a remembered first or chosen locale, a Chinese
// or Cantonese browser language, the mb_cc country cookie, or a ?xqPieces=
// preview. Over-hiding costs a blank slot until main.ts runs; showing a wrong
// icon is the bug. While the marker is set, site-shell.css hides the baked
// preview with visibility (its box stays, so nothing reflows), and
// syncNavQuickPieces() in main.ts redraws every button and drops the marker.
//
// If the app never starts (its module fails to load or throws before the sync),
// a script or window error drops the marker so the baked icon shows rather than
// a blank slot for good. Without JavaScript the marker is never set.
export const PIECE_SET_PENDING_ATTRIBUTE = 'data-piece-set-pending';

export const PIECE_SET_FIRST_PAINT_SCRIPT = `(() => {
  const root = document.documentElement;
  let mayDiffer = false;
  try {
    const storage = window.localStorage;
    mayDiffer = ["mistboard.xiangqiPieceSet", "mistboard.firstLocale", "mistboard.locale"].some(
      (key) => storage.getItem(key) !== null,
    );
  } catch {
    mayDiffer = true;
  }
  try {
    const languages = navigator.languages?.length ? navigator.languages : [navigator.language];
    if (languages.some((tag) => /^(zh|yue)/i.test(tag ?? ""))) mayDiffer = true;
    if (/(^|;)\\s*mb_cc=/.test(document.cookie)) mayDiffer = true;
    if (/[?&]xqPieces=/.test(window.location.search)) mayDiffer = true;
  } catch {
    mayDiffer = true;
  }
  if (!mayDiffer) return;
  root.setAttribute("data-piece-set-pending", "");
  window.addEventListener(
    "error",
    (event) => {
      if (event.target === window || event.target instanceof HTMLScriptElement) {
        root.removeAttribute("data-piece-set-pending");
      }
    },
    true,
  );
})();`;
