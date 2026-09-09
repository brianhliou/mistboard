// The /analysis/<variant> catalog: which variants have a standalone analysis
// board, in dropdown order. A variant qualifies only when its tree-review stack
// exists (a VariantTreeAdapter + TreePresentation in review/) — the catalog is
// the fail-closed allowlist for the route, so an unknown or unlisted slug 404s
// instead of falling back to another variant's board.
//
// This module is imported by main.ts route matching: keep it tiny (types + the
// list + the path parser; no review/board imports).
//
// THE BOARD EDITOR IS A SUBSET OF THIS LIST, NOT A MIRROR OF IT. Every editor
// variant is an analysis variant (the editor hands its position to the analysis
// board), but not the other way round: EDITOR_VARIANT_IDS in
// editor/editor-catalog.ts is the editor's own allowlist, derived from this
// union with `satisfies`. Membership here therefore asserts a tree-review stack
// and nothing else.

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
  | 'dark-chess'
  | 'duck-xiangqi';

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
  // Unlisted in CANONICAL_VARIANT_ORDER, so it sorts last. ANALYSIS ONLY, with
  // no board editor: the editor's model is a piece map keyed by square, and the
  // duck is not a piece (it belongs to neither colour, has no role, and rides
  // the seventh FEN field), so an EditorSpec would hand back every position
  // with the duck silently dropped. EDITOR_VARIANT_IDS therefore omits it and
  // /editor/duck-xiangqi 404s.
  entry('duck-xiangqi'),
];

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
