import { describe, expect, it } from 'vitest';
import {
  contrastRatio,
  DEFAULT_XIANGQI_BOARD_COLOR,
  normalizeXiangqiBoardColor,
  XIANGQI_BOARD_COLOR_PRESETS,
  xiangqiBoardColorPalette,
  xiangqiBoardPalette,
} from './xiangqi-board-color.js';

describe('xiangqi board colour', () => {
  it('offers the two legacy boards first, then the muted presets', () => {
    expect(XIANGQI_BOARD_COLOR_PRESETS.map((preset) => preset.id)).toEqual([
      'international',
      'traditional',
      'paper',
      'birch',
      'oak',
      'grey',
      'slate',
    ]);
    expect(DEFAULT_XIANGQI_BOARD_COLOR).toBe('international');
  });

  // The old International and Traditional boards survive exactly as colours.
  it('keeps the legacy boards at their original fill and ink', () => {
    expect(xiangqiBoardColorPalette('international')).toMatchObject({
      bg: '#f5dca8',
      ink: '#5a3a14',
      band: 'rgba(90, 58, 20, 0.06)',
      dark: false,
    });
    expect(xiangqiBoardColorPalette('traditional')).toMatchObject({
      bg: '#d9bd82',
      ink: '#4b3c2a',
      band: 'rgba(75, 60, 42, 0.07)',
      dark: false,
    });
  });

  it('normalizes stored values to a preset, else the default', () => {
    expect(normalizeXiangqiBoardColor(null)).toBe('international');
    expect(normalizeXiangqiBoardColor('mahogany')).toBe('international');
    // Custom hexes and the retired strong presets are gone.
    expect(normalizeXiangqiBoardColor('#3a5f7b')).toBe('international');
    expect(normalizeXiangqiBoardColor('walnut')).toBe('international');
    expect(normalizeXiangqiBoardColor('sky')).toBe('international');
    expect(normalizeXiangqiBoardColor('traditional')).toBe('traditional');
    expect(normalizeXiangqiBoardColor('slate')).toBe('slate');
    expect(normalizeXiangqiBoardColor('grain')).toBe('grain');
  });

  it('gives light fills dark ink and the slate board light ink', () => {
    const paper = xiangqiBoardColorPalette('paper');
    expect(paper.dark).toBe(false);
    expect(contrastRatio(paper.ink, '#000000')).toBeLessThan(contrastRatio(paper.ink, '#ffffff'));
    const slate = xiangqiBoardColorPalette('slate');
    expect(slate.dark).toBe(true);
    expect(contrastRatio(slate.ink, '#ffffff')).toBeLessThan(contrastRatio(slate.ink, '#000000'));
  });

  it('keeps every derived preset at 6:1 or better between fill and ink', () => {
    for (const preset of XIANGQI_BOARD_COLOR_PRESETS) {
      const palette = xiangqiBoardColorPalette(preset.id);
      const floor = preset.ink ? 4.5 : 6;
      expect(contrastRatio(palette.ink, palette.bg), preset.id).toBeGreaterThanOrEqual(floor);
    }
  });

  // "A lot of these default board colors are a little bit too strong": no
  // preset may read as a paint swatch. None is more saturated (higher chroma)
  // than the Traditional board, the strongest colour the site shipped before.
  it('keeps every preset muted', () => {
    const chroma = (hex: string): number => {
      const rgb = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
      return (Math.max(...rgb) - Math.min(...rgb)) / 255;
    };
    const ceiling = chroma('#d9bd82');
    for (const preset of XIANGQI_BOARD_COLOR_PRESETS) {
      expect(chroma(preset.fill), preset.id).toBeLessThanOrEqual(ceiling);
    }
  });

  it('keeps the derived ink in the fill hue rather than flat black or white', () => {
    const slate = xiangqiBoardPalette('#454c54');
    const [r, , b] = [1, 3, 5].map((i) => Number.parseInt(slate.ink.slice(i, i + 2), 16));
    expect(b).toBeGreaterThan(r ?? 0);
  });
});
