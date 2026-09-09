// The two URLs a review board hands a position off to. Both carry the position
// as `?fen=`, but they carry DIFFERENT spellings of it on purpose:
//
//   /analysis/<variant>?fen=  takes the variant's CANONICAL start fen. For a
//     hidden-deal variant that is the six-field DEALT fen (dealt-fen.ts), so the
//     analysis board continues the exact reveals of the game it came from, and
//     the URL reloads to the same deal.
//   /editor/<variant>?fen=    takes the PUBLIC engine fen. The editor edits what
//     is visible; a hidden identity never rides an editor link.
//
// Kept apart from the review controller so the analysis catalog stays the only
// place that knows the route slugs, and so the postgame/analysis callers build
// the same URL shape without restating it.

import type { AnalysisVariantId } from '../analysis-catalog.js';
import type { EditorVariantId } from '../editor/editor-catalog.js';

export function analysisHref(variant: AnalysisVariantId, fen: string): string {
  return `/analysis/${variant}?fen=${encodeURIComponent(fen)}`;
}

/** EditorVariantId, not AnalysisVariantId: the editor covers a subset of the
 *  catalog, so a review board for a variant with no editor cannot build a
 *  "Board editor" link that would 404 (it omits `boardEditorHref` instead). */
export function editorHref(variant: EditorVariantId, fen: string): string {
  return `/editor/${variant}?fen=${encodeURIComponent(fen)}`;
}
