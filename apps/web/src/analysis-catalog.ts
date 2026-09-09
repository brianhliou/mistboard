// The /analysis/<variant> catalog: which variants have a standalone analysis
// board, in dropdown order. A variant qualifies only when its tree-review stack
// exists (a VariantTreeAdapter + TreePresentation in review/) — the catalog is
// the fail-closed allowlist for the route, so an unknown or unlisted slug 404s
// instead of falling back to another variant's board.
//
// This module is imported by main.ts route matching: keep it tiny (types + the
// list + the path parser; no review/board imports).

import { type GameSpecId, gameSpecForId } from '@mistboard/game';

/** Variants with a standalone analysis board. Slugs double as GameSpecIds. */
export type AnalysisVariantId =
  | 'xiangqi'
  | 'banqi'
  | 'jungle'
  | 'jungle-flip'
  | 'fortress-xiangqi'
  | 'jieqi'
  | 'dark-xiangqi'
  | 'dark-chess';

export type AnalysisVariant = {
  id: AnalysisVariantId;
  /** Site display name (the spec's publicName, e.g. "Banqi"). */
  label: string;
};

function entry(id: AnalysisVariantId): AnalysisVariant {
  const publicName = gameSpecForId(id satisfies GameSpecId).publicName;
  // The compact site brand is "Fortress", but the analysis dropdown benefits
  // from naming the game family explicitly beside standard Xiangqi.
  return { id, label: id === 'fortress-xiangqi' ? 'Fortress Xiangqi' : publicName };
}

/** Dropdown order follows CANONICAL_VARIANT_ORDER (game-specs.ts). */
export const ANALYSIS_VARIANTS: readonly AnalysisVariant[] = [
  entry('xiangqi'),
  entry('banqi'),
  entry('jieqi'),
  entry('fortress-xiangqi'),
  entry('dark-xiangqi'),
  entry('dark-chess'),
  entry('jungle'),
  entry('jungle-flip'),
];

// NOT HERE YET: duck-xiangqi. Its tree-review stack exists
// (review/duck-xiangqi-review.ts) and mounts through this page's dispatch
// unchanged, but AnalysisVariantId is also the key of two OTHER exhaustive maps
// — analysis-page.ts's mount table and, load-bearingly, editor/editor-specs.ts's
// EDITOR_SPECS. Listing a variant here therefore asserts it has a BOARD EDITOR,
// and the editor's model has no way to hold the duck: the duck is not in the
// placement (it rides the seventh FEN field) and it belongs to neither colour,
// so every EditorSpec hook would hand back a position with the duck dropped.
// Adding the row before that is settled would ship a surface that silently loses
// half the position. Splitting an EditorVariantId out of AnalysisVariantId is
// the unblock, and it is a decision about the editor, not about this catalog.

export function analysisVariantLabel(id: AnalysisVariantId): string {
  return gameSpecForId(id).publicName;
}

/** Parse an /analysis path: bare /analysis opens the flagship (xiangqi); a known
 *  slug opens that variant; anything else is null (the caller 404s). */
export function analysisVariantFromPath(path: string): AnalysisVariantId | null {
  if (path === '/analysis') return 'xiangqi';
  const match = /^\/analysis\/([a-z0-9-]+)$/.exec(path);
  if (!match) return null;
  const slug = match[1];
  return ANALYSIS_VARIANTS.some((variant) => variant.id === slug)
    ? (slug as AnalysisVariantId)
    : null;
}
