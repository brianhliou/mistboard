import { describe, expect, it } from 'vitest';
import {
  contrastRatio,
  DEFAULT_XIANGQI_BOARD_COLOR,
  isXiangqiBoardArt,
  normalizeXiangqiBoardColor,
  XIANGQI_BOARD_ART,
  XIANGQI_BOARD_ART_PRESETS,
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

  // Green and Pine (2026-11-24) are drawn boards, outside the muted-swatch
  // rules above: their own source colours, picked by id, never a default.
  it('registers the two drawn boards apart from the flat presets', () => {
    expect(XIANGQI_BOARD_ART_PRESETS.map((preset) => preset.id)).toEqual(['green', 'pine']);
    expect(isXiangqiBoardArt('green')).toBe(true);
    expect(isXiangqiBoardArt('pine')).toBe(true);
    expect(isXiangqiBoardArt('oak')).toBe(false);
    expect(normalizeXiangqiBoardColor('green')).toBe('green');
    expect(normalizeXiangqiBoardColor('pine')).toBe('pine');
    expect(normalizeXiangqiBoardColor('Pine')).toBe('international');
    expect(xiangqiBoardColorPalette('green')).toMatchObject({ bg: '#c6e9af', dark: false });
    expect(xiangqiBoardColorPalette('pine')).toMatchObject({ bg: '#e1be86', dark: false });
    expect(DEFAULT_XIANGQI_BOARD_COLOR).toBe('international');
  });

  // The move marks keep one colour on every board, so a drawn board may not
  // show them worse than a board that already ships. The floor is the
  // Traditional board, the darkest light board; each mark is composited over
  // every colour the art paints under the pieces and compared with it.
  describe('marks on the drawn boards', () => {
    const MARKS: Record<string, [hex: string, alpha: number]> = {
      'move hint': ['#1f6f5b', 0.72 * 0.9],
      selection: ['#1f6f5b', 0.32],
      'last-move ring': ['#d6af4e', 0.8],
      'last-move origin outline': ['#b45309', 0.55],
      check: ['#e11d1d', 0.55],
    };
    const rgb = (hex: string) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
    const toHex = (c: number[]) =>
      `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
    const over = (hex: string, alpha: number, bg: string) => {
      const [f, b] = [rgb(hex), rgb(bg)];
      return toHex(f.map((v, i) => v * alpha + b[i]! * (1 - alpha)));
    };
    const markContrast = (mark: [string, number], bg: string) =>
      contrastRatio(over(mark[0], mark[1], bg), bg);
    const floor = xiangqiBoardColorPalette('traditional').bg;
    const shortfalls = (grounds: string[]) =>
      Object.entries(MARKS).flatMap(([name, mark]) =>
        grounds
          .filter((bg) => markContrast(mark, bg) < markContrast(mark, floor) - 0.01)
          .map((bg) => `${name} on ${bg}`),
      );

    it('shows every mark at least as well as on the Traditional board', () => {
      const grounds = [
        ...XIANGQI_BOARD_ART_PRESETS.map((preset) => preset.fill),
        XIANGQI_BOARD_ART.green.margin,
        XIANGQI_BOARD_ART.green.river,
        xiangqiBoardColorPalette('green').band,
      ];
      expect(shortfalls(grounds)).toEqual([]);
    });

    it('fails a board painted in a mark colour (planted)', () => {
      expect(shortfalls(['#1f6f5b', '#e11d1d'])).not.toEqual([]);
    });
  });
});
