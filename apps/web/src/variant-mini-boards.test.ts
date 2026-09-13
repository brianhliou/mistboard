import { describe, expect, it } from 'vitest';
import { renderVariantMiniBoard, VARIANT_MINIS } from './variant-mini-boards.js';

describe('variant mini-board markers', () => {
  it('renders the Jungle marker as the bottom-center 3x3 (den + traps) of the real board', () => {
    const svg = renderVariantMiniBoard('jungle', { size: 100 });
    expect(svg).toContain('data-mini-id="jungle"');
    // The real dobutsu board cropped to files c-e: grass + the den + trap tiles + the
    // leopard (c3) and wolf (e3).
    expect(svg).toContain('/piece-sets/jungle/dobutsu/board/grass.png');
    expect(svg).toContain('/piece-sets/jungle/dobutsu/board/den.png');
    expect(svg).toContain('/piece-sets/jungle/dobutsu/board/trap.png');
    expect(svg).toContain('/piece-sets/jungle/dobutsu/red-leopard.png');
    expect(svg).toContain('/piece-sets/jungle/dobutsu/red-wolf.png');
    expect(svg).not.toContain('vm-xq-fog');
  });

  it('renders the Flip Jungle marker as a 2x2 with two flipped elephants on opposite corners', () => {
    const svg = renderVariantMiniBoard('jungle-flip', { size: 100 });
    expect(svg).toContain('data-mini-id="jungle-flip"');
    // The real flip board cropped: the bushy board + a face-down jade disc, plus the red
    // and black elephants flipped up on opposite corners.
    expect(svg).toContain('/piece-sets/jungle/dobutsu/board/flip-board.png');
    expect(svg).toContain('fill="#2f8f6b"');
    expect(svg).toContain('/piece-sets/jungle/dobutsu/red-elephant.png');
    expect(svg).toContain('/piece-sets/jungle/dobutsu/black-elephant.png');
  });

  it('keeps every variant marker free of a decorative outer outline', () => {
    for (const def of VARIANT_MINIS) {
      expect(renderVariantMiniBoard(def.id, { size: 100 }), def.id).not.toContain('vm-frame-');
    }
  });
});
