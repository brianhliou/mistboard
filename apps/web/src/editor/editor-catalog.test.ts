import { describe, expect, it } from 'vitest';
import { ANALYSIS_VARIANTS, analysisVariantFromPath } from '../analysis-catalog.js';
import { EDITOR_VARIANT_IDS, EDITOR_VARIANTS, editorVariantFromPath } from './editor-catalog.js';

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

  // The editor covers a SUBSET of the analysis catalog. An analysis variant the
  // editor's piece-map model cannot represent fails closed at the route: a 404,
  // never an editor that silently drops part of the position (Duck Xiangqi's
  // duck is not a piece and would be dropped on every round trip).
  it('refuses an analysis variant that has no editor', () => {
    expect(analysisVariantFromPath('/analysis/duck-xiangqi')).toBe('duck-xiangqi');
    expect(editorVariantFromPath('/editor/duck-xiangqi')).toBeNull();
  });

  it('is a subset of the analysis catalog, and the dropdown rows match it', () => {
    const analysisIds = ANALYSIS_VARIANTS.map((variant) => variant.id);
    for (const id of EDITOR_VARIANT_IDS) {
      // Every editor variant has an analysis board to hand its position to.
      expect(analysisIds, id).toContain(id);
      expect(analysisVariantFromPath(`/analysis/${id}`)).toBe(id);
    }
    expect(EDITOR_VARIANTS.map((variant) => variant.id)).toEqual([...EDITOR_VARIANT_IDS]);
    expect(EDITOR_VARIANTS.length).toBeLessThan(ANALYSIS_VARIANTS.length);
  });
});
