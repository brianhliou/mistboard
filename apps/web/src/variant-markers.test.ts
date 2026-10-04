import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GAME_SPECS } from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import { variantDisplayLabel } from './game-display.js';
import {
  FINAL_VARIANT_MARKERS,
  isVariantMarkerId,
  renderVariantMarker,
} from './variant-markers.js';
import { VARIANT_MINIS, type VariantMiniId } from './variant-mini-boards.js';
import { variantMiniIdForGameSpec } from './variants.js';

// Variant markers fail closed: no fallback picture exists, so a variant with no
// marker art has to fail here (or at the `satisfies Record<VariantMiniId, …>`
// in variant-markers.ts), never ship as a blank mask or a stand-in board.

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
// Every shipped mask is this square; a different size is a different pipeline.
const MARKER_PX = 1254;

// Game specs that are deliberately not variants anywhere a marker is shown.
// Adding to this list is a product decision, not a way to get a test green.
const SPECS_WITHOUT_MARKER = ['chess', 'mahjong'];

describe('variant markers', () => {
  it('has a marker for every variant id, and nothing else', () => {
    expect(Object.keys(FINAL_VARIANT_MARKERS).sort()).toEqual(
      VARIANT_MINIS.map((def) => def.id).sort(),
    );
  });

  it('points every marker at a 1254px PNG mask that exists on disk', () => {
    for (const [id, marker] of Object.entries(FINAL_VARIANT_MARKERS)) {
      let bytes: Buffer;
      try {
        bytes = readFileSync(join(PUBLIC, marker.path));
      } catch {
        throw new Error(`${id}: ${marker.path} is not in apps/web/public`);
      }
      expect(bytes.subarray(0, 8).equals(PNG_SIGNATURE), `${id} is not a PNG`).toBe(true);
      // IHDR: width and height are the big-endian u32s at bytes 16 and 20.
      expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], id).toEqual([MARKER_PX, MARKER_PX]);
    }
  });

  it('gives every live game spec a marker, except the named non-variants', () => {
    const live = GAME_SPECS.filter((spec) => spec.runtimeStatus !== 'retired');
    const missing = live
      .filter((spec) => variantMiniIdForGameSpec(spec.id) === null)
      .map((spec) => spec.id)
      .sort();
    expect(missing).toEqual(SPECS_WITHOUT_MARKER);
    for (const spec of live) {
      const id = variantMiniIdForGameSpec(spec.id);
      if (id) expect(isVariantMarkerId(id), spec.id).toBe(true);
    }
  });

  it('renders a mask, never a board', () => {
    const html = renderVariantMarker('crazyhouse-xiangqi', { size: 32 });
    expect(html).toMatch(/^<span class="variant-marker"/);
    expect(html).toContain("url('/variant-markers/final/crazyhouse-xiangqi.png')");
    expect(html).not.toContain('<svg');
  });

  it('throws on an id with no marker instead of drawing a stand-in', () => {
    expect(() => renderVariantMarker('chess' as VariantMiniId)).toThrow(/No variant marker/);
    expect(isVariantMarkerId('mahjong')).toBe(false);
    expect(isVariantMarkerId('toString')).toBe(false);
  });
});

// A marker's fallback aria-label and title read `${label} marker`, so a mini's
// label is the variant's public name. A bulk rename once gave the jieqi marker
// the label "Banqi" and the banqi marker "Jieqi" (fixed 2026-10-03).
describe('variant mini labels', () => {
  it('name each game spec the way the rest of the site does', () => {
    for (const mini of VARIANT_MINIS) {
      if (!GAME_SPECS.some((spec) => spec.id === mini.id)) continue;
      expect(mini.label, mini.id).toBe(variantDisplayLabel(mini.id));
    }
  });
});
