// The board editor's variant allowlist and its /editor/<variant> route parser.
//
// THE EDITOR COVERS A SUBSET OF THE ANALYSIS CATALOG, AND THIS LIST IS THAT
// SUBSET. It used to be the whole catalog, and editor-specs.ts keyed its
// exhaustive EDITOR_SPECS record on AnalysisVariantId, which meant listing a
// variant on the analysis board asserted it also had a position editor.
//
// Duck Xiangqi is why the two lists were split, and (since 2026-09-10) also the
// proof the split was the right shape: the editor's board is a piece map keyed
// by square and the duck belongs to neither colour and has no role, so it sat
// on the analysis board with NO editor until EditorModel grew a field that
// could hold a duck (`duck?: EditorDuckExtras`, editor-model.ts). The list is
// the thing that moved; nothing else had to. It happens to name every analysis
// variant again today, which is a fact about today and not a rule: a variant
// whose position the model cannot represent belongs on the analysis board and
// off this list, exactly as duck-xiangqi was.
//
// The list is the type. EDITOR_VARIANT_IDS is `as const satisfies readonly
// AnalysisVariantId[]`, so a member that is not an analysis variant (a typo, or
// a variant with no analysis board to hand a position to) is a compile error,
// and EditorVariantId is exactly what the array holds. There is therefore no
// second place to update and no way for the route parser, the picker and the
// spec record to disagree.
//
// FAIL-CLOSED IN BOTH DIRECTIONS. A variant that is not listed here has no
// editor route (the parser returns null and main.ts 404s), no dropdown entry,
// and no EDITOR_SPECS key, so `editorSpec(id)` for it does not typecheck. A
// variant ADDED to the analysis catalog gets no editor by default: it must be
// listed here too, and that fails the build until it has a spec.
//
// Imported by main.ts route matching: keep it tiny (no board/spec imports).

import {
  ANALYSIS_VARIANTS,
  type AnalysisVariant,
  type AnalysisVariantId,
} from '../analysis-catalog.js';

/** Variants with a position editor, in analysis-catalog order. */
export const EDITOR_VARIANT_IDS = [
  'xiangqi',
  'banqi',
  'jieqi',
  'fortress-xiangqi',
  'duck-xiangqi',
  'dark-xiangqi',
  'dark-chess',
  'jungle',
  'jungle-flip',
] as const satisfies readonly AnalysisVariantId[];

/** Slugs the /editor route serves. A strict subset of AnalysisVariantId. */
export type EditorVariantId = (typeof EDITOR_VARIANT_IDS)[number];

/** Narrows an analysis variant to one the editor can actually represent. */
export function isEditorVariant(id: AnalysisVariantId): id is EditorVariantId {
  return (EDITOR_VARIANT_IDS as readonly AnalysisVariantId[]).includes(id);
}

/** A catalog row for a variant the editor covers. */
export type EditorVariant = AnalysisVariant & { id: EditorVariantId };

/** The editor's dropdown rows: the catalog entries, filtered to the subset, so
 *  labels and order stay defined in exactly one place. */
export const EDITOR_VARIANTS: readonly EditorVariant[] = ANALYSIS_VARIANTS.filter(
  (variant): variant is EditorVariant => isEditorVariant(variant.id),
);

/** Parse an /editor path: bare /editor opens the flagship (xiangqi); a slug in
 *  the editor subset opens that variant; anything else is null (the caller
 *  404s), including an analysis variant with no editor. */
export function editorVariantFromPath(path: string): EditorVariantId | null {
  if (path === '/editor') return 'xiangqi';
  const match = /^\/editor\/([a-z0-9-]+)$/.exec(path);
  if (!match) return null;
  const slug = match[1];
  return EDITOR_VARIANT_IDS.find((id) => id === slug) ?? null;
}
