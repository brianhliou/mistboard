import { canonicalVariantOrderIndex, gameSpecForId } from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import { ANALYSIS_VARIANTS, analysisVariantFromPath } from './analysis-catalog.js';
import { variantMiniIdForGameSpec } from './variants.js';

describe('analysis catalog', () => {
  it('every entry is a real game spec with a site label and a variant marker', () => {
    for (const variant of ANALYSIS_VARIANTS) {
      const spec = gameSpecForId(variant.id);
      expect(variant.label).toBe(
        variant.id === 'fortress-xiangqi' ? 'Fortress Xiangqi' : spec.publicName,
      );
      expect(variant.label.length).toBeGreaterThan(0);
      // The dropdown + meta card render the finalized variant marker; a catalog
      // entry without one would fall back to a blank icon box.
      expect(variantMiniIdForGameSpec(variant.id)).not.toBeNull();
    }
  });

  it('disambiguates Fortress in the analysis dropdown', () => {
    expect(ANALYSIS_VARIANTS.find((variant) => variant.id === 'fortress-xiangqi')?.label).toBe(
      'Fortress Xiangqi',
    );
  });

  it('dropdown order follows CANONICAL_VARIANT_ORDER', () => {
    const indexes = ANALYSIS_VARIANTS.map((variant) => canonicalVariantOrderIndex(variant.id));
    expect([...indexes].sort((a, b) => a - b)).toEqual(indexes);
  });

  it('parses /analysis paths fail-closed', () => {
    expect(analysisVariantFromPath('/analysis')).toBe('xiangqi');
    expect(analysisVariantFromPath('/analysis/xiangqi')).toBe('xiangqi');
    expect(analysisVariantFromPath('/zh-hans/analysis/xiangqi')).toBe('xiangqi');
    expect(analysisVariantFromPath('/zh-hant/analysis/xiangqi')).toBe('xiangqi');
    expect(analysisVariantFromPath('/zh-hans/analysis/banqi')).toBeNull();
    expect(analysisVariantFromPath('/zh-hans/analysis')).toBeNull();
    expect(analysisVariantFromPath('/analysis/banqi')).toBe('banqi');
    expect(analysisVariantFromPath('/analysis/jungle-flip')).toBe('jungle-flip');
    // Unknown or malformed slugs must return null (404), never another variant.
    expect(analysisVariantFromPath('/analysis/chess960')).toBeNull();
    expect(analysisVariantFromPath('/analysis/banqi/extra')).toBeNull();
    expect(analysisVariantFromPath('/analysis/Banqi')).toBeNull();
    expect(analysisVariantFromPath('/analysisx')).toBeNull();
  });
});
