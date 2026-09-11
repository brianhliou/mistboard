import { describe, expect, it } from 'vitest';
import { ANALYSIS_VARIANTS, analysisVariantFromPath } from '../analysis-catalog.js';
import {
  EDITOR_VARIANT_IDS,
  EDITOR_VARIANTS,
  editorVariantFromPath,
  isEditorVariant,
} from './editor-catalog.js';

describe('editorVariantFromPath', () => {
  it('opens the flagship on the bare path', () => {
    expect(editorVariantFromPath('/editor')).toBe('xiangqi');
  });

  it('opens every editor variant by slug', () => {
    for (const id of EDITOR_VARIANT_IDS) {
      expect(editorVariantFromPath(`/editor/${id}`)).toBe(id);
    }
  });

  it('is null for unknown slugs and near misses (the caller 404s)', () => {
    for (const path of [
      '/editor/',
      '/editor/chess',
      '/editor/xiangqi/extra',
      '/editor/Xiangqi',
      '/editors',
      '/analysis/xiangqi',
      '/',
    ]) {
      expect(editorVariantFromPath(path), path).toBeNull();
    }
  });

  // Duck Xiangqi was the reason this list exists apart from the analysis
  // catalog: its duck is not a piece, so it had an analysis board and NO editor
  // route until the editor model grew a field that could hold a duck
  // (editor-model.ts). It now opens like every other variant, and the duck
  // survives the round trip on the seventh FEN field (editor-specs.test.ts).
  it('opens duck xiangqi, the variant that used to have no editor', () => {
    expect(analysisVariantFromPath('/analysis/duck-xiangqi')).toBe('duck-xiangqi');
    expect(editorVariantFromPath('/editor/duck-xiangqi')).toBe('duck-xiangqi');
  });

  it('is a subset of the analysis catalog, and the dropdown rows match it', () => {
    const analysisIds = ANALYSIS_VARIANTS.map((variant) => variant.id);
    for (const id of EDITOR_VARIANT_IDS) {
      // Every editor variant has an analysis board to hand its position to.
      expect(analysisIds, id).toContain(id);
      expect(analysisVariantFromPath(`/analysis/${id}`)).toBe(id);
    }
    expect(EDITOR_VARIANTS.map((variant) => variant.id)).toEqual([...EDITOR_VARIANT_IDS]);
    // Subset, not equality, and NOT a count. Every analysis variant happens to
    // have an editor today, so a strict `<` (which this asserted while duck
    // xiangqi was the exception) now says something false; and a strict `===`
    // would forbid the very case the split exists for. What must hold is the
    // relation: the editor may never serve a route the analysis catalog does
    // not, and a variant left off this list gets no route at all.
    expect(EDITOR_VARIANTS.length).toBeLessThanOrEqual(ANALYSIS_VARIANTS.length);
    for (const id of analysisIds) {
      expect(editorVariantFromPath(`/editor/${id}`), id).toBe(isEditorVariant(id) ? id : null);
    }
  });
});
