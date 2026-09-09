import { readFileSync } from 'node:fs';
import {
  canonicalVariantOrderIndex,
  gameSpecForId,
  hasStartFen,
  normalizeStartFen,
  STUDY_ELIGIBLE_SPEC_IDS,
} from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_STUDY_VARIANT,
  isStudyVariantId,
  STUDY_VARIANTS,
  studyVariantSupportsComposition,
  studyVariantSupportsGamebook,
} from './study-catalog.js';

describe('study catalog', () => {
  // The client union and the shared list feed different layers (board dispatch vs
  // the server's route allowlist). If they drift, the API accepts a chapter the
  // client cannot render (or refuses one it could).
  it('mirrors STUDY_ELIGIBLE_SPEC_IDS exactly', () => {
    expect(STUDY_VARIANTS.map((variant) => variant.id)).toEqual([...STUDY_ELIGIBLE_SPEC_IDS]);
  });

  it('every entry is a real game spec with a site label', () => {
    for (const variant of STUDY_VARIANTS) {
      expect(variant.label).toBe(gameSpecForId(variant.id).publicName);
      expect(variant.label.length).toBeGreaterThan(0);
    }
  });

  it('picker order follows CANONICAL_VARIANT_ORDER', () => {
    const indexes = STUDY_VARIANTS.map((variant) => canonicalVariantOrderIndex(variant.id));
    expect([...indexes].sort((a, b) => a - b)).toEqual(indexes);
  });

  it('narrows variants fail-closed', () => {
    expect(isStudyVariantId('xiangqi')).toBe(true);
    expect(isStudyVariantId('dark-chess')).toBe(true);
    // The hidden-deal variants are in: their canonical FEN pins the deal, and a
    // chapter already persists a hand-set start inside SerializedTree.rootFen.
    expect(isStudyVariantId('banqi')).toBe(true);
    expect(isStudyVariantId('jieqi')).toBe(true);
    expect(isStudyVariantId('jungle-flip')).toBe(true);
    expect(isStudyVariantId('chess')).toBe(false);
    expect(isStudyVariantId('')).toBe(false);
  });

  it('offers compositions exactly where a FEN parser exists', () => {
    // The catalog must not offer the start-position box where normalizeStartFen
    // would refuse the FEN: the author would type a legal position and be told
    // it is wrong. Reading the game package rather than restating the list is
    // the point — one source, no drift.
    for (const variant of STUDY_VARIANTS) {
      expect(studyVariantSupportsComposition(variant.id)).toBe(hasStartFen(variant.id));
      expect(normalizeStartFen(variant.id, 'not a fen at all').ok).toBe(false);
    }
    expect(studyVariantSupportsComposition(DEFAULT_STUDY_VARIANT)).toBe(true);
  });

  it('keeps gamebooks on the one variant with an interactive lesson player', () => {
    for (const variant of STUDY_VARIANTS) {
      expect(studyVariantSupportsGamebook(variant.id)).toBe(variant.id === 'xiangqi');
    }
  });
});

describe('study board dispatch', () => {
  // review/study-review.ts dispatches by string case, and its default branch is
  // compile-time exhaustive over the union — but a case that dynamic-imports the
  // WRONG module still typechecks. Reading the source keeps the mapping honest
  // (same pattern as variant-registry-sync.test.ts reading server source).
  // Path is relative to the vitest root (apps/web), same as articles.test.ts —
  // import.meta.url is not a file: URL under the jsdom environment.
  const source = readFileSync('src/review/study-review.ts', 'utf8');

  it('has a case for every catalog variant', () => {
    for (const variant of STUDY_VARIANTS) {
      expect(source, `${variant.id} has no case in review/study-review.ts`).toContain(
        `case '${variant.id}':`,
      );
    }
  });

  // A branch that ignores rootFen still typechecks and still renders — it just
  // opens every composition chapter at the standard start, which reads as data
  // loss rather than a bug. The catalog offers the box for all five, so all five
  // have to honour it.
  it('resolves the chapter rootFen in every branch', () => {
    for (const variant of STUDY_VARIANTS) {
      const branch = source.slice(source.indexOf(`case '${variant.id}':`));
      const nextCase = branch.indexOf("\n    case '");
      const body = nextCase === -1 ? branch : branch.slice(0, nextCase);
      expect(body, `${variant.id} ignores rootFen in review/study-review.ts`).toContain('rootFen');
      expect(body, `${variant.id} does not seed a root truth`).toContain('truth:');
    }
  });

  it('imports each variant its own review module', () => {
    const expected: Record<string, string> = {
      xiangqi: './xiangqi-review.js',
      jungle: './jungle-review.js',
      'fortress-xiangqi': './fortress-xiangqi-review.js',
      'dark-xiangqi': './dark-xiangqi-review.js',
      'dark-chess': './dark-chess-review.js',
      banqi: './banqi-review.js',
      jieqi: './jieqi-review.js',
      'jungle-flip': './jungle-flip-review.js',
      'duck-xiangqi': './duck-xiangqi-review.js',
    };
    for (const variant of STUDY_VARIANTS) {
      const module = expected[variant.id];
      expect(module, `${variant.id} is missing from this test's expectations`).toBeDefined();
      const branch = source.slice(source.indexOf(`case '${variant.id}':`));
      const nextCase = branch.indexOf("\n    case '");
      expect(nextCase === -1 ? branch : branch.slice(0, nextCase)).toContain(module!);
    }
  });
});
