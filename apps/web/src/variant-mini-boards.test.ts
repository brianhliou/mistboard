import { describe, expect, it } from 'vitest';
import { mountVariantMarksLab } from './variant-marks-lab.js';
import { renderVariantMiniBoard, VARIANT_MINIS } from './variant-mini-boards.js';

describe('variant mini-board markers', () => {
  it('renders the Kriegspiel marker as a fogged own-army board', () => {
    const svg = renderVariantMiniBoard('kriegspiel', { size: 100 });

    expect(svg).toContain('data-mini-id="kriegspiel"');
    expect(svg.match(/class="vm-chess-fog"/g)).toHaveLength(15);
  });

  it('renders the Dark Crazyhouse marker with the shared Crazyhouse image', () => {
    const svg = renderVariantMiniBoard('dark-crazyhouse', { size: 100 });

    expect(svg).toContain('data-mini-id="dark-crazyhouse"');
    expect(svg).toContain('vm-hand-tray');
    expect(svg).not.toContain('vm-chess-fog');
  });

  it('renders the Reveal Chess marker backs as white Banqi-style outlined discs', () => {
    const svg = renderVariantMiniBoard('reveal-chess', { size: 100 });
    const host = document.createElement('div');
    host.innerHTML = svg;
    const backs = [...host.querySelectorAll<SVGCircleElement>('circle.vm-chess-back-token')];

    expect(svg).toContain('data-mini-id="reveal-chess"');
    expect(backs).toHaveLength(7);
    for (const back of backs) {
      expect(back.getAttribute('fill')).toBe('#f4efe4');
      expect(back.getAttribute('stroke')).toBe('#3a342b');
      expect(back.getAttribute('stroke-width')).toBe('0.5');
    }
    expect(svg).not.toContain('stroke-width="2"');
    expect(svg).not.toContain('opacity="0.4"');
  });

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

  it('focuses the marker lab sheet on active design-pass variants', () => {
    const root = document.createElement('div');

    mountVariantMarksLab(root);

    expect(root.querySelector('svg[data-mini-id="xiangqi"]')).not.toBeNull();
    expect(root.querySelector('svg[data-mini-id="fortress-xiangqi"]')).not.toBeNull();
    expect(root.querySelector('svg[data-mini-id="jieqi"]')).not.toBeNull();
    expect(root.querySelector('svg[data-mini-id="banqi"]')).not.toBeNull();
    expect(root.querySelector('svg[data-mini-id="dark-xiangqi"]')).not.toBeNull();
    expect(root.querySelector('svg[data-mini-id="dark-chess"]')).not.toBeNull();
    expect(root.querySelector('svg[data-mini-id="jungle"]')).not.toBeNull();
    expect(root.querySelector('svg[data-mini-id="jungle-flip"]')).not.toBeNull();
    expect(root.querySelectorAll('.variant-generated-card')).toHaveLength(8);
    expect(root.querySelectorAll('.variant-generated-scale-row')).toHaveLength(8);
    expect(root.querySelectorAll('.variant-generated-scale-cell')).toHaveLength(48);
    expect(root.querySelector('span[data-variant-marker-id="xiangqi"]')).not.toBeNull();
    expect(root.querySelector('span[data-variant-marker-id="jungle-flip"]')).not.toBeNull();
    expect(root.querySelectorAll('.variant-color-palette')).toHaveLength(2);
    expect(root.querySelectorAll('.variant-color-state-row')).toHaveLength(6);
    expect(root.querySelectorAll('.variant-color-state-card')).toHaveLength(48);
    expect(root.querySelector('svg[data-mini-id="kriegspiel"]')).toBeNull();
    expect(root.querySelector('svg[data-mini-id="dark-crazyhouse"]')).toBeNull();
    expect(root.querySelector('svg[data-mini-id="mini-xiangqi"]')).toBeNull();
    expect(root.querySelector('svg[data-mini-id="dark-mini-xiangqi"]')).toBeNull();
    expect(root.querySelector('span[data-variant-marker-id="mini-xiangqi"]')).toBeNull();
    expect(root.querySelector('svg[data-mini-id="reveal-chess"]')).toBeNull();
  });
});
