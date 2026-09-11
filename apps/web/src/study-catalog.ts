// The study variant catalog: which variants a study may be created in, in
// dropdown order. The membership list itself lives in @mistboard/game
// (STUDY_ELIGIBLE_SPEC_IDS) because the server's route allowlist reads the same
// list — this module only adds the client-side capability flags and labels.
//
// A study is SINGLE-variant: the variant is picked once at create time and every
// chapter inherits it (routes/studies.ts refuses a mismatched chapter). The
// `variant` column stays per-chapter because that is what the board dispatch
// reads, but the picker only ever appears on the create-study dialog.
//
// Imported by study.ts and study-index.ts; keep it tiny (no review/board
// imports) so the create dialog does not pull a board stack.

import { type GameSpecId, gameSpecForId, hasStartFen, XIANGQI_SPEC_ID } from '@mistboard/game';
import { variantPublicSurfaceEnabled } from './variant-public-surfaces.js';

// The literal mirror of STUDY_ELIGIBLE_SPEC_IDS. It exists so the client gets a
// NARROW union — that is what makes the board dispatch in review/study-review.ts
// compile-time exhaustive, which a `readonly GameSpecId[]` cannot give. The two
// lists are asserted equal in study-catalog.test.ts, so a variant added to the
// shared list fails the test until it also gets a board.
const STUDY_VARIANT_IDS = [
  'xiangqi',
  'banqi',
  'jieqi',
  'fortress-xiangqi',
  'duck-xiangqi',
  'dark-xiangqi',
  'dark-chess',
  'jungle',
  'jungle-flip',
] as const satisfies readonly GameSpecId[];

export type StudyVariantId = (typeof STUDY_VARIANT_IDS)[number];

export type StudyVariant = {
  id: StudyVariantId;
  /** Site display name (the spec's publicName, e.g. "Fog Xiangqi"). */
  label: string;
};

/** Picker order follows CANONICAL_VARIANT_ORDER (game-specs.ts). */
export const STUDY_VARIANTS: readonly StudyVariant[] = STUDY_VARIANT_IDS.map((id) => ({
  id,
  label: gameSpecForId(id).publicName,
}));

export const DEFAULT_STUDY_VARIANT: StudyVariantId = XIANGQI_SPEC_ID;

/** Fail-closed narrowing for a chapter's persisted `variant` column or a form value. */
export function isStudyVariantId(value: string): value is StudyVariantId {
  return (STUDY_VARIANT_IDS as readonly string[]).includes(value);
}

export function studyVariantLabel(id: StudyVariantId): string {
  return gameSpecForId(id).publicName;
}

/** The variant `<select>` on the create-study dialog. Chapters inherit the
 *  study's variant, so this is the only place the choice is offered.
 *
 *  Eligibility and OFFERING are different questions. `STUDY_ELIGIBLE_SPEC_IDS`
 *  is a capability ("does this variant have a tree-review stack"), and it stays
 *  whole so an existing study of an unlaunched variant still opens. This list is
 *  a public surface, so it offers only what has launched, plus whatever is
 *  already selected. */
export function buildStudyVariantSelect(
  ariaLabel: string,
  selected: StudyVariantId,
): HTMLSelectElement {
  const select = document.createElement('select');
  select.className = 'study-create-dialog__control';
  select.setAttribute('aria-label', ariaLabel);
  const offered = STUDY_VARIANTS.filter(
    (variant) => variant.id === selected || variantPublicSurfaceEnabled(variant.id),
  );
  for (const variant of offered) {
    const option = document.createElement('option');
    option.value = variant.id;
    option.textContent = variant.label;
    select.append(option);
  }
  select.value = selected;
  return select;
}

/** Read a variant `<select>` fail-closed: a tampered or stale value falls back to
 *  the default rather than reaching the API as an unsupported variant. */
export function selectedStudyVariant(select: HTMLSelectElement): StudyVariantId {
  return isStudyVariantId(select.value) ? select.value : DEFAULT_STUDY_VARIANT;
}

/** Whether a chapter of this variant can be rooted at a hand-set position. Reads
 *  the same list normalizeStartFen dispatches on, so the box is offered exactly
 *  where a pasted FEN can actually be parsed back and replayed.
 *
 *  Every study variant now qualifies, including the dealt three: their canonical
 *  FEN is the six-field DEALT form (dealt-fen.ts) whose last field pins the deal,
 *  and a chapter already persists a hand-set start as SerializedTree.rootFen. */
export function studyVariantSupportsComposition(id: StudyVariantId): boolean {
  return hasStartFen(id);
}

/** Whether a chapter of this variant can be turned into a gamebook (guess-the-move)
 *  lesson. The gamebook player is still bound to the xiangqi interactive board
 *  (review/xiangqi-gamebook.ts); other variants author trees but cannot be played. */
export function studyVariantSupportsGamebook(id: StudyVariantId): boolean {
  return id === XIANGQI_SPEC_ID;
}
